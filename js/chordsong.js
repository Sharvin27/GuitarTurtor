// Chord "song" builder (no DOM, so tools/strumcheck.mjs can use it): a progression + strum pattern + tempo
// becomes (1) timeline events in the format timeline.js / performer.js already understand (one event per chord:
// notes with finger numbers; the fretting hand holds the shape), (2) the stroke list for the strumming hand and
// the synth, and (3) the strum path used by the performer.
//
// String order: chords/ data is LOW-E-FIRST; the events produced here use the 3D code's order (string 0 = high e).
import { progressionTimeline } from '../chords/strum_model.js';
import { prepareTimeline } from './timeline.js';
import { buildStrumPath } from './strumhand.js';

export const LEAD_IN = 0.2;      // s of silence before the first stroke
export const FRET_LEAD = 0.15;   // the fretting hand starts changing shape this long before the chord change
const isMuted = f => f === 'x' || f === -1 || f == null;
const ENH = { 'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', Gb: 'F#' };

/** 'C#m7' -> 'Dbm7' (the chord library spells roots C Db D Eb E F F# G Ab A Bb B) */
export function canonicalSymbol(sym) {
  const m = /^([A-G][#b]?)(.*)$/.exec(String(sym).trim());
  return m ? (ENH[m[1]] || m[1]) + m[2] : String(sym).trim();
}
export const shapesOf = (lib, sym) => (lib.chords[canonicalSymbol(sym)] || { shapes: [] }).shapes;

/**
 * Fingering for a library shape (frets low->high). Uses the library's finger numbers when they are a clean
 * one-finger-per-note assignment, otherwise fingers go to the fretted notes in fret order (index first).
 * A barre (>= 3 strings at the same fret inside shape.barre) is the index finger lying across them; the
 * fingertip target is its treble-most string, the other strings are pressed by the same finger.
 * @returns {{notes:{s:number,f:number,finger:number}[], barre:null|{fret:number,strings:number[],tip:number}, muted:number[]}}
 */
export function shapeNotes(shape) {
  const fr = shape.frets;
  const fretted = [];
  fr.forEach((f, sl) => { if (!isMuted(f) && f > 0) fretted.push({ sl, f, finger: 0 }); });
  let barreSet = [];
  if (shape.barre) barreSet = fretted.filter(n => n.f === shape.barre.fret && n.sl >= shape.barre.from && n.sl <= shape.barre.to);
  const isBarre = barreSet.length >= 3;
  const rest = fretted.filter(n => !(isBarre && barreSet.includes(n)));
  if (isBarre) barreSet.forEach(n => { n.finger = 1; });
  const given = rest.map(n => (shape.fingers || [])[n.sl]);
  const clean = rest.length && given.every(g => g >= 1 && g <= 4) && new Set(given).size === given.length && !(isBarre && given.includes(1));
  if (clean) rest.forEach((n, i) => { n.finger = given[i]; });
  else {
    let fin = isBarre ? 2 : 1;
    [...rest].sort((a, b) => a.f - b.f || a.sl - b.sl).forEach(n => { n.finger = Math.min(4, fin++); });
  }
  const notes = [];
  const muted = [];
  fr.forEach((f, sl) => {
    const s = 5 - sl;
    if (isMuted(f)) { muted.push(s); return; }
    const n = fretted.find(x => x.sl === sl);
    notes.push({ s, f, finger: n ? n.finger : 0 });
  });
  notes.sort((a, b) => a.s - b.s);
  let barre = null;
  if (isBarre) {
    const strings = barreSet.map(n => 5 - n.sl).sort((a, b) => a - b);
    barre = { fret: shape.barre.fret, strings, tip: strings[0] };
  }
  return { notes, barre, muted };
}

const median = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };

/**
 * @param {{symbol:string, shape:object, bars?:number}[]} prog
 * @param {object} pattern entry of strum_patterns.json
 * @param {number} bpm
 * @param {{patterns?:object, palmMute?:boolean, strumHand?:'pick'|'fingers', humanize?:number, seed?:number}} opts
 */
export function buildChordSong(prog, pattern, bpm, opts = {}) {
  const { strumHand = 'pick' } = opts;
  const barDur = pattern.beats_per_bar * 60 / bpm;
  const strokes = progressionTimeline(prog.map(c => ({ shape: c.shape.frets, bars: c.bars || 1 })), pattern, bpm,
    { startT: LEAD_IN, patterns: opts.patterns, palmMute: !!opts.palmMute, humanize: opts.humanize ?? 0.15, seed: opts.seed ?? 1 });
  const chords = [];
  let t = LEAD_IN;
  const events = prog.map((c, k) => {
    const { notes, barre, muted } = shapeNotes(c.shape);
    const dur = (c.bars || 1) * barDur;
    const fingered = notes.filter(n => n.finger);
    let pos = fingered.length ? Math.max(1, median(fingered.map(n => n.f - n.finger + 1))) : (k ? chords[k - 1].pos : 1);
    if (barre) pos = barre.fret;
    const ev = {
      t, dur: Math.max(0.2, dur - 0.2), q: (t - LEAD_IN) * bpm / 60, sec: '', notes, pos,
      slide: false, bend: 0, hb: 0, rel: false, vib: false, ham: false, pull: false, pm: false, gap: dur,
      chord: k, symbol: c.symbol, barre,
    };
    chords.push({ symbol: c.symbol, shape: c.shape, t0: t, t1: t + dur, bars: c.bars || 1, pos, barre, muted, notes });
    t += dur;
    return ev;
  });
  events.bpm = bpm;
  prepareTimeline(events, 'pick');
  events.forEach(ev => {
    ev.lead = FRET_LEAD;
    ev.leadH = Math.min(0.2, 0.8 * ev.gap);
    if (ev.barre) {                         // the index tip sits on the barre's treble-most string
      ev.byFinger[0] = ev.notes.find(n => n.s === ev.barre.tip && n.finger === 1);
      ev.notes.forEach(n => { if (n.finger === 1 && n !== ev.byFinger[0]) n.barred = true; });
    }
  });
  events.mode = strumHand === 'fingers' ? 'fingers' : 'pick';
  const path = buildStrumPath(strokes);
  events.strum = path;
  events.strokes = strokes;
  return { events, strokes, path, chords, pattern, bpm, barDur, startT: LEAD_IN, total: t, stepDur: pattern.step_beats * 60 / bpm };
}
