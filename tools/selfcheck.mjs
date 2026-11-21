// Offline self-check: simulates the performer at 60 fps for every song and measures, at each note onset,
// the distance between the pressing fingertip and its exact target (string/fret contact point, with bends).
// Usage (needs three@0.160.0 resolvable as 'three', e.g. via a resolve hook):
//   npm install && npm run selfcheck   (or: node tools/selfcheck.mjs [--fit-right])
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
const F = await imp('js/fingering.js'), TL = await imp('js/timeline.js'), H = await imp('js/hand.js');
const PF = await imp('js/performer.js'), G = await imp('js/guitar.js');

async function loadHand(side) {
  const buf = fs.readFileSync(path.join(ROOT, `assets/generic-hand-${side}.glb`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  return new H.HandRig(gltf.scene, side);
}
const left = await loadHand('left'), right = await loadHand('right');
const SONGS = [['choo-lo', 'data/score-choo-lo.json', 'fingers'], ['rabba', 'data/score-rabba.json', 'pick']];
const stats = a => a.length ? { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), max: +Math.max(...a).toFixed(2), over3: a.filter(v => v > 3).length } : { n: 0 };

function simulate(key, file, mode, verbose = true) {
  const score = JSON.parse(fs.readFileSync(path.join(ROOT, file)));
  const events = TL.prepareTimeline(F.solveFingering(F.normalizeScore(score)), mode);
  const perf = new PF.Performer(left, right);
  perf.setEvents(events);
  const dt = 1 / 60, end = events[events.length - 1].t + 1;
  let ei = 0, first = true;
  const fretErr = [], pluckErr = [], worst = [];
  let pi = 0; const plucks = mode === 'pick' ? events.plucks.pick : Object.entries(events.plucks).flatMap(([k, l]) => l.map(p => ({ ...p, rf: k }))).sort((a, b) => a.t - b.t);
  for (let T = 0; T < end; T += dt) {
    const out = perf.update(T, dt, first); first = false;
    while (ei < events.length && events[ei].t <= T) {
      const ev = events[ei++];
      for (const n of ev.fretted) {
        const k = TL.FINGER_KEYS[n.finger - 1];
        const exact = new THREE.Vector3(G.contactX(n.f), TL.PRESS_Y, G.stringZ(n.s, G.contactX(n.f)) + TL.bendOffset(ev, n, T));
        const d = left.tipG(k).distanceTo(exact) * 1000;
        fretErr.push(d);
        worst.push({ d, t: ev.t, s: n.s, f: n.f, k, pos: ev.pos, legato: ev.legato });
      }
    }
    // picking: at each pluck onset the plucking finger (or pick tip) should be at the string
    while (pi < plucks.length && plucks[pi].t <= T) {
      const p = plucks[pi++];
      if (mode === 'pick') {
        const tip = perf.pick.tip, zs = p.strings.map(s => G.stringZ(s, tip.x));
        const dz = Math.max(0, Math.min(...zs) - tip.z, tip.z - Math.max(...zs));  // inside the stroke span = 0
        const dy = Math.abs(tip.y - G.stringY(tip.x));
        pluckErr.push(Math.hypot(dz, Math.max(0, dy - 0.002)) * 1000);
        if (process.env.DBG && pluckErr.length < 12) console.log("pick", p.t.toFixed(2), p.dir, p.strings.join("/"), "dz", (dz*1000).toFixed(1), "dy", (dy*1000).toFixed(1), "tipz", (tip.z*1000).toFixed(1), "zs", zs.map(z => (z*1000).toFixed(1)).join("/"));
      } else {
        const tip = right.tipG(p.rf);
        const target = new THREE.Vector3(tip.x, G.stringY(tip.x), G.stringZ(p.s, tip.x));
        pluckErr.push(Math.hypot(tip.y - target.y, tip.z - target.z) * 1000);
      }
    }
  }
  worst.sort((a, b) => b.d - a.d);
  if (verbose) {
    console.log(`\n== ${key} (${mode}) ==`);
    console.log('fretting fingertip error at onset (mm):', JSON.stringify(stats(fretErr)));
    console.log('picking contact error at onset (mm):   ', JSON.stringify(stats(pluckErr)));
    console.log('worst fretting notes:', worst.slice(0, 6).map(w => `t=${w.t.toFixed(2)} s${w.s}f${w.f} ${w.k} pos${w.pos}${w.legato ? ' ' + w.legato : ''}: ${w.d.toFixed(1)}mm`).join(' | '));
  }
  return { fret: stats(fretErr), pluck: stats(pluckErr) };
}

if (process.argv.includes('--fit-right')) {
  const res = [];
  for (const beta of [20, 35, 50]) for (const ky of [0.045, 0.06, 0.075]) for (const kz of [-0.015, 0.0, 0.015, 0.03]) for (const dx of [-0.01, 0.0, 0.01, 0.02]) {
    Object.assign(PF.RIGHT, { beta: beta * Math.PI / 180, ky, kz, dx });
    const r = simulateRightOnly();
    res.push({ beta, ky, kz, dx, ...r });
  }
  res.sort((a, b) => a.score - b.score);
  console.log(res.slice(0, 6));
} else {
  for (const s of SONGS) simulate(...s);
}

// quick static IK test of the right hand over its plant/through/rest targets
function simulateRightOnly() {
  const { l: lR, f: fR } = PF.rightAxes();
  const X = TL.PLUCK_X, zc = G.stringZ(2.5, X);
  right.setPlacement(new THREE.Vector3(X + PF.RIGHT.dx, G.stringY(X) + PF.RIGHT.ky, zc + PF.RIGHT.kz), lR, fR);
  const sets = { thumb: [3, 4, 5], index: [2, 3], middle: [1, 2], ring: [0, 1] };
  const dxs = { thumb: -0.03, index: -0.008, middle: 0.002, ring: 0.012 };
  let sum = 0, n = 0, worst = 0, nat = 0;
  for (const [k, ss] of Object.entries(sets)) for (const s of ss) for (const [dy, dz] of [[0.0008, -0.0022], [0.005, 0.008], [0.006, -0.003]]) {
    const dir = k === 'thumb' ? -1 : 1, x = X + dxs[k];
    const t = new THREE.Vector3(x, G.stringY(x) + dy, G.stringZ(s, x) + dir * dz);
    right.solve({ [k]: t });
    const ch = right.chains[k]; sum += ch.err; n++; worst = Math.max(worst, ch.err);
    nat += ch.theta.reduce((a, v, j) => a + Math.max(0, v - (ch.hi[j] - 0.2)) + Math.max(0, ch.lo[j] + 0.2 - v), 0);
  }
  return { mean: +(sum / n * 1000).toFixed(2), worst: +(worst * 1000).toFixed(2), score: sum / n * 1000 + 0.3 * worst * 1000 + 20 * nat / n };
}
