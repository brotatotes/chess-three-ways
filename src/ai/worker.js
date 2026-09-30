// Web Worker entry. The UI posts { id, kind, ... } and receives { id, move, info }.
// For Fog of War the UI posts only the AI's observation and memory, never the true board.
import { classicMove } from './classic.js';
import { fogMove } from './fog.js';
import { simMove } from './simul.js';

self.onmessage = (e) => {
  const q = e.data;
  let res = null;
  try {
    if (q.kind === 'classic') res = classicMove(q.state, q.level, { seed: q.seed });
    else if (q.kind === 'fog') res = fogMove(q.obs, q.mem, q.level, { seed: q.seed });
    else if (q.kind === 'simul') res = simMove(q.state, q.color, q.level, { seed: q.seed });
    self.postMessage({ id: q.id, move: res ? res.move : null, info: res ? { ms: res.ms, depth: res.depth, score: res.score } : null });
  } catch (err) {
    self.postMessage({ id: q.id, error: String(err && err.stack || err) });
  }
};
