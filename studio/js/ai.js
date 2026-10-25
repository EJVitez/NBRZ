// Optional AI mode: Claude turns any description into scene parts (same format as prompt.js).
// The user's own API key is used straight from the browser and never leaves it except to
// call the Anthropic API.
import Anthropic from '../vendor/anthropic-sdk.mjs';

const SHAPES = ['cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'capsule', 'gem', 'prism', 'knot', 'text'];
const FINISHES = ['matte', 'satin', 'gloss', 'metal', 'chrome', 'glass', 'neon'];

const vec3 = { type: 'array', items: { type: 'number' } };

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          shape: { type: 'string', enum: SHAPES },
          position: vec3,
          scale: vec3,
          rotation: vec3,
          color: { type: 'string' },
          finish: { type: 'string', enum: FINISHES },
          text: { type: 'string' },
        },
        required: ['name', 'shape', 'position', 'scale', 'rotation', 'color', 'finish', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'parts'],
  additionalProperties: false,
};

const SYSTEM = `You build 3D models for NBRZ Forge out of primitive shapes. Return a JSON scene.

Units are metres; Y is up; the floor is y = 0. Keep models roughly 0.3–1.0 m tall so they fit on a table in VR.
Base sizes at scale [1,1,1] (each shape is centred on its position):
- cube: 0.3 × 0.3 × 0.3
- sphere: diameter 0.34
- cylinder: radius 0.15, height 0.3 (axis Y)
- cone: radius 0.16, height 0.32 (tip up, +Y)
- pyramid: square base 0.283 wide, height 0.3 (tip up)
- torus: ring radius 0.13, tube radius 0.045, lying in the XY plane (rotate x 90 to lay it flat)
- capsule: radius 0.1, total height 0.38
- gem: icosahedron, radius 0.16
- prism: hexagonal, radius 0.16, height 0.3
- knot: torus knot about 0.3 across
- text: 3D letters about 0.12 tall; put the words in "text" (empty string for other shapes)
Position = centre of the part. Rotation = Euler degrees [x, y, z]. Colour = hex like "#44D4E8".
Make parts touch or overlap so the model reads as one solid object (good for 3D printing). Rest the lowest part on y = 0.
Use 3–60 parts. Prefer recognisable silhouettes over tiny detail. NBRZ brand colours: #8EF0A4, #44D4E8, #2B9EFF on black.`;

export async function aiBuild(prompt, apiKey) {
  if (!apiKey) throw new Error('Add your Anthropic API key in the right panel to use AI mode.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined that request. Try describing it differently.');
  if (response.stop_reason === 'max_tokens') throw new Error('That model was too detailed — try a simpler description.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const scene = JSON.parse(text);
  scene.parts = scene.parts.filter((p) => SHAPES.includes(p.shape)).map((p) => ({
    ...p,
    position: fix3(p.position, 0),
    scale: fix3(p.scale, 1),
    rotation: fix3(p.rotation, 0),
  }));
  return scene;
}

function fix3(v, d) {
  const a = Array.isArray(v) ? v.slice(0, 3).map(Number) : [];
  while (a.length < 3) a.push(d);
  return a.map((x) => (Number.isFinite(x) ? x : d));
}
