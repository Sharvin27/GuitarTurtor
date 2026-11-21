// Full-frame motion fingerprint and hot-path clone counts; run before/after IK allocation changes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HandRig } from '../js/hand.js';
import { Performer } from '../js/performer.js';
import { normalizeScore, solveFingering } from '../js/fingering.js';
import { prepareTimeline } from '../js/timeline.js';

async function hand(side) {
  const b = fs.readFileSync(new URL(`../assets/generic-hand-${side}.glb`, import.meta.url));
  const g = await new Promise((resolve, reject) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));
  return new HandRig(g.scene, side);
}
const left = await hand('left'), right = await hand('right');
let depth = 0, clones = 0, fkCalls = 0, dlsCalls = 0;
for (const name of ['fk', '_dls']) {
  const original = HandRig.prototype[name];
  HandRig.prototype[name] = function (...args) {
    if (name === 'fk') fkCalls++; else dlsCalls++;
    depth++;
    try { return original.apply(this, args); } finally { depth--; }
  };
}
for (const Type of [THREE.Vector3, THREE.Quaternion]) {
  const original = Type.prototype.clone;
  Type.prototype.clone = function () { if (depth) clones++; return original.call(this); };
}
for (const [song, mode] of [['choo-lo', 'fingers'], ['rabba', 'pick']]) {
  const events = prepareTimeline(solveFingering(normalizeScore(JSON.parse(fs.readFileSync(new URL(`../data/score-${song}.json`, import.meta.url))))), mode);
  const perf = new Performer(left, right), hash = crypto.createHash('sha256');
  perf.setEvents(events);
  clones = fkCalls = dlsCalls = 0;
  let frames = 0;
  const start = performance.now();
  for (let T = 0; T < events.at(-1).t + 1; T += 1 / 60) {
    perf.update(T, 1 / 60, frames === 0); frames++;
    const values = [];
    for (const h of [left, right]) {
      values.push(...h.place.elements);
      for (const ch of Object.values(h.chains)) {
        values.push(...ch.theta, ch.err);
        for (const p of ch.outP) values.push(p.x, p.y, p.z);
        for (const q of ch.outQ) values.push(q.x, q.y, q.z, q.w);
      }
    }
    hash.update(Buffer.from(new Float64Array(values).buffer));
  }
  console.log(JSON.stringify({ song, frames, hash: hash.digest('hex'), clones, fkCalls, dlsCalls, ms: Math.round(performance.now() - start) }));
}
