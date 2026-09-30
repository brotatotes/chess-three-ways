// Fog of War AI. It is an honest player: it only ever receives its own
// observation (see engine/fog.js observe) and a memory built from earlier
// observations. It never sees the true board.
import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, genMoves, makeMove, unmakeMove,
  makePiece, colorOf, typeOf,
} from '../engine/chess.js';
import { FOG_OPTS } from '../engine/fog.js';
import { evalWhite, makeRng, PV } from './common.js';

const WIN = 50000;
const LEVELS = {
  easy: { samples: 1, depth: 1, noise: 120, time: 300 },
  medium: { samples: 6, depth: 2, noise: 15, time: 900 },
  hard: { samples: 16, depth: 3, noise: 0, time: 1600 },
};

// Memory: what this side remembers about the enemy.
export function newFogMemory(color) {
  const enemy = color ^ 1;
  const roster = [];
  for (let i = 0; i < 8; i++) roster.push(PAWN);
  roster.push(KNIGHT, KNIGHT, BISHOP, BISHOP, ROOK, ROOK, QUEEN, KING);
  // last-seen squares start at the standard setup
  const last = {};
  const back = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  const br = enemy === WHITE ? 0 : 7, pr = enemy === WHITE ? 1 : 6;
  const seen = [];
  for (let f = 0; f < 8; f++) { seen.push({ t: back[f], sq: br * 8 + f }); seen.push({ t: PAWN, sq: pr * 8 + f }); }
  return { color, roster: roster.map((t) => t), seen, turns: 0, last };
}

// Update memory from a new observation. Visible enemy pieces refresh their
// last-seen squares; pieces no longer visible keep their old guess.
export function updateFogMemory(mem, obs) {
  const enemy = mem.color ^ 1;
  const visibleEnemy = [];
  for (let s = 0; s < 64; s++) {
    const p = obs.board[s];
    if (p && colorOf(p) === enemy) visibleEnemy.push({ t: typeOf(p), sq: s });
  }
  // A visible piece of a type beyond the roster means the enemy promoted.
  const counts = {};
  for (const t of mem.roster) counts[t] = (counts[t] || 0) + 1;
  const vc = {};
  for (const v of visibleEnemy) vc[v.t] = (vc[v.t] || 0) + 1;
  for (const t in vc) {
    while ((counts[t] || 0) < vc[t]) {
      const pi = mem.roster.indexOf(PAWN);
      if (pi >= 0) mem.roster.splice(pi, 1, +t); else mem.roster.push(+t);
      counts[t] = (counts[t] || 0) + 1;
      if (pi >= 0) counts[PAWN]--;
    }
  }
  // Rebuild the seen list: visible pieces are certain. Old guesses stay unless their
  // square is now visible (then the piece is known to have moved from there).
  const next = visibleEnemy.map((v) => ({ t: v.t, sq: v.sq, fresh: true }));
  const used = {};
  for (const v of visibleEnemy) used[v.t] = (used[v.t] || 0) + 1;
  const need = {};
  for (const t of mem.roster) need[t] = (need[t] || 0) + 1;
  for (const old of mem.seen) {
    if ((used[old.t] || 0) >= (need[old.t] || 0)) continue;
    used[old.t] = (used[old.t] || 0) + 1;
    next.push({ t: old.t, sq: old.sq, fresh: false, moved: !!obs.visible[old.sq] });
  }
  // Anything in the roster not yet accounted for (should be rare) gets an unknown square.
  for (const t of mem.roster) {
    if ((used[t] || 0) >= (need[t] || 0)) continue;
    used[t] = (used[t] || 0) + 1;
    next.push({ t, sq: -1, fresh: false, moved: true });
  }
  mem.seen = next;
  mem.turns++;
  return mem;
}

// Call after our own move when it captured a visible enemy piece.
export function fogNoteOwnCapture(mem, capturedType) {
  const i = mem.roster.indexOf(capturedType);
  if (i >= 0) mem.roster.splice(i, 1);
  const j = mem.seen.findIndex((x) => x.t === capturedType);
  if (j >= 0) mem.seen.splice(j, 1);
}

function sampleBoard(obs, mem, rng) {
  const board = obs.board.slice();
  const enemy = obs.color ^ 1;
  const free = (s) => s >= 0 && s < 64 && !board[s] && !obs.visible[s];
  for (const g of mem.seen) {
    if (g.fresh) continue; // already on the observed board
    let sq = -1;
    const pawnOk = (s) => g.t !== PAWN || ((s >> 3) > 0 && (s >> 3) < 7);
    if (!g.moved && free(g.sq) && pawnOk(g.sq)) sq = g.sq;
    else {
      // random walk away from the last known square, preferring nearby hidden squares
      const cands = [];
      for (let s = 0; s < 64; s++) {
        if (!free(s) || !pawnOk(s)) continue;
        if (g.t === PAWN && g.sq >= 0 && (s & 7) !== (g.sq & 7) && Math.abs((s & 7) - (g.sq & 7)) > 1) continue;
        if (g.t === PAWN && g.sq >= 0 && (enemy === WHITE ? (s >> 3) < (g.sq >> 3) : (s >> 3) > (g.sq >> 3))) continue;
        const d = g.sq >= 0 ? Math.max(Math.abs((s & 7) - (g.sq & 7)), Math.abs((s >> 3) - (g.sq >> 3))) : 3;
        cands.push({ s, w: 1 / (1 + d * d) });
      }
      if (!cands.length) continue;
      let tot = 0; for (const c of cands) tot += c.w;
      let r = rng() * tot;
      for (const c of cands) { r -= c.w; if (r <= 0) { sq = c.s; break; } }
      if (sq < 0) sq = cands[cands.length - 1].s;
    }
    if (sq >= 0) board[sq] = makePiece(enemy, g.t);
  }
  const kings = [board.indexOf(makePiece(WHITE, KING)), board.indexOf(makePiece(BLACK, KING))];
  return {
    board, turn: obs.color, castling: obs.castling, ep: obs.ep,
    halfmove: obs.halfmove, fullmove: obs.fullmove, kings, h1: 0, h2: 0, hist1: [], hist2: [],
  };
}

// King-capture negamax on a sampled board.
function kc(st, depth, alpha, beta, ctx) {
  ctx.nodes++;
  const color = st.turn;
  if (st.kings[color] < 0) return -WIN - depth;
  if (depth === 0) { const e = evalWhite(st.board); return color === WHITE ? e : -e; }
  const moves = genMoves(st, color, FOG_OPTS);
  if (!moves.length) return 0;
  for (const m of moves) m._s = m.captured ? ((m.captured & 7) === KING ? 1e6 : PV[m.captured & 7] * 10 - PV[m.piece & 7] / 10) : 0;
  moves.sort((a, b) => b._s - a._s);
  let best = -Infinity;
  for (const m of moves) {
    if ((m.captured & 7) === KING) return WIN + depth;
    const u = makeMove(st, m);
    const sc = -kc(st, depth - 1, -beta, -alpha, ctx);
    unmakeMove(st, m, u);
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return best;
}

// Choose a move from an observation and memory only. Returns { move, ms, samples }.
export function fogMove(obs, mem, level = 'medium', opts = {}) {
  const L = { ...LEVELS[level], ...(opts.override || {}) };
  const rng = makeRng(opts.seed ?? 12345);
  const t0 = performance.now();
  const own = {
    board: obs.board.slice(), turn: obs.color, castling: obs.castling, ep: obs.ep,
    halfmove: 0, fullmove: 1, kings: [-1, -1], h1: 0, h2: 0, hist1: [], hist2: [],
  };
  const moves = genMoves(own, obs.color, FOG_OPTS);
  if (!moves.length) return null;
  // A visible king is always taken.
  const kill = moves.find((m) => (m.captured & 7) === KING);
  if (kill) return { move: kill, ms: performance.now() - t0, samples: 0 };
  const totals = new Float64Array(moves.length);
  let n = 0;
  const ctx = { nodes: 0 };
  for (let i = 0; i < L.samples; i++) {
    if (i > 0 && performance.now() - t0 > L.time) break;
    const sb = sampleBoard(obs, mem, rng);
    for (let j = 0; j < moves.length; j++) {
      const m = moves[j];
      const u = makeMove(sb, m);
      const sc = -kc(sb, L.depth - 1, -Infinity, Infinity, ctx);
      unmakeMove(sb, m, u);
      totals[j] += Math.max(-WIN, Math.min(WIN, sc));
    }
    n++;
  }
  let bi = 0, bs = -Infinity;
  for (let j = 0; j < moves.length; j++) {
    const s = totals[j] / n + (L.noise ? rng.gauss() * L.noise : 0) + (moves[j].captured ? 1 : 0);
    if (s > bs) { bs = s; bi = j; }
  }
  return { move: moves[bi], ms: performance.now() - t0, samples: n, nodes: ctx.nodes };
}
