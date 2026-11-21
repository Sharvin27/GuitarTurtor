// Reproducible detector-only accuracy, independent of transcription reconciliation.
import { detectAudioChords as before } from './fixtures/audio-chords-baseline.mjs';
import { detectAudioChords as after } from '../js/audio-chords.js';
import { audioFixtures, chordAccuracy } from './fixtures/audio.mjs';

for (const f of audioFixtures()) {
  const a = await before(f.y), b = await after(f.y);
  console.log(JSON.stringify({ fixture: f.name, before: chordAccuracy(a, f.truth), after: chordAccuracy(b, f.truth), labels: b.map(s => `${s.name}@${s.t0}`) }));
}
