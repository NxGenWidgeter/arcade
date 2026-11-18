#!/usr/bin/python3
"""Stickman Party check: real WebKit window, real key events, real screenshots.

    ARCADE_PORT=8799 DISPLAY=:0 /usr/bin/python3 stest.py

Two passes through the app's own WebView:

  1. assertions — open card ten from the hub, then drive each of the five duels
     with dispatched keydown/keyup events and force each win path (ring-out,
     anvil flatten, barrier stun and the finish line, both tug directions,
     quick-draw early and late). Finishes with a scripted three-round match so
     the match-end banner is exercised.
  2. screenshots — re-open the game and stage one frame per duel, plus the intro
     countdown and the finished match, using WebKit's own snapshot (an X grab
     under Cinnamon's compositor lags behind the real frame).

Time is advanced by hand through `window.__nxParty.step(ms)` rather than by
sleeping: WebKit stops requestAnimationFrame for an occluded window, which
stretches 1.8 s of game time into ten real seconds and makes every fixed sleep a
coin flip. `step()` runs exactly the frame the rAF loop runs.

Every snippet is wrapped in an IIFE: WebKit keeps one global lexical scope
across evaluate_javascript calls, so a second top-level `const` is a SyntaxError.
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

SHOTS = '/tmp/arcade-party'
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
  const out = { checks: [] };
  const check = (name, ok, detail) => {
    out.checks.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
  };
  const ev = (type, code) =>
    document.dispatchEvent(new KeyboardEvent(type, { code: code, key: code, bubbles: true }));
  const down = code => ev('keydown', code);
  const up = code => ev('keyup', code);
  const H = () => window.__nxParty;
  const phase = () => (H() ? H().phase : null);
  const scores = () => (H() ? H().scores : null);
  const paused = () => (H() ? H().paused : null);
  const resume = () => { const s = document.querySelector('.sp-stage'); if (s) s.click(); };

  // advance the real frame function by hand, 16 ms at a time
  const drive = ms => {
    resume();
    const n = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < n; i++) { const h = H(); if (h) h.step(16); }
  };
  const until = (fn, ms) => {
    const n = Math.max(1, Math.round((ms || 5000) / 16));
    for (let i = 0; i < n; i++) {
      resume();
      if (fn()) return true;
      const h = H(); if (h) h.step(16);
    }
    return !!fn();
  };
  const d = v => Math.round(v);

  // ---- 1. open it from the hub, the way a user does
  const cards = [...document.querySelectorAll('.card')];
  out.cardCount = cards.length;
  cards[cards.length - 1].click();
  await sleep(500);
  check('opens as the last card', document.body.dataset.view === 'game' &&
    !!document.querySelector('.sp-canvas'), out.cardCount);
  check('hud names both players',
    /P1/.test(document.querySelector('.sp-hud').textContent) &&
    /P2/.test(document.querySelector('.sp-hud').textContent));
  const startBtn = document.querySelector('.sp-card .btn.primary');
  check('start card present', !!startBtn);
  startBtn.click();
  until(() => phase() === 'intro', 2000);
  check('start begins a five-round match', phase() === 'intro' && H().rounds.length === 5,
    { phase: phase(), rounds: H().rounds });
  check('start card hidden', getComputedStyle(document.querySelector('.sp-veil')).display === 'none');

  // ---- 2. ring out: both control schemes move, contact scores
  H().start(['ring']);
  H().skip();
  until(() => phase() === 'play', 2000);
  check('ring out is playing', phase() === 'play', phase());
  const x0 = H().pl[0].x, x1 = H().pl[1].x;
  down('KeyD'); drive(420); up('KeyD');
  check('P1 runs right on D', H().pl[0].x > x0 + 8, [d(x0), d(H().pl[0].x)]);
  down('ArrowLeft'); drive(420); up('ArrowLeft');
  check('P2 runs left on the arrow', H().pl[1].x < x1 - 8, [d(x1), d(H().pl[1].x)]);
  H().pl[1].x = 760; H().pl[1].y = 218;
  until(() => phase() === 'result', 1000);
  check('a ring-out scores for P1', phase() === 'result' && scores().join() === '1,0',
    { phase: phase(), scores: scores(), note: H().note, paused: paused() });

  // ---- 3. anvils: the shadow kills whoever stands in it
  H().start(['rain']);
  H().skip();
  until(() => phase() === 'play', 2000);
  check('anvils is playing', phase() === 'play', phase());
  let drop = null;
  for (let i = 0; i < 200 && !drop; i++) {
    drop = H().inst().st.drops.filter(x => !x.done && x.t < 0.3)[0] || null;
    if (!drop) drive(16);
  }
  check('an anvil gets telegraphed', !!drop);
  if (drop) {
    const before = scores().join();
    [0, 1].forEach(i => {
      H().pl[i].x = drop.x; H().pl[i].y = drop.y;
      H().pl[i].vx = 0; H().pl[i].vy = 0;
    });
    until(() => phase() === 'result', 1500);
    check('one anvil flattens both', phase() === 'result' && scores().join() === before,
      { scores: scores(), note: H().note });
  }

  // ---- 4. the run: distance climbs, barriers stun, the line wins
  H().start(['race']);
  H().skip();
  until(() => phase() === 'play', 2000);
  const d0 = H().inst().st[0].dist;
  drive(320);
  check('the runner covers ground', H().inst().st[0].dist > d0 + 20,
    [d(d0), d(H().inst().st[0].dist)]);
  const p0 = H().pl[0];
  H().inst().st[0].obs.push({ cx: p0.x, y: p0.y, w: 60 });
  drive(40);
  check('a barrier stuns', H().inst().st[0].stun > 0, H().inst().st[0].stun);
  drive(900);
  H().inst().st[0].dist = 2600;
  until(() => phase() === 'result', 1000);
  check('first to the line wins', phase() === 'result' && scores()[0] === 1, scores());

  // ---- 5. tug of war: mashing drags the knot toward the masher
  H().start(['tug']);
  H().skip();
  until(() => phase() === 'play', 2000);
  const k0 = H().inst().st.knot;
  for (let i = 0; i < 6; i++) down('KeyW');
  drive(160);
  const k1 = H().inst().st.knot;
  check('P1 mashing drags the rope left', k1 < k0 - 10, [d(k0), d(k1)]);
  for (let i = 0; i < 80; i++) down('ArrowUp');
  until(() => phase() === 'result', 1000);
  check('P2 can haul it the other way', phase() === 'result' && scores().join() === '0,1',
    { scores: scores(), note: H().note });

  // ---- 6. quick draw: early loses, late wins
  H().start(['draw']);
  H().skip();
  until(() => phase() === 'play', 2000);
  down('KeyW');
  drive(40);
  check('an early press loses the round', phase() === 'result' && scores().join() === '0,1' &&
    /too early/.test(H().note), { scores: scores(), note: H().note });

  H().start(['draw']);
  H().skip();
  until(() => phase() === 'play', 2000);
  until(() => H().inst().st.lit, 5000);          // longest fuse is 3.3 s
  until(() => { down('ArrowUp'); return phase() === 'result'; }, 1000);
  check('the first key after the flare wins', scores().join() === '0,1' &&
    /quicker/.test(H().note), { scores: scores(), note: H().note });

  // ---- 7. a whole match: three rounds, the last one ends it with a banner
  H().start(['ring', 'ring', 'ring']);
  for (let i = 0; i < 3; i++) {
    until(() => phase() === 'intro', 1000);
    H().skip();
    until(() => phase() === 'play', 1000);
    H().pl[1].x = 760; H().pl[1].y = 218;
    until(() => phase() === 'result' || phase() === 'done', 1000);
    drive(1900);                                   // the round card
  }
  check('the last round ends the match', phase() === 'done', { phase: phase(), scores: scores() });
  const banner = document.querySelector('.banner strong');
  check('the match banner names a winner', !!banner && /takes the match/.test(banner.textContent),
    banner ? banner.textContent : null);
  check('the status line agrees', /wins the match/.test(
    document.querySelector('.turn-text').textContent));

  // ---- 8. restart, then leave the way Esc does
  document.querySelector('.sp-restart').click();
  until(() => phase() === 'intro', 1000);
  check('restart opens a fresh match', phase() === 'intro' && scores().join() === '0,0' &&
    H().rounds.length === 5, { phase: phase(), scores: scores(), rounds: H().rounds });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await sleep(400);
  check('escape returns to the hub', document.body.dataset.view === 'hub' &&
    document.querySelectorAll('.card').length === out.cardCount);

  await sleep(200);
  out.errors = (window.__errors || []).slice();
  window.__st = JSON.stringify(out);
})();
"""


def frames(count):
    return ("(() => { const H = window.__nxParty; "
            "const s = document.querySelector('.sp-stage'); if (s) s.click(); "
            f"for (let i = 0; i < {count}; i++) H.step(16); }})()")


# name, js, extra frames before the snapshot, shot
SHOT_STEPS = [
    ('back into the party',
     "(() => { const c = [...document.querySelectorAll('.card')]; c[c.length - 1].click(); })()",
     60, 'start-card'),
    ('countdown', "(() => { window.__nxParty.start(['ring']); })()", 6, 'intro'),
    ('ring out', "(() => { window.__nxParty.skip(); })()", 55, 'ring-out'),
    ('anvils', "(() => { window.__nxParty.start(['rain']); window.__nxParty.skip(); })()",
     78, 'anvils'),
    ('the run', "(() => { window.__nxParty.start(['race']); window.__nxParty.skip(); })()",
     85, 'run'),
    ('tug of war',
     "(() => { window.__nxParty.start(['tug']); window.__nxParty.skip();"
     "  for (let i = 0; i < 22; i++) document.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW'})); })()",
     14, 'tug'),
    ('quick draw',
     "(() => { window.__nxParty.start(['draw']); window.__nxParty.skip();"
     "  window.__nxParty.inst().st.at = 0.2; })()",
     40, 'quick-draw'),
    ('match end, round one',
     "(() => { window.__nxParty.start(['ring','ring']); window.__nxParty.skip();"
     "  window.__nxParty.pl[1].x = 760; })()",
     130, None),
    ('match end', "(() => { window.__nxParty.skip(); window.__nxParty.pl[1].x = 760; })()",
     130, 'match-end'),
]


class Party:
    def __init__(self):
        self.server, error = arcade.start_server()
        if self.server is None:
            raise SystemExit(f'server failed: {error}')
        self.win = Gtk.Window(title='stickman party check')
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
        self.win.set_keep_above(True)   # an occluded WebView stops painting and
        self.win.present()              # stops requestAnimationFrame entirely
        self.view.connect('load-changed', self.on_load)
        self.view.connect('load-failed', self.on_failed)
        self.result = None
        self.polls = 0
        self.step = 0
        self.eval_errors = []

    # -- plumbing --------------------------------------------------------
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
                print('  shot', path)
            except Exception as exc:                            # noqa: BLE001
                print('  shot failed', name, exc)
            if then:
                then()

        try:
            self.view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,
                                   WebKit2.SnapshotOptions.NONE, None, done, None)
        except Exception as exc:                                # noqa: BLE001
            print('  snapshot unavailable', exc)
            if then:
                then()

    def on_failed(self, _view, _event, uri, error):
        print('LOAD FAILED', uri, error.message if error else '')
        return True

    def on_load(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(1200, self.run_scenario)

    # -- 1. assertions ---------------------------------------------------
    def run_scenario(self):
        print('[scenario]')
        self.js(SCENARIO)
        GLib.timeout_add(400, self.poll)
        return False

    def poll(self):
        self.polls += 1
        if self.polls > 120:
            print('scenario timed out')
            Gtk.main_quit()
            return False
        self.js('window.__st', self.got)
        return False

    def got(self, raw):
        if raw.startswith('EVAL ERROR'):
            print('  !!', raw)
            self.eval_errors.append(raw)
            Gtk.main_quit()
            return
        if raw and raw.startswith('{'):
            self.result = raw
            GLib.timeout_add(200, self.next_shot)
            return
        GLib.timeout_add(250, self.poll)

    # -- 2. screenshots --------------------------------------------------
    def next_shot(self):
        if self.step >= len(SHOT_STEPS):
            Gtk.main_quit()
            return False
        name, js, extra, shot = SHOT_STEPS[self.step]
        self.step += 1
        print(f'[{name}]')
        script = js + ';' + frames(extra)
        self.js(script)
        GLib.timeout_add(260, lambda: self.after_shot(shot))
        return False

    def after_shot(self, shot):
        if shot:
            self.shot(shot, self.next_shot)
        else:
            self.next_shot()
        return False


def main():
    party = Party()
    GLib.timeout_add_seconds(180, lambda: (print('TIMEOUT'), Gtk.main_quit(), False)[2])
    Gtk.main()
    party.server.shutdown()

    raw = party.result or ''
    if not raw.startswith('{'):
        print('no report:', raw[:300])
        return 1
    report = json.loads(raw)
    with open(os.path.join(SHOTS, 'report.json'), 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)

    bad = [c for c in report['checks'] if not c['ok']]
    for c in report['checks']:
        print(('  ok   ' if c['ok'] else '  FAIL ') + c['name'] +
              ('' if c['ok'] else '  ' + str(c['detail'])))
    print('\nchecks: %d, failed: %d, errors: %d' %
          (len(report['checks']), len(bad), len(report.get('errors') or [])))
    for line in report.get('errors') or []:
        print('  JS:', line)
    for line in party.eval_errors:
        print('  eval:', line)
    print('screenshots in', SHOTS)
    verdict = not bad and not report.get('errors') and not party.eval_errors
    print('\nVERDICT:', 'pass' if verdict else 'FAIL')
    return 0 if verdict else 1


if __name__ == '__main__':
    sys.exit(main())
