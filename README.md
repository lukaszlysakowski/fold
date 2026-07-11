# Fold

**Sheet · crease · occlusion** — a folded page floating in empty space, drawn with true hidden-line removal.

---

## Origin

Every other system in this family depicts something: a redacted document, a geological cross-section, a field of text rereading itself. Fold depicts nothing but its own paper. There is no terrain, no document, no instrument standing in for the subject — the fold *is* the subject, a single sheet bent through space and lit only by the angle it presents to the camera. Take away the hidden-line removal and there's no drawing left; the whole piece exists because some of the sheet is in front of the rest of it.

That constraint is also the lineage. Hidden-line removal — deciding, for a 3D surface rendered as lines, which segments a viewer could actually see — is *the* canonical problem of 1960s–70s computer graphics, the one that shaped the look of the earliest plotter art: wireframes that either fought through visual noise or learned to erase themselves. Fold builds one visibility test and runs everything — the mesh, the hatching, the single red crease — through it.

---

## The System

**The fold field.** The surface starts flat and gets bent by 2–5 folds superposed at arbitrary angles, each one either a sine wave (`amp · sin(t·freq + phase)`, the same math that drives strata's folded-geology variant, extruded here to a real out-of-plane displacement) or a triangular sharp crease (a ridge that falls off linearly from its centerline). Character (Soft / Mixed / Sharp) sets how many of a seed's folds are sharp; amplitude scales how deep they cut. Every fold's angle, position, and depth are rolled once per seed and never touched again — the geometry pipeline downstream of that roll is pure math, no further randomness.

**Camera.** Orthographic, so the sheet's proportions stay honest instead of getting distorted by perspective. Pitch rolls 55–75° per seed (the View control's Low/Oblique/High presets each land within ±3° of a target angle), yaw rolls ±30°. After projection the whole mesh is fit to the page — bounding-box measured, uniformly scaled, and centered — so the sheet always floats whole inside the border, at whatever size its current bend produces.

**Visibility.** One 512×512 depth grid, built by rasterizing every mesh facet in camera space (pure math — nothing is ever read back from a canvas). Every drawable segment in the piece — mesh iso-lines, hatch strokes, the red crease — passes through the same `visibilityClip`: ~4px sampling along the segment to find visible/hidden runs, then seven bisection iterations to refine each transition to sub-pixel precision. It's one clip function for the entire drawing, which is the point — the mesh doesn't get a different occlusion rule than the hatching.

Honest note: the ~4px sampling means hidden slivers narrower than the grid's own quantization can occasionally survive uncaught — measured at 0.1–0.5% of pieces at the default mesh density. At plot scale they're invisible; documented here as a known approximation rather than a bug.

**Hatching.** Density comes from slope, not from an arbitrary fill rule: each facet's shading is `1 − |normal·view|` — zero for a facet facing the camera dead-on, rising as it turns edge-on. Near-flat facets (shading below the empty threshold) stay empty; the sheet's flattest stretches are where the paper shows through, unmarked. The hatch angle follows the level-line direction — perpendicular to the facet's depth gradient — so the strokes wrap around the folds rather than running straight across them. Past a shading threshold the facet cross-hatches, adding a second pass at 90° for the steepest surfaces.

**The red.** One line only: the ridge of the sheet's sharpest crease (the strongest sharp fold if the seed has one, otherwise the crest of the strongest sine). It goes through the exact same `visibilityClip` as everything else, which means the fold can occlude its own crest — the red line can visibly break where the sheet folds over itself. That's not a bug either; it's the same physical honesty the rest of the drawing commits to.

---

## Controls

| Section | Control | Effect |
|---|---|---|
| Form | folds | number of superposed folds — random / 2 / 3 / 4 / 5 |
| Form | character | Soft (all sine) / Mixed / Sharp (crease-dominant) |
| Form | amplitude | fold depth — Gentle / Medium / Deep |
| Mesh | density | Coarse 40 / Medium 64 / Fine 96 (per side) |
| Hatch | density | Off / Light / Medium / Dense |
| View | angle | camera preset — random / low / oblique / high |
| Style | wobble | hand-jitter on all strokes — off (default) / on |
| — | randomize | reroll all parameters + new seed |
| — | refresh | new seed, same parameters |
| — | svg / png / png 4x | export |

Click the canvas for a new seed. Every run is deterministic in (seed, parameters) — same inputs, identical drawing, every time.

---

## Page & Palette

Square 2170×2170, warm paper (`#F7E6D4`), near-black ink (`#1A1613`). Red (`#A93B2A`) is reserved for exactly one thing: the sharpest crease's ridge line.

---

## SVG / Plotter Output

One Inkscape pen pass per element, bottom to top:

1. **Border** — registration frame
2. **Hatch** — the slope-shaded fill strokes
3. **Mesh** — the iso-line wireframe
4. **Crease** — the single red ridge line
5. **Signature** — seed, fold count, timestamp

Files are named `fold_<seed>.svg` / `.png`. The **png 4x** button renders the composition at 8680×8680 for large prints (`_4x.png`).

---

## Lineage

| Work | Connection |
|---|---|
| Hidden-line removal, 1960s–70s computer graphics | The problem this whole piece is built to solve — the historical anchor, not a depicted subject |
| strata v3 (folded geology, from the `self-redaction` sketch) | The fold field's DNA — the same sine math, extruded from a 2D landscape fold into a true 3D z-displacement |
| [core-samples](https://github.com/lukaszlysakowski/core-samples) | Source of the occlusion/fill-clipping geometry (`fillHatch`, polygon clipping) this piece's hatch pass is built on |
| [second-reading](https://github.com/lukaszlysakowski/second-reading) | Sidebar/export pattern (`exportPNG`, cycling controls) carried forward into this piece's UI |
| [palimpsest](https://github.com/lukaszlysakowski/palimpsest), [field-script](https://github.com/lukaszlysakowski/field-script) | Family members sharing this project's accessibility floor and generative lineage |

Fold is a local project — not yet published to a public repository.

---

## Running Locally

No build step, no server-side code. Serve the directory with any static file server:

```bash
npx serve .
```

(A `.claude/launch.json` config runs this on port 3461.) p5.js is vendored (`p5.min.js`).
