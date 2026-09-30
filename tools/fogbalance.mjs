// Fog of War sanity check: does any simple strategy always win?
// node tools/fogbalance.mjs OUT.json [games-per-pair]
// Scripted players see only their own observation, like the real AI.
import { writeFileSync } from 'node:fs';
import { newGame, makeMove, WHITE, BLACK, KING } from '../src/engine/chess.js';
import { observe, fogStatus, fogMoves } from '../src/engine/fog.js';
import { fogMove, newFogMemory, updateFogMemory, fogNoteOwnCapture } from '../src/ai/fog.js';
import { makeRng } from '../src/ai/common.js';

const out = process.argv[2] || 'fogbalance.json';
const N = +(process.argv[3] || 8);

// Scripted players get the legal move list from the real state (moves only depend on own pieces
// and squares they can see) plus the observation, never enemy pieces off their visible squares.
const PV = [0, 1, 3, 3, 5, 9, 100];
const scripted = {
  random: (st, obs, rng) => { const ms = fogMoves(st); return ms[rng.int(ms.length)]; },
  // Always capture the most valuable visible piece, else push forward toward the enemy back rank.
  rusher: (st, obs, rng) => {
    const ms = fogMoves(st); const c = st.turn;
    let best = null, bv = -1e9;
    for (const m of ms) {
      const cap = m.captured ? PV[m.captured & 7] * 100 : 0;
      const fwd = c === WHITE ? (m.to >> 3) - (m.from >> 3) : (m.from >> 3) - (m.to >> 3);
      const v = cap + fwd * 3 + rng() * 2;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  },
  // Keep pieces home; capture only what is adjacent and free, otherwise shuffle.
  turtle: (st, obs, rng) => {
    const ms = fogMoves(st); const c = st.turn;
    let best = null, bv = -1e9;
    for (const m of ms) {
      const cap = m.captured ? PV[m.captured & 7] * 100 : 0;
      const home = c === WHITE ? -(m.to >> 3) : (m.to >> 3) - 7;
      const v = cap + home * 4 + rng() * 2;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  },
};

function play(names, seed) {
  const st = newGame();
  const rng = makeRng(seed);
  const mem = [newFogMemory(WHITE), newFogMemory(BLACK)];
  for (let ply = 0; ply < 300; ply++) {
    const s = fogStatus(st);
    if (s) return { winner: s.winner, reason: s.reason, plies: ply };
    const c = st.turn, obs = observe(st, c);
    updateFogMemory(mem[c], obs);
    const n = names[c];
    let m;
    if (scripted[n]) m = scripted[n](st, obs, rng);
    else { m = fogMove(obs, mem[c], n, { seed: seed + ply }).move; }
    if (m.captured) fogNoteOwnCapture(mem[c], m.captured & 7);
    makeMove(st, m);
  }
  return { winner: -1, reason: 'ply cap', plies: 300 };
}

const names = ['random', 'rusher', 'turtle', 'easy', 'medium', 'hard'];
const pairs = [];
const colour = { white: 0, black: 0, draw: 0 };
const byStrategy = Object.fromEntries(names.map((n) => [n, { games: 0, wins: 0, losses: 0, draws: 0 }]));
for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) {
  const a = names[i], b = names[j];
  const res = { a, b, games: 0, aWins: 0, bWins: 0, draws: 0, meanPlies: 0 };
  for (let g = 0; g < N; g++) {
    const aWhite = g % 2 === 0;
    const r = play(aWhite ? [a, b] : [b, a], 7919 * (i * 10 + j) + g);
    res.games++; res.meanPlies += r.plies / N;
    const aw = r.winner === -1 ? 0 : (r.winner === WHITE) === aWhite ? 1 : -1;
    if (aw > 0) res.aWins++; else if (aw < 0) res.bWins++; else res.draws++;
    colour[r.winner === WHITE ? 'white' : r.winner === BLACK ? 'black' : 'draw']++;
    for (const [n, w] of [[a, aw], [b, -aw]]) { byStrategy[n].games++; if (w > 0) byStrategy[n].wins++; else if (w < 0) byStrategy[n].losses++; else byStrategy[n].draws++; }
  }
  res.meanPlies = Math.round(res.meanPlies);
  pairs.push(res);
  console.log(a, 'vs', b, JSON.stringify(res));
}
writeFileSync(out, JSON.stringify({ pairs, byStrategy, colour }, null, 1));
console.log(JSON.stringify({ byStrategy, colour }, null, 1));
