// Sound and music, synthesised live with Web Audio. Nothing is downloaded.
// No AudioContext exists until enable() is called from a user gesture.

const PIECE_WEIGHT = [0, 0.35, 0.55, 0.55, 0.75, 1.0, 0.9]; // by piece type 1..6 (pawn..king)

// Chord progressions per mode, as MIDI root plus intervals. Classic is calm major, Fog is Dorian and suspended,
// Simultaneous is minor with a pulse underneath.
const MODES = {
  classic: { tempo: 64, chords: [[48, [0, 4, 7, 11]], [45, [0, 3, 7, 10]], [41, [0, 4, 7, 14]], [43, [0, 5, 7, 10]], [48, [0, 4, 7, 9]], [40, [0, 3, 7, 10]]], scale: [0, 2, 4, 7, 9, 11], bright: 1800 },
  fog: { tempo: 58, chords: [[50, [0, 3, 7, 9]], [48, [0, 5, 7, 14]], [53, [0, 4, 7, 11]], [50, [0, 5, 7, 10]], [45, [0, 3, 7, 10]]], scale: [0, 2, 3, 5, 7, 9], bright: 1300 },
  simul: { tempo: 72, chords: [[45, [0, 3, 7, 10]], [41, [0, 4, 7, 11]], [43, [0, 4, 7]], [40, [0, 3, 7, 10]], [45, [0, 3, 7, 14]]], scale: [0, 2, 3, 5, 7, 8], bright: 1500 },
};
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

export function createAudio(Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null) {
  let ctx = null, master, musicBus, sfxBus, musicFilter, verb, noiseBuf;
  let settings = { music: 60, sfx: 80, musicMuted: false, sfxMuted: false, soundEnabled: false };
  let mode = 'classic', intensity = 0, musicOn = false, nextBar = 0, chordIx = 0, schedTimer = null, tickTimer = null;
  const rnd = Math.random;

  function build(c) {
    ctx = c;
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.knee.value = 10; master.ratio.value = 4; master.attack.value = 0.004; master.release.value = 0.2;
    const out = ctx.createGain(); out.gain.value = 0.9; master.connect(out); out.connect(ctx.destination);
    musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 1600; musicFilter.Q.value = 0.4;
    musicBus.connect(musicFilter); musicFilter.connect(master); sfxBus.connect(master);
    // A small feedback-delay room so the piano and chimes have some air.
    verb = ctx.createGain(); verb.gain.value = 0.22;
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), fb = ctx.createGain(), damp = ctx.createBiquadFilter();
    d1.delayTime.value = 0.113; d2.delayTime.value = 0.171; fb.gain.value = 0.42; damp.type = 'lowpass'; damp.frequency.value = 2400;
    verb.connect(d1); d1.connect(d2); d2.connect(damp); damp.connect(fb); fb.connect(d1); damp.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = rnd() * 2 - 1;
    applyVolumes();
  }

  function applyVolumes() {
    if (!ctx) return;
    const on = settings.soundEnabled;
    const mv = on && !settings.musicMuted ? (settings.music / 100) ** 1.6 * 0.5 : 0;
    const sv = on && !settings.sfxMuted ? (settings.sfx / 100) ** 1.4 : 0;
    const t = ctx.currentTime;
    musicBus.gain.setTargetAtTime(mv, t, 0.08);
    sfxBus.gain.setTargetAtTime(sv, t, 0.03);
  }

  // ---------- building blocks ----------
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function noise(t, dur, { type = 'bandpass', freq = 1200, q = 1, peak = 0.5, a = 0.002, bus = sfxBus, send = 0 } = {}) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + rnd() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t, a, peak, dur);
    s.connect(f); f.connect(g); g.connect(bus); if (send) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(verb); }
    s.start(t, rnd() * 1.5); s.stop(t + a + dur + 0.05);
    return f;
  }
  function tone(t, freq, dur, { type = 'sine', peak = 0.3, a = 0.004, bus = sfxBus, send = 0, detune = 0 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const g = ctx.createGain(); env(g, t, a, peak, dur);
    o.connect(g); g.connect(bus); if (send) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(verb); }
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  // ---------- effects ----------
  const SFX = {
    // Wooden clack: a short filtered click plus a resonant body; heavier pieces sound lower and fuller.
    move({ piece = 1, t = ctx.currentTime } = {}) {
      const w = PIECE_WEIGHT[piece & 7] || 0.5;
      noise(t, 0.035, { freq: 2600 - w * 1100, q: 2.2, peak: 0.45 + w * 0.2 });
      tone(t, 190 - w * 70 + rnd() * 12, 0.09 + w * 0.06, { type: 'triangle', peak: 0.22 + w * 0.12, a: 0.002 });
      tone(t, 520 - w * 160, 0.05, { peak: 0.08, a: 0.001 });
    },
    capture({ piece = 1, t = ctx.currentTime } = {}) {
      SFX.move({ piece, t });
      noise(t + 0.02, 0.12, { freq: 700, q: 1.2, peak: 0.5 });
      tone(t + 0.01, 110, 0.18, { type: 'triangle', peak: 0.3 });
      // The small tumble as it rolls off.
      for (let i = 0; i < 3; i++) noise(t + 0.2 + i * (0.09 - i * 0.02), 0.03, { freq: 1500 + rnd() * 800, q: 3, peak: 0.22 - i * 0.05 });
    },
    // A captured piece settling in the tray: a soft felt thump with a little wood.
    land({ t = ctx.currentTime } = {}) {
      noise(t, 0.07, { freq: 800, q: 1.4, peak: 0.34 });
      tone(t, 150 + rnd() * 20, 0.08, { type: 'triangle', peak: 0.14, a: 0.002 });
    },
    check({ t = ctx.currentTime } = {}) {
      for (const [m, p] of [[57, 0.16], [64, 0.1], [69, 0.06]]) tone(t, hz(m), 1.6, { peak: p, a: 0.006, send: 0.5 });
      tone(t, hz(57) * 2.76, 0.6, { peak: 0.03, send: 0.4 });
    },
    mate({ t = ctx.currentTime, win = true } = {}) {
      const notes = win ? [48, 55, 60, 64, 67, 72] : [45, 52, 57, 60, 64, 69];
      notes.forEach((m, i) => tone(t + i * 0.07, hz(m), 2.6 - i * 0.2, { type: i < 2 ? 'triangle' : 'sine', peak: 0.12, a: 0.01, send: 0.6 }));
    },
    promote({ t = ctx.currentTime } = {}) { [72, 76, 79, 84].forEach((m, i) => tone(t + i * 0.06, hz(m), 0.5, { peak: 0.08, send: 0.5 })); },
    wind({ t = ctx.currentTime, dur = 1.6 } = {}) {
      const f = noise(t, dur, { type: 'bandpass', freq: 420, q: 0.8, peak: 0.28, a: dur * 0.35, send: 0.3 });
      f.frequency.setValueAtTime(320, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(380, t + dur);
    },
    // Clock tick: a small woody click, kept soft and below the harsh top end.
    tick({ t = ctx.currentTime } = {}) { noise(t, 0.022, { freq: 2000, q: 2.2, peak: 0.32 }); tone(t, 1320, 0.035, { peak: 0.08 }); },
    clash({ t = ctx.currentTime } = {}) {
      noise(t, 0.2, { freq: 3000, q: 0.9, peak: 0.45 });
      for (const f of [523, 1117, 1693, 2471]) tone(t, f * (0.98 + rnd() * 0.04), 0.7, { type: 'sine', peak: 0.06, a: 0.001, send: 0.45 });
      tone(t, 80, 0.25, { type: 'triangle', peak: 0.3 });
    },
    ui({ t = ctx.currentTime } = {}) { tone(t, 880, 0.06, { peak: 0.05 }); },
  };

  // ---------- music ----------
  function pianoNote(t, m, vel, len) {
    const f = hz(m);
    tone(t, f, len, { type: 'triangle', peak: 0.1 * vel, a: 0.006, bus: musicBus, send: 0.55 });
    tone(t, f * 2, len * 0.5, { type: 'sine', peak: 0.03 * vel, a: 0.004, bus: musicBus, send: 0.4 });
  }
  function stringPad(t, notes, len, level) {
    for (const m of notes) for (const d of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = d;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.018 * level, t + len * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + len * 1.05);
      o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + len * 1.1);
    }
  }
  function scheduleBar(t) {
    const M = MODES[mode] || MODES.classic;
    const beat = 60 / (M.tempo + intensity * 10), bar = beat * 4;
    // Wander through the progression, sometimes skipping, so phrases do not repeat exactly.
    chordIx = (chordIx + (rnd() < 0.7 ? 1 : 2)) % M.chords.length;
    const [root, iv] = M.chords[chordIx];
    stringPad(t, [root - 12, root + iv[1], root + iv[2]], bar, 0.8 + intensity * 0.6);
    // Piano: a gentle broken chord with occasional melody notes from the mode's scale.
    const voicing = iv.map((x) => root + 12 + x);
    const steps = rnd() < 0.5 ? [0, 1.5, 2, 3] : [0, 1, 2.5, 3.5];
    steps.forEach((s, i) => { if (rnd() < 0.85) pianoNote(t + s * beat + rnd() * 0.02, voicing[i % voicing.length] + (rnd() < 0.2 ? 12 : 0), 0.6 + rnd() * 0.3, beat * 2.5); });
    if (rnd() < 0.55) { const deg = M.scale[Math.floor(rnd() * M.scale.length)]; pianoNote(t + (2 + Math.floor(rnd() * 2)) * beat, root + 24 + deg, 0.55, beat * 2); }
    // As the game gets close: a soft low pulse and a brighter filter.
    if (mode === 'simul' || intensity > 0.35) for (let b = 0; b < 4; b++) tone(t + b * beat, hz(root - 12), beat * 0.5, { type: 'triangle', peak: 0.05 * (0.4 + intensity), bus: musicBus });
    // Near the end: a quiet high eighth-note ostinato above the chord adds urgency without getting louder overall.
    if (intensity > 0.5) {
      const hi = [0, 2, 1, 2, 0, 2, 1, 3].map((k) => root + 24 + iv[k % iv.length]);
      hi.forEach((m, k) => pianoNote(t + k * beat * 0.5, m, 0.25 + intensity * 0.2, beat * 0.6));
    }
    musicFilter.frequency.setTargetAtTime(M.bright + intensity * 1600, t, 0.4);
    return bar;
  }
  function pump() {
    if (!ctx || !musicOn) return;
    while (nextBar < ctx.currentTime + 1.2) nextBar += scheduleBar(Math.max(nextBar, ctx.currentTime + 0.05));
  }

  return {
    get context() { return ctx; },
    get started() { return !!ctx; },
    // Call only from a user gesture. Creates the context on first use.
    enable() {
      if (!ctx) { if (!Ctor) return false; build(new Ctor()); }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      applyVolumes();
      return true;
    },
    // For tests: render into a supplied (Offline)AudioContext.
    attach(c) { build(c); return this; },
    setSettings(s) { settings = { ...settings, ...s }; applyVolumes(); if (ctx) this.music(musicOn); },
    setMode(m) { if (MODES[m]) mode = m; },
    setIntensity(x) { intensity = Math.max(0, Math.min(1, x)); },
    play(name, opts = {}) { if (!ctx || !settings.soundEnabled || settings.sfxMuted || !SFX[name]) return; SFX[name](opts); },
    music(on) {
      musicOn = !!on && !!ctx && settings.soundEnabled && !settings.musicMuted;
      if (musicOn) {
        if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.1;
        pump();
        if (!schedTimer && typeof setInterval !== 'undefined' && !(ctx instanceof (globalThis.OfflineAudioContext || function () {}))) schedTimer = setInterval(pump, 400);
      } else if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
    },
    // Tense tick while choosing in Simultaneous.
    ticking(on) {
      on = !!on && !!ctx;
      if (on && !tickTimer) tickTimer = setInterval(() => this.play('tick'), 1000);
      else if (!on && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    },
    // Test hook: schedule some bars of music into an offline context from time t.
    renderMusic(t0, bars) { let t = t0; for (let i = 0; i < bars; i++) t += scheduleBar(t); return t; },
    sfxNames: Object.keys(SFX),
  };
}
