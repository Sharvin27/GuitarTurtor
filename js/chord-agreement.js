import { nameChord } from '../chords/chordnamer.js';

const OPEN = [64, 59, 55, 50, 45, 40];
const TYPES = new Set(['', 'm', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '7sus4']);
const time = t => +t.toFixed(3);
const MIN_SEGMENT = .05;

// Accept saved score notes or prepared playback events. Never invent missing tones.
export function playedChordName(event) {
  const midi = event.n ? event.n.map(([s, f]) => OPEN[s] + f) :
    (event.notes || []).map(({ s, f }) => OPEN[s] + f);
  if (!midi.every(Number.isFinite) || new Set(midi.map(p => p % 12)).size < 3) return null;
  const best = nameChord(midi)[0];
  return best && TYPES.has(best.type) ? best.name : null;
}

// Merge before dropping short pieces: an audio-window edge must not truncate a
// held chord. Keep the weakest evidence when merging the same name/source.
export function cleanChordSegments(segments = []) {
  const out = [];
  for (const s of segments.filter(s => Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.name)
    .slice().sort((a, b) => a.t0 - b.t0)) {
    const part = { ...s, t0: time(s.t0), t1: time(s.t1) };
    const last = out.at(-1);
    if (last) part.t0 = Math.max(part.t0, last.t1);
    if (part.t1 <= part.t0) continue;
    if (last && last.t1 === part.t0 && last.name === part.name && last.source === part.source) {
      last.t1 = part.t1;
      if (Number.isFinite(part.conf)) last.conf = Number.isFinite(last.conf) ? Math.min(last.conf, part.conf) : part.conf;
    } else out.push(part);
  }
  return out.filter(s => s.t1 - s.t0 >= MIN_SEGMENT - 1e-9);
}

// Chord events override audio from their FIRST onset until another chord, an
// explicit rest, or the measured end of the sounding notes. Single-note fragments
// do not cancel a held chord. Older scores without measured sustain use the audio
// horizon; inferred beat durations are not reliable evidence that strings stopped.
export function reconcileChords(segments, events = []) {
  const audio = cleanChordSegments(segments);
  const notes = events.filter(e => Number.isFinite(e.t)).slice().sort((a, b) => a.t - b.t);
  const horizon = Math.max(0, ...audio.map(s => s.t1), ...notes.map(e => e.t + (e.sustain || 0)));
  const changes = notes.map(e => ({ ...e, name: playedChordName(e), rest: (e.n || e.notes || []).length === 0 }))
    .filter(e => e.name || e.rest);
  const overrides = [];
  changes.forEach((e, i) => {
    const next = changes[i + 1]?.t ?? horizon;
    const resume = notes.find(n => n.t > e.t && (n.n || n.notes || []).length)?.t ?? horizon;
    const end = e.rest ? Math.min(next, resume) : Math.min(next, Number.isFinite(e.sustain) ? e.t + Math.max(0, e.sustain) : horizon);
    if (end > e.t) overrides.push({ t0: time(e.t), t1: time(end), name: e.name });
    if (!e.rest && end < next) {
      // A later melody onset can end the known rest, but cannot relabel the held strum.
      const resume = notes.find(n => n.t >= end && n.t > e.t)?.t ?? horizon;
      if (resume > end) overrides.push({ t0: time(end), t1: time(Math.min(next, resume)), name: null });
    }
  });
  const edges = [...new Set([...audio, ...overrides].flatMap(s => [s.t0, s.t1]))].sort((a, b) => a - b);
  const out = [];
  let a = -1, n = -1;
  for (let i = 0; i < edges.length - 1; i++) {
    const t0 = edges[i], t1 = edges[i + 1];
    while (a + 1 < audio.length && audio[a + 1].t0 <= t0) a++;
    while (n + 1 < overrides.length && overrides[n + 1].t0 <= t0) n++;
    const base = a >= 0 && audio[a].t1 > t0 ? audio[a] : null;
    const played = n >= 0 && overrides[n].t1 > t0 ? overrides[n] : null;
    if (played) {
      if (played.name) out.push({ ...(base || { conf: 0 }), t0, t1, name: played.name, source: 'notes' });
    } else if (base) out.push({ ...base, t0, t1 });
  }
  return cleanChordSegments(out);
}
