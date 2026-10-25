// NBRZ Pocket — the phone as an instrument.
//   Flow field    every finger is a voice: left↔right = notes in key, up = brighter, wiggle = vibrato
//   Thumb pads    kick · snare · hat · clap (with haptics)
//   Tilt          forward/back sweeps a filter over everything, sideways throws echo
//   Shake         drum fill
//   Loop          records one bar of what you play and loops it; press again to layer
//   Rec           records the jam and lets you share or save it
import { AudioEngine } from '../js/audio/engine.js';
import { Sequencer } from '../js/audio/sequencer.js';
import { DRUMS, SYNTHS, MonoVoice, NOTE_NAMES, scaleNote } from '../js/audio/instruments.js';

const $ = (s) => document.querySelector(s);
const engine = new AudioEngine();
const seqHost = document.createElement('div');
const seq = new Sequencer(engine, seqHost);
engine.onStep((s, t) => seq.playStep(engine.graph, s, t));

const DEGREES = 14;
const flow = $('#flow'), canvas = $('#canvas'), g = canvas.getContext('2d');

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const buzz = (ms) => navigator.vibrate?.(ms);

// ── Beat ────────────────────────────────────────────────────
function applyStyle(name) {
  const s = seq.applyStyle(name);
  if (s?.bpm) engine.setBpm(s.bpm);
  if (s?.swing !== undefined) engine.swing = s.swing;
  $('#bpm').textContent = engine.bpm;
}
applyStyle('nbrz');
$('#style').addEventListener('change', (e) => applyStyle(e.target.value));

let wakeLock = null;
async function togglePlay() {
  engine.ensure();
  if (engine.playing) engine.stop(); else engine.start();
  $('#play').textContent = engine.playing ? '■' : '▶';
  $('#play').classList.toggle('on', engine.playing);
  try {
    if (engine.playing) wakeLock = await navigator.wakeLock?.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* wake lock is optional */ }
}
$('#play').addEventListener('click', togglePlay);

// ── Loop recorder (event looper, bar-locked) ───────────────
const layers = [];
let recording = null;
const absStep = () => (engine.playing ? engine.step - (engine.nextTime - engine.now) / engine.stepDur : 0);

function record(kind, value, vel = 1) {
  if (!recording) return;
  const abs = absStep();
  if (abs < recording.start) return;
  recording.events.push({ pos: ((abs % 16) + 16) % 16, kind, value, vel });
}

$('#loop').addEventListener('click', () => {
  engine.ensure();
  if (!engine.playing) togglePlay();
  if (recording) return;
  // Start at the next bar line so loops stay in time.
  const start = Math.ceil(absStep() / 16) * 16;
  recording = { start, end: start + 16, events: [] };
  $('#loop').classList.add('on');
  toast('Loop starts on the next bar — play!');
});
$('#clear').addEventListener('click', () => { layers.length = 0; recording = null; $('#loop').classList.remove('on'); updateLoopLabel(); toast('Loops cleared'); });

function updateLoopLabel() {
  let txt = layers.length ? `${layers.length} loop${layers.length > 1 ? 's' : ''}` : '';
  if (recording && engine.playing) {
    const abs = absStep();
    txt = abs < recording.start ? `loop in ${Math.ceil((recording.start - abs) / 4)}` : `● rec ${Math.min(16, Math.floor(abs - recording.start) + 1)}/16`;
  }
  $('#loop-label').textContent = txt;
}

engine.onStep((s, t) => {
  for (const layer of layers) {
    for (const ev of layer) {
      if (Math.floor(ev.pos) !== s) continue;
      const when = t + (ev.pos - s) * engine.stepDur;
      if (ev.kind === 'pad') DRUMS[ev.value](engine.ctx, engine.graph.buses[ev.value], when, ev.vel);
      else SYNTHS.pluck(engine.ctx, engine.graph.buses.synth, when, scaleNote(seq.root, seq.scale, ev.value, 4), 0.3, ev.vel * 0.9);
    }
  }
  if (recording && engine.step >= recording.end) {
    if (recording.events.length) { layers.push(recording.events); buzz(30); toast(`Loop ${layers.length} locked in`); }
    recording = null;
    setTimeout(() => $('#loop').classList.remove('on'), 0);
  }
});

// ── Thumb pads ─────────────────────────────────────────────
const flashes = [];
document.querySelectorAll('[data-pad]').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    engine.ensure();
    const v = b.dataset.pad;
    DRUMS[v](engine.ctx, engine.graph.buses[v], engine.now, 1);
    record('pad', v);
    buzz(12);
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 110);
    flashes.push({ t: 1, color: v === 'kick' ? '#8EF0A4' : v === 'snare' ? '#f0f0f0' : v === 'hat' ? '#44D4E8' : '#ffb347' });
  });
});

// ── Flow field: multi-touch voices ─────────────────────────
const touches = new Map();
const pool = [];
let waveType = 'sawtooth';
$('#sound').addEventListener('change', (e) => { waveType = e.target.value; pool.forEach((v) => v.dispose()); pool.length = 0; });

function voiceFor() {
  let v = pool.find((x) => !x.on);
  if (!v && pool.length < 5) { v = new MonoVoice(engine.ctx, engine.graph.buses.air, { type: waveType, level: 0.16 }); pool.push(v); }
  return v || pool[0];
}

function touchParams(e) {
  const r = flow.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  return { x, y, degree: Math.max(0, Math.min(DEGREES - 1, Math.floor(x * DEGREES))), bright: 1 - y };
}

flow.addEventListener('pointerdown', (e) => {
  engine.ensure();
  flow.classList.add('touched');
  flow.setPointerCapture(e.pointerId);
  const p = touchParams(e);
  const voice = voiceFor();
  voice.set(scaleNote(seq.root, seq.scale, p.degree, 4), { glide: 0.001, brightness: p.bright, vibrato: 0 });
  voice.start();
  touches.set(e.pointerId, { voice, degree: p.degree, trail: [{ x: p.x, y: p.y, t: performance.now() }], lx: e.clientX, ly: e.clientY, lt: performance.now() });
  record('note', p.degree, 0.6 + p.bright * 0.4);
});

flow.addEventListener('pointermove', (e) => {
  const tch = touches.get(e.pointerId);
  if (!tch) return;
  const p = touchParams(e);
  const now = performance.now();
  const speed = Math.hypot(e.clientX - tch.lx, e.clientY - tch.ly) / Math.max(1, now - tch.lt); // px per ms
  tch.lx = e.clientX; tch.ly = e.clientY; tch.lt = now;
  tch.voice.set(scaleNote(seq.root, seq.scale, p.degree, 4), { glide: 0.05, brightness: p.bright, vibrato: Math.min(1, speed * 0.6) });
  if (p.degree !== tch.degree) { tch.degree = p.degree; record('note', p.degree, 0.6 + p.bright * 0.4); }
  tch.trail.push({ x: p.x, y: p.y, t: now });
  if (tch.trail.length > 60) tch.trail.shift();
});

function release(e) {
  const tch = touches.get(e.pointerId);
  if (!tch) return;
  tch.voice.stop();
  fading.push({ trail: tch.trail, t: 1 });
  touches.delete(e.pointerId);
}
flow.addEventListener('pointerup', release);
flow.addEventListener('pointercancel', release);
const fading = [];

// ── Tilt + shake ───────────────────────────────────────────
let motionOn = false, base = null, lastShake = 0;
$('#motion').addEventListener('click', async () => {
  engine.ensure();
  if (motionOn) {
    motionOn = false;
    engine.graph.setFx({ brightness: 1, echo: 0 });
    $('#motion').classList.remove('on');
    $('#tilt-label').textContent = 'Tilt off';
    return;
  }
  try {
    // iOS asks for permission; Android just works over HTTPS.
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') throw new Error('permission denied');
      await DeviceMotionEvent.requestPermission?.();
    }
    motionOn = true;
    base = null;
    $('#motion').classList.add('on');
    toast('Tilt forward/back = filter · sideways = echo · shake = drum fill');
  } catch (err) { toast(`Motion sensors unavailable: ${err.message}`); }
});

window.addEventListener('deviceorientation', (e) => {
  if (!motionOn || e.beta === null) return;
  if (!base) base = { beta: e.beta, gamma: e.gamma };
  const bright = Math.max(0.05, Math.min(1, 0.9 + (e.beta - base.beta) / 55));
  const echo = Math.max(0, Math.min(1, (Math.abs(e.gamma - base.gamma) - 6) / 35));
  engine.graph.setFx({ brightness: bright, echo });
  $('#tilt-label').textContent = `Filter ${Math.round(bright * 100)}% · Echo ${Math.round(echo * 100)}%`;
});

window.addEventListener('devicemotion', (e) => {
  if (!motionOn) return;
  const a = e.acceleration;
  if (!a || a.x === null) return;
  const mag = Math.hypot(a.x, a.y, a.z);
  const now = performance.now();
  if (mag > 16 && now - lastShake > 900) {
    lastShake = now;
    drumFill(Math.min(1, mag / 30));
  }
});

function drumFill(intensity) {
  const ctx = engine.ensure(), t0 = engine.now + 0.02, d = engine.stepDur / 2;
  for (let i = 0; i < 8; i++) DRUMS.snare(ctx, engine.graph.buses.snare, t0 + i * d, (0.35 + i / 10) * intensity);
  DRUMS.openhat(ctx, engine.graph.buses.hat, t0 + 8 * d, intensity);
  DRUMS.kick(ctx, engine.graph.buses.kick, t0 + 8 * d, 1);
  buzz([20, 30, 20, 30, 60]);
  flashes.push({ t: 1.4, color: '#ff4d6d' });
}

// ── Record & share ─────────────────────────────────────────
$('#rec').addEventListener('click', async () => {
  const b = $('#rec');
  engine.ensure();
  if (!b.classList.contains('on')) {
    engine.startRecording();
    b.classList.add('on');
    b.textContent = '■ Stop';
    return;
  }
  b.classList.remove('on');
  b.textContent = '● Rec';
  const blob = await engine.stopRecording();
  if (!blob) return;
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `nbrz-pocket-${Date.now()}.${ext}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'NBRZ Pocket jam' }); return; } catch { /* fall back to download */ }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  toast('Jam saved');
});

// ── Drawing ────────────────────────────────────────────────
function draw() {
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.clientHeight * devicePixelRatio;
  const [low, mid] = engine.bands();
  g.clearRect(0, 0, w, h);
  // Note columns
  for (let i = 0; i < DEGREES; i++) {
    const x = (i / DEGREES) * w;
    const tonic = i % 7 === 0;
    g.fillStyle = tonic ? `rgba(142,240,164,${0.06 + low * 0.1})` : 'rgba(68,212,232,0.025)';
    g.fillRect(x, 0, w / DEGREES - 1, h);
    g.fillStyle = tonic ? 'rgba(142,240,164,.7)' : 'rgba(255,255,255,.28)';
    g.font = `${11 * devicePixelRatio}px "Barlow Condensed", sans-serif`;
    g.fillText(NOTE_NAMES[scaleNote(seq.root, seq.scale, i, 4) % 12], x + 4 * devicePixelRatio, h - 8 * devicePixelRatio);
  }
  // Pad / fill flashes
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t -= 0.06;
    if (f.t <= 0) { flashes.splice(i, 1); continue; }
    const grad = g.createRadialGradient(w / 2, h, 0, w / 2, h, h * (1.3 - f.t * 0.3));
    grad.addColorStop(0, f.color + '55');
    grad.addColorStop(1, 'transparent');
    g.globalAlpha = Math.min(1, f.t);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  // Trails
  const drawTrail = (trail, alpha) => {
    if (!trail.length) return;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#8EF0A4'); grad.addColorStop(0.5, '#44D4E8'); grad.addColorStop(1, '#2B9EFF');
    g.strokeStyle = grad;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.globalAlpha = alpha;
    g.lineWidth = (6 + mid * 18) * devicePixelRatio;
    g.shadowColor = '#44D4E8'; g.shadowBlur = 18 * devicePixelRatio;
    g.beginPath();
    trail.forEach((p, i) => (i ? g.lineTo(p.x * w, p.y * h) : g.moveTo(p.x * w, p.y * h)));
    g.stroke();
    const last = trail[trail.length - 1];
    g.beginPath(); g.arc(last.x * w, last.y * h, (14 + low * 20) * devicePixelRatio, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    g.shadowBlur = 0; g.globalAlpha = 1;
  };
  touches.forEach((tch) => drawTrail(tch.trail, 1));
  for (let i = fading.length - 1; i >= 0; i--) {
    fading[i].t -= 0.05;
    if (fading[i].t <= 0) fading.splice(i, 1); else drawTrail(fading[i].trail, fading[i].t * 0.6);
  }
  updateLoopLabel();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

window.pocket = { engine, seq, layers };
