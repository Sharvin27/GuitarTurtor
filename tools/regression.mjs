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
import { createHarness } from './fixtures/create-harness.mjs';
import { loadSongAudio, saveSongAudio, deleteSongAudio, shiftScore } from '../js/song-audio.js';
import { assignChord, toScore, reconcileChords } from '../js/songmaker.js';
import { playedChordName } from '../js/chord-agreement.js';
import { describeNotes } from '../js/theory.js';
import { detectAudioChords } from '../js/audio-chords.js';
import { chordSource } from '../js/chordpanel.js';
import { CHORDS, tone, joinAudio } from './fixtures/audio.mjs';
import { playbackHarness } from './fixtures/playback-harness.mjs';
import { fakeIndexedDB } from './fixtures/indexeddb.mjs';

const prepare = (score, mode = 'pick') => prepareTimeline(solveFingering(normalizeScore(score)), mode);
const melody = () => ({ bpm: 120, notes: Array.from({ length: 8 }, (_, i) => ({ t: 2 + i / 4, n: [[0, [8, 12, 15, 12][i % 4]]] })) });
const library = JSON.parse(fs.readFileSync(new URL('../chords/chord_shapes.json', import.meta.url)));
const rawChord = (ps, t = 0, a = 1) => ps.map((p, i) => ({ t: t + i * .008, e: t + .5, p, a }));
const openMidi = [64, 59, 55, 50, 45, 40];

test('3D loads the exact stored Blob before other sources and is ready for Play', async () => {
  const score = { bpm: 120, grid: [12, 12.5], notes: [{ t: 12.2, n: [[0, 0]] }], chords: [{ t0: 12, t1: 13, name: 'C', conf: .9 }] };
  const song = { score, user: true, audioOffset: 12, audioDuration: 1, video: 'test', audio: 'test.mp3', mode: 'fingers' };
  const blob = new Blob(['exact take']), h = playbackHarness({ test: song }, async () => blob);
  await h.ctx.loadSong('test');
  assert.equal(h.created[0], blob); assert.deepEqual(h.sources, []);
  assert.equal(h.ctx.events[0].t, .2); assert.equal(h.panel[0].chords[0].t0, 0);
  assert.equal(h.ui.play.textContent, 'Play'); assert.equal(h.audio.currentTime, 0);
  assert.equal(h.ui.scrub.max, 1);
  assert.equal(h.media.length, 0);
  h.ctx.setPlaying(true); await Promise.resolve(); assert.deepEqual(h.media, ['play']);
  await h.ctx.loadSong('test'); assert.deepEqual(h.revoked, ['blob:test-1']);
  assert.equal(score.notes[0].t, 12.2);
});

test('missing stored audio falls back to video then synth without shifting video times', async () => {
  const score = { bpm: 120, notes: [{ t: 12.2, n: [[0, 0]] }] };
  const h = playbackHarness({ video: { score, user: true, video: 'test', audioOffset: 12 }, synth: { score, user: true } }, async () => null);
  await h.ctx.loadSong('video'); assert.deepEqual(h.sources, ['video']);
  assert.equal(h.ctx.events[0].t, 12.2);
  await h.ctx.loadSong('synth'); assert.deepEqual(h.sources, ['video', 'synth']);
  assert.equal(h.ui.play.textContent, 'Play');
});

test('late recording reads cannot overwrite a newer lesson, even with the same id', async () => {
  const pending = [], score = { bpm: 120, notes: [{ t: .2, n: [[0, 0]] }] };
  const h = playbackHarness({ test: { score, user: true } }, () => new Promise(resolve => pending.push(resolve)));
  const first = h.ctx.loadSong('test'), second = h.ctx.loadSong('test');
  const latest = new Blob(['latest']); pending[1](latest); await second;
  pending[0](new Blob(['stale'])); await first;
  assert.deepEqual(h.created, [latest]);
});

test('IndexedDB Blob round-trip waits for commit and catches storage failure stages', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    const db = fakeIndexedDB(); Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: db });
    const blob = new Blob(['recorded bytes']);
    assert.equal(await saveSongAudio('one', blob), true);
    assert.equal(await (await loadSongAudio('one')).text(), 'recorded bytes');
    assert.equal(await deleteSongAudio('one'), true); assert.equal(await loadSongAudio('one'), null);
    assert.equal(db.closes, 4);
    for (const mode of ['open', 'upgrade', 'transaction', 'request', 'quota', 'abort', 'error', 'blocked']) {
      const broken = fakeIndexedDB(mode);
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: broken });
      assert.equal(await saveSongAudio('one', blob), false, mode);
      assert.equal(await loadSongAudio('one'), null, mode);
      assert.equal(await deleteSongAudio('one'), false, mode);
      assert.equal(broken.data.size, 0, mode);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB;
  }
});

test('audio chroma names C, G, Am and F for sine and harmonic-sum chords', async () => {
  for (const harmonics of [1, 5]) for (const [name, ps] of Object.entries(CHORDS)) {
    const y = tone(ps, { harmonics }), segs = await detectAudioChords(y);
    assert.deepEqual(segs.map(s => s.name), [name], name + ' harmonics=' + harmonics);
    assert.equal(segs[0].t0, 0); assert.equal(segs[0].t1, 1);
    assert.ok(segs[0].conf >= 0 && segs[0].conf <= 1);
  }
});

test('audio smoothing follows a progression and leaves silence unlabelled', async () => {
  const silence = new Float32Array(11025);
  const y = joinAudio(silence, ...Object.values(CHORDS).map(ps => tone(ps, { harmonics: 5 })), silence);
  const segs = await detectAudioChords(y);
  assert.deepEqual(segs.map(s => s.name), ['C', 'G', 'Am', 'F']);
  assert.deepEqual(segs.map(s => [s.t0, s.t1]), [[.5, 1.5], [1.5, 2.5], [2.5, 3.5], [3.5, 4.5]]);
  assert.deepEqual(await detectAudioChords(silence), []);
  assert.deepEqual(await detectAudioChords(new Float32Array()), []);
});

test('panel prefers audio segments, including an empty result, and labels melody fallback', () => {
  const events = prepare(melody()), chords = [{ t0: 0, t1: 1, name: 'C', conf: .9 }];
  assert.deepEqual(chordSource({ chords }, events), { segs: chords, label: 'from the audio' });
  assert.deepEqual(chordSource({ chords: [] }, events), { segs: [], label: 'from the audio' });
  const fallback = chordSource({}, events);
  assert.equal(fallback.label, 'estimated from the melody'); assert.ok(fallback.segs.length);
});

test('monophonic conversion exactly matches the original converter fixture', () => {
  const f = JSON.parse(fs.readFileSync(new URL('./fixtures/monophonic.json', import.meta.url)));
  for (const c of f.cases) for (const lib of [null, library]) assert.equal(JSON.stringify(toScore(f.raw, c.offset, .75, lib)), JSON.stringify(c.score));
});

test('played triads/sevenths split audio labels, survive shifts and guard older scores', () => {
  const notes = [
    { t: .5, n: [[2, 0], [3, 2], [4, 3]] }, // C
    { t: 2.5, n: [[3, 0], [4, 2], [5, 3]] }, // G
    { t: 4.5, n: [[1, 1], [3, 2], [4, 0]] }, // Am
    { t: 6.5, n: [[2, 2], [4, 3], [5, 1]] }, // F
  ];
  const chords = [{ t0: 0, t1: 5, name: 'Em', conf: .7 }, { t0: 5, t1: 8.5, name: 'A', conf: .7 }];
  const before = structuredClone({ notes, chords });
  const result = reconcileChords(chords, notes);
  assert.deepEqual(result.map(s => [s.t0, s.t1, s.name]), [[0, .5, 'Em'], [.5, 2.5, 'C'], [2.5, 4.5, 'G'], [4.5, 6.5, 'Am'], [6.5, 8.5, 'F']]);
  const prepared = normalizeScore({ notes });
  prepared.forEach((e, i) => assert.equal(playedChordName(e), describeNotes(e.notes).name));
  assert.deepEqual(chordSource({ chords }, prepared).segs, result);
  assert.match(chordSource({ chords }, prepared).label, /played notes/);
  assert.deepEqual(reconcileChords(result, notes), result);
  assert.deepEqual({ notes, chords }, before);
  const shifted = shiftScore({ chords, notes }, 12);
  assert.deepEqual(reconcileChords(shifted.chords, shifted.notes), shiftScore({ chords: result, notes }, 12).chords);
  assert.equal(playedChordName({ n: [[0, 0], [1, 1], [2, 0], [4, 3]] }), 'C');
  assert.equal(playedChordName({ n: [[0, 0], [1, 1], [2, 3], [4, 3]] }), 'C7');
  assert.equal(playedChordName({ n: [[0, 0], [1, 1]] }), null);
  const reset = reconcileChords(chords, [notes[0], { t: 1, n: [[0, 0]] }]);
  assert.deepEqual(reset.slice(0, 3).map(s => [s.t0, s.t1, s.name]), [[0, .5, 'Em'], [.5, 1, 'C'], [1, 5, 'Em']]);
  assert.deepEqual(reconcileChords([], notes), []);
  assert.deepEqual(reconcileChords([{ t0: 0, t1: .5, name: 'G' }], notes).map(s => s.name), ['G']);
});

test('creation persists note-agreed labels before navigation', async () => {
  const h = createHarness({ notes: rawChord([45, 48, 52], .2), chords: [{ t0: 0, t1: 1, name: 'Em', conf: .8 }] });
  h.get('file').onchange({ target: { files: [new File(['upload'], 'fixture.wav')] } });
  await h.get('go').onclick();
  const song = [...h.songs.values()][0];
  assert.deepEqual(song.score.chords.map(s => [s.t0, s.t1, s.name]), [[0, .2, 'Em'], [.2, 1, 'Am']]);
  assert.equal(h.navigation[0], 'index.html#' + song.id);
});

test('loud overlapping chord notes share one event and repeated strums survive', () => {
  const ps = [48, 52, 55, 60, 64], raw = [...rawChord(ps), ...rawChord(ps, .1)];
  const before = structuredClone(raw), score = toScore(raw, 0, .75, library);
  assert.equal(score.notes.length, 2);
  for (const n of score.notes) {
    assert.equal(n.n.length, 5);
    assert.deepEqual(n.n.map(([s, f]) => openMidi[s] + f).sort((a, b) => a - b), ps);
    assert.deepEqual(n.n, [[0, 0], [1, 1], [2, 0], [3, 2], [4, 3]]);
  }
  assert.deepEqual(raw, before);
});

test('quiet, non-overlapping, two-class and unplayable groups retain the melody path', () => {
  for (const raw of [rawChord([60, 64, 67], 0, .1), rawChord([60, 64]), rawChord([40, 41, 42]),
    rawChord([60, 64, 67]).map((n, i) => ({ ...n, e: n.t + .001 })),
    rawChord([60, 64, 67]).map((n, i) => ({ ...n, a: i === 2 ? 1 : .2 }))]) {
    assert.equal(toScore(raw).notes[0].n.length, 1);
  }
  assert.equal(toScore(rawChord([60, 64, 67]).map((n, i) => ({ ...n, t: i * .2, e: i * .2 + .15 }))).notes.length, 3);
});

test('12 ms per string strums stay whole at their first onset, in both directions', () => {
  const chords = [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65]];
  for (const reverse of [false, true]) for (const lib of [null, library]) {
    const raw = chords.flatMap((ps, c) => [0, 1].flatMap(beat => (reverse ? [...ps].reverse() : ps)
      .map((p, s) => ({ p, t: .5 + 2 * c + beat + .012 * s, e: 2.5 + 2 * c, a: 1 }))));
    const score = toScore(raw, 0, .75, lib);
    assert.deepEqual(score.notes.map(n => n.t), [.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
    score.notes.forEach((n, i) => assert.deepEqual(n.n.map(([s, f]) => openMidi[s] + f).sort((a, b) => a - b), chords[i >> 1]));
  }
  for (const ps of [[48, 52, 55, 60, 64], [48, 55, 52, 64, 60]]) {
    const raw = ps.map((p, i) => ({ p, t: i * .022, e: .5, a: 1 }));
    assert.equal(toScore(raw).notes.length, 1); // nonmonotonic 88 ms
  }
  const sweep = [43, 47, 50, 55, 59, 67].map((p, i) => ({ p, t: i * .020, e: .5, a: 1 }));
  assert.equal(toScore(sweep).notes.length, 1); // monotonic 100 ms
  assert.ok(toScore(sweep.map(n => ({ ...n, t: n.t * 2 }))).notes.length > 1);
  assert.ok(toScore(sweep.map(n => ({ ...n, e: n.t + .005 }))).notes.length > 1);
});

test('chord assignments preserve pitches on distinct strings within a four-fret span', () => {
  for (const ps of [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65], [60, 64, 67]]) {
    for (const lib of [null, library]) {
      const ns = assignChord(ps, lib); assert.ok(ns);
      assert.equal(new Set(ns.map(([s]) => s)).size, ns.length);
      assert.ok(ns.every(([s, f]) => s >= 0 && s <= 5 && Number.isInteger(f) && f >= 0 && f <= 22));
      const frets = ns.map(([, f]) => f).filter(f => f > 0);
      assert.ok(Math.max(...frets) - Math.min(...frets) <= 4);
      assert.deepEqual(ns.map(([s, f]) => openMidi[s] + f).sort((a, b) => a - b), [...ps].sort((a, b) => a - b));
    }
  }
  assert.equal(assignChord([40, 41, 42]), null);
});

test('stopping mic or tab capture transcribes, saves audio, and opens the lesson', async () => {
  for (const input of ['mic', 'cap']) {
    const h = createHarness();
    if (input === 'cap') { h.get('url').value = 'abcdefghijk'; await h.get('loadVid').onclick(); }
    await h.get(input).onclick();
    assert.equal(h.calls, 0);
    assert.equal(h.get('go').disabled, true);
    await h.stop(input === 'cap');
    assert.equal(h.calls, 1);
    const song = [...h.songs.values()][0];
    assert.equal(await h.blobs.get(song.id).text(), 'test recording');
    assert.equal(h.navigation[0], 'index.html#' + song.id);
    assert.equal(shiftScore(song.score, -song.audioOffset).notes[0].t, .2);
    assert.equal(h.get('go').disabled, false);
    const row = h.get('mine').children.at(-1);
    await row.children.at(-1).onclick();
    assert.equal(h.songs.size, 0); assert.equal(h.blobs.size, 0);
  }
});

test('uploads wait for the button; opt-out and failed saves never navigate', async () => {
  for (const saved of [true, false]) {
    const h = createHarness({ saved }); h.get('autoOpen').checked = !saved;
    h.get('file').onchange({ target: { files: [new File(['upload'], 'fixture.wav')] } });
    assert.equal(h.calls, 0);
    await h.get('go').onclick();
    assert.equal(h.calls, 1); assert.equal(h.navigation.length, 0);
    assert.equal(h.get('open3d').hidden, !saved);
    await h.get('go').onclick();
    assert.equal(h.calls, 2);
  }
});

test('unavailable IndexedDB is harmless and timeline shifting preserves the source', async () => {
  assert.equal(await saveSongAudio('test', new Blob(['a'])), false);
  assert.equal(await loadSongAudio('test'), null);
  assert.equal(await deleteSongAudio('test'), false);
  const score = { grid: [12, 12.5], notes: [{ t: 12.5, n: [[0, 0]] }], chords: [{ t0: 12, t1: 13, name: 'C', conf: .9 }] };
  const copy = structuredClone(score), shifted = shiftScore(score, -12);
  assert.equal(shifted.notes[0].t, .5); assert.equal(shifted.chords[0].t0, 0);
  assert.deepEqual(shiftScore(shifted, 12), score); assert.deepEqual(score, copy);
});

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
