// Step sequencer: drums, song chops and an in-key note grid, with genre presets.
import { DRUMS, SYNTHS, NOTE_NAMES, scaleNote, playSlice } from './instruments.js';

const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat'];
const NOTE_ROWS = 8;
const P = (s) => [...s].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.55 : 0));

export const STYLES = {
  nbrz:    { bpm: 92,  swing: 0.1,  synth: 'keys',  root: 9, scale: 'minor',
    kick: 'x......x..x.....', snare: '....x.......x...', clap: '............x...', hat: 'x.x.x.x.x.x.xox.', openhat: '......x.........',
    notes: [[0, [0, 2, 4]], [6, [6]], [8, [3, 5, 7]], [14, [4]]] },
  boombap: { bpm: 90,  swing: 0.16, synth: 'keys',  root: 2, scale: 'minor',
    kick: 'x.......x.x.....', snare: '....x.......x...', clap: '', hat: 'x.x.x.x.x.x.x.x.', openhat: '',
    notes: [[0, [0, 2, 4]], [8, [5, 7]], [11, [4]]] },
  trap:    { bpm: 140, swing: 0,    synth: 'bass',  root: 1, scale: 'minor',
    kick: 'x......x..x.....', snare: '........x.......', clap: '........x.......', hat: 'xxxxxxxxxxxxoxxx', openhat: '',
    notes: [[0, [0]], [7, [0]], [10, [3]], [14, [4]]] },
  drill:   { bpm: 142, swing: 0,    synth: 'bass',  root: 6, scale: 'minor',
    kick: 'x.........x.....', snare: '........x....x..', clap: '', hat: 'x..x..x.x..x..x.', openhat: '',
    notes: [[0, [0]], [3, [1]], [6, [0]], [10, [5]], [12, [4]]] },
  dembow:  { bpm: 96,  swing: 0,    synth: 'pluck', root: 7, scale: 'minor',
    kick: 'x...x...x...x...', snare: '...x..x....x..x.', clap: '', hat: 'x.x.x.x.x.x.x.x.', openhat: '',
    notes: [[0, [0]], [3, [2]], [6, [4]], [8, [3]], [11, [2]], [14, [1]]] },
  afro:    { bpm: 106, swing: 0.06, synth: 'pluck', root: 4, scale: 'major',
    kick: 'x.....x.x.......', snare: '....x..x....x...', clap: '', hat: 'x.xxx.xxx.xxx.xx', openhat: '',
    notes: [[0, [4]], [2, [2]], [4, [4]], [7, [5]], [10, [4]], [12, [2]]] },
  house:   { bpm: 124, swing: 0.04, synth: 'pad',   root: 5, scale: 'minor',
    kick: 'x...x...x...x...', snare: '', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', openhat: '..x...x...x...x.',
    notes: [[0, [0, 2, 4]], [8, [5, 7]]] },
  lofi:    { bpm: 80,  swing: 0.22, synth: 'keys',  root: 0, scale: 'major',
    kick: 'x......x..x.....', snare: '....x.......x...', clap: '', hat: 'x.x.x.x.x.x.x.x.', openhat: '',
    notes: [[0, [1, 3, 5]], [8, [0, 2, 4, 6]]] },
  clear:   { kick: '', snare: '', clap: '', hat: '', openhat: '', notes: [] },
};

const NOTE_LEN = { keys: 2, pluck: 1, pad: 6, bass: 2, lead: 1 };

export class Sequencer {
  constructor(engine, el) {
    this.engine = engine;
    this.el = el;
    this.root = 9;
    this.scale = 'minor';
    this.synth = 'keys';
    this.chopSource = null;
    this.deck = null; // set by main: provides buffer + slice info
    this.pattern = this.empty();
    this.vols = { kick: 0.9, snare: 0.8, clap: 0.7, hat: 0.55, openhat: 0.45, chop: 0.85, synth: 0.7 };
    this.mutes = {};
    this.build();
    el.addEventListener('click', (e) => this.#onCell(e, 1));
    el.addEventListener('contextmenu', (e) => { if (e.target.dataset.lane === 'chop') { e.preventDefault(); this.#onCell(e, -1); } });
    engine.addEventListener('step', (e) => this.highlight(e.detail));
    engine.addEventListener('state', () => { if (!engine.playing) this.highlight(-1); });
  }

  empty() {
    const p = { chop: Array(16).fill(-1), notes: Array.from({ length: NOTE_ROWS }, () => Array(16).fill(0)) };
    DRUM_LANES.forEach((l) => { p[l] = Array(16).fill(0); });
    return p;
  }

  applyStyle(name) {
    const s = STYLES[name];
    if (!s) return null;
    const p = this.empty();
    DRUM_LANES.forEach((l) => { p[l] = P((s[l] || '').padEnd(16, '.')); });
    (s.notes || []).forEach(([step, degrees]) => degrees.forEach((d) => { if (d < NOTE_ROWS) p.notes[d][step] = 1; }));
    p.chop = this.pattern.chop; // keep the user's chops when changing style
    this.pattern = p;
    if (s.root !== undefined) { this.root = s.root; this.scale = s.scale; }
    if (s.synth) this.synth = s.synth;
    this.refresh();
    return s;
  }

  // ── Playback (graph-agnostic so WAV bounce can reuse it) ─────
  playStep(graph, s, t) {
    const ctx = graph.ctx;
    const vel = (lane) => (this.mutes[lane] ? 0 : this.vols[lane]);
    for (const lane of DRUM_LANES) {
      const v = this.pattern[lane][s];
      if (v && vel(lane)) DRUMS[lane](ctx, graph.buses[lane === 'openhat' ? 'hat' : lane], t, v * vel(lane));
    }
    const stepDur = 60 / this.engine.bpm / 4;
    if (vel('synth')) {
      for (let r = 0; r < NOTE_ROWS; r++) {
        if (!this.pattern.notes[r][s]) continue;
        const midi = scaleNote(this.root, this.scale, r, this.synth === 'bass' ? 2 : 4);
        SYNTHS[this.synth](ctx, graph.buses.synth, t, midi, stepDur * NOTE_LEN[this.synth], vel('synth'));
      }
    }
    const slice = this.pattern.chop[s];
    if (slice >= 0 && vel('chop')) this.playChop(graph, slice, t, vel('chop'));
  }

  // Song chops choke each other like an MPC.
  playChop(graph, slice, t, vel = 1) {
    const info = this.deck?.sliceInfo(slice);
    if (!info) return;
    if (graph === this.engine.graph && this.chopSource) {
      try { this.chopSource.stop(t + 0.01); } catch { /* already stopped */ }
    }
    const src = playSlice(graph.ctx, graph.buses.chop, t, info.buffer, info.offset, info.dur, info.rate, vel);
    if (graph === this.engine.graph) this.chopSource = src;
  }

  // ── UI ───────────────────────────────────────────────────────
  build() {
    const el = this.el;
    el.innerHTML = '';
    this.cells = Array.from({ length: 16 }, () => []);
    const addRow = (lane, label, cls, row) => {
      const lbl = document.createElement('div');
      lbl.className = `lbl ${cls === 'note' ? 'note' : ''}`;
      lbl.textContent = label;
      lbl.title = 'Click to mute';
      lbl.addEventListener('click', () => { this.mutes[lane] = !this.mutes[lane]; lbl.style.opacity = this.mutes[lane] ? 0.35 : 1; });
      el.append(lbl);
      for (let s = 0; s < 16; s++) {
        const b = document.createElement('button');
        b.className = `cell ${cls}${s % 4 === 0 ? ' beat' : ''}`;
        b.dataset.lane = lane; b.dataset.step = s;
        if (row !== undefined) b.dataset.row = row;
        b.setAttribute('aria-label', `${label} step ${s + 1}`);
        el.append(b);
        this.cells[s].push(b);
      }
      const volKey = cls === 'note' ? 'synth' : lane;
      if (cls === 'note' && row !== NOTE_ROWS - 1) { el.append(document.createElement('span')); return; }
      const vol = document.createElement('input');
      vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = this.vols[volKey]; vol.className = 'vol';
      vol.title = `${volKey} volume`;
      vol.addEventListener('input', () => { this.vols[volKey] = +vol.value; });
      el.append(vol);
    };
    DRUM_LANES.forEach((l) => addRow(l, l === 'openhat' ? 'open hat' : l, 'drum'));
    addRow('chop', 'chop', 'chop');
    const sep = document.createElement('div'); sep.className = 'sep'; el.append(sep);
    for (let r = NOTE_ROWS - 1; r >= 0; r--) addRow('notes', '', 'note', r);
    this.noteLabels = [...el.querySelectorAll('.lbl.note')];
    this.refresh();
  }

  #onCell(e, dir) {
    const b = e.target.closest('.cell');
    if (!b) return;
    this.engine.ensure();
    const lane = b.dataset.lane, s = +b.dataset.step;
    if (lane === 'notes') {
      const r = +b.dataset.row;
      this.pattern.notes[r][s] = this.pattern.notes[r][s] ? 0 : 1;
      if (this.pattern.notes[r][s]) {
        const midi = scaleNote(this.root, this.scale, r, this.synth === 'bass' ? 2 : 4);
        SYNTHS[this.synth](this.engine.ctx, this.engine.graph.buses.synth, this.engine.now, midi, 0.3, this.vols.synth);
      }
    } else if (lane === 'chop') {
      const cur = this.pattern.chop[s];
      if (e.shiftKey || dir < 0) this.pattern.chop[s] = cur < 0 ? Math.floor(s / 4) : (cur + (dir < 0 ? 15 : 1)) % 16;
      else this.pattern.chop[s] = cur >= 0 ? -1 : Math.floor(s / 4);
      if (this.pattern.chop[s] >= 0) this.playChop(this.engine.graph, this.pattern.chop[s], this.engine.now);
    } else {
      this.pattern[lane][s] = this.pattern[lane][s] ? 0 : 1;
      if (this.pattern[lane][s]) DRUMS[lane](this.engine.ctx, this.engine.graph.buses[lane === 'openhat' ? 'hat' : lane], this.engine.now, this.vols[lane]);
    }
    this.refresh();
  }

  refresh() {
    this.el.querySelectorAll('.cell').forEach((b) => {
      const lane = b.dataset.lane, s = +b.dataset.step;
      let on;
      if (lane === 'notes') on = this.pattern.notes[+b.dataset.row][s];
      else if (lane === 'chop') { on = this.pattern.chop[s] >= 0; b.textContent = on ? this.pattern.chop[s] + 1 : ''; }
      else on = this.pattern[lane][s];
      b.classList.toggle('on', !!on);
    });
    this.noteLabels?.forEach((lbl, i) => {
      const r = NOTE_ROWS - 1 - i;
      lbl.textContent = NOTE_NAMES[scaleNote(this.root, this.scale, r) % 12];
    });
  }

  highlight(step) {
    this.cells.forEach((col, s) => col.forEach((b) => b.classList.toggle('now', s === step)));
  }

  toJSON() { return { pattern: this.pattern, vols: this.vols, root: this.root, scale: this.scale, synth: this.synth }; }
  load(data) {
    if (!data) return;
    Object.assign(this, { root: data.root ?? this.root, scale: data.scale ?? this.scale, synth: data.synth ?? this.synth });
    if (data.pattern) this.pattern = { ...this.empty(), ...data.pattern };
    if (data.vols) Object.assign(this.vols, data.vols);
    this.build();
  }
}
