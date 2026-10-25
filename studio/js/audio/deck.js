// Song deck: NBRZ catalog + uploads + direct links, FX, BPM detection and 16 chops.
import { playSlice } from './instruments.js';

// ── Tiny IndexedDB store so uploaded songs survive reloads (important on Quest) ──
const DB = 'nbrz-forge', STORE = 'songs';
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const saveSong = (rec) => idbDo('readwrite', (s) => s.put(rec)).catch(() => {});
const getSong = (id) => idbDo('readonly', (s) => s.get(id)).catch(() => null);
const listSongs = () => idbDo('readonly', (s) => s.getAll()).catch(() => []);

const STREAMING = /(youtube\.com|youtu\.be|spotify\.com|music\.apple\.com|soundcloud\.com|tidal\.com|deezer\.com|music\.amazon|tiktok\.com|instagram\.com)/i;

export class Deck extends EventTarget {
  constructor(engine, els) {
    super();
    this.engine = engine;
    this.els = els;
    this.buffer = null;
    this.title = '';
    this.songBpm = null;
    this.chopStart = 0;
    this.playing = false;
    this.offset = 0;
    this.rate = 1;
    this.catalog = [];
    this.#bind();
    this.loadCatalog();
  }

  // ── Catalog ────────────────────────────────────────────────
  async loadCatalog() {
    try {
      const res = await fetch('catalog.json');
      this.catalog = (await res.json()).tracks || [];
    } catch { this.catalog = []; }
    await this.renderCatalog();
  }

  async renderCatalog(selectId) {
    const sel = this.els.catalog;
    const uploads = (await listSongs()).filter((s) => !this.catalog.some((c) => c.id === s.id));
    const stored = new Set((await listSongs()).map((s) => s.id));
    sel.innerHTML = '<option value="">NBRZ catalog / your songs…</option>';
    const g1 = document.createElement('optgroup'); g1.label = 'NBRZ';
    this.catalog.forEach((t) => {
      const ready = t.file || stored.has(t.id);
      g1.append(new Option(`${ready ? '● ' : '○ '}${t.title}`, t.id));
    });
    sel.append(g1);
    if (uploads.length) {
      const g2 = document.createElement('optgroup'); g2.label = 'Your uploads & takes';
      uploads.forEach((u) => g2.append(new Option(`● ${u.name}`, u.id)));
      sel.append(g2);
    }
    if (selectId) sel.value = selectId;
  }

  async pick(id) {
    if (!id) return;
    const entry = this.catalog.find((t) => t.id === id);
    const stored = await getSong(id);
    if (stored) return this.loadBlob(stored.blob, stored.name);
    if (entry?.file) return this.loadUrl(entry.file, entry.title);
    // Catalog track with no audio yet: ask for the master once and keep it in this browser.
    this.pendingId = id;
    this.pendingTitle = entry?.title;
    this.dispatchEvent(new CustomEvent('message', { detail: `Choose your audio file for “${entry?.title}” — it’s saved in this browser for next time.` }));
    this.els.fileInput.click();
  }

  // ── Loading ────────────────────────────────────────────────
  async loadFile(file) {
    const id = this.pendingId || `upload:${file.name}`;
    const name = this.pendingTitle || file.name.replace(/\.[^.]+$/, '');
    this.pendingId = this.pendingTitle = null;
    await saveSong({ id, name, blob: file });
    await this.loadBlob(file, name);
    await this.renderCatalog(id);
  }

  async loadUrl(url, title) {
    if (STREAMING.test(url)) {
      throw new Error('Streaming links (YouTube, Spotify, Apple Music, SoundCloud…) are DRM-protected and can’t be pulled into a browser. Upload a file you own, or paste a direct .mp3/.wav link.');
    }
    let res;
    try { res = await fetch(url); } catch {
      throw new Error('That site blocks other apps from reading its audio (CORS). Download the file and upload it instead.');
    }
    if (!res.ok) throw new Error(`Couldn’t load that link (HTTP ${res.status}).`);
    const blob = await res.blob();
    await this.loadBlob(blob, title || decodeURIComponent(url.split('/').pop().split('?')[0]) || 'Linked audio');
  }

  async loadBlob(blob, name) {
    const ctx = this.engine.ensure();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    this.loadBuffer(buf, name);
  }

  loadBuffer(buffer, name) {
    this.stop();
    this.buffer = buffer;
    this.title = name;
    this.offset = 0;
    this.peaks = computePeaks(buffer, 600);
    const { bpm, firstBeat } = detectTempo(buffer);
    this.songBpm = bpm;
    this.chopStart = firstBeat;
    this.els.title.textContent = name;
    this.els.bpm.textContent = bpm ? `${bpm} BPM` : '';
    this.els.pads.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    this.dispatchEvent(new CustomEvent('loaded', { detail: { name, bpm } }));
  }

  // ── Transport ──────────────────────────────────────────────
  get position() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    return (this.offset + (this.engine.now - this.startedAt) * this.rate) % this.buffer.duration;
  }

  play() {
    if (!this.buffer || this.playing) return;
    const ctx = this.engine.ensure();
    const bus = this.engine.graph.buses.deck;
    if (!this.chain) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.gain = ctx.createGain();
      this.filter.connect(this.gain).connect(bus);
      this.chain = true;
      this.applyFx();
    }
    const src = this.src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = this.rate;
    src.connect(this.filter);
    src.start(0, this.offset);
    this.startedAt = ctx.currentTime;
    this.playing = true;
    this.dispatchEvent(new Event('state'));
  }

  stop() {
    if (!this.playing) return;
    this.offset = this.position;
    try { this.src.stop(); } catch { /* already stopped */ }
    this.playing = false;
    this.dispatchEvent(new Event('state'));
  }

  toggle() { if (this.playing) this.stop(); else this.play(); }

  seek(t) {
    const was = this.playing;
    this.stop();
    this.offset = Math.max(0, Math.min(t, (this.buffer?.duration || 1) - 0.01));
    if (was) this.play();
  }

  setRate(r) {
    if (this.playing) { this.offset = this.position; this.startedAt = this.engine.now; this.src.playbackRate.value = r; }
    this.rate = r;
  }

  applyFx() {
    if (!this.chain) return;
    const v = (id) => +this.els[id].value;
    const f = v('filter');
    this.filter.frequency.value = 120 * Math.pow(20000 / 120, f);
    this.filter.Q.value = f < 0.98 ? 4 : 0.7;
    this.gain.gain.value = v('vol');
    const bus = this.engine.graph.buses.deck;
    bus.sends.echo.gain.value = v('echo');
    bus.sends.verb.gain.value = v('verb') * 0.8;
  }

  // ── Chops ──────────────────────────────────────────────────
  beatDur() { return 60 / (this.songBpm || this.engine.bpm); }

  sliceInfo(i) {
    if (!this.buffer) return null;
    const dur = this.beatDur();
    let offset = this.chopStart + i * dur;
    if (offset + dur > this.buffer.duration) offset = (offset % Math.max(dur, this.buffer.duration - dur));
    const rate = this.songBpm ? Math.max(0.5, Math.min(2, this.engine.bpm / this.songBpm)) : 1;
    return { buffer: this.buffer, offset, dur, rate };
  }

  hitPad(i, graph = this.engine.graph, t = this.engine.now) {
    const info = this.sliceInfo(i);
    if (!info) return;
    if (this.padSrc) { try { this.padSrc.stop(t + 0.01); } catch { /* done */ } }
    this.padSrc = playSlice(graph.ctx, graph.buses.chop, t, info.buffer, info.offset, info.dur, info.rate);
    const b = this.els.pads.children[i];
    b?.classList.add('hit');
    setTimeout(() => b?.classList.remove('hit'), 140);
  }

  // ── Waveform ───────────────────────────────────────────────
  draw() {
    const c = this.els.wave, g = c.getContext('2d');
    const w = c.width = c.clientWidth * devicePixelRatio, h = c.height = c.clientHeight * devicePixelRatio;
    g.clearRect(0, 0, w, h);
    if (!this.buffer) return;
    const d = this.buffer.duration;
    // chop region
    const x0 = (this.chopStart / d) * w, x1 = ((this.chopStart + 16 * this.beatDur()) / d) * w;
    g.fillStyle = 'rgba(43,158,255,0.14)';
    g.fillRect(x0, 0, x1 - x0, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#8EF0A4'); grad.addColorStop(0.5, '#44D4E8'); grad.addColorStop(1, '#2B9EFF');
    g.fillStyle = grad;
    const n = this.peaks.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const ph = Math.max(1, this.peaks[i] * h * 0.9);
      g.fillRect(i * bw, (h - ph) / 2, Math.max(1, bw - 0.5), ph);
    }
    g.fillStyle = '#fff';
    g.fillRect((this.position / d) * w, 0, 2 * devicePixelRatio, h);
  }

  #bind() {
    const e = this.els;
    e.catalog.addEventListener('change', () => this.pick(e.catalog.value).catch((err) => this.#err(err)));
    e.play.addEventListener('click', () => { this.engine.ensure(); this.toggle(); });
    e.rate.addEventListener('input', () => this.setRate(+e.rate.value));
    ['filter', 'echo', 'verb', 'vol'].forEach((k) => e[k].addEventListener('input', () => this.applyFx()));
    e.wave.addEventListener('click', (ev) => {
      if (!this.buffer) return;
      const r = e.wave.getBoundingClientRect();
      const t = ((ev.clientX - r.left) / r.width) * this.buffer.duration;
      this.chopStart = t;  // chops start where you click
      this.seek(t);
    });
    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button');
      b.textContent = i + 1;
      b.disabled = true;
      b.addEventListener('pointerdown', () => { this.engine.ensure(); this.hitPad(i); });
      e.pads.append(b);
    }
    this.addEventListener('state', () => { e.play.textContent = this.playing ? '❚❚' : '▶'; e.play.classList.toggle('on', this.playing); });
  }

  #err(err) { this.dispatchEvent(new CustomEvent('message', { detail: err.message, bubbles: false })); }

  // ── Mic recording ─────────────────────────────────────────
  async toggleMic() {
    if (this.micRec) {
      this.micRec.stop();
      return false;
    }
    const ctx = this.engine.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const chunks = [];
    const rec = this.micRec = new MediaRecorder(stream);
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      this.micRec = null;
      const blob = new Blob(chunks, { type: rec.mimeType });
      const name = `Mic take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const id = `take:${Date.now()}`;
      await saveSong({ id, name, blob });
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      this.loadBuffer(buf, name);
      await this.renderCatalog(id);
      this.dispatchEvent(new Event('mic'));
    };
    rec.start();
    return true;
  }
}

function computePeaks(buffer, n) {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / n);
  const peaks = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let j = i * block, end = j + block; j < end; j += 16) p = Math.max(p, Math.abs(data[j]));
    peaks[i] = p;
    max = Math.max(max, p);
  }
  return peaks.map((p) => p / (max || 1));
}

// Onset-envelope autocorrelation tempo estimate, folded into 70–160 BPM.
export function detectTempo(buffer) {
  const sr = buffer.sampleRate;
  const hop = 512;
  const data = buffer.getChannelData(0);
  const start = Math.floor(Math.min(buffer.duration * 0.1, 10) * sr);
  const end = Math.min(data.length, start + 60 * sr);
  const frames = Math.floor((end - start) / hop);
  if (frames < 200) return { bpm: null, firstBeat: 0 };
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = start + f * hop, e = i + hop; i < e; i++) s += data[i] * data[i];
    energy[f] = Math.sqrt(s / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  const fps = sr / hop;
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(fps * 60 / 180); lag <= Math.ceil(fps * 60 / 70); lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += onset[f] * onset[f + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return { bpm: null, firstBeat: 0 };
  let bpm = (60 * fps) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  // First strong onset in the whole file = default chop start.
  let firstBeat = 0;
  const peak = Math.max(...onset);
  for (let f = 0; f < frames; f++) if (onset[f] > peak * 0.5) { firstBeat = (start + f * hop) / sr; break; }
  return { bpm: Math.round(bpm), firstBeat };
}
