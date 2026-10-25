// Sound mode: shapes become instruments.
// The Orbit Sequencer is a ring on the floor with a sweep arm that goes round once per bar.
// Any shape inside the ring plays when the arm passes it: angle = timing (16 steps),
// height = pitch, shape = sound, size = loudness. Move a shape and the beat changes.
import * as THREE from 'three';
import { DRUMS, SYNTHS, scaleNote } from './instruments.js';

const R = 0.6;
const AUTO = { cube: 'kick', cylinder: 'snare', prism: 'snare', cone: 'hat', pyramid: 'hat', torus: 'clap' };

export class SoundSpace {
  constructor(viewport, engine, sequencer, deck) {
    this.vp = viewport;
    this.engine = engine;
    this.seq = sequencer;
    this.deck = deck;
    this.reactive = true;
    this.flashing = new Map(); // material → { color, intensity, t }
    this.#buildRing();
    engine.onStep((s, t) => this.playStep(engine.graph, s, t, true));
    viewport.onFrame((dt) => this.#frame(dt));
  }

  #buildRing() {
    const g = this.ring = new THREE.Group();
    g.name = 'orbit-sequencer';
    const mat = new THREE.MeshBasicMaterial({ color: 0x44d4e8, transparent: true, opacity: 0.5 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R, 0.004, 8, 128), mat);
    torus.rotation.x = Math.PI / 2;
    g.add(torus);
    for (let s = 0; s < 16; s++) {
      const a = (s / 16) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(s % 4 === 0 ? 0.05 : 0.025, 0.003, 0.006), mat);
      tick.position.set(Math.sin(a) * R, 0.002, -Math.cos(a) * R);
      tick.rotation.y = -a + Math.PI / 2;
      g.add(tick);
    }
    const armMat = new THREE.MeshBasicMaterial({ color: 0x8ef0a4, transparent: true, opacity: 0.85 });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, R), armMat);
    this.arm.geometry.translate(0, 0.003, -R / 2);
    g.add(this.arm);
    this.glow = new THREE.PointLight(0x44d4e8, 0, 3);
    this.glow.position.set(0, 0.4, 0);
    g.add(this.glow);
    g.traverse((o) => { o.userData.noPick = true; });
    g.visible = false;
    this.vp.world.add(g);
  }

  show(on) { this.ring.visible = on; }

  voiceFor(obj) {
    const s = obj.userData.sound || 'auto';
    if (s !== 'auto') return s;
    return AUTO[obj.userData.kind] || 'synth';
  }

  // Step index, pitch degree and velocity for an object, or null if outside the ring.
  placement(obj) {
    const p = obj.position;
    const d = Math.hypot(p.x, p.z);
    if (d < 0.05 || d > R * 1.25) return null;
    let a = Math.atan2(p.x, -p.z);
    if (a < 0) a += Math.PI * 2;
    const step = Math.round((a / (Math.PI * 2)) * 16) % 16;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const dim = Math.max(size.x, size.y, size.z);
    const degree = Math.max(0, Math.min(13, Math.floor(p.y / 0.07)));
    return { step, degree, vel: 0.45 + Math.min(1, dim / 0.5) * 0.55 };
  }

  playStep(graph, s, t, live = false) {
    for (const obj of this.vp.content.children) {
      if (!obj.visible) continue;
      const voice = this.voiceFor(obj);
      if (voice === 'none') continue;
      const pl = this.placement(obj);
      if (!pl || pl.step !== s) continue;
      this.play(graph, voice, pl, t);
      if (live) setTimeout(() => this.flash(obj), Math.max(0, (t - this.engine.now) * 1000));
    }
  }

  play(graph, voice, { degree, vel }, t) {
    const ctx = graph.ctx;
    if (DRUMS[voice]) DRUMS[voice](ctx, graph.buses[voice], t, vel);
    else if (voice === 'chop') this.seq.playChop(graph, degree % 16, t, vel);
    else {
      const preset = this.seq.synth === 'bass' ? 'keys' : this.seq.synth;
      SYNTHS[preset](ctx, graph.buses.synth, t, scaleNote(this.seq.root, this.seq.scale, degree, 3), 0.35, vel);
    }
  }

  // Play an object right now (VR hits, clicks).
  trigger(obj, vel = 1) {
    this.engine.ensure();
    const voice = this.voiceFor(obj);
    if (voice === 'none') return;
    const pl = this.placement(obj) || { degree: Math.max(0, Math.min(13, Math.floor(obj.position.y / 0.07))), vel: 1 };
    this.play(this.engine.graph, voice, { ...pl, vel: pl.vel * vel }, this.engine.now);
    this.flash(obj);
  }

  flash(obj) {
    obj.traverse((m) => {
      if (!m.isMesh) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
        if (!mat.emissive) return;
        const prev = this.flashing.get(mat);
        this.flashing.set(mat, { color: prev?.color || mat.emissive.clone(), intensity: prev?.intensity ?? mat.emissiveIntensity, t: 1 });
      });
    });
  }

  #frame(dt) {
    const phase = this.engine.barPhase();
    if (phase !== null) this.arm.rotation.y = -phase * Math.PI * 2;
    for (const [mat, f] of this.flashing) {
      f.t -= dt * 5;
      if (f.t <= 0) {
        mat.emissive.copy(f.color);
        mat.emissiveIntensity = f.intensity;
        this.flashing.delete(mat);
      } else {
        mat.emissive.copy(f.color).lerp(new THREE.Color(0xffffff), f.t * 0.7);
        mat.emissiveIntensity = f.intensity + f.t * 1.2;
      }
    }
    const [low, mid] = this.reactive ? this.engine.bands() : [0, 0];
    this.glow.intensity = low * low * 6;
    this.vp.grid.material.opacity = 0.55 + mid * 0.45;
  }

  // A starter beat built from shapes, in prompt "parts" format.
  starterParts() {
    const at = (step, r = R * 0.8) => { const a = (step / 16) * Math.PI * 2; return [Math.sin(a) * r, Math.cos(a) * -r]; };
    const parts = [];
    const add = (shape, step, y, s, color, r) => { const [x, z] = at(step, r); parts.push({ shape, position: [x, y, z], scale: [s, s, s], rotation: [0, 0, 0], color, finish: 'gloss', name: `${shape} @${step + 1}` }); };
    [0, 7, 10].forEach((s) => add('cube', s, 0.06, 0.4, '#8EF0A4', R * 0.85));
    [4, 12].forEach((s) => add('cylinder', s, 0.06, 0.4, '#f0f0f0', R * 0.85));
    [0, 2, 4, 6, 8, 10, 12, 14].forEach((s) => add('cone', s, 0.04, 0.25, '#44D4E8', R * 0.6));
    add('torus', 12, 0.05, 0.35, '#ffb347', R * 0.45);
    [[0, 0.28], [3, 0.42], [8, 0.21], [11, 0.35]].forEach(([s, y]) => add('sphere', s, y, 0.3, '#2B9EFF', R * 1.05));
    return { name: 'Starter beat', parts, loose: true };
  }
}
