// Primitive shapes, materials and finishes.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

export const PALETTE = ['#8EF0A4', '#44D4E8', '#2B9EFF', '#f0f0f0', '#ff4d6d', '#ffb347', '#b388ff', '#2a2f33'];

// Finishes map to PBR settings so non-experts get good-looking results with one click.
export const FINISHES = {
  matte:  { roughness: 0.85, metalness: 0.0 },
  satin:  { roughness: 0.45, metalness: 0.05 },
  gloss:  { roughness: 0.12, metalness: 0.0 },
  metal:  { roughness: 0.35, metalness: 0.9 },
  chrome: { roughness: 0.04, metalness: 1.0 },
  glass:  { roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.35 },
  neon:   { roughness: 0.4, metalness: 0.0, emissive: 1.6 },
};

export function makeMaterial(color = '#44D4E8', finish = 'satin') {
  const mat = new THREE.MeshStandardMaterial({ color });
  applyFinish(mat, finish);
  return mat;
}

export function applyFinish(mat, finish) {
  const f = FINISHES[finish] || FINISHES.satin;
  mat.roughness = f.roughness;
  mat.metalness = f.metalness;
  mat.transparent = !!f.transparent;
  mat.opacity = f.opacity ?? 1;
  mat.depthWrite = !f.transparent;
  mat.emissive = new THREE.Color(f.emissive ? mat.color : 0x000000);
  mat.emissiveIntensity = f.emissive || 1;
  mat.userData.finish = finish;
  mat.userData.baseEmissive = mat.emissiveIntensity;
  mat.needsUpdate = true;
}

// Strip the "parametric" type so transformed geometry serializes as raw vertex data.
export function plain(geo) {
  const g = new THREE.BufferGeometry();
  g.copy(geo);
  return g;
}

// Each entry: label, icon, geometry factory. Sizes are in metres (≈30 cm default) so
// objects look life-sized on a table in VR.
export const SHAPES = {
  cube:     { label: 'Cube',     icon: '■', geo: () => new THREE.BoxGeometry(0.3, 0.3, 0.3, 6, 6, 6) },
  sphere:   { label: 'Sphere',   icon: '●', geo: () => new THREE.SphereGeometry(0.17, 48, 32) },
  cylinder: { label: 'Cylinder', icon: '▮', geo: () => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 48, 6) },
  cone:     { label: 'Cone',     icon: '▲', geo: () => new THREE.ConeGeometry(0.16, 0.32, 48, 6) },
  pyramid:  { label: 'Pyramid',  icon: '△', geo: () => plain(new THREE.ConeGeometry(0.2, 0.3, 4, 4).rotateY(Math.PI / 4)) },
  torus:    { label: 'Torus',    icon: '◯', geo: () => new THREE.TorusGeometry(0.13, 0.045, 24, 72) },
  capsule:  { label: 'Capsule',  icon: '⬮', geo: () => new THREE.CapsuleGeometry(0.1, 0.18, 12, 32) },
  gem:      { label: 'Gem',      icon: '◆', geo: () => new THREE.IcosahedronGeometry(0.16, 0), flat: true },
  prism:    { label: 'Hex',      icon: '⬢', geo: () => new THREE.CylinderGeometry(0.16, 0.16, 0.3, 6, 4), flat: true },
  knot:     { label: 'Knot',     icon: '∞', geo: () => new THREE.TorusKnotGeometry(0.1, 0.034, 160, 20) },
  plane:    { label: 'Terrain',  icon: '▭', geo: () => plain(new THREE.PlaneGeometry(0.8, 0.8, 48, 48).rotateX(-Math.PI / 2)) },
  text:     { label: 'Text',     icon: 'T',  geo: null },
};

let fontPromise = null;
export function loadFont() {
  fontPromise ??= new Promise((resolve, reject) =>
    new FontLoader().load('vendor/three/fonts/helvetiker_bold.typeface.json', resolve, undefined, reject));
  return fontPromise;
}

export async function textGeometry(text) {
  const font = await loadFont();
  const geo = new TextGeometry(text || 'NBRZ', {
    font, size: 0.12, depth: 0.04, curveSegments: 6,
    bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2,
  });
  geo.center();
  return plain(geo);
}

let counter = 0;

export function createMesh(kind, { color, finish = 'satin', geometry, name } = {}) {
  const def = SHAPES[kind];
  const geo = geometry || def?.geo?.() || new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mat = makeMaterial(color || PALETTE[counter % 3], finish);
  if (def?.flat) mat.flatShading = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name || `${def?.label || 'Shape'} ${++counter}`;
  mesh.userData = { kind, sound: 'auto', rev: 0 };
  return mesh;
}

export async function createShape(kind, opts = {}) {
  if (kind === 'text') {
    const geometry = await textGeometry(opts.text);
    return createMesh('text', { ...opts, geometry, name: opts.name || `Text “${opts.text || 'NBRZ'}”` });
  }
  return createMesh(kind, opts);
}

// Rests an object on its parent's floor (local y = 0) without changing x/z.
// Works in world space so it stays correct when the workspace is moved/scaled in VR.
export function dropToFloor(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const parent = obj.parent;
  const floorY = parent ? parent.localToWorld(new THREE.Vector3()).y : 0;
  const scale = parent ? parent.getWorldScale(new THREE.Vector3()).y : 1;
  obj.position.y -= (box.min.y - floorY) / scale;
}
