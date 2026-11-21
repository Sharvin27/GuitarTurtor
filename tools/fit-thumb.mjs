// Fits the fretting-hand thumb target (PF.THUMB) for reachability: run from the repo root,
//   node tools/fit-thumb.mjs
// Scores mean and 95th-percentile thumb IK error over both songs, plus time spent at the abduction limit.
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import * as THREE from 'three'; import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const ROOT = process.cwd(); const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
const F = await imp('js/fingering.js'), TL = await imp('js/timeline.js'), H = await imp('js/hand.js'), PF = await imp('js/performer.js');
const load = async s => { const b = fs.readFileSync(`assets/generic-hand-${s}.glb`); const g = await new Promise((r, j) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', r, j)); return new H.HandRig(g.scene, s); };
const L = await load('left'), R = await load('right');
const songs = [['choo-lo', 'fingers'], ['rabba', 'pick']].map(([k, m]) => TL.prepareTimeline(F.solveFingering(F.normalizeScore(JSON.parse(fs.readFileSync(`data/score-${k}.json`)))), m));
function run() {
  const errs = [], abd = [];
  for (const ev of songs) { const p = new PF.Performer(L, R); p.setEvents(ev);
    for (let T = 0, first = true; T < ev[ev.length - 1].t; T += 1 / 30, first = false) { p.update(T, 1 / 30, first); if (T > 0.5) { errs.push(L.chains.thumb.err * 1000); abd.push(L.chains.thumb.theta[0] * 57.3); } } }
  errs.sort((a, b) => a - b); const mean = errs.reduce((a, b) => a + b, 0) / errs.length, p95 = errs[Math.floor(errs.length * 0.95)];
  const atLim = abd.filter(a => a < -44 || a > 44).length / abd.length;
  return { mean: +mean.toFixed(1), p95: +p95.toFixed(1), atLim: +atLim.toFixed(2), score: mean + 0.3 * p95 + 20 * atLim };
}
const res = [];
for (const dx of [-0.06, -0.05, -0.04, -0.03]) for (const u0 of [-1.0, -0.95, -0.9, -0.8]) for (const depth of [0.004, 0.008, 0.012]) for (const uk of [0, 0.06]) {
  Object.assign(PF.THUMB, { dx, u0, uk, depth, uMin: -0.95, uMax: 0.8 });
  res.push({ dx, u0, uk, depth, ...run() });
}
res.sort((a, b) => a.score - b.score); console.log(res.slice(0, 8));
