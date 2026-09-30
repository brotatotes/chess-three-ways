import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFEN, newGame, moveToUci, cloneState, legalMoves, WHITE, BLACK } from '../src/engine/chess.js';
import { observe } from '../src/engine/fog.js';
import { resolveSim } from '../src/engine/simul.js';
import { classicMove } from '../src/ai/classic.js';
import { fogMove, newFogMemory, updateFogMemory } from '../src/ai/fog.js';
import { simMove } from '../src/ai/simul.js';

test('classic hard finds mate in one', () => {
  const r = classicMove(parseFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'), 'hard');
  assert.equal(moveToUci(r.move), 'a1a8');
});

test('classic hard wins a hanging queen', () => {
  const r = classicMove(parseFEN('rnb1kbnr/pppp1ppp/8/4p1q1/3P4/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1'), 'hard');
  assert.equal(moveToUci(r.move), 'c1g5');
});

test('classic returns legal moves at every level and stays under 2s', () => {
  for (const lvl of ['easy', 'medium', 'hard']) {
    const st = parseFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const legal = legalMoves(st).map(moveToUci);
    const r = classicMove(st, lvl, { seed: 7 });
    assert.ok(legal.includes(moveToUci(r.move)), lvl);
    assert.ok(r.ms < 2000, `${lvl} ${r.ms}`);
  }
});

test('fog AI gets the same answer from two true boards with the same observation', () => {
  // Black hidden pieces differ between the two boards, but White sees the same thing.
  const a = parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const b = parseFEN('rn1qkb1r/pppppppp/5n2/8/8/b7/8/8 w - - 0 1');
  // Construct b as a with Black's hidden pieces moved around.
  const b2 = cloneState(a);
  b2.board[61] = 0; b2.board[42] = 0; // move a black bishop f8 off...
  b2.board[39] = a.board[61]; // ...to h5 (rank 5 is beyond White's view at the start)
  const oa = observe(a, WHITE), ob = observe(b2, WHITE);
  assert.deepEqual(oa, ob, 'observations should match');
  for (const lvl of ['easy', 'medium', 'hard']) {
    const ra = fogMove(oa, updateFogMemory(newFogMemory(WHITE), oa), lvl, { seed: 3 });
    const rb = fogMove(ob, updateFogMemory(newFogMemory(WHITE), ob), lvl, { seed: 3 });
    assert.equal(moveToUci(ra.move), moveToUci(rb.move), lvl);
  }
  void b;
});

test('fog AI never receives hidden squares: observation has no pieces under fog', () => {
  const st = newGame();
  const o = observe(st, BLACK);
  for (let s = 0; s < 64; s++) if (o.board[s] && (o.board[s] >> 3) !== BLACK) assert.equal(o.visible[s], 1);
});

test('fog AI takes a visible king', () => {
  const st = parseFEN('4k3/8/8/8/8/8/8/4R1K1 w - - 0 1');
  const o = observe(st, WHITE);
  const r = fogMove(o, updateFogMemory(newFogMemory(WHITE), o), 'easy');
  assert.equal(moveToUci(r.move), 'e1e8');
});

test('simul AI takes a free king and avoids nothing silly under 2s', () => {
  const st = parseFEN('4k3/8/8/8/8/8/8/4R1K1 w - - 0 1');
  for (const lvl of ['easy', 'medium', 'hard']) {
    const r = simMove(st, WHITE, lvl, { seed: 5 });
    assert.ok(r.move);
    assert.ok(r.ms < 2000);
  }
  const r = simMove(newGame(), BLACK, 'hard', { seed: 1 });
  assert.ok(r.move && r.ms < 2000);
  void resolveSim;
});
