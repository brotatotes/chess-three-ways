// Renderer, lights, camera, orbit controls, piece meshes and picking.
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/three/addons/OrbitControls.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { buildBoard, buildOverlays, sqToXZ, xzToSq } from './board.js';
import { pieceMaterials, makePieceMesh } from './pieces.js';

export function createScene(container, opts = {}) {
  let quality = opts.quality || 'high';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a100a);
  scene.fog = new THREE.Fog(0x1a100a, 24, 46);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.0; controls.maxPolarAngle = 1.2;
  controls.enablePan = false;
  controls.minDistance = 7; controls.maxDistance = 40;
  controls.target.set(0, -0.2, 0);

  const key = new THREE.DirectionalLight(0xffdcae, 2.9);
  key.position.set(-5, 11, 6); key.castShadow = true;
  key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
  key.shadow.camera.near = 2; key.shadow.camera.far = 30;
  key.shadow.bias = -0.0008; key.shadow.normalBias = 0.045; key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7); fill.position.set(7, 6, -5);
  // Rim light from behind the far side lifts the dark pieces' silhouettes off the board.
  const rim = new THREE.DirectionalLight(0xffe2c0, 0.95); rim.position.set(0, 5, -9);
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x2a160a, 0.45);
  const pool = new THREE.SpotLight(0xffe7c4, 20, 30, 0.6, 0.6, 1.6); pool.position.set(0, 13, 0); pool.target.position.set(0, 0, 0);
  scene.add(key, fill, rim, hemi, pool, pool.target);

  const fontFamily = opts.fontFamily || 'serif';
  const board = buildBoard(quality, fontFamily);
  scene.add(board);
  const overlays = buildOverlays();
  scene.add(overlays.group);
  const fx = new THREE.Group(); scene.add(fx);

  let mats = pieceMaterials(quality);
  const pieces = new Map(); // square -> mesh group
  const piecesGroup = new THREE.Group(); scene.add(piecesGroup);
  const graveyard = [[], []]; // captured meshes per colour of piece
  let trayEnds = false;

  function applyQuality(q) {
    quality = q;
    const low = q === 'low';
    // Low quality renders below native resolution. That is the biggest single saving on weak GPUs.
    renderer.setPixelRatio(low ? Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.5) * 0.6) : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    pool.visible = !low;
    resize(); invalidate();
  }

  let viewKind = 'orbit';
  function resize() {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const ends = camera.aspect < 0.8;
    if (ends !== trayEnds) {
      trayEnds = ends; board.userData.setTrayLayout(ends);
      for (const c of [0, 1]) { const list = graveyard[c].splice(0); for (const m of list) addToGraveyard(m, c); }
    }
    // Fit: narrower screens need a wider field of view to keep the board in frame.
    camera.fov = camera.aspect < 0.8 ? 50 : camera.aspect < 1.2 ? 46 : 38;
    if (viewKind === 'title') camera.fov *= 0.86;
    // Title screen: lens-shift the board away from the menu text (right on wide screens, up on tall ones).
    if (viewKind === 'title' && camera.aspect > 1.15) camera.setViewOffset(w, h, -w * 0.15, -h * 0.06, w, h);
    else if (viewKind === 'title') camera.setViewOffset(w, h, 0, h * 0.24, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    invalidate();
  }

  function placeMesh(mesh, sq, lift = 0) {
    const [x, z] = sqToXZ(sq);
    mesh.position.set(x, lift, z);
  }

  function setPosition(boardArr, visibleFn = null) {
    for (const m of pieces.values()) piecesGroup.remove(m);
    pieces.clear();
    for (let s = 0; s < 64; s++) {
      const p = boardArr[s];
      if (!p) continue;
      if (visibleFn && !visibleFn(s, p)) continue;
      const mesh = makePieceMesh(p & 7, p >> 3, mats);
      placeMesh(mesh, s);
      mesh.userData.square = s;
      piecesGroup.add(mesh);
      pieces.set(s, mesh);
    }
    invalidate();
  }

  function clearGraveyard() {
    for (const list of graveyard) { for (const m of list) fx.remove(m); list.length = 0; }
  }
  function graveSlot(color) {
    const list = graveyard[color];
    const i = list.length;
    // White's lost pieces sit on the right tray (+x), Black's on the left.
    const side = color === 0 ? 1 : -1;
    // Fill each side tray from its middle outward, so the first captures fly a short, low path beside the board
    // instead of arcing over the back rank to the far corner.
    const col = i % 2, row = [3, 4, 2, 5, 1, 6, 0, 7][Math.floor(i / 2) % 8];
    // End trays (tall screens): White's lost pieces at Black's end (-z), Black's at White's end, in a row of eight.
    if (trayEnds) { const c = i % 8, r = Math.floor(i / 8); return new THREE.Vector3((color === 0 ? 1 : -1) * (3.3 - c * 0.94), -0.5, -side * (5.34 + r * 0.44)); }
    return new THREE.Vector3(side * (5.34 + col * 0.44), -0.5, (color === 0 ? 1 : -1) * (3.25 - row * 0.85));
  }
  function addToGraveyard(mesh, color) {
    const p = graveSlot(color);
    graveyard[color].push(mesh);
    if (mesh.parent !== fx) { piecesGroup.remove(mesh); fx.add(mesh); }
    mesh.scale.setScalar(0.7);
    mesh.rotation.set(0, mesh.rotation.y, 0);
    mesh.position.copy(p);
    return p;
  }

  // Picking: ray to board plane y = 0, also accept hits on piece meshes (so tall pieces are easy to tap).
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function pick(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(piecesGroup.children, true);
    if (hits.length) {
      let o = hits[0].object; while (o && o.userData.square === undefined) o = o.parent;
      if (o) return o.userData.square;
    }
    if (ray.ray.intersectPlane(planeY, hit)) return xzToSq(hit.x, hit.z);
    return -1;
  }

  // Camera views. side 0 = White at +z, 1 = Black.
  const views = {
    orbit: (side) => new THREE.Vector3(0, 10.5, side === 0 ? 10.5 : -10.5),
    top: (side) => new THREE.Vector3(0, 17, side === 0 ? 0.01 : -0.01),
    title: () => new THREE.Vector3(10.5, 7.2, 10.5),
  };
  function viewPosition(kind, side) {
    const a = camera.aspect;
    // Play views: fit the camera distance to the actual screen so the board fills it at any shape.
    if (kind === 'orbit' || kind === 'top') {
      const polar = kind === 'top' ? 0.0001 : a < 0.8 ? 0.47 : 0.66;
      const dir = new THREE.Vector3(0, Math.cos(polar), (side === 0 ? 1 : -1) * Math.sin(polar));
      return dir.multiplyScalar(fitDistance(dir, kind === 'top' ? side : -1));
    }
    const v = views[kind](side);
    const k = kind === 'title' ? (a < 0.8 ? 2.45 : a < 1.2 ? 1.3 : 1.38) : a < 0.9 ? 1.3 : 1.0;
    return v.multiplyScalar(k);
  }
  // Binary-search the closest distance at which the frame corners and the far pieces' tops stay on screen,
  // leaving room for the HUD at the top.
  const fitPts = [];
  for (const x of [-4.7, 4.7]) for (const z of [-4.7, 4.7]) { fitPts.push(new THREE.Vector3(x, 0, z)); fitPts.push(new THREE.Vector3(x * 0.85, 1.2, z * 0.85)); fitPts.push(new THREE.Vector3(x, -0.6, z)); }
  const fitPtsTight = [];
  for (const x of [-4.62, 4.62]) for (const z of [-4.62, 4.62]) { fitPtsTight.push(new THREE.Vector3(x, 0, z)); fitPtsTight.push(new THREE.Vector3(x * 0.85, 1.2, z * 0.85)); }
  for (const x of [-4.1, 4.1]) for (const z of [-6.2, 6.2]) fitPtsTight.push(new THREE.Vector3(x, -0.5, z));
  // The side trays as well, used while the camera swings round so the captured pieces stay in frame too.
  const fitPtsTrays = fitPts.slice();
  for (const x of [-5.9, 5.9]) for (const z of [-3.7, 3.7]) fitPtsTrays.push(new THREE.Vector3(x, -0.4, z));
  const probe = new THREE.PerspectiveCamera();
  function fitDistance(dir, topSide, withTrays = false) {
    probe.fov = camera.fov; probe.aspect = camera.aspect; probe.near = 0.1; probe.far = 200; probe.updateProjectionMatrix();
    const yTop = camera.aspect < 0.8 ? 0.74 : 0.84;
    const fits = (d) => {
      probe.position.copy(dir).multiplyScalar(d).add(controls.target);
      if (topSide >= 0) probe.up.set(0, 0, topSide === 0 ? -1 : 1); else probe.up.set(0, 1, 0);
      probe.lookAt(controls.target); probe.updateMatrixWorld();
      const pts = withTrays ? (trayEnds ? fitPtsTight : fitPtsTrays) : camera.aspect < 0.8 ? fitPtsTight : fitPts;
      for (const p of pts) { const q = p.clone().project(probe); if (Math.abs(q.x) > (camera.aspect < 0.8 ? 0.985 : 0.97) || q.y > yTop || q.y < (camera.aspect < 0.8 ? -0.82 : -0.95)) return false; }
      return true;
    };
    let lo = 6, hi = 60;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    return hi;
  }

  let viewSide = 0;
  function setView(kind, side) {
    viewKind = kind; viewSide = side; controls.target.set(0, -0.2, 0); resize();
    board.userData.setSide(kind === 'title' ? 0 : side);
    camera.position.copy(viewPosition(kind, side));
    if (kind === 'top') camera.up.set(0, 0, side === 0 ? -1 : 1); else camera.up.set(0, 1, 0);
    controls.update();
    if (opts.onView) opts.onView(boardScreenRect());
  }
  // Pass-and-play: swing the camera round the board to the other player's side along an arc,
  // rising a little at the midpoint so the board stays in view throughout.
  function swingView(kind, side, dur = 0.95, onMid = null) {
    if (kind !== 'orbit' || viewKind !== 'orbit' || side === viewSide) { setView(kind, side); if (onMid) onMid(); return Promise.resolve(); }
    const from = camera.position.clone().sub(controls.target);
    viewSide = side; let flipped = false;
    const to = viewPosition(kind, side);
    const r0 = from.length(), r1 = to.length();
    const a0 = Math.atan2(from.x, from.z);
    let da = Math.atan2(to.x, to.z) - a0;
    while (da > Math.PI + 1e-3) da -= 2 * Math.PI; while (da < -Math.PI - 1e-3) da += 2 * Math.PI;
    // Fit the distance to the board at each angle of the arc (the diagonal footprint is wider than the edge-on one),
    // so the board keeps a steady size on screen and its corners never leave the frame.
    const polar = Math.acos(Math.min(1, Math.max(-1, to.y / r1)));
    const N = 24, fitR = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + da * (i / N);
      fitR.push(fitDistance(new THREE.Vector3(Math.sin(a) * Math.sin(polar), Math.cos(polar), Math.cos(a) * Math.sin(polar)), -1));
    }
    // One smooth pull-back (a single sine bump sized to the widest angle) keeps the whole board in frame
    // without the double pump that following the per-angle fit produced.
    // The envelope rises smoothly to a flat plateau across the diagonals (where the board's footprint is widest),
    // so the camera orbits at a steady radius instead of dipping out mid-swing and cropping on the way back in.
    const env = (e) => { const s = Math.sin(Math.PI * e) / Math.SQRT1_2; return s >= 1 ? 1 : s * (2 - s); };
    let bump = 0;
    for (let i = 1; i < N; i++) bump = Math.max(bump, (fitR[i] - (fitR[0] + (fitR[N] - fitR[0]) * (i / N))) / env(i / N));
    const p0 = Math.acos(Math.min(1, Math.max(-1, from.y / r0)));
    controls.enabled = false;
    return new Promise((resolve) => {
      let t = 0;
      addTicker((dt) => {
        t += dt / dur;
        const k = Math.min(1, t), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        if (!flipped && e >= 0.5) { flipped = true; board.userData.setSide(side); if (onMid) onMid(); } // labels and player cards turn over as the camera passes the side
        const extra = bump * 1.02 * env(e);
        const a = a0 + da * e, r = r0 + (r1 - r0) * e + extra, pp = p0 + (polar - p0) * e;
        camera.position.set(Math.sin(a) * Math.sin(pp) * r, Math.cos(pp) * r, Math.cos(a) * Math.sin(pp) * r).add(controls.target);
        camera.lookAt(controls.target);
        if (k >= 1) { controls.enabled = true; setView(kind, side); resolve(); return false; }
        return true;
      });
    });
  }
  // Screen-space bounding box (CSS pixels) of the board frame, so HTML player cards can sit beside it.
  function boardScreenRect() {
    camera.updateMatrixWorld();
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const zr = trayEnds ? 6.2 : 4.8;
    for (const x of [-4.8, 4.8]) for (const z of [-zr, zr]) for (const y of [-0.6, 0.9]) {
      const q = new THREE.Vector3(x, y, z).project(camera);
      const sx = (q.x + 1) / 2 * w, sy = (1 - q.y) / 2 * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { left: x0, top: y0, right: x1, bottom: y1, width: w, height: h };
  }

  // Render on demand: idle boards cost nothing, which keeps phones cool and batteries happy.
  const timer = new THREE.Timer();
  const tickers = new Set();
  let dirty = 2, frames = 0, fpsT = 0, fps = 60, wasRendering = false;
  function addTicker(f) { tickers.add(f); invalidate(); }
  const invalidate = (n = 2) => { dirty = Math.max(dirty, n); };
  controls.addEventListener('change', () => invalidate());
  // Test hook: with manual stepping on, the loop idles and step(dt) advances one exact frame,
  // so frame sequences can be captured deterministically even on slow software rendering.
  let manual = false;
  function frame(ts) {
    timer.update(ts);
    if (manual) return;
    tick(timer.getDelta());
  }
  function step(dt) { tick(dt, true); }
  function tick(raw, force) {
    const dt = Math.min(raw, 0.5); // slow devices still finish animations on time
    if (tickers.size) { for (const t of [...tickers]) if (t(dt) === false) tickers.delete(t); dirty = Math.max(dirty, 1); }
    const moved = controls.update();
    if (moved) dirty = Math.max(dirty, 1);
    if (dirty <= 0 && !force) { wasRendering = false; return; }
    dirty--;
    renderer.render(scene, camera);
    // Frame rate is measured only across continuous animation, not idle gaps.
    if (wasRendering) { frames++; fpsT += raw; }
    wasRendering = true;
    if (fpsT >= 1 || (frames >= 2 && fpsT > 0.5)) { fps = frames / fpsT; frames = 0; fpsT = 0; if (opts.onFps) opts.onFps(fps); }
  }
  renderer.setAnimationLoop(frame);
  window.addEventListener('resize', () => setView(viewKind, viewSide));
  applyQuality(quality);
  setView('orbit', 0);

  return {
    THREE, renderer, scene, camera, controls, board, overlays, fx, pieces, piecesGroup, graveyard,
    setPosition, placeMesh, pick, setView, swingView, boardScreenRect, viewPosition, resize, applyQuality, clearGraveyard, addToGraveyard, graveSlot,
    addTicker,
    invalidate,
    step, setManual: (v) => { manual = !!v; },
    get fps() { return fps; }, get quality() { return quality; }, get mats() { return mats; },
    makeMesh: (t, c) => makePieceMesh(t, c, mats),
    sqToXZ,
  };
}
