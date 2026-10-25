# NBRZ Forge

3D modeling and music production in one space, played with your body. One codebase,
three experiences:

| Where | What's unique there |
|---|---|
| **Meta Quest 3** (VR or passthrough) | A 360° stage around your body: drum ring, light harp, two-hand air synth, gesture FX, nod-to-tempo |
| **Web (desktop)** | Full 3D modeling + studio, the stage from the inside, and the **Motion Stage** — your webcam turns your movement into music |
| **Phone** — [`/studio/pocket/`](pocket/) | **NBRZ Pocket**: multi-finger flow synth, tilt to sweep the mix, shake for fills, bar-locked looper, record & share |

Live at `/studio/` on the NBRZ site. On Quest 3, open it in the Meta Quest Browser and tap
**Enter VR** or **Passthrough**. To keep it on your headset or phone like an app, use the browser
menu → **Install app** / **Add to Home screen**. After the first visit it also works offline.

## Go live on Cloudflare (permanent link)

Pick **one** of these. Both give you a permanent `https://<project>.pages.dev` URL that updates on every push,
plus a preview URL for every branch.

**A. Dashboard (2 minutes, no secrets)** — recommended
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pick `EJVitez/NBRZ`, production branch `main`
3. Framework preset **None**, build command *empty*, build output directory `/`
4. Save and deploy. Forge is at `https://<project>.pages.dev/studio/`, Pocket at `/studio/pocket/`
5. Optional: **Custom domains** → add e.g. `forge.yourdomain.com`

**B. GitHub Actions** (`.github/workflows/cloudflare-pages.yml`, already in the repo)
1. Create an API token with **Cloudflare Pages: Edit**, copy your **Account ID**
2. GitHub repo → Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
3. Push. `main` deploys to production (project `nbrz`), other branches get previews.
   Until the secrets exist, the workflow skips the deploy instead of failing.

Headers (camera, microphone, motion sensors and WebXR allowed for this site only) live in `/_headers`,
which Cloudflare Pages and Netlify both read. WebXR, camera and mic all need HTTPS, which both provide.

## Perform — the 360° stage

Instruments surround you. Turn around to reach them.

| Instrument | In the headset | On desktop |
|---|---|---|
| **Drum ring** — 8 pads at waist height, all the way around (kick, snare, hat, open hat, 3 song chops, clap) | strike down with hands or controllers; harder = louder, with haptics | click, or keys 1–8 |
| **Light harp** — 8 strings in front of you, always in key | sweep a hand through them | drag across, or keys Q–I |
| **Air synth** — glowing scale rings show every note around you | hold trigger / pinch: hand height = pitch, reach = brightness, shake = vibrato; one voice per hand | hold empty space: up/down = pitch, left/right = brightness |
| **Gesture FX** | left grip: raise/lower to sweep a filter over the whole mix · right grip: push out to throw echo | — |
| **Nod tempo** | bob your head on the beat; after 4 steady nods the BPM follows you | — |
| **Capture** | while the beat plays, every pad, string and air note is written into the sequencer | same |
| **360° sky** | a particle dome that breathes with the bass (hidden in passthrough so your room shows) | same |

Your 3D creations stand in front of the stage as a backdrop. Right-drag (desktop) to look around.

### Motion Stage (webcam)
In Perform mode on desktop, **Start camera**: the picture is split into 12 zones; moving in the top rows
plays notes, the bottom row plays kick / snare / hat / clap, and the more you move the brighter the mix gets.
Processing happens on your device; video is never uploaded.

## NBRZ Pocket (phone)
- **Flow field**: every finger is a voice. Left ↔ right = notes in key, up = brighter, wiggle = vibrato
- **Thumb pads** with haptics
- **Tilt + shake**: tilt forward/back sweeps the filter, sideways throws echo, shake for a drum fill
- **Loop**: records one bar of what you play (locked to the bar line) and loops it; press again to layer
- **Rec**: records the jam, then share it straight from the phone or save it
- Keeps the screen awake while the beat plays

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
| 1–8, Q–I | song chop pads (Perform: drum ring + harp) |
| Alt + drag (Sculpt) | orbit instead of sculpting |

**Quest 3** (controllers or bare hands — pinch works as trigger)
| Input | Action |
|---|---|
| Trigger on a shape | grab and move it |
| Trigger on the wrist menu (left hand) | add shapes, switch Build / Sculpt / Sound / Perform, play, capture, nod BPM, sky, copy, delete, undo, redo |
| Grip (one hand) | move the whole workspace |
| Grip (both hands) | scale and turn the workspace |
| Grab a shape + other grip | resize the shape |
| Trigger in Sculpt mode | sculpt where you point |
| Swing through a shape in Sound mode | play it |
| Perform mode | see the Perform table above |

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
  js/xr.js            Quest 3 VR + passthrough, controllers + hand tracking
  js/perform/stage.js  360° stage: drum ring, light harp, air synth, gesture FX, nod tempo, capture
  js/perform/motion.js webcam Motion Stage
  pocket/             NBRZ Pocket phone instrument
  manifest.webmanifest, sw.js, icons/   installable app + offline
  js/audio/engine.js       mix bus, transport, recorder, WAV encoder
  js/audio/instruments.js  drum + synth voices, scales
  js/audio/sequencer.js    step sequencer + styles
  js/audio/deck.js         song deck, chops, BPM detection, mic takes
  js/audio/spatial.js      Orbit Sequencer, shape instruments, audio-reactive visuals
```

Run locally: `python3 -m http.server` in the repo root, then open `http://localhost:8000/studio/`.
WebXR needs HTTPS on the headset (Netlify provides it).
