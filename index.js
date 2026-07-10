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
    // Task 2: rollFolds + rollCamera; Task 3: buildMesh/project; Task 4: depth grid;
    // Task 5: emitPasses.
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
