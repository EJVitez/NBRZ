// Audio graph, transport clock and recorder.
// buildGraph() works on any BaseAudioContext so the same mix renders live and offline (WAV bounce).

export function makeImpulse(ctx, seconds = 2.4, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export function buildGraph(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  // Performance FX (driven by gestures): a sweepable filter on the mix and an echo "throw".
  const fxFilter = ctx.createBiquadFilter();
  fxFilter.type = 'lowpass'; fxFilter.frequency.value = 20000; fxFilter.Q.value = 0.8;
  master.connect(fxFilter).connect(comp).connect(limiter);
  const throwSend = ctx.createGain();
  throwSend.gain.value = 0;
  const throwDelay = ctx.createDelay(2);
  const throwFb = ctx.createGain();
  throwFb.gain.value = 0.55;
  const throwTone = ctx.createBiquadFilter();
  throwTone.type = 'bandpass'; throwTone.frequency.value = 1800; throwTone.Q.value = 0.6;
  // Output goes straight to the limiter so it can never feed back through the master.
  master.connect(throwSend).connect(throwDelay).connect(throwTone).connect(throwFb).connect(throwDelay);
  throwTone.connect(limiter);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.6;
  reverb.connect(reverbReturn).connect(master);

  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass'; delayTone.frequency.value = 3200;
  delay.connect(delayTone).connect(feedback).connect(delay);
  delayTone.connect(master);

  const bus = (name, verb = 0.1, echo = 0) => {
    const g = ctx.createGain();
    g.connect(master);
    const vs = ctx.createGain(); vs.gain.value = verb; g.connect(vs).connect(reverb);
    const es = ctx.createGain(); es.gain.value = echo; g.connect(es).connect(delay);
    g.sends = { verb: vs, echo: es };
    g.label = name;
    return g;
  };

  return {
    ctx, master, out: limiter, reverb, delay,
    buses: { kick: bus('kick', 0.02), snare: bus('snare', 0.18), hat: bus('hat', 0.06), clap: bus('clap', 0.2),
      synth: bus('synth', 0.25, 0.12), chop: bus('chop', 0.08), deck: bus('deck', 0.15), mic: bus('mic', 0.2), air: bus('air', 0.3, 0.18) },
    setTempo(bpm) { delay.delayTime.value = (60 / bpm) * 0.75; throwDelay.delayTime.value = (60 / bpm) * 0.5; },
    // brightness 0..1 (1 = open), echo 0..1. Smoothed so gestures never click.
    setFx({ brightness, echo, resonance } = {}) {
      const t = ctx.currentTime;
      if (brightness !== undefined) fxFilter.frequency.setTargetAtTime(90 * Math.pow(20000 / 90, Math.max(0, Math.min(1, brightness))), t, 0.03);
      if (resonance !== undefined) fxFilter.Q.setTargetAtTime(0.8 + resonance * 10, t, 0.05);
      if (echo !== undefined) throwSend.gain.setTargetAtTime(Math.max(0, Math.min(1, echo)) * 0.8, t, 0.05);
    },
  };
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.bpm = 92;
    this.swing = 0.08;
    this.playing = false;
    this.step = 0;
    this.stepListeners = new Set();
  }

  // Must be called from a user gesture (browser autoplay rules).
  ensure() {
    if (!this.ctx) {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.graph = buildGraph(ctx);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.7;
      this.graph.out.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.recordDest = ctx.createMediaStreamDestination();
      this.graph.out.connect(this.recordDest);
      this.graph.setTempo(this.bpm);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  get stepDur() { return 60 / this.bpm / 4; }

  setBpm(bpm) {
    this.bpm = Math.max(50, Math.min(200, bpm || 92));
    this.graph?.setTempo(this.bpm);
    this.dispatchEvent(new Event('tempo'));
  }

  onStep(cb) { this.stepListeners.add(cb); }

  start() {
    this.ensure();
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.#schedule(), 25);
    this.dispatchEvent(new Event('state'));
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.dispatchEvent(new Event('state'));
  }

  #schedule() {
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextTime < ahead) {
      const s = this.step % 16;
      const swingOffset = s % 2 === 1 ? this.swing * this.stepDur : 0;
      const t = this.nextTime + swingOffset;
      this.stepListeners.forEach((cb) => cb(s, t));
      // UI callback timed to when the step is actually heard.
      const delayMs = Math.max(0, (t - this.ctx.currentTime) * 1000);
      setTimeout(() => this.dispatchEvent(new CustomEvent('step', { detail: s })), delayMs);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  // Sweep position 0..1 through the bar, for visuals that move continuously.
  barPhase() {
    if (!this.playing || !this.ctx) return null;
    const stepFloat = this.step - (this.nextTime - this.ctx.currentTime) / this.stepDur;
    return ((stepFloat % 16) + 16) % 16 / 16;
  }

  // Low / mid / high energy 0..1 for audio-reactive visuals.
  bands() {
    if (!this.analyser) return [0, 0, 0];
    this.analyser.getByteFrequencyData(this.freq);
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += this.freq[i]; return s / (b - a) / 255; };
    return [avg(1, 8), avg(8, 60), avg(60, 200)];
  }

  // ── Recording what you hear ──────────────────────────────
  startRecording() {
    this.ensure();
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.recordDest.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder) return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
      this.recorder.stop();
    });
  }
}

// 16-bit PCM WAV encoder.
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([out], { type: 'audio/wav' });
}
