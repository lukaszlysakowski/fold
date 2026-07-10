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
    // Task 4: depth grid; Task 5: emitPasses.
    renderAll();
}

function renderAll() {
    background(PAPER);
    // Task 5 adds pass drawing here.
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
