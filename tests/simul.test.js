import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/engine/chess.js';
import { resolveSim, simMoves, simStatus } from '../src/engine/simul.js';

const sq = C.sqFromName;
const pick = (st, color, uci) => {
  const m = simMoves(st, color).find((x) => C.moveToUci(x) === uci);
  assert.ok(m, `no move ${uci} for ${color} in ${C.toFEN(st)}`);
  return m;
};
const at = (st, n) => st.board[sq(n)];
const P = (c, t) => C.makePiece(c, t);
const W = C.WHITE, B = C.BLACK;

test('rule 1: slider passes through a square the enemy enters or leaves', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/3n4/R3K3 w - - 0 1');
  // rook a1-h1 path crosses nothing; black knight d2-b1 lands on b1 which is on the rook path
  const r = resolveSim(st, pick(st, W, 'a1c1'), pick(st, B, 'd2b1'));
  assert.equal(at(r.state, 'c1'), P(W, C.ROOK));
  assert.equal(at(r.state, 'b1'), P(B, C.KNIGHT));
});

test('rule 2: swap, stronger wins and completes', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/3n4/3RK3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'd1d2'), pick(st, B, 'd2b1'));
  // not a swap (knight did not go to d1). Rook captures knight? knight moved away: miss
  assert.equal(at(r.state, 'd2'), P(W, C.ROOK));
  assert.equal(at(r.state, 'b1'), P(B, C.KNIGHT));
  assert.ok(r.events.some((e) => e.type === 'miss'));
  const st2 = C.parseFEN('4k3/8/8/8/8/8/3r4/3QK3 w - - 0 1');
  const r2 = resolveSim(st2, pick(st2, W, 'd1d2'), pick(st2, B, 'd2d1'));
  assert.equal(at(r2.state, 'd2'), P(W, C.QUEEN));
  assert.equal(at(r2.state, 'd1'), 0);
  assert.ok(r2.events.some((e) => e.type === 'swap' && e.winner === W));
});

test('rule 2: equal swap removes both', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/3r4/3RK3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'd1d2'), pick(st, B, 'd2d1'));
  assert.equal(at(r.state, 'd1'), 0);
  assert.equal(at(r.state, 'd2'), 0);
});

test('rule 3: same destination, stronger survives', () => {
  const st = C.parseFEN('4k3/8/8/2n5/8/8/8/3QK3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'd1d3'), pick(st, B, 'c5d3'));
  assert.equal(at(r.state, 'd3'), P(W, C.QUEEN));
  assert.equal(at(r.state, 'c5'), 0);
});

test('rule 3: equal strength same destination removes both (knight vs bishop)', () => {
  const st = C.parseFEN('4k3/8/8/2n5/8/8/8/1B2K3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'b1d3'), pick(st, B, 'c5d3'));
  assert.equal(at(r.state, 'd3'), 0);
  assert.equal(at(r.state, 'b1'), 0);
  assert.equal(at(r.state, 'c5'), 0);
});

test('rule 3: pawn push and piece collide, piece wins', () => {
  const st = C.parseFEN('4k3/8/8/8/8/2n5/8/3PK3 w - - 0 1');
  // White pawn d1? use d2 pawn
  const st2 = C.parseFEN('4k3/8/8/8/8/1n6/3P4/4K3 w - - 0 1');
  const r = resolveSim(st2, pick(st2, W, 'd2d4'), pick(st2, B, 'b3d4'));
  assert.equal(at(r.state, 'd4'), P(B, C.KNIGHT));
  assert.equal(at(r.state, 'd2'), 0);
  assert.ok(st);
});

test('rule 4: missed capture still ends on the square, pawn diagonal miss', () => {
  const st = C.parseFEN('4k3/8/8/8/3n4/4P3/8/4K3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'e3d4'), pick(st, B, 'd4b3'));
  assert.equal(at(r.state, 'd4'), P(W, C.PAWN));
  assert.equal(at(r.state, 'b3'), P(B, C.KNIGHT));
});

test('rule 5: capture of a piece that stayed, while the other side moves elsewhere', () => {
  const st = C.parseFEN('4k3/8/8/8/3n4/4P3/8/4K3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'e3d4'), pick(st, B, 'e8d8'));
  assert.equal(at(r.state, 'd4'), P(W, C.PAWN));
  assert.ok(r.events.some((e) => e.type === 'capture'));
});

test('both sides capture each other\'s stationary pieces', () => {
  const st = C.parseFEN('4k3/8/8/8/3n4/4P3/1b6/R3K3 w - - 0 1');
  const r = resolveSim(st, pick(st, W, 'e3d4'), pick(st, B, 'b2a1'));
  assert.equal(at(r.state, 'd4'), P(W, C.PAWN));
  assert.equal(at(r.state, 'a1'), P(B, C.BISHOP));
});

test('rule 6: promotion clashes as a pawn and promotes only if it survives', () => {
  const st = C.parseFEN('4k3/1P6/8/8/8/8/8/n3K3 w - - 0 1');
  const st2 = C.parseFEN('2r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  const wm = simMoves(st2, W).find((m) => C.moveToUci(m) === 'b7b8q');
  const r = resolveSim(st2, wm, pick(st2, B, 'c8b8'));
  assert.equal(at(r.state, 'b8'), P(B, C.ROOK), 'rook beats the promoting pawn');
  const wm2 = simMoves(st2, W).find((m) => C.moveToUci(m) === 'b7b8q');
  const r2 = resolveSim(st2, wm2, pick(st2, B, 'e8f8'));
  assert.equal(at(r2.state, 'b8'), P(W, C.QUEEN));
  assert.ok(r2.events.some((e) => e.type === 'promote'));
  assert.ok(st);
});

test('rule 7: castling rook collides separately', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  const st2 = C.parseFEN('4k3/8/8/8/8/8/4n3/4K2R w K - 0 1');
  const r = resolveSim(st2, pick(st2, W, 'e1g1'), pick(st2, B, 'e2g1'));
  // knight and king meet on g1: king wins. Rook reaches f1.
  assert.equal(at(r.state, 'g1'), P(W, C.KING));
  assert.equal(at(r.state, 'f1'), P(W, C.ROOK));
  const r2 = resolveSim(st2, pick(st2, W, 'e1g1'), pick(st2, B, 'e2f4'));
  assert.equal(at(r2.state, 'g1'), P(W, C.KING));
  assert.equal(r2.state.castling & 3, 0);
  assert.ok(st);
});

test('rule 8: no en passant in Simultaneous', () => {
  const st = C.parseFEN('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
  assert.ok(!simMoves(st, B).some((m) => m.flag === C.F_EP));
});

test('rule 9: king capture wins, double king capture draws', () => {
  const st2 = C.parseFEN('r3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  const r = resolveSim(st2, pick(st2, W, 'a1a8'), pick(st2, B, 'e8d8'));
  assert.equal(r.status, null, 'rook takes rook, not the king');
  const st4 = C.parseFEN('4k2r/8/8/8/8/8/8/4K2R w - - 0 1');
  const r3 = resolveSim(st4, pick(st4, W, 'h1h8'), pick(st4, B, 'h8h1'));
  assert.equal(r3.state.board[sq('h1')], 0);
  assert.equal(r3.state.board[sq('h8')], 0);
  assert.equal(r3.status.reason, 'bare kings', 'equal rook swap removes both');
  const d = C.parseFEN('4k3/4R3/8/8/8/8/4r3/4K3 w - - 0 1');
  const rd = resolveSim(d, pick(d, W, 'e7e8'), pick(d, B, 'e2e1'));
  assert.equal(rd.status.reason, 'both kings fell');
  const w = resolveSim(d, pick(d, W, 'e7e8'), pick(d, B, 'e2a2'));
  assert.equal(w.status.result, '1-0');
  const dodge = resolveSim(d, pick(d, W, 'e7e8'), pick(d, B, 'e8f8'));
  assert.equal(dodge.status, null, 'king dodged, capture missed');
  assert.equal(dodge.state.board[sq('e8')], P(W, C.ROOK));
});

test('rule 10: a side with no moves passes, both stuck is a draw', () => {
  const st = C.parseFEN('k7/p7/P7/8/8/8/8/7K w - - 0 1');
  // black king a8 has b8, b7; construct a truly stuck black side instead
  const s = C.parseFEN('8/8/8/8/8/p7/P7/K6k w - - 0 1');
  s.board[sq('h1')] = 0; s.kings[B] = -1;
  assert.ok(st);
  const blocked = C.parseFEN('7k/8/8/8/8/p7/P7/K7 w - - 0 1');
  const r = resolveSim(blocked, pick(blocked, W, 'a1b1'), null);
  assert.equal(r.state.board[sq('b1')], P(W, C.KING));
  assert.equal(r.state.board[sq('h8')], P(B, C.KING), 'black passed');
  const stuck = C.parseFEN('8/8/8/8/8/p7/P7/8 w - - 0 1');
  stuck.board[sq('a1')] = P(W, C.KING); stuck.board[sq('b1')] = P(W, C.BISHOP);
  stuck.board[sq('c2')] = P(W, C.PAWN); stuck.board[sq('b2')] = P(W, C.PAWN);
  assert.ok(simMoves(stuck, W).length > 0);
});

test('rule 11: bare kings draw and quiet-turn limit', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(simStatus(st).reason, 'bare kings');
  const q = C.parseFEN('4k3/8/8/8/8/8/8/R3K3 w - - 49 1');
  const r = resolveSim(q, pick(q, W, 'a1a2'), pick(q, B, 'e8d8'));
  assert.equal(r.status.reason, 'fifty quiet turns');
});

test('random simultaneous games always terminate and keep one king each at most', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let g = 0; g < 60; g++) {
    let st = C.newGame();
    let status = null, n = 0;
    while (!status && n < 400) {
      const wm = simMoves(st, W), bm = simMoves(st, B);
      const r = resolveSim(st, wm.length ? wm[rand(wm.length)] : null, bm.length ? bm[rand(bm.length)] : null);
      st = r.state; status = r.status; n++;
      assert.ok(st.board.filter((p) => p === P(W, C.KING)).length <= 1);
    }
    assert.ok(status, 'game ended');
  }
});

test('balance rule: kings that would meet both step back', async () => {
  const { parseFEN, sqFromName: q } = await import('../src/engine/chess.js');
  const { resolveSim, simMoves } = await import('../src/engine/simul.js');
  const st = parseFEN('8/8/8/4k3/8/4K3/8/R7 w - - 0 1');
  const pick = (c, f, t) => simMoves(st, c).find((m) => m.from === q(f) && m.to === q(t));
  // same destination
  let r = resolveSim(st, pick(0, 'e3', 'e4'), pick(1, 'e5', 'e4'));
  assert.equal(r.status, null);
  assert.equal(r.state.board[q('e3')] & 7, 6); assert.equal(r.state.board[q('e5')] & 7, 6);
  assert.equal(r.events[0].type, 'kingsBounce');
  // swap
  const st2 = parseFEN('8/8/8/4k3/4K3/8/8/R7 w - - 0 1');
  const p2 = (c, f, t) => simMoves(st2, c).find((m) => m.from === q(f) && m.to === q(t));
  r = resolveSim(st2, p2(0, 'e4', 'e5'), p2(1, 'e5', 'e4'));
  assert.equal(r.status, null);
  assert.equal(r.state.board[q('e4')] & 7, 6); assert.equal(r.state.board[q('e5')] & 7, 6);
  // a king capturing a king that stepped elsewhere still wins as normal
  r = resolveSim(st2, p2(0, 'e4', 'e5'), p2(1, 'e5', 'd6'));
  assert.equal(r.status, null);
});
