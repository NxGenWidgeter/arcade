#!/usr/bin/python3
"""Arcade — desktop app for the offline board-game set.

A GTK 3 window with a WebKit2 view (the same engine family as Safari) over a
private loopback server, instead of a Firefox tab.  Why a server at all: a
`file://` page has no stable security origin, so localStorage — where the
win/loss record lives — either refuses to save or vanishes between launches.
A fixed 127.0.0.1 origin makes the record survive, and the server is bound to
this process's lifetime, so nothing is left listening after the window closes.

What this buys over the browser tab:
  * its own window, own icon, own launcher — no tabs, no URL bar, no history
  * the record and settings persist in a dedicated WebKit profile
  * external links open in the real browser; internal navigation stays put
  * F11 fullscreen, Ctrl+Q quit, F12 inspector, zoom shortcuts
  * window size and maximised state come back on the next launch

Run:  ./arcade          (launcher script, prefers /usr/bin/python3)
"""
import json
import os
import signal
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gdk, GLib, Gio, Gtk, WebKit2  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
APP_ID = 'com.nxgenwidgeter.Arcade'
APP_NAME = 'Arcade'
ICON_NAME = 'nxgen-arcade'

# Fixed port: localStorage is keyed by origin, port included, so a random port
# would hand every launch an empty record.  ARCADE_PORT exists for tests.
PORT = int(os.environ.get('ARCADE_PORT', '8788'))
ORIGIN = f'http://127.0.0.1:{PORT}'
URL = ORIGIN + '/'

DATA_DIR = os.path.join(os.path.expanduser('~'), '.local', 'share', 'arcade')
STATE_FILE = os.path.join(DATA_DIR, 'window.json')
WEBKIT_DIR = os.path.join(DATA_DIR, 'webkit')

WIDTH, HEIGHT = 1140, 860
MIN_WIDTH, MIN_HEIGHT = 620, 560
BG = '#0c0a08'                     # page background: no white flash on load

# Only the app's own assets are reachable. The document root is the source
# directory, so an unfiltered SimpleHTTPRequestHandler would also hand out the
# .git directory and anything else that lands here.
ASSETS = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/arcade.js': ('arcade.js', 'text/javascript; charset=utf-8'),
    '/icon.svg': ('icon.svg', 'image/svg+xml'),
}
HEALTH = b'nxgen-arcade\n'


class Handler(BaseHTTPRequestHandler):
    """Static asset server for the view. Stdlib only, read-only, loopback."""

    server_version = 'Arcade'
    sys_version = ''

    def do_GET(self):                                   # noqa: N802 (stdlib name)
        path = self.path.split('?', 1)[0]
        if path == '/__arcade/health':
            self.send_body(HEALTH, 'text/plain; charset=utf-8')
            return
        hit = ASSETS.get(path)
        if hit is None:
            self.send_error(404, 'Not found')
            return
        name, ctype = hit
        try:
            with open(os.path.join(BASE, name), 'rb') as handle:
                body = handle.read()
        except OSError:
            self.send_error(500, 'Unreadable')
            return
        # No caching: editing arcade.js and hitting Ctrl+R should show the edit.
        self.send_body(body, ctype, extra={'Cache-Control': 'no-store'})

    do_HEAD = do_GET

    def send_body(self, body, ctype, extra=None):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def log_message(self, *_args):
        """Keep the terminal quiet: this is a GUI app, not a dev server."""


def start_server():
    """Bind the loopback server; return (server, None) or (None, reason)."""
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as exc:
        return None, f'{exc}'
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, None


def load_state():
    try:
        with open(STATE_FILE, encoding='utf-8') as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_state(**changes):
    data = load_state()
    data.update(changes)
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(STATE_FILE, 'w', encoding='utf-8') as handle:
            json.dump(data, handle)
    except OSError:
        pass


def web_context():
    """A context with an on-disk data directory: the win/loss record lives in
    localStorage, and it must be there again tomorrow."""
    os.makedirs(WEBKIT_DIR, exist_ok=True)
    manager = WebKit2.WebsiteDataManager(
        base_data_directory=os.path.join(WEBKIT_DIR, 'data'),
        base_cache_directory=os.path.join(WEBKIT_DIR, 'cache'),
    )
    context = WebKit2.WebContext(website_data_manager=manager)
    if os.environ.get('ARCADE_DEBUG') == '1':
        context.get_settings().set_enable_write_console_messages_to_stdout(True)
    return context


class ArcadeApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID,
                         flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.server = None
        self.window = None

    # -- lifecycle -------------------------------------------------------
    def do_startup(self):
        Gtk.Application.do_startup(self)
        Gtk.Settings.get_default().set_property('gtk-application-prefer-dark-theme', True)

    def do_activate(self):
        if self.window is not None:
            self.raise_window()
            return
        self.server, error = start_server()
        if self.server is None:
            self.fail(f'Port {PORT} is taken ({error}).\n\n'
                      'Another copy of Arcade, or something else, is already '
                      'listening there. Close it, or launch with ARCADE_PORT=…')
            return
        self.window = ArcadeWindow(self)
        self.window.connect('destroy', self.on_window_destroy)
        self.window.show_all()
        self.window.present()
        self.window.load()

    def do_shutdown(self):
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        Gtk.Application.do_shutdown(self)

    def on_window_destroy(self, _window):
        self.window = None
        self.quit()

    def raise_window(self):
        self.window.present_with_time(Gdk.CURRENT_TIME)

    def fail(self, message):
        dialog = Gtk.MessageDialog(message_type=Gtk.MessageType.ERROR,
                                   buttons=Gtk.ButtonsType.CLOSE,
                                   text='Arcade could not start')
        dialog.format_secondary_text(message)
        dialog.connect('response', lambda *_: self.quit())
        dialog.show()
        self._dialog = dialog


class ArcadeWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title=APP_NAME)
        self.app = app
        state = load_state()
        self.set_default_size(int(state.get('width') or WIDTH),
                              int(state.get('height') or HEIGHT))
        self.set_size_request(MIN_WIDTH, MIN_HEIGHT)
        self.set_icon_name(ICON_NAME)
        self.set_wmclass('Arcade', 'Arcade')
        self.set_position(Gtk.WindowPosition.CENTER)
        self._zoom = float(state.get('zoom') or 1.0)
        self._save_timer = None
        self._ready = False

        self.view = WebKit2.WebView.new_with_context(web_context())
        settings = self.view.get_settings()
        settings.set_enable_smooth_scrolling(True)
        settings.set_enable_page_cache(False)          # offline page, always fresh
        settings.set_enable_developer_extras(True)     # F12 inspector
        self.view.set_background_color(self.hex_rgba(BG))
        self.view.connect('load-changed', self.on_load_changed)
        self.view.connect('load-failed', self.on_load_failed)
        self.view.connect('decide-policy', self.on_decide_policy)
        self.view.connect('context-menu', self.on_context_menu)
        self.view.connect('web-process-terminated', self.on_web_process_terminated)
        self.view.set_zoom_level(self._zoom)
        self.add(self.view)

        self.connect('key-press-event', self.on_key)
        self.connect('configure-event', self.on_configure)
        self.connect('window-state-event', self.on_window_state)
        if state.get('maximized'):
            self.maximize()

    # -- helpers ---------------------------------------------------------
    @staticmethod
    def hex_rgba(value):
        value = value.lstrip('#')
        return Gdk.RGBA(*(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)), 1.0)

    def load(self):
        self.view.load_uri(URL)

    def set_zoom(self, level):
        self._zoom = max(0.6, min(2.2, round(level, 2)))
        self.view.set_zoom_level(self._zoom)
        save_state(zoom=self._zoom)

    # -- view signals ----------------------------------------------------
    def on_load_changed(self, view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self._ready = True
            title = view.get_title()
            if title:
                self.set_title(title.split('—')[0].strip() or APP_NAME)
            view.grab_focus()

    def on_load_failed(self, _view, _event, uri, error):
        """A refused navigation isn't a crash; only report our own origin."""
        if uri and uri.startswith(ORIGIN):
            self.view.load_html(
                '<body style="margin:0;background:%s;color:#efe8dc;font:14px Cantarell,sans-serif;'
                'display:grid;place-items:center;height:100vh;text-align:center">'
                '<div><h2 style="font-weight:500">Arcade could not load</h2>'
                '<p style="color:#9c9186">%s</p>'
                '<p style="color:#6f665d;font-size:12px">%s</p></div></body>'
                % (BG, uri, error.message if error else ''), ORIGIN + '/')
        return True

    def on_decide_policy(self, _view, decision, decision_type):
        """Everything that isn't this app's own page goes to the real browser."""
        if decision_type in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                             WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            action = decision.get_navigation_action()
            request = action.get_request()
            uri = (request.get_uri() if request else '') or ''
            if uri and not uri.startswith(ORIGIN) and not uri.startswith('about:'):
                try:
                    Gio.AppInfo.launch_default_for_uri(uri, None)
                except GLib.Error:
                    pass
                decision.ignore()
                return True
        return False

    def on_context_menu(self, _view, _menu, _event, _hit):
        """No browser menu in an app: right-click does nothing."""
        return True

    def on_web_process_terminated(self, _view, reason):
        if reason != WebKit2.WebProcessTerminationReason.REQUESTED_BY_CLIENT:
            self.view.reload()

    # -- window signals --------------------------------------------------
    def on_configure(self, _widget, _event):
        if self._save_timer is None:
            self._save_timer = GLib.timeout_add(800, self.save_geometry)
        return False

    def save_geometry(self):
        self._save_timer = None
        if not self.get_mapped():
            return False
        width, height = self.get_size()
        if self.is_maximized():
            save_state(maximized=True)
        else:
            save_state(width=int(width), height=int(height), maximized=False)
        return False

    def on_window_state(self, _widget, event):
        if self._save_timer is None:
            self._save_timer = GLib.timeout_add(800, self.save_geometry)
        return False

    def on_key(self, _widget, event):
        ctrl = bool(event.state & Gdk.ModifierType.CONTROL_MASK)
        if event.keyval == Gdk.KEY_F11:
            self.unfullscreen() if self.is_fullscreen() else self.fullscreen()
            return True
        if ctrl and event.keyval in (Gdk.KEY_q, Gdk.KEY_w):
            self.close()
            return True
        if ctrl and event.keyval in (Gdk.KEY_r, Gdk.KEY_F5) or event.keyval == Gdk.KEY_F5:
            self.view.reload()
            return True
        if event.keyval == Gdk.KEY_F12:
            inspector = self.view.get_inspector()
            if inspector is None:
                self.view.set_settings(self.view.get_settings())
                inspector = self.view.get_inspector()
            if inspector is not None:
                inspector.show() if not inspector.get_visible() else inspector.close()
            return True
        if ctrl and event.keyval in (Gdk.KEY_plus, Gdk.KEY_equal, Gdk.KEY_KP_Add):
            self.set_zoom(self._zoom + 0.1)
            return True
        if ctrl and event.keyval in (Gdk.KEY_minus, Gdk.KEY_KP_Subtract):
            self.set_zoom(self._zoom - 0.1)
            return True
        if ctrl and event.keyval == Gdk.KEY_0:
            self.set_zoom(1.0)
            return True
        return False


def install_icon():
    """Put the SVG in the user's icon theme so the window, the dock and the
    launcher all resolve the same mark (gdk-pixbuf here has no SVG loader, so
    set_icon_from_file would fail — the icon theme renders it through librsvg)."""
    target = os.path.join(os.path.expanduser('~'), '.local', 'share', 'icons',
                          'hicolor', 'scalable', 'apps', f'{ICON_NAME}.svg')
    source = os.path.join(BASE, 'icon.svg')
    try:
        if os.path.exists(target):
            if os.path.getmtime(target) >= os.path.getmtime(source):
                return
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(source, 'rb') as src, open(target, 'wb') as dst:
            dst.write(src.read())
    except OSError:
        pass


def main():
    if not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
        print('Arcade is a desktop app: no display available.', file=sys.stderr)
        return 1
    os.makedirs(DATA_DIR, exist_ok=True)
    install_icon()
    GLib.set_prgname('arcade')
    GLib.set_application_name(APP_NAME)
    Gdk.set_program_class('Arcade')

    app = ArcadeApp()
    # Ctrl+C in the launcher terminal should close the window, not hang.
    try:
        signal.signal(signal.SIGINT, signal.SIG_DFL)
    except (ValueError, OSError):
        pass
    return app.run(sys.argv)


if __name__ == '__main__':
    sys.exit(main())
