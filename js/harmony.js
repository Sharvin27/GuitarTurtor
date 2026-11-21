// Implied harmony: the chord a melody outlines, half a bar at a time, so a learner can see (and strum) the
// chords under single-note lines. The songs here are melodies (no simultaneous chords), so the chord is
// read from which pitch classes ring during each window, weighted by how long they sound.
//
//   const segs = analyzeHarmony(events);   // events from prepareTimeline (need t, dur, q, notes)
//   -> [{ t0, t1, name, root, type, conf }]  name uses chords/chord_shapes.json spelling (C, Db, D, Eb, ... B)
//
// Method: (1) key from the whole song's pitch-class durations (Krumhansl-Schmuckler profiles); (2) per window,
// score every chord in a small vocabulary: weight on chord tones minus weight on other tones, plus a bonus when
// the bass (lowest sounding) note is the root and when the chord belongs to the key; (3) Viterbi over windows
// with a cost for changing chord, so the chord doesn't flicker on passing notes. Windows that are too unclear
// get no chord rather than a guess.
import { midiOf } from './theory.js';

export const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];   // chord_shapes.json keys
const TYPES = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6] };
// extended chords must earn their extra note: learners want plain triads unless the 7th/sus note really rings
const COMPLEX = { '': 0, m: 0, '7': 0.14, maj7: 0.2, m7: 0.14, sus2: 0.22, sus4: 0.22, dim: 0.25 };
// Krumhansl-Kessler key profiles
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// diatonic chords by scale degree: [semitones above the tonic, allowed types]
const DIA = {
  major: [[0, ['', 'maj7', 'sus2', 'sus4']], [2, ['m', 'm7']], [4, ['m', 'm7']], [5, ['', 'maj7']], [7, ['', '7', 'sus4']], [9, ['m', 'm7']], [11, ['dim']]],
  minor: [[0, ['m', 'm7']], [3, ['', 'maj7']], [5, ['m', 'm7']], [7, ['m', '', '7']], [8, ['', 'maj7']], [10, ['', '7']], [2, ['dim']]],
};
const mod = n => ((n % 12) + 12) % 12;
const corr = (a, b) => { const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db || 1); };

export function detectKey(events) {
  const h = new Array(12).fill(0);
  for (const e of events) for (const n of e.notes) h[mod(midiOf(n.s, n.f))] += Math.max(0.05, e.dur || 0.2);
  let best = { tonic: 0, mode: 'major', r: -2 };
  for (let k = 0; k < 12; k++) for (const [mode, prof] of [['major', MAJ], ['minor', MIN]]) {
    const r = corr(h, prof.map((_, i) => prof[mod(i - k)]));
    if (r > best.r) best = { tonic: k, mode, r };
  }
  best.name = ROOTS[best.tonic] + (best.mode === 'minor' ? 'm' : '');
  return best;
}

export function analyzeHarmony(events, { beatsPerWindow = 2 } = {}) {
  const ev = events.filter(e => e.notes && e.notes.length && Number.isFinite(e.q));
  if (ev.length < 4) return [];
  const key = detectKey(ev);
  const diatonic = new Set();
  for (const [deg, types] of DIA[key.mode]) for (const t of types) diatonic.add(ROOTS[mod(key.tonic + deg)] + t);
  // beat -> time, by interpolating the events' (q, t) pairs
  const qs = ev.map(e => e.q), ts = ev.map(e => e.t);
  const beatLen = ev.length > 1 ? Math.max(0.05, (ts[ts.length - 1] - ts[0]) / Math.max(1e-6, qs[qs.length - 1] - qs[0])) : 0.5;
  const tOf = q => { let i = 0; while (i < qs.length - 2 && qs[i + 1] < q) i++; const dq = qs[i + 1] - qs[i]; return dq > 1e-6 ? ts[i] + (q - qs[i]) * (ts[i + 1] - ts[i]) / dq : ts[i] + (q - qs[i]) * beatLen; };
  const q0 = Math.floor(qs[0] / beatsPerWindow) * beatsPerWindow, qEnd = qs[qs.length - 1] + 1;
  const wins = [];
  for (let a = q0; a < qEnd; a += beatsPerWindow) {
    const b = a + beatsPerWindow, w = new Array(12).fill(0);
    let bass = Infinity;
    for (const e of ev) {
      const durQ = Math.max(0.25, (e.dur || beatLen) / beatLen);
      const ov = Math.min(b, e.q + durQ) - Math.max(a, e.q);
      if (ov <= 0) continue;
      for (const n of e.notes) { const m = midiOf(n.s, n.f); w[mod(m)] += ov; if (e.q < b && e.q + durQ > a) bass = Math.min(bass, m); }
    }
    const tot = w.reduce((x, y) => x + y, 0);
    wins.push({ a, b, w: tot ? w.map(x => x / tot) : null, bass: Number.isFinite(bass) ? mod(bass) : null });
  }
  // candidate chords and emission scores
  const cands = [];
  for (let r = 0; r < 12; r++) for (const [t, iv] of Object.entries(TYPES)) cands.push({ name: ROOTS[r] + t, root: r, type: t, pcs: new Set(iv.map(i => mod(r + i))) });
  const NONE = cands.length;   // "no chord" state
  const emit = win => {
    const out = new Float64Array(cands.length + 1);
    if (!win.w) { out.fill(0); return out; }
    cands.forEach((c, j) => {
      let inS = 0, outS = 0;
      for (let p = 0; p < 12; p++) (c.pcs.has(p) ? (inS += win.w[p]) : (outS += win.w[p]));
      const rootW = win.w[c.root];
      out[j] = inS - 0.5 * outS + 0.25 * rootW + (win.bass === c.root ? 0.12 : 0) + (diatonic.has(c.name) ? 0.15 : -0.05) - COMPLEX[c.type];
    });
    out[NONE] = 0.45;   // a window must beat this to get a chord
    return out;
  };
  const CHANGE = 0.18;
  const E = wins.map(emit), S = cands.length + 1;
  let prev = Float64Array.from(E[0]); const back = [];
  for (let i = 1; i < E.length; i++) {
    let bi = 0; for (let j = 1; j < S; j++) if (prev[j] > prev[bi]) bi = j;
    const cur = new Float64Array(S), bp = new Int32Array(S);
    for (let j = 0; j < S; j++) {
      const stay = prev[j], move = prev[bi] - CHANGE;
      // an empty window (rest) keeps whatever was playing
      if (!wins[i].w) { cur[j] = prev[j]; bp[j] = j; continue; }
      if (stay >= move) { cur[j] = stay + E[i][j]; bp[j] = j; } else { cur[j] = move + E[i][j]; bp[j] = bi; }
    }
    back.push(bp); prev = cur;
  }
  let j = 0; for (let k = 1; k < S; k++) if (prev[k] > prev[j]) j = k;
  const path = [j];
  for (let i = back.length - 1; i >= 0; i--) { j = back[i][j]; path.unshift(j); }
  // merge equal neighbours into segments
  const segs = [];
  path.forEach((s, i) => {
    const c = s === NONE ? null : cands[s];
    const conf = c && wins[i].w ? [...c.pcs].reduce((x, p) => x + wins[i].w[p], 0) : 0;
    const last = segs[segs.length - 1];
    if (last && last.state === s) { last.b = wins[i].b; last.confs.push(conf); }
    else segs.push({ state: s, a: wins[i].a, b: wins[i].b, confs: [conf], c });
  });
  return segs.filter(s => s.c).map(s => ({
    t0: tOf(s.a), t1: tOf(s.b), name: s.c.name, root: ROOTS[s.c.root], type: s.c.type,
    conf: +(s.confs.reduce((x, y) => x + y, 0) / s.confs.length).toFixed(2), key: key.name,
  }));
}
