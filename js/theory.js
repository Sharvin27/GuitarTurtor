// Note names and simple chord recognition for the lesson overlays.
// Standard tuning, string 0 = high e: E4 B3 G3 D3 A2 E2 (MIDI 64 59 55 50 45 40).
export const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
export const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiOf = (s, f) => OPEN_MIDI[s] + f;
export const pcName = m => PC[((m % 12) + 12) % 12];
export const noteName = (m, octave = true) => pcName(m) + (octave ? String(Math.floor(m / 12) - 1) : '');

// interval sets relative to the root -> chord suffix (exact match on the pitch-class set)
const CHORDS = [
  [[0, 4, 7], ''], [[0, 3, 7], 'm'], [[0, 3, 6], 'dim'], [[0, 4, 8], 'aug'],
  [[0, 2, 7], 'sus2'], [[0, 5, 7], 'sus4'],
  [[0, 4, 7, 10], '7'], [[0, 4, 7, 11], 'maj7'], [[0, 3, 7, 10], 'm7'], [[0, 3, 6, 10], 'm7♭5'],
  [[0, 4, 10], '7'], [[0, 3, 10], 'm7'], [[0, 4, 11], 'maj7'],
  [[0, 4, 7, 9], '6'], [[0, 3, 7, 9], 'm6'], [[0, 2, 4, 7], 'add9'],
];
const DYADS = { 1: 'minor 2nd', 2: 'major 2nd', 3: 'minor 3rd', 4: 'major 3rd', 5: '4th', 6: 'tritone', 8: 'minor 6th', 9: 'major 6th', 10: 'minor 7th', 11: 'major 7th' };

/**
 * What a group of simultaneous notes forms.
 * @param {{s:number,f:number}[]} notes
 * @returns {{name:string, kind:'note'|'octave'|'power'|'chord'|'interval'}|null}
 */
export function describeNotes(notes) {
  if (!notes || !notes.length) return null;
  const mids = notes.map(n => midiOf(n.s, n.f)).sort((a, b) => a - b);
  const bass = mids[0];
  const pcs = [...new Set(mids.map(m => m % 12))];
  if (mids.length === 1) return { name: noteName(bass), kind: 'note' };
  if (pcs.length === 1) return { name: `${pcName(bass)} octave`, kind: 'octave' };
  if (pcs.length === 2) {
    const iv = ((pcs.find(p => p !== bass % 12) - bass) % 12 + 12) % 12;
    if (iv === 7) return { name: `${pcName(bass)}5`, kind: 'power' };
    if (iv === 5) return { name: `${pcName(bass + 5)}5/${pcName(bass)}`, kind: 'power' };
  }
  // try every pitch class as the root; prefer the bass note as root
  const roots = [bass % 12, ...pcs.filter(p => p !== bass % 12)];
  for (const r of roots) {
    const set = pcs.map(p => ((p - r) % 12 + 12) % 12).sort((a, b) => a - b).join(',');
    const hit = CHORDS.find(([iv]) => iv.join(',') === set);
    if (hit) return { name: PC[r] + hit[1] + (r !== bass % 12 ? '/' + pcName(bass) : ''), kind: 'chord' };
  }
  if (pcs.length === 2) {
    const iv = ((pcs.find(p => p !== bass % 12) - bass) % 12 + 12) % 12;
    return { name: `${pcName(bass)} + ${pcName(bass + iv)} (${DYADS[iv] || 'interval'})`, kind: 'interval' };
  }
  return { name: mids.map(m => pcName(m)).join(' '), kind: 'interval' };
}
