// Reproducible detector-only accuracy, independent of transcription reconciliation.
import { detectAudioChords as before } from './fixtures/audio-chords-baseline.mjs';
import { detectAudioChords as after } from '../js/audio-chords.js';
import { audioFixtures, chordAccuracy } from './fixtures/audio.mjs';
import fs from 'node:fs';
import { decodePCM16Wav } from './fixtures/wav.mjs';

const fixtures = audioFixtures();
// Optional local C-G-Am-F recording. Never copied into tracked fixtures.
if (process.argv[2]) {
  const { y, sampleRate, channels } = decodePCM16Wav(fs.readFileSync(process.argv[2]));
  fixtures.push({ name: `PCM WAV (${sampleRate} Hz, ${channels} ch, ${y.length / sampleRate} s)`, y, sampleRate,
    truth: ['C', 'G', 'Am', 'F'].map((name, i) => ({ name, t0: .5 + 2 * i, t1: 2.5 + 2 * i })) });
}
for (const f of fixtures) {
  const options = { sampleRate: f.sampleRate || 22050 };
  const a = await before(f.y, options), b = await after(f.y, options);
  console.log(JSON.stringify({ fixture: f.name, before: chordAccuracy(a, f.truth), after: chordAccuracy(b, f.truth), labels: b.map(s => `${s.name}@${s.t0}`) }));
}
