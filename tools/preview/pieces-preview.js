import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';
import { makePieceMesh, pieceMaterials } from '../../src/scene/pieces.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(1200, 600); r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color(0x2a1a10);
s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture; s.environmentIntensity = 0.5;
const cam = new THREE.PerspectiveCamera(30, 2, 0.1, 100); cam.position.set(0, 2.2, 7); cam.lookAt(0, 0.5, 0);
const d = new THREE.DirectionalLight(0xffe2b8, 2.5); d.position.set(3, 6, 4); d.castShadow = true; s.add(d);
s.add(new THREE.HemisphereLight(0xfff1dd, 0x2a1a10, 0.6));
const fl = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x6b4428 })); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; s.add(fl);
const mats = pieceMaterials('high');
for (let c = 0; c < 2; c++) for (let t = 1; t <= 6; t++) { const m = makePieceMesh(t, c, mats); m.position.set((t - 3.5) * 0.85, 0, c ? -1 : 0.6); if (t === 2) m.rotation.y = c ? Math.PI * 0.75 : -Math.PI / 2 + 0.4; s.add(m); }
r.render(s, cam); window.__done = true;
