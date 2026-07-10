# Fold — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design sections §1–§3 approved in session)

## Concept

A pure folded sheet, floating in empty space — no terrain, no document, no
instrument. Strata v3's fold math (`sin(t·freq + phase)·amp`) extruded into
actual 3D as a displacement field on a parametric sheet, drawn with true
hidden-line removal: a flowing iso-line mesh, slope-responsive hatching that
wraps the folds, and one red line — the ridge of the sharpest crease, the
system marking its own extremum. The abstraction successor to strata v3 by
way of the family's occlusion machinery; nothing on the page refers to
anything but the fold itself.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Subject | Pure sheet — rectangular parametric surface, floating, centered; NO ground plane, horizon, or terrain reading |
| Rendering | Contour mesh (u/v iso-lines) + slope hatch, hidden-line removal on everything |
| Hidden-line method | Approach C — sampled camera-space depth grid (512×512, pure math, no canvas readback) + per-segment sampling (~4 page-px) with bisection refinement at visibility transitions |
| Format | Square 2170×2170, 4% border pad; paper #F7E6D4, ink #1A1613 |
| Red | ONE red element: the sharpest crease's ridge polyline, visibility-clipped, slightly heavier weight |
| Camera | Orthographic; per-seed pitch ≈ 55–75° and yaw ≈ ±30°, preset-steered by the View control |
| Scope | Full maker (sidebar controls, SVG pen passes, PNG + PNG 4x) — NO learning system, no feedback loop, no server |
| Repo | Own git repo at `/Users/lukasz/genuary-2026/sketches/fold`, LOCAL ONLY — publish to GitHub only when the user later asks (palimpsest pattern) |
| Wobble | Available but DEFAULT OFF — crisp geometry is the primary reading |

## §1 Structure & sheet model

**Files:** `index.html` (house sidebar, a11y-tuned CSS carried from palimpsest
— `--muted: #969082`, `.ctrl` min-height 24px, do not regress; title "Fold",
subtitle "sheet · crease · occlusion"; zero user-visible sibling-name
strings), `index.js`, vendored `p5.min.js` (copy from palimpsest),
`README.md`, `LICENSE`, `.gitignore` (renders/, experiments/, .claude/,
.DS_Store, node_modules/, .superpowers/). `.claude/launch.json`: `npx serve .
--listen 3461`, port 3461.

**Sheet.** Parametric `u,v ∈ [0,1]²`; rest position `x = (u−0.5)·SHEET_W`,
`y = (v−0.5)·SHEET_H`, `z = 0` (SHEET_W = SHEET_H = 1500 world units,
comfortably inside the 2170 page after projection margins). Displaced by the
fold field:

```
per fold k (K = 2–5 per seed; direction θk in the sheet plane):
  t = x·cos θk + y·sin θk
  soft  (sine):       z += ampk · sin(t · freqk + phasek)
  sharp (triangular): z += ampk · max(0, 1 − |t − ck| / wk)
```

Character control weights the mix: Soft = all sine; Mixed = sine + 0–2 sharp;
Sharp = crease-dominant (≥1 sharp always, sines subordinate). Amplitude
control scales the amp pool (Gentle/Medium/Deep). Fold parameter ranges are
tuning values, initial: freq ∈ [0.004, 0.011] (world units⁻¹), amp ∈
[60, 260] scaled by amplitude level, crease width w ∈ [90, 260], ck ∈
central 70% of the t-range, θk anywhere (folds may cross at any angle).

**Camera & projection.** Orthographic. Rotate world by pitch (View presets:
Low ≈ 58°, Oblique ≈ 66°, High ≈ 74°, ±3° per-seed jitter; random = roll
across the full 55–75°) and yaw (per-seed ∈ ±30°), then map camera-plane
x,y to the page, uniformly scaled and centered so the projected sheet fits
inside the border with breathing room (fit computed from the projected
bounding box each regenerate — the sheet floats, never crops). Camera-space
z is retained per vertex as depth (smaller = nearer).

**Mesh.** `RES × RES` vertex grid (Mesh density: Coarse 40 / Medium 64 /
Fine 96). Derived: iso-lines along u and along v (polylines through the
grid), facets (quads, each with mean camera depth + unit normal), and the
crease polyline: the ridge `t = ck` of the strongest sharp crease traced
across the sheet (analytic, sampled at RES points, clipped to the sheet
rectangle); if the seed has no sharp crease, the crest line of the strongest
sine fold (the `t` where sin = 1 nearest the sheet centre) — the "sharpest
crease" always exists.

**Data model:**

```js
state = {
  masterSeed,
  folds: [ { kind:'sine'|'sharp', theta, amp, freq?, phase?, c?, w? } ],
  camera: { pitch, yaw, scale, cx, cy },        // fit params included
  mesh: { verts, isoU, isoV, facets },          // camera/page space
  passes: { border:[], hatch:[], mesh:[], crease:[] },  // visible page-space atoms
  sharpest: { foldIdx, polyline }               // what plots red
}
```

All randomness happens at plan level (folds + camera rolls under the master
seed); everything downstream is pure deterministic geometry — `fillHatch` is
deterministic, no reseeding needed mid-pipeline.

## §2 Visibility pipeline

**Depth grid.** Rasterize every facet's projected quad into a 512×512
camera-plane grid keeping the nearest depth per cell (pure math scanline
fill). The family's analytic-grid idiom; the piece's one approximation.

**visibilityClip(segment) — one function for every drawable:**
1. Sample every ~4 page-px along the segment; at each sample compare the
   segment's interpolated camera depth against the depth grid + a depth bias
   proportional to facet size (no self-occlusion).
2. Group consecutive visible samples into runs.
3. Bisect at each visible↔hidden flip (against the same grid test) to
   sub-pixel precision.
4. Emit visible sub-segments only.

Iso-lines, hatch strokes, and the crease polyline ALL pass through it —
uniform occlusion, and a single choke point the harness can verify.

**Slope hatching.** Per facet: shading = angle between facet normal and view
direction (facing away = darker). Shading → hatch density; hatch angle = the
page-space angle of the facet's steepest-descent vector projected to the
camera plane (strokes wrap the folds); where that vector degenerates
(facet nearly face-on to the camera), the facet is near-flat in shading terms
and gets little or no hatch anyway, so no special case is needed. Strokes
generated by the ported `fillHatch(projectedQuad, density, angleDeg)`
(redaction-plotter kit, verbatim minus the getAngle indirection — the
established port), then visibility-clipped. Facets beyond a steepness
threshold get cross-hatch; near-flat facets get nothing. Hatch control:
Off/Light/Medium/Dense.

**The red crease.** `sharpest.polyline` projected, visibility-clipped, red
#A93B2A at ~1.4× mesh weight. One red line; occlusion may break it where the
sheet folds over it — desired behavior, not a defect.

**Per regenerate:** roll folds+camera → build mesh → project + fit → depth
grid → emit passes (border, hatch, mesh, crease) → render. Deterministic for
(seed, params).

## §3 UI, export, verification

**Sidebar:**

| Section | Controls |
|---|---|
| Form | folds (random/2/3/4/5), character (Soft/Mixed/Sharp), amplitude (Gentle/Medium/Deep) |
| Mesh | density (Coarse/Medium/Fine = 40/64/96) |
| Hatch | density (Off/Light/Medium/Dense) |
| View | angle (random/Low/Oblique/High) |
| Style | wobble (off/on — DEFAULT OFF) |
| Actions | randomize (reroll all + new seed) · refresh (new seed, same params) · svg · png · png 4x |

Click canvas = new seed. Defaults: folds random, character Mixed, amplitude
Medium, mesh Medium, hatch Medium, view random, wobble off. Signature:
`Fold · seed N · K folds  YYYY-MM-DD HH:MM`.

**Export.** SVG Inkscape pen passes bottom→top: `Border` / `Hatch` (0.45) /
`Mesh` (0.7) / `Crease` (red, 1.0) / `Signature` — 5 groups; occlusion baked
into geometry so any subset plots correctly. PNG full-res; PNG 4x = 8680×8680
via the pixelDensity re-render pattern (Second Reading's exportPNG(scale)).
Files `fold_<seed>`, 4x suffixed `_4x`. Wobble, when on, seeds from segment
geometry (`seg.x1 * 0.01` — the family parity convention) in both canvas and
SVG.

**Verification** (node harness, vm + p5-stub pattern from the siblings):
- Fold field: z continuous; a lone triangular crease's ridge maximum sits at
  `t = ck` (±grid step); superposed field equals sum of parts.
- Projection: orthographic round-trip on known points; depth order preserved.
- **Occlusion invariant:** for every emitted segment, interior re-samples are
  never deeper than depth grid + bias; a constructed two-fold overlap scene
  yields a known iso-line split into ≥2 visible pieces.
- Bisection: transition endpoints within 1 page-px of a brute-force
  fine-sampled reference.
- Determinism: same (seed, params) twice → identical pass counts and coords.
- Export: exactly 5 groups in order; red only in Crease; no NaN; signature
  regex; `fold_` prefix present.
- Browser gates per task; Lighthouse accessibility 100 floor.

## Out of scope for v1

- GitHub/Pages (publish only on later request)
- Learning/rating system, any feedback loop, server-side code
- Multiple intersecting sheets (the pipeline is built general enough to allow
  it later, but v1 is one sheet)
- Perspective camera, animation
