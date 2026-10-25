// Meta Quest 3 / WebXR: VR and passthrough mixed reality, with controllers or bare hands.
//
// Build / Sculpt / Sound
//   Trigger (or pinch)        grab shapes, press wrist-menu buttons, sculpt where you point
//   Grip (one hand)           move the whole workspace
//   Grip (both hands)         scale + turn the workspace
//   Grab a shape + other grip resize that shape
//   Sound mode                hit shapes with your hands to play them
// Perform (360° stage around your body — see perform/stage.js)
//   Hands / fingertips        strike the drum ring, sweep through the light harp
//   Trigger (or pinch) held   air synth: hand height = pitch, reach = brightness
//   Left grip                 raise / lower to sweep a filter over the whole mix
//   Right grip                push your hand out to throw echo
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const MENU = [
  ['Cube', 'spawn:cube'], ['Sphere', 'spawn:sphere'], ['Cylinder', 'spawn:cylinder'], ['Cone', 'spawn:cone'],
  ['Torus', 'spawn:torus'], ['Gem', 'spawn:gem'], ['Pyramid', 'spawn:pyramid'], ['Text', 'spawn:text'],
  ['BUILD', 'mode:build'], ['SCULPT', 'mode:sculpt'], ['SOUND', 'mode:sound'], ['PERFORM', 'mode:perform'],
  ['▶ / ■', 'play'], ['CAPTURE', 'capture'], ['NOD BPM', 'nod'], ['SKY', 'sky'],
  ['Copy', 'duplicate'], ['Delete', 'delete'], ['Undo', 'undo'], ['Redo', 'redo'],
];
const COLS = 4, ROWS = MENU.length / COLS, CELL = 128;

export class XRRig {
  constructor(viewport, actions) {
    this.vp = viewport;
    this.actions = actions;
    this.renderer = viewport.renderer;
    this.hands = [];
    this.raycaster = new THREE.Raycaster();
    this.tmpMat = new THREE.Matrix4();
    this.clock = 0;
    this.#setupControllers();
    this.#buildMenu();
    this.renderer.xr.addEventListener('sessionstart', () => this.#onStart());
    this.renderer.xr.addEventListener('sessionend', () => this.#onEnd());
    viewport.onFrame((dt) => this.#frame(dt));
    actions.stage.addEventListener('haptic', (e) => {
      const h = this.hands.find((x) => this.#key(x) === e.detail.key);
      if (h) this.pulse(h, e.detail.strength, 25);
    });
  }

  get presenting() { return this.renderer.xr.isPresenting; }
  get passthrough() { return this.presenting && this.mode === 'immersive-ar'; }

  async addButtons(slot) {
    if (!navigator.xr) return;
    const make = async (mode, label, title) => {
      const ok = await navigator.xr.isSessionSupported(mode).catch(() => false);
      if (!ok) return;
      const b = document.createElement('button');
      b.className = 'btn xr-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => this.enter(mode).catch((e) => this.actions.message?.(`Couldn’t start XR: ${e.message}`)));
      slot.append(b);
    };
    await make('immersive-vr', 'Enter VR', 'Step into the 360° studio in your headset');
    await make('immersive-ar', 'Passthrough', 'Mixed reality: the studio in your real room (Quest 3)');
  }

  async enter(mode) {
    if (this.presenting) return;
    this.mode = mode;
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
  }

  // Ask for the Perform stage to be re-centred on the player on the next frame.
  recenterStage() { this.needPlace = true; }

  #onStart() {
    const { scene } = this.vp;
    this.saved = { bg: scene.background, fog: scene.fog };
    if (this.mode === 'immersive-ar') { scene.background = null; scene.fog = null; this.vp.floor.material.opacity = 0.2; }
    this.vp.gizmo.detach();
    this.menu.visible = true;
    this.actions.layout();
    this.needPlace = true;
  }

  #onEnd() {
    const { scene } = this.vp;
    scene.background = this.saved.bg;
    scene.fog = this.saved.fog;
    this.vp.floor.material.opacity = 0.35;
    this.menu.visible = false;
    this.hands.forEach((h) => { if (h.air) this.actions.stage.airEnd(this.#key(h)); h.air = h.fx = false; });
    this.actions.stage.resetFx();
    this.actions.layout();
    this.vp.resize();
    this.vp.select(this.vp.selection);
  }

  #key(h) { return h.handedness || `hand${h.i}`; }

  #setupControllers() {
    const xr = this.renderer.xr;
    const modelFactory = new XRControllerModelFactory();
    const handFactory = new XRHandModelFactory();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    for (let i = 0; i < 2; i++) {
      const ctrl = xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x44d4e8, transparent: true, opacity: 0.8 }));
      line.scale.z = 1.5;
      ctrl.add(line);
      const grip = xr.getControllerGrip(i);
      grip.add(modelFactory.createControllerModel(grip));
      const hand = xr.getHand(i);
      hand.add(handFactory.createHandModel(hand, 'mesh'));
      const h = { i, ctrl, grip, line, hand, grabbed: null, squeezing: false, lastPos: new THREE.Vector3(), vel: new THREE.Vector3(), inside: new Set() };
      ctrl.addEventListener('connected', (e) => {
        h.handedness = e.data.handedness;
        h.gamepad = e.data.gamepad;
        h.isHand = !!e.data.hand;
        if (h.handedness === 'left') this.#attachMenu(h);
      });
      ctrl.addEventListener('selectstart', () => this.#selectStart(h));
      ctrl.addEventListener('selectend', () => this.#selectEnd(h));
      ctrl.addEventListener('squeezestart', () => { h.squeezing = true; this.#squeezeChanged(h); });
      ctrl.addEventListener('squeezeend', () => { h.squeezing = false; this.#squeezeChanged(h); });
      this.vp.scene.add(ctrl, grip, hand);
      this.hands.push(h);
    }
  }

  // Where a hand "is": the index fingertip when hand-tracking, else the controller grip.
  #point(h, out = new THREE.Vector3()) {
    const tip = h.hand.joints?.['index-finger-tip'];
    if (tip && tip.visible && h.hand.visible) return tip.getWorldPosition(out);
    if (h.grip.visible) return h.grip.getWorldPosition(out);
    return h.ctrl.getWorldPosition(out);
  }

  // ── Wrist menu (canvas texture on the left controller / hand) ─
  #buildMenu() {
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL;
    this.menuCanvas = canvas;
    this.menuTex = new THREE.CanvasTexture(canvas);
    this.menuTex.colorSpace = THREE.SRGBColorSpace;
    this.menu = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16 * ROWS / COLS), new THREE.MeshBasicMaterial({ map: this.menuTex, transparent: true }));
    this.menu.name = 'xr-menu';
    this.menu.visible = false;
    this.drawMenu();
  }

  drawMenu(active = this.menuState || {}) {
    const g = this.menuCanvas.getContext('2d');
    const W = this.menuCanvas.width, H = this.menuCanvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(5,7,8,0.92)';
    g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fill();
    MENU.forEach(([label, action], k) => {
      const x = (k % COLS) * CELL, y = Math.floor(k / COLS) * CELL;
      const on = active[action] || (action === `mode:${active.mode}`);
      g.fillStyle = on ? '#44D4E8' : this.hover === k ? '#1b3a40' : '#11171a';
      g.beginPath(); g.roundRect(x + 6, y + 6, CELL - 12, CELL - 12, 14); g.fill();
      g.fillStyle = on ? '#000' : '#e8eef0';
      g.font = `bold ${label.length > 6 ? 24 : 28}px "Barlow Condensed", Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x + CELL / 2, y + CELL / 2);
    });
    this.menuState = active;
    this.menuTex.needsUpdate = true;
  }

  #attachMenu(h) {
    this.menu.position.set(0, 0.08, -0.06);
    this.menu.rotation.set(-Math.PI / 3, 0, 0);
    // Controllers carry the menu on the grip; bare hands carry it on the wrist.
    (h.isHand && h.hand.joints?.wrist ? h.hand.joints.wrist : h.grip).add(this.menu);
  }

  #menuHit(h) {
    if (!this.menu.visible || !this.menu.parent) return null;
    this.#ray(h);
    const hit = this.raycaster.intersectObject(this.menu)[0];
    if (!hit) return null;
    const col = Math.min(COLS - 1, Math.floor(hit.uv.x * COLS)), row = Math.min(ROWS - 1, Math.floor((1 - hit.uv.y) * ROWS));
    return row * COLS + col;
  }

  #ray(h) {
    this.tmpMat.identity().extractRotation(h.ctrl.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(h.ctrl.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tmpMat);
    this.raycaster.far = 6;
  }

  #pickContent(h) {
    this.#ray(h);
    const hits = this.raycaster.intersectObjects(this.vp.content.children, true).filter((x) => x.object.visible);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o.parent && o.parent !== this.vp.content) o = o.parent;
    return { object: o, hit: hits[0] };
  }

  // ── Trigger / pinch ─────────────────────────────────────────
  #selectStart(h) {
    const k = this.#menuHit(h);
    if (k !== null) {
      const action = MENU[k][1];
      if (action.startsWith('spawn:')) {
        const pos = new THREE.Vector3(0, 0, -0.25).applyMatrix4(h.ctrl.matrixWorld);
        this.actions.spawn(action.slice(6), pos);
      } else this.actions.run(action);
      this.pulse(h, 0.3, 30);
      return;
    }
    const mode = this.actions.getMode();
    if (mode === 'perform') {
      h.air = true;
      const local = this.actions.stage.group.worldToLocal(this.#point(h));
      this.actions.stage.airStart(this.#key(h), local.y);
      return;
    }
    const res = this.#pickContent(h);
    if (!res) { this.vp.select([]); return; }
    this.vp.select(res.object); // in Sound mode, selecting also plays the shape
    if (mode === 'sculpt' && res.object.isMesh) {
      h.sculpting = res.object;
      this.actions.sculptor.begin(res.object);
      return;
    }
    h.grabbed = res.object;
    h.ctrl.attach(res.object);
    this.pulse(h, 0.4, 40);
  }

  #selectEnd(h) {
    if (h.air) {
      this.actions.stage.airEnd(this.#key(h));
      h.air = false;
    }
    if (h.sculpting) {
      this.actions.sculptor.end();
      h.sculpting = null;
    }
    if (h.grabbed) {
      this.vp.content.attach(h.grabbed);
      this.actions.grabEnd(h.grabbed);
      h.grabbed = null;
      h.scaleStart = null;
    }
  }

  // ── Grip: workspace move/scale, or gesture FX in Perform ─────
  #squeezeChanged(changed) {
    if (this.actions.getMode() === 'perform') {
      changed.fx = changed.squeezing;
      if (!changed.fx) this.actions.stage.setFx(this.#key(changed) === 'left' ? { brightness: 1, resonance: 0 } : { echo: 0 });
      return;
    }
    const [a, b] = this.hands;
    const world = this.vp.world;
    this.worldGrab = null;
    const grabbing = this.hands.find((h) => h.grabbed);
    if (grabbing) {
      const other = this.hands.find((h) => h !== grabbing && h.squeezing);
      grabbing.scaleStart = other ? { dist: grabbing.ctrl.position.distanceTo(other.ctrl.position), scale: grabbing.grabbed.scale.clone(), other } : null;
      return;
    }
    if (a.squeezing && b.squeezing) {
      const mid = a.grip.position.clone().add(b.grip.position).multiplyScalar(0.5);
      const v = b.grip.position.clone().sub(a.grip.position);
      this.worldGrab = { two: true, dist: v.length(), angle: Math.atan2(v.x, v.z), mid, pos: world.position.clone(), scale: world.scale.x, rot: world.rotation.y };
    } else {
      const h = a.squeezing ? a : b.squeezing ? b : null;
      if (h) this.worldGrab = { h, start: h.grip.position.clone(), pos: world.position.clone() };
    }
  }

  #frame(dt) {
    if (!this.presenting) return;
    this.clock += dt;
    const world = this.vp.world;
    const mode = this.actions.getMode();
    const stage = this.actions.stage;
    const head = this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());

    if (this.needPlace) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.renderer.xr.getCamera().getWorldQuaternion(new THREE.Quaternion()));
      stage.placeAt(head, Math.atan2(-dir.x, -dir.z));
      this.needPlace = false;
    }

    const g = this.worldGrab;
    if (g?.two) {
      const [a, b] = this.hands;
      const v = b.grip.position.clone().sub(a.grip.position);
      const s = THREE.MathUtils.clamp(g.scale * (v.length() / g.dist), 0.1, 10);
      const dAngle = Math.atan2(v.x, v.z) - g.angle;
      const mid = a.grip.position.clone().add(b.grip.position).multiplyScalar(0.5);
      const offset = g.pos.clone().sub(g.mid).multiplyScalar(s / g.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), dAngle);
      world.position.copy(mid).add(offset);
      world.scale.setScalar(s);
      world.rotation.y = g.rot + dAngle;
    } else if (g?.h) {
      world.position.copy(g.pos).add(g.h.grip.position.clone().sub(g.start));
    }

    if (mode === 'perform') stage.updateHead(head, dt, this.clock);

    for (const h of this.hands) {
      const key = this.#key(h);
      const p = this.#point(h);
      h.vel.copy(p).sub(h.lastPos).divideScalar(Math.max(dt, 1e-3));
      if (h.vel.length() > 20) h.vel.set(0, 0, 0); // tracking jump, not a real hit
      h.lastPos.copy(p);
      const speed = h.vel.length();

      if (h.handedness !== 'left') {
        const k = this.#menuHit(h);
        if (k !== this.hover) { this.hover = k; this.drawMenu(); }
      }

      if (mode === 'perform') {
        stage.updateHand(key, p, h.vel);
        if (h.air) stage.airHand(key, p, head, speed);
        if (h.fx) stage.fxHand(key, p, head);
        continue;
      }

      if (h.grabbed && h.scaleStart) {
        const d = h.ctrl.position.distanceTo(h.scaleStart.other.ctrl.position);
        h.grabbed.scale.copy(h.scaleStart.scale).multiplyScalar(THREE.MathUtils.clamp(d / h.scaleStart.dist, 0.05, 20));
      }

      if (h.sculpting) {
        this.#ray(h);
        const hit = this.raycaster.intersectObject(h.sculpting)[0];
        if (hit?.face) this.actions.sculptor.dab(hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
      }

      // Sound mode: hitting a shape plays it, harder = louder.
      if (mode === 'sound' && !h.grabbed) {
        for (const obj of this.vp.content.children) {
          const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
          const inside = sphere.distanceToPoint(p) < 0.01;
          if (inside && !h.inside.has(obj) && speed > 0.35) {
            this.actions.trigger(obj, THREE.MathUtils.clamp(speed / 2.5, 0.25, 1));
            this.pulse(h, THREE.MathUtils.clamp(speed / 3, 0.2, 1), 25);
          }
          if (inside) h.inside.add(obj); else h.inside.delete(obj);
        }
      }
    }
  }

  pulse(h, intensity, ms) {
    h.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    h.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
  }
}
