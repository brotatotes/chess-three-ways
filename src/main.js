// Chess, Three Ways. UI, game flow and controllers for Classic, Fog of War and Simultaneous.
/* global __WORKER_SOURCE__ */
import * as THREE from 'three';
import { createScene } from './scene/scene.js';
import { createEffects } from './scene/effects.js';
import {
  newGame, cloneState, legalMoves, makeMove, classicStatus, inCheck, WHITE, BLACK, PAWN, KING, san,
} from './engine/chess.js';
import { fogMoves, observe, visibleMask, fogStatus } from './engine/fog.js';
import { simMoves, resolveSim, simStatus } from './engine/simul.js';
import { newFogMemory, updateFogMemory, fogNoteOwnCapture } from './ai/fog.js';
import { createAudio } from './audio/audio.js';

const $ = (id) => document.getElementById(id);
const COLOR_NAME = ['White', 'Black'];
const MODE_NAME = { classic: 'Classic', fog: 'Fog of War', simul: 'Simultaneous' };
const GLYPH = [['', '♙', '♘', '♗', '♖', '♕', '♔'], ['', '♟', '♞', '♝', '♜', '♛', '♚']];
const PVAL = [0, 1, 3, 3, 5, 9, 0];

// ---------- settings ----------
const SKEY = 'chess3w.settings';
const DEFAULTS = { music: 60, sfx: 80, musicMuted: false, sfxMuted: false, soundEnabled: false, reduceMotion: false, quality: 'auto', hints: true, view: 'orbit' };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
const settings = loadSettings();
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* private mode */ } syncAudio(); }
// ---------- sound ----------
// The AudioContext is created only by a user gesture that turns sound on (never on page load).
const A = createAudio();
function syncAudio(gesture = false) {
  if (gesture && settings.soundEnabled && !A.started) A.enable();
  if (!A.started) return;
  if (gesture) A.enable();
  A.setSettings(settings);
  A.music(settings.soundEnabled && !settings.musicMuted);
}
const sfx = (name, opts) => A.play(name, opts);
// If sound was left on last visit, it resumes on the first tap or key press (browsers forbid starting it earlier).
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (settings.soundEnabled) syncAudio(true); }, { capture: true });
const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const reduced = () => settings.reduceMotion || prefersReduced();

// ---------- scene ----------
const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif';
let lowFrames = 0;
const S = createScene($('stage'), {
  quality: settings.quality === 'low' ? 'low' : 'high',
  fontFamily,
  preserve: /[?&]capture/.test(location.search),
  onView: (r) => {
    const st = document.documentElement.style;
    st.setProperty('--board-top', Math.round(r.top) + 'px');
    st.setProperty('--board-bottom', Math.round(r.height - r.bottom) + 'px');
    st.setProperty('--board-left', Math.round(Math.max(0, r.left)) + 'px');
  },
  onFps: (fps) => {
    window.__fps = fps;
    // A very slow device should not spin the title board forever.
    if (fps < 12 && S.controls.autoRotate) S.controls.autoRotate = false;
    if (settings.quality !== 'auto' || S.quality === 'low' || document.hidden) return;
    lowFrames = fps < 28 ? lowFrames + 1 : 0;
    if (lowFrames >= 4) { S.applyQuality('low'); toast('Graphics lowered to keep things smooth'); }
  },
});

const FX = createEffects(S);
// Swing to the other player's side in pass-and-play, or cut straight there when motion is reduced.
// A short beat after the move lands lets it register before the view leaves; the player cards swap at the midpoint.
const turnTo = async (side) => {
  if (reduced()) { S.setView(settings.view, side); G.viewer = side; return; }
  await wait(260);
  // The player labels fade out while the camera travels, so they never sit over the moving board.
  document.body.classList.add('swinging');
  await S.swingView(settings.view, side, 0.8, () => { G.viewer = side; render(); });
  document.body.classList.remove('swinging');
};

// Fog squares: soft dark tiles over every square the viewer cannot see.
const fogGroup = new THREE.Group();
// A dense charcoal smoke texture so hidden squares read as cloud, not as a darker board style.
function mistTexture() {
  // Tileable: every puff is drawn at its wrapped offsets too, so repeats never show a seam.
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = '#8c847b'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 140; i++) {
    const px = Math.random() * N, py = Math.random() * N, r = 18 + Math.random() * 70;
    const v = Math.random() < 0.6 ? '214,206,194' : '70,64,58';
    const a = 0.05 + Math.random() * 0.12;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const cx = px + ox, cy = py + oy;
      if (cx + r < 0 || cx - r > N || cy + r < 0 || cy - r > N) continue;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${v},${a})`); g.addColorStop(1, `rgba(${v},0)`);
      x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// The mist is one plane over the whole board (plus a small overhang past the frame). Its alpha is a smooth
// field interpolated between square centres, perturbed by slowly drifting noise and then thresholded. That gives
// an irregular, feathered edge that sits on the square boundaries. When a square comes into view its value
// eases to zero, so the edge sweeps back across the square like a receding bank of mist. A second, paler layer
// is drawn only along that edge so the front looks like thinning vapour rather than a hard cut.
const FOG_PAD = 0.3, FOG_SPAN = 8 + FOG_PAD * 2, FOG_PX = 160;
const fogCanvas = document.createElement('canvas'); fogCanvas.width = fogCanvas.height = FOG_PX;
const rimCanvas = document.createElement('canvas'); rimCanvas.width = rimCanvas.height = FOG_PX;
const fogCtx = fogCanvas.getContext('2d'), fogImg = fogCtx.createImageData(FOG_PX, FOG_PX);
const rimCtx = rimCanvas.getContext('2d'), rimImg = rimCtx.createImageData(FOG_PX, FOG_PX);
const alphaTex = (c) => { const t = new THREE.CanvasTexture(c); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
const fogAlpha = alphaTex(fogCanvas), rimAlpha = alphaTex(rimCanvas);
const fogCur = new Float32Array(64), fogTarget = new Float32Array(64);
// Tileable value-noise fbm, 64x64, used as a drifting perturbation of the edge.
const NZ = 64, noise = new Float32Array(NZ * NZ);
(() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [cells, amp] of [[4, 0.55], [8, 0.3], [16, 0.15]]) {
    const g = Array.from({ length: cells * cells }, rnd);
    for (let y = 0; y < NZ; y++) for (let x = 0; x < NZ; x++) {
      const fx = x / NZ * cells, fy = y / NZ * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
      const v = at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
      noise[y * NZ + x] += (v - 0.5) * amp;
    }
  }
})();
function nz(x, y) {
  x = ((x % NZ) + NZ) % NZ; y = ((y % NZ) + NZ) % NZ;
  const x0 = x | 0, y0 = y | 0, x1 = (x0 + 1) % NZ, y1 = (y0 + 1) % NZ, tx = x - x0, ty = y - y0;
  return (noise[y0 * NZ + x0] * (1 - tx) + noise[y0 * NZ + x1] * tx) * (1 - ty) + (noise[y1 * NZ + x0] * (1 - tx) + noise[y1 * NZ + x1] * tx) * ty;
}
let fogTime = 0;
const sqv = (f, r) => fogCur[(r < 0 ? 0 : r > 7 ? 7 : r) * 8 + (f < 0 ? 0 : f > 7 ? 7 : f)];
function drawFog() {
  const n = FOG_PX, d = fogImg.data, rd = rimImg.data, t = fogTime;
  for (let py = 0; py < n; py++) {
    // Board units measured from the a8 corner at the top of the canvas.
    const by = (py + 0.5) / n * FOG_SPAN - FOG_PAD;
    for (let px = 0; px < n; px++) {
      const bx = (px + 0.5) / n * FOG_SPAN - FOG_PAD;
      const gx = bx - 0.5, gy = by - 0.5, f0 = Math.floor(gx), g0 = Math.floor(gy), tx = gx - f0, ty = gy - g0;
      const r0 = 7 - g0, r1 = 6 - g0;
      const field = (sqv(f0, r0) * (1 - tx) + sqv(f0 + 1, r0) * tx) * (1 - ty) + (sqv(f0, r1) * (1 - tx) + sqv(f0 + 1, r1) * tx) * ty;
      const w = nz(bx * 5 + t * 0.9, by * 5 + t * 0.35) + nz(bx * 9 - t * 0.6, by * 9 + t * 0.5) * 0.5;
      // Hidden squares stay fully covered right up to their edges. The feathered, noisy fringe spills a little
      // way into the neighbouring visible squares, so no square is ever ambiguous.
      const v = field + w * 0.16;
      let e = (v - 0.08) / 0.34; e = e < 0 ? 0 : e > 1 ? 1 : e; e = e * e * (3 - 2 * e);
      // Fade the overhang past the board frame.
      const out = Math.max(-bx, bx - 8, -by, by - 8, 0), edge = out > 0 ? Math.max(0, 1 - out / FOG_PAD) : 1;
      const i = (py * n + px) * 4, a = e * edge;
      d[i] = d[i + 1] = d[i + 2] = Math.round(255 * a); d[i + 3] = 255;
      // No pale rim past the board frame, where it read as a bright smear against the dark overhang.
      const rim = out > 0 ? 0 : 4 * e * (1 - e);
      rd[i] = rd[i + 1] = rd[i + 2] = Math.round(255 * rim); rd[i + 3] = 255;
    }
  }
  fogCtx.putImageData(fogImg, 0, 0); fogAlpha.needsUpdate = true;
  rimCtx.putImageData(rimImg, 0, 0); rimAlpha.needsUpdate = true;
}
const mistMap = mistTexture();
mistMap.repeat.set(1.5, 1.5);
const fogGeo = new THREE.PlaneGeometry(FOG_SPAN, FOG_SPAN); fogGeo.rotateX(-Math.PI / 2);
const fogMat = new THREE.MeshStandardMaterial({ color: 0x6b7078, map: mistMap, alphaMap: fogAlpha, roughness: 1, transparent: true, opacity: 0.95, depthWrite: false });
const fogPlane = new THREE.Mesh(fogGeo, fogMat);
fogPlane.position.y = 0.07; fogPlane.renderOrder = 3;
// A thinner, higher layer gives the mist some height around the feet of nearby pieces.
const mist2 = mistMap.clone(); mist2.repeat.set(1.3, 1.3); mist2.needsUpdate = true;
const fogMat2 = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, map: mist2, alphaMap: fogAlpha, roughness: 1, transparent: true, opacity: 0.24, depthWrite: false });
const fogPlane2 = new THREE.Mesh(fogGeo, fogMat2); fogPlane2.position.y = 0.16; fogPlane2.renderOrder = 4;
// Pale vapour along the edge of the mist, a little higher again, so the front has thickness.
const fogMat3 = new THREE.MeshStandardMaterial({ color: 0xece4d8, map: mist2, alphaMap: rimAlpha, roughness: 1, transparent: true, opacity: 0.42, depthWrite: false });
const fogPlane3 = new THREE.Mesh(fogGeo, fogMat3); fogPlane3.position.y = 0.2; fogPlane3.renderOrder = 5;
fogGroup.add(fogPlane, fogPlane2, fogPlane3); fogGroup.visible = false;
let fogAnimating = false, fogAcc = 0;
function setFog(mask, instant) {
  let any = false;
  for (let s = 0; s < 64; s++) { fogTarget[s] = mask ? (mask[s] ? 1 : 0) : 0; if (fogTarget[s]) any = true; }
  if (!mask) { fogCur.fill(0); fogGroup.visible = false; return; }
  fogGroup.visible = true;
  if (instant || reduced()) fogCur.set(fogTarget);
  drawFog(); S.invalidate();
  if (reduced() || fogAnimating) return any;
  fogAnimating = true;
  // Squares ease toward their target. The mist then keeps drifting slowly while Fog of War is on screen,
  // redrawn at about 20 fps to keep the cost small.
  S.addTicker((dt) => {
    if (!fogGroup.visible || reduced()) { fogAnimating = false; return false; }
    let moving = false;
    for (let s = 0; s < 64; s++) {
      const d = fogTarget[s] - fogCur[s];
      if (Math.abs(d) > 0.01) { fogCur[s] += Math.sign(d) * Math.min(Math.abs(d), dt * (d < 0 ? 1.5 : 2.6)); moving = true; } else fogCur[s] = fogTarget[s];
    }
    fogTime += dt;
    mistMap.offset.x += dt * 0.02; mist2.offset.x -= dt * 0.012; mist2.offset.y += dt * 0.008;
    fogAcc += dt;
    if (moving || fogAcc > 0.05) { fogAcc = 0; drawFog(); }
    // On the low quality setting the mist settles and stops redrawing, so idle frames cost nothing.
    if (!moving && S.quality === 'low') { fogAnimating = false; return false; }
    return true;
  });
  return any;
}
S.scene.add(fogGroup);

// ---------- worker ----------
let worker = null, reqId = 0;
const pending = new Map();
function ai(q) {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' })));
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); } };
  }
  const id = ++reqId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...q, id, seed: (Math.random() * 2 ** 32) >>> 0 }); });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- screens ----------
const SCREENS = ['title', 'newgame', 'rules', 'settings', 'ingame-menu', 'promo', 'cover', 'gameover'];
const MODALS = ['rules', 'settings', 'ingame-menu', 'promo'];
function syncModal() { document.body.classList.toggle('modal-open', MODALS.some((s) => !$(s).classList.contains('hidden'))); }
function show(id) { $(id).classList.remove('hidden'); if (id === 'gameover') document.body.classList.add('game-over'); syncModal(); }
function hide(id) { $(id).classList.add('hidden'); if (id === 'gameover') document.body.classList.remove('game-over'); syncModal(); }
function anyScreen() { return SCREENS.some((s) => !$(s).classList.contains('hidden')); }
let toastTimer = 0;
function toast(text, ms = 1800) {
  const t = $('toast'); t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
  const scr = b.closest('.screen'); scr.classList.add('hidden'); syncModal();
  if (!G && !anyScreen()) goTitle();
}));
function choiceGroup(id, onPick) {
  const g = $(id);
  g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    g.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
    onPick && onPick(b.dataset.v);
  });
  return () => g.querySelector('.on').dataset.v;
}
function setChoice(id, v) { $(id).querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }

// ---------- game state ----------
let G = null; // current game
let token = 0; // bumps on new game / undo so stale AI replies are ignored

const optMode = choiceGroup('opt-mode');
const optOpp = choiceGroup('opt-opp', (v) => { $('field-level').classList.toggle('hidden', v === 'pass'); $('field-color').classList.toggle('hidden', v === 'pass'); });
const optLevel = choiceGroup('opt-level');
const optColor = choiceGroup('opt-color');

function goTitle() {
  G = null; token++;
  document.body.classList.remove('mode-simul');
  SCREENS.forEach(hide); show('title');
  $('hud').classList.add('hidden'); $('captures').classList.add('hidden'); $('sim-bar').classList.add('hidden');
  S.setPosition(newGame().board); S.overlays.set([]); setFog(null);
  S.clearGraveyard();
  S.setView('title', 0); S.controls.autoRotate = !reduced(); S.controls.autoRotateSpeed = 0.5;
}

function startGame(cfg) {
  token++;
  A.setMode(cfg.mode); A.setIntensity(0);
  const human = cfg.color === 'r' ? (Math.random() < 0.5 ? WHITE : BLACK) : cfg.color === 'b' ? BLACK : WHITE;
  G = {
    mode: cfg.mode, opp: cfg.opp, level: cfg.level, human,
    st: newGame(), history: [], over: null, sel: -1, last: [], cursor: -1,
    busy: false, simPick: { 0: undefined, 1: undefined }, simChooser: WHITE,
    mem: cfg.opp === 'ai' && cfg.mode === 'fog' ? newFogMemory(human ^ 1) : null,
    viewer: cfg.opp === 'ai' ? human : WHITE, moves: [], fogFresh: true,
  };
  lastCfg = cfg;
  SCREENS.forEach(hide);
  $('hud').classList.remove('hidden'); $('captures').classList.remove('hidden');
  $('sim-bar').classList.toggle('hidden', G.mode !== 'simul');
  document.body.classList.toggle('mode-simul', G.mode === 'simul');
  $('hud-mode').textContent = MODE_NAME[G.mode];
  $('hud-sub').textContent = G.opp === 'ai' ? `vs computer · ${G.level[0].toUpperCase() + G.level.slice(1)}` : 'pass and play';
  S.controls.autoRotate = false;
  S.clearGraveyard();
  S.setView(settings.view, G.viewer);
  render();
  if (G.opp === 'pass' && G.mode !== 'classic') cover(WHITE, 'White goes first.').then(() => { render(); });
  else afterTurn();
}
let lastCfg = null;

$('btn-play').addEventListener('click', () => { hide('title'); show('newgame'); });
$('btn-rules').addEventListener('click', () => show('rules'));
$('btn-settings').addEventListener('click', () => { syncSettingsUI(); show('settings'); });
$('btn-start').addEventListener('click', () => startGame({ mode: optMode(), opp: optOpp(), level: optLevel(), color: optColor() }));

// ---------- helpers ----------
const isAI = (c) => G.opp === 'ai' && c !== G.human;
function movesFor(color) {
  if (G.mode === 'classic') return G.st.turn === color ? legalMoves(G.st) : [];
  if (G.mode === 'fog') return G.st.turn === color ? fogMoves(G.st, color) : [];
  return simMoves(G.st, color);
}
function activeHuman() {
  if (!G || G.over || G.busy) return -1;
  if (G.mode === 'simul') {
    const c = G.opp === 'ai' ? G.human : G.simChooser;
    return G.simPick[c] === undefined ? c : -1;
  }
  return isAI(G.st.turn) ? -1 : G.st.turn;
}
function statusOf(st) {
  if (G.mode === 'classic') return classicStatus(st);
  if (G.mode === 'fog') return fogStatus(st);
  return simStatus(st);
}
function snapshot() {
  return { st: cloneState(G.st), last: G.last.slice(), mem: G.mem ? JSON.parse(JSON.stringify(G.mem)) : null, moves: G.moves.slice() };
}

// ---------- rendering ----------
function capturedLists() {
  const start = [0, 8, 2, 2, 2, 1, 1];
  const out = [[], []];
  for (const c of [WHITE, BLACK]) {
    const have = [0, 0, 0, 0, 0, 0, 0];
    for (const p of G.st.board) if (p && (p >> 3) === c) have[p & 7]++;
    let promoted = 0;
    for (let t = 2; t <= 5; t++) promoted += Math.max(0, have[t] - start[t]);
    for (let t = 5; t >= 1; t--) {
      let lost = start[t] - have[t];
      if (t === PAWN) lost -= promoted;
      for (let i = 0; i < lost; i++) out[c].push(t);
    }
  }
  return out; // out[c] = types of colour c that were lost
}
function renderCaptures() {
  const lost = capturedLists();
  const me = G.viewer, them = me ^ 1;
  const score = (c) => lost[c].reduce((a, t) => a + PVAL[t], 0);
  const diff = score(them) - score(me);
  const line = (c, adv) => lost[c].map((t) => GLYPH[c][t]).join('') + (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
  const who = (c) => G.opp === 'ai' ? (c === G.human ? 'You' : 'Computer') : COLOR_NAME[c];
  const toMove = G.over ? -1 : G.mode === 'simul' ? -1 : G.st.turn;
  const card = (c, capturedColor, adv) => `<span class="who${toMove === c ? ' on' : ''}"><i class="dot ${c ? 'b' : 'w'}"></i>${who(c)}</span><span class="glyphs">${line(capturedColor, adv)}</span>`;
  $('cap-bottom').innerHTML = card(me, them, diff); // pieces I took
  $('cap-top').innerHTML = card(them, me, -diff); // pieces they took
  S.clearGraveyard();
  for (const c of [WHITE, BLACK]) for (const t of lost[c]) S.addToGraveyard(S.makeMesh(t, c), c);
}

function render() {
  S.invalidate();
  if (!G) return;
  const st = G.st, viewer = G.viewer;
  let vis = null;
  if (G.mode === 'fog' && !G.over) vis = visibleMask(st, viewer);
  S.setPosition(st.board, vis ? (s, p) => (p >> 3) === viewer || vis[s] : null);
  setFog(vis ? Array.from({ length: 64 }, (_, s) => !vis[s] && !(st.board[s] && (st.board[s] >> 3) === viewer)) : null, G.fogFresh);
  G.fogFresh = false;
  const ov = [];
  for (const sq of G.last) if (!vis || vis[sq]) ov.push(['last', sq]);
  if (G.mode === 'classic' && !G.over && inCheck(st)) ov.push(['check', st.kings[st.turn]]);
  const chooser = G.mode === 'simul' ? (G.opp === 'ai' ? G.human : G.simChooser) : -1;
  if (chooser >= 0 && G.simPick[chooser]) { const m = G.simPick[chooser]; ov.push(['pending', m.from], ['pending', m.to]); }
  if (G.sel >= 0) {
    ov.push(['select', G.sel]);
    if (settings.hints) for (const m of selMoves()) ov.push([st.board[m.to] && (st.board[m.to] >> 3) !== (st.board[G.sel] >> 3) ? 'capture' : 'hint', m.to]);
  }
  if (G.cursor >= 0) ov.push(['cursor', G.cursor]);
  S.overlays.set(ov);
  renderCaptures();
  renderStatus();
  $('btn-undo').disabled = !canUndo();
}

// Music leans in as the game gets close: more of it as material comes off, most when material is level.
function updateIntensity() {
  let w = 0, b = 0;
  for (const p of G.st.board) if (p) { if (p >> 3) b += PVAL[p & 7]; else w += PVAL[p & 7]; }
  const phase = 1 - Math.min(1, (w + b) / 78), close = 1 - Math.min(1, Math.abs(w - b) / 8);
  A.setIntensity(G.over ? 0 : phase * (0.55 + 0.45 * close) + (G.mode === 'classic' && inCheck(G.st) ? 0.15 : 0));
}
function renderStatus() {
  let s = '';
  if (A.started) { updateIntensity(); A.ticking(G.mode === 'simul' && !G.busy && !G.over && G.simPick[G.opp === 'ai' ? G.human : G.simChooser] === undefined); }
  if (G.over) s = G.over.shown ? G.over.title : (G.over.reason === 'checkmate' ? 'Checkmate' : G.over.reason === 'king captured' ? 'The king falls' : G.over.title);
  else if (G.mode === 'simul') {
    const c = G.opp === 'ai' ? G.human : G.simChooser;
    if (G.busy) s = 'Revealing…';
    else if (G.simPick[c] !== undefined) s = 'Locked in';
    else s = G.opp === 'ai' ? 'Choose your move' : `${COLOR_NAME[c]}, choose your move`;
    $('sim-bar').classList.toggle('revealing', !!G.busy);
    $('sim-text').textContent = G.busy ? 'Revealing both moves…' : G.simPick[c] ? 'Move chosen. Lock it in?' : G.simPick[c] === null ? 'No moves. Pass this turn.' : (G.opp === 'ai' ? 'Choose your move' : `${COLOR_NAME[c]}: choose your move`);
    $('sim-lock').disabled = !(G.simPick[c] !== undefined) || G.busy || !!G.over || (movesFor(c).length > 0 && !G.simPick[c]);
    if (movesFor(c).length === 0 && !G.busy && !G.over) { $('sim-lock').disabled = false; $('sim-text').textContent = 'No moves. Pass this turn.'; }
    $('hud-status').textContent = G.busy ? `Turn ${G.st.fullmove} · Revealing…` : `Turn ${G.st.fullmove}`;
    return;
  } else if (isAI(G.st.turn)) s = G.busy ? 'Thinking…' : '';
  else s = G.opp === 'ai' ? 'Your move' : `${COLOR_NAME[G.st.turn]} to move`;
  if (G.mode === 'classic' && !G.over && inCheck(G.st)) s += ' · Check';
  $('hud-status').textContent = s;
}

function selMoves() {
  if (!G || G.sel < 0) return [];
  const c = G.st.board[G.sel] >> 3;
  return movesFor(c).filter((m) => m.from === G.sel);
}

// ---------- animation (simple tweens; richer effects come later) ----------
function tweenMoves(list, onContact = null) {
  // list: [{ from, to, die: bool }], meshes found by starting square
  const knight = !reduced() && list.some((it) => { const m = S.pieces.get(it.from); return m && m.userData.type === 2; });
  const dur = reduced() ? 0.12 : knight ? 0.46 : 0.34;
  const items = [];
  for (const it of list) {
    const mesh = S.pieces.get(it.from); if (!mesh) continue;
    const [x0, z0] = S.sqToXZ(it.from), [x1, z1] = it.to >= 0 ? S.sqToXZ(it.to) : S.sqToXZ(it.from);
    const hop = !reduced() && mesh.userData.type === 2;
    items.push({ mesh, x0, z0, x1, z1, hop, die: it.die, dieAt: it.dieAt ?? 0.55 });
  }
  const victims = [];
  for (const it of list) if (it.victim >= 0 && S.pieces.get(it.victim) && !list.some((o) => o.from === it.victim)) victims.push(S.pieces.get(it.victim));
  // Victims start to fall as the attacker arrives (not after), so the two pieces never sit inside each other.
  const falls = [];
  let contacted = false;
  return new Promise((resolve) => {
    let t = 0;
    S.addTicker((dt) => {
      t += dt / dur;
      if (victims.length && !victims.started) for (const v of victims) { victims.started = true; const src = items.find((i) => !i.die) || items[0]; falls.push(toppleOff(v, src ? [src.x0, src.z0] : null)); }
      const k = Math.min(1, t), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      // Pieces that lose a clash stop where they meet, the clash fires, and they are knocked back and off to the tray.
      for (const i of items) if (i.die && !i.hit && e >= i.dieAt) {
        i.hit = true;
        if (onContact && !contacted) { contacted = true; onContact(); }
        if (!reduced()) { const c = [i.x1, i.z1]; c.fling = true; falls.push(toppleOff(i.mesh, c)); } else i.mesh.visible = false;
      }
      for (const i of items) {
        if (i.hit) continue;
        const kk = i.die ? Math.min(e, i.dieAt) : e;
        // Knights leap in a high arc (parabola on linear time, so the hang at the top reads) and squash on landing.
        const y = i.hop ? 4 * k * (1 - k) * 0.95 : Math.sin(Math.PI * e) * 0.12;
        i.mesh.position.set(i.x0 + (i.x1 - i.x0) * kk, y, i.z0 + (i.z1 - i.z0) * kk);
        if (i.hop) i.mesh.rotation.x = Math.sin(Math.PI * k) * 0.18 * (i.z1 < i.z0 ? -1 : 1);
      }
      if (k >= 1) { for (const i of items) if (i.hop) { i.mesh.rotation.x = 0; settle(i.mesh); } resolve(); return false; }
      return true;
    });
  }).then(() => Promise.all(falls.length || !victims.length ? falls : victims.map((v) => toppleOff(v))));
}
// A short squash-and-stretch as a leaping piece lands, so it reads as weight rather than a teleport.
function settle(mesh) {
  let t = 0;
  S.addTicker((dt) => {
    t += dt / 0.22;
    const k = Math.min(1, t), sq = Math.sin(Math.PI * k) * 0.09 * (1 - k * 0.5);
    mesh.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
    if (k >= 1) { mesh.scale.setScalar(1); return false; }
    return true;
  });
}

// A clash loser is knocked up from the contact point and tumbles through the air into its tray with a bounce,
// so the cause (the clash) and the effect (the piece leaving the board) read as one motion.
function flingOff(mesh, from, to, contact) {
  const away = new THREE.Vector3(from.x - contact[0], 0, from.z - contact[1]);
  if (away.lengthSq() < 1e-6) away.set(to.x - from.x, 0, to.z - from.z);
  away.normalize();
  const spin = new THREE.Vector3(away.z, 0, -away.x);
  const dist = Math.hypot(to.x - from.x, to.z - from.z), dur = 1.05 + Math.min(0.45, dist * 0.05), peak = 1.6 + dist * 0.12;
  let t = 0, landed = false;
  return new Promise((resolve) => {
    S.addTicker((dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      if (k < 1) {
        // A short recoil away from the contact point first, then the arc to the tray.
        const rec = Math.min(1, k / 0.15), kk = Math.max(0, (k - 0.1) / 0.9), ek = 1 - (1 - kk) ** 2;
        const bx = from.x + away.x * 0.35 * rec, bz = from.z + away.z * 0.35 * rec;
        mesh.position.set(bx + (to.x - bx) * ek, from.y + 4 * peak * kk * (1 - kk) + (to.y - from.y) * kk, bz + (to.z - bz) * ek);
        mesh.rotation.set(0, mesh.rotation.y, 0); mesh.rotateOnWorldAxis(spin, k * Math.PI * 2.5);
        mesh.scale.setScalar(1 - 0.3 * kk * kk);
        return true;
      }
      if (!landed) { landed = true; FX.dust(to.x, to.z, { count: 6, size: 0.35, life: 0.6, y: to.y + 0.1 }); }
      // Settle upright in the tray with a small bounce.
      const b = Math.min(1, (t - dur) / 0.3);
      mesh.rotation.set(0, mesh.rotation.y, 0);
      mesh.position.set(to.x, to.y + Math.abs(Math.sin(b * Math.PI)) * 0.15 * (1 - b), to.z);
      mesh.scale.setScalar(0.7);
      if (b >= 1) { mesh.visible = false; resolve(); return false; }
      return true;
    });
  });
}
// A captured piece is knocked over away from the attacker, then lifted in one continuous arc over the board
// into its owner's tray, turning upright as it flies and landing with a small bounce and a puff of dust.
function toppleOff(mesh, attackerXZ = null) {
  const c = mesh.userData.color;
  const from = mesh.position.clone();
  const to = S.graveSlot(c);
  if (reduced()) { mesh.visible = false; return Promise.resolve(); }
  if (attackerXZ && attackerXZ.fling) return flingOff(mesh, from, to, attackerXZ);
  // Knocked straight away from the attacker, so the arriving piece never passes through it.
  const away = attackerXZ ? new THREE.Vector3(from.x - attackerXZ[0], 0, from.z - attackerXZ[1]) : new THREE.Vector3(to.x >= from.x ? 1 : -1, 0, 0);
  if (away.lengthSq() < 1e-6) away.set(1, 0, 0); away.normalize();
  const tipAxis = new THREE.Vector3(away.z, 0, -away.x);
  const pushV = away.clone().multiplyScalar(0.7); // clear of the arriving piece's base
  const lying = new THREE.Vector3(from.x + pushV.x, 0.22, from.z + pushV.z);
  const dist = Math.hypot(to.x - lying.x, to.z - lying.z);
  const dur = 1.25 + Math.min(0.35, dist * 0.04), peak = 0.95 + dist * 0.05; // a low sideways hop: seen from the player's side a high arc reads as flying over the back rank
  let t = 0, puffed = false, landed = false;
  return new Promise((resolve) => {
    S.addTicker((dt) => {
      t += dt / dur;
      const k = Math.min(1, t);
      mesh.rotation.set(0, mesh.rotation.y, 0);
      if (k < 0.3) {
        // Fall over with a small rebound where it lands, quickly, so it is clear of the arriving attacker.
        const tip = Math.min(1, k / 0.13);
        const ang = tip < 1 ? tip * tip : 1 + Math.sin((k - 0.13) * 40) * 0.06 * Math.max(0, 1 - (k - 0.13) * 8);
        mesh.rotateOnWorldAxis(tipAxis, ang * Math.PI / 2);
        const tp = 1 - (1 - tip) ** 2;
        mesh.position.set(from.x + pushV.x * tp, 0.22 * tip, from.z + pushV.z * tp);
        if (!puffed && tip >= 1) { puffed = true; FX.dust(lying.x + away.x * 0.35, lying.z + away.z * 0.35, { count: 12, color: 0xb89a70, opacity: 0.95, life: 0.75, size: 0.5 }); }
      } else if (k < 0.86) {
        // Lifted clear of every other piece and carried to the tray, standing up on the way.
        const g = (k - 0.3) / 0.56, ge = g * g * (3 - 2 * g);
        mesh.rotateOnWorldAxis(tipAxis, (1 - ge) * Math.PI / 2);
        mesh.position.set(lying.x + (to.x - lying.x) * ge, lying.y + (to.y - lying.y) * g + 4 * peak * g * (1 - g), lying.z + (to.z - lying.z) * ge);
        mesh.scale.setScalar(1 - 0.3 * ge);
      } else {
        if (!landed) { landed = true; FX.dust(to.x, to.z, { count: 5, size: 0.28, life: 0.45, opacity: 0.5, y: to.y + 0.1 }); }
        const b = (k - 0.86) / 0.14;
        mesh.position.set(to.x, to.y + Math.abs(Math.sin(b * Math.PI)) * 0.12 * (1 - b), to.z);
        mesh.scale.setScalar(0.7);
      }
      if (k >= 1) { mesh.visible = false; resolve(); return false; }
      return true;
    });
  });
}

// ---------- input ----------
async function clickSquare(sq) {
  const me = activeHuman();
  if (me < 0 || sq < 0) return;
  const p = G.st.board[sq];
  if (G.sel >= 0) {
    const opts = selMoves().filter((m) => m.to === sq);
    if (opts.length) {
      let m = opts[0];
      if (opts.length > 1) { const t = await pickPromotion(); if (t == null) { render(); return; } m = opts.find((x) => x.promo === t) || opts[0]; }
      G.sel = -1;
      if (G.mode === 'simul') { G.simPick[me] = m; render(); return; }
      await playMove(m);
      return;
    }
  }
  if (p && (p >> 3) === me && movesFor(me).some((m) => m.from === sq)) G.sel = sq === G.sel ? -1 : sq;
  else G.sel = -1;
  render();
}

function pickPromotion() {
  return new Promise((resolve) => {
    show('promo');
    const done = (v) => { hide('promo'); $('promo').onclick = null; resolve(v); };
    $('promo').onclick = (e) => {
      if (e.target.closest('#promo-cancel')) return done(null);
      const b = e.target.closest('.promo-btn'); if (b) done(+b.dataset.v);
    };
  });
}

// Classic and Fog: apply one move with animation.
async function playMove(m, record = true) {
  if (record) G.history.push(snapshot());
  const my = token;
  G.busy = true;
  if (!G.over) $('hud-status').textContent = '\u2026'; // the move is under way, so nobody is 'to move' yet
  const castle = m.flag === 3 || m.flag === 4;
  const list = [{ from: m.from, to: m.to, victim: m.flag === 2 ? m.to + ((m.piece >> 3) === WHITE ? -8 : 8) : m.to }];
  if (castle) list.push(m.flag === 3 ? { from: m.from + 3, to: m.from + 1 } : { from: m.from - 4, to: m.from - 1 });
  G.moves.push(G.mode === 'classic' ? san(G.st, m) : '');
  S.overlays.set(G.mode === 'fog' ? [] : [['last', m.from]]); // clear hints the moment the move commits (fog never marks a hidden origin)
  // Fog of War: the mist starts rolling back from the newly seen squares while the piece is still travelling,
  // so the reveal reads as caused by the move rather than arriving later with the reply.
  if (G.mode === 'fog' && (m.piece >> 3) === G.viewer && !reduced()) {
    const nx = cloneState(G.st); makeMove(nx, m);
    const vis = visibleMask(nx, G.viewer);
    setFog(Array.from({ length: 64 }, (_, s2) => !vis[s2] && !(nx.board[s2] && (nx.board[s2] >> 3) === G.viewer)));
    sfx('wind', { dur: 1.4 });
  }
  await tweenMoves(list);
  if (my !== token) return;
  const mover = m.piece >> 3;
  makeMove(G.st, m);
  G.last = [m.from, m.to];
  G.busy = false;
  if (m.captured) toastCapture(m, mover);
  sfx(m.captured ? 'capture' : 'move', { piece: m.piece & 7 });
  if (m.promo) sfx('promote');
  if (G.mode === 'classic' && inCheck(G.st) && !classicStatus(G.st)) sfx('check');
  moveEffects(m, mover);
  await afterTurn(mover);
}
// Check pulse, promotion pop and a capture spark, only where the viewer can see.
function moveEffects(m, mover) {
  if (reduced()) return;
  const seen = (sq) => G.mode !== 'fog' || G.over || (G.viewer === mover) || visibleMask(G.st, G.viewer)[sq];
  const [x, z] = S.sqToXZ(m.to);
  if (m.promo && seen(m.to)) { FX.pop(S.pieces.get(m.to)); FX.burst(x, z, { color: 0xffe08a, count: 36, up: 3.6, y: 0.9 }); }
  else if (m.captured && seen(m.to)) FX.burst(x, z, { color: 0xffb870, count: 14, speed: 1.6, up: 1.8, size: 0.16, life: 0.55, y: 0.2 });
  if (G.mode === 'classic' && inCheck(G.st)) { const [kx, kz] = S.sqToXZ(G.st.kings[G.st.turn]); FX.ring(kx, kz, { color: 0xff5a3a, to: 2.1, life: 0.9 }); }
}
function toastCapture(m, mover) {
  if ((m.captured & 7) === KING) return;
  if (G.mode === 'fog' && G.opp === 'ai' && mover !== G.human) toast('One of your pieces was taken');
}

async function afterTurn(prevMover = -1) {
  const status = statusOf(G.st);
  if (status) return endGame(status);
  if (G.mode === 'simul') { render(); return; }
  if (G.opp === 'pass') {
    if (G.mode === 'fog' && prevMover >= 0) { await cover(G.st.turn, `${COLOR_NAME[prevMover]} has moved.`); G.viewer = G.st.turn; G.fogFresh = true; S.setView(settings.view, G.viewer); }
    else if (G.mode === 'classic') { render(); await turnTo(G.st.turn); G.viewer = G.st.turn; }
    render(); return;
  }
  render();
  if (isAI(G.st.turn)) await aiTurn();
}

async function aiTurn() {
  const my = token, color = G.st.turn;
  G.busy = true; render();
  const t0 = performance.now();
  let res;
  try {
    if (G.mode === 'classic') res = await ai({ kind: 'classic', state: cloneState(G.st), level: G.level });
    else {
      const obs = observe(G.st, color);
      updateFogMemory(G.mem, obs);
      res = await ai({ kind: 'fog', obs, mem: G.mem, level: G.level });
    }
  } catch (err) { console.error(err); res = null; }
  const spent = performance.now() - t0;
  if (spent < 450) await wait(450 - spent);
  if (my !== token || !G) return;
  G.busy = false;
  const legal = G.mode === 'classic' ? legalMoves(G.st) : fogMoves(G.st, color);
  let m = res && res.move ? legal.find((x) => x.from === res.move.from && x.to === res.move.to && (x.promo || 0) === (res.move.promo || 0)) : null;
  if (!m) m = legal[0];
  if (!m) return afterTurn();
  if (G.mode === 'fog' && m.captured) fogNoteOwnCapture(G.mem, m.captured & 7);
  await playMove(m, false); // undone together with the human move
}

// ---------- Simultaneous ----------
async function simLock() {
  if (!G || G.mode !== 'simul' || G.busy || G.over) return;
  const me = G.opp === 'ai' ? G.human : G.simChooser;
  if (G.simPick[me] === undefined) {
    if (movesFor(me).length) return; G.simPick[me] = null;
  }
  G.sel = -1;
  if (G.opp === 'pass' && me === WHITE) {
    // Hold input through the hand-over and camera swing so no tap lands mid-swing.
    const my0 = token;
    G.simChooser = BLACK; G.busy = true; render();
    await cover(BLACK, 'White has locked in a move.');
    await turnTo(BLACK);
    if (my0 !== token || !G) return;
    G.busy = false; G.viewer = BLACK; render();
    return;
  }
  const my = token;
  G.busy = true; render();
  if (G.opp === 'ai') {
    const t0 = performance.now();
    let res = null;
    try { res = await ai({ kind: 'simul', state: cloneState(G.st), color: G.human ^ 1, level: G.level }); } catch (err) { console.error(err); }
    if (performance.now() - t0 < 400) await wait(400 - (performance.now() - t0));
    if (my !== token) return;
    const legal = simMoves(G.st, G.human ^ 1);
    const rm = res && res.move;
    G.simPick[G.human ^ 1] = rm ? legal.find((x) => x.from === rm.from && x.to === rm.to && (x.promo || 0) === (rm.promo || 0)) || legal[0] || null : null;
  }
  G.history.push(snapshot());
  const r = resolveSim(G.st, G.simPick[WHITE] || null, G.simPick[BLACK] || null);
  const clash = r.events.find((e) => e.type === 'collide' || e.type === 'swap');
  // Swapping pieces meet halfway; pieces heading for the same square meet just short of it.
  const list = r.movers.map((mv) => ({ from: mv.from, to: mv.to, die: !mv.alive, dieAt: clash && clash.type === 'swap' ? 0.44 : 0.72 }));
  for (const e of r.events) if (e.type === 'capture') list.push({ from: -1, to: -1, victim: e.to });
  S.overlays.set([]);
  const clashFx = () => {
    if (!clash || reduced()) return;
    const sq = clash.type === 'collide' ? clash.square : clash.white.to;
    const [x, z] = clash.type === 'collide' ? S.sqToXZ(sq) : S.sqToXZ(clash.white.from).map((v, i) => (v + S.sqToXZ(clash.white.to)[i]) / 2);
    FX.burst(x, z, { color: 0xffe2a0, count: 60, speed: 3.0, up: 2.4, size: 0.26, life: 0.8, y: 0.6 });
    FX.ring(x, z, { color: 0xfff0c8, to: 1.2, life: 0.4, opacity: 1, onTop: true });
    FX.ring(x, z, { color: 0xffb040, to: 1.8, life: 0.55, opacity: 0.7, onTop: true, delay: 0.08 });
    FX.shake(0.09, 0.35);
  };
  const clashSound = () => { if (clash) sfx('clash'); };
  A.ticking(false);
  for (const mv of r.movers) if (!mv.rook) sfx('move', { piece: (G.st.board[mv.from] & 7) || 1 });
  await tweenMoves(list, () => { clashSound(); clashFx(); });
  if (my !== token) return;
  G.st = r.state;
  G.last = r.movers.filter((m) => !m.rook).flatMap((m) => [m.from, m.to]);
  G.simPick = { 0: undefined, 1: undefined };
  G.simChooser = WHITE;
  G.busy = false;
  const miss = r.events.find((e) => e.type === 'miss');
  const bounce = r.events.find((e) => e.type === 'kingsBounce');
  if (bounce && !reduced()) {
    const [ax, az] = S.sqToXZ(bounce.white.from), [bx, bz] = S.sqToXZ(bounce.black.from);
    const x = (ax + bx) / 2, z = (az + bz) / 2;
    FX.ring(x, z, { color: 0xfff0c8, to: 1.4, life: 0.5, opacity: 0.9, onTop: true });
    FX.shake(0.05, 0.25);
  }
  if (bounce) sfx('clash');
  for (const e of r.events) if (e.type === 'promote' && !reduced()) { const [x, z] = S.sqToXZ(e.square); FX.burst(x, z, { color: 0xffe08a, count: 30, up: 3.4, y: 0.9 }); }
  if (r.events.some((e) => e.type === 'capture')) sfx('capture', { piece: 3 });
  if (bounce) toast('The kings met and both stepped back', 1800);
  else if (clash) toast(clash.winner < 0 ? 'Clash! Both fell' : `Clash! ${COLOR_NAME[clash.winner]} holds`, 1500);
  else if (miss) toast('A capture missed. The target had moved');
  if (r.status) return endGame(r.status);
  render();
  if (G.opp === 'pass') {
    // Hold input through the reveal so nobody can start the next pick before the hand-over.
    G.busy = true; render();
    await wait(reduced() ? 300 : 1900);
    if (my !== token) return;
    await cover(WHITE, 'Both moves are revealed. Next turn.');
    await turnTo(WHITE);
    if (my !== token) return;
    G.busy = false; G.viewer = WHITE; render();
  }
}
$('sim-lock').addEventListener('click', simLock);

// ---------- pass-and-play cover ----------
function cover(color, text) {
  return new Promise((resolve) => {
    $('cover-title').textContent = `Hand the device to ${COLOR_NAME[color]}`;
    $('cover-text').textContent = `${text} Keep the board hidden from the other player.`;
    show('cover');
    $('cover-go').onclick = () => { hide('cover'); resolve(); };
  });
}

// ---------- game over ----------
function endGame(status) {
  G.over = status;
  let title;
  if (status.winner < 0) title = 'Draw';
  else if (G.opp === 'ai') title = status.winner === G.human ? 'You win' : 'You lose';
  else title = `${COLOR_NAME[status.winner]} wins`;
  G.over.title = title;
  A.ticking(false);
  sfx('mate', { win: G.opp !== 'ai' || status.winner === G.human || status.winner < 0 });
  $('go-eyebrow').textContent = `${MODE_NAME[G.mode]} · game over`;
  $('go-title').textContent = title;
  $('go-reason').textContent = status.reason === 'resigned' ? `${COLOR_NAME[status.winner ^ 1]} resigned` : `by ${status.reason}`;
  G.sel = -1;
  render();
  if (!reduced() && status.winner >= 0) {
    // The losing king's square: a gold shower for the winner's final blow.
    const loser = status.winner ^ 1;
    let ks = G.st.kings ? G.st.kings[loser] : -1;
    if (!(ks >= 0) || (G.st.board[ks] & 7) !== 6) ks = G.last.length ? G.last[G.last.length - 1] : 28;
    const [x, z] = S.sqToXZ(ks);
    const aSq = G.last.length ? G.last[G.last.length - 1] : -1;
    if (status.reason === 'checkmate' && aSq >= 0 && aSq !== ks) { const [ax, az] = S.sqToXZ(aSq); FX.beam(ax, az, x, z, { color: 0xff3b2a, life: 1.0 }); }
    FX.ring(x, z, { color: 0xe0281c, to: 1.4, life: 1.1, opacity: 1, additive: false, onTop: true });
    FX.ring(x, z, { color: 0xffc34a, to: 1.9, life: 0.7, opacity: 0.85, onTop: true, delay: 0.3 });
    FX.burst(x, z, { color: 0xffd27a, count: 60, speed: 2.2, up: 2.6, size: 0.26, life: 1.0, y: 1.0 });
    FX.shake(0.06, 0.45);
    FX.pushIn(x, z, 0.14, 1.0, 0.55);
    if (status.reason === 'checkmate') toast('Checkmate', 2000);
    // The beaten king rocks, then tips over: the classic "resign" gesture, so the finish reads at a glance.
    const km = S.pieces.get(ks);
    if (km && km.userData.type === 6) {
      const [wx, wz] = S.sqToXZ(G.last.length ? G.last[G.last.length - 1] : ks);
      const away = new THREE.Vector3(x - wx, 0, z - wz); if (away.lengthSq() < 1e-6) away.set(1, 0, 0); away.normalize();
      const axis = new THREE.Vector3(away.z, 0, -away.x);
      let t = 0; const ry = km.rotation.y;
      S.addTicker((dt) => {
        t += dt;
        // The rings and sparks clear first, so the king's fall reads as a clean silhouette.
        const rock = t > 0.6 && t < 1.2 ? Math.sin((t - 0.6) * 25) * 0.07 * (1 - (t - 0.6) / 0.6) : 0;
        const k = Math.min(1, Math.max(0, (t - 1.2) / 0.5)), fall = k * k;
        km.rotation.set(0, ry, 0); km.rotateOnWorldAxis(axis, rock + fall * 1.35);
        km.position.y = Math.sin(fall * Math.PI / 2) * 0.12;
        if (t >= 1.7 && !km.userData.thud) { km.userData.thud = true; FX.dust(x + away.x * 1.05, z + away.z * 1.05, { count: 11, size: 0.45, color: 0xc9ae84, opacity: 0.8, life: 0.8 }); FX.shake(0.035, 0.2); FX.ring(x, z, { color: 0xffd27a, to: 2.2, life: 0.6, opacity: 0.7 }); }
        return t < 1.75;
      });
    }
  }
  // Hold the final position on screen before the result card, timed on rendered frames so slow devices still see it.
  const hold = reduced() ? 0.2 : status.winner >= 0 ? 2.5 : 1.2;
  let held = 0;
  S.addTicker((dt) => { held += dt; if (held < hold) return true; if (G && G.over === status) { status.shown = true; renderStatus(); show('gameover'); } return false; });
}
$('go-rematch').addEventListener('click', () => startGame(lastCfg));
$('go-change').addEventListener('click', () => { hide('gameover'); show('newgame'); });
$('go-view').addEventListener('click', () => hide('gameover'));

// ---------- undo ----------
function canUndo() {
  if (!G || G.busy || !G.history.length) return false;
  if (G.opp === 'pass' && G.mode !== 'classic') return false;
  return true;
}
function undo() {
  if (!canUndo()) return;
  token++;
  const snap = G.history.pop();
  G.st = snap.st; G.last = snap.last; G.mem = snap.mem; G.moves = snap.moves;
  G.over = null; G.sel = -1; G.busy = false; G.simPick = { 0: undefined, 1: undefined }; G.simChooser = WHITE;
  hide('gameover');
  if (G.opp === 'pass' && G.mode === 'classic') { G.viewer = G.st.turn; S.setView(settings.view, G.viewer); }
  render();
  if (G.mode !== 'simul' && G.opp === 'ai' && isAI(G.st.turn)) aiTurn();
}
$('btn-undo').addEventListener('click', undo);

// ---------- HUD buttons and menus ----------
$('btn-menu').addEventListener('click', () => show('ingame-menu'));
$('btn-view').addEventListener('click', toggleView);
function toggleView() {
  settings.view = settings.view === 'orbit' ? 'top' : 'orbit'; saveSettings();
  if (G) S.setView(settings.view, G.viewer);
  $('btn-view').classList.toggle('on', settings.view === 'top');
}
$('btn-sound').addEventListener('click', () => { settings.soundEnabled = !settings.soundEnabled; saveSettings(); syncAudio(true); syncSettingsUI(); toast(settings.soundEnabled ? 'Sound on' : 'Sound off', 1000); });
$('menu-rules').addEventListener('click', () => { hide('ingame-menu'); openRules(G ? G.mode : 'classic'); });
$('menu-settings').addEventListener('click', () => { hide('ingame-menu'); syncSettingsUI(); show('settings'); });
$('menu-new').addEventListener('click', () => { hide('ingame-menu'); show('newgame'); });
$('menu-title').addEventListener('click', goTitle);
$('menu-resign').addEventListener('click', () => {
  hide('ingame-menu');
  if (!G || G.over) return;
  const loser = G.opp === 'ai' ? G.human : (G.mode === 'simul' ? G.simChooser : G.st.turn);
  token++; G.busy = false;
  endGame({ result: loser === WHITE ? '0-1' : '1-0', reason: 'resigned', winner: loser ^ 1 });
});
const rulesTab = choiceGroup('rules-tabs', (v) => openRules(v));
function openRules(mode) {
  setChoice('rules-tabs', mode);
  for (const m of ['classic', 'fog', 'simul']) $(`rules-${m}`).classList.toggle('hidden', m !== mode);
  show('rules');
}
void rulesTab;

// ---------- settings UI ----------
function syncSettingsUI() {
  const tog = (id, on, onText = 'On', offText = 'Off') => { const b = $(id); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? onText : offText; b.classList.toggle('on', on); };
  tog('set-sound', settings.soundEnabled);
  $('set-music').value = settings.music; $('set-sfx').value = settings.sfx;
  tog('set-music-mute', !settings.musicMuted, 'On', 'Muted');
  tog('set-sfx-mute', !settings.sfxMuted, 'On', 'Muted');
  for (const id of ['set-music', 'set-sfx']) $(id).closest('.setting').classList.toggle('dim', !settings.soundEnabled);
  tog('set-hints', settings.hints);
  tog('set-motion', settings.reduceMotion);
  setChoice('set-quality', settings.quality);
  $('btn-sound').classList.toggle('on', settings.soundEnabled);
  const spk = '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>';
  $('btn-sound').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round">${spk}${settings.soundEnabled
    ? '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>' : '<path d="M16 9l6 6M22 9l-6 6"/>'}</svg>`;
  $('btn-sound').setAttribute('aria-label', settings.soundEnabled ? 'Sound on' : 'Sound off');
  $('btn-view').classList.toggle('on', settings.view === 'top');
}
const flip = (key) => () => { settings[key] = !settings[key]; saveSettings(); syncAudio(true); syncSettingsUI(); if (G) render(); };
$('set-sound').addEventListener('click', flip('soundEnabled'));
$('set-music-mute').addEventListener('click', flip('musicMuted'));
$('set-sfx-mute').addEventListener('click', flip('sfxMuted'));
$('set-hints').addEventListener('click', flip('hints'));
$('set-motion').addEventListener('click', flip('reduceMotion'));
$('set-music').addEventListener('input', (e) => { settings.music = +e.target.value; saveSettings(); });
$('set-sfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; saveSettings(); });
choiceGroup('set-quality', (v) => { settings.quality = v; saveSettings(); lowFrames = 0; S.applyQuality(v === 'low' ? 'low' : 'high'); });

// ---------- pointer and keyboard ----------
let down = null;
const canvas = S.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > 8 || !G) return;
  G.cursor = -1;
  clickSquare(S.pick(e.clientX, e.clientY));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = ['promo', 'rules', 'settings', 'ingame-menu'].find((s) => !$(s).classList.contains('hidden'));
    if (open === 'promo') { $('promo-cancel').click(); return; }
    if (open) { hide(open); if (!G && !anyScreen()) goTitle(); return; }
    if (G && G.sel >= 0) { G.sel = -1; render(); return; }
    if (G && !anyScreen()) show('ingame-menu');
    return;
  }
  if (!G || anyScreen()) return;
  const k = e.key.toLowerCase();
  if (k === 'u') return undo();
  if (k === 'v') return toggleView();
  const dirs = { arrowup: [0, 1], arrowdown: [0, -1], arrowleft: [-1, 0], arrowright: [1, 0] };
  if (dirs[k]) {
    e.preventDefault();
    let [df, dr] = dirs[k]; if (G.viewer === BLACK) { df = -df; dr = -dr; }
    if (G.cursor < 0) G.cursor = G.viewer === WHITE ? 12 : 52;
    else { const f = Math.min(7, Math.max(0, (G.cursor & 7) + df)), r = Math.min(7, Math.max(0, (G.cursor >> 3) + dr)); G.cursor = r * 8 + f; }
    render(); return;
  }
  if ((k === 'enter' || k === ' ') && G.cursor >= 0) { e.preventDefault(); clickSquare(G.cursor); }
  if (k === 'l' && G.mode === 'simul') simLock();
});

// ---------- test hooks ----------
window.__game = {
  get G() { return G; },
  get state() { return G && G.st; },
  get mode() { return G && G.mode; },
  get busy() { return !!(G && G.busy); },
  get over() { return G && G.over; },
  get quality() { return S.quality; },
  clickSquare, simLock, undo, startGame, settings,
  movesFor: (c) => (G ? movesFor(c) : []),
  activeHuman: () => (G ? activeHuman() : -1),
  screenOf(sq) {
    const [x, z] = S.sqToXZ(sq);
    const v = new THREE.Vector3(x, 0.05, z).project(S.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  },
  get fps() { return S.fps; },
  step: (dt) => S.step(dt), setManual: (v) => S.setManual(v),
  get renderer() { return S.renderer; }, get scene() { return S.scene; }, get camera() { return S.camera; }, get controls() { return S.controls; },
};

syncSettingsUI();
goTitle();
window.__ready = true;
