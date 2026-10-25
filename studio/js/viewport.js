// Renderer, camera, lights, grid, orbit + gizmo controls and picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Viewport extends EventTarget {
  constructor(container) {
    super();
    this.container = container;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: passthrough needs a transparent framebuffer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.xr.enabled = true;
    container.prepend(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050607);
    scene.fog = new THREE.Fog(0x050607, 6, 18);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Everything the user builds lives in `world` → `content`. In VR the world group is
    // lifted to table height; on desktop it sits at the origin.
    this.world = new THREE.Group();
    this.world.name = 'world';
    this.content = new THREE.Group();
    this.content.name = 'content';
    this.world.add(this.content);
    scene.add(this.world);

    const camera = this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(1.1, 0.9, 1.4);

    const hemi = new THREE.HemisphereLight(0xcfefff, 0x101418, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
    key.shadow.bias = -0.0005;
    const rim = new THREE.DirectionalLight(0x44d4e8, 0.8);
    rim.position.set(-3, 2, -2);
    scene.add(hemi, key, rim);

    // Grid: 10 cm cells, 4 m wide. Shadow catcher under it.
    const grid = this.grid = new THREE.GridHelper(4, 40, 0x1f4b52, 0x14191c);
    grid.material.transparent = true;
    grid.material.opacity = 0.8;
    this.world.add(grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.floor = floor;
    this.world.add(floor);

    // Controls
    const orbit = this.orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.15, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.maxDistance = 20;
    orbit.minDistance = 0.1;

    const gizmo = this.gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.85);
    scene.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      if (!e.value) this.dispatchEvent(new Event('transform-end'));
    });
    gizmo.addEventListener('objectChange', () => this.dispatchEvent(new Event('transform')));
    this.setSnap(true);

    this.selection = [];
    this.helpers = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.frameCallbacks = new Set();

    this.#bindPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    const clock = new THREE.Clock();
    renderer.setAnimationLoop((t, frame) => {
      const dt = Math.min(clock.getDelta(), 0.1);
      if (!renderer.xr.isPresenting) orbit.update();
      this.frameCallbacks.forEach((cb) => cb(dt, t, frame));
      this.helpers.forEach((h) => h.update());
      renderer.render(scene, camera);
    });
  }

  onFrame(cb) { this.frameCallbacks.add(cb); }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h || this.renderer.xr.isPresenting) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSnap(on) {
    this.gizmo.setTranslationSnap(on ? 0.05 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.05 : null);
  }

  // ── Selection ────────────────────────────────────────────
  select(objs, additive = false) {
    objs = (Array.isArray(objs) ? objs : [objs]).filter(Boolean);
    let next = additive ? [...this.selection] : [];
    for (const o of objs) {
      const i = next.indexOf(o);
      if (additive && i >= 0) next.splice(i, 1); else if (i < 0) next.push(o);
    }
    this.selection = next;
    this.helpers.forEach((h) => { this.scene.remove(h); h.dispose(); });
    this.helpers.clear();
    next.forEach((o, i) => {
      const h = new THREE.BoxHelper(o, i === 0 ? 0x44d4e8 : 0x8ef0a4);
      h.material.depthTest = false;
      h.material.transparent = true;
      h.renderOrder = 999;
      this.helpers.set(o, h);
      this.scene.add(h);
    });
    if (next.length && this.mode !== 'sculpt' && this.mode !== 'perform' && !this.renderer.xr.isPresenting) this.gizmo.attach(next[0]); else this.gizmo.detach();
    this.dispatchEvent(new Event('selection'));
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'sculpt' || mode === 'perform' || this.renderer.xr.isPresenting) this.gizmo.detach();
    else if (this.selection[0]) this.gizmo.attach(this.selection[0]);
  }

  // Top-level content object under a screen point.
  pick(clientX, clientY, targets = this.content.children) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(targets, true).filter((h) => h.object.visible && !h.object.userData.noPick);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj.parent && obj.parent !== this.content) obj = obj.parent;
    return obj.parent === this.content ? { object: obj, hit: hits[0] } : null;
  }

  #bindPicking() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || this.gizmo.dragging || this.mode === 'sculpt' || this.mode === 'perform') return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || e.button !== 0) return;
      const res = this.pick(e.clientX, e.clientY);
      if (res) this.select(res.object, e.shiftKey || e.metaKey || e.ctrlKey);
      else if (!e.shiftKey) this.select([]);
    });
  }

  frameSelection() {
    const targets = this.selection.length ? this.selection : this.content.children;
    if (!targets.length) return;
    const box = new THREE.Box3();
    targets.forEach((o) => box.expandByObject(o));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 0.5;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, size * 1.6 + 0.2);
  }
}
