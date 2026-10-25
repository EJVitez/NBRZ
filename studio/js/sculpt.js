// Brush sculpting: inflate, dent, smooth and flatten on any mesh.
import * as THREE from 'three';
import { weld, subdivide } from './tools.js';

const TARGET_TRIS = 40000;

export class Sculptor {
  constructor(viewport, { onStrokeEnd, getSettings }) {
    this.vp = viewport;
    this.onStrokeEnd = onStrokeEnd;
    this.getSettings = getSettings;
    this.active = null;

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x44d4e8, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
    );
    this.cursor.renderOrder = 1000;
    this.cursor.visible = false;
    this.cursor.userData.noPick = true;
    viewport.scene.add(this.cursor);
    this.#bind();
  }

  // Make a mesh sculptable: welded positions and enough triangles for detail.
  prepare(mesh) {
    if (mesh.userData.sculptReady) return true;
    if (!mesh.isMesh) return false;
    let g = weld(mesh.geometry);
    while (g.index.count / 3 < TARGET_TRIS / 4) {
      const next = subdivide(g, TARGET_TRIS);
      if (!next) break;
      g = next;
    }
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.material.flatShading = false;
    mesh.material.needsUpdate = true;
    mesh.userData.sculptReady = true;
    return true;
  }

  densify(mesh) {
    this.prepare(mesh);
    const g = subdivide(mesh.geometry, 400000);
    if (!g) return false;
    mesh.geometry.dispose();
    mesh.geometry = g;
    mesh.userData.sculptReady = true;
    return true;
  }

  begin(mesh) {
    this.prepare(mesh);
    const g = mesh.geometry;
    const n = g.attributes.position.count;
    // Neighbour lists for smoothing, built once per stroke.
    const idx = g.index.array;
    const sets = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
    }
    this.active = { mesh, neighbors: sets.map((s) => Uint32Array.from(s)), dirty: false };
  }

  end() {
    if (!this.active) return;
    const { mesh, dirty } = this.active;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    this.active = null;
    if (dirty) this.onStrokeEnd?.(mesh);
  }

  // Apply one dab at a world-space point. Used by mouse and by VR controllers.
  dab(worldPoint, worldNormal) {
    if (!this.active) return;
    const { mesh, neighbors } = this.active;
    const { radius, strength, mode, symmetry } = this.getSettings();
    mesh.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const p = worldPoint.clone().applyMatrix4(inv);
    const nrm = worldNormal.clone().transformDirection(inv).normalize();
    const s = mesh.getWorldScale(new THREE.Vector3());
    const r = radius / ((s.x + s.y + s.z) / 3);
    this.#apply(mesh, neighbors, p, nrm, r, strength, mode);
    if (symmetry && Math.abs(p.x) > r * 0.25) {
      this.#apply(mesh, neighbors, new THREE.Vector3(-p.x, p.y, p.z), new THREE.Vector3(-nrm.x, nrm.y, nrm.z), r, strength, mode);
    }
    const g = mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    this.active.dirty = true;
  }

  #apply(mesh, neighbors, p, nrm, r, strength, mode) {
    const pos = mesh.geometry.attributes.position;
    const a = pos.array;
    const r2 = r * r;
    const amt = strength * r * 0.12;
    const touched = [];
    for (let i = 0; i < pos.count; i++) {
      const dx = a[i * 3] - p.x, dy = a[i * 3 + 1] - p.y, dz = a[i * 3 + 2] - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2) touched.push(i, 1 - Math.sqrt(d2) / r);
    }
    if (mode === 'smooth') {
      const copy = new Float32Array(touched.length / 2 * 3);
      for (let t = 0; t < touched.length; t += 2) {
        const i = touched[t], nb = neighbors[i];
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < nb.length; k++) { x += a[nb[k] * 3]; y += a[nb[k] * 3 + 1]; z += a[nb[k] * 3 + 2]; }
        const f = Math.min(1, touched[t + 1] * strength * 1.5);
        const j = t / 2 * 3, l = nb.length || 1;
        copy[j] = a[i * 3] + (x / l - a[i * 3]) * f;
        copy[j + 1] = a[i * 3 + 1] + (y / l - a[i * 3 + 1]) * f;
        copy[j + 2] = a[i * 3 + 2] + (z / l - a[i * 3 + 2]) * f;
      }
      for (let t = 0; t < touched.length; t += 2) {
        const i = touched[t], j = t / 2 * 3;
        a[i * 3] = copy[j]; a[i * 3 + 1] = copy[j + 1]; a[i * 3 + 2] = copy[j + 2];
      }
      return;
    }
    const nAttr = mesh.geometry.attributes.normal;
    for (let t = 0; t < touched.length; t += 2) {
      const i = touched[t];
      const f = touched[t + 1] * touched[t + 1] * (3 - 2 * touched[t + 1]); // smoothstep falloff
      if (mode === 'flatten') {
        const dist = (a[i * 3] - p.x) * nrm.x + (a[i * 3 + 1] - p.y) * nrm.y + (a[i * 3 + 2] - p.z) * nrm.z;
        const k = dist * f * strength * 0.5;
        a[i * 3] -= nrm.x * k; a[i * 3 + 1] -= nrm.y * k; a[i * 3 + 2] -= nrm.z * k;
      } else {
        const dir = mode === 'deflate' ? -1 : 1;
        const nx = nAttr ? nAttr.array[i * 3] : nrm.x, ny = nAttr ? nAttr.array[i * 3 + 1] : nrm.y, nz = nAttr ? nAttr.array[i * 3 + 2] : nrm.z;
        a[i * 3] += nx * amt * f * dir; a[i * 3 + 1] += ny * amt * f * dir; a[i * 3 + 2] += nz * amt * f * dir;
      }
    }
  }

  #bind() {
    const el = this.vp.renderer.domElement;
    const target = () => this.vp.selection.find((o) => o.isMesh);
    const hitTest = (e) => {
      const mesh = target();
      if (!mesh) return null;
      const res = this.vp.pick(e.clientX, e.clientY, [mesh]);
      return res && res.hit.face ? { mesh, hit: res.hit } : null;
    };
    const worldNormal = (hit) => hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const showCursor = (hit) => {
      if (!hit) { this.cursor.visible = false; return; }
      const n = worldNormal(hit);
      this.cursor.position.copy(hit.point).addScaledVector(n, 0.002);
      this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.cursor.scale.setScalar(this.getSettings().radius);
      this.cursor.visible = true;
    };

    // Capture phase on the container so the orbit controls are disabled before they see
    // the event (otherwise a stroke would also spin the camera).
    this.vp.container.addEventListener('pointerdown', (e) => {
      if (e.target !== el || this.vp.mode !== 'sculpt' || e.button !== 0 || e.altKey) return;
      const res = hitTest(e);
      if (!res) {
        // Click on another object switches the sculpt target.
        const other = this.vp.pick(e.clientX, e.clientY);
        if (other) this.vp.select(other.object);
        return;
      }
      this.vp.orbit.enabled = false;
      el.setPointerCapture(e.pointerId);
      this.begin(res.mesh);
      const again = hitTest(e); // geometry may have been subdivided by begin()
      if (again) this.dab(again.hit.point, worldNormal(again.hit));
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      if (this.vp.mode !== 'sculpt') { this.cursor.visible = false; return; }
      const res = hitTest(e);
      showCursor(res?.hit);
      if (this.active && res) this.dab(res.hit.point, worldNormal(res.hit));
    });
    const stop = () => {
      if (!this.active) return;
      this.end();
      this.vp.orbit.enabled = true;
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', () => { this.cursor.visible = false; });
  }
}
