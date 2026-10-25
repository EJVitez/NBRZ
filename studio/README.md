# NBRZ Forge

3D modeling and music production in one space. It runs in a desktop browser and
in the **Meta Quest 3** browser (VR or passthrough mixed reality), from the same
URL, with nothing to install.

Live at `/studio/` on the NBRZ site (e.g. `https://nbrz.netlify.app/studio/`).
On Quest 3: open that URL in the Meta Quest Browser, tap **Enter VR** or **Passthrough**.

## What it does

### Build
- 12 primitives (cube, sphere, cylinder, cone, pyramid, torus, capsule, gem, hex prism, knot, sculptable terrain, 3D text)
- Move / rotate / scale gizmo with grid snapping (5 cm, 15°)
- **Booleans**: union, subtract, intersect (real CSG, printable solids)
- Mirror, radial array, row array, drop to floor, group / ungroup, smooth / faceted
- **Decimate** to halve polygon count for game-ready assets
- Finishes in one click: matte, satin, gloss, metal, chrome, glass, neon
- Live dimensions in millimetres and triangle count
- Undo / redo (60 steps), autosave in the browser, `.nbrz.json` project files

### Sculpt
- Brushes: inflate, dent, smooth, flatten — with X symmetry, radius and strength
- Meshes get more detail automatically when you start sculpting; **Add detail** subdivides further

### Prompt
- Type what you want: `castle with 6 towers`, `neon crystal cluster`, `giant robot`, `spiral staircase`,
  `forest of 12 trees`, `city skyline`, `red sports car`, `chrome microphone`, `gold trophy`, `text NBRZ`,
  `5 spheres in a circle`, `stack of 6 cubes`… Works offline.
- Music prompts set up the studio: `trap beat 140`, `dembow 95 bpm`, `lofi beat`, `afrobeats`, `drill`
- **AI switch**: Claude turns *any* description into a model. Needs your own Anthropic API key
  (right panel), which is only stored in your browser.

### Import / export
- Import **GLB, GLTF, OBJ, STL, FBX** (button or drag-and-drop)
- **STL** for resin printing: one solid, millimetres, Z-up, sitting on the plate; set the longest side or use real scale
- **GLB** for Unity, Unreal, Godot, Blender, video and TV pipelines (keeps colours and materials)
- **OBJ** for anything else

### Music studio
- 16-step sequencer: kick, snare, clap, hat, open hat, **song chops**, and an 8-row note grid that is always in key
- Styles: NBRZ late night, boom bap, trap, drill, dembow / reggaeton, afrobeats, house, lo-fi
- Synths: keys, pluck, pad, 808 bass, lead; any key, major or minor; swing
- **Deck**: pick an NBRZ track from the catalog, upload any song, or paste a direct audio link
  - automatic BPM detection; speed, filter, echo, space (reverb), volume
  - the song is cut into **16 chops** (pads, keys 1–8 / Q–I) that follow your tempo; click the waveform to choose where chops start
- **Mic recording**: record vocals or an instrument as a take (saved in the browser, playable on the deck)
- **Record** button captures everything you hear; **Bounce WAV** renders 4 bars offline

### Sound mode — shapes are instruments
The **Orbit Sequencer** is a ring on the floor with an arm that sweeps once per bar.
Any shape inside the ring plays when the arm passes it:

| | |
|---|---|
| Angle around the ring | when it plays (16 steps) |
| Height | pitch (in key) |
| Shape | sound: cube = kick, cylinder = snare, cone/pyramid = hat, torus = clap, everything else = synth |
| Size | loudness |

Move a shape and the beat changes. Override any shape's sound in the right panel (including **Song chop**).
In VR, **hit shapes with your controllers** to play them like drum pads — harder hits are louder.
Shapes flash when they play, and the space pulses with the bass.

## Controls

**Desktop**
| Key | Action |
|---|---|
| Click / Shift-click | select / add to selection |
| W E R | move / rotate / scale |
| F | focus on selection |
| Ctrl+D | duplicate |
| Ctrl+G / Ctrl+Shift+G | group / ungroup |
| Delete | delete |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| Ctrl+S | save project file |
| Space | play / stop |
| 1–8, Q–I | song chop pads |
| Alt + drag (Sculpt) | orbit instead of sculpting |

**Quest 3**
| Input | Action |
|---|---|
| Trigger on a shape | grab and move it |
| Trigger on the wrist menu (left hand) | add shapes, switch Build / Sculpt / Sound, play, copy, delete, undo, redo |
| Grip (one hand) | move the whole workspace |
| Grip (both hands) | scale and turn the workspace |
| Grab a shape + other grip | resize the shape |
| Trigger in Sculpt mode | sculpt where you point |
| Swing through a shape in Sound mode | play it |

## NBRZ catalog audio

`catalog.json` lists the NBRZ tracks. A track with no `file` asks for its audio once
and keeps it in that browser (IndexedDB). To make a track load for everyone,
put the file in `audio/` and set `"file": "audio/<name>.mp3"`. See `audio/README.md`.

## About "any song from any link"

Direct audio links (`.mp3`, `.wav`, `.ogg`…) load straight onto the deck when the host allows it (CORS).
YouTube, Spotify, Apple Music, SoundCloud, TikTok and similar links are DRM-protected streams; a
browser app can't legally pull audio out of them, so the deck explains this and asks for a file instead.

## Tech

Static ES modules, no build step, so it deploys as-is on Netlify.
three.js r180, three-bvh-csg, and the Anthropic TypeScript SDK are bundled in `vendor/`, so the app
doesn't depend on outside CDNs (except Quest controller models, which three.js fetches from the
WebXR input-profiles CDN). Audio is all Web Audio API synthesis — no samples to license.

```
studio/
  index.html, studio.css
  js/main.js          wiring, UI, prompts, import/export, keyboard
  js/viewport.js      renderer, camera, gizmo, picking
  js/shapes.js        primitives, materials, finishes
  js/tools.js         booleans, mirror, arrays, decimate, subdivide
  js/sculpt.js        sculpt brushes
  js/history.js       undo / redo
  js/prompt.js        offline text → model / music
  js/ai.js            Claude text → model
  js/io.js            GLB / OBJ / STL / FBX in, STL / GLB / OBJ out
  js/xr.js            Quest 3 VR + passthrough
  js/audio/engine.js       mix bus, transport, recorder, WAV encoder
  js/audio/instruments.js  drum + synth voices, scales
  js/audio/sequencer.js    step sequencer + styles
  js/audio/deck.js         song deck, chops, BPM detection, mic takes
  js/audio/spatial.js      Orbit Sequencer, shape instruments, audio-reactive visuals
```

Run locally: `python3 -m http.server` in the repo root, then open `http://localhost:8000/studio/`.
WebXR needs HTTPS on the headset (Netlify provides it).
