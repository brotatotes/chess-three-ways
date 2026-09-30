import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/engine/chess.js';

const cases = [
  ['start', C.START_FEN, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position3 en passant', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position4 promotion', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
];

for (const [name, fen, expected] of cases) {
  test(`perft ${name}`, () => {
    const st = C.parseFEN(fen);
    expected.forEach((n, i) => assert.equal(C.perft(st, i + 1), n, `${name} depth ${i + 1}`));
    assert.equal(C.toFEN(st).split(' ')[0], fen.split(' ')[0], 'position restored after perft');
  });
}

function play(st, ucis) {
  for (const u of ucis) {
    const m = C.legalMoves(st).find((x) => C.moveToUci(x) === u);
    assert.ok(m, `illegal ${u} in ${C.toFEN(st)}`);
    C.makeMove(st, m);
  }
  return st;
}

test('checkmate (fool\'s mate)', () => {
  const st = play(C.newGame(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  const s = C.classicStatus(st);
  assert.equal(s.reason, 'checkmate');
  assert.equal(s.result, '0-1');
});

test('stalemate', () => {
  const st = C.parseFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(C.classicStatus(st).reason, 'stalemate');
});

test('threefold repetition', () => {
  const st = play(C.newGame(), ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
  assert.equal(C.classicStatus(st), null);
  play(st, ['f6g8']);
  assert.equal(C.classicStatus(st).reason, 'threefold repetition');
});

test('fifty-move rule', () => {
  const st = C.parseFEN('7k/8/8/8/8/8/R7/K7 w - - 99 80');
  assert.equal(C.classicStatus(st), null);
  play(st, ['a2b2']);
  assert.equal(C.classicStatus(st).reason, 'fifty-move rule');
});

test('insufficient material', () => {
  assert.equal(C.classicStatus(C.parseFEN('8/8/4k3/8/8/3NK3/8/8 w - - 0 1')).reason, 'insufficient material');
  assert.equal(C.classicStatus(C.parseFEN('8/8/4k3/8/8/4K3/8/8 w - - 0 1')).reason, 'insufficient material');
  assert.equal(C.classicStatus(C.parseFEN('8/8/2b1k3/8/8/3BK3/8/8 w - - 0 1')).reason, 'insufficient material');
  assert.equal(C.classicStatus(C.parseFEN('8/8/3bk3/8/8/3BK3/8/8 w - - 0 1')), null);
  assert.equal(C.classicStatus(C.parseFEN('8/8/4k3/8/8/2NNK3/8/8 w - - 0 1')), null);
});

test('castling through check is illegal in Classic', () => {
  const st = C.parseFEN('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
  const u = C.legalMoves(st).map(C.moveToUci);
  assert.ok(!u.includes('e1g1'));
  assert.ok(u.includes('e1c1'));
});

test('promotion choices and SAN', () => {
  const st = C.parseFEN('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promos = C.legalMoves(st).filter((m) => m.from === C.sqFromName('a7'));
  assert.equal(promos.length, 4);
  const q = promos.find((m) => m.promo === C.QUEEN);
  assert.equal(C.san(st, q), 'a8=Q');
});

test('make/unmake keeps hash consistent', () => {
  const st = C.parseFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  for (const m of C.legalMoves(st)) {
    const u = C.makeMove(st, m);
    const [a, b] = C.computeHash(st);
    assert.equal(st.h1, a); assert.equal(st.h2, b);
    C.unmakeMove(st, m, u);
  }
});
