// Simultaneous chess AI. Builds a payoff matrix between candidate moves for
// both sides, resolving every pair with the real rules, then picks a move
// against the opponent's likely replies.
import { WHITE, BLACK, KING, PAWN, isAttacked, typeOf, colorOf } from '../engine/chess.js';
import { resolveSim, simMoves } from '../engine/simul.js';
import { evalWhite, makeRng, PV } from './common.js';

const WIN = 50000;
const LEVELS = {
  easy: { k: 6, noise: 90, method: 'greedy', time: 400 },
  medium: { k: 8, noise: 40, method: 'expect', time: 1200 },
  hard: { k: 16, noise: 12, method: 'expect', time: 1800 },
};

// Static score from White's view, with a penalty for pieces the enemy can hit next turn.
export function simEval(st, status) {
  if (status) return status.winner === WHITE ? WIN : status.winner === BLACK ? -WIN : 0;
  let e = evalWhite(st.board);
  for (const c of [WHITE, BLACK]) {
    const sign = c === WHITE ? 1 : -1;
    let worst = 0;
    for (let s = 0; s < 64; s++) {
      const p = st.board[s];
      if (!p || colorOf(p) !== c) continue;
      if (!isAttacked(st.board, s, c ^ 1)) continue;
      const t = typeOf(p);
      const defended = isAttacked(st.board, s, c);
      const v = t === KING ? 700 : defended ? Math.max(0, PV[t] - 250) : PV[t];
      if (v > worst) worst = v;
    }
    // The opponent may hit it, but we also get to move it, so count about half.
    e -= sign * worst * 0.45;
  }
  return e;
}

function candidates(st, color, k, rng, noise) {
  const moves = simMoves(st, color);
  const sign = color === WHITE ? 1 : -1;
  const scored = moves.map((m) => {
    const r = color === WHITE ? resolveSim(st, m, null) : resolveSim(st, null, m);
    return { m, sc: sign * simEval(r.state, r.status) + (noise ? rng.gauss() * noise : 0) };
  });
  scored.sort((a, b) => b.sc - a.sc);
  const top = scored.slice(0, k);
  // Under attack, a captured-from-the-start king can only be saved by moving it
  // (paths and captures are judged from the start of the turn), so never prune king moves.
  const ks = st.kings[color];
  if (ks >= 0 && isAttacked(st.board, ks, color ^ 1)) for (const x of scored.slice(k)) if (x.m.from === ks) top.push(x);
  return top;
}

// Regret matching for the row player of a zero-sum matrix (rows maximise).
function regretMatch(M, iters) {
  const R = M.length, C = M[0].length;
  const rReg = new Float64Array(R), cReg = new Float64Array(C);
  const rSum = new Float64Array(R);
  const rs = new Float64Array(R), cs = new Float64Array(C);
  const norm = (reg, out) => {
    let t = 0;
    for (let i = 0; i < reg.length; i++) { out[i] = reg[i] > 0 ? reg[i] : 0; t += out[i]; }
    for (let i = 0; i < reg.length; i++) out[i] = t > 0 ? out[i] / t : 1 / reg.length;
  };
  for (let it = 0; it < iters; it++) {
    norm(rReg, rs); norm(cReg, cs);
    const rowU = new Float64Array(R), colU = new Float64Array(C);
    let v = 0;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { rowU[i] += M[i][j] * cs[j]; colU[j] -= M[i][j] * rs[i]; }
    for (let i = 0; i < R; i++) v += rowU[i] * rs[i];
    for (let i = 0; i < R; i++) rReg[i] += rowU[i] - v;
    let vc = 0; for (let j = 0; j < C; j++) vc += colU[j] * cs[j];
    for (let j = 0; j < C; j++) cReg[j] += colU[j] - vc;
    for (let i = 0; i < R; i++) rSum[i] += rs[i];
  }
  let t = 0; for (let i = 0; i < R; i++) t += rSum[i];
  return Array.from(rSum, (x) => x / t);
}

function seen(st, nx) {
  const h1 = st.hist1 || [], h2 = st.hist2 || [];
  if (st.h1 === nx.h1 && st.h2 === nx.h2) return true;
  for (let i = h1.length - 1; i >= 0; i--) if (h1[i] === nx.h1 && h2[i] === nx.h2) return true;
  return false;
}

// Pick a move for `color` in simultaneous state `st`. Returns { move, ms } (move may be null = pass).
export function simMove(st, color, level = 'medium', opts = {}) {
  const L = { ...LEVELS[level], ...(opts.override || {}) };
  const rng = makeRng(opts.seed);
  const t0 = performance.now();
  const mine = candidates(st, color, L.k, rng, L.noise);
  if (!mine.length) return { move: null, ms: performance.now() - t0 };
  if (L.method === 'greedy') {
    // Easy: mostly the top move, sometimes another of the top few.
    const pick = rng() < 0.7 ? mine[0] : mine[rng.int(Math.min(4, mine.length))];
    return { move: pick.m, ms: performance.now() - t0 };
  }
  const theirs = candidates(st, color ^ 1, L.k, rng, 0);
  if (!theirs.length) theirs.push({ m: null, sc: 0 });
  const sign = color === WHITE ? 1 : -1;
  const M = mine.map((a) => theirs.map((b) => {
    const r = color === WHITE ? resolveSim(st, a.m, b.m) : resolveSim(st, b.m, a.m);
    const v = sign * simEval(r.state, r.status);
    // Anti-repetition: a position seen before is worth less to the side that is ahead,
    // so strong players press for a win instead of shuffling into a draw.
    return !r.status && v > 0 && seen(st, r.state) ? v * 0.4 : v;
  }));
  let pick;
  if (L.method === 'expect') {
    // Opponent plays its better candidates more often (softmax over their own one-ply score).
    const w = theirs.map((b) => Math.exp((b.sc - theirs[0].sc) / 120));
    const tw = w.reduce((a, b) => a + b, 0);
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < mine.length; i++) {
      let v = 0; for (let j = 0; j < theirs.length; j++) v += M[i][j] * w[j] / tw;
      // blend in the worst case so it avoids outright blunders
      const worst = Math.min(...M[i]);
      v = 0.75 * v + 0.25 * worst + (L.noise ? rng.gauss() * L.noise : 0);
      if (v > bv) { bv = v; bi = i; }
    }
    pick = mine[bi];
  } else {
    // Clip huge win/loss values so the mixed strategy stays sensible.
    const C = M.map((row) => row.map((v) => Math.max(-3000, Math.min(3000, v))));
    const p = regretMatch(C, 400);
    // Sample from the strategy but drop negligible weights.
    const cut = p.map((x) => (x < 0.05 ? 0 : x));
    let t = cut.reduce((a, b) => a + b, 0);
    if (t === 0) { cut.fill(0); cut[p.indexOf(Math.max(...p))] = 1; t = 1; }
    let r = rng() * t, bi = 0;
    for (let i = 0; i < cut.length; i++) { r -= cut[i]; if (r <= 0) { bi = i; break; } }
    pick = mine[bi];
  }
  return { move: pick.m, ms: performance.now() - t0 };
}

export { PAWN };
