// Core chess rules. Pure JS, no DOM. Used by the UI, the AI worker and tests.
// Squares are 0..63 with a1 = 0, h1 = 7, a8 = 56. Pieces are small integers:
// type | (color << 3), where color 0 is White and 1 is Black.

export const EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;
export const makePiece = (color, type) => type | (color << 3);
export const colorOf = (p) => p >> 3;
export const typeOf = (p) => p & 7;
export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 3;
export const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
export const sqFromName = (n) => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;

// Move flags
export const F_NORMAL = 0, F_DOUBLE = 1, F_EP = 2, F_CASTLE_K = 3, F_CASTLE_Q = 4;

const PIECE_CHARS = ' pnbrqk';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------- precomputed tables ----------
const KNIGHT_T = [], KING_T = [], RAYS = [];
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]; // N S E W NE NW SE SW as [df, dr]
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  const kn = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kn.push(nr * 8 + nf);
  }
  KNIGHT_T.push(kn);
  const kg = [];
  for (const [df, dr] of DIRS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) kg.push(nr * 8 + nf);
  }
  KING_T.push(kg);
  const rays = [];
  for (const [df, dr] of DIRS) {
    const ray = [];
    let nf = f + df, nr = r + dr;
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { ray.push(nr * 8 + nf); nf += df; nr += dr; }
    rays.push(ray);
  }
  RAYS.push(rays);
}
export { KNIGHT_T, KING_T, RAYS };
const ROOK_DIRS = [0, 1, 2, 3], BISHOP_DIRS = [4, 5, 6, 7], QUEEN_DIRS = [0, 1, 2, 3, 4, 5, 6, 7];

// Castling rights bits: 1 = White king side, 2 = White queen side, 4 = Black king side, 8 = Black queen side
const CASTLE_MASK = new Array(64).fill(15);
CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1;
CASTLE_MASK[60] = 15 & ~12; CASTLE_MASK[56] = 15 & ~8; CASTLE_MASK[63] = 15 & ~4;

// ---------- Zobrist hashing (two 32-bit halves) ----------
let seed = 0x9E3779B9;
function rnd32() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
const Z1 = new Uint32Array(16 * 64), Z2 = new Uint32Array(16 * 64);
for (let i = 0; i < 16 * 64; i++) { Z1[i] = rnd32(); Z2[i] = rnd32(); }
const ZC1 = new Uint32Array(16), ZC2 = new Uint32Array(16);
for (let i = 0; i < 16; i++) { ZC1[i] = rnd32(); ZC2[i] = rnd32(); }
const ZE1 = new Uint32Array(64), ZE2 = new Uint32Array(64);
for (let i = 0; i < 64; i++) { ZE1[i] = rnd32(); ZE2[i] = rnd32(); }
const ZS1 = rnd32(), ZS2 = rnd32();

export function computeHash(st) {
  let h1 = 0, h2 = 0;
  for (let s = 0; s < 64; s++) { const p = st.board[s]; if (p) { h1 ^= Z1[p * 64 + s]; h2 ^= Z2[p * 64 + s]; } }
  h1 ^= ZC1[st.castling]; h2 ^= ZC2[st.castling];
  if (st.ep >= 0) { h1 ^= ZE1[st.ep]; h2 ^= ZE2[st.ep]; }
  if (st.turn) { h1 ^= ZS1; h2 ^= ZS2; }
  return [h1 >>> 0, h2 >>> 0];
}

// ---------- state ----------
export function parseFEN(fen) {
  const [placement, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(0);
  const rows = placement.split('/');
  for (let i = 0; i < 8; i++) {
    let f = 0; const r = 7 - i;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else {
        const lower = ch.toLowerCase();
        const t = PIECE_CHARS.indexOf(lower);
        board[r * 8 + f] = makePiece(ch === lower ? BLACK : WHITE, t);
        f++;
      }
    }
  }
  let castling = 0;
  if (castle && castle !== '-') {
    if (castle.includes('K')) castling |= 1;
    if (castle.includes('Q')) castling |= 2;
    if (castle.includes('k')) castling |= 4;
    if (castle.includes('q')) castling |= 8;
  }
  const st = {
    board, turn: turn === 'b' ? BLACK : WHITE, castling,
    ep: ep && ep !== '-' ? sqFromName(ep) : -1,
    halfmove: half ? +half : 0, fullmove: full ? +full : 1,
    kings: [board.indexOf(makePiece(WHITE, KING)), board.indexOf(makePiece(BLACK, KING))],
    h1: 0, h2: 0, hist1: [], hist2: [],
  };
  [st.h1, st.h2] = computeHash(st);
  return st;
}

export function toFEN(st) {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = st.board[r * 8 + f];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const ch = PIECE_CHARS[typeOf(p)];
      out += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
    }
    if (empty) out += empty;
    if (r) out += '/';
  }
  let c = '';
  if (st.castling & 1) c += 'K'; if (st.castling & 2) c += 'Q';
  if (st.castling & 4) c += 'k'; if (st.castling & 8) c += 'q';
  return `${out} ${st.turn ? 'b' : 'w'} ${c || '-'} ${st.ep >= 0 ? sqName(st.ep) : '-'} ${st.halfmove} ${st.fullmove}`;
}

export function cloneState(st) {
  return {
    board: st.board.slice(), turn: st.turn, castling: st.castling, ep: st.ep,
    halfmove: st.halfmove, fullmove: st.fullmove, kings: st.kings.slice(),
    h1: st.h1, h2: st.h2, hist1: st.hist1.slice(), hist2: st.hist2.slice(),
  };
}

export const newGame = () => parseFEN(START_FEN);

// ---------- attacks ----------
export function isAttacked(board, sq, by) {
  const f = sq & 7;
  if (by === WHITE) {
    if (f > 0 && sq >= 9 && board[sq - 9] === PAWN) return true;
    if (f < 7 && sq >= 7 && board[sq - 7] === PAWN) return true;
  } else {
    const bp = makePiece(BLACK, PAWN);
    if (f > 0 && sq + 7 < 64 && board[sq + 7] === bp) return true;
    if (f < 7 && sq + 9 < 64 && board[sq + 9] === bp) return true;
  }
  const kn = makePiece(by, KNIGHT);
  for (const t of KNIGHT_T[sq]) if (board[t] === kn) return true;
  const kg = makePiece(by, KING);
  for (const t of KING_T[sq]) if (board[t] === kg) return true;
  const rk = makePiece(by, ROOK), bs = makePiece(by, BISHOP), qn = makePiece(by, QUEEN);
  const rays = RAYS[sq];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    for (let i = 0; i < ray.length; i++) {
      const p = board[ray[i]];
      if (!p) continue;
      if (p === qn || (d < 4 ? p === rk : p === bs)) return true;
      break;
    }
  }
  return false;
}

export function inCheck(st, color = st.turn) {
  const k = st.kings[color];
  return k >= 0 && isAttacked(st.board, k, color ^ 1);
}

// ---------- move generation ----------
// opts.safeCastle: castling requires king not in check and not passing through attack (Classic)
// opts.ep: allow en passant (Classic and Fog)
// opts.capturesOnly: only captures and promotions (quiescence)
function mv(from, to, piece, captured, flag, promo) { return { from, to, piece, captured, flag, promo }; }

export function genMoves(st, color = st.turn, opts = {}, out = []) {
  const board = st.board;
  const safeCastle = opts.safeCastle !== false;
  const allowEp = opts.ep !== false;
  const capOnly = !!opts.capturesOnly;
  const enemy = color ^ 1;
  const dir = color === WHITE ? 8 : -8;
  const startRank = color === WHITE ? 1 : 6;
  const lastRank = color === WHITE ? 7 : 0;
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || (p >> 3) !== color) continue;
    const t = p & 7;
    if (t === PAWN) {
      const one = s + dir;
      if (one >= 0 && one < 64) {
        if (!board[one]) {
          if ((one >> 3) === lastRank) {
            for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mv(s, one, p, 0, F_NORMAL, pr));
          } else if (!capOnly) {
            out.push(mv(s, one, p, 0, F_NORMAL, 0));
            if ((s >> 3) === startRank && !board[one + dir]) out.push(mv(s, one + dir, p, 0, F_DOUBLE, 0));
          }
        }
        const f = s & 7;
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const tq = one + df;
          const q = board[tq];
          if (q && (q >> 3) === enemy) {
            if ((tq >> 3) === lastRank) for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mv(s, tq, p, q, F_NORMAL, pr));
            else out.push(mv(s, tq, p, q, F_NORMAL, 0));
          } else if (allowEp && tq === st.ep && !q) {
            out.push(mv(s, tq, p, makePiece(enemy, PAWN), F_EP, 0));
          }
        }
      }
    } else if (t === KNIGHT || t === KING) {
      const tbl = t === KNIGHT ? KNIGHT_T[s] : KING_T[s];
      for (const tq of tbl) {
        const q = board[tq];
        if (!q) { if (!capOnly) out.push(mv(s, tq, p, 0, F_NORMAL, 0)); }
        else if ((q >> 3) === enemy) out.push(mv(s, tq, p, q, F_NORMAL, 0));
      }
      if (t === KING && !capOnly) genCastles(st, color, s, p, safeCastle, out);
    } else {
      const dirs = t === ROOK ? ROOK_DIRS : t === BISHOP ? BISHOP_DIRS : QUEEN_DIRS;
      const rays = RAYS[s];
      for (const d of dirs) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const tq = ray[i], q = board[tq];
          if (!q) { if (!capOnly) out.push(mv(s, tq, p, 0, F_NORMAL, 0)); continue; }
          if ((q >> 3) === enemy) out.push(mv(s, tq, p, q, F_NORMAL, 0));
          break;
        }
      }
    }
  }
  return out;
}

function genCastles(st, color, s, p, safe, out) {
  const home = color === WHITE ? 4 : 60;
  if (s !== home) return;
  const board = st.board, enemy = color ^ 1;
  const kBit = color === WHITE ? 1 : 4, qBit = color === WHITE ? 2 : 8;
  const rook = makePiece(color, ROOK);
  if ((st.castling & kBit) && board[home + 3] === rook && !board[home + 1] && !board[home + 2]) {
    if (!safe || (!isAttacked(board, home, enemy) && !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)))
      out.push(mv(home, home + 2, p, 0, F_CASTLE_K, 0));
  }
  if ((st.castling & qBit) && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3]) {
    if (!safe || (!isAttacked(board, home, enemy) && !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)))
      out.push(mv(home, home - 2, p, 0, F_CASTLE_Q, 0));
  }
}

// ---------- make / unmake ----------
export function makeMove(st, m) {
  const board = st.board;
  const color = m.piece >> 3;
  const undo = { castling: st.castling, ep: st.ep, halfmove: st.halfmove, h1: st.h1, h2: st.h2, capSq: m.to, k0: st.kings[0], k1: st.kings[1] };
  let h1 = st.h1, h2 = st.h2;
  st.hist1.push(h1); st.hist2.push(h2);
  // remove old castling / ep from hash
  h1 ^= ZC1[st.castling]; h2 ^= ZC2[st.castling];
  if (st.ep >= 0) { h1 ^= ZE1[st.ep]; h2 ^= ZE2[st.ep]; }
  // capture
  if (m.flag === F_EP) {
    const cs = m.to + (color === WHITE ? -8 : 8);
    undo.capSq = cs;
    board[cs] = 0; h1 ^= Z1[m.captured * 64 + cs]; h2 ^= Z2[m.captured * 64 + cs];
  } else if (m.captured) {
    h1 ^= Z1[m.captured * 64 + m.to]; h2 ^= Z2[m.captured * 64 + m.to];
    if ((m.captured & 7) === KING) st.kings[m.captured >> 3] = -1;
  }
  // move piece
  board[m.from] = 0; h1 ^= Z1[m.piece * 64 + m.from]; h2 ^= Z2[m.piece * 64 + m.from];
  const placed = m.promo ? makePiece(color, m.promo) : m.piece;
  board[m.to] = placed; h1 ^= Z1[placed * 64 + m.to]; h2 ^= Z2[placed * 64 + m.to];
  if ((m.piece & 7) === KING) st.kings[color] = m.to;
  if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) {
    const rf = m.flag === F_CASTLE_K ? m.from + 3 : m.from - 4;
    const rt = m.flag === F_CASTLE_K ? m.from + 1 : m.from - 1;
    const rook = board[rf];
    board[rf] = 0; board[rt] = rook;
    h1 ^= Z1[rook * 64 + rf] ^ Z1[rook * 64 + rt]; h2 ^= Z2[rook * 64 + rf] ^ Z2[rook * 64 + rt];
  }
  st.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
  h1 ^= ZC1[st.castling]; h2 ^= ZC2[st.castling];
  // en passant square only when an enemy pawn could actually capture (keeps repetition honest)
  st.ep = -1;
  if (m.flag === F_DOUBLE) {
    const f = m.to & 7, ep_ = m.from + (color === WHITE ? 8 : -8);
    const ep = makePiece(color ^ 1, PAWN);
    if ((f > 0 && board[m.to - 1] === ep) || (f < 7 && board[m.to + 1] === ep)) {
      st.ep = ep_; h1 ^= ZE1[ep_]; h2 ^= ZE2[ep_];
    }
  }
  st.halfmove = (m.captured || (m.piece & 7) === PAWN) ? 0 : st.halfmove + 1;
  if (color === BLACK) st.fullmove++;
  st.turn ^= 1; h1 ^= ZS1; h2 ^= ZS2;
  st.h1 = h1 >>> 0; st.h2 = h2 >>> 0;
  return undo;
}

export function unmakeMove(st, m, undo) {
  const board = st.board;
  const color = m.piece >> 3;
  st.turn ^= 1;
  if (color === BLACK) st.fullmove--;
  if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) {
    const rf = m.flag === F_CASTLE_K ? m.from + 3 : m.from - 4;
    const rt = m.flag === F_CASTLE_K ? m.from + 1 : m.from - 1;
    board[rf] = board[rt]; board[rt] = 0;
  }
  board[m.from] = m.piece;
  board[m.to] = 0;
  if (m.captured) board[undo.capSq] = m.captured;
  st.castling = undo.castling; st.ep = undo.ep; st.halfmove = undo.halfmove;
  st.h1 = undo.h1; st.h2 = undo.h2;
  st.kings[0] = undo.k0; st.kings[1] = undo.k1;
  st.hist1.pop(); st.hist2.pop();
}

// Null move for search (pass the turn)
export function makeNull(st) {
  const undo = { ep: st.ep, h1: st.h1, h2: st.h2 };
  st.hist1.push(st.h1); st.hist2.push(st.h2);
  let h1 = st.h1 ^ ZS1, h2 = st.h2 ^ ZS2;
  if (st.ep >= 0) { h1 ^= ZE1[st.ep]; h2 ^= ZE2[st.ep]; st.ep = -1; }
  st.h1 = h1 >>> 0; st.h2 = h2 >>> 0; st.turn ^= 1;
  return undo;
}
export function unmakeNull(st, undo) {
  st.turn ^= 1; st.ep = undo.ep; st.h1 = undo.h1; st.h2 = undo.h2; st.hist1.pop(); st.hist2.pop();
}

// ---------- Classic legality ----------
export function legalMoves(st) {
  const color = st.turn, out = [];
  for (const m of genMoves(st, color, { safeCastle: true, ep: true })) {
    const u = makeMove(st, m);
    if (!isAttacked(st.board, st.kings[color], color ^ 1)) out.push(m);
    unmakeMove(st, m, u);
  }
  return out;
}

export function perft(st, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(st);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) { const u = makeMove(st, m); n += perft(st, depth - 1); unmakeMove(st, m, u); }
  return n;
}

// ---------- draws and status ----------
export function repetitionCount(st) {
  let n = 1;
  const len = st.hist1.length;
  const stop = Math.max(0, len - st.halfmove);
  for (let i = len - 2; i >= stop; i -= 2) if (st.hist1[i] === st.h1 && st.hist2[i] === st.h2) n++;
  return n;
}

export function insufficientMaterial(board) {
  const minors = [];
  for (let s = 0; s < 64; s++) {
    const p = board[s]; if (!p) continue;
    const t = p & 7;
    if (t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors.push({ t, c: p >> 3, sq: s });
  }
  if (minors.length <= 1) return true;
  // only bishops, all on the same square colour
  if (minors.every((m) => m.t === BISHOP)) {
    const shade = (s) => ((s >> 3) + (s & 7)) & 1;
    return minors.every((m) => shade(m.sq) === shade(minors[0].sq));
  }
  return false;
}

// Classic result: null while playing, else { result: '1-0' | '0-1' | '1/2-1/2', reason }
export function classicStatus(st, moves = legalMoves(st)) {
  if (moves.length === 0) {
    if (inCheck(st)) return { result: st.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate', winner: st.turn ^ 1 };
    return { result: '1/2-1/2', reason: 'stalemate', winner: -1 };
  }
  if (insufficientMaterial(st.board)) return { result: '1/2-1/2', reason: 'insufficient material', winner: -1 };
  if (st.halfmove >= 100) return { result: '1/2-1/2', reason: 'fifty-move rule', winner: -1 };
  if (repetitionCount(st) >= 3) return { result: '1/2-1/2', reason: 'threefold repetition', winner: -1 };
  return null;
}

// ---------- notation ----------
export function moveToUci(m) {
  return sqName(m.from) + sqName(m.to) + (m.promo ? PIECE_CHARS[m.promo] : '');
}

export function san(st, m, legal = legalMoves(st)) {
  const t = m.piece & 7;
  let s;
  if (m.flag === F_CASTLE_K) s = 'O-O';
  else if (m.flag === F_CASTLE_Q) s = 'O-O-O';
  else {
    const cap = m.captured ? 'x' : '';
    if (t === PAWN) {
      s = (cap ? 'abcdefgh'[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + PIECE_CHARS[m.promo].toUpperCase() : '');
    } else {
      const L = PIECE_CHARS[t].toUpperCase();
      const others = legal.filter((o) => o.to === m.to && o.piece === m.piece && o.from !== m.from);
      let dis = '';
      if (others.length) {
        if (!others.some((o) => (o.from & 7) === (m.from & 7))) dis = 'abcdefgh'[m.from & 7];
        else if (!others.some((o) => (o.from >> 3) === (m.from >> 3))) dis = String((m.from >> 3) + 1);
        else dis = sqName(m.from);
      }
      s = L + dis + cap + sqName(m.to);
    }
  }
  const u = makeMove(st, m);
  if (inCheck(st)) s += legalMoves(st).length ? '+' : '#';
  unmakeMove(st, m, u);
  return s;
}

export const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
export const VALUES = [0, 100, 320, 330, 500, 900, 20000];
