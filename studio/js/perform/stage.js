// The 360° Perform stage: instruments placed all around your body.
//
//   Drum ring    8 pads at waist height in a full circle — turn around to reach them all
//   Light harp   8 vertical strings in front of you — sweep a hand through to pluck
//   Air synth    hold trigger / pinch: hand height = pitch (glowing scale rings show the notes),
//                reach = brightness, shaking your hand = vibrato. One voice per hand.
//   Gesture FX   left grip: raise/lower to sweep the whole mix · right grip: push out to throw echo
//   Nod tempo    bob your head on the beat to set the BPM
//   Capture      while the beat plays, everything you hit is written into the sequencer
//   Dome         a 360° particle sky that breathes with the music
import * as THREE from 'three';
import { DRUMS, SYNTHS, MonoVoice, scaleNote } from '../audio/instruments.js';

const PAD_R = 0.55, PAD_SIZE = 0.11;
const HARP_R = 0.4, HARP_LOW = 1.05, HARP_HIGH = 1.75, HARP_SPAN = THREE.MathUtils.degToRad(70), STRINGS = 8;
const AIR_LOW = 0.8, AIR_HIGH = 1.9, AIR_STEPS = 15;
const PADS = [
  { voice: 'kick', label: 'KICK', color: '#8EF0A4' }, { voice: 'snare', label: 'SNARE', color: '#f0f0f0' },
  { voice: 'hat', label: 'HAT', color: '#44D4E8' }, { voice: 'openhat', label: 'OPEN', color: '#44D4E8' },
  { voice: 'chop', slice: 0, label: 'CHOP 1', color: '#2B9EFF' }, { voice: 'chop', slice: 4, label: 'CHOP 2', color: '#2B9EFF' },
  { voice: 'chop', slice: 8, label: 'CHOP 3', color: '#2B9EFF' }, { voice: 'clap', label: 'CLAP', color: '#ffb347' },
];

function label(text, color = '#e8eef0') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 40px "Barlow Condensed", Arial, sans-serif';
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(0.16, 0.04, 1);
  return s;
}

export class PerformStage extends EventTarget {
  constructor(vp, engine, seq, deck) {
    super();
    this.vp = vp;
    this.engine = engine;
    this.seq = seq;
    this.deck = deck;
    this.capture = false;
    this.nodTempo = false;
    this.voices = new Map();   // hand key → MonoVoice
    this.handState = new Map(); // hand key → { insidePad, angle, ... }
    this.group = new THREE.Group();
    this.group.name = 'perform-stage';
    this.group.visible = false;
    this.#build();
    vp.scene.add(this.group);
    vp.onFrame((dt, t) => this.#animate(dt, t));
    this.nod = { lastY: null, vy: 0, lastPeak: 0, intervals: [] };
  }

  #build() {
    const g = this.group;
    // Drum ring
    this.pads = PADS.map((p, i) => {
      const a = THREE.MathUtils.degToRad(22.5 + i * 45);
      const mat = new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.2 });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(PAD_SIZE, PAD_SIZE * 1.08, 0.03, 40), mat);
      mesh.position.set(Math.sin(a) * PAD_R, 0.95, -Math.cos(a) * PAD_R);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(PAD_SIZE + 0.01, 0.004, 8, 48), new THREE.MeshBasicMaterial({ color: p.color }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.017;
      mesh.add(rim);
      const tag = label(p.label, p.color);
      tag.position.set(0, 0.07, 0);
      mesh.add(tag);
      mesh.userData.pad = i;
      g.add(mesh);
      return { ...p, mesh, mat, flash: 0 };
    });

    // Light harp
    this.strings = [];
    for (let i = 0; i < STRINGS; i++) {
      const a = -HARP_SPAN / 2 + (i / (STRINGS - 1)) * HARP_SPAN;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.36 + i * 0.035, 0.85, 0.65), transparent: true, opacity: 0.55 });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, HARP_HIGH - HARP_LOW, 6), mat);
      mesh.position.set(Math.sin(a) * HARP_R, (HARP_LOW + HARP_HIGH) / 2, -Math.cos(a) * HARP_R);
      // Fat invisible hit box for mouse / touch.
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, HARP_HIGH - HARP_LOW, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.string = i;
      mesh.add(hit);
      g.add(mesh);
      this.strings.push({ angle: a, mesh, mat, hit, flash: 0 });
    }

    // Scale rings: one per air-synth note, so you can see the pitches around you.
    this.rings = [];
    for (let i = 0; i < AIR_STEPS; i++) {
      const y = AIR_LOW + (i + 0.5) * (AIR_HIGH - AIR_LOW) / AIR_STEPS;
      const mat = new THREE.MeshBasicMaterial({ color: i % 7 === 0 ? 0x8ef0a4 : 0x2b9eff, transparent: true, opacity: i % 7 === 0 ? 0.22 : 0.08, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.0025, 6, 96), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
      this.rings.push({ mesh: ring, mat, base: mat.opacity, flash: 0 });
    }

    // Hand glows for the air synth.
    this.glows = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8ef0a4, transparent: true, opacity: 0.8 }));
      m.visible = false;
      g.add(m);
      return m;
    });

    // 360° dome of particles.
    const N = 2400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 5 + Math.random() * 3;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * s * r, Math.abs(u) * r * 0.8 + 0.2, Math.sin(th) * s * r], i * 3);
      c.setHSL(0.38 + Math.random() * 0.22, 0.8, 0.55 + Math.random() * 0.2);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.dome = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    g.add(this.dome);

    g.traverse((o) => { o.userData.noPick = true; });
  }

  // Centre the stage on the player (floor position + facing direction).
  placeAt(position, yaw) {
    this.group.position.set(position.x, 0, position.z);
    this.group.rotation.set(0, yaw, 0);
  }

  show(on, { dome = true } = {}) {
    this.group.visible = on;
    this.dome.visible = dome;
    if (!on) { this.voices.forEach((v) => v.stop()); this.resetFx(); this.glows.forEach((gl) => { gl.visible = false; }); }
  }

  // ── Sound ───────────────────────────────────────────────────
  hitPad(i, vel = 1) {
    const p = this.pads[i];
    if (!p) return;
    const ctx = this.engine.ensure(), graph = this.engine.graph, t = this.engine.now;
    if (p.voice === 'chop') {
      if (this.deck.buffer) this.seq.playChop(graph, p.slice, t, vel);
      else SYNTHS.pluck(ctx, graph.buses.chop, t, scaleNote(this.seq.root, this.seq.scale, p.slice / 2, 4), 0.3, vel);
    } else DRUMS[p.voice](ctx, graph.buses[p.voice === 'openhat' ? 'hat' : p.voice], t, vel);
    p.flash = 1;
    this.captureEvent(p.voice === 'chop' ? { chop: p.slice } : { drum: p.voice });
    this.dispatchEvent(new CustomEvent('hit', { detail: { kind: 'pad', index: i, vel, color: p.color } }));
  }

  pluck(i, vel = 0.9) {
    const s = this.strings[i];
    if (!s) return;
    this.engine.ensure();
    SYNTHS.pluck(this.engine.ctx, this.engine.graph.buses.synth, this.engine.now, scaleNote(this.seq.root, this.seq.scale, i, 4), 0.4, vel);
    s.flash = 1;
    this.captureEvent({ note: i });
    this.dispatchEvent(new CustomEvent('hit', { detail: { kind: 'string', index: i, vel, color: '#8EF0A4' } }));
  }

  airDegree(y) { return THREE.MathUtils.clamp(Math.floor(((y - AIR_LOW) / (AIR_HIGH - AIR_LOW)) * AIR_STEPS), 0, AIR_STEPS - 1); }

  airStart(key, y) {
    const ctx = this.engine.ensure();
    let v = this.voices.get(key);
    if (!v) {
      v = new MonoVoice(ctx, this.engine.graph.buses.air, key === 'left' ? { type: 'triangle', level: 0.2 } : { type: 'sawtooth', level: 0.18 });
      this.voices.set(key, v);
    }
    const d = this.airDegree(y);
    v.lastDegree = d;
    v.set(this.#airMidi(key, d), { glide: 0.001 });
    v.start();
    this.captureEvent({ note: d % 8 });
  }

  // brightness 0..1 from reach, vibrato 0..1 from hand shake.
  airMove(key, y, brightness, vibrato = 0) {
    const v = this.voices.get(key);
    if (!v?.on) return;
    const d = this.airDegree(y);
    v.set(this.#airMidi(key, d), { brightness, vibrato });
    if (d !== v.lastDegree) { this.rings[d].flash = 1; v.lastDegree = d; }
  }

  airEnd(key) { this.voices.get(key)?.stop(); }

  #airMidi(key, d) { return scaleNote(this.seq.root, this.seq.scale, d, key === 'left' ? 3 : 4); }

  setFx(fx) { this.engine.ensure(); this.engine.graph.setFx(fx); }
  resetFx() { this.engine.graph?.setFx({ brightness: 1, echo: 0, resonance: 0 }); }

  // ── Capture: quantize what you play into the step sequencer ─
  captureEvent(ev) {
    if (!this.capture || !this.engine.playing) return;
    const phase = this.engine.barPhase();
    if (phase === null) return;
    const step = Math.round(phase * 16) % 16;
    const p = this.seq.pattern;
    if (ev.drum) p[ev.drum][step] = 1;
    else if (ev.chop !== undefined) p.chop[step] = ev.chop;
    else if (ev.note !== undefined) p.notes[ev.note % 8][step] = 1;
    this.seq.refresh();
  }

  // ── Body input (VR hands / controllers) ────────────────────
  // Call every frame per hand with a world-space point (fingertip or controller) and velocity.
  updateHand(key, worldPos, vel) {
    const local = this.group.worldToLocal(worldPos.clone());
    let st = this.handState.get(key);
    if (!st) { st = { pad: -1, angle: null, inHarp: false }; this.handState.set(key, st); }

    // Pads: strike downward into the pad volume.
    let pad = -1;
    this.pads.forEach((p, i) => {
      const dx = local.x - p.mesh.position.x, dz = local.z - p.mesh.position.z, dy = local.y - p.mesh.position.y;
      if (Math.hypot(dx, dz) < PAD_SIZE + 0.03 && dy < 0.05 && dy > -0.12) pad = i;
    });
    if (pad >= 0 && pad !== st.pad && vel.y < -0.25) {
      this.hitPad(pad, THREE.MathUtils.clamp(Math.abs(vel.y) / 2.2, 0.25, 1));
      this.dispatchEvent(new CustomEvent('haptic', { detail: { key, strength: THREE.MathUtils.clamp(Math.abs(vel.y) / 3, 0.2, 1) } }));
    }
    st.pad = pad;

    // Harp: crossing a string's angle while inside the harp band.
    const r = Math.hypot(local.x, local.z);
    const angle = Math.atan2(local.x, -local.z);
    const inHarp = r > HARP_R - 0.12 && r < HARP_R + 0.12 && local.y > HARP_LOW && local.y < HARP_HIGH;
    if (inHarp && st.inHarp && st.angle !== null) {
      this.strings.forEach((s, i) => {
        if ((st.angle - s.angle) * (angle - s.angle) < 0) {
          this.pluck(i, THREE.MathUtils.clamp(vel.length() / 2, 0.35, 1));
          this.dispatchEvent(new CustomEvent('haptic', { detail: { key, strength: 0.3 } }));
        }
      });
    }
    st.inHarp = inHarp;
    st.angle = angle;
    return local;
  }

  // Air synth driven by a hand: y = pitch, horizontal reach from the head = brightness.
  airHand(key, worldPos, headPos, speed) {
    const local = this.group.worldToLocal(worldPos.clone());
    const head = this.group.worldToLocal(headPos.clone());
    const reach = Math.hypot(local.x - head.x, local.z - head.z);
    this.airMove(key, local.y, THREE.MathUtils.clamp((reach - 0.15) / 0.5, 0, 1), THREE.MathUtils.clamp((speed - 0.4) / 2, 0, 1));
    const glow = this.glows[key === 'left' ? 0 : 1];
    glow.visible = !!this.voices.get(key)?.on;
    glow.position.copy(local);
  }

  // Gesture FX from a gripping hand.
  fxHand(key, worldPos, headPos) {
    const local = this.group.worldToLocal(worldPos.clone());
    if (key === 'left') this.setFx({ brightness: THREE.MathUtils.clamp((local.y - 0.7) / 1.1, 0.05, 1), resonance: THREE.MathUtils.clamp((local.y - 0.7) / 1.1, 0, 1) * 0.6 });
    else {
      const head = this.group.worldToLocal(headPos.clone());
      this.setFx({ echo: THREE.MathUtils.clamp((Math.hypot(local.x - head.x, local.z - head.z) - 0.2) / 0.45, 0, 1) });
    }
  }

  // Head bob → tempo. Detects the bottom of each nod.
  updateHead(worldPos, dt, now) {
    if (!this.nodTempo) return;
    const n = this.nod;
    if (n.lastY !== null) {
      const vy = (worldPos.y - n.lastY) / Math.max(dt, 1e-3);
      if (n.vy < -0.05 && vy >= 0) {           // moving down → turning up = bottom of a nod
        const gap = now - n.lastPeak;
        if (gap > 0.3 && gap < 1.2) {
          n.intervals.push(gap);
          if (n.intervals.length > 6) n.intervals.shift();
          if (n.intervals.length >= 4) {
            const mean = n.intervals.reduce((a, b) => a + b) / n.intervals.length;
            const spread = Math.max(...n.intervals) - Math.min(...n.intervals);
            if (spread < mean * 0.25) this.dispatchEvent(new CustomEvent('tempo', { detail: Math.round(60 / mean) }));
          }
        } else if (gap >= 1.2) n.intervals = [];
        n.lastPeak = now;
      }
      n.vy = vy;
    }
    n.lastY = worldPos.y;
  }

  // ── Desktop / touch: raycast hits ──────────────────────────
  pickPad(raycaster) {
    const hit = raycaster.intersectObjects(this.pads.map((p) => p.mesh), false)[0];
    return hit ? hit.object.userData.pad : -1;
  }

  pickString(raycaster) {
    const hit = raycaster.intersectObjects(this.strings.map((s) => s.hit), false)[0];
    return hit ? hit.object.userData.string : -1;
  }

  #animate(dt, t) {
    if (!this.group.visible) return;
    const [low, mid, high] = this.engine.bands();
    for (const p of this.pads) {
      p.flash = Math.max(0, p.flash - dt * 4);
      p.mat.emissiveIntensity = 0.25 + p.flash * 2.2 + low * 0.3;
      p.mesh.scale.y = 1 - p.flash * 0.4;
    }
    for (const s of this.strings) {
      s.flash = Math.max(0, s.flash - dt * 3);
      s.mat.opacity = 0.45 + s.flash * 0.55;
      s.mesh.scale.x = s.mesh.scale.z = 1 + s.flash * 2.5 + Math.sin(t * 0.06) * s.flash * 0.8;
    }
    for (const r of this.rings) {
      r.flash = Math.max(0, r.flash - dt * 2.5);
      r.mat.opacity = r.base + r.flash * 0.6 + mid * 0.05;
    }
    this.dome.rotation.y += dt * (0.02 + mid * 0.1);
    this.dome.material.size = 0.035 + low * 0.08;
    this.dome.material.opacity = 0.55 + high * 0.45;
  }
}
