// Procedural Staunton pieces. One square is 1 unit. Geometry is built once and shared.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';

const SEG = 36;

// Lathe from [radius, height] pairs (bottom to top). Smooths with a Catmull-Rom pass.
function lathe(points, segments = SEG, smooth = true) {
  let pts = points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  if (smooth) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      const n = 3;
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push(new THREE.Vector2(Math.max(f(p0.x, p1.x, p2.x, p3.x), 0.0001), f(p0.y, p1.y, p2.y, p3.y)));
      }
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

// Shared Staunton foot: felt pad, broad base with bead and cove.
const BASE = [[0, 0], [0.34, 0], [0.36, 0.02], [0.36, 0.05], [0.33, 0.07], [0.335, 0.09], [0.30, 0.11], [0.25, 0.13], [0.22, 0.16]];

function pawn() {
  return lathe([...BASE, [0.17, 0.22], [0.13, 0.30], [0.11, 0.36], [0.19, 0.39], [0.19, 0.41], [0.10, 0.43], [0.09, 0.45],
    [0.14, 0.49], [0.16, 0.55], [0.14, 0.61], [0.09, 0.65], [0.0, 0.665]]);
}

function rook() {
  const body = lathe([...BASE, [0.21, 0.22], [0.18, 0.34], [0.17, 0.48], [0.18, 0.56], [0.23, 0.60], [0.235, 0.63], [0.21, 0.64],
    [0.23, 0.66], [0.23, 0.78], [0.0, 0.78]], SEG, false);
  // crenellations: cut by adding four merlons on the rim
  const parts = [body];
  const ring = new THREE.CylinderGeometry(0.23, 0.23, 0.001, SEG);
  ring.translate(0, 0.78, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.BoxGeometry(0.1, 0.09, 0.07);
    m.translate(0, 0, 0.185);
    m.rotateY(a);
    m.translate(0, 0.825, 0);
    parts.push(m.toNonIndexed());
  }
  const inner = new THREE.CylinderGeometry(0.14, 0.14, 0.02, SEG, 1, true);
  inner.translate(0, 0.77, 0);
  return mergeGeometries([body.toNonIndexed(), ...parts.slice(1), inner.toNonIndexed()]);
}

let bishopGroove = null;
function bishop() {
  // Slender mitre head with a carved diagonal groove facing +z (the owner's side), then a ball finial.
  // The mitre head is resampled finely so the carved cut has enough rings to show.
  const head = [[0.09, 0.57], [0.12, 0.62], [0.145, 0.69], [0.135, 0.76], [0.105, 0.83], [0.06, 0.89], [0.0, 0.925]];
  const dense = new THREE.SplineCurve(head.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(40).map((v) => [v.x, v.y]);
  const body = lathe([...BASE, [0.16, 0.24], [0.12, 0.36], [0.10, 0.48], [0.19, 0.51], [0.19, 0.535], [0.10, 0.555], ...dense], 96);
  const p = body.attributes.position;
  const col = new Float32Array(p.count * 3).fill(1);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0.6 || y > 0.9 || z <= 0) continue;
    const d = Math.abs(x * 0.6 + (y - 0.765) * 0.8);
    if (d < 0.05) {
      const depth = Math.max(0, 1 - d / 0.04) * Math.min(1, z / 0.06);
      const k = 1 - 0.82 * depth; p.setX(i, x * k); p.setZ(i, z * k);
      // Darken the carved cut so it reads on pale wood as well as dark.
      const shade = 1 - 0.85 * Math.min(1, (1 - d / 0.05) * 1.6) * Math.min(1, z / 0.05);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
    }
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.computeVertexNormals();
  // Separate dark inlay that lines the carved cut, so the mitre groove reads from across the board on both colours.
  const flat = body.toNonIndexed(), fp = flat.attributes.position, fc = flat.attributes.color, fn = flat.attributes.normal;
  const gpos = [];
  for (let t = 0; t < fp.count; t += 3) {
    let dark = true;
    for (let j = 0; j < 3; j++) if (fc.getX(t + j) > 0.55) dark = false;
    if (!dark) continue;
    for (let j = 0; j < 3; j++) {
      const i = t + j;
      gpos.push(fp.getX(i) + fn.getX(i) * 0.003, fp.getY(i) + fn.getY(i) * 0.003, fp.getZ(i) + fn.getZ(i) * 0.003);
    }
  }
  const groove = new THREE.BufferGeometry();
  groove.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  groove.computeVertexNormals();
  bishopGroove = groove;
  const ball = new THREE.SphereGeometry(0.05, 16, 12); ball.translate(0, 0.955, 0);
  ball.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ball.attributes.position.count * 3).fill(1), 3));
  return mergeGeometries([body.toNonIndexed(), ball.toNonIndexed()]);
}

function queen() {
  const body = lathe([...BASE, [0.20, 0.22], [0.15, 0.38], [0.11, 0.58], [0.10, 0.66], [0.20, 0.69], [0.20, 0.715], [0.11, 0.735],
    [0.12, 0.77], [0.17, 0.85], [0.20, 0.93], [0.16, 0.95], [0.12, 0.965], [0.0, 0.97]]);
  const parts = [body.toNonIndexed()];
  for (let i = 0; i < 9; i++) { // coronet balls
    const a = (i / 9) * Math.PI * 2;
    const s = new THREE.ConeGeometry(0.04, 0.11, 10);
    s.translate(Math.cos(a) * 0.175, 0.99, Math.sin(a) * 0.175);
    parts.push(s.toNonIndexed());
    const b = new THREE.SphereGeometry(0.03, 10, 8);
    b.translate(Math.cos(a) * 0.175, 1.05, Math.sin(a) * 0.175);
    parts.push(b.toNonIndexed());
  }
  const top = new THREE.SphereGeometry(0.07, 20, 14); top.translate(0, 1.04, 0);
  parts.push(top.toNonIndexed());
  return mergeGeometries(parts);
}

function king() {
  const body = lathe([...BASE, [0.21, 0.22], [0.16, 0.40], [0.12, 0.62], [0.11, 0.70], [0.21, 0.73], [0.21, 0.755], [0.12, 0.775],
    [0.13, 0.81], [0.18, 0.90], [0.19, 0.97], [0.14, 1.0], [0.08, 1.02], [0.06, 1.04], [0.0, 1.045]]);
  const a = new THREE.BoxGeometry(0.11, 0.44, 0.11); a.translate(0, 1.24, 0);
  const b = new THREE.BoxGeometry(0.34, 0.11, 0.11); b.translate(0, 1.31, 0);
  return mergeGeometries([body.toNonIndexed(), a.toNonIndexed(), b.toNonIndexed()]);
}

function knight() {
  const base = lathe([...BASE, [0.24, 0.20], [0.25, 0.23], [0.0, 0.235]]);
  // Horse head profile (x forward, y up), traced with smooth splines, then extruded thick with a deep
  // rounded bevel and tapered toward the muzzle and ears so it reads as carved, not cut from a plank.
  const s = new THREE.Shape();
  s.moveTo(-0.21, 0.0);
  s.lineTo(0.18, 0.0);
  s.splineThru([new THREE.Vector2(0.17, 0.12), new THREE.Vector2(0.10, 0.25), new THREE.Vector2(0.13, 0.32),
    new THREE.Vector2(0.26, 0.35), new THREE.Vector2(0.35, 0.39), new THREE.Vector2(0.365, 0.44), new THREE.Vector2(0.33, 0.49)]);
  s.splineThru([new THREE.Vector2(0.22, 0.54), new THREE.Vector2(0.14, 0.62), new THREE.Vector2(0.11, 0.70), new THREE.Vector2(0.10, 0.80)]);
  s.lineTo(0.05, 0.71);
  s.lineTo(0.0, 0.78);
  s.splineThru([new THREE.Vector2(-0.05, 0.68), new THREE.Vector2(-0.14, 0.58), new THREE.Vector2(-0.21, 0.44), new THREE.Vector2(-0.235, 0.28),
    new THREE.Vector2(-0.235, 0.12), new THREE.Vector2(-0.21, 0.0)]);
  let head = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.035, bevelSegments: 5, curveSegments: 12 });
  head.translate(0, 0, -0.05);
  const hp = head.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i);
    // Narrow the muzzle and the top of the head, keep the neck full.
    const k = 1 - 0.3 * Math.max(0, Math.min(1, (x - 0.12) / 0.25)) - 0.2 * Math.max(0, Math.min(1, (y - 0.6) / 0.2));
    hp.setZ(i, hp.getZ(i) * k);
  }
  // Weld vertices and recompute normals so the carved head shades smoothly instead of faceted.
  head.deleteAttribute('normal'); head.deleteAttribute('uv');
  const smooth = mergeVertices(head, 1e-4); smooth.computeVertexNormals();
  head = smooth;
  head.rotateY(-Math.PI / 2); // profile x -> world z (muzzle points +z)
  head.translate(0, 0.22, 0);
  // Mane: a row of small ridges down the back of the neck.
  const parts = [base.toNonIndexed(), head.toNonIndexed()];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const m = new THREE.SphereGeometry(0.045, 10, 8);
    m.scale(0.8, 1.5, 0.9);
    m.rotateX(-0.5 + t * 0.9);
    m.translate(0, 0.22 + 0.60 - t * 0.36, -(0.10 + t * 0.12));
    parts.push(m.toNonIndexed());
  }
  // Eyes, set into the widest part of the head.
  // Nostril flare at the muzzle.
  const nose = new THREE.SphereGeometry(0.05, 12, 8); nose.scale(1.3, 0.8, 1); nose.translate(0, 0.22 + 0.42, 0.33);
  parts.push(nose.toNonIndexed());
  return mergeGeometries(parts.map((x) => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; }));
}

let contactG = null, contactM = null;
function contactGeo() {
  if (!contactG) { contactG = new THREE.PlaneGeometry(0.95, 0.95); contactG.rotateX(-Math.PI / 2); }
  return contactG;
}
function contactMat() {
  if (contactM) return contactM;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, 'rgba(20,10,4,0.7)'); g.addColorStop(0.45, 'rgba(20,10,4,0.5)'); g.addColorStop(1, 'rgba(20,10,4,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  contactM = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return contactM;
}

let cache = null;
export function pieceGeometries() {
  if (cache) return cache;
  const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; if (n.attributes.uv) n.deleteAttribute('uv'); if (!n.attributes.color) n.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 3).fill(1), 3)); n.computeBoundingBox(); return n; };
  cache = [null, strip(pawn()), strip(knight()), strip(bishop()), strip(rook()), strip(queen()), strip(king())];
  // Bishop mitre cut: a thin slanted box rendered in a dark material, kept separate.
  const slit = new THREE.BoxGeometry(0.34, 0.065, 0.075);
  slit.rotateZ(0.7);
  slit.translate(0.02, 0.8, 0.0);
  slit.rotateY(Math.PI / 2);
  cache.bishopSlit = slit;
  cache.bishopGroove = bishopGroove;
  // Knight eyes: small dark almond insets, one per side, rendered in the dark accent material.
  const eye = new THREE.SphereGeometry(0.028, 12, 8); eye.scale(0.5, 0.8, 1.35); eye.translate(0.098, 0.22 + 0.585, 0.12);
  const eye2 = eye.clone(); eye2.translate(-0.196, 0, 0);
  cache.knightEyes = mergeGeometries([eye.toNonIndexed(), eye2.toNonIndexed()]);
  return cache;
}

function grainTexture(light) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = light ? '#e8cf9f' : '#3a2016'; x.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256;
    x.strokeStyle = light ? `rgba(150,100,50,${0.05 + Math.random() * 0.12})` : `rgba(10,4,2,${0.1 + Math.random() * 0.25})`;
    x.lineWidth = 0.5 + Math.random() * 1.5;
    x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(20, y + Math.random() * 6 - 3, 44, y + Math.random() * 6 - 3, 64, y + Math.random() * 4 - 2); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function pieceMaterials(quality = 'high') {
  const Mat = quality === 'low' ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
  const lightOpts = { color: 0xe2c89a, roughness: 0.5, metalness: 0.0 };
  const darkOpts = { color: 0x3c2016, roughness: 0.42, metalness: 0.0 };
  if (quality !== 'low') { Object.assign(lightOpts, { clearcoat: 0.35, clearcoatRoughness: 0.35 }); Object.assign(darkOpts, { clearcoat: 0.45, clearcoatRoughness: 0.3 }); }
  // The grain canvas carries the base colour, so the material colour only tints it.
  lightOpts.map = grainTexture(true); lightOpts.color = 0xf4e6cc;
  darkOpts.map = grainTexture(false); darkOpts.color = 0xffffff;
  lightOpts.vertexColors = true; darkOpts.vertexColors = true;
  const light = new Mat(lightOpts), dark = new Mat(darkOpts);
  const slit = new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.8 });
  const slitLight = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.85 });
  const grooveDark = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1, metalness: 0 });
  return { light, dark, slit, slitLight, grooveDark };
}

// Build a mesh group for piece type t (1..6) and colour c (0 white, 1 black).
export function makePieceMesh(t, c, mats) {
  const geos = pieceGeometries();
  const grp = new THREE.Group();
  const m = new THREE.Mesh(geos[t], c === 0 ? mats.light : mats.dark);
  m.castShadow = true; m.receiveShadow = false; // self-shadowing on lathe curves caused speckled acne rims
  grp.add(m);
  if (t === 2) grp.add(new THREE.Mesh(geos.knightEyes, c === 0 ? mats.slitLight : mats.slit));
  if (t === 3 && geos.bishopGroove) grp.add(new THREE.Mesh(geos.bishopGroove, c === 0 ? mats.slitLight : mats.grooveDark));
  // Soft contact shadow so pale pieces stay grounded on pale squares even where the key-light shadow falls behind them.
  const blob = new THREE.Mesh(contactGeo(), contactMat());
  blob.position.y = 0.006; blob.renderOrder = 1; blob.userData.contact = true;
  grp.add(blob);
  if (t === 3 && c === 1) grp.rotation.y = Math.PI; // groove faces its owner
  if (t === 2) grp.rotation.y = c === 0 ? Math.PI / 2 + 0.2 : -Math.PI / 2 + 0.2; // mostly side-on so the horse profile reads from either player's seat
  grp.userData = { type: t, color: c };
  return grp;
}
