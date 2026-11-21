// Strum / pick timeline generator. ES module, no dependencies (pattern data is passed in).
//   import { strumTimeline, pickTimeline, progressionTimeline } from './strum_model.js';
//   const strokes = strumTimeline(shape, pattern, 90, { bars: 2, patterns });   // pattern = object from strum_patterns.json
// shape: fret per string, low E -> high e, e.g. ['x',3,2,0,1,0]  (x / -1 / null = muted).
// Stroke: { t (s), dir 'D'|'U'|'P'(pluck), strings:[0=low E..5] in play order, offsets:[s per string], frets:[..],
//           velocity 0..1, muted:false|'palm'|'dead', dur (s, hand travel time), step, bar }
// Per-string offsets: ~5-12 ms between adjacent strings (tighter at high tempo / light touch). D goes low->high, U high->low.
// Performer drives the pick from stroke.t and dur; the synth plays string strings[k] at t + offsets[k].
// opts: bars, startT, humanize (0..1, default .15), seed, palmMute, patterns (whole JSON, for its stroke_strings sets).

const fretOf = (shape, s) => { const f = shape[s]; return (f === 'x' || f === -1 || f == null) ? null : f; };
const DEFAULT_SETS = {
  default: { D: [0, 1, 2, 3, 4, 5], U: [2, 3, 4, 5] },
  top3: { D: [3, 4, 5], U: [3, 4, 5] },
  bass_then_top: { D: [0], d: [1, 2, 3, 4, 5], U: [2, 3, 4, 5] },
  bassmix: { D: [0, 3, 4, 5], U: [3, 4, 5] },
};

export function parseToken(tok) {
  const m = /^([DUdux-])(>?)(p?)$/.exec(tok);
  if (!m) throw new Error('bad strum token: ' + tok);
  const [, c, acc, pm] = m;
  if (c === '-') return { rest: true };
  const dead = c === 'x';
  return { rest: false, dir: dead ? 'D' : c.toUpperCase(), light: c === 'd' || c === 'u', accent: !!acc, palm: !!pm, dead, letter: c };
}

// tiny deterministic RNG so tests and replays are repeatable
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export function strumTimeline(shape, pattern, bpm, opts = {}) {
  const { bars = 1, startT = 0, humanize = 0.15, seed = 1, palmMute = false, patterns } = opts;
  const rand = rng(seed), beat = 60 / bpm;
  const stepDur = pattern.step_beats * beat;
  const sets = (patterns && patterns.stroke_strings) || DEFAULT_SETS;
  const set = sets[pattern.stroke_strings || 'default'] || sets.default;
  const toks = pattern.grid.split(/\s+/);
  const sounding = [0, 1, 2, 3, 4, 5].filter(s => fretOf(shape, s) !== null);
  const out = [];
  for (let b = 0; b < bars; b++) {
    toks.forEach((raw, i) => {
      const tk = parseToken(raw);
      if (tk.rest) return;
      let t = startT + (b * toks.length + i) * stepDur;
      if (pattern.swing != null && pattern.subdivision === '8th' && i % 2 === 1) t += pattern.swing * stepDur;
      const wanted = tk.dead ? sounding : (set[tk.letter] || set[tk.dir] || DEFAULT_SETS.default[tk.dir]);
      let strings = wanted.filter(s => sounding.includes(s));
      if (!strings.length) strings = sounding.slice(-2);          // e.g. an upstroke on a shape with only low strings
      let vel = tk.dead ? 0.3 : tk.light ? 0.45 : tk.dir === 'U' ? 0.6 : 0.8;
      if (tk.accent) vel = Math.min(1, vel + 0.2);
      vel = Math.min(1, Math.max(0.05, vel * (1 + humanize * (rand() - 0.5) * 0.4)));
      // inter-string gap: 5-12 ms down, 4-9 ms up; tighter at fast tempo and light touch
      const speed = Math.min(1, bpm / 160);
      const base = tk.dir === 'D' ? 0.012 - 0.005 * speed : 0.009 - 0.004 * speed;
      const gap = base * (1.15 - 0.3 * vel);
      const order = strings.slice().sort((a, c) => (tk.dir === 'D' ? a - c : c - a));
      const offsets = order.map((_, k) => k * gap * (1 + humanize * (rand() - 0.5) * 0.2));
      const dur = Math.max(0.05, Math.min(0.16, stepDur * 0.8));
      t += humanize * (rand() - 0.5) * 0.012;                      // up to ~1 ms timing jitter at default humanize
      out.push({ t, dir: tk.dir, strings: order, offsets, frets: order.map(s => fretOf(shape, s)), velocity: vel,
                 muted: tk.dead ? 'dead' : (tk.palm || palmMute || pattern.pm) ? 'palm' : false, dur, step: i, bar: b });
    });
  }
  return out;
}

// Fingerpicking: roles p = lowest sounding bass string, p2 = next bass string, i = G(3), m = B(4), a = e(5); 'a+b' plucks together.
export function pickTimeline(shape, pattern, bpm, opts = {}) {
  const { bars = 1, startT = 0, humanize = 0.1, seed = 1 } = opts;
  const rand = rng(seed), stepDur = pattern.step_beats * 60 / bpm;
  const snd = [0, 1, 2, 3, 4, 5].filter(s => fretOf(shape, s) !== null);
  const bass = snd.filter(s => s <= 3);
  const role = { p: bass[0] ?? snd[0], p2: bass[1] ?? bass[0] ?? snd[0], i: 3, m: 4, a: 5 };
  const out = [];
  for (let b = 0; b < bars; b++) pattern.steps.forEach((st, i) => {
    const strings = st.split('+').map(r => role[r]).filter(s => fretOf(shape, s) !== null);
    if (!strings.length) return;
    out.push({ t: startT + (b * pattern.steps.length + i) * stepDur + humanize * (rand() - 0.5) * 0.01, dir: 'P', strings,
               offsets: strings.map((_, k) => k * 0.004), frets: strings.map(s => fretOf(shape, s)),
               velocity: strings[0] <= 2 ? 0.7 : 0.55, muted: false, dur: 0.06, step: i, bar: b });
  });
  return out;
}

// prog = [{ shape, bars }]; one concatenated timeline, each stroke tagged with `chord` (index into prog).
export function progressionTimeline(prog, pattern, bpm, opts = {}) {
  const barDur = pattern.beats_per_bar * 60 / bpm;
  let t = opts.startT || 0; const out = [];
  prog.forEach((c, k) => {
    const f = pattern.type === 'pick' ? pickTimeline : strumTimeline;
    f(c.shape, pattern, bpm, { ...opts, bars: c.bars || 1, startT: t, seed: (opts.seed || 1) + k })
      .forEach(s => out.push({ ...s, chord: k }));
    t += (c.bars || 1) * barDur;
  });
  return out;
}
