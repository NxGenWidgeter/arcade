'use strict';
/* ============================================================
   NxGen Arcade — six turn-based games, entirely offline.
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
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = -1;
      for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = 1;

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
      }
      function undo() {
        if (!hist.length) return;
        over = false; sel = null; ctx.clearBanner();
        let s = hist.pop();
        while (mode === 'ai' && s.turn !== HUMAN && hist.length) s = hist.pop();
        b = Int8Array.from(s.b); turn = s.turn; render(); sync();
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
   5. FIVE IN A ROW (gomoku)
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
   6. MANCALA (Kalah)
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
  const el = mk('div', 'card' + (hidden ? ' back' : '') + (!hidden && red ? ' red' : ''));
  if (!hidden) {
    el.innerHTML = '<span class="rk">' + label + '</span><span class="st">' + SUIT_SYM[suit] + '</span>';
  }
  return el;
}

/* ============================================================
   7. BLACKJACK
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
    let chips = typeof store.bank === 'number' ? store.bank : 500;
    let bet = typeof store.bet === 'number' ? store.bet : 25;
    let shoe = [], dealer = [], player = [], stake = 0;
    let phase = 'bet', hidden = true, busy = false, msg = '', tone = '';

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
      if (busy || chips < bet) return;
      if (chips < 5) { chips = 500; saveBank(); }
      if (shoe.length < 30) shoe = buildShoe();
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
      player.push(draw()); Sound.place();
      const t = total(player);
      if (t > 21) { phase = 'dealer'; hidden = false; return settle(); }
      render();
      if (t === 21) stand();
    }
    async function stand() {
      if (phase !== 'player' || busy) return;
      phase = 'dealer'; hidden = false; busy = true;
      render(); status('Dealer draws', 'ai'); Sound.pass();
      while (total(dealer) < 17) {
        await sleep(330);
        if (!ctx.alive()) return;
        dealer.push(draw()); Sound.place(); render();
      }
      await sleep(240);
      if (!ctx.alive()) return;
      busy = false; settle();
    }
    async function doubleDown() {
      if (phase !== 'player' || busy || player.length !== 2 || chips < bet) return;
      chips -= bet; stake += bet; saveBank();
      player.push(draw()); Sound.place(); render();
      if (total(player) > 21) { phase = 'dealer'; hidden = false; return settle(); }
      await stand();
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
    function hint() {
      if (phase !== 'player' || !player.length) { setMsg('Deal a hand first.', ''); render(); return; }
      const a = advice(total(player), isSoft(player), worth(dealer[0]), player.length === 2 && chips >= bet);
      const say = a === 'double' && (player.length !== 2 || chips < bet) ? 'hit (double not available)' : a;
      setMsg('Basic play says: ' + say + '.', '');
      render(); Sound.click();
    }

    setMsg('Pick a bet and deal.', '');
    render(); status('Place your bet', 'you');
    return { hint };
  }
};

/* ============================================================
   8. BIG TWO
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
   shell
   ============================================================ */
const GAMES = [ticTacToe, connectFour, reversi, checkers, gomoku, mancala, blackjack, bigTwo];
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hub();
});

function teardown() {
  if (live) { live.destroy(); live = null; }
  screenEl.textContent = '';
}

function hub() {
  teardown();
  document.body.dataset.view = 'hub';
  const wrap = mk('section', 'hub');
  const h1 = mk('h1');
  h1.innerHTML = 'Eight games, no internet,<br><em>one turn at a time.</em>';
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