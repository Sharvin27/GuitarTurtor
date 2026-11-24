// A song played as chords + strumming, "as in the video" (no DOM; main.js shows it, tools can test it).
//   const r = buildSongChords({ chords, strum, grid, bpm, mode }, chordShapes, strumPatterns, { patternId });
//   r = { cs /* js/chordsong.js chord song, recording clock */, meta: {patternId, pattern, tempo, detected, synthetic, ...} }
// Input: score.chords / score.strum (browser-made songs) or data/chords-<id>.json (site songs), docs/CHORD-DATA.md.
//  - With a detected strum: bars follow the strum's own grid. The recording's tempo drifts, so a time warp maps the
//    nominal (constant-tempo) pattern clock onto the recording: one knot per bar, taken from the detected strokes. Chords
//    are mapped onto the nominal clock, strumProgression() picks the chord of each bar, buildChordSong() builds the song
//    from the first chord bar (= shifting a LEAD_IN-based song by sp.startT - LEAD_IN) and warps it back; every stroke
//    then sits at its detected time (score.strum.strokes[].t) with the detected direction.
//  - Without one: the score's beat grid (score.grid) gives the knots, the meter (4/4, 3/4 or 6/8) comes from where the chord
//    changes fall, and the pattern is suggested by tempo and style (chordsong.suggestPattern: fingerstyle songs get a
//    fingerpicking pattern, slow songs a ballad pattern).
import { strumProgression, beatPos } from './strumdetect.js';
import { buildChordSong, suggestPattern } from './chordsong.js';
import { playedChordName } from './chord-agreement.js';

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const mod = (a, n) => ((a % n) + n) % n;

/** chordal = a strum was detected, or at least a quarter of the played events are chords (js/chord-agreement.js) */
export function isChordal({ strum = null, events = [] } = {}) {
  if (strum && strum.pattern) return true;
  const ev = events.filter(e => (e.notes || e.n || []).length);
  if (ev.length < 8) return false;
  return ev.filter(e => playedChordName(e)).length / ev.length >= 0.25;
}

/**
 * Meter from the chord changes on a beat grid: share of change weight (incoming chord length, max 4 s) that lands on a
 * bar line, per beats-per-bar and phase. 4/4 unless 3/4 fits clearly better; 2 (6/8: two dotted-quarter beats) when
 * the changes fall every second slow beat but not on 4/4 bar lines.
 */
export function chooseMeter(chords, beats, tempo = 90) {
  const ch = [];
  for (let i = 1; i < chords.length; i++) if (chords[i].name !== chords[i - 1].name) ch.push({ b: beatPos(beats, chords[i].t0), w: Math.min(4, chords[i].t1 - chords[i].t0) });
  const fit = bpb => {
    let best = { f: 0, phase: 0 };
    const W = ch.reduce((a, c) => a + c.w, 0) || 1;
    for (let ph = 0; ph < bpb; ph++) {
      const f = ch.reduce((a, c) => a + (Math.abs(c.b - Math.round(c.b)) < 0.3 && mod(Math.round(c.b) - ph, bpb) === 0 ? c.w : 0), 0) / W;
      if (f > best.f + 1e-9) best = { f, phase: ph };
    }
    return best;
  };
  const f4 = fit(4), f3 = fit(3), f2 = fit(2);
  if (f3.f > f4.f + 0.15 && f3.f >= 0.5) return { bpb: 3, ...f3, fits: { f4: f4.f, f3: f3.f, f2: f2.f } };
  if (tempo < 90 && f2.f >= 0.6 && f4.f < 0.55) return { bpb: 2, ...f2, fits: { f4: f4.f, f3: f3.f, f2: f2.f } };
  return { bpb: 4, ...f4, fits: { f4: f4.f, f3: f3.f, f2: f2.f } };
}

/** monotone knots {pos (beats), t (s)} whose local tempo stays within 25 % of the nominal beat */
function cleanKnots(knots, beat) {
  const s = knots.filter(k => Number.isFinite(k.pos) && Number.isFinite(k.t)).sort((a, b) => a.pos - b.pos), out = [];
  for (const k of s) {
    const p = out[out.length - 1];
    if (p && (k.pos <= p.pos || k.t <= p.t)) continue;
    if (p) { const r = (k.t - p.t) / (k.pos - p.pos) / beat; if (r < 0.75 || r > 1.33) continue; }
    out.push(k);
  }
  return out;
}
function interp(K, x, kx, ky, slope) {
  if (x <= K[0][kx]) return K[0][ky] + (x - K[0][kx]) * slope;
  const L = K[K.length - 1]; if (x >= L[kx]) return L[ky] + (x - L[kx]) * slope;
  let lo = 0, hi = K.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m][kx] <= x) lo = m; else hi = m; }
  return K[lo][ky] + (x - K[lo][kx]) * (K[hi][ky] - K[lo][ky]) / (K[hi][kx] - K[lo][kx]);
}
/** one knot per bar from detected strokes: bar start = median(stroke time - its offset in the bar) */
function strokeKnots(S, beat) {
  const bpb = S.beats_per_bar || 4, sb = S.step_beats || 0.5, bars = new Map();
  for (const k of S.strokes || []) {
    if (!Number.isFinite(k.bar) || !Number.isFinite(k.step)) continue;
    if (!bars.has(k.bar)) bars.set(k.bar, []);
    bars.get(k.bar).push(k.t - k.step * sb * beat);
  }
  return [...bars].map(([b, ts]) => ({ pos: b * bpb, t: median(ts) }));
}

/**
 * @param {{chords:object[], strum?:object, grid?:number[], bpm?:number, mode?:string}} src  (recording clock)
 * @param {object} lib chords/chord_shapes.json   @param {object} pats chords/strum_patterns.json
 * @param {{patternId?:string}} opts  a library pattern instead of the detected / suggested one
 * @returns {{cs:object, meta:object}|null}
 */
export function buildSongChords(src, lib, pats, { patternId = null } = {}) {
  const chords = (src.chords || []).filter(c => c && c.name && c.name !== 'N' && c.t1 > c.t0).slice().sort((a, b) => a.t0 - b.t0);
  if (!chords.length || !lib || !pats) return null;
  const byId = id => [...pats.strum, ...pats.pick].find(p => p.id === id) || null;
  const S = src.strum && src.strum.pattern && Number.isFinite(src.strum.tempo) ? src.strum : null;
  let pattern, tempo, tBar0, knots, meta;
  if (S) {
    tempo = S.tempo; pattern = S.pattern; tBar0 = S.t_bar0 ?? chords[0].t0;
    knots = strokeKnots(S, 60 / tempo);
    meta = { detected: true, synthetic: false, confidence: S.confidence ?? null, detectedGrid: S.grid || null, patternId: pattern.id };
  } else {
    let beats = Array.isArray(src.grid) && src.grid.length >= 8 ? src.grid.filter(Number.isFinite) : null;
    if (!beats) {
      const b = 60 / (src.bpm || 90), end = Math.max(...chords.map(c => c.t1));
      beats = []; for (let t = chords[0].t0 - 4 * b; t < end + 4 * b; t += b) beats.push(+t.toFixed(3));
    }
    tempo = 60 / median(beats.slice(1).map((t, i) => t - beats[i]));
    const m = chooseMeter(chords, beats, tempo);
    pattern = suggestPattern(pats, { bpm: tempo, beatsPerBar: m.bpb, style: src.mode === 'fingers' ? 'pick' : 'strum' });
    // bar line at or just before the first chord
    const bFirst = Math.round(beatPos(beats, chords[0].t0)), i0 = bFirst - mod(bFirst - m.phase, m.bpb);
    knots = beats.map((t, i) => ({ pos: i - i0, t }));
    tBar0 = interp(cleanKnots(knots, 60 / tempo), 0, 'pos', 't', 60 / tempo);
    meta = { detected: false, synthetic: true, meter: m.bpb === 2 ? '6/8' : m.bpb === 3 ? '3/4' : '4/4', meterFit: m.fits, patternId: pattern.id };
  }
  if (patternId && patternId !== meta.patternId && byId(patternId)) {
    pattern = byId(patternId);
    meta = { ...meta, detected: false, synthetic: false, chosen: true, patternId };
  }
  const beat = 60 / tempo, K = cleanKnots(knots, beat), NOM0 = tBar0;
  const warp = K.length >= 2 ? (tau => interp(K, (tau - NOM0) / beat, 'pos', 't', beat)) : (tau => tau);
  const unwarp = K.length >= 2 ? (t => NOM0 + interp(K, t, 't', 'pos', 1 / beat) * beat) : (t => t);
  const chordsN = chords.map(c => ({ ...c, t0: unwarp(c.t0), t1: unwarp(c.t1) }));
  const sp = strumProgression(chordsN, { pattern, tempo, beats_per_bar: pattern.beats_per_bar, t_bar0: NOM0 }, lib);
  if (!sp) return null;
  const useStrokes = !!(S && pattern === S.pattern && S.strokes && S.strokes.length);
  const cs = buildChordSong(sp.prog, sp.pattern, sp.bpm, {
    patterns: pats, startT: sp.startT, warp, unwarp, strokes: useStrokes ? S.strokes : null,
    strumHand: src.mode === 'pick' ? 'pick' : 'fingers', humanize: 0.1,
  });
  return { cs, meta: { ...meta, pattern, tempo, knots: K.length, exactStrokes: useStrokes } };
}
