// Edge cases beyond the bundled songs: node --test tools/regression.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HandRig } from '../js/hand.js';
import { Performer } from '../js/performer.js';
import { normalizeScore, solveFingering } from '../js/fingering.js';
import { prepareTimeline } from '../js/timeline.js';
import { analyzeHarmony } from '../js/harmony.js';

const prepare = (score, mode = 'pick') => prepareTimeline(solveFingering(normalizeScore(score)), mode);
const melody = () => ({ bpm: 120, notes: Array.from({ length: 8 }, (_, i) => ({ t: 2 + i / 4, n: [[0, [8, 12, 15, 12][i % 4]]] })) });

test('missing beats use tempo relative to the first onset, including picking and harmony', () => {
  const score = melody(), before = JSON.stringify(score), ev = prepare(score);
  assert.deepEqual(ev.map(e => e.q), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(ev.plucks.pick.map(p => p.dir), [1, -1, 1, -1, 1, -1, 1, -1]);
  assert.ok(analyzeHarmony(ev).length > 0);
  assert.equal(JSON.stringify(score), before);
  score.notes.forEach((n, i) => { n.q = 4 + i / 2; });
  assert.deepEqual(prepare(score).map(e => e.q), score.notes.map(n => n.q));
});

test('invalid tempos and durations cannot produce infinite beats or durations', () => {
  for (const bpm of [0, -120, NaN, Infinity, undefined]) {
    const score = melody(); score.bpm = bpm; score.notes[0].d = Infinity;
    const ev = prepare(score);
    assert.equal(ev.bpm, 120);
    assert.ok(ev.every(e => Number.isFinite(e.q) && Number.isFinite(e.dur) && e.dur > 0));
  }
});

async function hand(side) {
  const b = fs.readFileSync(new URL(`../assets/generic-hand-${side}.glb`, import.meta.url));
  const g = await new Promise((resolve, reject) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));
  return new HandRig(g.scene, side);
}
function finitePose(h) {
  assert.ok(h.place.elements.every(Number.isFinite));
  for (const ch of Object.values(h.chains)) {
    assert.ok(ch.theta.every((v, j) => Number.isFinite(v) && v >= ch.lo[j] && v <= ch.hi[j]));
    for (const p of ch.outP) assert.ok([p.x, p.y, p.z].every(Number.isFinite));
  }
}

test('empty songs and clearing a song produce finite resting poses in both modes', async () => {
  const left = await hand('left'), right = await hand('right');
  for (const mode of ['fingers', 'pick']) {
    const perf = new Performer(left, right);
    perf.setEvents(prepare(melody(), mode));
    perf.update(2.5, 1 / 60, true);
    for (const empty of [prepare({ bpm: 120, notes: [] }, mode), []]) {
      perf.setEvents(empty);
      for (const T of [0, 5, 0]) {
        const out = perf.update(T, 1 / 60, true);
        assert.equal(out.st.now, -1);
        assert.deepEqual(out.pressed, [null, null, null, null, null, null]);
        assert.equal(out.st.sounding.length, 0);
        finitePose(left); finitePose(right);
      }
    }
  }
});

test('forward/backward seeks and rate changes keep both rigs finite', async () => {
  const left = await hand('left'), right = await hand('right');
  for (const mode of ['fingers', 'pick']) {
    const perf = new Performer(left, right);
    perf.setEvents(prepare(melody(), mode));
    for (const start of [0, 3.5, 2.1, 8, 0]) {
      perf.update(start, 1 / 60, true);
      let T = start;
      for (const rate of [0.5, 0.75, 1, 1.5]) for (let i = 0; i < 12; i++) {
        T += rate / 60; perf.update(T, 1 / 60, false);
        finitePose(left); finitePose(right);
      }
    }
  }
});
