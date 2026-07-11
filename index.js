// Fold — a sheet folded in 3D, drawn with true hidden-line removal.
// Fold field = strata v3's sine math extruded to z; occlusion via a sampled
// camera-space depth grid (the family's analytic-grid idiom).

const CS = 2170, PAD = Math.round(CS * 0.04);
const PAPER = '#F7E6D4', INK = '#1A1613', RED = '#A93B2A';
const SHEET_W = 1500, SHEET_H = 1500;          // world units, flat sheet extent
const MESH_RES = [40, 64, 96];                  // Coarse / Medium / Fine
const DEPTH_RES = 512;                          // depth grid resolution
const AMP_SCALE = [0.6, 1.0, 1.6];              // Gentle / Medium / Deep
const HATCH_MULT = [0, 0.6, 1.0, 1.5];          // Off / Light / Medium / Dense
const VIEW_PITCH = [58, 66, 74];                // Low / Oblique / High (degrees)
const DEPTH_BIAS_K = 0.75;                      // bias = K * SHEET_W / res (tuning value)

let state = { masterSeed: 0, folds: [], camera: null, mesh: null, passes: null, sharpest: null };
let ui = { folds: 'random', character: 1, amplitude: 1, mesh: 1, hatch: 2, view: 'random', wobble: false };

function emptyPasses() { return { border: [], hatch: [], mesh: [], crease: [] }; }

// ─── fold field ─── strata v3's fold math, extruded to a z-displacement field.

function tMax(theta) {
    return (SHEET_W / 2) * Math.abs(Math.cos(theta)) + (SHEET_H / 2) * Math.abs(Math.sin(theta));
}

function rollFolds() {
    const K = ui.folds === 'random' ? 2 + Math.floor(random(4)) : parseInt(ui.folds, 10);
    const ampScale = AMP_SCALE[ui.amplitude];
    // sharp-crease count by character: Soft = 0; Mixed = 0–2 (keeping ≥1 sine);
    // Sharp = crease-dominant (≥1, may be all).
    let nSharp = ui.character === 0 ? 0
               : ui.character === 2 ? Math.max(1, Math.round(K * 0.6))
               : Math.min(Math.floor(random(3)), K - 1);
    const folds = [];
    for (let k = 0; k < K; k++) {
        const theta = random(TWO_PI);
        const amp = random(60, 260) * ampScale;
        if (k < nSharp) {
            folds.push({ kind: 'sharp', theta, amp,
                         c: random(-0.7, 0.7) * tMax(theta),   // central 70% of the t-range
                         w: random(90, 260) });
        } else {
            folds.push({ kind: 'sine', theta, amp,
                         freq: random(0.004, 0.011), phase: random(TWO_PI) });
        }
    }
    return folds;
}

function rollCamera() {
    const pitchDeg = ui.view === 'random'
        ? random(55, 75)
        : VIEW_PITCH[['low', 'oblique', 'high'].indexOf(ui.view)] + random(-3, 3);
    return { pitch: radians(pitchDeg), yaw: radians(random(-30, 30)) };
}

function foldZ(folds, x, y) {
    let z = 0;
    for (const f of folds) {
        const t = x * Math.cos(f.theta) + y * Math.sin(f.theta);
        if (f.kind === 'sine') z += f.amp * Math.sin(t * f.freq + f.phase);
        else z += f.amp * Math.max(0, 1 - Math.abs(t - f.c) / f.w);
    }
    return z;
}

function pickSharpest(folds) {
    const sharps = folds.filter(f => f.kind === 'sharp');
    if (sharps.length) {
        const f = sharps.reduce((a, b) => (b.amp > a.amp ? b : a));
        return { fold: f, c: f.c };
    }
    // no sharp crease: crest line of the strongest sine (sin = 1 nearest t = 0)
    const f = folds.reduce((a, b) => (b.amp > a.amp ? b : a));
    const period = TWO_PI / f.freq;
    let base = (Math.PI / 2 - f.phase) / f.freq;
    base -= period * Math.round(base / period);
    return { fold: f, c: base };
}

// ─── mesh & projection ─── orthographic; depth = smaller-is-nearer.

function projectPoint(camera, x, y, z) {
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const xr = x * cy - y * sy, yr = x * sy + y * cy, zr = z;
    const a = Math.PI / 2 - camera.pitch;            // tilt from straight-down
    const ca = Math.cos(a), sa = Math.sin(a);
    const y2 = yr * ca - zr * sa;
    const z2 = yr * sa + zr * ca;                    // toward camera = larger
    return { px: xr, py: -y2, depth: -z2 };
}

function fitPoint(fit, px, py) {
    return { x: fit.cx + px * fit.scale, y: fit.cy + py * fit.scale };
}

function buildMesh() {
    const res = MESH_RES[ui.mesh];
    const cam = state.camera;
    // 1) project all raw vertices
    const raw = [];
    for (let v = 0; v <= res; v++) {
        for (let u = 0; u <= res; u++) {
            const x = (u / res - 0.5) * SHEET_W;
            const y = (v / res - 0.5) * SHEET_H;
            raw.push(projectPoint(cam, x, y, foldZ(state.folds, x, y)));
        }
    }
    // 2) fit to page: bbox → uniform scale + center, 60px inner breathing room
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) {
        if (p.px < minX) minX = p.px; if (p.px > maxX) maxX = p.px;
        if (p.py < minY) minY = p.py; if (p.py > maxY) maxY = p.py;
    }
    const avail = CS - 2 * PAD - 2 * 60;
    const scale = Math.min(avail / (maxX - minX), avail / (maxY - minY));
    const fit = { scale,
        cx: CS / 2 - scale * (minX + maxX) / 2,
        cy: CS / 2 - scale * (minY + maxY) / 2 };
    cam.fit = fit;
    // 3) page-space vertices (depth kept in world units)
    const N = res + 1;
    const verts = raw.map(p => { const q = fitPoint(fit, p.px, p.py); return { px: q.x, py: q.y, depth: p.depth }; });
    // 4) iso-lines: index paths along u and along v
    const isoU = [], isoV = [];
    for (let v = 0; v <= res; v++) isoU.push(Array.from({ length: N }, (_, u) => v * N + u));
    for (let u = 0; u <= res; u++) isoV.push(Array.from({ length: N }, (_, v) => v * N + u));
    // 5) facets with camera-space normal + depth gradient (plane fit on first triangle)
    const facets = [];
    for (let v = 0; v < res; v++) for (let u = 0; u < res; u++) {
        const i00 = v * N + u, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
        const p00 = verts[i00], p10 = verts[i10], p01 = verts[i01], p11 = verts[i11];
        // depth-plane d = a*px + b*py + c from (p00, p10, p01)
        const ux = p10.px - p00.px, uy = p10.py - p00.py, ud = p10.depth - p00.depth;
        const vx = p01.px - p00.px, vy = p01.py - p00.py, vd = p01.depth - p00.depth;
        const det = ux * vy - uy * vx;
        const a = det !== 0 ? (ud * vy - uy * vd) / det : 0;
        const b = det !== 0 ? (ux * vd - ud * vx) / det : 0;
        // camera-space normal of the (px, py, depth) surface: (-a, -b, 1) normalized
        const nl = Math.hypot(a, b, 1);
        facets.push({ i00, i10, i11, i01,
            meanDepth: (p00.depth + p10.depth + p01.depth + p11.depth) / 4,
            normal: { x: -a / nl, y: -b / nl, z: 1 / nl },
            grad: { a, b } });
    }
    state.mesh = { res, verts, isoU, isoV, facets };
    // 6) crease polyline: the line t = c across the sheet, sampled res+1 times
    const f = state.sharpest.fold, c = state.sharpest.c;
    const dirX = -Math.sin(f.theta), dirY = Math.cos(f.theta);
    const baseX = c * Math.cos(f.theta), baseY = c * Math.sin(f.theta);
    const L = Math.hypot(SHEET_W, SHEET_H) / 2;
    const pts = [];
    for (let i = 0; i <= res; i++) {
        const s = (i / res - 0.5) * 2 * L;
        const x = baseX + s * dirX, y = baseY + s * dirY;
        if (Math.abs(x) > SHEET_W / 2 || Math.abs(y) > SHEET_H / 2) continue;
        const p = projectPoint(cam, x, y, foldZ(state.folds, x, y));
        const q = fitPoint(fit, p.px, p.py);
        pts.push({ x: q.x, y: q.y, depth: p.depth });
    }
    state.creasePolyline = pts;
}

// ─── visibility ─── sampled depth grid + bisection: the one approximation.

function gridIndex(x, y) {
    const span = CS - 2 * PAD;
    const gx = Math.min(DEPTH_RES - 1, Math.max(0, Math.floor((x - PAD) / span * DEPTH_RES)));
    const gy = Math.min(DEPTH_RES - 1, Math.max(0, Math.floor((y - PAD) / span * DEPTH_RES)));
    return gy * DEPTH_RES + gx;
}

function rasterTriangle(grid, p1, p2, p3) {
    const span = CS - 2 * PAD, cell = span / DEPTH_RES;
    const minX = Math.min(p1.px, p2.px, p3.px), maxX = Math.max(p1.px, p2.px, p3.px);
    const minY = Math.min(p1.py, p2.py, p3.py), maxY = Math.max(p1.py, p2.py, p3.py);
    const gx0 = Math.max(0, Math.floor((minX - PAD) / cell)), gx1 = Math.min(DEPTH_RES - 1, Math.ceil((maxX - PAD) / cell));
    const gy0 = Math.max(0, Math.floor((minY - PAD) / cell)), gy1 = Math.min(DEPTH_RES - 1, Math.ceil((maxY - PAD) / cell));
    const det = (p2.py - p3.py) * (p1.px - p3.px) + (p3.px - p2.px) * (p1.py - p3.py);
    if (det === 0) return;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const x = PAD + (gx + 0.5) * cell, y = PAD + (gy + 0.5) * cell;
        const l1 = ((p2.py - p3.py) * (x - p3.px) + (p3.px - p2.px) * (y - p3.py)) / det;
        const l2 = ((p3.py - p1.py) * (x - p3.px) + (p1.px - p3.px) * (y - p3.py)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const d = l1 * p1.depth + l2 * p2.depth + l3 * p3.depth;
        const i = gy * DEPTH_RES + gx;
        if (d < grid[i]) grid[i] = d;
    }
}

function buildDepthGrid() {
    const grid = new Float64Array(DEPTH_RES * DEPTH_RES).fill(Infinity);
    const V = state.mesh.verts;
    for (const f of state.mesh.facets) {
        const p00 = V[f.i00], p10 = V[f.i10], p11 = V[f.i11], p01 = V[f.i01];
        rasterTriangle(grid, p00, p10, p11);
        rasterTriangle(grid, p00, p11, p01);
    }
    state.depthGrid = grid;
}

function DEPTH_BIAS() { return DEPTH_BIAS_K * SHEET_W / state.mesh.res; }

function visibleAt(x, y, depth) {
    return depth <= state.depthGrid[gridIndex(x, y)] + DEPTH_BIAS();
}

function depthOnFacet(facet, x, y) {
    const p00 = state.mesh.verts[facet.i00];
    return p00.depth + facet.grad.a * (x - p00.px) + facet.grad.b * (y - p00.py);
}

function visibilityClip(seg) {
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const n = Math.max(1, Math.ceil(len / 4));                       // ~4 page-px steps
    const at = t => ({ x: seg.x1 + (seg.x2 - seg.x1) * t,
                       y: seg.y1 + (seg.y2 - seg.y1) * t,
                       d: seg.d1 + (seg.d2 - seg.d1) * t });
    const vis = [];
    for (let i = 0; i <= n; i++) { const p = at(i / n); vis.push(visibleAt(p.x, p.y, p.d)); }
    // bisect a visible↔hidden flip between params [ta, tb]; returns transition t
    function bisect(ta, tb, aVis) {
        for (let k = 0; k < 7; k++) {
            const tm = (ta + tb) / 2, p = at(tm);
            if (visibleAt(p.x, p.y, p.d) === aVis) ta = tm; else tb = tm;
        }
        return (ta + tb) / 2;
    }
    const out = [];
    let runStart = null;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (vis[i] && runStart === null) {
            runStart = i === 0 ? 0 : bisect((i - 1) / n, t, false);
        } else if (!vis[i] && runStart !== null) {
            const tEnd = bisect((i - 1) / n, t, true);
            const a = at(runStart), b = at(tEnd);
            out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            runStart = null;
        }
    }
    if (runStart !== null) {
        const a = at(runStart), b = at(1);
        out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return out;
}

function setup() {
    let c = createCanvas(CS, CS);
    c.parent('canvas-container');
    pixelDensity(1);
    document.getElementById('randomizeBtn').onclick = () => regenerate(true); // Task 6 replaces
    document.getElementById('refreshBtn').onclick   = () => regenerate(true);
    regenerate(true);
    noLoop();
}

function regenerate(newSeed) {
    if (newSeed) state.masterSeed = Math.floor(Math.random() * 1e9);
    randomSeed(state.masterSeed);
    noiseSeed(state.masterSeed);
    state.passes = emptyPasses();
    state.folds = rollFolds(); state.camera = rollCamera(); state.sharpest = pickSharpest(state.folds);
    buildMesh();
    buildDepthGrid();
    emitPasses();
    renderAll();
}

function renderAll() {
    background(PAPER);
    for (const s of state.passes.hatch)  drawSegment(s, 0.45, INK);
    for (const s of state.passes.mesh)   drawSegment(s, 0.7, INK);
    for (const s of state.passes.crease) drawSegment(s, 1.0, RED);
    drawBorderAndSignature();
}

function drawBorderAndSignature() {
    stroke(INK); strokeWeight(0.9); noFill();
    rect(PAD, PAD, CS - PAD * 2, CS - PAD * 2);
    noStroke(); fill(INK);
    textFont('Courier New'); textSize(Math.round(CS * 0.012));
    let n = new Date();
    let stamp = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
    let K = state.folds.length;
    let info = K ? ` · ${K} folds` : '';
    text(`Fold · seed ${state.masterSeed}${info}  ${stamp}`, PAD, CS - PAD + Math.round(CS * 0.022));
}

function mousePressed(e) {
    if (e && e.target && e.target.tagName !== 'CANVAS') return;
    regenerate(true);
}

// ─── fill kit (from core-samples) ───

function getBounds(vertices) {
  let minX = Math.min(...vertices.map(v => v.x));
  let maxX = Math.max(...vertices.map(v => v.x));
  let minY = Math.min(...vertices.map(v => v.y));
  let maxY = Math.max(...vertices.map(v => v.y));
  let diagonal = dist(minX, minY, maxX, maxY);
  let centerX = (minX + maxX) / 2;
  let centerY = (minY + maxY) / 2;

  return { minX, maxX, minY, maxY, diagonal, centerX, centerY };
}

function clipLineToPolygon(x1, y1, x2, y2, vertices) {
  let intersections = [];

  for (let i = 0; i < vertices.length; i++) {
    let v1 = vertices[i];
    let v2 = vertices[(i + 1) % vertices.length];

    let intersection = lineIntersection(x1, y1, x2, y2, v1.x, v1.y, v2.x, v2.y);
    if (intersection) {
      intersections.push(intersection);
    }
  }

  if (pointInPolygon(x1, y1, vertices)) {
    intersections.push({ x: x1, y: y1 });
  }
  if (pointInPolygon(x2, y2, vertices)) {
    intersections.push({ x: x2, y: y2 });
  }

  if (intersections.length < 2) return null;

  let dx = x2 - x1;
  let dy = y2 - y1;
  intersections.sort((a, b) => {
    let ta = dx !== 0 ? (a.x - x1) / dx : (a.y - y1) / dy;
    let tb = dx !== 0 ? (b.x - x1) / dx : (b.y - y1) / dy;
    return ta - tb;
  });

  let first = intersections[0];
  let last = intersections[intersections.length - 1];

  let midX = (first.x + last.x) / 2;
  let midY = (first.y + last.y) / 2;
  if (!pointInPolygon(midX, midY, vertices)) return null;

  return { x1: first.x, y1: first.y, x2: last.x, y2: last.y };
}

function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  let denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return null;

  let t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  let u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }
  return null;
}

function pointInPolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    let xi = vertices[i].x, yi = vertices[i].y;
    let xj = vertices[j].x, yj = vertices[j].y;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function fillHatch(vertices, density, angleDeg) {
  let atoms = [];
  let angle = angleDeg;

  let { minX, maxX, minY, maxY, diagonal, centerX, centerY } = getBounds(vertices);
  let rad = radians(angle);

  for (let offset = -diagonal; offset <= diagonal; offset += density) {
    let x1 = centerX + offset * cos(rad + HALF_PI) - diagonal * cos(rad);
    let y1 = centerY + offset * sin(rad + HALF_PI) - diagonal * sin(rad);
    let x2 = centerX + offset * cos(rad + HALF_PI) + diagonal * cos(rad);
    let y2 = centerY + offset * sin(rad + HALF_PI) + diagonal * sin(rad);

    let clipped = clipLineToPolygon(x1, y1, x2, y2, vertices);
    if (clipped) {
      atoms.push({ kind: 'line', x1: clipped.x1, y1: clipped.y1, x2: clipped.x2, y2: clipped.y2 });
    }
  }

  return atoms;
}

// ─── passes ───

function shadingOf(facet) {
    // 0 = face-on (flat to camera), 1 = edge-on (steep)
    return 1 - Math.abs(facet.normal.z);
}

function hatchAngleOf(facet) {
    // level-line hatching: perpendicular to the depth gradient, wraps the form
    return degrees(Math.atan2(facet.grad.b, facet.grad.a)) + 90;
}

function emitPasses() {
    const P = state.passes, M = state.mesh, V = M.verts;

    // mesh pass: iso-lines through visibility
    for (const line of [...M.isoU, ...M.isoV]) {
        for (let i = 0; i < line.length - 1; i++) {
            const a = V[line[i]], b = V[line[i + 1]];
            P.mesh.push(...visibilityClip({ x1: a.px, y1: a.py, x2: b.px, y2: b.py, d1: a.depth, d2: b.depth }));
        }
    }

    // hatch pass: slope-responsive, per facet
    const mult = HATCH_MULT[ui.hatch];
    if (mult > 0) {
        for (const f of M.facets) {
            const s = shadingOf(f);
            if (s < 0.18) continue;                                  // near-flat: light stays empty
            const quad = [V[f.i00], V[f.i10], V[f.i11], V[f.i01]].map(p => ({ x: p.px, y: p.py }));
            const spacing = Math.min(40, Math.max(4, 3.2 / (Math.pow(s, 1.3) * mult)));
            const angle = hatchAngleOf(f);
            let atoms = fillHatch(quad, spacing, angle);
            if (s > 0.75) atoms = atoms.concat(fillHatch(quad, spacing * 1.4, angle + 90)); // steep: cross-hatch
            for (const a of atoms) {
                P.hatch.push(...visibilityClip({ x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
                    d1: depthOnFacet(f, a.x1, a.y1), d2: depthOnFacet(f, a.x2, a.y2) }));
            }
        }
    }

    // crease pass (red): the sharpest ridge through the same occlusion
    const C = state.creasePolyline;
    for (let i = 0; i < C.length - 1; i++) {
        P.crease.push(...visibilityClip({ x1: C[i].x, y1: C[i].y, x2: C[i + 1].x, y2: C[i + 1].y,
            d1: C[i].depth, d2: C[i + 1].depth }));
    }
}

function wobble(x, y, seed) {
    if (!ui.wobble) return { x, y };
    return { x: x + (noise(x * 0.01, y * 0.01, seed) - 0.5) * 6,
             y: y + (noise(x * 0.01 + 100, y * 0.01 + 100, seed) - 0.5) * 6 };
}

function drawSegment(seg, w, col) {
    stroke(col); strokeWeight(w); noFill();
    const i = seg.x1 * 0.01;
    const p1 = wobble(seg.x1, seg.y1, i), p2 = wobble(seg.x2, seg.y2, i + 50);
    line(p1.x, p1.y, p2.x, p2.y);
}
