// Simultaneous chess rules. Pure JS, no DOM.
// Both sides pick a pseudo-legal move from the same position, then both resolve at once.
import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_CASTLE_K, F_CASTLE_Q,
  genMoves, makePiece, colorOf, typeOf, computeHash,
} from './chess.js';

export const STRENGTH = [0, 1, 3, 3, 5, 9, 100];
export const SIM_OPTS = { safeCastle: false, ep: false };
export const SIM_FIFTY = 50;      // turns without capture, collision or pawn move
export const SIM_MAX_TURNS = 200;

const CASTLE_MASK = new Array(64).fill(15);
CASTLE_MASK[4] = 12; CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14;
CASTLE_MASK[60] = 3; CASTLE_MASK[56] = 7; CASTLE_MASK[63] = 11;

export function simMoves(st, color) {
  return genMoves(st, color, SIM_OPTS);
}

// Expand a move into the pieces it moves (castling moves two).
function movers(m, color) {
  if (!m) return [];
  const list = [{ color, from: m.from, to: m.to, piece: m.piece, promo: m.promo || 0 }];
  if (m.flag === F_CASTLE_K) list.push({ color, from: m.from + 3, to: m.from + 1, piece: makePiece(color, ROOK), promo: 0, rook: true });
  if (m.flag === F_CASTLE_Q) list.push({ color, from: m.from - 4, to: m.from - 1, piece: makePiece(color, ROOK), promo: 0, rook: true });
  return list;
}

function beats(a, b) { // returns 1 if a wins, -1 if b wins, 0 if equal
  const sa = STRENGTH[typeOf(a.piece)], sb = STRENGTH[typeOf(b.piece)];
  return sa > sb ? 1 : sa < sb ? -1 : 0;
}

// Resolve one simultaneous turn. Does not mutate `st`. Returns
// { state, events, status } where events describe what happened for animation and sound.
export function resolveSim(st, wMove, bMove) {
  const B0 = st.board;
  // Balance rule: two kings never trade each other off. If both kings would meet
  // (swapping squares or landing on the same square), both kings step back and the turn is spent.
  if (wMove && bMove && typeOf(wMove.piece) === KING && typeOf(bMove.piece) === KING &&
      (wMove.to === bMove.to || (wMove.to === bMove.from && bMove.to === wMove.from))) {
    const r = resolveSim(st, null, null);
    r.events.unshift({ type: 'kingsBounce', white: { from: wMove.from, to: wMove.to }, black: { from: bMove.from, to: bMove.to } });
    return r;
  }
  const W = movers(wMove, WHITE), K = movers(bMove, BLACK);
  const all = [...W, ...K];
  for (const m of all) { m.alive = true; m.fate = 'moved'; }
  const events = [];
  const movedFrom = new Set(all.map((m) => m.from));

  // Rule 2: swaps meet halfway.
  for (const w of W) for (const b of K) {
    if (!w.alive || !b.alive) continue;
    if (w.to === b.from && b.to === w.from) {
      const r = beats(w, b);
      if (r >= 0) { b.alive = false; b.fate = 'clash'; }
      if (r <= 0) { w.alive = false; w.fate = 'clash'; }
      events.push({ type: 'swap', white: { from: w.from, to: w.to, piece: w.piece }, black: { from: b.from, to: b.to, piece: b.piece }, winner: r > 0 ? WHITE : r < 0 ? BLACK : -1 });
    }
  }
  // Rule 3: same destination.
  for (const w of W) for (const b of K) {
    if (!w.alive || !b.alive) continue;
    if (w.to === b.to) {
      const r = beats(w, b);
      if (r >= 0) { b.alive = false; b.fate = 'clash'; }
      if (r <= 0) { w.alive = false; w.fate = 'clash'; }
      events.push({ type: 'collide', square: w.to, white: { from: w.from, piece: w.piece }, black: { from: b.from, piece: b.piece }, winner: r > 0 ? WHITE : r < 0 ? BLACK : -1 });
    }
  }
  // Rules 4 and 5: captures of pieces that stayed put, misses otherwise.
  const captured = []; // { square, piece }
  for (const m of all) {
    if (!m.alive) continue;
    const target = B0[m.to];
    if (!target || colorOf(target) === m.color) continue;
    if (movedFrom.has(m.to)) { m.fate = 'missed'; events.push({ type: 'miss', color: m.color, from: m.from, to: m.to, piece: m.piece }); continue; }
    captured.push({ square: m.to, piece: target, by: m.color });
    events.push({ type: 'capture', color: m.color, from: m.from, to: m.to, piece: m.piece, victim: target });
  }

  // Build the new board.
  const board = B0.slice();
  for (const m of all) board[m.from] = 0;
  for (const c of captured) board[c.square] = 0;
  for (const m of all) {
    if (!m.alive) continue;
    board[m.to] = m.promo ? makePiece(m.color, m.promo) : m.piece;
    if (m.promo) events.push({ type: 'promote', color: m.color, square: m.to, promo: m.promo });
  }
  let castling = st.castling;
  for (const m of all) castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
  const kings = [board.indexOf(makePiece(WHITE, KING)), board.indexOf(makePiece(BLACK, KING))];
  const eventful = captured.length > 0 || all.some((m) => !m.alive) || all.some((m) => typeOf(m.piece) === PAWN);
  const next = {
    board, turn: WHITE, castling, ep: -1,
    halfmove: eventful ? 0 : st.halfmove + 1,
    fullmove: st.fullmove + 1,
    kings, h1: 0, h2: 0,
    hist1: st.hist1.concat([st.h1]), hist2: st.hist2.concat([st.h2]),
  };
  [next.h1, next.h2] = computeHash(next);
  const status = simStatus(next);
  return { state: next, events, movers: all.map((m) => ({ color: m.color, from: m.from, to: m.to, piece: m.piece, promo: m.promo, alive: m.alive, fate: m.fate, rook: !!m.rook })), status };
}

export function simRepetition(st) {
  let n = 1;
  const len = st.hist1.length;
  const stop = Math.max(0, len - st.halfmove);
  for (let i = len - 1; i >= stop; i--) if (st.hist1[i] === st.h1 && st.hist2[i] === st.h2) n++;
  return n;
}

export function simStatus(st) {
  const wk = st.kings[WHITE] >= 0, bk = st.kings[BLACK] >= 0;
  if (!wk && !bk) return { result: '1/2-1/2', reason: 'both kings fell', winner: -1 };
  if (!wk) return { result: '0-1', reason: 'king captured', winner: BLACK };
  if (!bk) return { result: '1-0', reason: 'king captured', winner: WHITE };
  const wm = simMoves(st, WHITE).length, bm = simMoves(st, BLACK).length;
  if (!wm && !bm) return { result: '1/2-1/2', reason: 'no moves', winner: -1 };
  let others = 0;
  for (let s = 0; s < 64; s++) if (st.board[s] && typeOf(st.board[s]) !== KING) { others++; break; }
  if (!others) return { result: '1/2-1/2', reason: 'bare kings', winner: -1 };
  if (st.halfmove >= SIM_FIFTY) return { result: '1/2-1/2', reason: 'fifty quiet turns', winner: -1 };
  if (simRepetition(st) >= 3) return { result: '1/2-1/2', reason: 'threefold repetition', winner: -1 };
  if (st.fullmove > SIM_MAX_TURNS) return { result: '1/2-1/2', reason: 'turn limit', winner: -1 };
  return null;
}

export { KNIGHT, BISHOP, QUEEN };
