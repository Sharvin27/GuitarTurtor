import { nameChord } from '../chords/chordnamer.js';

const OPEN = [64, 59, 55, 50, 45, 40];
const TYPES = new Set(['', 'm', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '7sus4']);

// Accept saved score notes or prepared playback events. Never invent missing tones.
export function playedChordName(event) {
  const midi = event.n ? event.n.map(([s, f]) => OPEN[s] + f) :
    (event.notes || []).map(({ s, f }) => OPEN[s] + f);
  if (!midi.every(Number.isFinite) || new Set(midi.map(p => p % 12)).size < 3) return null;
  const best = nameChord(midi)[0];
  return best && TYPES.has(best.type) ? best.name : null;
}

// A named event wins from its onset until the next score event, across audio-window
// boundaries. A melody/dyad ends that override. Keep gaps and the original confidence
// (which still measures audio evidence); source records that the name came from notes.
export function reconcileChords(segments, events = []) {
  const changes = events.filter(e => Number.isFinite(e.t)).slice().sort((a, b) => a.t - b.t)
    .map(e => ({ t: e.t, name: playedChordName(e) }));
  const out = [];
  let i = 0, name = null;
  for (const segment of segments) {
    let t = segment.t0;
    while (i < changes.length && changes[i].t <= t) name = changes[i++].name;
    while (t < segment.t1) {
      const end = Math.min(segment.t1, changes[i]?.t ?? Infinity);
      const part = { ...segment, t0: t, t1: end, ...(name ? { name, source: 'notes' } : {}) };
      const last = out.at(-1);
      // same chord from the same source continues across audio windows: one segment, weakest evidence kept
      if (last && last.t1 === t && last.name === part.name && last.source === part.source) { last.t1 = end; last.conf = Math.min(last.conf, part.conf); }
      else out.push(part);
      t = end;
      while (i < changes.length && changes[i].t <= t) name = changes[i++].name;
    }
  }
  return out;
}
