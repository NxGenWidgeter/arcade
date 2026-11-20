#!/usr/bin/python3
"""Chess check: engine perft + the real board, clicked through the real app.

    ARCADE_PORT=8799 /usr/bin/python3 ctest.py      # screenshots in /tmp/arcade-chess

Perft numbers come from the Chess Programming Wiki; if move generation drifts
(castling, en passant, promotion) these diverge immediately. The rest of the
walk opens the game in the app's own WebKit window, plays real clicks, and
photographs each state.

Every action is wrapped in an IIFE: WebKit keeps one global lexical scope across
evaluate_javascript calls, so a second top-level `const s` is a SyntaxError.
"""
import json
import os
import sys

import cairo

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as arcade  # noqa: E402

SHOTS = '/tmp/arcade-chess'
os.makedirs(SHOTS, exist_ok=True)

KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'
EXPECT_START = [20, 400, 8902]
EXPECT_KIWI = [48, 2039, 97862]


def act(body):
    return '(() => {' + body + '})()'


def click(*squares):
    return act('const s = document.querySelectorAll(".ch .sq");'
               + ''.join(f's[{i}].click();' for i in squares))


def load(fen):
    return act(f'window.__nxChess.load("{fen}");')


def button(label):
    return act('const b = [...document.querySelectorAll(".panel .btn")]'
               f'.find(x => x.textContent === "{label}"); b && b.click();')


OPEN = act('const card = [...document.querySelectorAll(".card")]'
           '.find(c => (c.querySelector("h3") || {}).textContent === "Chess");'
           'card && card.click();')

PERFT = ('window.__perft = JSON.stringify({'
         'start: [1,2,3].map(d => __nxChess.perft(__nxChess.start, d)),'
         f'kiwi: [1,2,3].map(d => __nxChess.perft("{KIWI}", d))'
         '});')

STATUS = ('window.__say = JSON.stringify({'
          'status: document.querySelector(".turn-text").textContent,'
          ' banner: (document.querySelector(".banner strong") || {}).textContent || null,'
          ' check: !!document.querySelector(".ch .sq.check"),'
          ' pieces: document.querySelectorAll(".ch .pc").length,'
          ' sel: document.querySelectorAll(".ch .sq.sel").length,'
          ' dest: document.querySelectorAll(".ch .sq.dest").length'
          '});')

STEPS = [
    dict(name='hub', shot='hub', wait=1300),
    dict(name='open chess', js=OPEN, wait=900, shot='board-start'),
    dict(name='versus Talia',      # stored mode may be 2 players from a fuzz run
         js=act("document.querySelector('[data-mode=\"ai\"]').click();"), wait=1000),
    dict(name='perft', js=PERFT, wait=300, probe='__perft'),
    dict(name='1.e4 + reply', js=click(52, 36), wait=2400, shot='after-1.e4', say=True),
    dict(name='Nf3 + reply', js=click(62, 45), wait=2600, shot='after-Nf3', say=True),
    dict(name='select queen', js=click(59), wait=500, shot='select-queen', say=True),
    dict(name='undo', js=button('Undo'), wait=900, shot='after-undo', say=True),
    dict(name='undo while Talia thinks',
         js=act('const s = document.querySelectorAll(".ch .sq"); s[52].click(); s[36].click();'
                'const u = [...document.querySelectorAll(".panel .btn")]'
                '.find(x => x.textContent === "Undo"); u.click();'
                'window.__race = JSON.stringify({'
                ' e2: !!document.querySelectorAll(".ch .sq")[52].querySelector(".pc"),'
                ' e4: !!document.querySelectorAll(".ch .sq")[36].querySelector(".pc")});'),
         wait=2200, probe='__race', say=True),
    dict(name='hint', js=button('Hint'), wait=500, shot='hint', say=True),
    dict(name='promotion position', js=load('7k/P7/8/8/8/8/8/K7 w - - 0 1'), wait=700,
         shot='promo-start', say=True),
    dict(name='pawn selected', js=click(8), wait=500, shot='promo-select', say=True),
    dict(name='promote', js=click(0), wait=700, shot='promo-tray', say=True),
    dict(name='take the queen',
         js=act('const b = document.querySelector(".promo button"); b && b.click();'
                'window.__promo1 = JSON.stringify({'
                ' a8: (document.querySelectorAll(".ch .sq")[0].querySelector(".pc") || {}).textContent || null});'),
         wait=2400, shot='promoted', say=True, probe='__promo1'),
    dict(name='knight promotion',
         js=act('window.__nxChess.load("7k/P7/8/8/8/8/8/K7 w - - 0 1");'
                'const s = document.querySelectorAll(".ch .sq"); s[8].click(); s[0].click();'
                'const b = document.querySelectorAll(".promo button")[3]; b && b.click();'
                'window.__promo2 = JSON.stringify({'
                ' a8: (document.querySelectorAll(".ch .sq")[0].querySelector(".pc") || {}).textContent || null});'),
         wait=2600, shot='promoted-knight', probe='__promo2'),
    dict(name='castle position', js=load('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), wait=700),
    dict(name='king selected', js=click(60), wait=500, shot='castle-dests', say=True),
    dict(name='castle short', js=click(62), wait=2400, shot='castled', say=True),
    dict(name='in check', js=load('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'), wait=700,
         shot='in-check', say=True),
    dict(name='en passant position', js=load('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), wait=700),
    dict(name='e5 selected', js=click(28), wait=500, shot='ep-dests', say=True),
    dict(name='exd6', js=click(19), wait=2400, shot='ep-done', say=True),
    dict(name='two players', js=act('document.querySelector("[data-mode=\\"two\\"]").click();'),
         wait=1000),
    dict(name='open chess again', js=OPEN, wait=900),
    dict(name='fool 1', js=click(53, 45), wait=600),
    dict(name='fool 2', js=click(12, 28), wait=600),
    dict(name='fool 3', js=click(54, 38), wait=600),
    dict(name='fool 4', js=click(3, 39), wait=1000, shot='fools-mate', say=True),
    dict(name='back to Talia',
         js=act('document.querySelector("[data-mode=\\"ai\\"]").click();'), wait=900),
    dict(name='hub again',
         js=act('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));'
                'window.__hub = JSON.stringify({cards: document.querySelectorAll(".card").length,'
                ' names: [...document.querySelectorAll(".card h3")].map(h => h.textContent)});'),
         wait=900, shot='hub-after', probe='__hub'),
    dict(name='errors', js='window.__errs = JSON.stringify(window.__errors || [])',
         wait=300, probe='__errs'),
]


class Walk:
    def __init__(self):
        self.server, error = arcade.start_server()
        if self.server is None:
            raise SystemExit(f'server failed: {error}')
        self.win = Gtk.Window(title='chess check')
        self.win.set_default_size(1140, 860)
        self.view = WebKit2.WebView.new_with_context(arcade.web_context())
        self.view.load_uri(arcade.URL)
        trap = """
        window.__errors = [];
        addEventListener('error', e => window.__errors.push(
          (e.message || '?') + ' @' + (e.filename || '') + ':' + (e.lineno || 0)));
        addEventListener('unhandledrejection', e =>
          window.__errors.push('rejection: ' + ((e.reason && (e.reason.message || e.reason)) || e)));
        """
        self.view.get_user_content_manager().add_script(WebKit2.UserScript.new(
            trap, WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START))
        self.win.add(self.view)
        self.win.show_all()
        self.win.move(20, 20)
        self.view.connect('load-changed', self.on_load)
        self.view.connect('load-failed', self.on_failed)
        self.i = 0
        self.cur = {}
        self.said = []
        self.probes = {}
        self.eval_errors = []

    # -- plumbing --------------------------------------------------------
    def js(self, script, then=None):
        def done(_v, result, _d=None):
            raw = ''
            try:
                value = self.view.evaluate_javascript_finish(result)
                raw = value.to_string() if value else ''
            except Exception as exc:                                # noqa: BLE001
                raw = f'EVAL ERROR {exc}'
            if then:
                then(raw)
        self.view.evaluate_javascript(script, -1, None, None, None, done, None)

    def shot(self, name, then=None):
        """WebKit's own snapshot, not an X grab: `import -window` under a
        compositor can hand back a frame or two stale."""
        path = os.path.join(SHOTS, name + '.png')

        def done(view, result, _data=None):
            try:
                surface = view.get_snapshot_finish(result)
                surface.write_to_png(path)
                print('  shot', path)
            except Exception as exc:                                # noqa: BLE001
                print('  shot failed', name, exc)
            if then:
                then()

        try:
            self.view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,
                                   WebKit2.SnapshotOptions.NONE, None, done, None)
        except Exception as exc:                                    # noqa: BLE001
            print('  snapshot unavailable', exc)
            if then:
                then()

    def on_failed(self, _view, _event, uri, error):
        print('LOAD FAILED', uri, error.message if error else '')
        return True

    def on_load(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(500, self.next)

    # -- walk ------------------------------------------------------------
    def next(self):
        if self.i >= len(STEPS):
            Gtk.main_quit()
            return False
        self.cur = STEPS[self.i]
        self.i += 1
        print(f'[{self.cur["name"]}]')
        action = self.cur.get('js')
        if action:
            self.js(action, self.checked)
        else:
            GLib.timeout_add(self.cur.get('wait', 400), self.advance)
        return False

    def checked(self, raw):
        if raw.startswith('EVAL ERROR') or 'Error' in raw:
            print('  !!', raw)
            self.eval_errors.append(f'{self.cur["name"]}: {raw}')
        GLib.timeout_add(self.cur.get('wait', 400), self.advance)

    def advance(self):
        if self.cur.get('say'):
            self.js(STATUS, self.got_say)
        else:
            self.read_probe()

    def got_say(self, raw):
        try:
            value = json.loads(raw)
        except Exception:                                           # noqa: BLE001
            value = raw
        print('  state', value)
        self.said.append((self.cur['name'], value))
        self.read_probe()

    def read_probe(self):
        name = self.cur.get('probe')
        if not name:
            self.after_shot()
            return
        self.js(f'window.{name}', self.got_probe)   # already a JSON string

    def got_probe(self, raw):
        try:                                # window.__X holds a JSON string
            raw = json.loads(raw)
        except Exception:                   # noqa: BLE001
            pass
        self.probes[self.cur['name']] = raw
        print('  probe', str(raw)[:220])
        self.after_shot()

    def after_shot(self):
        if self.cur.get('shot'):
            self.shot(self.cur['shot'], self.next)
        else:
            self.next()


def main():
    walk = Walk()
    GLib.timeout_add_seconds(200, lambda: (print('TIMEOUT'), Gtk.main_quit(), False)[2])
    Gtk.main()
    walk.server.shutdown()

    print('\n--- perft ---')
    got = walk.probes.get('perft') or {}
    if not isinstance(got, dict):
        got = {}
    ok = bool(got)
    for name, expect in (('start', EXPECT_START), ('kiwi', EXPECT_KIWI)):
        good = got.get(name) == expect
        ok = ok and good
        print(f'  {name:5} {got.get(name)} {"ok" if good else "MISMATCH, want " + str(expect)}')

    print('\n--- hub ---')
    hub = walk.probes.get('hub again') or {}
    if not isinstance(hub, dict):
        hub = {}
    print(' ', hub)

    errors = walk.probes.get('errors') or []
    if not isinstance(errors, list):
        errors = [errors]
    print('\n--- errors ---')
    for line in errors:
        print(' ', line)
    for line in walk.eval_errors:
        print(' ', line)
    print('  screenshots in', SHOTS)

    mate = dict(walk.said).get('fool 4', {})
    mate_ok = 'checkmate' in str(mate.get('banner', '')).lower()
    verdict = ok and mate_ok and not errors and not walk.eval_errors and hub.get('cards') == 11
    print('\nVERDICT:', 'pass' if verdict else 'FAIL')
    return 0 if verdict else 1


if __name__ == '__main__':
    sys.exit(main())
