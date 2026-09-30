// Small one-shot visual effects: spark bursts, expanding rings and a gentle camera nudge.
// Every effect is a ticker that removes itself, so an idle board renders nothing.
import * as THREE from 'three';

let sparkTex = null;
function spark() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,240,200,0.85)'); g.addColorStop(1, 'rgba(255,200,120,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  sparkTex = new THREE.CanvasTexture(c); sparkTex.colorSpace = THREE.SRGBColorSpace;
  return sparkTex;
}

export function createEffects(S) {
  const ringGeo = new THREE.RingGeometry(0.42, 0.5, 64); ringGeo.rotateX(-Math.PI / 2);

  // Sparks fly up and out from a point, then fall and fade.
  function burst(x, z, { color = 0xffd27a, count = 40, speed = 2.6, up = 3.2, size = 0.22, life = 0.9, y = 0.4 } = {}) {
    if (S.quality === 'low') count = Math.ceil(count / 2);
    const pos = new Float32Array(count * 3), vel = [];
    for (let i = 0; i < count; i++) {
      pos.set([x, y, z], i * 3);
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65);
      vel.push([Math.cos(a) * s, up * (0.5 + Math.random() * 0.7), Math.sin(a) * s]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: spark(), color, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.renderOrder = 6; S.fx.add(pts);
    let t = 0;
    S.addTicker((dt) => {
      t += dt;
      const a = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const v = vel[i]; v[1] -= 6.5 * dt;
        a[i * 3] += v[0] * dt; a[i * 3 + 1] = Math.max(0.02, a[i * 3 + 1] + v[1] * dt); a[i * 3 + 2] += v[2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - t / life);
      if (t >= life) { S.fx.remove(pts); geo.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  // A thin glowing ring expands across the board from a square.
  function ring(x, z, { color = 0xffc86a, to = 2.4, life = 0.8, opacity = 0.8, additive = true, onTop = false, delay = 0 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest: !onTop, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const m = new THREE.Mesh(ringGeo, mat); m.position.set(x, 0.03, z); m.renderOrder = onTop ? 7 : 5; S.fx.add(m);
    let t = -delay;
    S.addTicker((dt) => {
      t += dt; if (t < 0) return true;
      const k = Math.min(1, t / life), e = 1 - (1 - k) ** 3;
      m.scale.setScalar(1 + (to - 1) * e); mat.opacity = opacity * (1 - k);
      if (k >= 1) { S.fx.remove(m); mat.dispose(); return false; }
      return true;
    });
  }

  // A short damped shake of the camera, used for clashes and mate. Small enough not to be unpleasant.
  function shake(amount = 0.08, life = 0.35) {
    // Offset-based, so it layers cleanly over other camera motion such as a push-in.
    const off = new THREE.Vector3();
    let t = 0;
    S.addTicker((dt) => {
      S.camera.position.sub(off);
      t += dt; const k = Math.min(1, t / life), a = amount * (1 - k);
      if (k >= 1) { off.set(0, 0, 0); return false; }
      off.set(Math.sin(t * 61) * a, Math.sin(t * 47) * a * 0.6, Math.cos(t * 53) * a);
      S.camera.position.add(off);
      return true;
    });
  }

  // Lift a piece mesh briefly with a scale pop, for promotion.
  function pop(mesh, life = 0.6) {
    if (!mesh) return;
    let t = 0; const y0 = mesh.position.y;
    S.addTicker((dt) => {
      t += dt; const k = Math.min(1, t / life);
      const s = 1 + Math.sin(Math.PI * k) * 0.22;
      mesh.scale.setScalar(s); mesh.position.y = y0 + Math.sin(Math.PI * k) * 0.35;
      mesh.rotation.y += dt * 9 * (1 - k);
      if (k >= 1) { mesh.scale.setScalar(1); mesh.position.y = y0; return false; }
      return true;
    });
  }

  // A glowing strip along the board from attacker to target that flares then fades: shows why it is mate.
  function beam(x0, z0, x1, z1, { color = 0xff3b2a, life = 1.2 } = {}) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const geo = new THREE.PlaneGeometry(0.16, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 7; m.rotation.y = Math.atan2(dx, dz); S.fx.add(m);
    let t = 0;
    S.addTicker((dt) => {
      t += dt; const k = Math.min(1, t / life);
      const grow = Math.min(1, k / 0.25), ge = 1 - (1 - grow) ** 3;
      m.scale.set(1, 1, Math.max(0.001, len * ge));
      m.position.set(x0 + dx * ge / 2, 0.04, z0 + dz * ge / 2);
      mat.opacity = 0.9 * (k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75);
      if (k >= 1) { S.fx.remove(m); geo.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  // Ease the camera a little toward a point on the board, keeping its aim, for a finishing moment.
  function pushIn(x, z, amount = 0.15, life = 0.9, aimAmount = amount * 1.6) {
    const start = S.camera.position.clone(), tgt = S.controls.target.clone();
    const goal = start.clone().lerp(new THREE.Vector3(x, 0, z), amount);
    const aim = tgt.clone().lerp(new THREE.Vector3(x, 0, z), aimAmount);
    let t = 0;
    S.addTicker((dt) => {
      t += dt; const k = Math.min(1, t / life), e = 1 - (1 - k) ** 3;
      S.camera.position.lerpVectors(start, goal, e); S.controls.target.lerpVectors(tgt, aim, e); S.camera.lookAt(S.controls.target);
      return k < 1;
    });
  }

  // A soft cloud of dust: a few large, normally blended puffs that swell, drift up and thin out.
  let dustTex = null;
  function dust(x, z, { color = 0xe8dcc4, count = 12, spread = 0.35, size = 0.55, grow = 2.2, life = 0.95, y = 0.25, opacity = 0.85 } = {}) {
    if (!dustTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g2 = c.getContext('2d');
      const g = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      g2.fillStyle = g; g2.fillRect(0, 0, 64, 64);
      dustTex = new THREE.CanvasTexture(c); dustTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (S.quality === 'low') count = Math.ceil(count / 2);
    const puffs = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: dustTex, color, transparent: true, depthWrite: false, opacity: 0 });
      const sp = new THREE.Sprite(mat); sp.renderOrder = 6;
      const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
      sp.position.set(x + Math.cos(a) * r, y + Math.random() * 0.2, z + Math.sin(a) * r);
      sp.material.rotation = Math.random() * Math.PI * 2;
      puffs.push({ sp, v: [Math.cos(a) * 0.5, 0.35 + Math.random() * 0.4, Math.sin(a) * 0.5], s: size * (0.7 + Math.random() * 0.6), d: Math.random() * 0.08 });
      S.fx.add(sp);
    }
    let t = 0;
    S.addTicker((dt) => {
      t += dt;
      for (const p of puffs) {
        const k = Math.max(0, Math.min(1, (t - p.d) / life)), e = 1 - (1 - k) ** 2;
        p.sp.position.x += p.v[0] * dt * (1 - k); p.sp.position.y += p.v[1] * dt * (1 - k); p.sp.position.z += p.v[2] * dt * (1 - k);
        p.sp.scale.setScalar(p.s * (1 + (grow - 1) * e));
        // Quick swell to full density, then a long thinning tail.
        p.sp.material.opacity = opacity * Math.min(1, k * 8) * (1 - k) ** 1.4;
      }
      if (t >= life + 0.1) { for (const p of puffs) { S.fx.remove(p.sp); p.sp.material.dispose(); } return false; }
      return true;
    });
  }

  return { burst, ring, shake, pop, beam, pushIn, dust };
}
