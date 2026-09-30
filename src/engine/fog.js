// Fog of War (dark chess) rules. Pure JS, no DOM.
import {
  WHITE, BLACK, PAWN, KING, genMoves, makeMove, unmakeMove, repetitionCount, colorOf, typeOf,
} from './chess.js';

export const FOG_OPTS = { safeCastle: false, ep: true };

// Every pseudo-legal move for the side to move. Kings may walk into attack.
export function fogMoves(st, color = st.turn) {
  return genMoves(st, color, FOG_OPTS);
}

// Returns a Uint8Array(64) with 1 on squares `color` can see.
// Visible: own pieces, every pseudo-legal destination, the two forward
// diagonals of each own pawn, and the square directly ahead of each own pawn.
export function visibleMask(st, color) {
  const vis = new Uint8Array(64);
  const b = st.board;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p || colorOf(p) !== color) continue;
    vis[s] = 1;
    if (typeOf(p) === PAWN) {
      const one = s + (color === WHITE ? 8 : -8);
      if (one >= 0 && one < 64) {
        vis[one] = 1;
        const f = s & 7;
        if (f > 0) vis[one - 1] = 1;
        if (f < 7) vis[one + 1] = 1;
      }
    }
  }
  for (const m of genMoves(st, color, FOG_OPTS)) vis[m.to] = 1;
  return vis;
}

// What `color` is allowed to know. Enemy pieces only on visible squares.
export function observe(st, color) {
  const vis = visibleMask(st, color);
  const board = new Array(64).fill(0);
  for (let s = 0; s < 64; s++) {
    const p = st.board[s];
    if (!p) continue;
    if (colorOf(p) === color || vis[s]) board[s] = p;
  }
  const ownBits = color === WHITE ? 3 : 12;
  return {
    color,
    board,
    visible: Array.from(vis),
    castling: st.castling & ownBits,
    ep: st.ep >= 0 && vis[st.ep] ? st.ep : -1,
    halfmove: st.halfmove,
    fullmove: st.fullmove,
  };
}

// Result or null. King capture wins; no moves, fifty-move rule or threefold repetition draw.
export function fogStatus(st) {
  if (st.kings[WHITE] < 0) return { result: '0-1', reason: 'king captured', winner: BLACK };
  if (st.kings[BLACK] < 0) return { result: '1-0', reason: 'king captured', winner: WHITE };
  if (fogMoves(st).length === 0) return { result: '1/2-1/2', reason: 'no moves', winner: -1 };
  if (st.halfmove >= 100) return { result: '1/2-1/2', reason: 'fifty-move rule', winner: -1 };
  if (repetitionCount(st) >= 3) return { result: '1/2-1/2', reason: 'threefold repetition', winner: -1 };
  return null;
}

export function fogApply(st, m) {
  makeMove(st, m);
  return fogStatus(st);
}

export { makeMove, unmakeMove, KING };
