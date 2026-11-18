#!/usr/bin/python3
"""Smoke test for the Arcade desktop app.

Loads the real page through the real server and WebKit context, then:
  1. screenshots the hub and two games (real window pixels, not a browser)
  2. opens every game and fires ~24 random taps inside the board/panel, to
     catch exceptions in move handling and AI replies
  3. reports card count, localStorage round-trip, and every captured error

    /usr/bin/python3 probe.py            # full run
    /usr/bin/python3 probe.py --quick    # screenshots + one tap per game

Writes /tmp/arcade-probe/*.png and report.json.
"""
import json
import os
import subprocess
import sys
import time

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as arcade  # noqa: E402

SHOTS = '/tmp/arcade-probe'
os.makedirs(SHOTS, exist_ok=True)
TAPS = 4 if '--quick' in sys.argv else 24

ERROR_TRAP = r"""
window.__errors = [];
addEventListener('error', e => window.__errors.push('error: ' + (e.message || e)));
addEventListener('unhandledrejection',
  e => window.__errors.push('rejection: ' + ((e.reason && (e.reason.message || e.reason)) || e)));
"""

CHECK_JS = r"""
void (async () => {
  const out = { errors: (window.__errors || []).slice(), steps: [] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cards = [...document.querySelectorAll('.card')];
  out.cardCount = cards.length;
  out.cardNames = cards.map(c => (c.querySelector('h3') || {}).textContent || '?');
  out.title = document.title;

  try {                       // the win/loss record depends on this working
    localStorage.setItem('__probe', 'ok');
    out.storage = localStorage.getItem('__probe') === 'ok';
    localStorage.removeItem('__probe');
  } catch (e) { out.storage = false; out.storageError = String(e); }

  const pick = list => list[Math.floor(Math.random() * list.length)] || null;
  const selector = '.boardhost button, .panel button, .boardhost .cell, .boardhost .sq, ' +
                   '.boardhost .pit, .boardhost .col, .boardhost .pcard, .boardhost .store';

  for (let i = 0; i < cards.length; i++) {
    out.at = i + 1;                       // lets a timeout report the card it died on
    window.__probeLive = JSON.stringify(out);
    document.querySelectorAll('.card')[i].click();
    await sleep(280);
    const name = document.querySelector('.game-head h2')?.textContent || '?';
    const step = { game: name, taps: 0, noTargets: 0, view: document.body.dataset.view };
    for (let t = 0; t < %d; t++) {
      const targets = [...document.querySelectorAll(selector)]
        .filter(el => !el.disabled && el.offsetParent !== null);
      const el = pick(targets);
      if (el) { el.click(); step.taps++; } else { step.noTargets++; }
      await sleep(360);       // let the AI move land before the next tap
      if (document.body.dataset.view !== 'game') { step.leftGame = true; break; }
    }
    step.status = (document.querySelector('.turn-text') || {}).textContent || '';
    step.banner = !!document.querySelector('.banner');
    out.steps.push(step);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(140);
    if (document.body.dataset.view !== 'hub') step.escapeFailed = true;
  }
  out.audioCtor = typeof (window.AudioContext || window.webkitAudioContext);
  out.finalView = document.body.dataset.view;
  out.errors = (window.__errors || []).slice();
  window.__probe = JSON.stringify(out);
})();
""" % TAPS


class Probe:
    def __init__(self):
        self.server, error = arcade.start_server()
        if self.server is None:
            raise SystemExit(f'server failed: {error}')
        self.result = None
        self.tries = 0
        self.game_index = 0
        self.total = 9

        self.win = Gtk.Window(title='Arcade probe')
        self.win.set_default_size(1140, 860)
        self.view = WebKit2.WebView.new_with_context(arcade.web_context())
        self.view.load_uri(arcade.URL)
        manager = self.view.get_user_content_manager()
        manager.add_script(WebKit2.UserScript.new(
            ERROR_TRAP,
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START))
        self.win.add(self.view)
        self.win.show_all()
        self.win.move(20, 20)
        # an occluded WebView throttles setTimeout and stops rAF, which strands the
        # fuzz loop in a 240 s timeout and freezes anything that animates
        self.win.set_keep_above(True)
        self.win.present()
        self.view.connect('load-changed', self.on_load)
        self.view.connect('load-failed', self.on_failed)

    # -- plumbing --------------------------------------------------------
    def js(self, script, then=None):
        def done(_view, result, _data=None):
            raw, err = '', None
            try:
                value = self.view.evaluate_javascript_finish(result)
                raw = value.to_string() if value else ''
            except Exception as exc:                            # noqa: BLE001
                err = str(exc)
            if then:
                then(raw, err)
        self.view.evaluate_javascript(script, -1, None, None, None, done, None)

    def shot(self, name):
        path = os.path.join(SHOTS, name + '.png')
        gdk_window = self.win.get_window()
        if not gdk_window:
            print('no gdk window for', name)
            return
        try:
            subprocess.run(['import', '-window', str(gdk_window.get_xid()), path],
                           check=True, capture_output=True, timeout=20)
            print('shot', path)
        except Exception as exc:                                # noqa: BLE001
            print('shot failed', name, exc)

    def on_failed(self, _view, _event, uri, error):
        print('LOAD FAILED', uri, error.message if error else '')
        return True

    def on_load(self, _view, event):
        if event != WebKit2.LoadEvent.FINISHED:
            return
        # Wait for a real paint: capturing straight after FINISHED grabs a
        # blank compositor buffer.
        GLib.timeout_add(1400, self.step_hub)

    def step_hub(self):
        self.shot('hub')
        self.js("document.querySelectorAll('.card').length", self.got_count)
        return False

    def got_count(self, raw, err):
        try:
            self.total = int(raw)
        except (TypeError, ValueError):
            self.total = 9
        print('cards:', self.total)
        self.next_game()

    def next_game(self):
        """Open each game in turn, screenshot it, then leave the way a user does."""
        if self.game_index >= self.total:
            self.js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))")
            GLib.timeout_add(400, lambda: (self.run_checks(), False)[1])
            return
        index = self.game_index
        self.game_index += 1
        self.js(f"document.querySelectorAll('.card')[{index}].click()")

        def snap():
            self.shot(f'game-{self.game_index - 1}')
            self.js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))")
            GLib.timeout_add(300, lambda: (self.next_game(), False)[1])
            return False
        GLib.timeout_add(1500, snap)

    def run_checks(self):
        print('tapping through all games…')
        self.js(CHECK_JS, lambda raw, err: self.poll(raw, err))

    def poll(self, raw, err):
        if raw.startswith('{'):
            self.finish(raw)
            return
        if err:
            self.finish(f'EVAL ERROR {err}')
            return
        self.tries += 1
        if self.tries > 400:
            self.js('window.__probeLive', self.partial)
            return
        GLib.timeout_add(250, lambda: (self.js('window.__probe', self.poll), False)[1])

    def partial(self, raw):
        self.finish(raw or 'timeout, no partial report')

    def finish(self, raw):
        self.result = raw
        Gtk.main_quit()


def main():
    probe = Probe()
    GLib.timeout_add_seconds(420, lambda: (print('probe timed out'), Gtk.main_quit(), False)[2])
    Gtk.main()
    probe.server.shutdown()

    raw = probe.result or ''
    if not raw.startswith('{'):
        print('no report:', raw[:300])
        return 1
    report = json.loads(raw)
    with open(os.path.join(SHOTS, 'report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)

    print(json.dumps(report, indent=2))
    bad = [s for s in report['steps']
           if s.get('escapeFailed') or s.get('leftGame') or s.get('taps', 0) == 0]
    print('\nsummary: %d cards, storage=%s, errors=%d, problem steps=%d'
          % (report['cardCount'], report.get('storage'), len(report['errors']), len(bad)))
    for step in bad:
        print('  problem:', step)
    for line in report['errors']:
        print('  JS:', line)
    print('screenshots in', SHOTS)
    return 0 if not report['errors'] and not bad and report.get('storage') else 1


if __name__ == '__main__':
    sys.exit(main())
