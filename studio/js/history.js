// Undo / redo by snapshotting the content group.
// Each object is serialized once per revision (userData.rev); transform-only changes just
// store a matrix, so undo stays fast even with large imported models.
import * as THREE from 'three';

const MAX = 60;
const loader = new THREE.ObjectLoader();

export class History {
  constructor(content, onRestore) {
    this.content = content;
    this.onRestore = onRestore;
    this.stack = [];
    this.index = -1;
    this.json = new Map();   // "uuid:rev" → serialized object
    this.live = new Map();   // uuid → most recent instance (kept after deletion for fast redo)
  }

  key(obj) { return `${obj.uuid}:${obj.userData.rev || 0}`; }

  // Call after geometry or material of an object changes, before push().
  bump(obj) { obj.userData.rev = (obj.userData.rev || 0) + 1; }

  serialize(obj) {
    const k = this.key(obj);
    if (!this.json.has(k)) {
      // Serialize without the transform; it is stored separately per snapshot.
      const m = obj.matrix.clone();
      obj.matrix.identity();
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      this.json.set(k, obj.toJSON());
      m.decompose(obj.position, obj.quaternion, obj.scale);
      obj.updateMatrix();
    }
    this.live.set(obj.uuid, obj);
    return k;
  }

  snapshot() {
    return this.content.children.map((o) => {
      o.updateMatrix();
      return { key: this.serialize(o), uuid: o.uuid, rev: o.userData.rev || 0, m: o.matrix.toArray(), visible: o.visible };
    });
  }

  push() {
    this.stack.length = this.index + 1;
    this.stack.push(this.snapshot());
    if (this.stack.length > MAX) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  reset() {
    this.stack = [];
    this.index = -1;
    this.push();
  }

  undo() { if (this.index > 0) this.restore(this.stack[--this.index]); }
  redo() { if (this.index < this.stack.length - 1) this.restore(this.stack[++this.index]); }

  restore(snap) {
    const next = snap.map((e) => {
      let obj = this.live.get(e.uuid);
      if (!obj || (obj.userData.rev || 0) !== e.rev) {
        obj = loader.parse(this.json.get(e.key));
        this.live.set(e.uuid, obj);
      }
      new THREE.Matrix4().fromArray(e.m).decompose(obj.position, obj.quaternion, obj.scale);
      obj.visible = e.visible;
      return obj;
    });
    this.content.clear();
    next.forEach((o) => this.content.add(o));
    this.onRestore?.();
  }
}
