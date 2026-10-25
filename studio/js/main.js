// NBRZ Forge — wires the 3D workspace, music studio and VR together.
import * as THREE from 'three';
import { Viewport } from './viewport.js';
import { History } from './history.js';
import { SHAPES, createShape, createMesh, applyFinish, dropToFloor, makeMaterial } from './shapes.js';
import * as Tools from './tools.js';
import { Sculptor } from './sculpt.js';
import { importModel, exportGLB, exportOBJ, exportSTL, download } from './io.js';
import { parsePrompt, parseMusic, PROMPT_EXAMPLES } from './prompt.js';
import { XRRig } from './xr.js';
import { AudioEngine, buildGraph, encodeWav } from './audio/engine.js';
import { Sequencer, STYLES } from './audio/sequencer.js';
import { Deck } from './audio/deck.js';
import { SoundSpace } from './audio/spatial.js';
import { NOTE_NAMES } from './audio/instruments.js';
import { PerformStage } from './perform/stage.js';
import { MotionStage } from './perform/motion.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const app = $('#app');

// ── Toast ───────────────────────────────────────────────────
let toastTimer;
function toast(msg, isErr = false, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ── Core ────────────────────────────────────────────────────
const vp = new Viewport($('#viewport'));
const content = vp.content;
const history = new History(content, () => { vp.select(vp.selection.filter((o) => o.parent === content)); refreshUI(); autosave(); });
let mode = 'build';

function commit(changed = []) {
  changed.forEach((o) => history.bump(o));
  history.push();
  refreshUI();
  autosave();
}

function add(objs, { select = true, push = true } = {}) {
  objs = [].concat(objs);
  objs.forEach((o) => content.add(o));
  if (select) vp.select(objs);
  if (push) commit();
  return objs;
}

function remove(objs) {
  objs.forEach((o) => content.remove(o));
  vp.select([]);
}

// ── Build from parts (prompt / AI / starter beat) ───────────
function hash(n) { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); }
function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const s = (a, b) => hash(a * 127.1 + b * 311.7 + seed * 0.13);
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(s(xi, zi), s(xi + 1, zi), u), THREE.MathUtils.lerp(s(xi, zi + 1), s(xi + 1, zi + 1), u), v);
}
function terrainGeometry(seed = 1) {
  const g = SHAPES.plane.geo();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let h = 0, amp = 0.12, f = 3;
    for (let o = 0; o < 5; o++) { h += (valueNoise(x * f, z * f, seed + o * 17) - 0.5) * amp; amp *= 0.5; f *= 2; }
    const edge = Math.max(0, 1 - Math.pow(Math.max(Math.abs(x), Math.abs(z)) / 0.4, 4));
    p.setY(i, Math.max(0, h + 0.05) * edge);
  }
  g.computeVertexNormals();
  return g;
}

async function partToMesh(p) {
  let mesh;
  if (p.shape === 'terrain') mesh = createMesh('plane', { geometry: terrainGeometry(p.seed), color: p.color, finish: p.finish });
  else mesh = await createShape(p.shape, { color: p.color, finish: p.finish, text: p.text });
  if (p.name) mesh.name = p.name;
  mesh.position.fromArray(p.position);
  mesh.scale.fromArray(p.scale.map((v) => (Math.abs(v) < 1e-3 ? 1e-3 : v)));
  mesh.rotation.set(...p.rotation.map((d) => THREE.MathUtils.degToRad(d)));
  return mesh;
}

async function buildScene(sceneData) {
  const meshes = await Promise.all(sceneData.parts.map(partToMesh));
  if (!meshes.length) return [];
  if (sceneData.loose || meshes.length === 1) {
    meshes.forEach((m) => { if (!sceneData.loose) dropToFloor(m); });
    return add(meshes);
  }
  const group = new THREE.Group();
  group.name = sceneData.name || 'Model';
  group.userData = { kind: 'group', sound: 'auto', rev: 0 };
  meshes.forEach((m) => group.add(m));
  // Place beside what's already there so repeated prompts don't overlap.
  if (content.children.length) {
    const existing = new THREE.Box3();
    content.children.forEach((o) => existing.expandByObject(o));
    const mine = new THREE.Box3().setFromObject(group);
    if (!existing.isEmpty()) group.position.x = existing.max.x - mine.min.x + 0.15;
  }
  content.add(group);
  dropToFloor(group);
  content.remove(group);
  const out = add(group);
  vp.frameSelection();
  return out;
}

// ── Shapes panel ────────────────────────────────────────────
const shapeGrid = $('#shape-grid');
Object.entries(SHAPES).forEach(([kind, def]) => {
  const b = document.createElement('button');
  b.innerHTML = `<i>${def.icon}</i>${def.label}`;
  b.title = `Add ${def.label}`;
  b.addEventListener('click', () => spawn(kind));
  shapeGrid.append(b);
});

async function spawn(kind, worldPos) {
  let text;
  if (kind === 'text') {
    text = worldPos ? 'NBRZ' : prompt('Text to make 3D:', 'NBRZ');
    if (!text) return;
  }
  const mesh = kind === 'plane' ? createMesh('plane', { geometry: terrainGeometry(Math.random() * 1000), color: '#6b8f5a', finish: 'matte' })
    : await createShape(kind, { text });
  if (worldPos) {
    content.worldToLocal(mesh.position.copy(worldPos));
  } else {
    // Spread new shapes out a little so they don't all stack at the origin.
    const n = content.children.length;
    mesh.position.set(((n % 5) - 2) * 0.12, 0, (Math.floor(n / 5) % 3) * 0.1);
    content.add(mesh);
    dropToFloor(mesh);
    content.remove(mesh);
  }
  add(mesh);
}

// ── Operations ──────────────────────────────────────────────
const OPS = {
  duplicate() {
    const clones = vp.selection.map((o) => { const c = Tools.deepClone(o); c.position.x += 0.1; c.name = `${o.name} copy`; return c; });
    add(clones);
  },
  delete() { if (vp.selection.length) { remove(vp.selection); commit(); } },
  mirror() { add(vp.selection.map(Tools.mirror)); },
  array() {
    const o = vp.selection[0];
    if (!o) return;
    const copies = Tools.radialArray(o);
    add(copies, { select: false, push: false });
    vp.select([o, ...copies]);
    commit();
  },
  arrayLine() { const o = vp.selection[0]; if (o) add(Tools.linearArray(o)); },
  floor() { vp.selection.forEach(dropToFloor); commit(); },
  union() { booleanOp('union'); },
  subtract() { booleanOp('subtract'); },
  intersect() { booleanOp('intersect'); },
  smooth() {
    vp.selection.forEach((o) => eachMat(o, (m) => { m.flatShading = !m.flatShading; m.needsUpdate = true; }));
    commit([...vp.selection]);
  },
  decimate() {
    const changed = vp.selection.filter((o) => { let did = false; o.traverse((m) => { if (m.isMesh && Tools.decimate(m)) did = true; }); return did; });
    if (changed.length) { commit(changed); toast(`Reduced to ${Tools.triangleCount(changed[0]).toLocaleString()} triangles`); }
  },
  frame() { vp.frameSelection(); },
  group() {
    if (vp.selection.length < 2) return toast('Select 2 or more objects to group (Shift-click).');
    const g = new THREE.Group();
    g.name = 'Group';
    g.userData = { kind: 'group', sound: 'auto', rev: 0 };
    const box = new THREE.Box3();
    vp.selection.forEach((o) => box.expandByObject(o));
    content.worldToLocal(box.getCenter(g.position));
    g.position.y = 0;
    content.add(g);
    vp.selection.forEach((o) => g.attach(o));
    vp.select(g);
    commit();
  },
  ungroup() {
    const parts = [];
    vp.selection.filter((o) => o.isGroup).forEach((g) => {
      [...g.children].forEach((c) => { content.attach(c); c.userData.sound ??= 'auto'; c.userData.rev ??= 0; parts.push(c); });
      content.remove(g);
    });
    if (parts.length) { vp.select(parts); commit(); }
  },
  densify() {
    const m = vp.selection.find((o) => o.isMesh);
    if (!m) return toast('Select a single shape to add detail.');
    if (sculptor.densify(m)) { commit([m]); toast(`${Tools.triangleCount(m).toLocaleString()} triangles`); } else toast('Already at maximum detail.');
  },
};

function booleanOp(op) {
  const sel = vp.selection;
  if (sel.length < 2) return toast('Select 2+ objects (Shift-click). The first one is the base.');
  try {
    const result = Tools.boolean(sel, op);
    remove(sel);
    add(result);
    toast(`${op[0].toUpperCase() + op.slice(1)} done — ${Tools.triangleCount(result).toLocaleString()} triangles`);
  } catch (e) {
    toast(e.message, true);
  }
}

$$('[data-op]').forEach((b) => b.addEventListener('click', () => OPS[b.dataset.op]?.()));

// ── Gizmo + snapping ───────────────────────────────────────
$$('#gizmo-modes button').forEach((b) => b.addEventListener('click', () => setGizmo(b.dataset.gizmo)));
function setGizmo(m) {
  vp.gizmo.setMode(m);
  $$('#gizmo-modes button').forEach((x) => x.classList.toggle('active', x.dataset.gizmo === m));
}
$('#snap-toggle').addEventListener('change', (e) => vp.setSnap(e.target.checked));
vp.addEventListener('transform', () => fillProps());
vp.addEventListener('transform-end', () => commit());
vp.addEventListener('selection', () => {
  refreshUI();
  if (mode === 'sound' && vp.selection.length === 1) space.trigger(vp.selection[0]);
});

// ── Modes ───────────────────────────────────────────────────
function setMode(m) {
  const prev = mode;
  mode = m;
  app.dataset.mode = m;
  vp.setMode(m);
  space.show(m === 'sound');
  if (m === 'perform' && prev !== 'perform') enterPerform();
  if (m !== 'perform' && prev === 'perform') exitPerform();
  if ((m === 'perform') !== (prev === 'perform')) layoutWorld();
  $$('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  $('#hud-mode').textContent = m.toUpperCase();
  xr.drawMenu(menuState());
  if (m === 'sound' || m === 'perform') engine.ensure();
}

// Where the user's creations sit: on a table in VR, at the origin on desktop, and as a
// backdrop in front of the 360° stage in Perform.
function layoutWorld() {
  const w = vp.world;
  w.scale.setScalar(1);
  w.rotation.set(0, 0, 0);
  if (mode === 'perform') w.position.set(0, 0, -1.9);
  else if (xr.presenting) w.position.set(0, 0.8, -0.55);
  else w.position.set(0, 0, 0);
}

function menuState() {
  return { mode, play: engine.playing, capture: stage.capture, nod: stage.nodTempo, sky: skyOn };
}
$$('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ── Sculpt ─────────────────────────────────────────────────
let brush = 'inflate';
$$('#brush-modes button').forEach((b) => b.addEventListener('click', () => {
  brush = b.dataset.brush;
  $$('#brush-modes button').forEach((x) => x.classList.toggle('active', x === b));
}));
const sculptor = new Sculptor(vp, {
  getSettings: () => ({ radius: +$('#brush-radius').value, strength: +$('#brush-strength').value, mode: brush, symmetry: $('#brush-symmetry').checked }),
  onStrokeEnd: (mesh) => commit([mesh]),
});

// ── Properties panel ────────────────────────────────────────
const firstMat = (o) => { let m = null; o.traverse((x) => { if (!m && x.isMesh) m = Array.isArray(x.material) ? x.material[0] : x.material; }); return m; };
const eachMat = (o, fn) => o.traverse((x) => { if (x.isMesh) [].concat(x.material).forEach(fn); });

function fillProps() {
  const o = vp.selection[0];
  $('#props-empty').hidden = !!o;
  $('#props-body').hidden = !o;
  if (!o) return;
  const active = document.activeElement;
  const set = (el, v) => { if (el !== active) el.value = v; };
  set($('#p-name'), o.name);
  const mat = firstMat(o);
  if (mat) { set($('#p-color'), `#${mat.color.getHexString()}`); set($('#p-finish'), mat.userData.finish || 'satin'); }
  set($('#p-sound'), o.userData.sound || 'auto');
  const vec = { position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map(THREE.MathUtils.radToDeg), scale: o.scale.toArray() };
  $$('.vec').forEach((row) => {
    const vals = vec[row.dataset.vec];
    row.querySelectorAll('input').forEach((inp, i) => set(inp, +vals[i].toFixed(row.dataset.vec === 'rotation' ? 1 : 3)));
  });
  const box = new THREE.Box3().setFromObject(o);
  const ws = vp.world.scale.x;
  const size = box.getSize(new THREE.Vector3()).divideScalar(ws).multiplyScalar(1000);
  const longest = Math.max(size.x, size.y, size.z);
  const print = +$('#print-size').value;
  $('#p-dims').innerHTML = `${size.x.toFixed(0)} × ${size.y.toFixed(0)} × ${size.z.toFixed(0)} mm<br>${Tools.triangleCount(o).toLocaleString()} triangles · prints at ${(print / longest * 100).toFixed(0)}% for ${print} mm`;
}

$('#p-name').addEventListener('change', (e) => { const o = vp.selection[0]; if (o) { o.name = e.target.value; commit([o]); } });
$('#p-color').addEventListener('input', (e) => vp.selection.forEach((o) => eachMat(o, (m) => { m.color.set(e.target.value); if (m.userData.finish === 'neon') m.emissive.set(e.target.value); })));
$('#p-color').addEventListener('change', () => commit([...vp.selection]));
$('#p-finish').addEventListener('change', (e) => { vp.selection.forEach((o) => eachMat(o, (m) => applyFinish(m, e.target.value))); commit([...vp.selection]); });
$('#p-sound').addEventListener('change', (e) => { vp.selection.forEach((o) => { o.userData.sound = e.target.value; }); commit([...vp.selection]); if (vp.selection[0]) space.trigger(vp.selection[0]); });
$$('.vec').forEach((row) => row.querySelectorAll('input').forEach((inp, i) => {
  inp.addEventListener('input', () => {
    const o = vp.selection[0];
    if (!o || inp.value === '') return;
    const v = +inp.value;
    if (row.dataset.vec === 'rotation') o.rotation[['x', 'y', 'z'][i]] = THREE.MathUtils.degToRad(v);
    else o[row.dataset.vec].setComponent(i, row.dataset.vec === 'scale' && Math.abs(v) < 1e-3 ? 1e-3 : v);
  });
  inp.addEventListener('change', () => commit());
}));
$('#print-size').addEventListener('input', fillProps);

// ── Outliner + HUD ─────────────────────────────────────────
function refreshUI() {
  fillProps();
  const ul = $('#outliner');
  ul.innerHTML = '';
  content.children.forEach((o) => {
    const li = document.createElement('li');
    li.classList.toggle('sel', vp.selection.includes(o));
    const mat = firstMat(o);
    li.innerHTML = `<span class="sw" style="background:#${mat ? mat.color.getHexString() : '888'}"></span><span class="nm"></span><button class="vis" title="Show / hide">${o.visible ? '◉' : '○'}</button>`;
    li.querySelector('.nm').textContent = o.name || o.type;
    li.addEventListener('click', (e) => { if (!e.target.classList.contains('vis')) vp.select(o, e.shiftKey); });
    li.querySelector('.vis').addEventListener('click', () => { o.visible = !o.visible; commit(); });
    ul.append(li);
  });
  $('#scene-count').textContent = content.children.length;
  const sel = vp.selection;
  $('#hud-sel').textContent = sel.length ? (sel.length === 1 ? sel[0].name : `${sel.length} selected`) : 'Nothing selected';
  $('#hud-poly').textContent = `${Tools.triangleCount(content).toLocaleString()} tris`;
}

// ── Prompt ──────────────────────────────────────────────────
const promptInput = $('#prompt-input');
let exampleIdx = 0;
setInterval(() => { if (document.activeElement !== promptInput && !promptInput.value) promptInput.placeholder = `Describe it — “${PROMPT_EXAMPLES[exampleIdx++ % PROMPT_EXAMPLES.length]}”`; }, 3500);

const keyInput = $('#api-key');
try { keyInput.value = localStorage.getItem('nbrz-forge-key') || ''; } catch { /* storage blocked */ }
keyInput.addEventListener('change', () => { try { localStorage.setItem('nbrz-forge-key', keyInput.value.trim()); } catch { /* storage blocked */ } });

$('#prompt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text) return;
  const btn = e.submitter || $('#prompt-form .btn');
  const music = parseMusic(text);
  if (music) {
    applyStyle(music.style, music.bpm);
    if (!engine.playing) togglePlay();
    toast(`${$('#style').selectedOptions[0].text} at ${engine.bpm} BPM — edit it in the studio below`);
    promptInput.value = '';
    return;
  }
  btn.classList.add('busy');
  try {
    let sceneData = null;
    if ($('#ai-toggle').checked) {
      toast('Claude is building it…', false, 60000);
      const { aiBuild } = await import('./ai.js');
      sceneData = await aiBuild(text, keyInput.value.trim());
    } else {
      sceneData = parsePrompt(text);
    }
    if (!sceneData?.parts?.length) {
      toast('Not sure how to build that offline. Try “castle”, “robot”, “5 spheres in a circle” — or switch on AI.', true, 5000);
      return;
    }
    await buildScene(sceneData);
    toast(`Built “${sceneData.name || text}” from ${sceneData.parts.length} parts`);
    promptInput.value = '';
  } catch (err) {
    toast(err.message || String(err), true, 6000);
  } finally {
    btn.classList.remove('busy');
  }
});

// ── Import / export / projects ─────────────────────────────
$('#btn-import').addEventListener('click', () => $('#file-model').click());
$('#file-model').addEventListener('change', async (e) => {
  for (const f of e.target.files) await importFile(f);
  e.target.value = '';
});

async function importFile(file) {
  try {
    if (/^audio\//.test(file.type) || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
      deck.pendingId = null;
      await deck.loadFile(file);
      toast(`Loaded “${file.name}” on the deck`);
      return;
    }
    toast(`Importing ${file.name}…`);
    const obj = await importModel(file);
    add(obj);
    vp.frameSelection();
    toast(`Imported ${file.name} — ${Tools.triangleCount(obj).toLocaleString()} triangles`);
  } catch (err) {
    toast(`Couldn’t import ${file.name}: ${err.message}`, true, 6000);
  }
}

const exportMenu = $('#export-menu');
$('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); exportMenu.classList.toggle('open'); });
document.addEventListener('click', () => exportMenu.classList.remove('open'));
exportMenu.addEventListener('click', async (e) => {
  const kind = e.target.dataset.export;
  if (!kind) return;
  const targets = vp.selection.length ? vp.selection : content.children;
  if (!targets.length && kind !== 'project') return toast('Nothing to export yet.', true);
  try {
    if (kind === 'stl') {
      const r = exportSTL(targets, { longestMM: +$('#print-size').value, realScale: $('#print-real').checked });
      toast(`STL saved: ${r.x.toFixed(1)} × ${r.y.toFixed(1)} × ${r.z.toFixed(1)} mm, ${Math.round(r.triangles).toLocaleString()} triangles`, false, 5000);
    } else if (kind === 'glb') { await exportGLB(targets); toast('GLB saved — drop it into Unity, Unreal, Blender or Godot'); }
    else if (kind === 'obj') { exportOBJ(targets); toast('OBJ saved'); }
    else if (kind === 'project') { download(JSON.stringify(projectJSON()), 'project.nbrz.json', 'application/json'); toast('Project saved'); }
  } catch (err) { toast(err.message, true); }
});

function projectJSON() {
  return { app: 'nbrz-forge', version: 1, scene: content.children.map((o) => o.toJSON()), music: sequencer.toJSON(), bpm: engine.bpm, swing: engine.swing, style: $('#style').value };
}

const loader = new THREE.ObjectLoader();
function loadProject(data, { quiet = false } = {}) {
  if (data?.app !== 'nbrz-forge') throw new Error('Not an NBRZ Forge project file.');
  content.clear();
  data.scene.forEach((j) => content.add(loader.parse(j)));
  sequencer.load(data.music);
  if (data.bpm) { engine.setBpm(data.bpm); $('#bpm').value = engine.bpm; }
  if (data.swing !== undefined) { engine.swing = data.swing; $('#swing').value = data.swing; }
  if (data.style) $('#style').value = data.style;
  syncKeySelect();
  $('#synth-preset').value = sequencer.synth;
  vp.select([]);
  history.reset();
  refreshUI();
  if (!quiet) toast('Project opened');
}

$('#btn-open').addEventListener('click', () => $('#file-project').click());
$('#file-project').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { loadProject(JSON.parse(await f.text())); } catch (err) { toast(err.message, true); }
});

let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const s = JSON.stringify(projectJSON());
      if (s.length < 4.5e6) localStorage.setItem('nbrz-forge-autosave', s);
    } catch { /* storage full or blocked: autosave is a convenience only */ }
  }, 1200);
}

// Drag & drop models or audio anywhere on the viewport.
const viewEl = $('#viewport');
['dragenter', 'dragover'].forEach((t) => viewEl.addEventListener(t, (e) => { e.preventDefault(); viewEl.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((t) => viewEl.addEventListener(t, (e) => { e.preventDefault(); viewEl.classList.remove('dragging'); }));
viewEl.addEventListener('drop', async (e) => { for (const f of e.dataTransfer.files) await importFile(f); });

// ── Undo / redo / keyboard ─────────────────────────────────
$('#btn-undo').addEventListener('click', () => history.undo());
$('#btn-redo').addEventListener('click', () => history.redo());

const PAD_KEYS = '12345678qwertyui';
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); }
  else if (mod && k === 'y') { e.preventDefault(); history.redo(); }
  else if (mod && k === 'd') { e.preventDefault(); OPS.duplicate(); }
  else if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) OPS.ungroup(); else OPS.group(); }
  else if (mod && k === 's') { e.preventDefault(); download(JSON.stringify(projectJSON()), 'project.nbrz.json', 'application/json'); }
  else if (k === 'delete' || k === 'backspace') OPS.delete();
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (mode === 'build' && k === 'w' && !mod) setGizmo('translate');
  else if (mode === 'build' && k === 'e' && !mod) setGizmo('rotate');
  else if (mode === 'build' && k === 'r' && !mod) setGizmo('scale');
  else if (k === 'f') OPS.frame();
  else if (k === 'escape') vp.select([]);
  else if (!mod && mode === 'perform' && PAD_KEYS.includes(k)) { const i = PAD_KEYS.indexOf(k); if (i < 8) stage.hitPad(i, 0.9); else stage.pluck(i - 8); }
  else if (!mod && PAD_KEYS.includes(k) && deck.buffer && !(mode === 'build' && 'wer'.includes(k))) { engine.ensure(); deck.hitPad(PAD_KEYS.indexOf(k)); }
});

// ── Audio ──────────────────────────────────────────────────
const engine = new AudioEngine();
const sequencer = new Sequencer(engine, $('#seq'));
const deck = new Deck(engine, {
  catalog: $('#catalog'), fileInput: $('#file-audio'), title: $('#deck-title'), bpm: $('#deck-bpm'), wave: $('#wave'), pads: $('#pads'),
  play: $('#deck-play'), rate: $('#deck-rate'), filter: $('#deck-filter'), echo: $('#deck-echo'), verb: $('#deck-verb'), vol: $('#deck-vol'),
});
sequencer.deck = deck;
const space = new SoundSpace(vp, engine, sequencer, deck);
engine.onStep((s, t) => sequencer.playStep(engine.graph, s, t));

deck.addEventListener('message', (e) => toast(e.detail, false, 5000));
deck.addEventListener('loaded', (e) => toast(`“${e.detail.name}” ready${e.detail.bpm ? ` · ~${e.detail.bpm} BPM` : ''} — tap pads 1–16 or keys 1–8 / Q–I`));
$('#btn-upload-audio').addEventListener('click', () => { deck.pendingId = null; $('#file-audio').click(); });
$('#file-audio').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) await deck.loadFile(f).catch((err) => toast(`Couldn’t read that audio: ${err.message}`, true));
});
$('#url-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#audio-url').value.trim();
  if (!url) return;
  try { await deck.loadUrl(url); $('#audio-url').value = ''; } catch (err) { toast(err.message, true, 7000); }
});
$('#btn-mic').addEventListener('click', async () => {
  try {
    const on = await deck.toggleMic();
    $('#btn-mic').textContent = on ? '■ Stop take' : '🎙 Record mic';
    $('#btn-mic').classList.toggle('on', on);
    if (on) toast('Recording your mic — press again to stop');
  } catch (err) { toast(`Mic unavailable: ${err.message}`, true); }
});
deck.addEventListener('mic', () => { $('#btn-mic').textContent = '🎙 Record mic'; $('#btn-mic').classList.remove('on'); });

function togglePlay() {
  engine.ensure();
  if (engine.playing) engine.stop(); else engine.start();
}
engine.addEventListener('state', () => {
  $('#btn-play').textContent = engine.playing ? '■' : '▶';
  $('#btn-play').classList.toggle('on', engine.playing);
  xr.drawMenu(menuState());
});
$('#btn-play').addEventListener('click', togglePlay);
$('#bpm').addEventListener('change', (e) => { engine.setBpm(+e.target.value); e.target.value = engine.bpm; });
$('#swing').addEventListener('input', (e) => { engine.swing = +e.target.value; });

function applyStyle(name, bpm) {
  const s = sequencer.applyStyle(name);
  $('#style').value = name;
  if (s?.bpm || bpm) { engine.setBpm(bpm || s.bpm); $('#bpm').value = engine.bpm; }
  if (s?.swing !== undefined) { engine.swing = s.swing; $('#swing').value = s.swing; }
  $('#synth-preset').value = sequencer.synth;
  syncKeySelect();
  autosave();
}
$('#style').addEventListener('change', (e) => applyStyle(e.target.value));

const keySel = $('#key');
['minor', 'major'].forEach((scale) => NOTE_NAMES.forEach((n, root) => keySel.append(new Option(`${n} ${scale}`, `${root}:${scale}`))));
function syncKeySelect() { keySel.value = `${sequencer.root}:${sequencer.scale}`; sequencer.refresh(); }
keySel.addEventListener('change', () => { const [r, s] = keySel.value.split(':'); sequencer.root = +r; sequencer.scale = s; sequencer.refresh(); });
$('#synth-preset').addEventListener('change', (e) => { sequencer.synth = e.target.value; });

$('#btn-rec').addEventListener('click', async () => {
  const b = $('#btn-rec');
  if (!b.classList.contains('on')) {
    engine.startRecording();
    b.classList.add('on');
    toast('Recording everything you hear — press ● again to stop');
  } else {
    b.classList.remove('on');
    const blob = await engine.stopRecording();
    if (blob) { download(blob, `nbrz-session-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`); toast('Session saved'); }
  }
});

$('#btn-wav').addEventListener('click', async () => {
  const btn = $('#btn-wav');
  btn.classList.add('busy');
  try {
    const bars = 4, sr = 44100, stepDur = 60 / engine.bpm / 4;
    const len = bars * 16 * stepDur + 2.5;
    const off = new OfflineAudioContext(2, Math.ceil(sr * len), sr);
    const graph = buildGraph(off);
    graph.setTempo(engine.bpm);
    graph.out.connect(off.destination);
    for (let i = 0; i < bars * 16; i++) {
      const s = i % 16;
      const t = 0.02 + i * stepDur + (s % 2 ? engine.swing * stepDur : 0);
      sequencer.playStep(graph, s, t);
      space.playStep(graph, s, t);
    }
    const rendered = await off.startRendering();
    download(encodeWav(rendered), `nbrz-beat-${engine.bpm}bpm.wav`, 'audio/wav');
    toast(`Bounced ${bars} bars at ${engine.bpm} BPM`);
  } catch (err) { toast(`Bounce failed: ${err.message}`, true); }
  finally { btn.classList.remove('busy'); }
});

$('#drawer-toggle').addEventListener('click', () => {
  const s = $('#studio');
  s.classList.toggle('collapsed');
  $('#drawer-toggle').textContent = s.classList.contains('collapsed') ? 'STUDIO ▾' : 'STUDIO ▴';
});

$('#btn-orbit-demo').addEventListener('click', async () => {
  await buildScene(space.starterParts());
  if (!engine.playing) togglePlay();
  toast('Starter beat placed — drag shapes around the ring to remix it');
});
$('#reactive-toggle').addEventListener('change', (e) => { space.reactive = e.target.checked; });

// Oscilloscope + deck waveform each frame.
const scope = $('#scope');
vp.onFrame(() => {
  if (!vp.renderer.xr.isPresenting) deck.draw();
  if (!engine.analyser) return;
  const g = scope.getContext('2d');
  engine.analyser.getByteTimeDomainData(engine.wave);
  g.clearRect(0, 0, scope.width, scope.height);
  g.strokeStyle = '#44D4E8';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < engine.wave.length; i += 4) {
    const x = (i / engine.wave.length) * scope.width, y = (engine.wave[i] / 255) * scope.height;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
});

// ── Perform: the 360° stage ────────────────────────────────
const stage = new PerformStage(vp, engine, sequencer, deck);
let skyOn = true;
let savedView = null;

function enterPerform() {
  vp.select([]);
  stage.show(true, { dome: skyOn && !xr.passthrough });
  if (xr.presenting) { xr.recenterStage(); return; }
  const { camera, orbit } = vp;
  savedView = { pos: camera.position.clone(), target: orbit.target.clone(), rotateSpeed: orbit.rotateSpeed, zoom: orbit.enableZoom, pan: orbit.enablePan, minDistance: orbit.minDistance, fov: camera.fov,
    mouse: { ...orbit.mouseButtons }, touches: { ...orbit.touches } };
  stage.placeAt(new THREE.Vector3(), 0);
  // Stand in the middle of the stage and look around (right-drag / two fingers).
  camera.position.set(0, 1.5, 0.001);
  orbit.target.set(0, 1.5, 0);
  camera.lookAt(0, 1.2, -1);
  orbit.enableZoom = false;
  orbit.enablePan = false;
  orbit.minDistance = 0;
  camera.fov = 75; // wide, like standing inside the stage
  camera.updateProjectionMatrix();
  orbit.rotateSpeed = -0.35;
  orbit.mouseButtons = { LEFT: null, MIDDLE: null, RIGHT: THREE.MOUSE.ROTATE };
  orbit.touches = { ONE: null, TWO: THREE.TOUCH.ROTATE };
  // Tilt the view down a little so the drum ring is visible.
  const look = new THREE.Vector3(0, -0.6, -1).normalize().multiplyScalar(0.001);
  camera.position.copy(orbit.target).sub(look);
}

function exitPerform() {
  stage.show(false);
  if (motion.running) toggleCamera();
  if (!savedView) return;
  const { camera, orbit } = vp;
  camera.position.copy(savedView.pos);
  camera.fov = savedView.fov;
  camera.updateProjectionMatrix();
  orbit.target.copy(savedView.target);
  Object.assign(orbit, { rotateSpeed: savedView.rotateSpeed, enableZoom: savedView.zoom, enablePan: savedView.pan, minDistance: savedView.minDistance, mouseButtons: savedView.mouse, touches: savedView.touches });
  savedView = null;
}

// Desktop / touch playing: pads, harp strokes, and an air synth on empty space.
{
  const AIR_LOW = 0.8, AIR_HIGH = 1.9;
  const gestures = new Map();
  const rayAt = (e) => {
    const r = vp.renderer.domElement.getBoundingClientRect();
    vp.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    vp.raycaster.setFromCamera(vp.pointer, vp.camera);
    return r;
  };
  const airParams = (e, r) => ({ y: AIR_HIGH - ((e.clientY - r.top) / r.height) * (AIR_HIGH - AIR_LOW), bright: (e.clientX - r.left) / r.width });
  vp.container.addEventListener('pointerdown', (e) => {
    if (mode !== 'perform' || xr.presenting || e.target !== vp.renderer.domElement || e.button !== 0) return;
    engine.ensure();
    const r = rayAt(e);
    const pad = stage.pickPad(vp.raycaster);
    if (pad >= 0) { stage.hitPad(pad, 0.9); return; }
    const string = stage.pickString(vp.raycaster);
    vp.renderer.domElement.setPointerCapture(e.pointerId);
    if (string >= 0) { stage.pluck(string); gestures.set(e.pointerId, { type: 'harp', last: string }); return; }
    const key = `ptr${e.pointerId}`;
    const { y, bright } = airParams(e, r);
    stage.airStart(key, y);
    stage.airMove(key, y, bright);
    gestures.set(e.pointerId, { type: 'air', key });
  }, { capture: true });
  vp.renderer.domElement.addEventListener('pointermove', (e) => {
    const g = gestures.get(e.pointerId);
    if (!g) return;
    const r = rayAt(e);
    if (g.type === 'harp') {
      const s = stage.pickString(vp.raycaster);
      if (s >= 0 && s !== g.last) stage.pluck(s);
      if (s >= 0) g.last = s;
    } else {
      const { y, bright } = airParams(e, r);
      stage.airMove(g.key, y, bright, 0.15);
    }
  });
  const end = (e) => {
    const g = gestures.get(e.pointerId);
    if (g?.type === 'air') stage.airEnd(g.key);
    gestures.delete(e.pointerId);
  };
  vp.renderer.domElement.addEventListener('pointerup', end);
  vp.renderer.domElement.addEventListener('pointercancel', end);
}

stage.addEventListener('tempo', (e) => {
  engine.setBpm(e.detail);
  $('#bpm').value = engine.bpm;
  toast(`Tempo from your nod: ${engine.bpm} BPM`);
});
function setCapture(on) { stage.capture = on; $('#capture-toggle').checked = on; if (on) toast(engine.playing ? 'Capturing — what you play is written into the sequencer' : 'Capture armed — press play, then perform'); xr.drawMenu(menuState()); }
function setNod(on) { stage.nodTempo = on; $('#nod-toggle').checked = on; xr.drawMenu(menuState()); }
function setSky(on) { skyOn = on; $('#sky-toggle').checked = on; stage.dome.visible = on && !xr.passthrough; xr.drawMenu(menuState()); }
$('#capture-toggle').addEventListener('change', (e) => setCapture(e.target.checked));
$('#nod-toggle').addEventListener('change', (e) => setNod(e.target.checked));
$('#sky-toggle').addEventListener('change', (e) => setSky(e.target.checked));

// Motion stage (webcam)
const motion = new MotionStage(engine, sequencer, { video: $('#motion-video'), overlay: $('#motion-overlay') });
motion.addEventListener('hit', (e) => stage.captureEvent(e.detail.drum ? { drum: e.detail.drum } : { note: e.detail.degree }));
async function toggleCamera() {
  const btn = $('#btn-camera');
  if (motion.running) {
    motion.stop();
    $('#motion-panel').hidden = true;
    btn.textContent = 'Start camera';
    return;
  }
  try {
    $('#motion-panel').hidden = false;
    await motion.start();
    btn.textContent = 'Stop camera';
    toast('Move in a zone to play it — wave high for notes, low for drums');
  } catch (err) {
    $('#motion-panel').hidden = true;
    toast(`Camera unavailable: ${err.message}`, true);
  }
}
$('#btn-camera').addEventListener('click', toggleCamera);
$('#motion-sens').addEventListener('input', (e) => { motion.sensitivity = +e.target.value; });
$('#motion-fx').addEventListener('change', (e) => { motion.bodyFx = e.target.checked; if (!e.target.checked) engine.graph?.setFx({ brightness: 1 }); });

// ── VR / mixed reality ─────────────────────────────────────
const xr = new XRRig(vp, {
  message: (m) => toast(m, true),
  stage,
  layout: () => layoutWorld(),
  getMode: () => mode,
  sculptor,
  spawn: (kind, pos) => spawn(kind, pos),
  trigger: (obj, vel) => space.trigger(obj, vel),
  grabEnd: () => commit(),
  run: (action) => {
    if (action.startsWith('mode:')) setMode(action.slice(5));
    else if (action === 'play') togglePlay();
    else if (action === 'undo') history.undo();
    else if (action === 'redo') history.redo();
    else if (action === 'capture') setCapture(!stage.capture);
    else if (action === 'nod') setNod(!stage.nodTempo);
    else if (action === 'sky') setSky(!skyOn);
    else OPS[action]?.();
  },
});
xr.addButtons($('#vr-slot'));

// ── Start ──────────────────────────────────────────────────
async function starterScene() {
  const pedestal = createMesh('cylinder', { color: '#111517', finish: 'satin', name: 'Pedestal' });
  pedestal.scale.set(1.6, 0.25, 1.6);
  pedestal.position.y = 0.0375;
  const logo = await createShape('text', { text: 'NBRZ', color: '#44D4E8', finish: 'neon', name: 'NBRZ logo' });
  logo.scale.setScalar(1.3);
  logo.position.set(0, 0.155, 0);
  const gem = createMesh('gem', { color: '#8EF0A4', finish: 'glass', name: 'Gem' });
  gem.scale.setScalar(0.45);
  gem.position.set(0.32, 0.075, 0.12);
  content.add(pedestal, logo, gem);
}

applyStyle('nbrz');
setMode('build');
try {
  const saved = localStorage.getItem('nbrz-forge-autosave');
  if (saved) loadProject(JSON.parse(saved), { quiet: true });
} catch { /* ignore a corrupt autosave */ }
if (!content.children.length) await starterScene();
history.reset();
refreshUI();
// Expose for debugging in the console.
window.forge = { vp, history, engine, sequencer, deck, space, stage, motion, xr, OPS, setMode, buildScene, parsePrompt, makeMaterial };
