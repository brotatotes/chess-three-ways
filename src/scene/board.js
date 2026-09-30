// Table, carved board, frame lettering and square overlays. One square is 1 unit.
// Board top surface is at y = 0. White sits at +z, so a1 is at (-3.5, 0, 3.5).
import * as THREE from 'three';

export const sqToXZ = (s) => [(s & 7) - 3.5, 3.5 - (s >> 3)];
export function xzToSq(x, z) {
  const f = Math.floor(x + 4), r = Math.floor(4 - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}

function rand(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// Procedural wood: long streaky grain with gentle waviness and pores.
function woodCanvas(w, h, base, dark, light, seed, streaks = 140, wave = 6) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const R = rand(seed);
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  for (let i = 0; i < streaks; i++) {
    const y0 = R() * h, amp = R() * wave, ph = R() * 6.28, fr = 1 + R() * 3;
    x.strokeStyle = R() < 0.6 ? dark : light;
    x.globalAlpha = 0.04 + R() * 0.16;
    x.lineWidth = 0.6 + R() * 2.6;
    x.beginPath();
    for (let px = 0; px <= w; px += 8) {
      const y = y0 + Math.sin(px / w * fr * 6.28 + ph) * amp;
      if (px === 0) x.moveTo(px, y); else x.lineTo(px, y);
    }
    x.stroke();
  }
  x.globalAlpha = 0.08;
  for (let i = 0; i < w * h / 300; i++) { x.fillStyle = dark; x.fillRect(R() * w, R() * h, 1 + R() * 2, 1); }
  x.globalAlpha = 1;
  return c;
}

function tex(canvas, repeat = [1, 1], rot = 0) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.rotation = rot; t.center.set(0.5, 0.5);
  t.anisotropy = 4;
  return t;
}

// Board squares drawn into one texture so each square has its own grain direction.
function boardSquaresCanvas(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const q = size / 8;
  const maple = woodCanvas(256, 256, '#a4763c', '#7a4e20', '#bb935a', 11, 70, 4);
  const walnut = woodCanvas(256, 256, '#5a3520', '#2c170c', '#7b4c2c', 23, 90, 5);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const lightSq = (r + f) % 2 === 1;
    const src = lightSq ? maple : walnut;
    x.save();
    x.translate(f * q + q / 2, (7 - r) * q + q / 2);
    x.rotate(((r * 3 + f * 5) % 4) * Math.PI / 2);
    x.drawImage(src, ((r * 37 + f * 53) % 128), ((r * 71 + f * 29) % 128), 128, 128, -q / 2, -q / 2, q, q);
    x.restore();
    // hairline inlay seam
    x.strokeStyle = 'rgba(30,15,6,0.35)'; x.lineWidth = Math.max(1, size / 1024);
    x.strokeRect(f * q, (7 - r) * q, q, q);
  }
  return c;
}

// Frame with engraved file letters and rank numbers, drawn as a texture for the frame top.
function frameCanvas(size, fontFamily, side = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.drawImage(woodCanvas(size, size, '#4a2a17', '#24120a', '#6e4226', 5, 220, 10), 0, 0);
  // frame covers board span 9.2 units; inner board 8 units centered
  const u = size / 9.2, off = 0.6 * u;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `600 ${Math.round(u * 0.34)}px ${fontFamily}`;
  const engrave = (t, px, py, rot) => {
    x.save(); x.translate(px, py); x.rotate(rot);
    // Garamond digits are old-style, so the rank numbers are drawn larger to match the letters' visual height.
    x.font = `600 ${Math.round(u * (/[0-9]/.test(t) ? 0.46 : 0.34))}px ${fontFamily}`;
    x.fillStyle = 'rgba(255,220,160,0.18)'; x.fillText(t, 0, 1.5);
    x.fillStyle = '#c9a36a'; x.fillText(t, 0, 0);
    x.restore();
  };
  for (let i = 0; i < 8; i++) {
    const L = 'abcdefgh'[i], N = String(i + 1);
    // Labels sit on the viewer's near edge and left side, upright for whoever is playing that side.
    if (side === 0) {
      engrave(L, off + (i + 0.5) * u, size - off / 2, 0);
      engrave(N, off / 2, size - off - (i + 0.5) * u, 0);
    } else {
      engrave(L, off + (i + 0.5) * u, off / 2, Math.PI);
      engrave(N, size - off / 2, size - off - (i + 0.5) * u, Math.PI);
    }
  }
  // inlaid gold line around the playing area
  x.strokeStyle = '#b88a3e'; x.lineWidth = u * 0.03;
  x.strokeRect(off - u * 0.07, off - u * 0.07, 8 * u + u * 0.14, 8 * u + u * 0.14);
  return c;
}

export function buildBoard(quality = 'high', fontFamily = 'serif') {
  const hi = quality !== 'low';
  const group = new THREE.Group();
  const Mat = hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

  // Table: large walnut slab with soft falloff at the edges.
  const tableTex = tex(woodCanvas(1024, 1024, '#4e2e1a', '#2e1a0e', '#6a4128', 3, 160, 3), [1.5, 1.5]);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 0.6, 128),
    new Mat({ map: tableTex, roughness: 0.55, ...(hi ? { clearcoat: 0.35, clearcoatRoughness: 0.4 } : {}) }));
  table.position.y = -0.62 - 0.3; table.receiveShadow = true;
  group.add(table);

  // Frame: bevelled box with engraved letter texture on top.
  const frameTops = [null, null];
  const frameTopFor = (side) => {
    if (!frameTops[side]) { const t = tex(frameCanvas(hi ? 2048 : 1024, fontFamily, side)); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; frameTops[side] = t; }
    return frameTops[side];
  };
  const frameTop = frameTopFor(0);
  const frameSide = tex(woodCanvas(512, 64, '#4a2a17', '#24120a', '#6e4226', 9, 60, 3), [4, 1]);
  const frameMatSide = new Mat({ map: frameSide, roughness: 0.5, ...(hi ? { clearcoat: 0.4, clearcoatRoughness: 0.38 } : {}) });
  const frameMatTop = new Mat({ map: frameTop, roughness: 0.48, ...(hi ? { clearcoat: 0.4, clearcoatRoughness: 0.35 } : {}) });
  const shape = new THREE.Shape();
  const H = 4.6, rr = 0.18;
  shape.moveTo(-H + rr, -H); shape.lineTo(H - rr, -H); shape.quadraticCurveTo(H, -H, H, -H + rr);
  shape.lineTo(H, H - rr); shape.quadraticCurveTo(H, H, H - rr, H); shape.lineTo(-H + rr, H);
  shape.quadraticCurveTo(-H, H, -H, H - rr); shape.lineTo(-H, -H + rr); shape.quadraticCurveTo(-H, -H, -H + rr, -H);
  const frameGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: hi ? 4 : 1, curveSegments: 6 });
  frameGeo.rotateX(-Math.PI / 2);
  frameGeo.translate(0, -0.62, 0);
  // Map top face UVs to the frame texture.
  const pos = frameGeo.attributes.position, uv = frameGeo.attributes.uv, nrm = frameGeo.attributes.normal;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + H) / (2 * H), (-pos.getZ(i) + H) / (2 * H));
  // Top faces use group 0 in ExtrudeGeometry (caps), sides group 1.
  const frame = new THREE.Mesh(frameGeo, [frameMatTop, frameMatSide]);
  frame.castShadow = true; frame.receiveShadow = true;
  frame.position.y = 0.0; // top of frame at y ~ -0.06 .. 0 (bevel)
  group.add(frame);
  void nrm;

  // Playing surface, very slightly raised inside the frame.
  const sqTex = tex(boardSquaresCanvas(hi ? 2048 : 1024));
  sqTex.wrapS = sqTex.wrapT = THREE.ClampToEdgeWrapping;
  const surface = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 8),
    [frameMatSide, frameMatSide, new Mat({ map: sqTex, roughness: 0.46, ...(hi ? { clearcoat: 0.18, clearcoatRoughness: 0.45 } : {}) }), frameMatSide, frameMatSide, frameMatSide]);
  surface.position.y = -0.03; surface.receiveShadow = true;
  group.add(surface);

  // Capture trays on either side of the board (felt-lined wooden troughs).
  const trays = [];
  const felt = new THREE.MeshStandardMaterial({ color: 0x1d3a2b, roughness: 0.98 });
  for (const side of [-1, 1]) {
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 8.4), frameMatSide);
    tray.position.set(side * 5.55, -0.62 + 0.05, 0); tray.receiveShadow = true; tray.castShadow = hi;
    const lining = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 8.2), felt);
    lining.position.set(side * 5.55, -0.62 + 0.105, 0); lining.receiveShadow = true;
    group.add(tray, lining);
    trays.push([tray, lining, side]);
  }
  // Wide screens keep the trays beside the board. Tall phone screens move them to the far and near ends,
  // so the board can use the full width and the trays fill the space above and below it.
  group.userData.setTrayLayout = (ends) => {
    for (const [tray, lining, side] of trays) for (const m of [tray, lining]) {
      m.rotation.y = ends ? Math.PI / 2 : 0;
      m.position.x = ends ? 0 : side * 5.55;
      m.position.z = ends ? side * 5.55 : 0;
    }
  };
  // Swap the engraved labels so they read upright from the side being viewed.
  group.userData.setSide = (side) => { const t = frameTopFor(side ? 1 : 0); if (frameMatTop.map !== t) { frameMatTop.map = t; frameMatTop.needsUpdate = true; } };
  return group;
}

// Square overlays: selection, legal-move dots, capture rings, last move, check, cursor, fog.
export function buildOverlays() {
  const group = new THREE.Group();
  const flat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const plane = new THREE.PlaneGeometry(0.98, 0.98); plane.rotateX(-Math.PI / 2);
  const dot = new THREE.PlaneGeometry(0.62, 0.62); dot.rotateX(-Math.PI / 2);
  // Hint marker: a warm gold bead with a soft glow and a thin dark edge, so it reads as a UI marker on both maple and walnut.
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 20, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,214,120,0.55)'); g.addColorStop(1, 'rgba(255,214,120,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.beginPath(); x.arc(64, 64, 30, 0, Math.PI * 2); x.fillStyle = 'rgba(40,22,8,0.75)'; x.fill();
    const b = x.createRadialGradient(58, 58, 4, 64, 64, 26);
    b.addColorStop(0, '#fff1c4'); b.addColorStop(0.55, '#f2bf4f'); b.addColorStop(1, '#c98a22');
    x.beginPath(); x.arc(64, 64, 26, 0, Math.PI * 2); x.fillStyle = b; x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ring = new THREE.RingGeometry(0.36, 0.46, 48); ring.rotateX(-Math.PI / 2);
  const selRing = new THREE.RingGeometry(0.37, 0.45, 48); selRing.rotateX(-Math.PI / 2);
  const mats = {
    last: flat(0xf2c04a, 0.5), select: flat(0xffc53d, 0.68), hint: new THREE.MeshBasicMaterial({ map: dotTex, transparent: true, opacity: 0.95, depthWrite: false }), capture: flat(0xc0463a, 0.7),
    check: flat(0xff3a2a, 0.55), cursor: flat(0xffffff, 0.25), pending: flat(0x6fb6ff, 0.4),
  };
  const pool = [];
  function clear() { for (const m of pool) m.visible = false; }
  let used = 0;
  function add(kind, sq) {
    let m = pool[used];
    const geo = kind === 'hint' ? dot : kind === 'select' ? plane : (kind === 'capture' || kind === 'check') ? ring : plane;
    if (!m) { m = new THREE.Mesh(geo, mats[kind]); m.renderOrder = 2; group.add(m); pool.push(m); }
    m.geometry = geo; m.material = mats[kind]; m.visible = true;
    const [x, z] = sqToXZ(sq);
    m.position.set(x, 0.004 + used * 0.00001, z);
    m.userData.kind = kind;
    used++;
    return m;
  }
  function set(list) { clear(); used = 0; for (const [k, s] of list) add(k, s); }
  return { group, set, mats };
}
