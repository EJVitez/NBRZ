// Motion Stage: your webcam becomes an instrument. No body-tracking model or cloud needed:
// the picture is split into zones, and movement in a zone plays it.
//   top two rows  notes in key (high / low)
//   bottom row    kick · snare · hat · clap
//   overall movement opens the filter (move more = brighter mix)
import { DRUMS, SYNTHS, scaleNote } from '../audio/instruments.js';

const COLS = 4, ROWS = 3, W = 64, H = 48;
const DRUM_ROW = ['kick', 'snare', 'hat', 'clap'];

export class MotionStage extends EventTarget {
  constructor(engine, seq, { video, overlay }) {
    super();
    this.engine = engine;
    this.seq = seq;
    this.video = video;
    this.overlay = overlay;
    this.sensitivity = 0.5;
    this.bodyFx = true;
    this.work = document.createElement('canvas');
    this.work.width = W; this.work.height = H;
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.prev = null;
    this.cool = new Float32Array(COLS * ROWS);
    this.level = new Float32Array(COLS * ROWS);
    this.running = false;
  }

  async start(facingMode = 'user') {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.engine.ensure();
    this.last = performance.now();
    const loop = () => { if (!this.running) return; this.#tick(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.prev = null;
    if (this.bodyFx) this.engine.graph?.setFx({ brightness: 1 });
  }

  zoneSound(i) {
    const row = Math.floor(i / COLS), col = i % COLS;
    if (row === ROWS - 1) return { drum: DRUM_ROW[col] };
    return { degree: (row === 0 ? 4 : 0) + col };
  }

  play(i, vel) {
    const z = this.zoneSound(i);
    const g = this.engine.graph, t = this.engine.now, ctx = this.engine.ctx;
    if (z.drum) DRUMS[z.drum](ctx, g.buses[z.drum], t, vel);
    else SYNTHS.pluck(ctx, g.buses.synth, t, scaleNote(this.seq.root, this.seq.scale, z.degree, 4), 0.35, vel);
    this.dispatchEvent(new CustomEvent('hit', { detail: { zone: i, ...z, vel } }));
  }

  #tick() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const g = this.wctx;
    // Mirror so moving your right hand lights the right side, like a mirror.
    g.save(); g.scale(-1, 1); g.drawImage(this.video, -W, 0, W, H); g.restore();
    const px = g.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    if (this.prev) {
      const zone = new Float32Array(COLS * ROWS);
      let total = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = Math.abs(gray[i] - this.prev[i]) > 28 ? 1 : 0;
        zone[Math.floor(y / (H / ROWS)) * COLS + Math.floor(x / (W / COLS))] += d;
        total += d;
      }
      const perZone = (W * H) / (COLS * ROWS);
      const threshold = 0.22 - this.sensitivity * 0.18;
      for (let z = 0; z < zone.length; z++) {
        const amt = zone[z] / perZone;
        this.level[z] = Math.max(amt, this.level[z] * 0.85);
        this.cool[z] = Math.max(0, this.cool[z] - dt);
        if (amt > threshold && this.cool[z] === 0) {
          this.play(z, Math.min(1, 0.4 + amt * 1.5));
          this.cool[z] = 0.22;
        }
      }
      if (this.bodyFx) this.engine.graph.setFx({ brightness: 0.25 + Math.min(0.75, (total / (W * H)) * 6) });
    }
    this.prev = gray;
    this.#draw();
  }

  #draw() {
    const c = this.overlay, g = c.getContext('2d');
    const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio;
    g.clearRect(0, 0, w, h);
    const zw = w / COLS, zh = h / ROWS;
    for (let z = 0; z < COLS * ROWS; z++) {
      const x = (z % COLS) * zw, y = Math.floor(z / COLS) * zh;
      const s = this.zoneSound(z);
      g.fillStyle = s.drum ? `rgba(142,240,164,${this.level[z] * 1.6})` : `rgba(68,212,232,${this.level[z] * 1.6})`;
      g.fillRect(x, y, zw, zh);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.strokeRect(x + 0.5, y + 0.5, zw - 1, zh - 1);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = `${11 * devicePixelRatio}px "Barlow Condensed", sans-serif`;
      g.fillText(s.drum ? s.drum.toUpperCase() : `NOTE ${s.degree + 1}`, x + 6, y + 14 * devicePixelRatio);
    }
  }
}
