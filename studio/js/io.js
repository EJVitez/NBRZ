// Import (GLB/GLTF/OBJ/STL/FBX) and export (STL for printing, GLB/OBJ for games and film).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { makeMaterial, dropToFloor } from './shapes.js';
import { bakeGeometry } from './tools.js';

export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Fit an imported object to roughly `size` metres and rest it on the floor.
function normalize(obj, size = 0.5) {
  const box = new THREE.Box3().setFromObject(obj);
  const dim = box.getSize(new THREE.Vector3());
  const longest = Math.max(dim.x, dim.y, dim.z);
  if (longest > 0 && (longest > size * 4 || longest < size / 10)) obj.scale.multiplyScalar(size / longest);
  obj.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
}

export async function importModel(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  let obj;
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
    obj = gltf.scene;
  } else if (ext === 'obj') {
    obj = new OBJLoader().parse(await file.text());
    obj.traverse((m) => { if (m.isMesh && !m.material?.isMeshStandardMaterial) m.material = makeMaterial('#d8dde0', 'satin'); });
  } else if (ext === 'stl') {
    const geo = new STLLoader().parse(await file.arrayBuffer());
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2); // STL files are usually Z-up
    obj = new THREE.Mesh(geo, makeMaterial('#d8dde0', 'satin'));
  } else if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    obj = new FBXLoader().parse(await file.arrayBuffer(), '');
  } else {
    throw new Error(`Unsupported file type .${ext}`);
  }
  obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  // Wrap so the import moves as one object and keeps its internal hierarchy.
  const wrap = obj.isMesh ? obj : new THREE.Group().add(obj);
  wrap.name = name;
  wrap.userData = { kind: obj.isMesh ? 'mesh' : 'import', sound: 'auto', rev: 0 };
  normalize(wrap);
  return wrap;
}

function exportRoot(objects) {
  const root = new THREE.Group();
  objects.filter((o) => o.visible).forEach((o) => root.add(o.clone()));
  return root;
}

export async function exportGLB(objects, filename = 'nbrz-forge.glb') {
  const data = await new GLTFExporter().parseAsync(exportRoot(objects), { binary: true, onlyVisible: true });
  download(data, filename, 'model/gltf-binary');
}

export function exportOBJ(objects, filename = 'nbrz-forge.obj') {
  download(new OBJExporter().parse(exportRoot(objects)), filename, 'text/plain');
}

// One welded solid in millimetres, Z-up, sitting on the build plate.
export function exportSTL(objects, { longestMM = 80, realScale = false } = {}, filename = 'nbrz-forge.stl') {
  const parts = objects.filter((o) => o.visible).map((o) => bakeGeometry(o, ['position', 'normal'])).filter(Boolean);
  if (!parts.length) throw new Error('Nothing to export.');
  const mesh = new THREE.Mesh(parts.length === 1 ? parts[0] : mergeAll(parts));
  const geo = mesh.geometry;
  geo.rotateX(Math.PI / 2); // Y-up → Z-up (a proper rotation, so winding stays valid)
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const scale = realScale ? 1000 : longestMM / Math.max(size.x, size.y, size.z);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  geo.computeBoundingBox();
  download(new STLExporter().parse(mesh, { binary: true }), filename, 'model/stl');
  const out = geo.boundingBox.getSize(new THREE.Vector3());
  return { x: out.x, y: out.y, z: out.z, triangles: geo.attributes.position.count / 3 };
}

function mergeAll(parts) {
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

export { dropToFloor };
