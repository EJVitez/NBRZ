// Synthesized instruments. Every voice takes (ctx, out, time, ...) so it can play live or
// render into an OfflineAudioContext.

const noiseCache = new WeakMap();
function noise(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx, t, peak, attack, decay, out) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

export function kick(ctx, out, t, vel = 1) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(env(ctx, t, 1.1 * vel, 0.002, 0.5, out));
  o.start(t); o.stop(t + 0.6);
  const c = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
  c.connect(f).connect(env(ctx, t, 0.25 * vel, 0.001, 0.012, out));
  c.start(t); c.stop(t + 0.03);
}

export function snare(ctx, out, t, vel = 1) {
  const n = noise(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
  n.connect(bp).connect(env(ctx, t, 0.6 * vel, 0.001, 0.2, out));
  n.start(t); n.stop(t + 0.25);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
  o.connect(env(ctx, t, 0.45 * vel, 0.001, 0.1, out));
  o.start(t); o.stop(t + 0.15);
}

export function hat(ctx, out, t, vel = 1, open = false) {
  const n = noise(ctx);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.8;
  const len = open ? 0.28 : 0.045;
  n.connect(hp).connect(bp).connect(env(ctx, t, 0.38 * vel, 0.001, len, out));
  n.start(t); n.stop(t + len + 0.05);
}

export function clap(ctx, out, t, vel = 1) {
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
  bp.connect(out);
  [0, 0.011, 0.023].forEach((dt, i) => {
    const n = noise(ctx);
    n.connect(env(ctx, t + dt, (i === 2 ? 0.7 : 0.45) * vel, 0.001, i === 2 ? 0.16 : 0.02, bp));
    n.start(t + dt); n.stop(t + dt + 0.2);
  });
}

export const DRUMS = { kick, snare, hat, clap, openhat: (c, o, t, v) => hat(c, o, t, v, true) };

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

let shaperCurve = null;
function saturator(ctx, amount = 2.5) {
  const ws = ctx.createWaveShaper();
  if (!shaperCurve) {
    shaperCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; shaperCurve[i] = Math.tanh(x * amount); }
  }
  ws.curve = shaperCurve;
  return ws;
}

// Melodic voices. `midi` is a MIDI note number, `dur` seconds.
export const SYNTHS = {
  keys(ctx, out, t, midi, dur, vel = 1) {
    const f = mtof(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.5;
    const g = env(ctx, t, 0.22 * vel, 0.005, Math.max(0.4, dur * 2.2), out);
    lp.connect(g);
    [[0, 'triangle'], [7, 'sine'], [-6, 'triangle']].forEach(([det, type]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur * 2.4 + 0.5);
    });
  },
  pluck(ctx, out, t, midi, dur, vel = 1) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    o.connect(lp).connect(env(ctx, t, 0.18 * vel, 0.002, 0.35, out));
    o.start(t); o.stop(t + 0.5);
  },
  pad(ctx, out, t, midi, dur, vel = 1) {
    const g = ctx.createGain();
    const len = Math.max(dur, 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.3);
    g.gain.setValueAtTime(0.09 * vel, t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.8);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600;
    lp.connect(g).connect(out);
    [-12, 0, 9].forEach((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + len + 1);
    });
  },
  bass(ctx, out, t, midi, dur, vel = 1) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = mtof(midi - 12);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const sat = saturator(ctx);
    const g = ctx.createGain();
    const len = Math.max(dur, 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * vel, t + 0.005);
    g.gain.setValueAtTime(0.55 * vel, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.25);
    o.connect(sat).connect(g).connect(out);
    o.start(t); o.stop(t + len + 0.3);
  },
  lead(ctx, out, t, midi, dur, vel = 1) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi + 12);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(o.detune);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    o.connect(lp).connect(env(ctx, t, 0.1 * vel, 0.01, Math.max(0.3, dur * 1.5), out));
    o.start(t); lfo.start(t); o.stop(t + dur * 1.6 + 0.4); lfo.stop(t + dur * 1.6 + 0.4);
  },
};

// Play a slice of an AudioBuffer (song chops).
export function playSlice(ctx, out, t, buffer, offset, dur, rate = 1, vel = 1) {
  if (!buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  const len = dur / rate;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.setValueAtTime(vel, t + len - 0.01);
  g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(g).connect(out);
  src.start(t, Math.max(0, offset), dur + 0.02);
  return src;
}

// ── Scales ───────────────────────────────────────────────────
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };

export function scaleNote(root, scale, degree, octave = 4) {
  const s = SCALES[scale] || SCALES.minor;
  const oct = Math.floor(degree / s.length);
  const d = ((degree % s.length) + s.length) % s.length;
  return 12 * (octave + 1) + root + s[d] + 12 * oct;
}
