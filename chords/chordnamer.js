// Chord naming from pitch classes / fretted notes. ES module, port of the logic behind chords.py name lookup.
//   import { nameChord, nameFromFrets, loadTypes } from '../../chords/chordnamer.js';
// Self-contained: the type table below mirrors chord_library.json "types" (regenerate via chords.py if you add types).
// nameChord(midiOrPcs[]) -> [{ name, root, type, bass, exact, score }] best first (slash name when the bass is not the root).
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];        // low E -> high e (chords/ order; theory.js uses high e = string 0)
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// suffix: [intervals, omittable intervals]; order = preference when several names fit
export const TYPES = {
  '': [[0, 4, 7], []], m: [[0, 3, 7], []], '5': [[0, 7], []], '6': [[0, 4, 7, 9], [7]], m6: [[0, 3, 7, 9], [7]],
  '7': [[0, 4, 7, 10], [7]], maj7: [[0, 4, 7, 11], [7]], m7: [[0, 3, 7, 10], [7]], m7b5: [[0, 3, 6, 10], []],
  dim: [[0, 3, 6], []], dim7: [[0, 3, 6, 9], []], aug: [[0, 4, 8], []], sus2: [[0, 2, 7], []], sus4: [[0, 5, 7], []],
  '7sus4': [[0, 5, 7, 10], [7]], add9: [[0, 2, 4, 7], [7]], '9': [[0, 2, 4, 7, 10], [7]], m9: [[0, 2, 3, 7, 10], [7]],
  maj9: [[0, 2, 4, 7, 11], [7]], '11': [[0, 2, 4, 5, 7, 10], [7, 2, 4]], m11: [[0, 2, 3, 5, 7, 10], [7, 2]],
  '13': [[0, 2, 4, 7, 9, 10], [7, 2]], '6/9': [[0, 2, 4, 7, 9], [7]], '7b9': [[0, 1, 4, 7, 10], [7]], '7#9': [[0, 3, 4, 7, 10], [7]],
};
const mod = n => ((n % 12) + 12) % 12;

/** @param {number[]} notes MIDI numbers (bass = lowest) or pitch classes (bass = first) */
export function nameChord(notes, { maxResults = 5 } = {}) {
  if (!notes || !notes.length) return [];
  const bass = mod(notes.length > 1 && Math.min(...notes) > 11 ? Math.min(...notes) : notes[0]);
  const have = new Set(notes.map(mod));
  const res = [];
  for (let r = 0; r < 12; r++) {
    if (!have.has(r)) continue;
    for (const [suf, [iv, omit]] of Object.entries(TYPES)) {
      const full = new Set(iv.map(i => mod(r + i)));
      const req = new Set(iv.filter(i => i === 0 || !omit.includes(i)).map(i => mod(r + i)));
      if (![...req].every(p => have.has(p)) || ![...have].every(p => full.has(p))) continue;
      const missing = full.size - [...full].filter(p => have.has(p)).length;
      if (suf === '5' && have.size !== 2) continue;
      const slash = bass !== r;
      const score = (slash ? 1.5 : 0) + missing * 0.8 + iv.length * 0.05 + (r === bass ? 0 : 0.2);
      res.push({ name: ROOTS[r] + suf + (slash ? '/' + ROOTS[bass] : ''), root: ROOTS[r], type: suf, bass: ROOTS[bass], exact: missing === 0, score });
    }
  }
  return res.sort((a, b) => a.score - b.score).slice(0, maxResults);
}

/** @param {(number|'x'|null)[]} frets low E -> high e */
export function nameFromFrets(frets) {
  const midi = [];
  frets.forEach((f, s) => { if (f !== 'x' && f != null && f >= 0) midi.push(OPEN_MIDI[s] + f); });
  return nameChord(midi);
}

/** Chord-library lookup (pass the parsed chord_shapes.json or chord_library.json): shapes for a symbol. */
export const shapesFor = (lib, symbol) => (lib.chords[symbol] && lib.chords[symbol].shapes) || [];
