// Audio: no AudioContext may exist until enable() is called from a user gesture,
// and playing sounds while disabled must be a silent no-op.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/audio/audio.js';

// A minimal fake of the Web Audio graph, enough for createAudio to build its buses.
function fakeParam() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; }
function fakeNode(extra = {}) { return { connect() {}, disconnect() {}, start() {}, stop() {}, gain: fakeParam(), frequency: fakeParam(), Q: fakeParam(), detune: fakeParam(), delayTime: fakeParam(), playbackRate: fakeParam(), threshold: fakeParam(), knee: fakeParam(), ratio: fakeParam(), attack: fakeParam(), release: fakeParam(), ...extra }; }
function makeCtor(counter) {
  return class FakeCtx {
    constructor() { counter.n++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = fakeNode(); this.nodes = 0; }
    createDynamicsCompressor() { this.nodes++; return fakeNode(); }
    createGain() { this.nodes++; return fakeNode(); }
    createBiquadFilter() { this.nodes++; return fakeNode(); }
    createDelay() { this.nodes++; return fakeNode(); }
    createOscillator() { this.nodes++; return fakeNode(); }
    createBufferSource() { this.nodes++; return fakeNode(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  };
}

test('no AudioContext is created before enable()', () => {
  const counter = { n: 0 };
  const A = createAudio(makeCtor(counter));
  A.setSettings({ soundEnabled: true, music: 50, sfx: 50 });
  A.setMode('fog'); A.setIntensity(0.8);
  A.play('move', { piece: 1 }); A.play('capture'); A.music(true); A.ticking(true);
  assert.equal(counter.n, 0);
  assert.equal(A.started, false);
});

test('enable() creates exactly one context and reuses it', () => {
  const counter = { n: 0 };
  const A = createAudio(makeCtor(counter));
  A.setSettings({ soundEnabled: true });
  assert.equal(A.enable(), true);
  assert.equal(A.enable(), true);
  assert.equal(counter.n, 1);
  assert.equal(A.started, true);
});

test('sounds are silent no-ops while sound is off or effects are muted', () => {
  const counter = { n: 0 };
  const A = createAudio(makeCtor(counter));
  A.enable();
  const ctx = A.context;
  const before = ctx.nodes;
  A.setSettings({ soundEnabled: false }); A.play('move');
  A.setSettings({ soundEnabled: true, sfxMuted: true }); A.play('clash');
  assert.equal(ctx.nodes, before);
  A.setSettings({ sfxMuted: false }); A.play('clash');
  assert.ok(ctx.nodes > before);
});

test('every documented sound exists', () => {
  const A = createAudio(null);
  for (const n of ['move', 'capture', 'land', 'check', 'mate', 'promote', 'wind', 'tick', 'clash']) assert.ok(A.sfxNames.includes(n), n);
  assert.equal(A.enable(), false); // no Web Audio available: stays silent rather than throwing
});
