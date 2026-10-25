// Modeling operations: clone, mirror, arrays, booleans, decimate, subdivide.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { dropToFloor } from './shapes.js';

export function deepClone(obj) {
  const c = obj.clone();
  c.traverse((m) => {
    if (!m.isMesh) return;
    m.geometry = m.geometry.clone();
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  });
  c.userData.rev = 0;
  return c;
}

export function triangleCount(root) {
  let n = 0;
  root.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

// Bake an object (and any children) into one geometry expressed in its parent's space.
export function bakeGeometry(obj, attributes = ['position', 'normal']) {
  const parentInv = new THREE.Matrix4();
  if (obj.parent) { obj.parent.updateMatrixWorld(true); parentInv.copy(obj.parent.matrixWorld).invert(); }
  obj.updateMatrixWorld(true);
  const parts = [];
  obj.traverse((m) => {
    if (!m.isMesh || !m.visible) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!attributes.includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal && attributes.includes('normal')) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(parentInv, m.matrixWorld));
    parts.push(g);
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

// Move geometry so its bounding-box center is the origin; returns the old center.
export function recenter(geo) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  return c;
}

function firstMaterial(obj) {
  let mat = null;
  obj.traverse((m) => { if (!mat && m.isMesh) mat = Array.isArray(m.material) ? m.material[0] : m.material; });
  return mat ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0x44d4e8 });
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;

export function boolean(objs, op) {
  const [base, ...tools] = objs;
  const opCode = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[op];
  const toBrush = (o) => {
    const b = new Brush(bakeGeometry(o));
    b.updateMatrixWorld();
    return b;
  };
  let result = toBrush(base);
  for (const t of tools) result = evaluator.evaluate(result, toBrush(t), opCode);
  const geo = result.geometry;
  if (!geo.attributes.position.count) throw new Error('The result is empty — the shapes may not overlap.');
  const center = recenter(geo);
  const mat = firstMaterial(base);
  mat.flatShading = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `${base.name} ${op}`;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData = { kind: 'mesh', sound: base.userData.sound || 'auto', rev: 0 };
  mesh.position.copy(center);
  return mesh;
}

// Mirror across the content X axis, baking the flip into vertices so exports stay manifold
// with correct outward normals.
export function mirror(obj) {
  const c = deepClone(obj);
  c.position.x = -c.position.x;
  if (c.isMesh) {
    // Bake rotation + scale into the vertices, flip X, then reset the transform.
    const g = c.geometry.index ? c.geometry.toNonIndexed() : new THREE.BufferGeometry().copy(c.geometry);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), c.quaternion, c.scale));
    g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
    flipWinding(g);
    g.computeVertexNormals();
    c.geometry = g;
    c.rotation.set(0, 0, 0);
    c.scale.set(1, 1, 1);
  } else {
    c.scale.x = -c.scale.x;
  }
  c.name = `${obj.name} mirror`;
  return c;
}

function flipWinding(g) {
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array, s = attr.itemSize;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = a[(i + 1) * s + k];
        a[(i + 1) * s + k] = a[(i + 2) * s + k];
        a[(i + 2) * s + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

export function radialArray(obj, count = 8) {
  const r = Math.hypot(obj.position.x, obj.position.z) > 0.05 ? Math.hypot(obj.position.x, obj.position.z) : 0.45;
  const start = Math.atan2(obj.position.z, obj.position.x) || 0;
  const out = [];
  for (let i = 1; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2;
    const c = deepClone(obj);
    c.position.set(Math.cos(a) * r, obj.position.y, Math.sin(a) * r);
    c.rotation.y = obj.rotation.y - (a - start);
    c.name = `${obj.name} ${i + 1}`;
    out.push(c);
  }
  if (Math.hypot(obj.position.x, obj.position.z) <= 0.05) obj.position.set(Math.cos(start) * r, obj.position.y, Math.sin(start) * r);
  return out;
}

export function linearArray(obj, count = 5) {
  const box = new THREE.Box3().setFromObject(obj);
  const step = (box.max.x - box.min.x) * 1.2 || 0.35;
  const out = [];
  for (let i = 1; i < count; i++) {
    const c = deepClone(obj);
    c.position.x += step * i;
    c.name = `${obj.name} ${i + 1}`;
    out.push(c);
  }
  return out;
}

// Positions-only, welded geometry: required for sculpting and decimation so neighbouring
// faces move together instead of tearing at UV seams.
export function weld(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const merged = mergeVertices(g, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

export function decimate(mesh, ratio = 0.5) {
  const g = weld(mesh.geometry);
  const remove = Math.floor(g.attributes.position.count * ratio);
  if (remove < 4) return false;
  const out = new SimplifyModifier().modify(g, remove);
  out.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = out;
  return true;
}

// Loop-free midpoint subdivision (each triangle → 4) on welded geometry.
export function subdivide(geo, maxTris = 300000) {
  const g = geo.index && !geo.attributes.normal ? geo : weld(geo);
  const pos = g.attributes.position.array;
  const idx = g.index.array;
  if ((idx.length / 3) * 4 > maxTris) return null;
  const verts = Array.from(pos);
  const cache = new Map();
  const mid = (a, b) => {
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    let m = cache.get(k);
    if (m === undefined) {
      m = verts.length / 3;
      verts.push((verts[a * 3] + verts[b * 3]) / 2, (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2, (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2);
      cache.set(k, m);
    }
    return m;
  };
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const res = new THREE.BufferGeometry();
  res.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  res.setIndex(out);
  res.computeVertexNormals();
  return res;
}

export { dropToFloor };
