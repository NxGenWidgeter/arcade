'use strict';
/* ============================================================
   NxGen Arcade — eleven games, entirely offline.
   No dependencies, no network, no build step.
   ============================================================ */
(() => {

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const now = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => (Math.random() * n) | 0;
const pick = a => a[rnd(a.length)];
const aiDelay = () => sleep(150 + rnd(170));

const DIFF_NAMES = ['Easy', 'Steady', 'Ruthless'];
const BUDGET = [200, 520, 950];

/* ---------------- persistence ---------------- */
const KEY = 'nxgen.arcade.v1';
const DEFAULTS = { mute: false, diff: 1, mode: 'ai', scores: {} };
let store = JSON.parse(JSON.stringify(DEFAULTS));
try {
  const raw = localStorage.getItem(KEY);
  if (raw) store = Object.assign({}, DEFAULTS, JSON.parse(raw));
} catch (e) { /* file:// with storage disabled — game still works, just forgets */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
function record(id, res) {
  const s = store.scores[id] || (store.scores[id] = { w: 0, l: 0, d: 0 });
  s[res] = (s[res] || 0) + 1;
  save();
}
function recText(id) {
  const s = store.scores[id];
  if (!s || (!s.w && !s.l && !s.d)) return 'no games played';
  return `${s.w || 0}W · ${s.l || 0}L · ${s.d || 0}D`;
}

/* ---------------- sound (synthesised, no files) ---------------- */
const Sound = (() => {
  let ac = null;
  const ctxA = () => {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ac = new C(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };
  function tone(freq, dur = .12, type = 'sine', gain = .05, delay = 0, slideTo = 0) {
    if (store.mute) return;
    const c = ctxA(); if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + .03);
  }
  function noise(dur = .1, gain = .05) {
    if (store.mute) return;
    const c = ctxA(); if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 950; f.Q.value = .7;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }
  return {
    click() { tone(540, .045, 'triangle', .02); },
    place() { tone(330, .1, 'sine', .05, 0, 190); },
    drop() { tone(155, .16, 'sine', .075, 0, 78); noise(.06, .017); },
    flip() { tone(700, .065, 'triangle', .028, 0, 1150); },
    chip() { tone(430, .05, 'square', .016, 0, 300); noise(.045, .012); },
    capture() { noise(.14, .05); tone(132, .17, 'sawtooth', .038, 0, 62); },
    pass() { tone(300, .1, 'sine', .028, 0, 240); },
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, .34, 'sine', .05, i * .085)); },
    lose() { [392, 329.63, 261.63].forEach((f, i) => tone(f, .38, 'sine', .042, i * .11)); },
    draw() { [440, 415.3].forEach((f, i) => tone(f, .3, 'sine', .032, i * .13)); }
  };
})();

/* ============================================================
   1. TIC-TAC-TOE
   ============================================================ */
const ticTacToe = {
  id: 'xo',
  name: 'Tic-Tac-Toe',
  tag: 'the warm-up',
  blurb: 'Nine squares and no luck. Take the centre and you never lose.',
  rules: 'Three in a row wins. Perfect play always draws — so the wins live in Easy.',
  mount(ctx) {
    const mode = ctx.mode, diff = ctx.diff, HUMAN = 'X', AI = 'O';
    let b = Array(9).fill(null), turn = HUMAN, over = false, hist = [];
    const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

    const board = mk('div', 'board xo');
    ctx.boardEl.appendChild(board);
    const cells = [];
    for (let i = 0; i < 9; i++) {
      const c = mk('button', 'cell'); c.type = 'button';
      c.setAttribute('aria-label', 'square ' + (i + 1));
      c.addEventListener('click', () => play(i));
      board.appendChild(c); cells.push(c);
    }

    const humanTurn = () => mode === 'two' || turn === HUMAN;
    function winner(bd) {
      for (const w of WINS) {
        const [x, y, z] = w;
        if (bd[x] && bd[x] === bd[y] && bd[x] === bd[z]) return { who: bd[x], line: w };
      }
      return bd.includes(null) ? null : { who: null, line: null };
    }
    function render() {
      for (let i = 0; i < 9; i++) {
        const v = b[i];
        cells[i].textContent = v || '';
        cells[i].className = 'cell' + (v === 'X' ? ' x' : v === 'O' ? ' o' : '');
      }
    }
    function sync() {
      if (over) return;
      if (mode === 'two') ctx.setStatus((turn === 'X' ? 'Crosses' : 'Noughts') + ' to move', 'you');
      else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
    }
    function finish(w) {
      over = true;
      if (w.line) w.line.forEach(i => cells[i].classList.add('win'));
      if (!w.who) { ctx.setStatus('Draw', 'draw'); Sound.draw(); ctx.end('d', 'Draw — nobody cracked it'); }
      else if (mode === 'two') {
        const n = w.who === 'X' ? 'Crosses' : 'Noughts';
        ctx.setStatus(n + ' win', 'win'); Sound.win(); ctx.end(null, n + ' win');
      } else if (w.who === HUMAN) { ctx.setStatus('You win', 'win'); Sound.win(); ctx.end('w', 'You win'); }
      else { ctx.setStatus('Talia wins', 'lose'); Sound.lose(); ctx.end('l', 'Talia wins'); }
    }
    function play(i) {
      if (over || b[i] || !humanTurn()) return;
      hist.push({ b: b.slice(), turn });
      b[i] = turn; Sound.place(); render();
      const w = winner(b);
      if (w) return finish(w);
      turn = turn === 'X' ? 'O' : 'X'; render(); sync();
      if (mode === 'ai' && turn === AI) think();
    }
    async function think() {
      await aiDelay();
      if (!ctx.alive() || over) return;
      hist.push({ b: b.slice(), turn });
      b[bestFor('O')] = AI; Sound.place(); render();
      const w = winner(b);
      if (w) return finish(w);
      turn = HUMAN; render(); sync();
    }
    function mini(bd, t, me, d) {
      const w = winner(bd);
      if (w) { if (!w.who) return 0; return w.who === me ? 10 - d : d - 10; }
      let best = t === me ? -99 : 99;
      for (let i = 0; i < 9; i++) {
        if (bd[i]) continue;
        bd[i] = t;
        const s = mini(bd, t === 'X' ? 'O' : 'X', me, d + 1);
        bd[i] = null;
        best = t === me ? Math.max(best, s) : Math.min(best, s);
      }
      return best;
    }
    function bestFor(me) {
      const empties = [];
      for (let i = 0; i < 9; i++) if (!b[i]) empties.push(i);
      const sloppy = diff === 0 ? .55 : diff === 1 ? .15 : 0;
      if (Math.random() < sloppy) return pick(empties);
      let bs = -99, bm = [];
      for (const i of empties) {
        b[i] = me;
        const s = mini(b, me === 'X' ? 'O' : 'X', me, 1);
        b[i] = null;
        if (s > bs) { bs = s; bm = [i]; } else if (s === bs) bm.push(i);
      }
      return pick(bm);
    }
    function undo() {
      if (!hist.length) return;
      over = false; ctx.clearBanner();
      let s = hist.pop();
      while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
      b = s.b; turn = s.turn; render(); sync();
    }
    function hint() {
      if (over || !humanTurn()) return;
      const bd = b.slice();
      let bs = -99, bm = -1;
      for (let i = 0; i < 9; i++) {
        if (bd[i]) continue;
        bd[i] = HUMAN;
        const s = mini(bd, AI, HUMAN, 1);
        bd[i] = null;
        if (s > bs) { bs = s; bm = i; }
      }
      cells[bm].classList.add('hint');
      setTimeout(() => cells[bm] && cells[bm].classList.remove('hint'), 2000);
      Sound.click();
    }
    render(); sync();
    return { undo, hint };
  }
};

/* ============================================================
   2. CONNECT FOUR
   ============================================================ */
const connectFour = (() => {
  const R = 6, C = 7;
  const ORDER = [3, 2, 4, 1, 5, 0, 6];
  const WINDOWS = (() => {
    const w = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (c + 3 < C) w.push([0,1,2,3].map(k => r * C + c + k));
      if (r + 3 < R) w.push([0,1,2,3].map(k => (r + k) * C + c));
      if (r + 3 < R && c + 3 < C) w.push([0,1,2,3].map(k => (r + k) * C + c + k));
      if (r + 3 < R && c - 3 >= 0) w.push([0,1,2,3].map(k => (r + k) * C + c - k));
    }
    return w;
  })();

  const other = s => (s === 1 ? 2 : 1);
  const dropRow = (bd, c) => { for (let r = R - 1; r >= 0; r--) if (!bd[r * C + c]) return r; return -1; };
  const isFull = bd => { for (let i = 0; i < R * C; i++) if (!bd[i]) return false; return true; };

  function fourAt(bd, r, c, who) {
    for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
      const line = [[r, c]];
      for (const sg of [1, -1]) {
        let rr = r + dr * sg, cc = c + dc * sg;
        while (rr >= 0 && rr < R && cc >= 0 && cc < C && bd[rr * C + cc] === who) {
          line.push([rr, cc]); rr += dr * sg; cc += dc * sg;
        }
      }
      if (line.length >= 4) return line;
    }
    return null;
  }
  function evaluate(bd, me) {
    const opp = other(me);
    let s = 0;
    for (let r = 0; r < R; r++) {
      const v = bd[r * C + 3];
      if (v === me) s += 4; else if (v === opp) s -= 4;
    }
    for (const w of WINDOWS) {
      let a = 0, o = 0;
      for (const i of w) { const v = bd[i]; if (v === me) a++; else if (v === opp) o++; }
      if (a && o) continue;
      if (a === 3) s += 62; else if (a === 2) s += 9; else if (a === 1) s += 1;
      else if (o === 3) s -= 76; else if (o === 2) s -= 10; else if (o === 1) s -= 1;
    }
    return s;
  }
  let aborted = false;
  function neg(bd, side, depth, alpha, beta, dl) {
    if (now() > dl) { aborted = true; return 0; }
    if (depth === 0) return evaluate(bd, side);
    let best = -1e9;
    for (const c of ORDER) {
      const r = dropRow(bd, c); if (r < 0) continue;
      bd[r * C + c] = side;
      let sc;
      if (fourAt(bd, r, c, side)) sc = 1e6 + depth * 1000;
      else if (isFull(bd)) sc = 0;
      else sc = -neg(bd, other(side), depth - 1, -beta, -alpha, dl);
      bd[r * C + c] = 0;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function root(bd, side, depth, dl) {
    let best = -1e9, moves = [], alpha = -1e9;
    for (const c of ORDER) {
      const r = dropRow(bd, c); if (r < 0) continue;
      bd[r * C + c] = side;
      let sc;
      if (fourAt(bd, r, c, side)) sc = 1e6 + depth * 1000;
      else if (isFull(bd)) sc = 0;
      else sc = -neg(bd, other(side), depth - 1, -1e9, -alpha, dl);
      bd[r * C + c] = 0;
      if (aborted) break;
      if (sc > best) { best = sc; moves = [c]; } else if (sc === best) moves.push(c);
      if (sc > alpha) alpha = sc;
    }
    return { best, moves };
  }
  function choose(bd, side, maxDepth, budget) {
    const dl = now() + budget;
    aborted = false;
    let moves = [];
    for (let d = 2; d <= maxDepth; d += 2) {
      const r = root(bd, side, d, dl);
      if (aborted) break;
      if (r.moves.length) moves = r.moves;
      if (r.best > 5e5 || r.best < -5e5) break;
      if (now() > dl) break;
    }
    if (!moves.length) {
      for (const c of ORDER) if (dropRow(bd, c) >= 0) moves.push(c);
    }
    return pick(moves);
  }

  return {
    id: 'c4',
    name: 'Connect Four',
    tag: 'gravity',
    blurb: 'Seven columns, six rows. Build a diagonal nobody sees coming.',
    rules: 'Click a column to drop. Four in a line — across, down or diagonal — wins.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = 1, AI = 2;
      let b = new Int8Array(R * C), turn = HUMAN, over = false, hist = [];
      const board = mk('div', 'board c4');
      ctx.boardEl.appendChild(board);
      const cells = [];
      for (let i = 0; i < R * C; i++) {
        const c = mk('button', 'cell'); c.type = 'button';
        c.setAttribute('aria-label', 'column ' + (i % C + 1));
        c.addEventListener('click', () => play(i % C));
        board.appendChild(c); cells.push(c);
      }
      const humanTurn = () => mode === 'two' || turn === HUMAN;

      function render(animateIdx) {
        for (let i = 0; i < R * C; i++) {
          const v = b[i], cell = cells[i];
          if (cell.firstChild) cell.removeChild(cell.firstChild);
          if (v) {
            const d = mk('div', 'disc p' + v);
            if (i === animateIdx) d.classList.add('drop');
            cell.appendChild(d);
          }
        }
      }
      function sync() {
        if (over) return;
        if (mode === 'two') ctx.setStatus(turn === HUMAN ? 'Gold to move' : 'Clay to move', 'you');
        else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
      }
      function finish(line, side) {
        over = true;
        line.forEach(([r, c]) => {
          const d = cells[r * C + c].firstChild;
          if (d) d.classList.add('win');
        });
        if (mode === 'two') {
          const n = side === HUMAN ? 'Gold' : 'Clay';
          ctx.setStatus(n + ' wins', 'win'); Sound.win(); ctx.end(null, n + ' wins');
        } else if (side === HUMAN) { ctx.setStatus('You win', 'win'); Sound.win(); ctx.end('w', 'You win'); }
        else { ctx.setStatus('Talia wins', 'lose'); Sound.lose(); ctx.end('l', 'Talia wins'); }
      }
      function play(c) {
        if (over || !humanTurn()) return;
        const r = dropRow(b, c); if (r < 0) return;
        hist.push({ b: Int8Array.from(b), turn });
        b[r * C + c] = turn; Sound.drop(); render(r * C + c);
        const line = fourAt(b, r, c, turn);
        if (line) return finish(line, turn);
        if (isFull(b)) { over = true; ctx.setStatus('Draw', 'draw'); Sound.draw(); ctx.end('d', 'Board full — a draw'); return; }
        turn = other(turn); render(); sync();
        if (mode === 'ai' && turn === AI) think();
      }
      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        const depths = [4, 6, 8];
        const c = choose(b, AI, depths[diff], BUDGET[diff]);
        const r = dropRow(b, c);
        if (r < 0) return;
        hist.push({ b: Int8Array.from(b), turn });
        b[r * C + c] = AI; Sound.drop(); render(r * C + c);
        const line = fourAt(b, r, c, AI);
        if (line) return finish(line, AI);
        if (isFull(b)) { over = true; ctx.setStatus('Draw', 'draw'); Sound.draw(); ctx.end('d', 'Board full — a draw'); return; }
        turn = HUMAN; render(); sync();
      }
      function undo() {
        if (!hist.length) return;
        over = false; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        b = Int8Array.from(s.b); turn = s.turn; render(); sync();
      }
      function hint() {
        if (over || !humanTurn()) return;
        const c = choose(Int8Array.from(b), HUMAN, 4, 220);
        const r = dropRow(b, c);
        if (r >= 0) {
          cells[r * C + c].classList.add('hint');
          setTimeout(() => cells[r * C + c].classList.remove('hint'), 2000);
        }
        Sound.click();
      }
      render(); sync();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   3. REVERSI
   ============================================================ */
const reversi = (() => {
  const N = 64;
  const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const WEIGHTS = [
     120, -20,  20,   5,   5,  20, -20, 120,
     -20, -40,  -5,  -5,  -5,  -5, -40, -20,
      20,  -5,  15,   3,   3,  15,  -5,  20,
       5,  -5,   3,   3,   3,   3,  -5,   5,
       5,  -5,   3,   3,   3,   3,  -5,   5,
      20,  -5,  15,   3,   3,  15,  -5,  20,
     -20, -40,  -5,  -5,  -5,  -5, -40, -20,
     120, -20,  20,   5,   5,  20, -20, 120
  ];

  function legal(bd, side) {
    const moves = [];
    for (let i = 0; i < N; i++) {
      if (bd[i]) continue;
      const r = (i / 8) | 0, c = i % 8;
      const flips = [];
      for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc;
        const line = [];
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && bd[rr * 8 + cc] === -side) {
          line.push(rr * 8 + cc); rr += dr; cc += dc;
        }
        if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && bd[rr * 8 + cc] === side) {
          for (const f of line) flips.push(f);
        }
      }
      if (flips.length) moves.push({ i, flips });
    }
    return moves;
  }
  function evaluate(bd, side) {
    let s = 0, mine = 0, theirs = 0;
    for (let i = 0; i < N; i++) {
      const v = bd[i];
      s += v * WEIGHTS[i];
      if (v === side) mine++; else if (v === -side) theirs++;
    }
    const mob = legal(bd, side).length - legal(bd, -side).length;
    return s * side + mob * 7 + (mine - theirs) * .8;
  }
  let aborted = false;
  function neg(bd, side, depth, alpha, beta, dl) {
    if (now() > dl) { aborted = true; return 0; }
    const moves = legal(bd, side);
    if (!moves.length) {
      if (!legal(bd, -side).length) {
        let diff = 0;
        for (let i = 0; i < N; i++) diff += bd[i];
        return diff * side * 900;
      }
      return -neg(bd, -side, depth, -beta, -alpha, dl);
    }
    if (depth === 0) return evaluate(bd, side);
    moves.sort((a, b) => (b.flips.length && WEIGHTS[b.i] - WEIGHTS[a.i]) || b.flips.length - a.flips.length);
    let best = -1e9;
    for (const mv of moves) {
      const nb = Int8Array.from(bd);
      nb[mv.i] = side;
      for (const f of mv.flips) nb[f] = side;
      const sc = -neg(nb, -side, depth - 1, -beta, -alpha, dl);
      if (aborted) return best === -1e9 ? 0 : best;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function choose(bd, side, maxDepth, budget) {
    const dl = now() + budget;
    aborted = false;
    let bestMove = null;
    for (let d = 1; d <= maxDepth; d++) {
      let best = -1e9, bm = [];
      const moves = legal(bd, side);
      if (!moves.length) return null;
      moves.sort((a, b) => WEIGHTS[b.i] - WEIGHTS[a.i]);
      for (const mv of moves) {
        const nb = Int8Array.from(bd);
        nb[mv.i] = side;
        for (const f of mv.flips) nb[f] = side;
        const sc = -neg(nb, -side, d - 1, -1e9, -best, dl);
        if (aborted) break;
        if (sc > best) { best = sc; bm = [mv.i]; } else if (sc === best) bm.push(mv.i);
      }
      if (bm.length) bestMove = pick(bm);
      if (aborted || now() > dl) break;
    }
    if (bestMove == null) {
      const mv = legal(bd, side);
      bestMove = mv.length ? pick(mv).i : null;
    }
    return bestMove;
  }

  return {
    id: 'rv',
    name: 'Reversi',
    tag: 'turn the tide',
    blurb: 'Every disc you take can be taken back twice over. Corners are everything.',
    rules: 'A move must flank a line of theirs — those discs flip to you. Most discs when the board fills wins. No legal move means you pass.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = 1;
      let b = new Int8Array(N), turn = HUMAN, over = false, hist = [], legalSet = new Set();
      b[27] = -1; b[28] = 1; b[35] = 1; b[36] = -1;
      /* Threefold repetition: same discs, same side to move, three times = draw. */
      const rep = new Map();
      const posKey = (bd, side) => bd.join(',') + '|' + side;
      const bumpRep = (bd, side) => {
        const k = posKey(bd, side), n = (rep.get(k) || 0) + 1;
        rep.set(k, n);
        return n;
      };
      bumpRep(b, turn);
      const board = mk('div', 'board rv');
      ctx.boardEl.appendChild(board);
      const cells = [];
      for (let i = 0; i < N; i++) {
        const c = mk('button', 'cell'); c.type = 'button';
        c.setAttribute('aria-label', 'square ' + (i + 1));
        c.addEventListener('click', () => play(i));
        board.appendChild(c); cells.push(c);
      }
      const humanTurn = () => mode === 'two' || turn === HUMAN;

      function render(changed) {
        for (let i = 0; i < N; i++) {
          const v = b[i], cell = cells[i], cur = cell.firstChild;
          const curV = cur ? (cur.classList.contains('p1') ? 1 : -1) : 0;
          if (curV !== v) {
            cell.textContent = '';
            if (v) {
              const d = mk('div', 'disc ' + (v === 1 ? 'p1' : 'p2'));
              if (changed && !changed.has(i)) d.style.animation = 'none';
              cell.appendChild(d);
            }
          }
          cell.classList.toggle('legal', legalSet.has(i));
        }
        $$('.hint', board).forEach(e => e.classList.remove('hint'));
      }
      function refreshLegal() {
        legalSet = new Set(legal(b, turn).map(m => m.i));
      }
      function sync() {
        if (over) return;
        if (mode === 'two') ctx.setStatus((turn === 1 ? 'Cream' : 'Slate') + ' to move', 'you');
        else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
      }
      function score() {
        let p = 0, n = 0;
        for (let i = 0; i < N; i++) { if (b[i] === 1) p++; else if (b[i] === -1) n++; }
        return { p, n };
      }
      function finish() {
        over = true; legalSet = new Set(); render();
        const { p, n } = score();
        const label = `Cream ${p} — ${n} Slate`;
        if (p === n) { ctx.setStatus('Draw ' + label, 'draw'); Sound.draw(); ctx.end('d', 'Draw — ' + label); }
        else if (mode === 'two') {
          const who = p > n ? 'Cream' : 'Slate';
          ctx.setStatus(who + ' wins · ' + label, 'win'); Sound.win(); ctx.end(null, who + ' wins — ' + label);
        } else if (p > n) { ctx.setStatus('You win · ' + label, 'win'); Sound.win(); ctx.end('w', 'You win — ' + label); }
        else { ctx.setStatus('Talia wins · ' + label, 'lose'); Sound.lose(); ctx.end('l', 'Talia wins — ' + label); }
      }
      function finishRepeat() {
        over = true; legalSet = new Set(); render();
        const { p, n } = score();
        ctx.setStatus('Draw', 'draw'); Sound.draw();
        ctx.end('d', `Draw — threefold repetition (${p}–${n})`);
      }
      function play(i) {
        if (over || !humanTurn()) return;
        const mv = legal(b, turn).find(m => m.i === i);
        if (!mv) return;
        hist.push({ b: Int8Array.from(b), turn });
        const changed = new Set([i, ...mv.flips]);
        b[i] = turn;
        for (const f of mv.flips) b[f] = turn;
        Sound.flip();
        advance(changed);
      }
      function advance(changed) {
        const next = -turn;
        let passed = false;
        if (legal(b, next).length) turn = next;
        else if (legal(b, turn).length) { passed = true; Sound.pass(); }
        else return finish();
        if (bumpRep(b, turn) >= 3) return finishRepeat();
        refreshLegal(); render(changed); sync();
        if (passed) ctx.flash((mode === 'two' ? (next === 1 ? 'Cream' : 'Slate') : 'Talia') + ' has no legal move — pass');
        if (mode === 'ai' && turn === -1) think();
      }
      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        const depths = [2, 4, 5];
        const i = choose(b, -1, depths[diff], BUDGET[diff]);
        if (i == null) { return finish(); }
        const mv = legal(b, -1).find(m => m.i === i);
        if (!mv) return;
        hist.push({ b: Int8Array.from(b), turn });
        const changed = new Set([i, ...mv.flips]);
        b[i] = -1;
        for (const f of mv.flips) b[f] = -1;
        Sound.flip();
        advance(changed);
      }
      function undo() {
        if (!hist.length) return;
        over = false; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        b = Int8Array.from(s.b); turn = s.turn;
        rep.clear(); for (const h of hist) bumpRep(h.b, h.turn); bumpRep(b, turn);
        refreshLegal(); render(); sync();
      }
      function hint() {
        if (over || !humanTurn()) return;
        const i = choose(Int8Array.from(b), HUMAN, 3, 260);
        if (i == null) return;
        cells[i].classList.add('hint');
        setTimeout(() => cells[i].classList.remove('hint'), 2000);
        Sound.click();
      }
      refreshLegal(); render(); sync();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   4. CHECKERS (English draughts)
   ============================================================ */
const checkers = (() => {
  const SIGNS = [1, -1];
  const dirsFor = (side, king) => king
    ? [[-1,-1],[-1,1],[1,-1],[1,1]]
    : (side === 1 ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]);

  function jumps(bd, from, side, king, path, taken, out) {
    const r = (from / 8) | 0, c = from % 8;
    const opts = [];
    for (const [dr, dc] of dirsFor(side, king)) {
      const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
      if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
      const mid = mr * 8 + mc, land = lr * 8 + lc;
      const mv = bd[mid];
      if (!mv || Math.sign(mv) === side) continue;
      if (taken.indexOf(mid) !== -1) continue;
      if (bd[land]) continue;
      opts.push({ mid, land, promote: lr === 0 || lr === 7 });
    }
    if (!opts.length) {
      if (taken.length) out.push({ from: path[0], path: path.slice(), cap: taken.slice() });
      return;
    }
    for (const o of opts) {
      if (o.promote) out.push({ from: path[0], path: path.concat([o.land]), cap: taken.concat([o.mid]) });
      else jumps(bd, o.land, side, king, path.concat([o.land]), taken.concat([o.mid]), out);
    }
  }
  function generate(bd, side) {
    const caps = [], quiet = [];
    for (let i = 0; i < 64; i++) {
      const v = bd[i];
      if (!v || Math.sign(v) !== side) continue;
      const r = (i / 8) | 0, c = i % 8, king = Math.abs(v) === 2;
      jumps(bd, i, side, king, [i], [], caps);
      for (const [dr, dc] of dirsFor(side, king)) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const j = rr * 8 + cc;
        if (!bd[j]) quiet.push({ from: i, path: [i, j], cap: [] });
      }
    }
    return caps.length ? caps : quiet;
  }
  function apply(bd, mv) {
    const piece = bd[mv.from];
    const side = Math.sign(piece);
    bd[mv.from] = 0;
    for (const c of mv.cap) bd[c] = 0;
    const to = mv.path[mv.path.length - 1];
    const r = (to / 8) | 0;
    let np = piece;
    if (Math.abs(piece) === 1 && ((side === 1 && r === 0) || (side === -1 && r === 7))) np = side * 2;
    bd[to] = np;
  }
  function evaluate(bd, side) {
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const v = bd[i];
      if (!v) continue;
      const sg = Math.sign(v), king = Math.abs(v) === 2;
      const r = (i / 8) | 0, c = i % 8;
      let val = king ? 168 : 100;
      if (!king) val += (sg === 1 ? 7 - r : r) * 4.5;
      val += (3.5 - Math.abs(3.5 - c)) * 1.6;
      if (!king && ((sg === 1 && r === 7) || (sg === -1 && r === 0))) val += 7;
      s += val * sg;
    }
    return s * side;
  }
  let aborted = false;
  function neg(bd, side, depth, alpha, beta, dl) {
    if (now() > dl) { aborted = true; return 0; }
    const moves = generate(bd, side);
    if (!moves.length) return -100000 - depth * 100;
    if (depth === 0) return evaluate(bd, side);
    moves.sort((a, b) => b.cap.length - a.cap.length);
    let best = -1e9;
    for (const mv of moves) {
      const nb = Int8Array.from(bd);
      apply(nb, mv);
      const sc = -neg(nb, -side, depth - 1, -beta, -alpha, dl);
      if (aborted) return best === -1e9 ? 0 : best;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function choose(bd, side, maxDepth, budget) {
    const dl = now() + budget;
    aborted = false;
    const moves = generate(bd, side);
    if (!moves.length) return null;
    let bestMove = moves[0];
    for (let d = 1; d <= maxDepth; d++) {
      let best = -1e9, bm = null;
      const ordered = moves.slice().sort((a, b) => b.cap.length - a.cap.length);
      for (const mv of ordered) {
        const nb = Int8Array.from(bd);
        apply(nb, mv);
        const sc = -neg(nb, -side, d - 1, -1e9, -best, dl);
        if (aborted) break;
        if (sc > best) { best = sc; bm = mv; }
      }
      if (bm) bestMove = bm;
      if (aborted || now() > dl) break;
    }
    return bestMove;
  }

  return {
    id: 'ck',
    name: 'Checkers',
    tag: 'tactics',
    blurb: 'Mandatory captures, chains of three, and a king that walks backwards.',
    rules: 'Men move forward one square, capture diagonally forward. Captures are compulsory and chain. Reach the far row to be crowned.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = 1;
      let b = new Int8Array(64), turn = HUMAN, over = false, hist = [], sel = null;
      /* Threefold repetition: same men, same side to move, three times = draw. */
      const rep = new Map();
      const posKey = (bd, side) => bd.join(',') + '|' + side;
      const bumpRep = (bd, side) => {
        const k = posKey(bd, side), n = (rep.get(k) || 0) + 1;
        rep.set(k, n);
        return n;
      };
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = -1;
      for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = 1;
      bumpRep(b, turn);

      const board = mk('div', 'board ck');
      ctx.boardEl.appendChild(board);
      const sqs = [];
      for (let i = 0; i < 64; i++) {
        const r = (i / 8) | 0, c = i % 8;
        const s = mk('div', 'sq ' + ((r + c) % 2 === 1 ? 'dark' : 'light'));
        if ((r + c) % 2 === 1) {
          s.setAttribute('role', 'button');
          s.setAttribute('tabindex', '0');
          s.setAttribute('aria-label', 'square ' + (String.fromCharCode(97 + c) + (8 - r)));
          s.addEventListener('click', () => click(i));
          s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(i); } });
        }
        board.appendChild(s); sqs.push(s);
      }
      const humanTurn = () => mode === 'two' || turn === HUMAN;
      function movesFor(side) { return generate(b, side); }

      function render() {
        for (let i = 0; i < 64; i++) {
          const v = b[i], s = sqs[i];
          s.className = 'sq ' + (((i / 8 | 0) + i % 8) % 2 === 1 ? 'dark' : 'light');
          s.textContent = '';
          if (v) {
            const p = mk('div', 'pc ' + (v > 0 ? 'p1' : 'p2') + (Math.abs(v) === 2 ? ' king' : ''));
            s.appendChild(p);
          }
        }
        if (sel != null) sqs[sel].classList.add('sel');
        if (sel != null) {
          const opts = movesFor(turn).filter(m => m.from === sel);
          const seen = new Set();
          for (const m of opts) {
            const to = m.path[m.path.length - 1];
            if (seen.has(to)) continue;
            seen.add(to);
            sqs[to].classList.add('dest');
            if (m.cap.length) sqs[to].classList.add('cap');
          }
        }
      }
      function sync() {
        if (over) return;
        if (mode === 'two') ctx.setStatus(turn === HUMAN ? 'Gold to move' : 'Clay to move', 'you');
        else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
      }
      function finish(who) {
        over = true; sel = null; render();
        if (mode === 'two') {
          const n = who === HUMAN ? 'Gold' : 'Clay';
          ctx.setStatus(n + ' wins', 'win'); Sound.win(); ctx.end(null, n + ' wins');
        } else if (who === HUMAN) { ctx.setStatus('You win', 'win'); Sound.win(); ctx.end('w', 'You win'); }
        else { ctx.setStatus('Talia wins', 'lose'); Sound.lose(); ctx.end('l', 'Talia wins'); }
      }
      function drawRepeat() {
        over = true; sel = null; render();
        ctx.setStatus('Draw', 'draw'); Sound.draw();
        ctx.end('d', 'Draw — threefold repetition');
      }
      function click(i) {
        if (over || !humanTurn()) return;
        const opts = movesFor(turn);
        if (sel != null) {
          const cand = opts.filter(m => m.from === sel && m.path[m.path.length - 1] === i);
          if (cand.length) {
            cand.sort((x, y) => y.cap.length - x.cap.length);
            return doMove(cand[0]);
          }
        }
        if (b[i] && Math.sign(b[i]) === turn && opts.some(m => m.from === i)) {
          sel = (sel === i ? null : i);
          Sound.click(); render();
        } else if (sel != null) { sel = null; render(); }
      }
      function doMove(mv) {
        hist.push({ b: Int8Array.from(b), turn });
        const caps = mv.cap.length;
        apply(b, mv);
        if (caps) Sound.capture(); else Sound.chip();
        sel = null;
        const next = -turn;
        if (!movesFor(next).length) {
          render();
          return finish(turn);
        }
        turn = next; render(); sync();
        if (bumpRep(b, turn) >= 3) return drawRepeat();
        if (mode === 'ai' && turn === -1) think();
      }
      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        const depths = [2, 5, 8];
        const mv = choose(b, -1, depths[diff], BUDGET[diff]);
        if (!mv) { return finish(HUMAN); }
        hist.push({ b: Int8Array.from(b), turn });
        apply(b, mv);
        if (mv.cap.length) Sound.capture(); else Sound.chip();
        sel = null;
        const next = -turn;
        if (!movesFor(next).length) { render(); return finish(turn); }
        turn = next; render(); sync();
        if (bumpRep(b, turn) >= 3) return drawRepeat();
      }
      function undo() {
        if (!hist.length) return;
        over = false; sel = null; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        b = Int8Array.from(s.b); turn = s.turn; render(); sync();
        rep.clear(); for (const h of hist) bumpRep(h.b, h.turn); bumpRep(b, turn);
      }
      function hint() {
        if (over || !humanTurn()) return;
        const mv = choose(Int8Array.from(b), HUMAN, 3, 300);
        if (!mv) return;
        const to = mv.path[mv.path.length - 1];
        sel = mv.from;
        render();
        sqs[to].classList.add('hint');
        setTimeout(() => { sqs[to].classList.remove('hint'); if (!over) { sel = null; render(); } }, 2000);
        Sound.click();
      }
      render(); sync();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   5. CHESS
   ============================================================ */
const chess = (() => {
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 1, BLACK = -1;
  const MATE = 100000;
  const GLYPH = ['', '\u265f', '\u265e', '\u265d', '\u265c', '\u265b', '\u265a'];
  const NAME = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const MAT = [0, 100, 320, 330, 500, 900, 0];
  const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
  const ROYAL = DIAG.concat(ORTH);
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const CODE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
  const sideOf = v => (v > 0 ? WHITE : BLACK);

  /* squares are 0..63 from a8 (top left) to h1; white sits at the bottom */
  const PAWN_T = [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0];
  const KNIGHT_T = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50];
  const BISHOP_T = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20];
  const ROOK_T = [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0];
  const QUEEN_T = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20];
  const KING_MID = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20];
  const KING_END = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50];
  const TABLES = [null, PAWN_T, KNIGHT_T, BISHOP_T, ROOK_T, QUEEN_T, null];

  /* ---------------- position ---------------- */
  function fromFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const b = new Int8Array(64);
    let i = 0;
    for (const ch of parts[0]) {
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { i += +ch; continue; }
      const code = CODE[ch.toLowerCase()];
      if (code) b[i++] = ch === ch.toLowerCase() ? -code : code;
    }
    let castle = 0;
    const rights = parts[2] || '-';
    if (rights.includes('K')) castle |= 1;
    if (rights.includes('Q')) castle |= 2;
    if (rights.includes('k')) castle |= 4;
    if (rights.includes('q')) castle |= 8;
    const ep = parts[3] && parts[3] !== '-' ? alg(parts[3]) : -1;
    return { b, turn: parts[1] === 'b' ? BLACK : WHITE, castle, ep, half: +(parts[4] || 0) };
  }
  function alg(sq) {
    const c = sq.charCodeAt(0) - 97, r = 8 - +sq[1];
    return r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1;
  }
  const initial = () => fromFen(START);
  const clone = st => ({ b: Int8Array.from(st.b), turn: st.turn, castle: st.castle, ep: st.ep, half: st.half });

  function kingSq(b, side) {
    const k = KING * side;
    for (let i = 0; i < 64; i++) if (b[i] === k) return i;
    return -1;
  }

  function attacked(b, sq, by) {
    if (sq < 0) return false;
    const r = sq >> 3, c = sq & 7;
    const pr = r + by;                                  // a pawn of `by` attacks upward
    if (pr >= 0 && pr < 8) {
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc < 0 || cc > 7) continue;
        if (b[pr * 8 + cc] === PAWN * by) return true;
      }
    }
    for (const [dr, dc] of KN) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
      if (b[rr * 8 + cc] === KNIGHT * by) return true;
    }
    for (const [dr, dc] of ROYAL) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
      if (b[rr * 8 + cc] === KING * by) return true;
    }
    for (const [dr, dc] of ORTH) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const v = b[rr * 8 + cc];
        if (v) { if (v === ROOK * by || v === QUEEN * by) return true; break; }
        rr += dr; cc += dc;
      }
    }
    for (const [dr, dc] of DIAG) {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const v = b[rr * 8 + cc];
        if (v) { if (v === BISHOP * by || v === QUEEN * by) return true; break; }
        rr += dr; cc += dc;
      }
    }
    return false;
  }
  const inCheck = (st, side) => attacked(st.b, kingSq(st.b, side), -side);

  /* ---------------- move generation ---------------- */
  const move = (from, to, promo, flag) => ({ from, to, promo: promo || 0, flag: flag || 0 });

  function pawnMoves(out, from, to, promote) {
    if (promote) {
      out.push(move(from, to, QUEEN), move(from, to, ROOK), move(from, to, BISHOP), move(from, to, KNIGHT));
    } else out.push(move(from, to));
  }

  function pseudo(st, side, capsOnly) {
    const b = st.b, out = [];
    for (let from = 0; from < 64; from++) {
      const v = b[from];
      if (!v || sideOf(v) !== side) continue;
      const code = v > 0 ? v : -v;
      const r = from >> 3, c = from & 7;
      if (code === PAWN) {
        const rr = r - side;
        if (rr < 0 || rr > 7) continue;
        const promote = rr === (side === WHITE ? 0 : 7);
        const one = rr * 8 + c;
        if (!capsOnly && !b[one]) {
          pawnMoves(out, from, one, promote);
          if (r === (side === WHITE ? 6 : 1) && !b[from - side * 16]) out.push(move(from, from - side * 16, 0, 1));
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (cc < 0 || cc > 7) continue;
          const to = rr * 8 + cc, t = b[to];
          if (t) { if (sideOf(t) !== side) pawnMoves(out, from, to, promote); }
          else if (to === st.ep) out.push(move(from, to, 0, 2));
        }
      } else if (code === KNIGHT || code === KING) {
        for (const [dr, dc] of (code === KNIGHT ? KN : ROYAL)) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
          const to = rr * 8 + cc, t = b[to];
          if (t && sideOf(t) === side) continue;
          if (capsOnly && !t) continue;
          out.push(move(from, to));
        }
      } else {
        const dirs = code === BISHOP ? DIAG : code === ROOK ? ORTH : ROYAL;
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const to = rr * 8 + cc, t = b[to];
            if (t) {
              if (sideOf(t) !== side) out.push(move(from, to));
              break;
            }
            if (!capsOnly) out.push(move(from, to));
            rr += dr; cc += dc;
          }
        }
      }
    }
    if (!capsOnly) {
      const home = side === WHITE ? 60 : 4;
      if (b[home] === KING * side) {
        const kBit = side === WHITE ? 1 : 4, qBit = side === WHITE ? 2 : 8;
        const safe = sq => !attacked(b, sq, -side);
        if ((st.castle & kBit) && b[home + 3] === ROOK * side && !b[home + 1] && !b[home + 2] &&
            safe(home) && safe(home + 1) && safe(home + 2)) {
          out.push(move(home, home + 2, 0, 3));
        }
        if ((st.castle & qBit) && b[home - 4] === ROOK * side && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
            safe(home) && safe(home - 1) && safe(home - 2)) {
          out.push(move(home, home - 2, 0, 3));
        }
      }
    }
    return out;
  }

  /* make/unmake in place: the search walks thousands of these, so no copies */
  function make(st, m) {
    const b = st.b, piece = b[m.from], side = sideOf(piece);
    const rec = {
      from: m.from, to: m.to, piece, cap: b[m.to], flag: m.flag,
      castle: st.castle, ep: st.ep, half: st.half, capSq: -1, rook: null
    };
    if (m.flag === 2) {
      rec.capSq = m.to + 8 * side;
      rec.cap = b[rec.capSq];
      b[rec.capSq] = 0;
    }
    b[m.to] = m.promo ? m.promo * side : piece;
    b[m.from] = 0;
    if (m.flag === 3) {
      const from = m.to > m.from ? m.from + 3 : m.from - 4;
      const to = m.to > m.from ? m.from + 1 : m.from - 1;
      b[to] = b[from]; b[from] = 0;
      rec.rook = [from, to];
    }
    let c = st.castle;
    if (Math.abs(piece) === KING) c &= side === WHITE ? ~3 : ~12;
    if (m.from === 63 || m.to === 63) c &= ~1;
    if (m.from === 56 || m.to === 56) c &= ~2;
    if (m.from === 7 || m.to === 7) c &= ~4;
    if (m.from === 0 || m.to === 0) c &= ~8;
    st.castle = c;
    st.ep = m.flag === 1 ? (m.from + m.to) >> 1 : -1;
    st.half = (Math.abs(piece) === PAWN || rec.cap) ? 0 : st.half + 1;
    st.turn = -side;
    return rec;
  }
  function unmake(st, m, rec) {
    const b = st.b;
    b[rec.from] = rec.piece;
    b[rec.to] = rec.cap;
    if (rec.flag === 2) { b[rec.to] = 0; b[rec.capSq] = rec.cap; }
    if (rec.rook) { b[rec.rook[0]] = b[rec.rook[1]]; b[rec.rook[1]] = 0; }
    st.castle = rec.castle;
    st.ep = rec.ep;
    st.half = rec.half;
    st.turn = -st.turn;
  }

  function legalFrom(st, side, list) {
    const k0 = kingSq(st.b, side), out = [];
    for (const m of list) {
      const rec = make(st, m);
      const k = m.from === k0 ? m.to : k0;
      if (!attacked(st.b, k, -side)) out.push(m);
      unmake(st, m, rec);
    }
    return out;
  }
  const legal = (st, side) => legalFrom(st, side, pseudo(st, side, false));

  /* ---------------- evaluation ---------------- */
  function evaluate(b, side) {
    let total = 0, score = 0;
    for (let i = 0; i < 64; i++) { const v = b[i]; if (v) total += MAT[v > 0 ? v : -v]; }
    const endgame = total < 2400;
    for (let i = 0; i < 64; i++) {
      const v = b[i];
      if (!v) continue;
      const s = sideOf(v), code = v > 0 ? v : -v;
      const table = code === KING ? (endgame ? KING_END : KING_MID) : TABLES[code];
      score += s * (MAT[code] + table[s === WHITE ? i : i ^ 56]);
    }
    return score * side;
  }

  function order(st, moves) {
    const b = st.b;
    const key = m => {
      let s = 0;
      const cap = b[m.to];
      if (cap) s += 1000 + MAT[cap > 0 ? cap : -cap] * 10 - MAT[Math.abs(b[m.from])];
      if (m.flag === 2) s += 1000 + 90 - MAT[PAWN];
      if (m.promo) s += MAT[m.promo] * 8;
      if (m.flag === 3) s += 40;
      return s;
    };
    moves.sort((x, y) => key(y) - key(x));
    return moves;
  }

  /* ---------------- search ---------------- */
  let nodes = 0, deadline = 0, aborted = false;
  const timeUp = () => { nodes++; return (nodes & 511) === 0 && now() > deadline; };

  function quiesce(st, alpha, beta, ply) {
    if (timeUp()) { aborted = true; return 0; }
    const side = st.turn;
    if (ply > 20) return evaluate(st.b, side);
    if (inCheck(st, side)) {
      const moves = legal(st, side);
      if (!moves.length) return -MATE + ply;
      order(st, moves);
      for (const m of moves) {
        const rec = make(st, m);
        const sc = -quiesce(st, -beta, -alpha, ply + 1);
        unmake(st, m, rec);
        if (aborted) return 0;
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      return alpha;
    }
    const stand = evaluate(st.b, side);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    const caps = order(st, legalFrom(st, side, pseudo(st, side, true)));
    for (const m of caps) {
      const rec = make(st, m);
      const sc = -quiesce(st, -beta, -alpha, ply + 1);
      unmake(st, m, rec);
      if (aborted) return stand;
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function search(st, depth, alpha, beta, ply) {
    if (timeUp()) { aborted = true; return 0; }
    const side = st.turn;
    if (ply < 10 && inCheck(st, side)) depth++;          // check extension
    if (depth <= 0) return quiesce(st, alpha, beta, ply);
    const moves = legal(st, side);
    if (!moves.length) return inCheck(st, side) ? -MATE + ply : 0;
    if (st.half >= 100) return 0;
    order(st, moves);
    let best = -Infinity;
    for (const m of moves) {
      const rec = make(st, m);
      const sc = -search(st, depth - 1, -beta, -alpha, ply + 1);
      unmake(st, m, rec);
      if (aborted) return best === -Infinity ? 0 : best;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  /* iterative deepening: keep the last completed depth's ranking */
  function choose(st0, maxDepth, budget) {
    const st = clone(st0);
    const moves = legal(st, st.turn);
    if (!moves.length) return null;
    nodes = 0; deadline = now() + budget; aborted = false;
    let ranked = null;
    for (let d = 1; d <= maxDepth; d++) {
      const list = ranked ? ranked.map(x => x.m) : moves.slice();
      if (!ranked) order(st, list);
      const scored = [];
      let alpha = -Infinity;
      for (const m of list) {
        const rec = make(st, m);
        const sc = -search(st, d - 1, -Infinity, -alpha, 1);
        unmake(st, m, rec);
        if (aborted) break;
        scored.push({ m, sc });
        if (sc > alpha) alpha = sc;
      }
      if (aborted || !scored.length) break;
      scored.sort((a, b) => b.sc - a.sc);
      ranked = scored;
      if (scored[0].sc > MATE - 1000 || now() > deadline) break;
    }
    return ranked ? ranked[0] : { m: moves[0], sc: 0 };
  }

  function insufficient(b) {
    let minors = 0;
    for (let i = 0; i < 64; i++) {
      const v = b[i];
      if (!v) continue;
      const code = v > 0 ? v : -v;
      if (code === KING) continue;
      if (code !== BISHOP && code !== KNIGHT) return false;
      minors++;
    }
    return minors <= 2;
  }

  function perft(st, depth) {
    if (depth === 0) return 1;
    const moves = legal(st, st.turn);
    if (depth === 1) return moves.length;
    let n = 0;
    for (const m of moves) {
      const rec = make(st, m);
      n += perft(st, depth - 1);
      unmake(st, m, rec);
    }
    return n;
  }

  /* Read-only hook for ctest.py: perft plus a FEN loader, never touches a
     mounted game's state. */
  window.__nxChess = {
    perft: (fen, depth) => perft(fromFen(fen || START), depth),
    start: START
  };

  return {
    id: 'ch',
    name: 'Chess',
    tag: 'the old one',
    blurb: 'Every rule as written — castling, en passant, promotion. Sixty-four squares and no excuses.',
    rules: 'Click a piece, then the square to move it. Checkmate ends it; stalemate, not enough material or fifty quiet moves is a draw. Pawns promote on the far rank.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = WHITE;
      let st = initial(), over = false, hist = [], sel = null, last = null, promo = null, tips = [];

      const board = mk('div', 'board ch');
      ctx.boardEl.appendChild(board);
      const sqs = [];
      for (let i = 0; i < 64; i++) {
        const s = mk('div', 'sq');
        s.setAttribute('role', 'button');
        s.setAttribute('tabindex', '0');
        s.setAttribute('aria-label', String.fromCharCode(97 + (i & 7)) + (8 - (i >> 3)));
        s.addEventListener('click', () => click(i));
        s.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(i); }
        });
        board.appendChild(s); sqs.push(s);
      }
      const humanTurn = () => mode === 'two' || st.turn === HUMAN;

      /* Threefold repetition: count every position (pieces, side to move,
         castling rights, en-passant square) as it is reached; the third
         occurrence is a draw. Harness-visible via __nxChess.rep(). */
      const rep = new Map();
      const posKey = s => s.b.join(',') + '|' + s.turn + '|' + s.castle + '|' + s.ep;
      function bumpRep(s) {
        const k = posKey(s), n = (rep.get(k) || 0) + 1;
        rep.set(k, n);
        return n;
      }
      function rebuildRep() {
        rep.clear();
        for (const s of hist) bumpRep(s);
        bumpRep(st);
      }
      bumpRep(st);

      function render() {
        const b = st.b;
        const dests = sel != null ? legal(st, st.turn).filter(m => m.from === sel) : [];
        const checkSq = inCheck(st, st.turn) ? kingSq(b, st.turn) : -1;
        for (let i = 0; i < 64; i++) {
          const v = b[i], s = sqs[i];
          s.className = 'sq ' + (((i >> 3) + (i & 7)) % 2 === 0 ? 'light' : 'dark');
          s.textContent = '';
          if (v) {
            const p = mk('div', 'pc ' + (v > 0 ? 'w' : 'b'), GLYPH[v > 0 ? v : -v]);
            s.appendChild(p);
          }
        }
        if (last) {
          sqs[last.from].classList.add('last');
          sqs[last.to].classList.add('last');
        }
        if (sel != null) sqs[sel].classList.add('sel');
        for (const m of dests) {
          sqs[m.to].classList.add('dest');
          if (b[m.to]) sqs[m.to].classList.add('cap');
          else if (m.flag === 2) sqs[m.to + 8 * st.turn].classList.add('doomed');
        }
        if (checkSq >= 0) sqs[checkSq].classList.add('check');
        for (const t of tips) sqs[t].classList.add('hint');
      }

      function sync() {
        if (over) return;
        const chk = inCheck(st, st.turn);
        if (mode === 'two') {
          ctx.setStatus((st.turn === WHITE ? 'White' : 'Black') + (chk ? ' is in check' : ' to move'), 'you');
        } else if (st.turn === HUMAN) {
          ctx.setStatus(chk ? 'Check — your move' : 'Your move', 'you');
        } else {
          ctx.setStatus(chk ? 'Talia is in check…' : 'Talia is thinking…', 'ai');
        }
      }

      function finish(kind, winner) {
        over = true; sel = null; render();
        let res, label;
        if (kind === 'mate') {
          if (mode === 'two') {
            label = (winner === WHITE ? 'White' : 'Black') + ' wins by checkmate';
            ctx.setStatus(label, 'win'); Sound.win(); ctx.end(null, label); return;
          }
          if (winner === HUMAN) { res = 'w'; label = 'Checkmate — you win'; }
          else { res = 'l'; label = 'Checkmate — Talia wins'; }
        } else if (kind === 'stale') { res = 'd'; label = 'Stalemate — draw'; }
        else if (kind === 'material') { res = 'd'; label = 'Draw — not enough material'; }
        else if (kind === 'repeat') { res = 'd'; label = 'Draw — threefold repetition'; }
        else { res = 'd'; label = 'Draw — fifty quiet moves'; }

        if (res === 'w') { ctx.setStatus('You win', 'win'); Sound.win(); }
        else if (res === 'l') { ctx.setStatus('Talia wins', 'lose'); Sound.lose(); }
        else { ctx.setStatus('Draw', 'draw'); Sound.draw(); }
        ctx.end(res, label);
      }

      function afterMove(mover) {
        const side = st.turn;
        render();
        if (!legal(st, side).length) return finish(inCheck(st, side) ? 'mate' : 'stale', mover);
        if (st.half >= 100) return finish('fifty', 0);
        if (insufficient(st.b)) return finish('material', 0);
        if ((rep.get(posKey(st)) || 0) >= 3) return finish('repeat', 0);
        sync();
        if (mode === 'ai' && st.turn !== HUMAN) think();
      }

      function snapshot() {
        return { b: Int8Array.from(st.b), turn: st.turn, castle: st.castle, ep: st.ep, half: st.half, last };
      }

      function doMove(m) {
        const mover = st.turn;
        hist.push(snapshot());
        const rec = make(st, m);
        last = m; sel = null;
        bumpRep(st);
        if (rec.cap) Sound.capture(); else Sound.chip();
        afterMove(mover);
      }

      function askPromotion(cand) {
        promo = cand;
        const veil = mk('div', 'promo');
        const tray = mk('div', 'tray');
        for (const code of [QUEEN, ROOK, BISHOP, KNIGHT]) {
          const btn = mk('button', 'pbtn ' + (st.turn > 0 ? 'w' : 'b'), GLYPH[code]);
          btn.type = 'button';
          btn.setAttribute('aria-label', 'promote to ' + NAME[code]);
          btn.addEventListener('click', () => {
            const chosen = promo && promo.find(m => m.promo === code);
            promo = null;
            veil.remove();
            if (chosen) doMove(chosen);
            else render();
          });
          tray.appendChild(btn);
        }
        veil.appendChild(tray);
        board.appendChild(veil);
      }

      function click(i) {
        if (over || promo || !humanTurn()) return;
        const moves = legal(st, st.turn);
        if (sel != null) {
          const cand = moves.filter(m => m.from === sel && m.to === i);
          if (cand.length) {
            if (cand[0].promo) return askPromotion(cand);
            return doMove(cand[0]);
          }
        }
        if (st.b[i] && sideOf(st.b[i]) === st.turn && moves.some(m => m.from === i)) {
          sel = sel === i ? null : i;
          Sound.click();
          render();
        } else if (sel != null) { sel = null; render(); }
      }

      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        // Undo or a new game may have landed while this turn was queued.
        if (mode === 'ai' && st.turn === HUMAN) return;
        const legalNow = legal(st, st.turn);
        if (!legalNow.length) return finish(inCheck(st, st.turn) ? 'mate' : 'stale', -st.turn);
        if (Math.random() < [0.3, 0.05, 0][diff]) return doMove(pick(legalNow));
        const best = choose(st, [1, 3, 5][diff], BUDGET[diff]);
        if (!best) return;
        doMove(best.m);
      }

      function undo() {
        if (!hist.length) return;
        over = false; ctx.clearBanner(); sel = null;
        if (promo) { promo = null; const v = board.querySelector('.promo'); if (v) v.remove(); }
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        st = { b: Int8Array.from(s.b), turn: s.turn, castle: s.castle, ep: s.ep, half: s.half };
        last = s.last || null;
        rebuildRep();
        render(); sync();
      }

      function hint() {
        if (over || !humanTurn()) return;
        const best = choose(st, 3, 320);
        if (!best) return;
        sel = best.m.from;
        tips = [best.m.from, best.m.to];
        render();
        Sound.click();
        setTimeout(() => {
          tips = [];
          if (!over) { sel = null; render(); }
        }, 2000);
      }

      /* Dev hook, used by ctest.py: drop a FEN straight into the live board.
         A no-op once the game has been left, so it can never touch a stale view. */
      if (window.__nxChess) {
        window.__nxChess.load = fen => {
          if (!ctx.alive()) return false;
          st = fromFen(fen); hist = []; over = false; sel = null; last = null; tips = [];
          rep.clear(); bumpRep(st);
          if (promo) { promo = null; const v = board.querySelector('.promo'); if (v) v.remove(); }
          ctx.clearBanner(); render(); sync();
          if (mode === 'ai' && st.turn !== HUMAN) think();
          return true;
        };
        window.__nxChess.rep = () => ({ key: posKey(st), count: rep.get(posKey(st)) || 0, positions: rep.size });
      }

      render(); sync();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   6. FIVE IN A ROW (gomoku)
   ============================================================ */
const gomoku = (() => {
  const SZ = 15;
  const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
  const STARS = new Set([3*15+3, 3*15+11, 7*15+7, 11*15+3, 11*15+11]);

  function lineScore(bd, r, c, side) {
    let total = 0;
    for (const [dr, dc] of DIRS) {
      let str = '';
      for (let k = -4; k <= 4; k++) {
        if (k === 0) { str += '1'; continue; }
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= SZ || cc < 0 || cc >= SZ) { str += '2'; continue; }
        const v = bd[rr * SZ + cc];
        str += v === 0 ? '0' : v === side ? '1' : '2';
      }
      const mid = 4;
      let l = mid, g = mid;
      while (l > 0 && str[l - 1] === '1') l--;
      while (g < 8 && str[g + 1] === '1') g++;
      const cnt = g - l + 1;
      const openL = l > 0 && str[l - 1] === '0';
      const openR = g < 8 && str[g + 1] === '0';
      const ends = (openL ? 1 : 0) + (openR ? 1 : 0);
      if (cnt >= 5) total += 5e6;
      else if (cnt === 4) total += ends === 2 ? 1e5 : ends === 1 ? 1e4 : 0;
      else if (cnt === 3) total += ends === 2 ? 8e3 : ends === 1 ? 520 : 0;
      else if (cnt === 2) total += ends === 2 ? 320 : ends === 1 ? 45 : 0;
      else total += ends === 2 ? 12 : 3;
      if (/11011|11101|10111/.test(str)) total += 1e4;
      else if (/011010|010110|011100|001110/.test(str)) total += 700;
    }
    return total;
  }
  function candidates(bd) {
    const out = [];
    let stones = 0;
    for (let i = 0; i < SZ * SZ; i++) if (bd[i]) stones++;
    if (!stones) return [7 * SZ + 7];
    for (let r = 0; r < SZ; r++) for (let c = 0; c < SZ; c++) {
      const i = r * SZ + c;
      if (bd[i]) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SZ || cc < 0 || cc >= SZ) continue;
        if (bd[rr * SZ + cc]) { near = true; break; }
      }
      if (near) out.push(i);
    }
    return out;
  }
  function scored(bd, side) {
    const list = [];
    for (const i of candidates(bd)) {
      const r = (i / SZ) | 0, c = i % SZ;
      const atk = lineScore(bd, r, c, side);
      const def = lineScore(bd, r, c, -side);
      list.push({ i, atk, def, s: atk + def * .88 });
    }
    list.sort((a, b) => b.s - a.s);
    return list;
  }
  function choose(bd, side, diff) {
    const list = scored(bd, side);
    if (!list.length) return 7 * SZ + 7;
    if (list[0].atk >= 5e6) return list[0].i;
    const block = list.find(x => x.def >= 5e6);
    if (block) return block.i;
    if (diff === 0) return pick(list.slice(0, Math.min(3, list.length))).i;
    if (diff === 1) return list[0].i;
    let best = null;
    for (const cand of list.slice(0, 8)) {
      bd[cand.i] = side;
      const replyList = scored(bd, -side);
      const reply = replyList[0];
      let val = cand.s - (reply ? reply.s * .82 : 0);
      if (reply && reply.atk >= 5e6) val -= 4e6;
      bd[cand.i] = 0;
      if (!best || val > best.val) best = { i: cand.i, val };
    }
    return best.i;
  }
  function five(bd, r, c, side) {
    for (const [dr, dc] of DIRS) {
      const cells = [r * SZ + c];
      for (const sg of [1, -1]) {
        let rr = r + dr * sg, cc = c + dc * sg;
        while (rr >= 0 && rr < SZ && cc >= 0 && cc < SZ && bd[rr * SZ + cc] === side) {
          cells.push(rr * SZ + cc); rr += dr * sg; cc += dc * sg;
        }
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  return {
    id: 'gm',
    name: 'Five in a Row',
    tag: 'the long game',
    blurb: 'Fifteen by fifteen. Build two threats at once and one of them lands.',
    rules: 'Place a stone each turn. Five or more in a line — any direction — wins. Nothing is captured.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = 1;
      let b = new Int8Array(SZ * SZ), turn = HUMAN, over = false, hist = [];
      const board = mk('div', 'board gm');
      ctx.boardEl.appendChild(board);
      const cells = [];
      for (let i = 0; i < SZ * SZ; i++) {
        const c = mk('button', 'cell'); c.type = 'button';
        if (STARS.has(i)) c.classList.add('star');
        c.setAttribute('aria-label', 'intersection ' + (i + 1));
        c.addEventListener('click', () => play(i));
        board.appendChild(c); cells.push(c);
      }
      const humanTurn = () => mode === 'two' || turn === HUMAN;

      function render(last) {
        for (let i = 0; i < SZ * SZ; i++) {
          const v = b[i], cell = cells[i];
          if (cell.firstChild) cell.removeChild(cell.firstChild);
          if (v) {
            const s = mk('div', 'stone ' + (v === 1 ? 'p1' : 'p2'));
            cell.appendChild(s);
          }
        }
      }
      function sync() {
        if (over) return;
        if (mode === 'two') ctx.setStatus(turn === HUMAN ? 'Cream to move' : 'Slate to move', 'you');
        else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
      }
      function finish(who, line) {
        over = true;
        if (line) line.forEach(i => { const s = cells[i].firstChild; if (s) s.classList.add('win'); });
        if (mode === 'two') {
          const n = who === HUMAN ? 'Cream' : 'Slate';
          ctx.setStatus(n + ' wins', 'win'); Sound.win(); ctx.end(null, n + ' wins');
        } else if (who === HUMAN) { ctx.setStatus('You win', 'win'); Sound.win(); ctx.end('w', 'You win'); }
        else { ctx.setStatus('Talia wins', 'lose'); Sound.lose(); ctx.end('l', 'Talia wins'); }
      }
      function play(i) {
        if (over || b[i] || !humanTurn()) return;
        hist.push({ b: Int8Array.from(b), turn });
        b[i] = turn; Sound.place(); render(i);
        const line = five(b, (i / SZ) | 0, i % SZ, turn);
        if (line) return finish(turn, line);
        turn = -turn; render(); sync();
        if (mode === 'ai' && turn === -1) think();
      }
      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        const i = choose(b, -1, diff);
        if (b[i]) return;
        hist.push({ b: Int8Array.from(b), turn });
        b[i] = -1; Sound.place(); render(i);
        const line = five(b, (i / SZ) | 0, i % SZ, -1);
        if (line) return finish(-1, line);
        turn = HUMAN; render(); sync();
      }
      function undo() {
        if (!hist.length) return;
        over = false; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        b = Int8Array.from(s.b); turn = s.turn; render(); sync();
      }
      function hint() {
        if (over || !humanTurn()) return;
        const i = choose(Int8Array.from(b), HUMAN, 1);
        cells[i].classList.add('hint');
        setTimeout(() => cells[i].classList.remove('hint'), 2000);
        Sound.click();
      }
      render(); sync();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   7. MANCALA (Kalah)
   ============================================================ */
const mancala = (() => {
  const PITS = 14;
  function sow(st, pit, side) {
    const ownStore = side === 1 ? 6 : 13;
    const oppStore = side === 1 ? 13 : 6;
    let seeds = st[pit];
    st[pit] = 0;
    let j = pit, captured = 0;
    while (seeds > 0) {
      j = (j + 1) % PITS;
      if (j === oppStore) continue;
      st[j]++; seeds--;
    }
    let extra = (j === ownStore);
    if (!extra) {
      const mine = side === 1 ? (j >= 0 && j <= 5) : (j >= 7 && j <= 12);
      if (mine && st[j] === 1) {
        const opp = 12 - j;
        if (st[opp] > 0) {
          captured = st[opp] + 1;
          st[ownStore] += captured;
          st[opp] = 0; st[j] = 0;
        }
      }
    }
    return { extra, captured, last: j };
  }
  const sideTotal = (st, side) => {
    let t = 0;
    if (side === 1) { for (let i = 0; i < 6; i++) t += st[i]; }
    else { for (let i = 7; i < 13; i++) t += st[i]; }
    return t;
  };
  function finished(st) { return sideTotal(st, 1) === 0 || sideTotal(st, -1) === 0; }
  function sweep(st) {
    const h = sideTotal(st, 1), a = sideTotal(st, -1);
    for (let i = 0; i < 6; i++) st[i] = 0;
    for (let i = 7; i < 13; i++) st[i] = 0;
    st[6] += h; st[13] += a;
  }
  function evaluate(st, side) {
    const storeDiff = st[6] - st[13];
    const pitDiff = sideTotal(st, 1) - sideTotal(st, -1);
    return side * (storeDiff + pitDiff * .35);
  }
  let aborted = false;
  function neg(st, side, depth, alpha, beta, dl) {
    if (now() > dl) { aborted = true; return 0; }
    if (finished(st)) {
      const c = Int8Array.from(st); sweep(c);
      return (c[6] - c[13]) * side * 1000;
    }
    if (depth === 0) return evaluate(st, side);
    const lo = side === 1 ? 0 : 7, hi = side === 1 ? 5 : 12;
    let best = -1e9;
    for (let i = lo; i <= hi; i++) {
      if (!st[i]) continue;
      const c = Int8Array.from(st);
      const r = sow(c, i, side);
      const sc = r.extra
        ? neg(c, side, depth - 1, alpha, beta, dl)
        : -neg(c, -side, depth - 1, -beta, -alpha, dl);
      if (aborted) return best === -1e9 ? 0 : best;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function choose(st, side, maxDepth, budget) {
    const dl = now() + budget;
    aborted = false;
    const lo = side === 1 ? 0 : 7, hi = side === 1 ? 5 : 12;
    const legal = [];
    for (let i = lo; i <= hi; i++) if (st[i]) legal.push(i);
    if (!legal.length) return null;
    let bestMove = legal[0];
    for (let d = 1; d <= maxDepth; d++) {
      let best = -1e9, bm = null;
      for (const i of legal) {
        const c = Int8Array.from(st);
        const r = sow(c, i, side);
        const sc = r.extra
          ? neg(c, side, d - 1, -1e9, best, dl)
          : -neg(c, -side, d - 1, -1e9, -best, dl);
        if (aborted) break;
        if (sc > best) { best = sc; bm = i; }
      }
      if (bm != null) bestMove = bm;
      if (aborted || now() > dl) break;
    }
    return bestMove;
  }

  return {
    id: 'mn',
    name: 'Mancala',
    tag: 'counting game',
    blurb: 'Sow seeds around the board. Land in your store and go again.',
    rules: 'Pick one of your six pits — its seeds are sown one per pit, anticlockwise. Land in your store and you move again. Land in an empty pit and you take the opposite side with you.',
    mount(ctx) {
      const mode = ctx.mode, diff = ctx.diff, HUMAN = 1;
      let st = Int8Array.from([4,4,4,4,4,4,0, 4,4,4,4,4,4,0]);
      let turn = HUMAN, over = false, hist = [];
      const board = mk('div', 'board mn');
      ctx.boardEl.appendChild(board);

      const aiStore = mk('div', 'store'); aiStore.style.gridColumn = '1'; aiStore.style.gridRow = '1 / span 2';
      const humanStore = mk('div', 'store'); humanStore.style.gridColumn = '8'; humanStore.style.gridRow = '1 / span 2';
      board.appendChild(aiStore); board.appendChild(humanStore);
      const pitEls = {};
      for (let k = 0; k < 6; k++) {
        const top = mk('div', 'pit'); top.dataset.pit = 12 - k;
        top.style.gridColumn = String(2 + k); top.style.gridRow = '1';
        board.appendChild(top); pitEls[12 - k] = top;
      }
      for (let k = 0; k < 6; k++) {
        const bot = mk('div', 'pit'); bot.dataset.pit = k;
        bot.style.gridColumn = String(2 + k); bot.style.gridRow = '2';
        bot.addEventListener('click', () => play(k));
        board.appendChild(bot); pitEls[k] = bot;
      }
      const humanTurn = () => mode === 'two' || turn === HUMAN;

      function render() {
        for (let i = 0; i < 14; i++) {
          if (i === 6) { humanStore.innerHTML = `<span class="cap">YOURS</span><span class="n">${st[6]}</span>`; continue; }
          if (i === 13) { aiStore.innerHTML = `<span class="cap">TALIA</span><span class="n">${st[13]}</span>`; continue; }
          const el = pitEls[i];
          el.innerHTML = `<span class="n">${st[i]}</span>`;
          el.classList.toggle('playable', !over && humanTurn() && i >= 0 && i <= 5 && st[i] > 0);
        }
      }
      function sync() {
        if (over) return;
        if (mode === 'two') ctx.setStatus(turn === HUMAN ? 'Your side to move' : 'Their side to move', 'you');
        else ctx.setStatus(turn === HUMAN ? 'Your move' : 'Talia is thinking…', turn === HUMAN ? 'you' : 'ai');
      }
      function finish() {
        over = true;
        const h = st[6], a = st[13];
        render();
        const label = `you ${h} — ${a} Talia`;
        if (h === a) { ctx.setStatus('Draw · ' + label, 'draw'); Sound.draw(); ctx.end('d', 'Draw — ' + label); }
        else if (mode === 'two') {
          const who = h > a ? 'Side A' : 'Side B';
          ctx.setStatus(who + ' wins · ' + label, 'win'); Sound.win(); ctx.end(null, who + ' wins — ' + label);
        } else if (h > a) { ctx.setStatus('You win · ' + label, 'win'); Sound.win(); ctx.end('w', 'You win — ' + label); }
        else { ctx.setStatus('Talia wins · ' + label, 'lose'); Sound.lose(); ctx.end('l', 'Talia wins — ' + label); }
      }
      function play(pit) {
        if (over || !humanTurn()) return;
        if (pit < 0 || pit > 5 || !st[pit]) return;
        hist.push({ st: Int8Array.from(st), turn });
        const r = sow(st, pit, turn);
        if (r.captured) Sound.capture(); else Sound.chip();
        pitEls[pit].classList.add('pulse');
        setTimeout(() => pitEls[pit] && pitEls[pit].classList.remove('pulse'), 320);
        if (r.captured) ctx.flash('Captured ' + r.captured + ' from the far side');
        render();
        if (finished(st)) { sweep(st); return finish(); }
        if (!r.extra) turn = -turn;
        else if (turn === HUMAN && mode !== 'two') ctx.flash('Landed in your store — go again');
        render(); sync();
        if (mode === 'ai' && turn === -1) think();
      }
      async function think() {
        await aiDelay();
        if (!ctx.alive() || over) return;
        const depths = [4, 6, 8];
        const pit = choose(st, -1, depths[diff], BUDGET[diff]);
        if (pit == null) { if (!finished(st)) return; sweep(st); return finish(); }
        hist.push({ st: Int8Array.from(st), turn });
        const r = sow(st, pit, -1);
        if (r.captured) Sound.capture(); else Sound.chip();
        pitEls[pit].classList.add('pulse');
        setTimeout(() => pitEls[pit] && pitEls[pit].classList.remove('pulse'), 320);
        render();
        if (finished(st)) { sweep(st); return finish(); }
        if (!r.extra) turn = HUMAN;
        else ctx.flash('Talia landed in her store — she moves again');
        render(); sync();
      }
      function undo() {
        if (!hist.length) return;
        over = false; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        st = Int8Array.from(s.st); turn = s.turn; render(); sync();
      }
      function hint() {
        if (over || !humanTurn()) return;
        const pit = choose(Int8Array.from(st), HUMAN, 4, 220);
        if (pit == null) return;
        pitEls[pit].classList.add('hint');
        setTimeout(() => pitEls[pit].classList.remove('hint'), 2000);
        Sound.click();
      }
      render(); sync();
      return { undo, hint };
    }
  };
})();


/* ============================================================
   shared card bits
   ============================================================ */
const SUIT_SYM = ['♦', '♣', '♥', '♠'];

function cardNode(label, suit, hidden) {
  const red = suit === 0 || suit === 2;
  const el = mk('div', 'pcard' + (hidden ? ' back' : '') + (!hidden && red ? ' red' : ''));
  if (!hidden) {
    el.innerHTML = '<span class="rk">' + label + '</span><span class="st">' + SUIT_SYM[suit] + '</span>';
  }
  return el;
}

/* ============================================================
   8. BLACKJACK
   ============================================================ */
const blackjack = {
  id: 'bj',
  name: 'Blackjack',
  tag: 'the house game',
  hideMode: true,
  hideDiff: true,
  blurb: 'Six decks, dealer stands on 17, blackjack pays three to two. The only game here you can lose money in.',
  rules: 'Get closer to 21 than the dealer without busting. The dealer draws to 16 and stands on 17. A two-card 21 pays 3:2. Double is allowed on your first two cards. Your chips carry over between visits.',
  mount(ctx) {
    const wrap = mk('div', 'bj');
    ctx.boardEl.appendChild(wrap);
    const MIN_BET = 10, START_BANK = 500;
    let chips = typeof store.bank === 'number' ? store.bank : START_BANK;
    let bet = typeof store.bet === 'number' ? store.bet : 25;
    // A persisted bank below the smallest chip button would leave Deal disabled
    // (chips < bet) forever, because nothing could call startHand again. Restore
    // it on sight so the state is unreachable, not merely recoverable.
    if (chips < MIN_BET) { chips = START_BANK; store.bank = chips; save(); }
    let shoe = [], dealer = [], player = [], stake = 0;
    let phase = 'bet', hidden = true, busy = false, msg = '', tone = '';
    // rollback: one snapshot per decision, taken before the decision is applied
    let hist = [], gen = 0, settled = null;

    const dlbl = mk('div', 'rowlbl'); dlbl.innerHTML = '<span>Dealer</span><b class="dtot">–</b>';
    const dhand = mk('div', 'hand');
    const msgEl = mk('div', 'msg');
    const plbl = mk('div', 'rowlbl'); plbl.innerHTML = '<span>You</span><b class="ptot">–</b>';
    const phand = mk('div', 'hand');
    const bar = mk('div', 'bjbar');
    const bankEl = mk('div', 'bank');
    wrap.appendChild(dlbl); wrap.appendChild(dhand); wrap.appendChild(msgEl);
    wrap.appendChild(plbl); wrap.appendChild(phand); wrap.appendChild(bar); wrap.appendChild(bankEl);

    const bjLabel = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);
    const worth = c => c.r === 1 ? 11 : Math.min(10, c.r);

    function total(cs) {
      let t = 0, a = 0;
      for (const c of cs) { if (c.r === 1) { a++; t += 11; } else t += Math.min(10, c.r); }
      while (t > 21 && a) { t -= 10; a--; }
      return t;
    }
    function isSoft(cs) {
      const aces = cs.filter(c => c.r === 1).length;
      if (!aces) return false;
      let hard = 0;
      for (const c of cs) hard += c.r === 1 ? 1 : Math.min(10, c.r);
      return hard + 10 <= 21;
    }
    function buildShoe() {
      const s = [];
      for (let d = 0; d < 6; d++) for (let su = 0; su < 4; su++) for (let r = 1; r <= 13; r++) s.push({ r, s: su });
      for (let i = s.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = s[i]; s[i] = s[j]; s[j] = t; }
      return s;
    }
    const draw = () => shoe.pop();
    function saveBank() { store.bank = chips; store.bet = bet; save(); }

    function setMsg(t, k) { msg = t; tone = k || ''; }
    function paintCards() {
      dhand.innerHTML = ''; phand.innerHTML = '';
      dealer.forEach((c, i) => dhand.appendChild(cardNode(bjLabel(c.r), c.s, i === 1 && hidden)));
      player.forEach(c => phand.appendChild(cardNode(bjLabel(c.r), c.s)));
      dlbl.querySelector('.dtot').textContent = dealer.length ? (hidden ? total([dealer[0]]) + ' + ?' : String(total(dealer))) : '–';
      plbl.querySelector('.ptot').textContent = player.length ? String(total(player)) : '–';
    }
    function paintBar() {
      bar.innerHTML = '';
      if (phase === 'bet' || phase === 'done') {
        [10, 25, 50, 100].forEach(v => {
          const b = mk('button', 'btn', String(v));
          b.type = 'button';
          b.classList.toggle('on', bet === v);
          b.disabled = v > chips;
          b.onclick = () => { bet = v; saveBank(); Sound.click(); render(); };
          bar.appendChild(b);
        });
        const d = mk('button', 'btn primary', phase === 'done' ? 'Next hand' : 'Deal');
        d.type = 'button';
        d.disabled = chips < bet;
        d.onclick = () => startHand();
        bar.appendChild(d);
      } else if (phase === 'player') {
        const h = mk('button', 'btn primary', 'Hit'); h.type = 'button'; h.onclick = () => hit();
        const s = mk('button', 'btn', 'Stand'); s.type = 'button'; s.onclick = () => stand();
        const dd = mk('button', 'btn', 'Double'); dd.type = 'button';
        dd.disabled = player.length !== 2 || chips < bet;
        dd.onclick = () => doubleDown();
        bar.appendChild(h); bar.appendChild(s); bar.appendChild(dd);
      } else {
        bar.appendChild(mk('div', 'bank', 'Dealer draws…'));
      }
    }
    function render() {
      paintCards(); paintBar();
      msgEl.textContent = msg;
      msgEl.className = 'msg' + (tone ? ' ' + tone : '');
      bankEl.innerHTML = 'Chips <b>' + chips + '</b> · bet ' + bet;
    }
    function status(text, kind) { ctx.setStatus(text, kind); }

    async function startHand() {
      if (busy) return;
      if (chips < MIN_BET) { chips = START_BANK; saveBank(); }   // never deal from a busted bank
      if (chips < bet) return;
      if (shoe.length < 30) shoe = buildShoe();
      push();
      busy = true; hidden = true; phase = 'player'; stake = bet;
      chips -= stake; saveBank();
      dealer = [draw()]; player = [draw(), draw()]; dealer.push(draw());
      setMsg('Your move.', '');
      render(); status('Your move', 'you');
      Sound.place();
      const p = total(player), d = total(dealer);
      if (p === 21 || d === 21) { hidden = false; busy = false; return settle(); }
      busy = false; render();
    }
    function hit() {
      if (phase !== 'player' || busy) return;
      push();
      player.push(draw()); Sound.place();
      const t = total(player);
      if (t > 21) { phase = 'dealer'; hidden = false; return settle(); }
      render();
      if (t === 21) stand();
    }
    async function stand(quiet) {
      if (phase !== 'player' || busy) return;
      if (!quiet) push();
      const g0 = gen;
      phase = 'dealer'; hidden = false; busy = true;
      render(); status('Dealer draws', 'ai'); Sound.pass();
      while (total(dealer) < 17) {
        await sleep(330);
        if (!ctx.alive() || gen !== g0) return;
        dealer.push(draw()); Sound.place(); render();
      }
      await sleep(240);
      if (!ctx.alive() || gen !== g0) return;
      busy = false; settle();
    }
    async function doubleDown() {
      if (phase !== 'player' || busy || player.length !== 2 || chips < bet) return;
      push();
      chips -= bet; stake += bet; saveBank();
      player.push(draw()); Sound.place(); render();
      if (total(player) > 21) { phase = 'dealer'; hidden = false; return settle(); }
      await stand(true);
    }
    function settle() {
      phase = 'done'; hidden = false;
      const p = total(player), d = total(dealer);
      const pBJ = p === 21 && player.length === 2;
      const dBJ = d === 21 && dealer.length === 2;
      let res, payout = 0, text = '', t = '';
      if (p > 21) { res = 'l'; text = 'Bust — ' + p + ' is over.'; t = 'bad'; }
      else if (pBJ && dBJ) { res = 'd'; payout = stake; text = 'Two blackjacks — push.'; }
      else if (pBJ) { res = 'w'; payout = stake * 2.5; text = 'Blackjack — ' + Math.round(stake * 1.5) + ' profit.'; t = 'good'; }
      else if (dBJ) { res = 'l'; text = 'Dealer has blackjack.'; t = 'bad'; }
      else if (d > 21) { res = 'w'; payout = stake * 2; text = 'Dealer busts at ' + d + '. You win ' + stake + '.'; t = 'good'; }
      else if (p > d) { res = 'w'; payout = stake * 2; text = p + ' beats ' + d + '. You win ' + stake + '.'; t = 'good'; }
      else if (p < d) { res = 'l'; text = d + ' beats ' + p + '. The house takes it.'; t = 'bad'; }
      else { res = 'd'; payout = stake; text = 'Push at ' + p + '.'; }
      chips += payout; saveBank();
      settled = res;
      setMsg(text, t);
      render();
      status(res === 'w' ? 'You win' : res === 'l' ? 'Dealer wins' : 'Push',
             res === 'w' ? 'win' : res === 'l' ? 'lose' : 'draw');
      if (res === 'w') Sound.win(); else if (res === 'l') Sound.lose(); else Sound.draw();
      ctx.record(res);
    }
    function advice(pv, soft, up, canDouble) {
      const D = () => canDouble ? 'double' : 'hit';
      if (!soft) {
        if (pv >= 17) return 'stand';
        if (pv >= 13) return up <= 6 ? 'stand' : 'hit';
        if (pv === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
        if (pv === 11) return D();
        if (pv === 10) return up <= 9 ? D() : 'hit';
        if (pv === 9) return up >= 3 && up <= 6 ? D() : 'hit';
        return 'hit';
      }
      if (pv >= 19) return 'stand';
      if (pv === 18) { if (up >= 3 && up <= 6) return D(); if (up === 2 || up === 7 || up === 8) return 'stand'; return 'hit'; }
      if (pv === 17) return up >= 3 && up <= 6 ? D() : 'hit';
      if (pv >= 15) return up >= 4 && up <= 6 ? D() : 'hit';
      return up >= 5 && up <= 6 ? D() : 'hit';
    }
    function push() {
      hist.push({
        chips, bet, stake, phase, hidden, msg, tone, settled,
        shoe: shoe.slice(), dealer: dealer.slice(), player: player.slice()
      });
      if (hist.length > 60) hist.shift();
    }
    function undo() {
      const s = hist.pop();
      if (!s) { setMsg('Nothing to roll back — deal a hand first.', ''); render(); return; }
      gen++;
      busy = false;
      if (settled && settled !== s.settled) ctx.unrecord(settled);
      chips = s.chips; bet = s.bet; stake = s.stake; phase = s.phase;
      hidden = s.hidden; msg = s.msg; tone = s.tone; settled = s.settled;
      shoe = s.shoe; dealer = s.dealer; player = s.player;
      saveBank();
      render();
      status(phase === 'player' ? 'Your move' : 'Place your bet', 'you');
    }
    function hint() {
      if (phase !== 'player' || !player.length) { setMsg('Deal a hand first.', ''); render(); return; }
      const a = advice(total(player), isSoft(player), worth(dealer[0]), player.length === 2 && chips >= bet);
      const say = a === 'double' && (player.length !== 2 || chips < bet) ? 'hit (double not available)' : a;
      setMsg('Basic play says: ' + say + '.', '');
      render(); Sound.click();
    }

    setMsg('Pick a bet and deal.', '');
    render(); status('Place your bet', 'you');
    return { undo, hint };
  }
};

/* ============================================================
   9. POKER — heads-up hold'em, fixed limit
   ============================================================ */
const poker = (() => {
  const CATS = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight',
    'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const label = r => r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);

  // seven cards in, [category, tiebreak...] out — bigger wins, compare lexicographically
  function rank(cards) {
    const cnt = new Array(15).fill(0);
    const suits = [[], [], [], []];
    cards.forEach(c => {
      const r = c.r === 1 ? 14 : c.r;      // ace high while counting, low in a wheel straight
      cnt[r]++;
      suits[c.s].push(r);
    });
    let flush = null;
    for (let s = 0; s < 4; s++) if (suits[s].length >= 5) flush = suits[s];
    function topStraight(ranks) {
      const have = new Set(ranks);
      if (have.has(14)) have.add(1);
      for (let hi = 14; hi >= 5; hi--) {
        let ok = true;
        for (let k = 0; k < 5; k++) if (!have.has(hi - k)) { ok = false; break; }
        if (ok) return hi;
      }
      return 0;
    }
    if (flush) {
      const sf = topStraight(flush);
      if (sf) return [8, sf];
    }
    const groups = [];
    for (let r = 14; r >= 2; r--) if (cnt[r]) groups.push([r, cnt[r]]);
    groups.sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
    const quad = groups.find(g => g[1] === 4);
    if (quad) {
      const kick = groups.filter(g => g[0] !== quad[0]).map(g => g[0])[0] || 0;
      return [7, quad[0], kick];
    }
    const trips = groups.filter(g => g[1] >= 3);
    const pairs = groups.filter(g => g[1] >= 2);
    if (trips.length >= 2) return [6, trips[0][0], trips[1][0]];
    if (trips.length === 1 && pairs.length >= 2) {
      return [6, trips[0][0], pairs.filter(g => g[0] !== trips[0][0])[0][0]];
    }
    if (flush) {
      flush.sort((a, b) => b - a);
      return [5].concat(flush.slice(0, 5));
    }
    const st = topStraight(cards.map(c => c.r === 1 ? 14 : c.r));
    if (st) return [4, st];
    if (trips.length === 1) {
      return [3, trips[0][0]].concat(groups.filter(g => g[0] !== trips[0][0]).map(g => g[0]).slice(0, 2));
    }
    if (pairs.length >= 2) {
      const kick = groups.filter(g => g[0] !== pairs[0][0] && g[0] !== pairs[1][0]).map(g => g[0])[0] || 0;
      return [2, pairs[0][0], pairs[1][0], kick];
    }
    if (pairs.length === 1) {
      return [1, pairs[0][0]].concat(groups.filter(g => g[0] !== pairs[0][0]).map(g => g[0]).slice(0, 3));
    }
    return [0].concat(groups.map(g => g[0]).slice(0, 5));
  }
  function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  // preflop only: no five cards yet, so score the two hole cards instead
  function preScore(cards) {
    const h = cards.map(c => c.r === 1 ? 14 : Math.min(10, c.r));
    const hi = Math.max(h[0], h[1]), lo = Math.min(h[0], h[1]);
    const suited = cards[0].s === cards[1].s, pair = cards[0].r === cards[1].r;
    let s = (hi / 14) * 0.34 + (lo / 14) * 0.18;
    if (pair) s = 0.36 + (hi / 14) * 0.42;
    if (suited) s += 0.06;
    if (hi - lo === 1) s += 0.05;
    else if (hi - lo === 2 && suited) s += 0.02;
    return Math.min(0.98, s);
  }

  return {
    id: 'pk', name: 'Poker',
    tag: 'hold them',
    hideMode: true,
    blurb: 'Heads-up hold\'em against Talia: two hole cards, five shared, fixed-limit betting. Blinds 10/20, big bet 40.',
    rules: 'Heads-up Texas hold\'em, fixed limit. Blinds 10/20; bets and raises are 20 before the turn and 40 after, four raises a street. Best five of your seven cards wins at showdown, or take the pot when the other player folds. Your chips carry over between hands — 500 each, refilled when someone goes broke.',
    mount(ctx) {
      const START = 500, SB = 10, BB = 20, SMALL = 20, BIG = 40, MAX_RAISES = 4;
      const wrap = mk('div', 'bj pk');
      ctx.boardEl.appendChild(wrap);
      let bank = Array.isArray(store.pok) && store.pok.length === 2 ? store.pok.slice() : [START, START];
      if (bank[0] < BB || bank[1] < BB) bank = [START, START];
      let deck = [], board = [], hole = [[], []], pot = 0, bets = [0, 0];
      let street = 0, button = 0, toAct = 0, acted = [false, false], raises = 0;
      let allIn = [false, false], shown = [false, false], phase = 'idle';
      let msg = '', tone = '', busy = false, over = false, recorded = null;
      let hist = [], gen = 0;

      const dlbl = mk('div', 'rowlbl');
      const dhand = mk('div', 'hand');
      const blbl = mk('div', 'rowlbl');
      const bhand = mk('div', 'hand');
      const msgEl = mk('div', 'msg');
      const plbl = mk('div', 'rowlbl');
      const phand = mk('div', 'hand');
      const bar = mk('div', 'bjbar');
      const bankEl = mk('div', 'bank');
      wrap.appendChild(dlbl); wrap.appendChild(dhand);
      wrap.appendChild(blbl); wrap.appendChild(bhand);
      wrap.appendChild(msgEl);
      wrap.appendChild(plbl); wrap.appendChild(phand);
      wrap.appendChild(bar); wrap.appendChild(bankEl);

      const saveBank = () => { store.pok = bank.slice(); save(); };
      function setMsg(t, k) { msg = t; tone = k || ''; }
      const need = () => Math.max(bets[0], bets[1]);
      const unit = () => street >= 2 ? BIG : SMALL;
      const callFor = i => Math.max(0, Math.min(need() - bets[i], bank[i]));

      function paintCards() {
        dhand.innerHTML = '';
        for (let k = 0; k < Math.max(2, hole[1].length); k++) {
          const c = hole[1][k];
          dhand.appendChild(shown[1] && c ? cardNode(label(c.r), c.s) : cardNode('', 0, true));
        }
        bhand.innerHTML = '';
        for (let k = 0; k < 5; k++) {
          const c = board[k];
          if (c) bhand.appendChild(cardNode(label(c.r), c.s));
          else {
            const e = mk('div', 'pcard slot');
            bhand.appendChild(e);
          }
        }
        phand.innerHTML = '';
        hole[0].forEach(c => phand.appendChild(cardNode(label(c.r), c.s)));
        dlbl.innerHTML = '<span>Talia</span><b>' + bank[1] + '</b>';
        blbl.innerHTML = '<span>Board</span><b>' + (board.length ? board.length + ' cards' : 'preflop') + '</b>';
        plbl.innerHTML = '<span>You</span><b>' + bank[0] + '</b>';
      }
      function paintBar() {
        bar.innerHTML = '';
        if (phase !== 'play') {
          const d = mk('button', 'btn primary', phase === 'done' ? 'Next hand' : 'Deal');
          d.type = 'button';
          d.onclick = () => { Sound.click(); deal(); };
          bar.appendChild(d);
          return;
        }
        if (toAct !== 0) {
          bar.appendChild(mk('div', 'bank', 'Talia is thinking…'));
          return;
        }
        const call = callFor(0);
        const f = mk('button', 'btn', 'Fold'); f.type = 'button';
        f.onclick = () => human('fold');
        bar.appendChild(f);
        if (call > 0) {
          const c = mk('button', 'btn primary', 'Call ' + call); c.type = 'button';
          c.onclick = () => human('call');
          bar.appendChild(c);
        } else {
          const c = mk('button', 'btn primary', 'Check'); c.type = 'button';
          c.onclick = () => human('check');
          bar.appendChild(c);
        }
        const canRaise = raises < MAX_RAISES && bank[0] > call;
        const raiseTo = need() + unit();
        const r = mk('button', 'btn', (need() > 0 ? 'Raise to ' : 'Bet ') + raiseTo);
        r.type = 'button';
        r.disabled = !canRaise;
        r.onclick = () => human(need() > 0 ? 'raise' : 'bet');
        bar.appendChild(r);
      }
      function paint() {
        paintCards();
        paintBar();
        msgEl.textContent = msg;
        msgEl.className = 'msg' + (tone ? ' ' + tone : '');
        bankEl.innerHTML = 'Pot <b>' + pot + '</b> · blinds ' + SB + '/' + BB +
          ' · ' + (over ? 'hand over' : (street === 0 ? 'preflop' : ['flop', 'turn', 'river'][street - 1]));
      }
      function status(text, kind) { ctx.setStatus(text, kind); }

      function post(i, amount) {
        const pay = Math.min(amount, bank[i]);
        bank[i] -= pay; bets[i] += pay; pot += pay;
        if (bank[i] === 0) allIn[i] = true;
      }
      function deal() {
        if (busy) return;
        if (bank[0] < BB || bank[1] < BB) bank = [START, START];
        deck = [];
        for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s });
        for (let i = deck.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
        board = []; pot = 0; bets = [0, 0]; street = 0; raises = 0;
        acted = [false, false]; allIn = [false, false]; shown = [false, false];
        over = false; recorded = null; hist = []; gen++; busy = false;
        button = phase === 'idle' ? button : 1 - button;
        post(button, SB);
        post(1 - button, BB);
        hole[0] = [deck.pop(), deck.pop()];
        hole[1] = [deck.pop(), deck.pop()];
        phase = 'play';
        toAct = button;
        setMsg(toAct === 0 ? 'Preflop. You are first — call, raise or fold.' : 'Preflop. Talia is first.', '');
        saveBank();
        paint(); status('Hand in play', 'you'); Sound.place();
        if (toAct === 1) aiTurn();
      }
      function finish(winner, text, res) {
        over = true; phase = 'done'; shown = [true, true];
        if (winner === -1) {
          const half = Math.floor(pot / 2);
          bank[0] += half; bank[1] += pot - half;
        } else bank[winner] += pot;
        const broke = bank[0] < BB || bank[1] < BB;
        if (broke) bank = [START, START];
        saveBank();
        setMsg(text, winner === 0 ? 'good' : winner === 1 ? 'bad' : '');
        paint();
        status(winner === 0 ? 'You take the pot' : winner === 1 ? 'Talia takes the pot' : 'Split pot',
          winner === 0 ? 'win' : winner === 1 ? 'lose' : 'draw');
        Sound[winner === 0 ? 'win' : winner === 1 ? 'lose' : 'draw']();
        recorded = res;
        ctx.record(res);
        if (broke) setTimeout(() => { setMsg('Someone went broke — both stacks are back to ' + START + '.', ''); paint(); }, 900);
      }
      function showdown() {
        shown = [true, true];
        const a = rank(hole[0].concat(board)), b = rank(hole[1].concat(board));
        const c = cmp(a, b);
        const mine = CATS[a[0]].toLowerCase(), hers = CATS[b[0]].toLowerCase();
        const other = mine === hers ? '' : ' She had ' + hers + '.';
        if (c > 0) finish(0, 'You win with ' + mine + '.' + other, 'w');
        else if (c < 0) finish(1, 'Talia wins with ' + hers +
          (mine === hers ? ' — her kickers were better.' : ' — you had ' + mine + '.'), 'l');
        else finish(-1, 'Split pot — ' + mine + ' each.', 'd');
      }
      function nextStreet() {
        bets = [0, 0]; acted = [false, false]; raises = 0;
        street++;
        if (street === 1) { board.push(deck.pop(), deck.pop(), deck.pop()); Sound.place(); }
        else if (street === 2 || street === 3) { board.push(deck.pop()); Sound.place(); }
        if (street > 3) { showdown(); return; }
        toAct = 1 - button;
        setMsg((street === 1 ? 'Flop' : street === 2 ? 'Turn' : 'River') + ' — ' +
          (toAct === 0 ? 'your move.' : 'Talia to act.'), '');
        paint();
        if (toAct === 1) aiTurn();
      }
      function runOut() {
        const g0 = gen;
        const tick = () => {
          if (gen !== g0 || !ctx.alive() || over) return;
          if (street >= 3) { showdown(); return; }
          bets = [0, 0]; acted = [false, false]; raises = 0; street++;
          if (street === 1) board.push(deck.pop(), deck.pop(), deck.pop());
          else board.push(deck.pop());
          Sound.place(); paint();
          setTimeout(tick, 520);
        };
        setMsg('All in — the board runs out.', '');
        paint();
        setTimeout(tick, 520);
      }
      function nextTurn(from) {
        if (over) return;
        if (allIn[0] || allIn[1]) { runOut(); return; }
        if (acted[0] && acted[1] && bets[0] === bets[1]) { nextStreet(); return; }
        toAct = 1 - from;
        if (toAct === 0) { setMsg(need() > bets[0] ? 'Your move — ' + callFor(0) + ' to call.' : 'Checked to you.', ''); paint(); }
        else { paint(); aiTurn(); }
      }
      function act(i, kind) {
        if (over || phase !== 'play' || toAct !== i) return;
        if (kind === 'fold') {
          finish(1 - i, i === 0 ? 'You fold — Talia takes the pot.' : 'Talia folds — the pot is yours.', i === 0 ? 'l' : 'w');
          return;
        }
        const call = callFor(i);
        if (kind === 'check') {
          if (call > 0) return;
          acted[i] = true;
        } else if (kind === 'call') {
          bank[i] -= call; bets[i] += call; pot += call;
          if (bank[i] === 0) allIn[i] = true;
          acted[i] = true;
          Sound.place();
        } else {
          const pay = Math.min(need() + unit() - bets[i], bank[i]);
          bank[i] -= pay; bets[i] += pay; pot += pay;
          if (bank[i] === 0) allIn[i] = true;
          acted[i] = true; acted[1 - i] = false; raises++;
          Sound.capture();
        }
        saveBank();
        paint();
        nextTurn(i);
      }
      function strength(i) {
        const cards = hole[i].concat(board);
        if (cards.length < 5) return preScore(hole[i]);
        const v = rank(cards);
        const base = [0.16, 0.36, 0.55, 0.72, 0.8, 0.85, 0.91, 0.96, 0.99][v[0]];
        return Math.min(1, base + (v[1] || 0) / 300);
      }
      function decide() {
        const s = strength(1);
        const call = callFor(1);
        const aggro = [0.3, 0.46, 0.62][ctx.diff] || 0.46;
        const nerve = [0.1, 0.02, -0.06][ctx.diff] || 0.02;
        if (call === 0) {
          return raises < MAX_RAISES && s > 0.58 - aggro * 0.2 && Math.random() < 0.5 + aggro * 0.35
            ? 'bet' : 'check';
        }
        if (raises < MAX_RAISES && s > 0.86 && Math.random() < 0.3 + aggro * 0.45) return 'raise';
        const potOdds = call / (pot + call);
        return s >= potOdds + nerve ? 'call' : 'fold';
      }
      function aiTurn() {
        if (over || toAct !== 1) return;
        const g0 = gen;
        busy = true;
        paint();
        setTimeout(() => {
          if (gen !== g0 || !ctx.alive() || over || toAct !== 1) return;
          busy = false;
          act(1, decide());
        }, 560 + Math.random() * 420);
      }
      function human(kind) {
        if (phase !== 'play' || toAct !== 0 || busy) return;
        hist.push(snap());
        act(0, kind);
      }
      function snap() {
        return {
          bank: bank.slice(), deck: deck.slice(), board: board.slice(),
          hole: hole.map(h => h.slice()), pot, bets: bets.slice(), street, button,
          toAct, acted: acted.slice(), raises, allIn: allIn.slice(),
          shown: shown.slice(), phase, msg, tone, over, recorded
        };
      }
      function undo() {
        const s = hist.pop();
        if (!s) { setMsg('Nothing to roll back yet.', ''); paint(); return; }
        gen++;
        busy = false;
        if (recorded && recorded !== s.recorded) { ctx.unrecord(recorded); }
        bank = s.bank; deck = s.deck; board = s.board; hole = s.hole; pot = s.pot;
        bets = s.bets; street = s.street; button = s.button; toAct = s.toAct;
        acted = s.acted; raises = s.raises; allIn = s.allIn; shown = s.shown;
        phase = s.phase; over = s.over; recorded = s.recorded;
        saveBank();
        setMsg('Rolled back.', '');
        paint();
        status('Your move', 'you');
      }
      function hint() {
        if (!hole[0].length) { setMsg('Deal a hand first.', ''); paint(); return; }
        const cards = hole[0].concat(board);
        const call = phase === 'play' ? callFor(0) : 0;
        let say;
        if (cards.length < 5) {
          const s = preScore(hole[0]);
          say = s > 0.62 ? 'a premium pair of hole cards' : s > 0.45 ? 'a playable preflop hand' : 'a weak preflop hand';
        } else {
          say = 'you have ' + CATS[rank(cards)[0]].toLowerCase();
        }
        const why = call > 0 ? ' — ' + call + ' to call, pot ' + pot + '.' : ' — the check is free.';
        setMsg('Hint: ' + say + why, '');
        paint(); Sound.click();
      }

      window.__nxPoker = {
        rank, cmp, cats: CATS,
        get state() {
          return {
            phase, street, pot, bank: bank.slice(), bets: bets.slice(),
            board: board.slice(), hole: hole.map(h => h.slice()),
            toAct, over, button, raises, shown: shown.slice(), recorded
          };
        },
        deal, human, undo, hint, snap,
        aiStep(kind) { if (phase === 'play' && toAct === 1) { busy = false; act(1, kind || decide()); } },
        setBank(v) { bank = v.slice(); saveBank(); paint(); }
      };

      setMsg('Everyone starts with ' + START + '. Blinds 10/20, heads-up.', '');
      paint();
      status('Deal a hand', 'you');
      return { undo, hint };
    }
  };
})();

/* ============================================================
   10. BIG TWO
   ============================================================ */
const bigTwo = (() => {
  const RANKS = r => r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : r === 14 ? 'A' : r === 15 ? '2' : String(r);
  const KIND = { 1: 'single', 2: 'pair', 3: 'triple', 4: 'straight', 5: 'flush', 6: 'full house', 7: 'four with one', 8: 'straight flush' };
  const val = c => c.r * 4 + c.s;
  const cmp = (a, b) => val(a) - val(b);

  function makeDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 3; r <= 15; r++) d.push({ r, s });
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function analyze(cs) {
    const n = cs.length;
    if (n === 1) return { kind: 1, size: 1, key: val(cs[0]), cards: cs };
    if (n === 2) {
      if (cs[0].r !== cs[1].r) return null;
      return { kind: 2, size: 2, key: Math.max(val(cs[0]), val(cs[1])), cards: cs };
    }
    if (n === 3) {
      if (!(cs[0].r === cs[1].r && cs[1].r === cs[2].r)) return null;
      return { kind: 3, size: 3, key: Math.max(val(cs[0]), val(cs[1]), val(cs[2])), cards: cs };
    }
    if (n !== 5) return null;
    const ranks = cs.map(c => c.r).slice().sort((a, b) => a - b);
    const uniq = [...new Set(ranks)];
    const sameSuit = cs.every(c => c.s === cs[0].s);
    const straight = uniq.length === 5 && ranks[4] <= 14 && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
    const counts = {};
    for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.entries(counts).map(([r, c]) => [+r, c]);
    const four = groups.find(x => x[1] === 4);
    const three = groups.find(x => x[1] === 3);
    const pair = groups.find(x => x[1] === 2);
    if (straight && sameSuit) return { kind: 8, size: 5, key: ranks[4], cards: cs };
    if (four) return { kind: 7, size: 5, key: four[0], cards: cs };
    if (three && pair) return { kind: 6, size: 5, key: three[0], cards: cs };
    if (sameSuit) return { kind: 5, size: 5, key: 0, order: ranks, cards: cs };
    if (straight) return { kind: 4, size: 5, key: ranks[4], cards: cs };
    return null;
  }
  function beats(a, b) {
    if (!b) return true;
    if (a.size !== b.size) return false;
    if (a.size === 5) {
      if (a.kind !== b.kind) return a.kind > b.kind;
      if (a.kind === 5) {
        for (let i = 4; i >= 0; i--) if (a.order[i] !== b.order[i]) return a.order[i] > b.order[i];
        return false;
      }
      return a.key > b.key;
    }
    return a.key > b.key;
  }
  function allMoves(hand) {
    const out = [], n = hand.length;
    for (let i = 0; i < n; i++) out.push(analyze([hand[i]]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (hand[i].r === hand[j].r) out.push(analyze([hand[i], hand[j]]));
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      if (hand[i].r === hand[j].r && hand[j].r === hand[k].r) out.push(analyze([hand[i], hand[j], hand[k]]));
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
        const m = analyze([hand[a], hand[b], hand[c], hand[d], hand[e]]);
        if (m) out.push(m);
      }
    return out.filter(Boolean);
  }
  function legalMoves(hand, lastPlay, must3) {
    const want = lastPlay ? lastPlay.size : null;
    let res = allMoves(hand).filter(m => (want ? m.size === want : true) && beats(m, lastPlay));
    if (must3) res = res.filter(m => m.cards.some(c => c.r === 3 && c.s === 0));
    return res;
  }
  function aiPick(hand, lastPlay, must3, diff) {
    const legal = legalMoves(hand, lastPlay, must3);
    if (!legal.length) return null;
    legal.sort((a, b) => (a.cards.length - b.cards.length) || (a.kind - b.kind) || (a.key - b.key));
    const out = legal.find(m => m.cards.length === hand.length);
    if (out) return out;
    if (!lastPlay) return legal.find(m => m.kind < 7) || legal[0];
    const best = legal[0];
    if (lastPlay.size !== 5 && best.key >= 56 && diff >= 1 && hand.length > 3) return null;
    if (best.kind >= 7 && diff === 2 && hand.length > 2) return null;
    return best;
  }

  return {
    id: 'big2',
    name: 'Big Two',
    tag: 'the climbing game',
    hideMode: true,
    blurb: 'Thirteen cards, three rivals, and the deuce sitting on top of the whole deck. Beat the play or pass.',
    rules: 'Shed your hand first. A play must match the size: single, pair, triple, or a five-card hand where straight &lt; flush &lt; full house &lt; four-with-one &lt; straight flush. Suits break ties ♦ &lt; ♣ &lt; ♥ &lt; ♠. The holder of 3♦ leads, and it must be in the first play.',
    mount(ctx) {
      const NAMES = ['You', 'Wen', 'Mei', 'Kai'];
      const diff = ctx.diff;
      let hands = [[], [], [], []];
      let turn = 0, lastPlay = null, lastPlayer = -1, passes = 0, over = false, must3 = true;
      let passed = [false, false, false, false];
      let sel = new Set(), undoState = null, dead = false;

      const deck = shuffle(makeDeck());
      for (let i = 0; i < 52; i++) hands[i % 4].push(deck[i]);
      for (const h of hands) h.sort(cmp);
      turn = hands.findIndex(h => h.some(c => c.r === 3 && c.s === 0));

      const wrap = mk('div', 'bt');
      ctx.boardEl.appendChild(wrap);
      const top = mk('div', 'opp top');
      const midEl = mk('div', 'bt-mid');
      const left = mk('div', 'opp left');
      const spot = mk('div', 'playspot');
      const playCards = mk('div', 'playcards');
      const playLbl = mk('div', 'playlbl');
      const right = mk('div', 'opp right');
      const myHand = mk('div', 'myhand');
      const lbl = mk('div', 'turnlbl');
      const bar = mk('div', 'btbar');
      spot.appendChild(playCards); spot.appendChild(playLbl);
      midEl.appendChild(left); midEl.appendChild(spot); midEl.appendChild(right);
      wrap.appendChild(top); wrap.appendChild(midEl);
      wrap.appendChild(myHand); wrap.appendChild(lbl); wrap.appendChild(bar);

      const myTurn = () => !over && turn === 0;
      function newTrick() {
        lastPlay = null; passes = 0;
        passed = [false, false, false, false];
      }
      function paintOpp(el, idx) {
        const n = hands[idx].length;
        el.innerHTML = '<span class="nm">' + NAMES[idx] + '</span><div class="minihand"></div><span class="cnt">' + n + '</span>';
        const mh = el.querySelector('.minihand');
        for (let k = 0; k < Math.min(n, 5); k++) mh.appendChild(cardNode('', 0, true));
        el.classList.toggle('passed', passed[idx]);
        el.classList.toggle('turn', turn === idx && !over);
      }
      function paintHand() {
        myHand.innerHTML = '';
        hands[0].forEach((c, i) => {
          const el = cardNode(RANKS(c.r), c.s);
          if (sel.has(i)) el.classList.add('sel');
          el.addEventListener('click', () => toggle(i));
          myHand.appendChild(el);
        });
      }
      function paintCenter() {
        playCards.innerHTML = '';
        if (lastPlay) {
          lastPlay.cards.slice().sort(cmp).forEach(c => playCards.appendChild(cardNode(RANKS(c.r), c.s)));
          playLbl.textContent = (lastPlayer === 0 ? 'your play' : NAMES[lastPlayer] + ' plays') + ' · ' + KIND[lastPlay.kind];
        } else {
          playLbl.textContent = turn === 0 ? 'your lead — anything goes' : NAMES[turn] + ' leads';
        }
      }
      function paintBar() {
        bar.innerHTML = '';
        const play = mk('button', 'btn primary', 'Play');
        play.type = 'button';
        play.disabled = !myTurn() || !sel.size;
        play.onclick = () => playSelection();
        const pass = mk('button', 'btn', 'Pass');
        pass.type = 'button';
        pass.disabled = !myTurn() || !lastPlay;
        pass.onclick = () => doPass(0);
        bar.appendChild(play); bar.appendChild(pass);
        lbl.textContent = over ? '' : myTurn()
          ? (lastPlay ? 'beat it or pass' : 'your lead')
          : NAMES[turn] + ' is playing…';
      }
      function sync() {
        if (over) return;
        ctx.setStatus(myTurn() ? 'Your turn' : NAMES[turn] + ' is thinking…', myTurn() ? 'you' : 'ai');
      }
      function render() {
        paintOpp(right, 1); paintOpp(top, 2); paintOpp(left, 3);
        paintHand(); paintCenter(); paintBar();
      }
      function toggle(i) {
        if (!myTurn()) return;
        if (sel.has(i)) sel.delete(i); else sel.add(i);
        Sound.click(); paintHand(); paintBar();
      }
      function snapshot() {
        return JSON.stringify({ hands, lastPlay, lastPlayer, passes, turn, must3, passed });
      }
      function doPlay(i, combo) {
        hands[i] = hands[i].filter(c => !combo.cards.some(t => t.r === c.r && t.s === c.s));
        lastPlay = combo; lastPlayer = i; passes = 0; must3 = false;
        passed = [false, false, false, false];
        sel.clear();
        Sound.chip();
        if (!hands[i].length) return finish(i);
        turn = (i + 1) % 4;
        render(); sync(); next();
      }
      function finish(i) {
        over = true; sel.clear(); render();
        if (i === 0) { ctx.setStatus('You went out', 'win'); Sound.win(); ctx.end('w', 'You went out first'); }
        else { ctx.setStatus(NAMES[i] + ' went out', 'lose'); Sound.lose(); ctx.end('l', NAMES[i] + ' went out first'); }
      }
      function passBy(i) {
        passed[i] = true; passes++;
        Sound.pass();
        if (passes >= 3) { const lead = lastPlayer; newTrick(); turn = lead; }
        else turn = (i + 1) % 4;
        render(); sync(); next();
      }
      function doPass(i) {
        if (over) return;
        if (i === 0) {
          if (!myTurn() || !lastPlay) return;
          undoState = snapshot(); sel.clear();
        }
        passBy(i);
      }
      function playSelection() {
        if (!myTurn() || !sel.size) return;
        const cards = [...sel].map(i => hands[0][i]);
        const combo = analyze(cards);
        if (!combo) { ctx.flash('Not a legal hand'); Sound.click(); return; }
        if (must3 && !cards.some(c => c.r === 3 && c.s === 0)) { ctx.flash('The first play must include 3♦'); return; }
        if (!beats(combo, lastPlay)) { ctx.flash('Does not beat ' + (lastPlay ? KIND[lastPlay.kind] : 'the play')); return; }
        undoState = snapshot();
        doPlay(0, combo);
      }
      async function aiTurn() {
        await aiDelay();
        if (!ctx.alive() || over || turn === 0) return;
        const combo = aiPick(hands[turn], lastPlay, must3, diff);
        if (!combo) passBy(turn); else doPlay(turn, combo);
      }
      function next() {
        if (over) return;
        if (turn === 0) { render(); sync(); return; }
        aiTurn();
      }
      function undo() {
        if (!undoState || !live) return;
        const d = JSON.parse(undoState);
        hands = d.hands; lastPlay = d.lastPlay; lastPlayer = d.lastPlayer;
        passes = d.passes; turn = d.turn; must3 = d.must3; passed = d.passed;
        over = false; sel.clear(); undoState = null;
        ctx.clearBanner(); render(); sync();
      }
      function hint() {
        if (!myTurn()) return;
        const legal = legalMoves(hands[0], lastPlay, must3);
        if (!legal.length) { ctx.flash('Nothing beats it — pass'); return; }
        legal.sort((a, b) => (a.kind - b.kind) || (a.key - b.key));
        const m = legal[0];
        sel.clear();
        m.cards.forEach(c => {
          const i = hands[0].findIndex(h => h.r === c.r && h.s === c.s);
          if (i >= 0) sel.add(i);
        });
        paintHand(); paintBar();
        Sound.click();
      }

      render(); sync();
      if (turn !== 0) next();
      return { undo, hint };
    }
  };
})();

/* ============================================================
   11. STICKMAN PARTY — eight real-time duels, two players, one keyboard
   ============================================================ */
const stickParty = (() => {
  const W = 720, H = 420;
  const GOLD = '#ffcf5c', ICE = '#6ee7ff', HOT = '#ff5470', MAG = '#ff4fa3', INK = '#e9f2f6';
  const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  const SANS = '"Helvetica Neue",Helvetica,Arial,sans-serif';
  const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
  const PL = [
    { name: 'P1', color: GOLD, up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
      all: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] },
    { name: 'P2', color: ICE, up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      all: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'] }
  ];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const gap = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const ownerOf = code => (PL[0].all.indexOf(code) >= 0 ? 0 : PL[1].all.indexOf(code) >= 0 ? 1 : -1);

  /* ---------- drawing ---------- */
  function floor(c) {
    c.save();
    c.fillStyle = '#06080b';
    c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H * 0.04, 24, W / 2, H * 0.04, H * 1.2);
    g.addColorStop(0, 'rgba(28,58,76,.6)');
    g.addColorStop(0.55, 'rgba(12,20,28,.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  // neon bloom for one shape: wrap the draw in save()/restore()
  function neon(c, color, blur) {
    c.shadowColor = color;
    c.shadowBlur = blur == null ? 14 : blur;
  }

  // arcade marquee lettering: uppercase, wide tracking, centred on x
  function tracked(c, text, x, y, size, color, space, weight, family, blur) {
    c.save();
    c.font = (weight || '700') + ' ' + size + 'px ' + (family || SANS);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = color;
    if (blur) neon(c, color, blur);
    const chars = String(text).split('');
    const widths = chars.map(ch => c.measureText(ch).width);
    let total = space * (chars.length - 1);
    widths.forEach(w => { total += w; });
    let cursor = x - total / 2;
    chars.forEach((ch, i) => {
      c.fillText(ch, cursor, y);
      cursor += widths[i] + space;
    });
    c.restore();
  }

  // CRT: scanlines and a rounded vignette, always the last thing painted
  function crt(c) {
    c.save();
    c.globalAlpha = 0.07;
    c.fillStyle = '#000';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1.4);
    c.globalAlpha = 1;
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 1.02);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.6)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function shadow(c, x, y, rx) {
    c.save();
    c.globalAlpha = 0.32;
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(x, y, rx, rx * 0.32, 0, 0, 6.2832);
    c.fill();
    c.restore();
  }

  // the whole cast is a ball: x, y is the centre, r the radius.
  // opt: alpha, glow:false, squash (-1 tall … +1 flat), spin (rolling phase)
  function ball(c, x, y, r, color, o) {
    const opt = o || {};
    const sq = opt.squash || 0;
    const rx = r * (1 + sq * 0.14), ry = r * (1 - sq * 0.14);
    const a = opt.alpha == null ? 1 : opt.alpha;
    c.save();
    c.globalAlpha = a;
    if (opt.glow !== false) neon(c, color, r * 1.5);
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, 6.2832);
    c.fillStyle = color;
    c.fill();
    c.shadowBlur = 0;
    // body shading: light from the top left, dark rim — a circle, not a sticker
    const g = c.createRadialGradient(x - rx * 0.36, y - ry * 0.42, Math.max(1, r * 0.08),
      x, y, Math.max(rx, ry));
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(0.4, 'rgba(255,255,255,.1)');
    g.addColorStop(0.8, 'rgba(0,0,0,.05)');
    g.addColorStop(1, 'rgba(0,0,0,.4)');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.34)';
    c.lineWidth = Math.max(1, r * 0.08);
    c.stroke();
    // one dark mark that travels round the ball, so a moving ball reads as rolling
    if (opt.spin) {
      c.save();
      c.beginPath();
      c.ellipse(x, y, rx - 0.5, ry - 0.5, 0, 0, 6.2832);
      c.clip();
      c.globalAlpha = a * 0.5;
      c.fillStyle = '#000';
      c.beginPath();
      c.arc(x + Math.cos(opt.spin) * rx * 0.5, y + Math.sin(opt.spin) * ry * 0.46,
        r * 0.23, 0, 6.2832);
      c.fill();
      c.restore();
    }
    c.globalAlpha = a * 0.62;
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(x - rx * 0.32, y - ry * 0.4, r * 0.19, r * 0.13, -0.6, 0, 6.2832);
    c.fill();
    c.restore();
  }

  // a dim crowd along the top of the cabinet screen: rows of small balls
  function crowd(c, tick) {
    const n = 9, span = W - 96;
    for (let i = 0; i < n; i++) {
      const x = 48 + i * (span / (n - 1));
      const bob = Math.abs(Math.sin(tick * 2.1 + i * 1.7)) * 3.4;
      ball(c, x, 46 + bob, 6.5, i % 2 ? ICE : GOLD,
        { spin: tick * 2 + i, glow: false, alpha: 0.17 + (i % 3) * 0.03 });
    }
  }

  // soft stage light, for the sparse scenes
  function spotlight(c, cx, spread, height) {
    const g = c.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, 'rgba(255,236,190,.14)');
    g.addColorStop(0.65, 'rgba(255,236,190,.05)');
    g.addColorStop(1, 'rgba(255,236,190,0)');
    c.save();
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx - 46, 0);
    c.lineTo(cx + 46, 0);
    c.lineTo(cx + spread, height);
    c.lineTo(cx - spread, height);
    c.closePath();
    c.fill();
    c.restore();
  }

  function anvil(c, x, y, s, alpha) {
    c.save();
    c.globalAlpha = alpha == null ? 1 : alpha;
    c.translate(x, y);
    c.scale(s, s);
    c.fillStyle = '#3d3531';
    c.strokeStyle = '#776a5e';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-13, -9); c.lineTo(13, -9); c.lineTo(10, -2); c.lineTo(6, -2);
    c.lineTo(6, 9); c.lineTo(-6, 9); c.lineTo(-6, -2); c.lineTo(-10, -2);
    c.closePath();
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(0, -11, 4, Math.PI, 0);
    c.stroke();
    c.restore();
  }

  // dir = +1 when the rope is to the right of the ball
  function puller(c, x, y, dir, color, strain, phase) {
    const R = 17;
    const lean = (5 + strain * 9) * dir;
    const wob = Math.sin(phase * 9) * strain * 1.8;
    const cx = x + lean + wob, cy = y - R;
    shadow(c, x + lean * 0.5, y, 19);
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 3.4;
    c.lineCap = 'round';
    neon(c, color, 10);
    c.beginPath();
    c.moveTo(cx + dir * R * 0.62, cy - R * 0.22);
    c.lineTo(cx + dir * (R + 13), 302);
    c.stroke();
    c.restore();
    ball(c, cx, cy, R, color, { spin: phase * 6, squash: 0.35 + strain * 0.5 });
  }

  function veilFill(c, alpha) {
    c.save();
    c.fillStyle = 'rgba(9,8,7,' + alpha + ')';
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  function introOverlay(c, roundNo, total, name, hint, tLeft) {
    veilFill(c, 0.75);
    const n = clamp(Math.ceil(tLeft / 0.8), 1, 3);
    tracked(c, 'ROUND ' + roundNo + ' / ' + total, W / 2, 92, 14, MAG, 6, '700', MONO, 12);
    tracked(c, String(n), W / 2, 208, 110, GOLD, 0, '700', SANS, 28);
    tracked(c, name.toUpperCase(), W / 2, 300, 22, INK, 4, '700', SANS, 14);
    tracked(c, hint, W / 2, 334, 12, '#a9bcc6', 1, '400', MONO);
  }

  function resultOverlay(c, who, note) {
    veilFill(c, 0.7);
    const col = who == null ? INK : PL[who].color;
    tracked(c, who == null ? 'DRAW' : 'PLAYER ' + (who + 1), W / 2, 148, 15, col, 7, '700', MONO, 14);
    tracked(c, who == null ? 'NO POINTS' : 'TAKES THE ROUND', W / 2, 206, 38, INK, 2, '800', SANS, 18);
    if (note) tracked(c, String(note).toUpperCase(), W / 2, 266, 11, MAG, 2, '400', MONO, 8);
  }

  function pauseOverlay(c) {
    veilFill(c, 0.74);
    tracked(c, 'PAUSED', W / 2, H / 2 - 18, 44, GOLD, 4, '800', SANS, 22);
    tracked(c, 'CLICK THE SCREEN TO RESUME', W / 2, H / 2 + 32, 11, '#9fb3bd', 2, '400', MONO);
    tracked(c, 'ESC LEAVES THE CABINET', W / 2, H / 2 + 56, 10, '#6f8087', 2, '400', MONO);
  }

  function doneOverlay(c, scores, total, tick) {
    veilFill(c, 0.74);
    const who = scores[0] > scores[1] ? 0 : 1;
    tracked(c, 'MATCH OVER', W / 2, 128, 15, MAG, 7, '700', MONO, 14);
    tracked(c, 'PLAYER ' + (who + 1) + ' WINS', W / 2, 194, 40, PL[who].color, 2, '800', SANS, 22);
    tracked(c, scores[0] + ' – ' + scores[1], W / 2, 250, 30, INK, 6, '700', MONO, 16);
    tracked(c, 'BEST OF ' + total, W / 2, 284, 10, '#8fa3ad', 2, '400', MONO);
    if (Math.floor(tick * 1.4) % 2 === 0) {
      tracked(c, 'PRESS RESTART FOR ANOTHER MATCH', W / 2, 336, 10.5, GOLD, 2, '400', MONO, 8);
    }
  }

  function idleScene(c, tick) {
    floor(c);
    const pulse = 0.5 + 0.5 * Math.sin(tick * 2.2);
    c.save();
    c.globalAlpha = 0.24 + pulse * 0.26;
    c.strokeStyle = GOLD;
    c.lineWidth = 1.5;
    neon(c, GOLD, 20);
    c.beginPath();
    c.arc(W / 2, H / 2 + 6, 150, 0, 6.2832);
    c.stroke();
    c.restore();
    const hopA = Math.abs(Math.sin(tick * 3.4)), hopB = Math.abs(Math.sin(tick * 3.4 + 1.1));
    c.save();
    c.globalAlpha = 0.85;
    shadow(c, 128, 372, 28 - hopA * 8);
    shadow(c, 592, 372, 28 - hopB * 8);
    ball(c, 128, 372 - 30 - hopA * 26, 30, GOLD,
      { spin: tick * 3.2, squash: (1 - hopA) * 0.9 });
    ball(c, 592, 372 - 30 - hopB * 26, 30, ICE,
      { spin: -tick * 3.2, squash: (1 - hopB) * 0.9 });
    c.restore();
    tracked(c, '1 CREDIT', 78, 398, 9, '#6f8087', 2, '400', MONO);
    tracked(c, '2 PLAYERS', W - 78, 398, 9, '#6f8087', 2, '400', MONO);
  }

  /* ---------- 1. ring out ---------- */
  const RING = {
    id: 'ring', name: 'Ring out',
    hint: 'Shove your rival off the disc. The disc keeps shrinking.',
    make(S) {
      const CX = 360, CY = 218, PR = 19, LIMIT = 15;
      const st = { t: 0, R: 158, cool: 0, bits: [] };
      S.pl.forEach((p, i) => {
        p.x = CX + (i ? 66 : -66); p.y = CY; p.vx = p.vy = 0;
        p.alive = true; p.face = i ? Math.PI : 0; p.step = 0;
      });
      function move(p, i, dt) {
        let ax = (S.held(i, 'right') ? 1 : 0) - (S.held(i, 'left') ? 1 : 0);
        let ay = (S.held(i, 'down') ? 1 : 0) - (S.held(i, 'up') ? 1 : 0);
        if (ax || ay) {
          const m = Math.hypot(ax, ay);
          ax /= m; ay /= m;
          p.face = Math.atan2(ay, ax);
        }
        p.vx += ax * 780 * dt;
        p.vy += ay * 780 * dt;
        const f = Math.exp(-5.4 * dt);
        p.vx *= f; p.vy *= f;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 172) { p.vx = p.vx / sp * 172; p.vy = p.vy / sp * 172; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.step += sp * dt * 0.08;
      }
      return {
        st,
        update(dt) {
          st.t += dt;
          st.cool -= dt;
          st.R = Math.max(112, 158 - st.t * 5.2);
          S.pl.forEach((p, i) => { if (p.alive) move(p, i, dt); });
          const a = S.pl[0], b = S.pl[1];
          if (a.alive && b.alive) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 0.0001;
            if (d < PR * 2) {
              const nx = dx / d, ny = dy / d;
              const ov = PR * 2 - d;
              a.x -= nx * ov * 0.5; a.y -= ny * ov * 0.5;
              b.x += nx * ov * 0.5; b.y += ny * ov * 0.5;
              const sep = (a.vx * nx + a.vy * ny) - (b.vx * nx + b.vy * ny);
              if (sep > 0) {
                const j = sep * 1.2;
                a.vx -= nx * j * 0.5; a.vy -= ny * j * 0.5;
                b.vx += nx * j * 0.5; b.vy += ny * j * 0.5;
                if (st.cool <= 0) { Sound.chip(); st.cool = 0.22; }
              }
            }
          }
          S.pl.forEach(p => {
            if (!p.alive) return;
            if (gap(p.x, p.y, CX, CY) > st.R + 4) {
              p.alive = false;
              st.bits.push({ x: p.x, y: p.y, t: 0, c: p.color });
              Sound.drop();
            }
          });
          st.bits.forEach(bit => { bit.t += dt; });
          st.bits = st.bits.filter(bit => bit.t < 0.6);
          if (!a.alive || !b.alive) {
            S.finish(!a.alive && !b.alive ? null : (a.alive ? 0 : 1), 'Off the disc');
            return;
          }
          if (st.t > LIMIT) {
            const da = gap(a.x, a.y, CX, CY), db = gap(b.x, b.y, CX, CY);
            S.finish(Math.abs(da - db) < 8 ? null : (da < db ? 0 : 1), 'Closest to the middle');
          }
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          c.save();
          c.beginPath();
          c.arc(CX, CY, st.R, 0, 6.2832);
          const g = c.createRadialGradient(CX, CY - 50, 8, CX, CY, st.R);
          g.addColorStop(0, '#132532');
          g.addColorStop(0.68, '#0b1620');
          g.addColorStop(1, '#070d14');
          c.fillStyle = g;
          c.fill();
          c.strokeStyle = GOLD;
          c.lineWidth = 2.5;
          neon(c, GOLD, 18);
          c.stroke();
          c.shadowBlur = 0;
          c.setLineDash([6, 10]);
          c.lineWidth = 1;
          c.strokeStyle = 'rgba(110,231,255,.22)';
          c.beginPath();
          c.arc(CX, CY, Math.max(20, st.R * 0.55), 0, 6.2832);
          c.stroke();
          c.restore();
          const frac = clamp(st.t / LIMIT, 0, 1);
          c.save();
          c.lineWidth = 3.5;
          c.strokeStyle = frac > 0.72 ? MAG : GOLD;
          neon(c, frac > 0.72 ? MAG : GOLD, 12);
          c.beginPath();
          c.arc(CX, CY, st.R + 13, -1.5708, -1.5708 + 6.2832 * (1 - frac));
          c.stroke();
          c.restore();
          st.bits.forEach(bit => {
            c.save();
            c.globalAlpha = Math.max(0, 1 - bit.t / 0.6);
            c.strokeStyle = bit.c;
            c.lineWidth = 2;
            neon(c, bit.c, 10);
            c.beginPath();
            c.arc(bit.x, bit.y, 10 + bit.t * 60, 0, 6.2832);
            c.stroke();
            c.restore();
          });
          S.pl.forEach((p, i) => {
            if (!p.alive) return;
            shadow(c, p.x, p.y + PR, 16);
            ball(c, p.x, p.y, PR - 2, p.color, { spin: p.step });
            tracked(c, PL[i].name, p.x, p.y - PR - 11, 11, p.color, 2, '700', MONO, 8);
          });
        }
      };
    }
  };

  /* ---------- 2. anvils ---------- */
  const RAIN = {
    id: 'rain', name: 'Anvils',
    hint: 'The shadow is where an anvil lands. Last ball standing takes it.',
    make(S) {
      const B = { x: 44, y: 70, w: 632, h: 314 };
      const st = { t: 0, next: 0.85, drops: [], hits: [] };
      S.pl.forEach((p, i) => {
        p.x = 360 + (i ? 190 : -190); p.y = B.y + 120;
        p.vx = p.vy = 0; p.alive = true; p.step = 0;
      });
      function move(p, i, dt) {
        const tx = ((S.held(i, 'right') ? 1 : 0) - (S.held(i, 'left') ? 1 : 0)) * 196;
        const ty = ((S.held(i, 'down') ? 1 : 0) - (S.held(i, 'up') ? 1 : 0)) * 196;
        const k = Math.min(1, dt * 15);
        p.vx += (tx - p.vx) * k;
        p.vy += (ty - p.vy) * k;
        p.x = clamp(p.x + p.vx * dt, B.x + 14, B.x + B.w - 14);
        p.y = clamp(p.y + p.vy * dt, B.y + 14, B.y + B.h - 14);
        p.step += Math.hypot(p.vx, p.vy) * dt * 0.1;
      }
      function spawn() {
        const alive = S.pl.filter(p => p.alive);
        let x, y;
        if (alive.length && Math.random() < 0.75) {
          const p = pick(alive);
          x = clamp(p.x + p.vx * 0.2 + (Math.random() * 76 - 38), B.x + 26, B.x + B.w - 26);
          y = clamp(p.y + p.vy * 0.2 + (Math.random() * 76 - 38), B.y + 26, B.y + B.h - 26);
        } else {
          x = B.x + 40 + Math.random() * (B.w - 80);
          y = B.y + 40 + Math.random() * (B.h - 80);
        }
        st.drops.push({ x, y, t: 0, warn: 0.6, fall: 0.18, r: 32, done: false });
      }
      return {
        st, B,
        update(dt) {
          st.t += dt;
          S.pl.forEach((p, i) => { if (p.alive) move(p, i, dt); });
          st.next -= dt;
          if (st.next <= 0) {
            spawn();
            st.next = Math.max(0.3, 1.15 - st.t * 0.055);
          }
          st.drops.forEach(d => {
            d.t += dt;
            if (d.done || d.t < d.warn + d.fall) return;
            d.done = true;
            S.pl.forEach(p => {
              if (!p.alive) return;
              if (gap(p.x, p.y, d.x, d.y) < d.r) {
                p.alive = false;
                st.hits.push({ x: p.x, y: p.y, t: 0 });
                Sound.capture();
              }
            });
          });
          st.hits.forEach(h => { h.t += dt; });
          st.hits = st.hits.filter(h => h.t < 0.5);
          st.drops = st.drops.filter(d => d.t < d.warn + d.fall + 0.5);
          const alive = S.pl.filter(p => p.alive);
          if (alive.length < 2) {
            S.finish(alive.length === 1 ? S.pl.indexOf(alive[0]) : null,
              alive.length === 1 ? 'Last ball standing' : 'Both flattened');
            return;
          }
          if (st.t > 16) S.finish(null, 'Both survived the shower');
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          c.save();
          c.fillStyle = '#0a141b';
          rr(c, B.x, B.y, B.w, B.h, 12);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.4)';
          c.lineWidth = 1.5;
          neon(c, ICE, 12);
          c.stroke();
          c.shadowBlur = 0;
          c.strokeStyle = 'rgba(110,231,255,.07)';
          c.lineWidth = 1;
          rr(c, B.x + 7, B.y + 7, B.w - 14, B.h - 14, 9);
          c.stroke();
          c.fillStyle = 'rgba(255,255,255,.04)';
          for (let x = B.x + 34; x < B.x + B.w; x += 72) {
            for (let y = B.y + 34; y < B.y + B.h; y += 72) {
              c.beginPath();
              c.arc(x, y, 1.6, 0, 6.2832);
              c.fill();
            }
          }
          c.restore();
          st.drops.forEach(d => {
            if (!d.done) {
              const p = clamp(d.t / d.warn, 0, 1);
              c.save();
              c.beginPath();
              c.arc(d.x, d.y, d.r, 0, 6.2832);
              c.fillStyle = 'rgba(255,84,112,' + (0.06 + p * 0.18) + ')';
              c.fill();
              c.strokeStyle = 'rgba(255,84,112,' + (0.4 + p * 0.55) + ')';
              c.lineWidth = 1.8;
              neon(c, HOT, 8 + p * 10);
              c.stroke();
              c.restore();
              if (d.t > d.warn) {
                const f = (d.t - d.warn) / d.fall;
                anvil(c, d.x, d.y - 240 * (1 - f), 0.85 + f * 0.55, 1);
              }
            } else {
              const f = clamp((d.t - d.warn - d.fall) / 0.5, 0, 1);
              c.save();
              c.globalAlpha = 1 - f;
              c.strokeStyle = HOT;
              c.lineWidth = 2;
              c.beginPath();
              c.arc(d.x, d.y, d.r + f * 28, 0, 6.2832);
              c.stroke();
              c.restore();
            }
          });
          st.hits.forEach(h => {
            c.save();
            c.globalAlpha = Math.max(0, 1 - h.t / 0.5);
            c.strokeStyle = HOT;
            c.lineWidth = 2;
            c.beginPath();
            c.arc(h.x, h.y, 12 + h.t * 70, 0, 6.2832);
            c.stroke();
            c.restore();
          });
          S.pl.forEach((p, i) => {
            if (!p.alive) {
              tracked(c, PL[i].name + ' OUT', p.x, p.y - 8, 10, '#6f8087', 2, '700', MONO, 6);
              return;
            }
            shadow(c, p.x, p.y + 13, 16);
            ball(c, p.x, p.y, 14, p.color, { spin: p.step });
            tracked(c, PL[i].name, p.x, p.y - 26, 11, p.color, 2, '700', MONO, 8);
          });
        }
      };
    }
  };

  /* ---------- 3. the run ---------- */
  const RACE = {
    id: 'race', name: 'The run',
    hint: 'Left and right to dodge the barriers. First to the line wins.',
    make(S) {
      // the runner moves at SPEED, the world (barriers) at OBS = the same speed,
      // so a barrier is on screen for (352 - 86) / OBS ≈ 0.78 s … 1.05 s before it
      // reaches you. Crossing one lane costs w * 0.32 / CROSS ≈ 0.23 s, and the
      // spawner never opens a gap more than one lane from the last one, so every
      // barrier can be cleared by a single lane change inside that window.
      const GOAL = 3400, SPEED = 330, OBS = 340, TOP = 92, BOT = 380;
      const CROSS = 430, R = 13, LANE_W = 0.24, LANES = [0.18, 0.5, 0.82];
      const tracks = [0, 1].map(i => ({
        x: i ? 380 : 30, w: 310, obs: [], next: 0.55 + i * 0.26, dist: 0, stun: 0, free: null
      }));
      const laneX = (tr, lane) => tr.x + tr.w * LANES[lane];
      S.pl.forEach((p, i) => {
        p.x = tracks[i].x + tracks[i].w / 2;
        p.y = 352; p.alive = true; p.hit = 0; p.step = 0;
      });
      // a barrier row always leaves at least one lane open, and that gap is never
      // more than one lane away from the previous row's gap: dodgeable by design
      function spawn(tr) {
        const from = tr.free == null ? [0, 1, 2]
          : [0, 1, 2].filter(l => Math.abs(l - tr.free) <= 1);
        const free = pick(from);
        tr.free = free;
        const others = [0, 1, 2].filter(l => l !== free);
        const lanes = Math.random() < 0.45 ? others : [pick(others)];
        lanes.forEach(l => tr.obs.push({ cx: laneX(tr, l), y: TOP - 6, w: tr.w * LANE_W }));
      }
      function step(i, dt) {
        const tr = tracks[i], p = S.pl[i];
        const dir = (S.held(i, 'right') ? 1 : 0) - (S.held(i, 'left') ? 1 : 0);
        p.x = clamp(p.x + dir * (tr.stun > 0 ? 140 : CROSS) * dt, tr.x + 18, tr.x + tr.w - 18);
        p.step += Math.abs(dir) * dt * 14;
        if (tr.stun > 0) tr.stun -= dt; else tr.dist += SPEED * dt;
        if (p.hit > 0) p.hit -= dt;
        tr.next -= dt;
        if (tr.next <= 0) {
          spawn(tr);
          tr.next = Math.max(0.42, 0.72 - tr.dist / GOAL * 0.26);
        }
        tr.obs.forEach(o => { o.y += OBS * dt; });
        if (tr.stun <= 0 && p.hit <= 0) {
          for (const o of tr.obs) {
            if (Math.abs(o.y - p.y) < 21 && Math.abs(o.cx - p.x) < o.w / 2 + R) {
              tr.stun = 0.6;
              tr.dist = Math.max(0, tr.dist - 90);
              p.hit = 1.1;
              p.x = clamp(p.x + (p.x < o.cx ? -62 : 62), tr.x + 18, tr.x + tr.w - 18);
              Sound.capture();
              break;
            }
          }
        }
        tr.obs = tr.obs.filter(o => o.y < BOT + 40);
      }
      return {
        st: tracks, GOAL, TOP, BOT,
        update(dt) {
          step(0, dt);
          step(1, dt);
          const done = [0, 1].filter(i => tracks[i].dist >= GOAL);
          if (done.length) {
            S.finish(done.length === 2 ? null : done[0], done.length === 2 ? 'Photo finish' : 'First to the line');
          }
        },
        draw(c) {
          floor(c);
          crowd(c, (tracks[0].dist + tracks[1].dist) * 0.012);
          tracks.forEach((tr, i) => {
            const p = S.pl[i];
            const w = tr.w, h = BOT - TOP;
            c.save();
            c.fillStyle = '#0a141b';
            rr(c, tr.x, TOP, w, h, 10);
            c.fill();
            c.strokeStyle = 'rgba(110,231,255,.35)';
            c.lineWidth = 1.5;
            neon(c, ICE, 10);
            c.stroke();
            c.shadowBlur = 0;
            c.strokeStyle = 'rgba(110,231,255,.16)';
            c.setLineDash([12, 20]);
            c.lineWidth = 1;
            [0.34, 0.66].forEach(f => {
              c.beginPath();
              c.moveTo(tr.x + w * f, TOP);
              c.lineTo(tr.x + w * f, BOT);
              c.stroke();
            });
            c.setLineDash([]);
            c.strokeStyle = 'rgba(255,255,255,.07)';
            const off = tr.dist % 56;
            for (let k = 0; k * 56 < h; k++) {
              const y = TOP + ((off + k * 56) % h);
              c.beginPath();
              c.moveTo(tr.x + 8, y);
              c.lineTo(tr.x + w - 8, y);
              c.stroke();
            }
            c.fillStyle = 'rgba(255,207,92,.75)';
            for (let k = 0; k < 10; k += 2) c.fillRect(tr.x + k * w / 10, TOP, w / 10, 5);
            tr.obs.forEach(o => {
              if (o.y < TOP || o.y > BOT) return;
              c.save();
              c.fillStyle = HOT;
              neon(c, HOT, 9);
              rr(c, o.cx - o.w / 2, o.y - 8, o.w, 16, 4);
              c.fill();
              c.shadowBlur = 0;
              c.fillStyle = 'rgba(0,0,0,.35)';
              for (let k = 1; k < 4; k++) {
                c.fillRect(o.cx - o.w / 2 + k * o.w / 4, o.y - 6, 3, 12);
              }
              c.restore();
            });
            const blink = p.hit > 0 && Math.floor(p.hit * 12) % 2 === 0;
            if (!blink) {
              shadow(c, p.x, p.y + R, 15);
              ball(c, p.x, p.y, R, p.color, { spin: p.step, alpha: tr.stun > 0 ? 0.55 : 1 });
            }
            c.save();
            c.fillStyle = 'rgba(6,9,12,.74)';
            rr(c, tr.x + w / 2 - 48, TOP + 9, 96, 24, 12);
            c.fill();
            c.strokeStyle = 'rgba(110,231,255,.18)';
            c.lineWidth = 1;
            c.stroke();
            c.restore();
            tracked(c, PL[i].name + '  ' + Math.round(clamp(tr.dist / GOAL, 0, 1) * 100) + '%',
              tr.x + w / 2, TOP + 21, 12, tr.stun > 0 ? HOT : p.color, 1.5, '700', MONO, 7);
            c.restore();
          });
        }
      };
    }
  };

  /* ---------- 4. tug of war ---------- */
  const TUG = {
    id: 'tug', name: 'Tug of war',
    hint: 'Mash any of your four keys. Drag the knot past your marker.',
    make(S) {
      const MID = 360, LIMIT = 250, LEFT = MID - LIMIT, RIGHT = MID + LIMIT;
      const st = { knot: MID, t: 0, lean: [0, 0] };
      S.pl.forEach(p => { p.alive = true; });
      return {
        st,
        key(code, who) {
          // the knot moves toward whoever is mashing: P1 is on the left
          st.knot += who === 0 ? -6.5 : 6.5;
          st.lean[who] = Math.min(1, st.lean[who] + 0.45);
          Sound.chip();
        },
        update(dt) {
          st.t += dt;
          st.knot += (MID - st.knot) * 0.11 * dt;
          st.knot = clamp(st.knot, LEFT - 30, RIGHT + 30);
          st.lean[0] = Math.max(0, st.lean[0] - dt * 1.5);
          st.lean[1] = Math.max(0, st.lean[1] - dt * 1.5);
          if (st.knot <= LEFT) return S.finish(0, 'Hauled past the marker');
          if (st.knot >= RIGHT) return S.finish(1, 'Hauled past the marker');
          if (st.t > 16) {
            const d = st.knot - MID;
            S.finish(Math.abs(d) < 10 ? null : (d < 0 ? 0 : 1), 'The rope ran out of time');
          }
        },
        draw(c) {
          floor(c);
          spotlight(c, 360, 340, 400);
          crowd(c, st.t);
          c.save();
          c.strokeStyle = 'rgba(110,231,255,.14)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(36, 344);
          c.lineTo(684, 344);
          c.stroke();
          [LEFT, RIGHT].forEach((mx, i) => {
            c.save();
            c.setLineDash([5, 7]);
            c.strokeStyle = i ? ICE : GOLD;
            c.lineWidth = 1.6;
            neon(c, i ? ICE : GOLD, 10);
            c.beginPath();
            c.moveTo(mx, 238);
            c.lineTo(mx, 352);
            c.stroke();
            c.restore();
          });
          c.strokeStyle = '#9a8768';
          c.lineWidth = 3.5;
          neon(c, '#c9a76a', 8);
          c.beginPath();
          c.moveTo(150, 302);
          c.lineTo(570, 302);
          c.stroke();
          c.shadowBlur = 0;
          c.strokeStyle = 'rgba(0,0,0,.45)';
          c.lineWidth = 1;
          for (let x = 156; x < 566; x += 9) {
            c.beginPath();
            c.moveTo(x, 298);
            c.lineTo(x + 5, 306);
            c.stroke();
          }
          c.restore();
          puller(c, 150, 340, 1, GOLD, st.lean[0], st.t);
          puller(c, 570, 340, -1, ICE, st.lean[1], st.t + 1.4);
          tracked(c, 'P1', 150, 370, 12, GOLD, 2, '700', MONO, 8);
          tracked(c, 'P2', 570, 370, 12, ICE, 2, '700', MONO, 8);
          c.save();
          c.fillStyle = GOLD;
          neon(c, GOLD, 14);
          c.fillRect(st.knot - 1.5, 262, 3, 40);
          c.beginPath();
          c.moveTo(st.knot + 2, 262);
          c.lineTo(st.knot + 22, 269);
          c.lineTo(st.knot + 2, 276);
          c.fill();
          c.beginPath();
          c.arc(st.knot, 302, 7, 0, 6.2832);
          c.fill();
          c.restore();
        }
      };
    }
  };

  /* ---------- 5. quick draw ---------- */
  const DRAW = {
    id: 'draw', name: 'Quick draw',
    hint: 'Too soon and you lose. First key after the flare takes it.',
    make(S) {
      const st = { t: 0, at: 1.4 + Math.random() * 1.9, lit: false, litAt: 0, early: null, over: false, winner: null };
      S.pl.forEach(p => { p.alive = true; p.step = 0; });
      return {
        st,
        key(code, who) {
          if (st.over) return;
          if (!st.lit) {
            st.early = who;
            st.over = true;
            Sound.lose();
            S.finish(who === 0 ? 1 : 0, PL[who].name + ' drew too early');
            return;
          }
          st.over = true;
          st.winner = who;
          Sound.win();
          S.finish(who, PL[who].name + ' was quicker');
        },
        update(dt) {
          st.t += dt;
          if (!st.lit && st.t >= st.at) {
            st.lit = true;
            st.litAt = st.t;
            Sound.flip();
          }
          if (st.lit && !st.over && st.t - st.litAt > 2.6) {
            st.over = true;
            S.finish(null, 'Nobody moved');
          }
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          const lx = 360, ly = 168;
          if (st.lit) {
            const g = c.createRadialGradient(lx, ly, 6, lx, ly, 230);
            g.addColorStop(0, 'rgba(255,246,214,.55)');
            g.addColorStop(0.45, 'rgba(255,207,92,.22)');
            g.addColorStop(1, 'rgba(255,207,92,0)');
            c.fillStyle = g;
            c.fillRect(0, 0, W, H);
          }
          c.save();
          if (st.lit) neon(c, '#fff2c8', 26);
          c.fillStyle = st.lit ? '#fff6d6' : 'rgba(110,231,255,.06)';
          c.strokeStyle = st.lit ? '#fff2c8' : 'rgba(110,231,255,.45)';
          c.lineWidth = 2;
          c.fillRect(lx - 17, ly - 22, 34, 44);
          c.strokeRect(lx - 17, ly - 22, 34, 44);
          c.beginPath();
          c.moveTo(lx, ly - 22);
          c.lineTo(lx, ly - 42);
          c.stroke();
          c.restore();
          c.save();
          c.strokeStyle = 'rgba(110,231,255,.22)';
          c.lineWidth = 1.5;
          c.setLineDash([8, 8]);
          c.beginPath();
          c.moveTo(60, 352);
          c.lineTo(660, 352);
          c.stroke();
          c.restore();
          shadow(c, 250, 340, 20);
          shadow(c, 470, 340, 20);
          ball(c, 250, 323, 17, GOLD, { squash: 0.35 });
          ball(c, 470, 323, 17, ICE, { squash: 0.35 });
          tracked(c, 'P1', 250, 372, 12, GOLD, 2, '700', MONO, 8);
          tracked(c, 'P2', 470, 372, 12, ICE, 2, '700', MONO, 8);
          if (st.lit && !st.over) tracked(c, 'DRAW!', lx, 250, 32, MAG, 5, '800', SANS, 22);
          if (st.early != null) {
            tracked(c, 'EARLY', st.early === 0 ? 250 : 470, 292, 16, HOT, 4, '800', SANS, 16);
          }
        }
      };
    }
  };

  /* ---------- 6. paint war ---------- */
  const PAINT = {
    id: 'paint', name: 'Paint war',
    hint: 'Run over the floor to claim it. Most tiles when the light dies wins.',
    make(S) {
      const B = { x: 40, y: 76, w: 640, h: 280 }, CELL = 40;
      const COLS = B.w / CELL, ROWS = B.h / CELL;
      const st = { t: 0, limit: 18, grid: new Int8Array(COLS * ROWS).fill(-1), score: [0, 0], blip: 0, B, COLS, ROWS };
      S.pl.forEach((p, i) => {
        p.x = B.x + B.w * (i ? 0.72 : 0.28); p.y = B.y + B.h * 0.5;
        p.vx = p.vy = 0; p.alive = true; p.step = 0;
      });
      function move(p, i, dt) {
        const tx = ((S.held(i, 'right') ? 1 : 0) - (S.held(i, 'left') ? 1 : 0)) * 212;
        const ty = ((S.held(i, 'down') ? 1 : 0) - (S.held(i, 'up') ? 1 : 0)) * 212;
        const k = Math.min(1, dt * 14);
        p.vx += (tx - p.vx) * k;
        p.vy += (ty - p.vy) * k;
        p.x = clamp(p.x + p.vx * dt, B.x + 12, B.x + B.w - 12);
        p.y = clamp(p.y + p.vy * dt, B.y + 12, B.y + B.h - 12);
        p.step += Math.hypot(p.vx, p.vy) * dt * 0.1;
      }
      function claim(i) {
        const p = S.pl[i];
        const cx = Math.floor((p.x - B.x) / CELL), cy = Math.floor((p.y - B.y) / CELL);
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return;
        const k = cy * COLS + cx;
        if (st.grid[k] === i) return;
        if (st.grid[k] >= 0) st.score[st.grid[k]]--;
        st.grid[k] = i;
        st.score[i]++;
        if (st.blip <= 0) { Sound.chip(); st.blip = 0.11; }
      }
      return {
        st, B, COLS, ROWS,
        update(dt) {
          st.t += dt;
          st.blip -= dt;
          S.pl.forEach((p, i) => {
            if (!p.alive) return;
            move(p, i, dt);
            claim(i);
          });
          if (st.t >= st.limit) {
            const d = st.score[0] - st.score[1];
            S.finish(d === 0 ? null : (d > 0 ? 0 : 1),
              d === 0 ? 'A dead heat' : st.score[0] + ' tiles to ' + st.score[1]);
          }
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          c.save();
          c.fillStyle = '#080d12';
          rr(c, B.x - 4, B.y - 4, B.w + 8, B.h + 8, 10);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.34)';
          c.lineWidth = 1.5;
          neon(c, ICE, 12);
          c.stroke();
          c.restore();
          const tints = ['rgba(255,207,92,', 'rgba(110,231,255,'];
          for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
              const owner = st.grid[y * COLS + x];
              const px = B.x + x * CELL, py = B.y + y * CELL;
              c.save();
              if (owner >= 0) {
                c.fillStyle = tints[owner] + '0.2)';
                c.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
                c.strokeStyle = tints[owner] + '0.42)';
                c.lineWidth = 1;
                neon(c, owner ? ICE : GOLD, 7);
                c.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
              } else {
                c.strokeStyle = 'rgba(255,255,255,.05)';
                c.lineWidth = 1;
                c.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
              }
              c.restore();
            }
          }
          S.pl.forEach((p, i) => {
            shadow(c, p.x, p.y + 13, 15);
            ball(c, p.x, p.y, 13, p.color, { spin: p.step });
            tracked(c, PL[i].name, p.x, p.y - 24, 11, p.color, 2, '700', MONO, 8);
          });
          const left = clamp(1 - st.t / st.limit, 0, 1);
          c.save();
          c.fillStyle = 'rgba(255,255,255,.09)';
          rr(c, B.x, B.y + B.h + 16, B.w, 7, 3.5);
          c.fill();
          c.fillStyle = left < 0.25 ? MAG : GOLD;
          neon(c, left < 0.25 ? MAG : GOLD, 10);
          rr(c, B.x, B.y + B.h + 16, Math.max(2, B.w * left), 7, 3.5);
          c.fill();
          c.restore();
          c.save();
          c.fillStyle = 'rgba(6,9,12,.74)';
          rr(c, 250, B.y + B.h + 30, 220, 24, 12);
          c.fill();
          c.restore();
          tracked(c, st.score[0] + '  –  ' + st.score[1], W / 2, B.y + B.h + 42, 12,
            st.score[0] === st.score[1] ? INK : (st.score[0] > st.score[1] ? GOLD : ICE),
            3, '700', MONO, 7);
        }
      };
    }
  };

  /* ---------- 7. trail ---------- */
  const TRAIL = {
    id: 'trail', name: 'Trail',
    hint: 'Eat the pellets, grow longer, and make the other one crash first.',
    make(S) {
      const COLS = 21, ROWS = 11, CELL = 30, OX = 45, OY = 58, LIMIT = 30;
      const st = {
        t: 0, acc: 0, iv: 0.13, over: false,
        seg: [[], []], dir: [{ x: 1, y: 0 }, { x: -1, y: 0 }],
        grow: [0, 0], pellets: []
      };
      const kOf = (x, y) => y * COLS + x;
      for (let k = 0; k < 4; k++) {
        st.seg[0].push({ x: 3 - k, y: 5 });
        st.seg[1].push({ x: COLS - 4 + k, y: 5 });
      }
      function spawnPellet() {
        for (let tries = 0; tries < 240; tries++) {
          const x = 1 + Math.floor(Math.random() * (COLS - 2));
          const y = 1 + Math.floor(Math.random() * (ROWS - 2));
          const busy = st.pellets.some(p => p.x === x && p.y === y) ||
            st.seg[0].some(s => s.x === x && s.y === y) ||
            st.seg[1].some(s => s.x === x && s.y === y);
          if (!busy) { st.pellets.push({ x, y, t: 0 }); return; }
        }
      }
      while (st.pellets.length < 2) spawnPellet();
      function steer(i) {
        const d = st.dir[i];
        const want = [];
        if (S.held(i, 'up')) want.push({ x: 0, y: -1 });
        if (S.held(i, 'down')) want.push({ x: 0, y: 1 });
        if (S.held(i, 'left')) want.push({ x: -1, y: 0 });
        if (S.held(i, 'right')) want.push({ x: 1, y: 0 });
        for (const v of want) if (v.x !== -d.x || v.y !== -d.y) return v;
        return d;
      }
      function tick() {
        const heads = [0, 1].map(i => {
          const d = steer(i), h = st.seg[i][0];
          return { x: h.x + d.x, y: h.y + d.y, d };
        });
        const occ = new Set();
        [0, 1].forEach(i => {
          const keep = st.seg[i].length - (st.grow[i] > 0 ? 0 : 1);
          for (let k = 0; k < keep; k++) occ.add(kOf(st.seg[i][k].x, st.seg[i][k].y));
        });
        const dead = [false, false];
        heads.forEach((h, i) => {
          st.dir[i] = h.d;
          if (h.x < 0 || h.y < 0 || h.x >= COLS || h.y >= ROWS) dead[i] = true;
          else if (occ.has(kOf(h.x, h.y))) dead[i] = true;
        });
        if (heads[0].x === heads[1].x && heads[0].y === heads[1].y) {
          if (!dead[0] || !dead[1]) Sound.capture();
          dead[0] = dead[1] = true;
        }
        heads.forEach((h, i) => {
          st.seg[i].unshift({ x: h.x, y: h.y });
          const at = st.pellets.findIndex(p => p.x === h.x && p.y === h.y);
          if (at >= 0) {
            st.pellets.splice(at, 1);
            st.grow[i] += 1;
            Sound.chip();
            spawnPellet();
          }
          if (st.grow[i] > 0) st.grow[i] -= 1; else st.seg[i].pop();
        });
        if (dead[0] || dead[1]) {
          st.over = true;
          Sound.drop();
          S.finish(dead[0] && dead[1] ? null : (dead[0] ? 1 : 0), 'Head first into trouble');
        }
      }
      return {
        st, COLS, ROWS, CELL, OX, OY,
        update(dt) {
          if (st.over) return;
          st.t += dt;
          st.acc += dt;
          st.pellets.forEach(p => { p.t += dt; });
          while (st.acc >= st.iv && !st.over) {
            st.acc -= st.iv;
            tick();
          }
          if (!st.over && st.t > LIMIT) {
            const a = st.seg[0].length, b = st.seg[1].length;
            st.over = true;
            S.finish(a === b ? null : (a > b ? 0 : 1), 'Longest trail at the buzzer');
          }
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          c.save();
          c.fillStyle = '#080d12';
          rr(c, OX - 6, OY - 6, COLS * CELL + 12, ROWS * CELL + 12, 12);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.34)';
          c.lineWidth = 1.5;
          neon(c, ICE, 12);
          c.stroke();
          c.shadowBlur = 0;
          c.fillStyle = 'rgba(255,255,255,.05)';
          for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
              c.beginPath();
              c.arc(OX + x * CELL + CELL / 2, OY + y * CELL + CELL / 2, 1.5, 0, 6.2832);
              c.fill();
            }
          }
          c.restore();
          st.pellets.forEach(p => {
            const pulse = 0.6 + 0.4 * Math.sin(p.t * 6);
            c.save();
            c.fillStyle = GOLD;
            neon(c, GOLD, 12 * pulse);
            c.beginPath();
            c.arc(OX + p.x * CELL + CELL / 2, OY + p.y * CELL + CELL / 2, 5 + pulse * 1.6, 0, 6.2832);
            c.fill();
            c.restore();
          });
          [1, 0].forEach(i => {
            const segs = st.seg[i], col = PL[i].color;
            c.save();
            segs.forEach((s, k) => {
              const fade = k === 0 ? 1 : clamp(1 - k / (segs.length + 5), 0.25, 0.9);
              c.globalAlpha = fade;
              c.fillStyle = col;
              neon(c, col, k === 0 ? 14 : 6);
              rr(c, OX + s.x * CELL + 3, OY + s.y * CELL + 3, CELL - 6, CELL - 6, 5);
              c.fill();
            });
            c.restore();
            const h = segs[0];
            c.save();
            c.strokeStyle = INK;
            c.lineWidth = 1.2;
            c.globalAlpha = 0.55;
            rr(c, OX + h.x * CELL + 6.5, OY + h.y * CELL + 6.5, CELL - 13, CELL - 13, 3);
            c.stroke();
            c.restore();
          });
          // lengths live at the top centre: the vignette eats the bottom corners
          c.save();
          c.fillStyle = 'rgba(6,9,12,.8)';
          rr(c, W / 2 - 92, 12, 184, 28, 14);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.22)';
          c.lineWidth = 1;
          c.stroke();
          c.restore();
          tracked(c, 'P1 ' + st.seg[0].length, W / 2 - 60, 26, 11.5, GOLD, 2, '700', MONO, 0);
          tracked(c, 'P2 ' + st.seg[1].length, W / 2 + 60, 26, 11.5, ICE, 2, '700', MONO, 0);
        }
      };
    }
  };

  /* ---------- 8. rally ---------- */
  const RALLY = {
    id: 'rally', name: 'Rally',
    hint: 'Up and down to hold your line. Three points takes the round.',
    make(S) {
      const B = { x: 44, y: 96, w: 632, h: 272 }, PW = 9, PH = 64, WIN = 3, LIMIT = 45;
      const midY = B.y + B.h / 2;
      const st = {
        t: 0, wait: 0.9, score: [0, 0], rally: 0,
        pad: [midY, midY],
        ball: { x: W / 2, y: midY, vx: 0, vy: 0, r: 7 },
        serve: null, flash: 0, B
      };
      function serve(to) {
        const sp = 300, a = Math.random() * 0.62 - 0.31;
        st.ball.x = W / 2;
        st.ball.y = midY + (Math.random() * 70 - 35);
        st.ball.vx = (to === 0 ? -1 : 1) * sp * Math.cos(a);
        st.ball.vy = sp * Math.sin(a);
        st.rally = 0;
      }
      function bounce(i) {
        const b = st.ball;
        const sp = Math.min(780, Math.hypot(b.vx, b.vy) * 1.05);
        const rel = clamp((b.y - st.pad[i]) / (PH / 2), -1, 1);
        const ang = rel * 0.95;
        const dir = i === 0 ? 1 : -1;
        b.vx = dir * sp * Math.cos(ang);
        b.vy = sp * Math.sin(ang);
        b.x = i === 0 ? B.x + 16 + PW + b.r + 0.5 : B.x + B.w - 16 - PW - b.r - 0.5;
        st.rally++;
        Sound.chip();
        st.flash = 0.16;
      }
      function point(who) {
        st.score[who]++;
        Sound.capture();
        st.wait = 0.9;
        st.ball.x = W / 2;
        st.ball.y = midY;
        st.ball.vx = 0;
        st.ball.vy = 0;
        st.serve = who === 0 ? 1 : 0;
        st.rally = 0;
      }
      return {
        st, B, PH, WIN,
        update(dt) {
          st.t += dt;
          st.flash = Math.max(0, st.flash - dt);
          for (let i = 0; i < 2; i++) {
            const d = (S.held(i, 'down') ? 1 : 0) - (S.held(i, 'up') ? 1 : 0);
            st.pad[i] = clamp(st.pad[i] + d * 330 * dt, B.y + PH / 2 + 6, B.y + B.h - PH / 2 - 6);
          }
          if (st.wait > 0) {
            st.wait -= dt;
            if (st.wait <= 0) serve(st.serve == null ? 0 : st.serve);
            return;
          }
          const b = st.ball;
          const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 6));
          for (let s = 0; s < steps; s++) {
            const sdt = dt / steps;
            b.x += b.vx * sdt;
            b.y += b.vy * sdt;
            if (b.y - b.r < B.y) { b.y = B.y + b.r; b.vy = Math.abs(b.vy); }
            if (b.y + b.r > B.y + B.h) { b.y = B.y + B.h - b.r; b.vy = -Math.abs(b.vy); }
            const lx = B.x + 16, rx = B.x + B.w - 16 - PW;
            if (b.vx < 0 && b.x - b.r <= lx + PW && b.x + b.r >= lx &&
                Math.abs(b.y - st.pad[0]) < PH / 2 + b.r && b.x > B.x) bounce(0);
            if (b.vx > 0 && b.x + b.r >= rx && b.x - b.r <= rx + PW &&
                Math.abs(b.y - st.pad[1]) < PH / 2 + b.r && b.x < B.x + B.w) bounce(1);
          }
          if (b.x < B.x - 22) point(1);
          else if (b.x > B.x + B.w + 22) point(0);
          if (st.score[0] >= WIN || st.score[1] >= WIN) {
            const who = st.score[0] >= WIN ? 0 : 1;
            S.finish(who, st.score[0] + ' – ' + st.score[1]);
            return;
          }
          if (st.t > LIMIT) {
            const d = st.score[0] - st.score[1];
            S.finish(d === 0 ? null : (d > 0 ? 0 : 1), 'Time on the court');
          }
        },
        draw(c) {
          floor(c);
          crowd(c, st.t);
          c.save();
          c.fillStyle = '#080d12';
          rr(c, B.x, B.y, B.w, B.h, 12);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.34)';
          c.lineWidth = 1.5;
          neon(c, ICE, 12);
          c.stroke();
          c.shadowBlur = 0;
          c.strokeStyle = 'rgba(110,231,255,.22)';
          c.setLineDash([9, 11]);
          c.lineWidth = 1.4;
          c.beginPath();
          c.moveTo(W / 2, B.y + 6);
          c.lineTo(W / 2, B.y + B.h - 6);
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.arc(W / 2, B.y + B.h / 2, 42, 0, 6.2832);
          c.stroke();
          c.restore();
          [0, 1].forEach(i => {
            const x = i ? B.x + B.w - 16 - PW : B.x + 16;
            const col = PL[i].color;
            c.save();
            c.fillStyle = col;
            neon(c, col, st.flash > 0 ? 22 : 12);
            rr(c, x, st.pad[i] - PH / 2, PW, PH, 4.5);
            c.fill();
            c.restore();
            c.save();
            c.strokeStyle = col;
            c.globalAlpha = 0.3;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(i ? B.x + B.w - 14 : B.x + 14, B.y + 4);
            c.lineTo(i ? B.x + B.w - 14 : B.x + 14, B.y + B.h - 4);
            c.stroke();
            c.restore();
          });
          const b = st.ball;
          c.save();
          c.fillStyle = INK;
          neon(c, GOLD, 18);
          c.beginPath();
          c.arc(b.x, b.y, b.r, 0, 6.2832);
          c.fill();
          c.restore();
          c.save();
          c.fillStyle = 'rgba(6,9,12,.8)';
          rr(c, W / 2 - 74, 50, 148, 32, 16);
          c.fill();
          c.strokeStyle = 'rgba(110,231,255,.22)';
          c.lineWidth = 1;
          c.stroke();
          c.restore();
          tracked(c, st.score[0] + '  –  ' + st.score[1], W / 2, 66, 16,
            st.score[0] === st.score[1] ? INK : (st.score[0] > st.score[1] ? GOLD : ICE),
            3, '700', MONO, 9);
          if (st.rally > 2 && st.wait <= 0) {
            tracked(c, st.rally + ' HIT RALLY', W / 2, B.y + 18, 9.5, MAG, 2, '400', MONO, 7);
          }
        }
      };
    }
  };

  const GAME_LIST = [RING, RAIN, RACE, TUG, DRAW, PAINT, TRAIL, RALLY];

  /* ---------- the match ---------- */
  function mount(ctx) {
    const held = Object.create(null);
    let fresh = [];
    let phase = 'idle', mg = null, inst = null;
    let rounds = [], roundIx = -1, scores = [0, 0];
    let introT = 0, resultT = 0, lastWinner = null, lastNote = '';
    let paused = false, stopped = false, raf = 0, last = 0, tick = 0;

    const pl = [
      { x: 0, y: 0, vx: 0, vy: 0, alive: true, color: GOLD, face: 0, step: 0, hit: 0 },
      { x: 0, y: 0, vx: 0, vy: 0, alive: true, color: ICE, face: Math.PI, step: 0, hit: 0 }
    ];
    const S = {
      pl, W, H,
      held: (i, dir) => !!held[PL[i][dir]],
      finish(who, note) { roundOver(who, note); }
    };

    const wrap = mk('div', 'sp');
    const hud = mk('div', 'sp-hud');
    hud.innerHTML = '<span class="sp-p1"><b>0</b> P1</span>' +
      '<span class="sp-mid">ball party</span>' +
      '<span class="sp-p2">P2 <b>0</b></span>';
    const p1num = $('.sp-p1 b', hud);
    const p2num = $('.sp-p2 b', hud);
    const mid = $('.sp-mid', hud);
    const stage = mk('div', 'sp-stage');
    const canvas = mk('canvas', 'sp-canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.setAttribute('aria-label', 'Ball Party arena');
    const c = canvas.getContext('2d');
    const keys = mk('div', 'sp-keys');
    keys.innerHTML = '<span class="sp-p1">P1</span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>' +
      '<span class="sp-p2">P2</span><kbd>&uarr;</kbd><kbd>&larr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd>';
    const restart = mk('button', 'btn small sp-restart', 'Restart');
    restart.type = 'button';
    restart.addEventListener('click', () => {
      Sound.click();
      restart.blur();
      startMatch();
    });
    keys.appendChild(restart);
    stage.appendChild(canvas);
    wrap.appendChild(hud);
    wrap.appendChild(stage);
    wrap.appendChild(keys);
    ctx.boardEl.appendChild(wrap);

    const veil = mk('div', 'sp-veil');
    const cardEl = mk('div', 'sp-card');
    cardEl.innerHTML = '<h4>Ball Party</h4>' +
      '<p>Eight quick duels, five drawn each match, best of five. P1 has <b>WASD</b>, ' +
      'P2 has the arrow keys — no turn waiting, just reflexes.</p>';
    const startBtn = mk('button', 'btn primary', 'Press start');
    startBtn.type = 'button';
    cardEl.appendChild(startBtn);
    veil.appendChild(cardEl);
    stage.appendChild(veil);

    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = rnd(i + 1);
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }

    function paintHud() {
      p1num.textContent = scores[0];
      p2num.textContent = scores[1];
      mid.textContent = roundIx < 0
        ? 'two players · one keyboard'
        : ('round ' + Math.min(roundIx + 1, rounds.length) + ' / ' + rounds.length + ' · ' + mg.name);
    }

    function startMatch() {
      scores = [0, 0];
      rounds = shuffle(GAME_LIST.slice()).slice(0, 5);
      roundIx = -1;
      lastWinner = null;
      lastNote = '';
      paused = false;
      veil.style.display = 'none';
      ctx.clearBanner();
      nextRound();
    }

    function nextRound() {
      roundIx++;
      if (roundIx >= rounds.length) {
        if (scores[0] === scores[1]) rounds.push(pick(GAME_LIST));
        else return finishMatch();
      }
      mg = rounds[roundIx];
      inst = mg.make(S);
      phase = 'intro';
      introT = 2.4;
      paintHud();
      ctx.setStatus('Round ' + (roundIx + 1) + ' · ' + mg.name, 'you');
    }

    function roundOver(who, note) {
      if (phase !== 'play') return;
      phase = 'result';
      resultT = 1.8;
      lastWinner = who;
      lastNote = note || '';
      if (who === 0 || who === 1) {
        scores[who]++;
        Sound.win();
      } else Sound.draw();
      paintHud();
      ctx.setStatus(who == null ? 'Round drawn' : PL[who].name + ' takes round ' + (roundIx + 1), 'you');
    }

    function finishMatch() {
      phase = 'done';
      const a = scores[0], b = scores[1];
      const who = a > b ? 0 : 1;
      paintHud();
      ctx.setStatus(PL[who].name + ' wins the match', who === 0 ? 'win' : 'you');
      Sound.win();
      ctx.end(null, PL[who].name + ' takes the match ' + Math.max(a, b) + '–' + Math.min(a, b) +
        ' over ' + rounds.length + ' rounds');
    }

    function paint() {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      if (inst && phase !== 'idle') inst.draw(c);
      else idleScene(c, tick);
      if (phase === 'intro') introOverlay(c, roundIx + 1, rounds.length, mg.name, mg.hint, introT);
      else if (phase === 'result') resultOverlay(c, lastWinner, lastNote);
      else if (phase === 'done') doneOverlay(c, scores, rounds.length, tick);
      if (paused) pauseOverlay(c);
      crt(c);
    }

    // update only: no paint. The rAF loop always paints; this exists so a test
    // can simulate thousands of frames of game logic at full speed.
    function simulate(dt) {
      tick += dt;
      if (paused) {
        fresh = [];
      } else if (phase === 'intro') {
        introT -= dt;
        if (introT <= 0) phase = 'play';
      } else if (phase === 'play') {
        const q = fresh;
        fresh = [];
        if (inst.key) q.forEach(k => inst.key(k.code, k.who));
        if (phase === 'play') inst.update(dt);
      } else if (phase === 'result') {
        resultT -= dt;
        if (resultT <= 0) nextRound();
      }
    }

    function advance(dt) {
      simulate(dt);
      paint();
    }

    function frame(ts) {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      if (!canvas.isConnected || !ctx.alive()) { stop(); return; }
      const dt = last ? Math.min(0.034, Math.max(0, (ts - last) / 1000)) : 0.016;
      last = ts;
      advance(dt);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onDown);
      document.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      if (window.__nxParty && window.__nxParty.pl === pl) delete window.__nxParty;
    }

    function onDown(e) {
      if (stopped) return;
      if (!canvas.isConnected || !ctx.alive()) { stop(); return; }
      const who = ownerOf(e.code);
      if (who < 0) return;
      if (e.code.indexOf('Arrow') === 0) e.preventDefault();
      if (phase === 'idle' || phase === 'done' || paused) return;
      held[e.code] = true;
      if (!e.repeat && phase === 'play') fresh.push({ code: e.code, who });
    }

    function onUp(e) {
      if (ownerOf(e.code) >= 0) held[e.code] = false;
    }

    function onBlur() {
      if (!stopped && (phase === 'play' || phase === 'intro')) paused = true;
      for (const k in held) held[k] = false;
      fresh = [];
    }

    startBtn.addEventListener('click', () => {
      Sound.click();
      startBtn.blur();
      startMatch();
    });
    stage.addEventListener('click', () => {
      if (paused) {
        paused = false;
        last = performance.now();
      }
    });

    document.addEventListener('keydown', onDown);
    document.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);

    window.__nxParty = {
      get phase() { return phase; },
      get paused() { return paused; },
      get round() { return roundIx; },
      get rounds() { return rounds.map(r => r.id); },
      get scores() { return scores.slice(); },
      get mm() { return mg ? mg.id : null; },
      get note() { return lastNote; },
      pl,
      inst: () => inst,
      // test hooks: advance the match by hand, so a throttled/occluded WebView
      // (rAF stopped) still runs at exactly the pace the test expects.
      // step(ms) runs the frame the rAF loop runs, paint included; step(ms, false)
      // runs the same update with no repaint, for long simulations (the canvas
      // costs ~20 ms a frame, which makes a thousand-frame pilot take 20 s).
      step(ms, paintFrame) {
        if (stopped) return;
        const dt = (ms || 16) / 1000;
        if (paintFrame === false) simulate(dt); else advance(dt);
      },
      start(ids) {
        rounds = ids.map(id => GAME_LIST.filter(g => g.id === id)[0]).filter(Boolean);
        roundIx = -1;
        scores = [0, 0];
        veil.style.display = 'none';
        phase = 'idle';
        ctx.clearBanner();
        nextRound();
      },
      skip() { if (phase === 'intro') introT = 0.001; }
    };

    paintHud();
    ctx.setStatus('Ball Party — press start', 'you');
    raf = requestAnimationFrame(frame);
    return {};
  }

  return {
    id: 'sp',
    name: 'Ball Party',
    tag: 'two players, one keyboard',
    blurb: 'Eight real-time duels — shove, dodge, run, pull, draw, paint, grow, rally. Same keyboard, no internet.',
    rules: 'Eight duels, five of them drawn at random per match, best of five. The set: Ring out, ' +
      'Anvils, The run, Tug of war, Quick draw, Paint war, Trail and Rally. ' +
      'P1 uses W A S D, P2 uses the arrow keys. ' +
      'Most round wins takes the match; a tie gets one more round. Nothing here waits its turn, ' +
      'so both pairs of hands stay on the keyboard.',
    hideMode: true,
    hideDiff: true,
    needsKeyboard: true,
    mount
  };
})();

/* ============================================================
   shell
   ============================================================ */
const GAMES = [ticTacToe, connectFour, reversi, checkers, chess, gomoku, mancala, blackjack, bigTwo, poker, stickParty];
const screenEl = $('#screen');
const muteBtn = $('#mute');
const backBtn = $('#back');
let live = null;

function paintMute() {
  muteBtn.textContent = store.mute ? '✕' : '♪';
  muteBtn.classList.toggle('off', store.mute);
  muteBtn.setAttribute('aria-label', store.mute ? 'Sound off' : 'Sound on');
}
muteBtn.addEventListener('click', () => {
  store.mute = !store.mute; save(); paintMute();
  if (!store.mute) Sound.click();
});
backBtn.addEventListener('click', hub);

/* ---------- record: download + reset (footer controls) ---------- */
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const exportBtn = $('#record-export');
const clearBtn = $('#record-clear');

function recordJSON() {
  return JSON.stringify({
    app: 'NxGen Arcade',
    key: KEY,
    exported: new Date().toISOString(),
    scores: store.scores
  }, null, 2);
}
function repaintRecords() {
  if (document.body.dataset.view === 'hub') return hub();
  const cell = $('.game .record b');
  if (cell && document.body.dataset.game) cell.textContent = recText(document.body.dataset.game);
}
exportBtn.addEventListener('click', () => {
  const blob = new Blob([recordJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = mk('a');
  a.href = url; a.download = 'arcade-record.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  Sound.click();
});
clearBtn.addEventListener('click', () => {
  if (!Object.keys(store.scores).length) {
    clearBtn.textContent = 'Nothing to clear';
    setTimeout(() => { clearBtn.textContent = 'Clear record'; }, 1400);
    return;
  }
  if (!confirm('Clear the win/loss record for all eleven games? This cannot be undone.')) return;
  store.scores = {}; save(); repaintRecords();
});

/* ---------- keyboard path while a game is open ---------- */
let keyed = null;   // { undo, hint, newGame } for the mounted game, or null on the hub

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { hub(); return; }
  if (!keyed || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'u') { e.preventDefault(); keyed.undo(); }
  else if (k === 'h') { e.preventDefault(); keyed.hint(); }
  else if (k === 'n') { e.preventDefault(); keyed.newGame(); }
});

function teardown() {
  keyed = null;
  if (live) { live.destroy(); live = null; }
  screenEl.textContent = '';
}

function hub() {
  teardown();
  document.body.dataset.view = 'hub';
  const wrap = mk('section', 'hub');
  const h1 = mk('h1');
  h1.innerHTML = 'Eleven games, no internet,<br><em>pass the keyboard.</em>';
  const sub = mk('p', 'sub');
  sub.innerHTML = 'Everything here runs offline, in one folder. Pull up a second player on the same keyboard, or take on Talia — she has three moods: Easy, Steady and Ruthless.';
  wrap.appendChild(h1); wrap.appendChild(sub);

  const grid = mk('div', 'grid');
  GAMES.forEach((g, n) => {
    const card = mk('button', 'card');
    card.type = 'button';
    card.style.animationDelay = (n * 55) + 'ms';
    card.innerHTML =
      '<span class="num">' + String(n + 1).padStart(2, '0') + ' / ' + String(GAMES.length).padStart(2, '0') + '</span>' +
      '<h3>' + g.name + '</h3>' +
      '<span class="tag">' + g.tag + '</span>' +
      '<p>' + g.blurb + '</p>' +
      (COARSE && g.needsKeyboard ? '<span class="warn">needs a keyboard</span>' : '') +
      '<span class="rec">' + recText(g.id) + '</span>';
    card.addEventListener('click', () => { Sound.click(); openGame(g); });
    grid.appendChild(card);
  });
  wrap.appendChild(grid);
  screenEl.appendChild(wrap);
}

function openGame(g) {
  teardown();
  document.body.dataset.view = 'game';
  document.body.dataset.game = g.id;
  const sec = mk('section', 'game');
  sec.style.setProperty('--accent', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const head = mk('div', 'game-head');
  const left = mk('div');
  const h2 = mk('h2', null, g.name);
  const tag = mk('p', 'tagline', g.blurb);
  left.appendChild(h2); left.appendChild(tag);
  const turnbox = mk('div', 'turnbox');
  turnbox.innerHTML = '<span class="dot"></span><span class="turn-text">…</span>';
  head.appendChild(left); head.appendChild(turnbox);

  const body = mk('div', 'game-body');
  const boardwrap = mk('div', 'boardwrap');
  const panel = mk('aside', 'panel');

  const segMode = mk('div', 'seg');
  segMode.innerHTML = '<button type="button" data-mode="ai">vs Talia</button><button type="button" data-mode="two">2 players</button>';
  const segDiff = mk('div', 'seg');
  segDiff.innerHTML = DIFF_NAMES.map((d, i) => '<button type="button" data-diff="' + i + '">' + d + '</button>').join('');
  const row = mk('div', 'row');
  const btnUndo = mk('button', 'btn', 'Undo'); btnUndo.type = 'button';
  const btnHint = mk('button', 'btn', 'Hint'); btnHint.type = 'button';
  const btnNew = mk('button', 'btn', 'New'); btnNew.type = 'button';
  row.appendChild(btnUndo); row.appendChild(btnHint); row.appendChild(btnNew);
  const rec = mk('div', 'record');
  const rules = mk('p', 'rules', g.rules);
  const labelMode = mk('div', 'label', 'Opponent');
  const labelDiff = mk('div', 'label', 'Mood');

  if (!g.hideMode) { panel.appendChild(labelMode); panel.appendChild(segMode); }
  if (!g.hideDiff) { panel.appendChild(labelDiff); panel.appendChild(segDiff); }
  panel.appendChild(row); panel.appendChild(rec); panel.appendChild(rules);
  if (COARSE && g.needsKeyboard) {
    const warn = mk('p', 'touchwarn', 'Needs a keyboard: two players, W A S D and the arrow keys. There is no touch input, so this one will not play on a phone.');
    panel.appendChild(warn);
  }

  boardwrap.appendChild(mk('div', 'boardhost'));
  body.appendChild(boardwrap); body.appendChild(panel);
  sec.appendChild(head); sec.appendChild(body);
  screenEl.appendChild(sec);

  $$('[data-mode]', segMode).forEach(b => b.classList.toggle('on', b.dataset.mode === store.mode));
  $$('[data-diff]', segDiff).forEach(b => b.classList.toggle('on', +b.dataset.diff === store.diff));

  function paintRecord() {
    rec.innerHTML = '<span>Record</span><b>' + recText(g.id) + '</b>';
  }
  paintRecord();

  let dead = false;
  const ctx = {
    boardEl: $('.boardhost', boardwrap),
    mode: store.mode,
    diff: store.diff,
    alive: () => !dead,
    setStatus(text, kind) {
      $('.turn-text', turnbox).textContent = text;
      turnbox.className = 'turnbox' + (kind ? ' ' + kind : '');
    },
    flash(text) {
      const old = $('.flash', boardwrap); if (old) old.remove();
      const f = mk('div', 'banner');
      f.classList.add('flash');
      f.innerHTML = '<strong style="font-size:14px">' + text + '</strong>';
      boardwrap.appendChild(f);
      setTimeout(() => f.remove(), 1900);
    },
    clearBanner() {
      const b = $('.banner:not(.flash)', boardwrap); if (b) b.remove();
    },
    record(res) { if (res) { record(g.id, res); paintRecord(); } },
    unrecord(res) {
      const s = store.scores[g.id];
      if (s && res && s[res] > 0) { s[res] -= 1; save(); paintRecord(); }
    },
    end(res, label) {
      if (res) { record(g.id, res); paintRecord(); }
      const old = $('.banner:not(.flash)', boardwrap); if (old) old.remove();
      const b = mk('div', 'banner');
      if (res === 'w') b.classList.add('win');
      if (res === 'l') b.classList.add('lose');
      const t = mk('strong', null, label);
      const again = mk('button', 'btn small', 'Again');
      again.type = 'button';
      again.addEventListener('click', () => openGame(g));
      b.appendChild(t); b.appendChild(again);
      boardwrap.appendChild(b);
    }
  };

  const ctrl = g.mount(ctx) || {};
  live = { destroy() { dead = true; screenEl.textContent = ''; } };

  btnUndo.disabled = !ctrl.undo;
  btnHint.disabled = !ctrl.hint;
  btnUndo.addEventListener('click', () => { if (ctrl.undo) { ctrl.undo(); Sound.click(); } });
  btnHint.addEventListener('click', () => { if (ctrl.hint) ctrl.hint(); });
  btnNew.addEventListener('click', () => { Sound.click(); openGame(g); });

  keyed = {
    undo: () => { if (!btnUndo.disabled && ctrl.undo) { ctrl.undo(); Sound.click(); } },
    hint: () => { if (!btnHint.disabled && ctrl.hint) ctrl.hint(); },
    newGame: () => { Sound.click(); openGame(g); }
  };

  $$('[data-mode]', segMode).forEach(b => b.addEventListener('click', () => {
    store.mode = b.dataset.mode; save();
    Sound.click();
    openGame(g);
  }));
  $$('[data-diff]', segDiff).forEach(b => b.addEventListener('click', () => {
    store.diff = +b.dataset.diff; save();
    Sound.click();
    openGame(g);
  }));
}

/* start */
paintMute();
hub();

})();