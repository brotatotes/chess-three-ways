// Quick AI self-play match: node tools/selfplay.mjs OUT.json [games-per-mode]
// Plays hard vs easy (alternating colours) in each mode and records move times.
import { writeFileSync } from 'node:fs';
import { newGame, makeMove, legalMoves, classicStatus, cloneState, WHITE, BLACK } from '../src/engine/chess.js';
import { observe, fogStatus } from '../src/engine/fog.js';
import { resolveSim } from '../src/engine/simul.js';
import { classicMove } from '../src/ai/classic.js';
import { fogMove, newFogMemory, updateFogMemory, fogNoteOwnCapture } from '../src/ai/fog.js';
import { simMove } from '../src/ai/simul.js';
import { evalWhite } from '../src/ai/common.js';

const out = process.argv[2] || 'selfplay.json';
const N = +(process.argv[3] || 6);
const modes = (process.argv[4] || 'classic,fog,simul').split(',');
const times = {};
const rec = (k, ms) => { (times[k] = times[k] || []).push(ms); };

function adjudicate(st) {
  const e = evalWhite(st.board);
  return e > 300 ? WHITE : e < -300 ? BLACK : -1;
}

function playClassic(levels, seed) {
  const st = newGame();
  for (let ply = 0; ply < 200; ply++) {
    const s = classicStatus(st);
    if (s) return { winner: s.winner, reason: s.reason, plies: ply };
    const lvl = levels[st.turn];
    const r = classicMove(cloneState(st), lvl, { seed: seed + ply });
    rec('classic-' + lvl, r.ms);
    makeMove(st, legalMoves(st).find((m) => m.from === r.move.from && m.to === r.move.to && m.promo === r.move.promo));
  }
  return { winner: adjudicate(st), reason: 'adjudicated at 200 plies', plies: 200 };
}

function playFog(levels, seed) {
  const st = newGame();
  const mem = [newFogMemory(WHITE), newFogMemory(BLACK)];
  for (let ply = 0; ply < 300; ply++) {
    const s = fogStatus(st);
    if (s) return { winner: s.winner, reason: s.reason, plies: ply };
    const c = st.turn;
    const obs = observe(st, c);
    updateFogMemory(mem[c], obs);
    const r = fogMove(obs, mem[c], levels[c], { seed: seed + ply });
    rec('fog-' + levels[c], r.ms);
    if (r.move.captured) fogNoteOwnCapture(mem[c], r.move.captured & 7);
    makeMove(st, r.move);
  }
  return { winner: adjudicate(st), reason: 'adjudicated at 300 plies', plies: 300 };
}

function playSimul(levels, seed) {
  let st = newGame();
  for (let turn = 0; turn < 250; turn++) {
    const a = simMove(st, WHITE, levels[WHITE], { seed: seed + turn * 2 });
    const b = simMove(st, BLACK, levels[BLACK], { seed: seed + turn * 2 + 1 });
    rec('simul-' + levels[WHITE], a.ms); rec('simul-' + levels[BLACK], b.ms);
    const r = resolveSim(st, a.move, b.move);
    st = r.state;
    if (r.status) return { winner: r.status.winner, reason: r.status.reason, plies: turn + 1 };
  }
  return { winner: adjudicate(st), reason: 'adjudicated', plies: 250 };
}

const players = { classic: playClassic, fog: playFog, simul: playSimul };
const results = {};
for (const mode of modes) {
  const games = [];
  for (let g = 0; g < N; g++) {
    const hardColor = g % 2 === 0 ? WHITE : BLACK;
    const levels = hardColor === WHITE ? ['hard', 'easy'] : ['easy', 'hard'];
    const t0 = Date.now();
    const r = players[mode](levels, 1000 * g + 17);
    const res = r.winner === hardColor ? 'hard' : r.winner === -1 ? 'draw' : 'easy';
    games.push({ game: g + 1, hardColor: hardColor === WHITE ? 'white' : 'black', result: res, reason: r.reason, plies: r.plies, seconds: (Date.now() - t0) / 1000 });
    console.log(mode, JSON.stringify(games[games.length - 1]));
  }
  results[mode] = {
    games,
    hardWins: games.filter((x) => x.result === 'hard').length,
    easyWins: games.filter((x) => x.result === 'easy').length,
    draws: games.filter((x) => x.result === 'draw').length,
  };
}
const stats = {};
for (const k in times) {
  const a = times[k].slice().sort((x, y) => x - y);
  stats[k] = { moves: a.length, meanMs: Math.round(a.reduce((x, y) => x + y, 0) / a.length), p95Ms: Math.round(a[Math.floor(a.length * 0.95)]), maxMs: Math.round(a[a.length - 1]) };
}
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), gamesPerMode: N, results, moveTimes: stats }, null, 2));
console.log(JSON.stringify(stats));
