# Fold — Generative Plotter Art

## Project
A p5.js maker that folds a pure parametric sheet in 3D (strata v3's sine math + triangular sharp creases as a z-displacement field) and draws it with TRUE hidden-line removal. No terrain/document/instrument — the fold is the subject. Public repo: https://github.com/lukaszlysakowski/fold — live maker: https://lukaszlysakowski.github.io/fold/

## The Visibility Pipeline (the load-bearing part)
- Orthographic camera; per-seed pitch 55–75° + yaw ±30°; fit-to-page so the sheet floats whole.
- 512² camera-plane depth grid (pure math scanline, NO canvas readback — the family's analytic-grid idiom).
- ONE `visibilityClip(seg)` handles every drawable (iso-mesh, hatch, red crease): ~4px sampling + 7-iteration bisection at visible↔hidden transitions.
- **Documented approximation:** hidden slivers narrower than the grid's ~4px quantization survive occlusion on ~0.1–0.5% of pieces at default mesh (res=64). Invisible at plot scale. The harness scopes the STRICT zero-violation invariant to res=40 and adds a res=64 rate tripwire (≤25%). DEPTH_BIAS_K (0.75) is the tuning knob if artifacts ever surface — don't "fix" the slivers by finer sampling alone (the grid quantization floor is comparable to the sample step).

## Determinism contract
All randomness at plan level: Math.random ONLY at seed choice + randomizeAll; everything downstream reseeds via randomSeed and is pure geometry. Wobble parity: segToPath and drawSegment both seed from seg.x1*0.01 (+50) — keep in sync.

## Data model gotchas
- `state.mesh.verts` use `{px, py, depth}` (page coords, depth in WORLD units, unscaled by fit).
- `state.creasePolyline` uses `{x, y, depth}` — DIFFERENT field names; don't cross them.
- Depth grid rasterizes world-unit depths; DEPTH_BIAS is world units; visibleAt compares like-with-like. Keep depth unscaled by the page fit.
- Crease clip trims out-of-rect points and relies on the crease being a straight line (in-rect points stay contiguous) — if the crease ever curves, revisit.

## Lineage
- strata v3 (folded geology) in `~/claude/self-redaction/strata.html` — the fold DNA (highest-rated strata version)
- Hidden-line removal = THE canonical 1960s–70s computer-graphics problem; that's the historical anchor
- Fill kit ported from [core-samples](https://github.com/lukaszlysakowski/core-samples) (itself from redaction-plotter)
- Siblings: [palimpsest](https://github.com/lukaszlysakowski/palimpsest) (CSS/a11y source), [second-reading](https://github.com/lukaszlysakowski/second-reading) (harness + exportPNG(scale) patterns), [field-script](https://github.com/lukaszlysakowski/field-script)
- Design history + per-task review trail: `docs/superpowers/` and `.superpowers/sdd/progress.md`

## Architecture
- `index.html` / `index.js` — single maker, no build step, p5 vendored; static serve (launch config `fold`, npx serve port 3461)
- Pipeline per regenerate: rollFolds/rollCamera → buildMesh (project + fit) → buildDepthGrid → emitPasses (occlusion) → renderAll

## Palette & A11y
Square 2170×2170. Paper #F7E6D4, ink #1A1613, crease red #A93B2A (only red on the page). Sidebar CSS WCAG-tuned (--muted #969082, .ctrl min-height 24px) — Lighthouse a11y 100; don't regress.

## Controls
Form (folds, character Soft/Mixed/Sharp, amplitude) · Mesh (density) · Hatch (Off/Light/Medium/Dense) · View (angle) · Style (wobble, default OFF) · randomize / refresh / svg / png / png 4x · click canvas = new seed. SVG pen passes: Border / Hatch / Mesh / Crease / Signature.
