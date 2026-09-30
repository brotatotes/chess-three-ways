// Simultaneous-mode balance harness: node tools/balance.mjs OUT.json [games-per-pairing] [strategies]
// Plays a round robin between strategies with colours alternating and records
// win rates, colour advantage, draw reasons, game length and edge-case counts.
import { writeFileSync } from 'node:fs';
import { newGame, WHITE, BLACK, KING, typeOf, colorOf, isAttacked } from '../src/engine/chess.js';
import { resolveSim, simMoves } from '../src/engine/simul.js';
import { simMove, simEval } from '../src/ai/simul.js';
import { makeRng } from '../src/ai/common.js';

const out = process.argv[2] || 'balance.json';
const N = +(process.argv[3] || 10);
const names = (process.argv[4] || 'random,greedy,kinghunt,turtle,easy,medium,hard').split(',');

const dist = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

// Each strategy: (state, color, rng) => move or null
const STRATS = {
  random: (st, c, rng) => { const ms = simMoves(st, c); return ms.length ? ms[rng.int(ms.length)] : null; },
  greedy: (st, c, rng) => {
    // one-ply: best position assuming the opponent stands still
    const ms = simMoves(st, c); if (!ms.length) return null;
    const sign = c === WHITE ? 1 : -1;
    let best = null, bv = -Infinity;
    for (const m of ms) {
      const r = c === WHITE ? resolveSim(st, m, null) : resolveSim(st, null, m);
      const v = sign * simEval(r.state, r.status) + rng() * 5;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  },
  kinghunt: (st, c, rng) => {
    // take the king if possible, otherwise attack it, otherwise close in with the heaviest pieces
    const ms = simMoves(st, c); if (!ms.length) return null;
    const ek = st.kings[c ^ 1];
    let best = null, bv = -Infinity;
    for (const m of ms) {
      let v = rng() * 2;
      if (m.to === ek) v += 10000;
      const r = c === WHITE ? resolveSim(st, m, null) : resolveSim(st, null, m);
      if (isAttacked(r.state.board, ek, c)) v += 300;
      v += (7 - dist(m.to, ek)) * 10 - (7 - dist(m.from, ek)) * 10;
      if (m.captured) v += 50;
      if (typeOf(m.piece) === KING) v -= 200;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  },
  turtle: (st, c, rng) => {
    // keep everything defended, keep the king boxed in, avoid crossing the middle
    const ms = simMoves(st, c); if (!ms.length) return null;
    let best = null, bv = -Infinity;
    for (const m of ms) {
      const r = c === WHITE ? resolveSim(st, m, null) : resolveSim(st, null, m);
      if (r.status && r.status.winner === c) return m;
      const b = r.state.board;
      let v = rng() * 3;
      for (let s = 0; s < 64; s++) {
        const p = b[s]; if (!p || colorOf(p) !== c) continue;
        if (isAttacked(b, s, c)) v += 4;
        if (isAttacked(b, s, c ^ 1)) v -= typeOf(p) === KING ? 400 : 20;
        const rank = s >> 3, home = c === WHITE ? rank : 7 - rank;
        if (home > 3) v -= 8;
      }
      if (m.captured) v += 30;
      if (typeOf(m.piece) === KING) v -= 15;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  },
  easy: (st, c, rng) => simMove(st, c, 'easy', { seed: rng.int(2 ** 30) }).move,
  medium: (st, c, rng) => simMove(st, c, 'medium', { seed: rng.int(2 ** 30) }).move,
  hard: (st, c, rng) => simMove(st, c, 'hard', { seed: rng.int(2 ** 30) }).move,
};

function play(wName, bName, seed) {
  const rng = makeRng(seed);
  let st = newGame();
  const edge = { swaps: 0, collisions: 0, misses: 0, bothPass: 0, onePass: 0 };
  for (let turn = 1; turn <= 400; turn++) {
    const a = STRATS[wName](st, WHITE, rng), b = STRATS[bName](st, BLACK, rng);
    if (!a && !b) edge.bothPass++; else if (!a || !b) edge.onePass++;
    const r = resolveSim(st, a, b);
    for (const e of r.events) {
      if (e.type === 'swap') edge.swaps++;
      else if (e.type === 'collide') edge.collisions++;
      else if (e.type === 'miss') edge.misses++;
    }
    st = r.state;
    if (r.status) return { winner: r.status.winner, reason: r.status.reason, turns: turn, edge };
  }
  return { winner: -1, reason: 'harness cap', turns: 400, edge };
}

const pair = {};
const byStrat = Object.fromEntries(names.map((n) => [n, { w: 0, l: 0, d: 0 }]));
const color = { white: 0, black: 0, draw: 0 };
const reasons = {};
const lengths = [];
const edgeTotals = { swaps: 0, collisions: 0, misses: 0, bothPass: 0, onePass: 0 };
let games = 0, seed = 1;
const t0 = Date.now();
for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) {
  const A = names[i], B = names[j];
  const rec = { games: 0, aWins: 0, bWins: 0, draws: 0, whiteWins: 0, blackWins: 0, meanTurns: 0 };
  for (let g = 0; g < N; g++) {
    const aWhite = g % 2 === 0;
    const r = play(aWhite ? A : B, aWhite ? B : A, seed++);
    games++; rec.games++; lengths.push(r.turns); rec.meanTurns += r.turns;
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    for (const k in edgeTotals) edgeTotals[k] += r.edge[k];
    if (r.winner === -1) { rec.draws++; color.draw++; if (A !== B) { byStrat[A].d++; byStrat[B].d++; } continue; }
    if (r.winner === WHITE) { rec.whiteWins++; color.white++; } else { rec.blackWins++; color.black++; }
    const aWon = (r.winner === WHITE) === aWhite;
    if (aWon) rec.aWins++; else rec.bWins++;
    if (A !== B) { byStrat[aWon ? A : B].w++; byStrat[aWon ? B : A].l++; }
  }
  rec.meanTurns = +(rec.meanTurns / rec.games).toFixed(1);
  pair[`${A} vs ${B}`] = rec;
  console.log(A, 'vs', B, JSON.stringify(rec));
}
lengths.sort((a, b) => a - b);
const summary = {
  generatedAt: new Date().toISOString(), gamesPerPairing: N, totalGames: games, seconds: (Date.now() - t0) / 1000,
  byStrategy: Object.fromEntries(Object.entries(byStrat).map(([k, v]) => [k, { ...v, score: +((v.w + v.d / 2) / Math.max(1, v.w + v.l + v.d)).toFixed(3) }])),
  colour: color, reasons, edgeTotals,
  turns: { median: lengths[lengths.length >> 1], p10: lengths[Math.floor(lengths.length * 0.1)], p90: lengths[Math.floor(lengths.length * 0.9)], max: lengths[lengths.length - 1] },
  pairings: pair,
};
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ byStrategy: summary.byStrategy, colour: color, reasons, turns: summary.turns, edgeTotals }, null, 1));
