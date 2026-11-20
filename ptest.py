#!/usr/bin/python3
"""Card-game check: poker's hand ranking and full hand, blackjack's rollback.

    ARCADE_PORT=8797 DISPLAY=:0 /usr/bin/python3 ptest.py

Through the app's own WebView, like the other harnesses:

  1. the hand evaluator against known hands (straight flush, quads, full house,
     flush, the wheel, two pair and kickers, ace high),
  2. a whole hold'em hand played passively to showdown, with a rollback in the
     middle of the preflop betting and a check that chips are conserved,
  3. blackjack: deal, stand, let the dealer finish, then Undo — the hand comes
     back to the decision point and the record entry it added goes away.

Every snippet is wrapped in an IIFE (WebKit keeps one global lexical scope
across evaluate_javascript calls).
"""
import json
import os
import sys

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as arcade  # noqa: E402

SHOTS = '/tmp/arcade-cards'
os.makedirs(SHOTS, exist_ok=True)

TRAP = """
window.__errors = [];
addEventListener('error', e => window.__errors.push(
  (e.message || '?') + ' @' + (e.filename || '') + ':' + (e.lineno || 0)));
addEventListener('unhandledrejection', e =>
  window.__errors.push('rejection: ' + ((e.reason && (e.reason.message || e.reason)) || e)));
"""

SCENARIO = r"""
void (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // WebKit freezes the CSS animation clock in an occluded harness window, and a
  // .pcard enters with `animation: dealin .26s backwards` — from opacity 0. Left
  // alone, every snapshot shows a table with no cards on it. Zero the clocks so
  // the settled frame is what gets captured.
  const killAnim = document.createElement('style');
  killAnim.textContent = '*,*::before,*::after{animation-duration:0s!important;' +
    'animation-delay:0s!important;transition-duration:0s!important}';
  document.head.appendChild(killAnim);
  const out = { checks: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
  };
  const cards = [...document.querySelectorAll('.card')];
  out.cardCount = cards.length;
  check('the hub shows eleven cards', cards.length === 11, cards.length);

  // ---- 1. poker: the evaluator
  cards[9].click();
  await sleep(500);
  const P = window.__nxPoker;
  check('poker opens from card ten', !!P && document.body.dataset.view === 'game' &&
    !!document.querySelector('.pk .bjbar'), document.body.dataset.game);
  const C = (r, s) => ({ r: r, s: s });
  if (P) {
    const sf = P.rank([C(9, 1), C(10, 1), C(11, 1), C(12, 1), C(13, 1), C(2, 0), C(3, 0)]);
    check('straight flush is the top hand', sf[0] === 8 && sf[1] === 13, sf);
    const quads = P.rank([C(7, 0), C(7, 1), C(7, 2), C(7, 3), C(2, 0), C(13, 1), C(4, 2)]);
    check('four of a kind', quads[0] === 7 && quads[1] === 7, quads);
    const fh = P.rank([C(5, 0), C(5, 1), C(5, 2), C(9, 0), C(9, 1), C(2, 2), C(3, 3)]);
    check('full house picks the right trips', fh[0] === 6 && fh[1] === 5 && fh[2] === 9, fh);
    const fl = P.rank([C(2, 3), C(5, 3), C(9, 3), C(11, 3), C(13, 3), C(3, 0), C(4, 1)]);
    check('flush outranks a straight', fl[0] === 5 && fl[1] === 13, fl);
    const wheel = P.rank([C(1, 0), C(2, 1), C(3, 2), C(4, 3), C(5, 0), C(9, 0), C(11, 0)]);
    check('A-2-3-4-5 is a five-high straight', wheel[0] === 4 && wheel[1] === 5, wheel);
    const two = P.rank([C(4, 0), C(4, 1), C(11, 2), C(11, 3), C(2, 0), C(13, 1), C(3, 2)]);
    check('two pair ranks high pair first', two[0] === 2 && two[1] === 11 && two[2] === 4, two);
    const better = P.rank([C(4, 0), C(4, 1), C(11, 2), C(11, 3), C(13, 0), C(13, 1), C(3, 2)]);
    check('a better kicker wins the tie', P.cmp(better, two) > 0, [better, two]);
    check('aces are high', P.cmp(
      P.rank([C(1, 0), C(9, 1), C(7, 2), C(4, 3), C(2, 0), C(11, 1), C(3, 2)]),
      P.rank([C(13, 0), C(9, 2), C(7, 1), C(4, 2), C(2, 1), C(11, 2), C(3, 1)])) > 0);

    // ---- 2. poker: deal, roll back, play the hand out
    P.setBank([500, 500]);
    await sleep(60);
    const dealBtn = [...document.querySelectorAll('.pk .bjbar .btn')]
      .find(b => /Deal|Next hand/.test(b.textContent));
    check('a deal button is on the table', !!dealBtn);
    dealBtn.click();
    await sleep(150);
    let s = P.state;
    check('blinds go in before the cards', s.pot === 30 && s.bets.join() === '10,20',
      { pot: s.pot, bets: s.bets });
    check('two hole cards each, empty board', s.hole[0].length === 2 &&
      s.hole[1].length === 2 && s.board.length === 0, { hole: s.hole, board: s.board });
    check('the small blind acts first preflop', s.toAct === 0, { toAct: s.toAct, button: s.button });

    P.human('call');
    await sleep(80);
    check('a call moves the chips in', P.state.pot === 40, P.state.pot);
    P.undo();
    await sleep(80);
    s = P.state;
    check('undo gives the chips back', s.pot === 30 && s.bets.join() === '10,20',
      { pot: s.pot, bets: s.bets, phase: s.phase });

    let guard = 0;
    while (!P.state.over && guard++ < 40) {
      s = P.state;
      if (s.phase !== 'play') break;
      const top = Math.max(s.bets[0], s.bets[1]);
      if (s.toAct === 1) P.aiStep(s.bets[1] < top ? 'call' : 'check');
      else if (s.toAct === 0) P.human(s.bets[0] < top ? 'call' : 'check');
      await sleep(20);
    }
    s = P.state;
    check('the hand reaches a result', s.over === true && s.phase === 'done', s.phase);
    check('five community cards by the river', s.board.length === 5, s.board.length);
    check('both hands are face up at the end', s.shown[0] && s.shown[1], s.shown);
    check('the pot went to somebody', s.bank[0] + s.bank[1] === 1000,
      { bank: s.bank, pot: s.pot });
    out.handLine = document.querySelector('.pk .msg') ? document.querySelector('.pk .msg').textContent : '';
    check('the result line names the winner', /win|Split|fold/i.test(out.handLine), out.handLine);

    // ---- 3. blackjack: undo a settled hand
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(350);
    check('escape still returns to the hub', document.body.dataset.view === 'hub');
    [...document.querySelectorAll('.card')][7].click();
    await sleep(450);
    const bjUndo = document.querySelector('.game .panel .row .btn');
    check('blackjack offers an Undo button', !!bjUndo && !bjUndo.disabled &&
      /undo/i.test(bjUndo.textContent), bjUndo ? bjUndo.textContent : null);
    const dealBJ = document.querySelector('.bj .bjbar .btn.primary');
    check('blackjack deals', !!dealBJ);
    dealBJ.click();
    await sleep(200);
    const handBefore = document.querySelectorAll('.bj .hand .pcard').length;
    const chipsBefore = parseInt(document.querySelector('.bj .bank b').textContent, 10);
    const recBefore = document.querySelector('.game .record b').textContent;
    const standBtn = [...document.querySelectorAll('.bj .bjbar .btn')]
      .find(b => /Stand/.test(b.textContent));
    check('a stand button is on the table', !!standBtn);
    standBtn.click();
    await sleep(3200);
    const settledBar = [...document.querySelectorAll('.bj .bjbar .btn')]
      .map(b => b.textContent).join('|');
    check('standing settles the hand', /Next hand/.test(settledBar), settledBar);
    const recAfter = document.querySelector('.game .record b').textContent;
    bjUndo.click();
    await sleep(250);
    const afterBar = [...document.querySelectorAll('.bj .bjbar .btn')]
      .map(b => b.textContent).join('|');
    check('undo puts the decision back', /Hit/.test(afterBar) && /Stand/.test(afterBar), afterBar);
    check('undo puts the hand back', document.querySelectorAll('.bj .hand .pcard').length ===
      handBefore, [handBefore, document.querySelectorAll('.bj .hand .pcard').length]);
    check('undo puts the chips back',
      parseInt(document.querySelector('.bj .bank b').textContent, 10) === chipsBefore,
      [chipsBefore, document.querySelector('.bj .bank b').textContent]);
    check('undo takes back the record entry',
      document.querySelector('.game .record b').textContent === recBefore,
      [recBefore, recAfter, document.querySelector('.game .record b').textContent]);
  }

  await sleep(150);
  out.errors = (window.__errors || []).slice();
  window.__pt = JSON.stringify(out);
})();
"""

SHOT_STEPS = [
    ('poker table', """(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const c = [...document.querySelectorAll('.card')];
      if (c[9]) c[9].click();
    })()""", 'poker-deal'),
    ('preflop', """(() => {
      const P = window.__nxPoker; P.setBank([480, 520]);
      const b = [...document.querySelectorAll('.pk .bjbar .btn')].find(x => /Deal/.test(x.textContent));
      if (b) b.click();
    })()""", 'poker-preflop'),
    ('river showdown', """(() => {
      const P = window.__nxPoker;
      let guard = 0;
      while (!P.state.over && guard++ < 40) {
        const s = P.state;
        if (s.phase !== 'play') break;
        const top = Math.max(s.bets[0], s.bets[1]);
        if (s.toAct === 1) P.aiStep(s.bets[1] < top ? 'call' : 'check');
        else if (s.toAct === 0) P.human(s.bets[0] < top ? 'call' : 'check');
      }
    })()""", 'poker-showdown'),
]


class Harness:
    def __init__(self):
        self.server, error = arcade.start_server()
        if self.server is None:
            raise SystemExit(f'server failed: {error}')
        self.win = Gtk.Window(title='card check')
        self.win.set_default_size(1140, 860)
        self.view = WebKit2.WebView.new_with_context(arcade.web_context())
        self.view.load_uri(arcade.URL)
        manager = self.view.get_user_content_manager()
        manager.add_script(WebKit2.UserScript.new(
            TRAP, WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START))
        self.win.add(self.view)
        self.win.show_all()
        self.win.move(20, 20)
        self.win.set_keep_above(True)
        self.win.present()
        self.view.connect('load-changed', self.on_load)
        self.result = None
        self.polls = 0
        self.step = 0
        self.eval_errors = []

    def js(self, script, then=None):
        def done(_view, result, _data=None):
            raw = ''
            try:
                value = self.view.evaluate_javascript_finish(result)
                raw = value.to_string() if value else ''
            except Exception as exc:                            # noqa: BLE001
                raw = f'EVAL ERROR {exc}'
            if then:
                then(raw)
        self.view.evaluate_javascript(script, -1, None, None, None, done, None)

    def shot(self, name, then=None):
        path = os.path.join(SHOTS, name + '.png')

        def done(view, result, _data=None):
            try:
                surface = view.get_snapshot_finish(result)
                surface.write_to_png(path)
                print('  shot', path, flush=True)
            except Exception as exc:                            # noqa: BLE001
                print('  shot failed', name, exc, flush=True)
            if then:
                then()

        self.view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,
                               WebKit2.SnapshotOptions.NONE, None, done, None)

    def on_load(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(1200, self.scenario)

    def scenario(self):
        print('[cards]', flush=True)
        self.js(SCENARIO)
        GLib.timeout_add(400, self.poll)
        return False

    def poll(self):
        self.polls += 1
        if self.polls > 160:
            print('scenario timed out', flush=True)
            Gtk.main_quit()
            return False
        self.js('window.__pt', self.got)
        return False

    def got(self, raw):
        if raw.startswith('EVAL ERROR'):
            print('  !!', raw, flush=True)
            self.eval_errors.append(raw)
            Gtk.main_quit()
            return
        if raw and raw.startswith('{'):
            self.result = raw
            GLib.timeout_add(200, self.next_shot)
            return
        GLib.timeout_add(250, self.poll)

    def next_shot(self):
        if self.step >= len(SHOT_STEPS):
            Gtk.main_quit()
            return False
        name, js, shot = SHOT_STEPS[self.step]
        self.step += 1
        print(f'[{name}]', flush=True)
        self.js(js)
        GLib.timeout_add(700, lambda: self.after_shot(shot))
        return False

    def after_shot(self, shot):
        if shot:
            self.shot(shot, self.next_shot)
        else:
            self.next_shot()
        return False


def main():
    h = Harness()
    GLib.timeout_add_seconds(150, lambda: (print('TIMEOUT', flush=True), Gtk.main_quit(), False)[2])
    Gtk.main()
    h.server.shutdown()

    raw = h.result or ''
    if not raw.startswith('{'):
        print('no report:', raw[:300])
        return 1
    report = json.loads(raw)
    with open(os.path.join(SHOTS, 'report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=2)
    bad = [c for c in report['checks'] if not c['ok']]
    for c in report['checks']:
        print(('  ok   ' if c['ok'] else '  FAIL ') + c['name'] +
              ('' if c['ok'] else '  ' + str(c['detail'])))
    print('\nchecks: %d, failed: %d, errors: %d' %
          (len(report['checks']), len(bad), len(report.get('errors') or [])))
    for line in report.get('errors') or []:
        print('  JS:', line)
    for line in h.eval_errors:
        print('  eval:', line)
    print('screenshots in', SHOTS)
    verdict = not bad and not report.get('errors') and not h.eval_errors
    print('\nVERDICT:', 'pass' if verdict else 'FAIL')
    return 0 if verdict else 1


if __name__ == '__main__':
    sys.exit(main())
