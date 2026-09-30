// Shared AI helpers: seeded random numbers and a positional evaluation.
import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../engine/chess.js';

export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let s = seed >>> 0 || 1;
  const rng = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  rng.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  rng.int = (n) => Math.floor(rng() * n);
  return rng;
}

export const PV = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables written from White's point of view, rank 8 first.
const T = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  kmg: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
  keg: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50],
};

// PST[color][type][square] with a1 = 0 indexing. type 6 = king middlegame, 7 = king endgame.
export const PST = [[], []];
for (const c of [WHITE, BLACK]) {
  for (const t of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, 6, 7]) {
    const src = t === 6 ? T.kmg : t === 7 ? T.keg : T[t];
    const arr = new Int16Array(64);
    for (let s = 0; s < 64; s++) {
      const f = s & 7, r = s >> 3;
      arr[s] = c === WHITE ? src[(7 - r) * 8 + f] : src[r * 8 + f];
    }
    PST[c][t] = arr;
  }
}

// Static evaluation in centipawns from White's point of view.
export function evalWhite(board) {
  let mg = 0, phase = 0, kw = -1, kb = -1;
  let wb = 0, bb = 0;
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p) continue;
    const t = p & 7, c = p >> 3, sign = c === WHITE ? 1 : -1;
    if (t === KING) { if (c === WHITE) kw = s; else kb = s; continue; }
    mg += sign * (PV[t] + PST[c][t][s]);
    if (t === KNIGHT || t === BISHOP) phase += 1;
    else if (t === ROOK) phase += 2;
    else if (t === QUEEN) phase += 4;
    if (t === BISHOP) { if (c === WHITE) wb++; else bb++; }
    if (t === PAWN) pawnFiles[c][s & 7]++;
  }
  if (wb >= 2) mg += 30;
  if (bb >= 2) mg -= 30;
  for (let c = 0; c < 2; c++) {
    const pf = pawnFiles[c], sign = c === WHITE ? 1 : -1;
    for (let f = 0; f < 8; f++) {
      if (!pf[f]) continue;
      if (pf[f] > 1) mg -= sign * 15 * (pf[f] - 1);
      if ((f === 0 || !pf[f - 1]) && (f === 7 || !pf[f + 1])) mg -= sign * 12 * pf[f];
    }
  }
  const ph = Math.min(phase, 24);
  if (kw >= 0) mg += (PST[WHITE][6][kw] * ph + PST[WHITE][7][kw] * (24 - ph)) / 24;
  if (kb >= 0) mg -= (PST[BLACK][6][kb] * ph + PST[BLACK][7][kb] * (24 - ph)) / 24;
  return mg | 0;
}
