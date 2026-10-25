// Offline text-prompt → scene builder. Produces a list of "parts" (the same format the AI
// mode returns), so both paths share one builder in main.js.
//
// part = { shape, position:[x,y,z] (centre, metres), scale:[x,y,z], rotation:[x,y,z] (deg),
//          color, finish, name, text? }

const COLORS = {
  red: '#ff4d4d', crimson: '#c8102e', orange: '#ff8c32', yellow: '#ffd23f', gold: '#e6b422', green: '#8EF0A4',
  lime: '#a6ff4d', emerald: '#2ecc71', teal: '#1abc9c', cyan: '#44D4E8', blue: '#2B9EFF', navy: '#1b2a6b',
  purple: '#9b59ff', violet: '#b388ff', pink: '#ff6fb5', magenta: '#ff2bd6', white: '#f4f4f4', black: '#1a1a1a',
  grey: '#8a9399', gray: '#8a9399', silver: '#c0c6cc', brown: '#8b5a2b', wood: '#a0703c', stone: '#9a9a92',
  sand: '#e2c48f', ice: '#cfefff', chrome: '#d8dde0', copper: '#c87533', bronze: '#a97142', nbrz: '#44D4E8',
};
const FINISH_WORDS = { metal: 'metal', metallic: 'metal', steel: 'metal', chrome: 'chrome', mirror: 'chrome', gold: 'metal',
  silver: 'chrome', copper: 'metal', bronze: 'metal', glass: 'glass', crystal: 'glass', neon: 'neon', glowing: 'neon', glow: 'neon',
  shiny: 'gloss', glossy: 'gloss', matte: 'matte', ice: 'glass' };
const SIZE_WORDS = { tiny: 0.4, small: 0.65, little: 0.65, mini: 0.5, big: 1.5, large: 1.5, huge: 2.2, giant: 3, massive: 3 };
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, a: 1, an: 1 };

const STYLE_WORDS = {
  trap: 'trap', drill: 'drill', 'boom bap': 'boombap', boombap: 'boombap', 'hip hop': 'boombap', hiphop: 'boombap',
  reggaeton: 'dembow', dembow: 'dembow', latin: 'dembow', afro: 'afro', afrobeat: 'afro', afrobeats: 'afro', amapiano: 'afro',
  house: 'house', techno: 'house', edm: 'house', club: 'house', lofi: 'lofi', 'lo-fi': 'lofi', chill: 'lofi', rnb: 'nbrz', 'r&b': 'nbrz',
  'late night': 'nbrz', nbrz: 'nbrz',
};

// ── Helpers: dimensions in metres, y = bottom of the part ─────────────
let ctx = { color: null, finish: null, size: 1 };
const col = (fallback) => ctx.color || fallback;
const fin = (fallback = 'satin') => ctx.finish || fallback;
const part = (shape, pos, scale, o = {}) => ({ shape, position: pos, scale, rotation: o.rot || [0, 0, 0], color: o.color || col('#44D4E8'), finish: o.finish || fin(), name: o.name, text: o.text });
const box = (w, h, d, x, y, z, o) => part('cube', [x, y + h / 2, z], [w / 0.3, h / 0.3, d / 0.3], o);
const cyl = (r, h, x, y, z, o) => part('cylinder', [x, y + h / 2, z], [r / 0.15, h / 0.3, r / 0.15], o);
const cone = (r, h, x, y, z, o) => part('cone', [x, y + h / 2, z], [r / 0.16, h / 0.32, r / 0.16], o);
const ball = (r, x, y, z, o) => part('sphere', [x, y + r, z], [r / 0.17, r / 0.17, r / 0.17], o);
const pyr = (w, h, x, y, z, o) => part('pyramid', [x, y + h / 2, z], [w / 0.283, h / 0.3, w / 0.283], o);
const gem = (r, x, y, z, o) => part('gem', [x, y + r, z], [r / 0.16, r * 1.6 / 0.16, r / 0.16], o);
const ring = (R, x, y, z, o = {}) => part('torus', [x, y, z], [R / 0.13, R / 0.13, R / 0.13], { rot: [90, 0, 0], ...o });
const rand = mulberry32(7);

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── Generators ────────────────────────────────────────────────────────
const GEN = {
  tower({ n = 1 }) {
    const h = 0.6;
    return [cyl(0.1, h, 0, 0, 0, { color: col('#9a9a92'), finish: fin('matte') }), cone(0.13, 0.22, 0, h, 0, { color: col('#2B9EFF') })];
  },
  castle({ n = 4 }) {
    const out = [box(0.7, 0.28, 0.7, 0, 0, 0, { color: col('#9a9a92'), finish: fin('matte'), name: 'Keep walls' }),
      box(0.3, 0.5, 0.3, 0, 0, 0, { color: col('#a8a8a0'), finish: fin('matte'), name: 'Keep' }),
      pyr(0.34, 0.2, 0, 0.5, 0, { color: '#2B9EFF', name: 'Keep roof' }),
      box(0.14, 0.18, 0.04, 0, 0, 0.35, { color: '#2a1a10', name: 'Gate' })];
    const towers = Math.max(1, n);
    for (let i = 0; i < towers; i++) {
      const a = Math.PI / 4 + (i / towers) * Math.PI * 2;
      const x = Math.cos(a) * 0.48, z = Math.sin(a) * 0.48;
      out.push(cyl(0.09, 0.45, x, 0, z, { color: col('#9a9a92'), finish: fin('matte'), name: `Tower ${i + 1}` }),
        cone(0.11, 0.2, x, 0.45, z, { color: '#2B9EFF', name: `Spire ${i + 1}` }));
    }
    return out;
  },
  house() {
    return [box(0.5, 0.32, 0.4, 0, 0, 0, { color: col('#f4f4f4'), finish: fin('matte'), name: 'Walls' }),
      pyr(0.62, 0.24, 0, 0.32, 0, { color: '#c0392b', name: 'Roof' }),
      box(0.1, 0.18, 0.02, 0, 0, 0.2, { color: '#5a3a1a', name: 'Door' }),
      box(0.09, 0.08, 0.02, -0.15, 0.15, 0.2, { color: '#44D4E8', finish: 'glass', name: 'Window L' }),
      box(0.09, 0.08, 0.02, 0.15, 0.15, 0.2, { color: '#44D4E8', finish: 'glass', name: 'Window R' }),
      box(0.06, 0.14, 0.06, 0.15, 0.4, -0.08, { color: '#7a4a3a', name: 'Chimney' })];
  },
  tree({ x = 0, z = 0, s = 1 } = {}) {
    return [cyl(0.035 * s, 0.25 * s, x, 0, z, { color: '#8b5a2b', finish: 'matte', name: 'Trunk' }),
      cone(0.16 * s, 0.26 * s, x, 0.18 * s, z, { color: col('#2ecc71'), finish: fin('matte'), name: 'Leaves' }),
      cone(0.12 * s, 0.2 * s, x, 0.32 * s, z, { color: col('#2ecc71'), finish: fin('matte'), name: 'Leaves top' })];
  },
  forest({ n = 9 }) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = 0.1 + rand() * 0.8;
      out.push(...GEN.tree({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.6 + rand() * 0.8 }));
    }
    return out;
  },
  stairs({ n = 10 }) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(box(0.4, 0.05 * (i + 1), 0.1, 0, 0, -i * 0.1 + n * 0.05, { color: col('#c0c6cc'), name: `Step ${i + 1}` }));
    return out;
  },
  spiral({ n = 14 }) {
    const out = [cyl(0.04, n * 0.05 + 0.1, 0, 0, 0, { color: '#c0c6cc', finish: 'metal', name: 'Pole' })];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2.5;
      out.push(part('cube', [Math.cos(a) * 0.17, i * 0.05 + 0.02, Math.sin(a) * 0.17], [0.3 / 0.3 * 1.0, 0.025 / 0.3, 0.1 / 0.3],
        { rot: [0, -a * 180 / Math.PI, 0], color: col('#a0703c'), name: `Step ${i + 1}` }));
    }
    return out;
  },
  table() {
    const out = [box(0.6, 0.04, 0.4, 0, 0.36, 0, { color: col('#a0703c'), name: 'Top' })];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b], i) => out.push(box(0.04, 0.36, 0.04, a * 0.26, 0, b * 0.16, { color: col('#a0703c'), name: `Leg ${i + 1}` })));
    return out;
  },
  chair() {
    const out = [box(0.3, 0.04, 0.3, 0, 0.22, 0, { color: col('#2a2f33'), name: 'Seat' }), box(0.3, 0.3, 0.04, 0, 0.26, -0.13, { color: col('#2a2f33'), name: 'Back' })];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b], i) => out.push(box(0.03, 0.22, 0.03, a * 0.13, 0, b * 0.13, { color: '#c0c6cc', finish: 'metal', name: `Leg ${i + 1}` })));
    return out;
  },
  rock({ n = 1 }) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = 0.08 + rand() * 0.12, a = rand() * 6.28, r = n > 1 ? rand() * 0.5 : 0;
      out.push(part('gem', [Math.cos(a) * r, s * 0.7, Math.sin(a) * r], [s / 0.16, s * 0.75 / 0.16, s * 1.1 / 0.16],
        { rot: [rand() * 40, rand() * 360, rand() * 40], color: col('#7d7d78'), finish: fin('matte'), name: `Rock ${i + 1}` }));
    }
    return out;
  },
  crystals({ n = 7 }) {
    const out = [part('gem', [0, 0.03, 0], [2.2, 0.5, 2.2], { color: '#2a2f33', finish: 'matte', name: 'Base' })];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + rand(), tilt = 10 + rand() * 25, h = 0.15 + rand() * 0.25;
      out.push(part('prism', [Math.cos(a) * 0.06, h / 2 + 0.03, Math.sin(a) * 0.06], [0.22, h / 0.3, 0.22],
        { rot: [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt], color: col(['#b388ff', '#44D4E8', '#8EF0A4'][i % 3]), finish: fin('glass'), name: `Crystal ${i + 1}` }));
    }
    return out;
  },
  mushroom() {
    return [cyl(0.05, 0.18, 0, 0, 0, { color: '#f4ead5', finish: 'matte', name: 'Stem' }),
      part('sphere', [0, 0.2, 0], [1.1, 0.55, 1.1], { color: col('#ff4d4d'), name: 'Cap' }),
      ball(0.02, 0.06, 0.24, 0.07, { color: '#fff', name: 'Spot' }), ball(0.018, -0.08, 0.25, 0.02, { color: '#fff', name: 'Spot' }),
      ball(0.015, 0.01, 0.27, -0.08, { color: '#fff', name: 'Spot' })];
  },
  snowman() {
    return [ball(0.16, 0, 0, 0, { color: '#f4f4f4', name: 'Base' }), ball(0.11, 0, 0.27, 0, { color: '#f4f4f4', name: 'Body' }),
      ball(0.075, 0, 0.46, 0, { color: '#f4f4f4', name: 'Head' }), cone(0.015, 0.08, 0, 0.53, 0.1, { rot: [90, 0, 0], color: '#ff8c32', name: 'Nose' }),
      cyl(0.06, 0.08, 0, 0.6, 0, { color: '#1a1a1a', name: 'Hat' }), cyl(0.09, 0.01, 0, 0.6, 0, { color: '#1a1a1a', name: 'Brim' })];
  },
  robot() {
    const c = col('#c0c6cc'), f = fin('metal');
    return [box(0.24, 0.28, 0.16, 0, 0.22, 0, { color: c, finish: f, name: 'Torso' }), box(0.16, 0.13, 0.14, 0, 0.52, 0, { color: c, finish: f, name: 'Head' }),
      box(0.12, 0.025, 0.01, 0, 0.58, 0.07, { color: '#44D4E8', finish: 'neon', name: 'Visor' }),
      cyl(0.006, 0.08, 0, 0.65, 0, { color: c, finish: f, name: 'Antenna' }), ball(0.015, 0, 0.72, 0, { color: '#ff4d6d', finish: 'neon', name: 'Antenna tip' }),
      box(0.06, 0.24, 0.06, -0.16, 0.24, 0, { color: c, finish: f, name: 'Arm L' }), box(0.06, 0.24, 0.06, 0.16, 0.24, 0, { color: c, finish: f, name: 'Arm R' }),
      box(0.07, 0.22, 0.08, -0.06, 0, 0, { color: '#2a2f33', finish: f, name: 'Leg L' }), box(0.07, 0.22, 0.08, 0.06, 0, 0, { color: '#2a2f33', finish: f, name: 'Leg R' })];
  },
  car() {
    const c = col('#ff4d4d');
    const out = [box(0.6, 0.12, 0.28, 0, 0.06, 0, { color: c, finish: fin('gloss'), name: 'Body' }),
      box(0.32, 0.1, 0.24, -0.04, 0.18, 0, { color: '#44D4E8', finish: 'glass', name: 'Cabin' })];
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b], i) => out.push(part('cylinder', [a * 0.19, 0.06, b * 0.14], [0.06 / 0.15, 0.05 / 0.3, 0.06 / 0.15], { rot: [90, 0, 0], color: '#1a1a1a', finish: 'matte', name: `Wheel ${i + 1}` })));
    return out;
  },
  sword() {
    return [box(0.04, 0.5, 0.008, 0, 0.17, 0, { color: col('#d8dde0'), finish: fin('chrome'), name: 'Blade' }),
      pyr(0.045, 0.06, 0, 0.67, 0, { color: col('#d8dde0'), finish: fin('chrome'), name: 'Tip' }),
      box(0.18, 0.025, 0.03, 0, 0.15, 0, { color: '#e6b422', finish: 'metal', name: 'Guard' }),
      cyl(0.016, 0.13, 0, 0.02, 0, { color: '#3a2a1a', finish: 'matte', name: 'Grip' }), ball(0.025, 0, -0.03, 0, { color: '#e6b422', finish: 'metal', name: 'Pommel' })];
  },
  planet() {
    return [ball(0.16, 0, 0.12, 0, { color: col('#ffb347'), name: 'Planet' }),
      part('torus', [0, 0.28, 0], [1.9, 1.9, 0.3], { rot: [75, 0, 15], color: '#e2c48f', name: 'Rings' })];
  },
  rocket() {
    return [cyl(0.07, 0.4, 0, 0.06, 0, { color: col('#f4f4f4'), finish: fin('gloss'), name: 'Body' }), cone(0.07, 0.16, 0, 0.46, 0, { color: '#ff4d4d', name: 'Nose' }),
      ball(0.03, 0, 0.3, 0.055, { color: '#44D4E8', finish: 'glass', name: 'Window' }),
      ...[0, 120, 240].map((a, i) => box(0.012, 0.12, 0.08, Math.sin(a * Math.PI / 180) * 0.08, 0.04, Math.cos(a * Math.PI / 180) * 0.08, { rot: [0, a, 0], color: '#ff4d4d', name: `Fin ${i + 1}` })),
      cone(0.05, 0.08, 0, 0, 0, { rot: [180, 0, 0], color: '#ffb347', finish: 'neon', name: 'Flame' })];
  },
  cactus() {
    const g = col('#3fae6a');
    return [cyl(0.06, 0.4, 0, 0.12, 0, { color: g, finish: 'matte', name: 'Stem' }), ball(0.06, 0, 0.46, 0, { color: g, finish: 'matte', name: 'Top' }),
      cyl(0.035, 0.14, -0.11, 0.26, 0, { color: g, finish: 'matte', name: 'Arm L' }), cyl(0.035, 0.12, 0.11, 0.2, 0, { color: g, finish: 'matte', name: 'Arm R' }),
      box(0.1, 0.035, 0.035, -0.07, 0.24, 0, { color: g, finish: 'matte', name: 'Elbow L' }), box(0.1, 0.035, 0.035, 0.07, 0.18, 0, { color: g, finish: 'matte', name: 'Elbow R' }),
      cyl(0.11, 0.13, 0, 0, 0, { color: '#c87533', finish: 'matte', name: 'Pot' })];
  },
  speaker() {
    return [box(0.26, 0.42, 0.24, 0, 0, 0, { color: col('#1a1a1a'), finish: fin('satin'), name: 'Cabinet' }),
      part('cylinder', [0, 0.14, 0.125], [0.09 / 0.15, 0.015 / 0.3, 0.09 / 0.15], { rot: [90, 0, 0], color: '#2a2f33', finish: 'matte', name: 'Woofer' }),
      part('cylinder', [0, 0.32, 0.125], [0.04 / 0.15, 0.015 / 0.3, 0.04 / 0.15], { rot: [90, 0, 0], color: '#2a2f33', finish: 'matte', name: 'Tweeter' }),
      ring(0.095, 0, 0.14, 0.13, { rot: [0, 0, 0], color: '#44D4E8', finish: 'neon', name: 'Glow ring' })];
  },
  microphone() {
    return [cyl(0.1, 0.015, 0, 0, 0, { color: '#2a2f33', finish: 'metal', name: 'Base' }), cyl(0.008, 0.45, 0, 0.015, 0, { color: '#c0c6cc', finish: 'chrome', name: 'Stand' }),
      part('capsule', [0, 0.53, 0], [0.38, 0.4, 0.38], { color: col('#c0c6cc'), finish: fin('chrome'), name: 'Mic' })];
  },
  trophy() {
    return [box(0.16, 0.06, 0.16, 0, 0, 0, { color: '#1a1a1a', name: 'Base' }), cyl(0.02, 0.12, 0, 0.06, 0, { color: '#e6b422', finish: 'metal', name: 'Stem' }),
      part('cone', [0, 0.27, 0], [0.65, 0.5, 0.65], { rot: [180, 0, 0], color: col('#e6b422'), finish: fin('metal'), name: 'Cup' }),
      ring(0.05, -0.1, 0.26, 0, { rot: [0, 0, 0], color: '#e6b422', finish: 'metal', name: 'Handle L' }), ring(0.05, 0.1, 0.26, 0, { rot: [0, 0, 0], color: '#e6b422', finish: 'metal', name: 'Handle R' })];
  },
  city({ n = 16 }) {
    const out = [];
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      const gx = i % side, gz = Math.floor(i / side);
      const h = 0.15 + rand() * 0.6;
      out.push(box(0.12, h, 0.12, (gx - (side - 1) / 2) * 0.17, 0, (gz - (side - 1) / 2) * 0.17,
        { color: col(['#2a2f33', '#3b4248', '#1b2a6b'][i % 3]), finish: fin('gloss'), name: `Building ${i + 1}` }));
      if (rand() > 0.6) out.push(box(0.125, 0.01, 0.125, (gx - (side - 1) / 2) * 0.17, h * 0.7, (gz - (side - 1) / 2) * 0.17, { color: '#44D4E8', finish: 'neon', name: 'Neon band' }));
    }
    return out;
  },
  arch() {
    return [box(0.08, 0.35, 0.1, -0.16, 0, 0, { color: col('#9a9a92'), finish: fin('matte'), name: 'Pillar L' }), box(0.08, 0.35, 0.1, 0.16, 0, 0, { color: col('#9a9a92'), finish: fin('matte'), name: 'Pillar R' }),
      part('torus', [0, 0.35, 0], [1.23, 1.23, 2.2], { color: col('#9a9a92'), finish: fin('matte'), name: 'Arch' })];
  },
  pillar({ n = 1 }) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.3;
      out.push(box(0.16, 0.04, 0.16, x, 0, 0, { color: col('#f4f4f4'), finish: fin('matte'), name: 'Base' }), cyl(0.055, 0.5, x, 0.04, 0, { color: col('#f4f4f4'), finish: fin('matte'), name: 'Column' }),
        box(0.16, 0.04, 0.16, x, 0.54, 0, { color: col('#f4f4f4'), finish: fin('matte'), name: 'Capital' }));
    }
    return out;
  },
  terrain() {
    return [{ shape: 'terrain', position: [0, 0, 0], scale: [1.5, 1, 1.5], rotation: [0, 0, 0], color: col('#6b8f5a'), finish: fin('matte'), name: 'Terrain', seed: Math.floor(rand() * 1e6) }];
  },
  text({ text }) {
    return [{ shape: 'text', position: [0, 0.08, 0], scale: [1, 1, 1], rotation: [0, 0, 0], color: col('#44D4E8'), finish: fin('neon'), name: `Text ${text}`, text }];
  },
};

const ALIASES = [
  [/castle|fortress|fort\b/, 'castle'], [/spiral (stair|step)/, 'spiral'], [/stair|steps/, 'stairs'], [/forest|woods/, 'forest'],
  [/tree|pine/, 'tree'], [/house|home|cabin|hut/, 'house'], [/tower|lighthouse/, 'tower'], [/table|desk/, 'table'], [/chair|stool|seat/, 'chair'],
  [/crystal|geode|amethyst/, 'crystals'], [/rock|boulder|stone/, 'rock'], [/mushroom|shroom/, 'mushroom'], [/snowman/, 'snowman'],
  [/robot|mech|droid|bot\b/, 'robot'], [/car|truck|vehicle/, 'car'], [/sword|blade|katana/, 'sword'], [/planet|saturn/, 'planet'],
  [/rocket|spaceship|ship/, 'rocket'], [/cactus/, 'cactus'], [/speaker|subwoofer|amp\b/, 'speaker'], [/mic\b|microphone/, 'microphone'],
  [/trophy|award|cup/, 'trophy'], [/city|skyline|buildings|downtown/, 'city'], [/arch|gate|portal/, 'arch'], [/pillar|column/, 'pillar'],
  [/terrain|landscape|mountain|hills|ground/, 'terrain'],
];

const PRIMS = [[/cube|box|block/, 'cube'], [/sphere|ball|orb/, 'sphere'], [/cylinder|tube|can\b/, 'cylinder'], [/cone/, 'cone'],
  [/pyramid/, 'pyramid'], [/torus|donut|doughnut|ring/, 'torus'], [/capsule|pill/, 'capsule'], [/gem|diamond|jewel/, 'gem'],
  [/hex|prism/, 'prism'], [/knot/, 'knot']];

function readCount(t) {
  const m = t.match(/\b(\d{1,3})\b/);
  if (m) return Math.min(64, parseInt(m[1], 10));
  for (const [w, n] of Object.entries(NUM_WORDS)) if (n > 1 && new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}

export function parseMusic(t) {
  t = t.toLowerCase();
  let style = null;
  for (const [w, s] of Object.entries(STYLE_WORDS)) if (t.includes(w)) { style = s; break; }
  const bpmM = t.match(/(\d{2,3})\s*(bpm)?/);
  // "house", "club", "chill" are also things you can build, so they only count as music
  // next to a music word; genre names that can't be objects count on their own.
  const strong = /\b(trap|drill|boom ?bap|hip ?hop|reggaeton|dembow|afrobeats?|amapiano|lo-?fi|techno|edm|r&b|rnb)\b/.test(t);
  const isMusic = strong || /\b(beat|beats|bpm|drums|groove|loop|instrumental|rhythm)\b/.test(t);
  if (!isMusic) return null;
  const bpm = bpmM ? Math.max(50, Math.min(200, parseInt(bpmM[1], 10))) : null;
  return { style: style || 'nbrz', bpm };
}

export function parsePrompt(raw) {
  const t = raw.toLowerCase().trim();
  ctx = { color: null, finish: null, size: 1 };
  for (const [w, c] of Object.entries(COLORS)) if (new RegExp(`\\b${w}\\b`).test(t)) { ctx.color = c; break; }
  for (const [w, f] of Object.entries(FINISH_WORDS)) if (new RegExp(`\\b${w}\\b`).test(t)) { ctx.finish = f; break; }
  for (const [w, s] of Object.entries(SIZE_WORDS)) if (new RegExp(`\\b${w}\\b`).test(t)) { ctx.size = s; break; }
  const n = readCount(t);

  // Text: `text NBRZ`, `"words"`, `logo NBRZ`, `sign that says hi`
  const textM = raw.match(/["“](.+?)["”]/) || raw.match(/\b(?:text|word|words|logo|sign(?: that says)?|letters|says)\s+(.+)$/i);
  if (textM) return finish(GEN.text({ text: textM[1].trim().slice(0, 40) }), raw);

  // "tower of 5 cubes" / "ring of spheres" are arrangements of primitives, not generators.
  const arranged = /\b(stack|tower|pile|row|circle|ring|grid) of\b/.test(t) && PRIMS.some(([re]) => re.test(t.replace(/ring of/, '')));
  if (!arranged) for (const [re, gen] of ALIASES) if (re.test(t)) return finish(GEN[gen]({ n: n ?? undefined }), raw);

  for (const [re, shape] of PRIMS) {
    if (!re.test(t)) continue;
    const count = n || 1;
    const arrangement = /circle|ring of|around/.test(t) ? 'circle' : /stack|tower of|pile/.test(t) ? 'stack' : /grid/.test(t) ? 'grid' : 'row';
    const parts = [];
    for (let i = 0; i < count; i++) {
      const p = { shape, position: [0, 0.17, 0], scale: [1, 1, 1], rotation: [0, 0, 0], color: ctx.color || ['#8EF0A4', '#44D4E8', '#2B9EFF'][i % 3], finish: ctx.finish || 'satin', name: `${shape} ${i + 1}` };
      if (count > 1) {
        if (arrangement === 'circle') { const a = (i / count) * Math.PI * 2, r = 0.12 * count / Math.PI + 0.15; p.position = [Math.cos(a) * r, 0.17, Math.sin(a) * r]; }
        else if (arrangement === 'stack') { p.position = [0, 0.15 + i * 0.31, 0]; p.rotation = [0, i * 12, 0]; }
        else if (arrangement === 'grid') { const s = Math.ceil(Math.sqrt(count)); p.position = [(i % s - (s - 1) / 2) * 0.4, 0.17, (Math.floor(i / s) - (s - 1) / 2) * 0.4]; }
        else p.position = [(i - (count - 1) / 2) * 0.4, 0.17, 0];
      }
      parts.push(p);
    }
    return finish(parts, raw);
  }
  return null;
}

// Apply global size, and group into a named result.
function finish(parts, raw) {
  const s = ctx.size;
  if (s !== 1) parts.forEach((p) => { p.position = p.position.map((v) => v * s); p.scale = p.scale.map((v) => v * s); });
  return { name: raw.slice(0, 40), parts };
}

export const PROMPT_EXAMPLES = ['castle with 6 towers', 'neon crystal cluster', 'giant robot', 'spiral staircase', 'forest of 12 trees',
  'city skyline', 'red sports car', 'chrome microphone', 'text NBRZ', 'gold trophy', '5 spheres in a circle', 'stack of 6 cubes',
  'trap beat 140', 'dembow 95 bpm', 'lofi beat'];
