// Classic chess AI: negamax alpha-beta with iterative deepening, a transposition
// table, MVV-LVA ordering, killer moves, history heuristic and quiescence search.
import {
  genMoves, makeMove, unmakeMove, isAttacked, inCheck, legalMoves, repetitionCount,
  insufficientMaterial, KING, PAWN, WHITE,
} from '../engine/chess.js';
import { evalWhite, makeRng, PV } from './common.js';

const MATE = 100000;
const INF = 1 << 30;
const TT_SIZE = 1 << 18;
const LEVELS = {
  easy: { depth: 1, noise: 80, blunder: 0.18, time: 400 },
  medium: { depth: 3, noise: 20, blunder: 0, time: 1200 },
  hard: { depth: 32, noise: 0, blunder: 0, time: 1400 },
};

class Search {
  constructor(deadline) {
    this.deadline = deadline;
    this.nodes = 0;
    this.stopped = false;
    this.ttKey = new Int32Array(TT_SIZE);
    this.ttKey2 = new Int32Array(TT_SIZE);
    this.ttData = new Array(TT_SIZE);
    this.killers = [];
    this.history = new Int32Array(64 * 64);
  }
  timeUp() {
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }
  evaluate(st) {
    const e = evalWhite(st.board);
    return st.turn === WHITE ? e + 10 : -e + 10; // small tempo bonus
  }
  order(moves, ttMove, ply) {
    const k = this.killers[ply] || [];
    for (const m of moves) {
      let s = 0;
      if (ttMove && m.from === ttMove.from && m.to === ttMove.to && m.promo === ttMove.promo) s = 1e7;
      else if (m.captured) s = 1e6 + PV[m.captured & 7] * 10 - PV[m.piece & 7] / 10;
      else if (m.promo) s = 9e5 + PV[m.promo];
      else if (k[0] && k[0].from === m.from && k[0].to === m.to) s = 8e5;
      else if (k[1] && k[1].from === m.from && k[1].to === m.to) s = 7e5;
      else s = this.history[m.from * 64 + m.to];
      m._s = s;
    }
    moves.sort((a, b) => b._s - a._s);
  }
  quiesce(st, alpha, beta, ply) {
    if (this.timeUp()) return 0;
    const stand = this.evaluate(st);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const color = st.turn;
    const moves = genMoves(st, color, { capturesOnly: true, ep: true });
    this.order(moves, null, ply);
    for (const m of moves) {
      if ((m.captured & 7) === KING) return MATE - ply; // previous move was illegal; cannot happen after legality filter
      if (stand + PV[m.captured & 7] + 200 < alpha && !m.promo) continue; // delta pruning
      const u = makeMove(st, m);
      if (isAttacked(st.board, st.kings[color], color ^ 1)) { unmakeMove(st, m, u); continue; }
      const sc = -this.quiesce(st, -beta, -alpha, ply + 1);
      unmakeMove(st, m, u);
      if (this.stopped) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }
  negamax(st, depth, alpha, beta, ply) {
    if (ply > 0) {
      if (st.halfmove >= 100 || repetitionCount(st) >= 2 || insufficientMaterial(st.board)) return 0;
    }
    const color = st.turn;
    const checked = isAttacked(st.board, st.kings[color], color ^ 1);
    if (checked) depth++;
    if (depth <= 0) return this.quiesce(st, alpha, beta, ply);
    if (this.timeUp()) return 0;
    const idx = st.h1 & (TT_SIZE - 1);
    let ttMove = null;
    if (this.ttKey[idx] === (st.h1 | 0) && this.ttKey2[idx] === (st.h2 | 0)) {
      const e = this.ttData[idx];
      ttMove = e.move;
      if (ply > 0 && e.depth >= depth) {
        if (e.flag === 0) return e.score;
        if (e.flag === 1 && e.score >= beta) return e.score;
        if (e.flag === 2 && e.score <= alpha) return e.score;
      }
    }
    const moves = genMoves(st, color, { safeCastle: true, ep: true });
    this.order(moves, ttMove, ply);
    const a0 = alpha;
    let best = -INF, bestMove = null, legal = 0;
    for (const m of moves) {
      const u = makeMove(st, m);
      if (isAttacked(st.board, st.kings[color], color ^ 1)) { unmakeMove(st, m, u); continue; }
      legal++;
      let sc;
      if (legal === 1) sc = -this.negamax(st, depth - 1, -beta, -alpha, ply + 1);
      else {
        // late move reduction for quiet moves
        const reduce = depth >= 3 && legal > 4 && !m.captured && !m.promo && !checked ? 1 : 0;
        sc = -this.negamax(st, depth - 1 - reduce, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha && (reduce || sc < beta)) sc = -this.negamax(st, depth - 1, -beta, -alpha, ply + 1);
      }
      unmakeMove(st, m, u);
      if (this.stopped) return 0;
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!m.captured) {
          const k = this.killers[ply] || (this.killers[ply] = []);
          if (!k[0] || k[0].from !== m.from || k[0].to !== m.to) { k[1] = k[0]; k[0] = m; }
          this.history[m.from * 64 + m.to] += depth * depth;
        }
        break;
      }
    }
    if (!legal) return checked ? -MATE + ply : 0;
    this.ttKey[idx] = st.h1 | 0; this.ttKey2[idx] = st.h2 | 0;
    this.ttData[idx] = { depth, score: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0, move: bestMove };
    return best;
  }
  // Scores every root move at the given depth (used for noisy levels).
  rootScores(st, moves, depth) {
    const out = [];
    for (const m of moves) {
      const u = makeMove(st, m);
      const sc = -this.negamax(st, depth - 1, -INF, INF, 1);
      unmakeMove(st, m, u);
      out.push({ m, sc });
      if (this.stopped) break;
    }
    return out;
  }
}

// Picks a move for the side to move. Returns { move, score, depth, nodes, ms }.
export function classicMove(inputState, level = 'medium', opts = {}) {
  const st = inputState; // caller passes a private copy
  const L = { ...LEVELS[level], ...(opts.override || {}) };
  const rng = makeRng(opts.seed);
  const t0 = performance.now();
  const moves = legalMoves(st);
  if (!moves.length) return null;
  if (moves.length === 1) return { move: moves[0], score: 0, depth: 0, nodes: 0, ms: performance.now() - t0 };
  const S = new Search(t0 + L.time);
  if (L.noise > 0) {
    // Fixed shallow depth, every root move scored, then noise.
    const scored = S.rootScores(st, moves, L.depth);
    for (const s of scored) s.n = s.sc + rng.gauss() * L.noise;
    scored.sort((a, b) => b.n - a.n);
    let pick = scored[0];
    if (L.blunder && rng() < L.blunder) {
      // a "reasonable" random move: anything not losing more than a minor piece against the best
      const best = Math.max(...scored.map((s) => s.sc));
      const ok = scored.filter((s) => s.sc > best - 250);
      pick = ok[rng.int(ok.length)];
    }
    return { move: pick.m, score: pick.sc, depth: L.depth, nodes: S.nodes, ms: performance.now() - t0 };
  }
  let bestMove = moves[0], bestScore = 0, done = 0;
  for (let d = 1; d <= L.depth; d++) {
    const sc = S.negamax(st, d, -INF, INF, 0);
    if (S.stopped) break;
    const e = S.ttData[st.h1 & (TT_SIZE - 1)];
    if (e && e.move) { bestMove = e.move; bestScore = sc; done = d; }
    if (Math.abs(sc) > MATE - 100) break;
    if (performance.now() - t0 > L.time * 0.55) break; // next iteration unlikely to finish
  }
  // return the matching legal move object (TT move comes from genMoves, same shape)
  const m = moves.find((x) => x.from === bestMove.from && x.to === bestMove.to && x.promo === bestMove.promo) || moves[0];
  return { move: m, score: bestScore, depth: done, nodes: S.nodes, ms: performance.now() - t0 };
}

export { inCheck, PAWN };
