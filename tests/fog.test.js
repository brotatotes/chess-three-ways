import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/engine/chess.js';
import { visibleMask, observe, fogMoves, fogStatus } from '../src/engine/fog.js';

const sq = C.sqFromName;
const names = (mask) => [...mask].map((v, i) => (v ? C.sqName(i) : null)).filter(Boolean).sort();

test('start position visibility for White', () => {
  const st = C.newGame();
  const vis = names(visibleMask(st, C.WHITE));
  // ranks 1-4 fully visible (own pieces, pawn pushes, pawn diagonals, knight hops)
  for (const f of 'abcdefgh') for (const r of '1234') assert.ok(vis.includes(f + r), f + r);
  assert.ok(!vis.includes('a5'));
  assert.equal(vis.length, 32);
});

test('enemy pieces hidden unless visible', () => {
  const st = C.parseFEN('4k3/8/8/3p4/8/8/8/R3K3 w - - 0 1');
  const obs = observe(st, C.WHITE);
  assert.equal(obs.board[sq('d5')], 0, 'd5 pawn is out of sight');
  assert.equal(obs.board[sq('e8')], 0, 'king out of sight');
  // rook on a1 sees the a-file and rank 1
  assert.equal(obs.visible[sq('a8')], 1);
  const st2 = C.parseFEN('4k3/8/8/R2p4/8/8/8/4K3 w - - 0 1');
  const obs2 = observe(st2, C.WHITE);
  assert.ok(obs2.board[sq('d5')], 'rook on a5 sees d5 pawn as capture target');
  assert.equal(obs2.visible[sq('e5')], 0, 'beyond the blocker is hidden');
});

test('pawn diagonals are visible even when empty, blocked forward square is visible', () => {
  const st = C.parseFEN('4k3/8/8/8/4p3/4P3/8/4K3 w - - 0 1');
  const v = visibleMask(st, C.WHITE);
  assert.equal(v[sq('d4')], 1);
  assert.equal(v[sq('f4')], 1);
  assert.equal(v[sq('e4')], 1, 'blocking pawn is seen');
});

test('king may move into attack and castle through attack', () => {
  const st = C.parseFEN('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
  const u = fogMoves(st).map(C.moveToUci);
  assert.ok(u.includes('e1g1'), 'castling through attack allowed');
  assert.ok(u.includes('e1f2'), 'king captures');
  assert.ok(u.includes('e1d2'));
});

test('capturing the king wins', () => {
  const st = C.parseFEN('4k3/8/8/8/8/8/8/4RK2 w - - 0 1');
  const m = fogMoves(st).find((x) => C.moveToUci(x) === 'e1e8');
  C.makeMove(st, m);
  assert.deepEqual(fogStatus(st), { result: '1-0', reason: 'king captured', winner: C.WHITE });
});

test('observation hides castling rights and ep of opponent', () => {
  const st = C.newGame();
  const obs = observe(st, C.BLACK);
  assert.equal(obs.castling, 12);
  for (let s = 0; s < 16; s++) assert.equal(obs.board[s], 0, 'white back ranks hidden from black at start');
});
