// Deterministic tones; these test DSP plumbing, not accuracy on real guitar recordings.
export const CHORDS = { C: [48, 52, 55], G: [43, 47, 50], Am: [45, 48, 52], F: [41, 45, 48] };
export function tone(pitches, { seconds = 1, sampleRate = 22050, harmonics = 1 } = {}) {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => {
    const t = i / sampleRate, envelope = Math.min(1, t / .01, (seconds - t) / .02);
    let value = 0;
    for (const p of pitches) for (let h = 1; h <= harmonics; h++) value += Math.sin(2 * Math.PI * 440 * 2 ** ((p - 69) / 12) * h * t) / h ** 1.5;
    return .2 * envelope * value / pitches.length;
  });
}
export function joinAudio(...parts) {
  const y = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0; for (const p of parts) { y.set(p, offset); offset += p.length; }
  return y;
}

export const GUITAR = {
  C: [48, 52, 55, 60, 64], G: [43, 47, 50, 55, 59, 67], Am: [45, 52, 57, 60, 64],
  F: [41, 48, 53, 57, 60, 65], D: [50, 57, 62, 66], A: [45, 52, 57, 61, 64],
  Bm: [47, 54, 59, 62, 66], Em: [40, 47, 52, 55, 59, 64],
};

// Seeded Karplus–Strong: noise excitation, fractional delay and two-point lowpass
// feedback. Compensate the lowpass's half-sample delay to keep pitches in tune.
// Each chord lasts 2 s, plucked at .5 + 2*c and again 1 s later, 12 ms/string.
export function ksProgression(names, { seed = 12345, cents = 0, sampleRate = 22050 } = {}) {
  const y = new Float32Array(Math.round((names.length * 2 + 1) * sampleRate));
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  names.forEach((name, c) => [0, 1].forEach(beat => GUITAR[name].forEach((p, string) => {
    const freq = 440 * 2 ** ((p - 69 + cents / 100) / 12), delay = sampleRate / freq - .5;
    const length = Math.floor(delay), fraction = delay - length;
    const ring = Float64Array.from({ length: length + 3 }, random);
    const mean = ring.reduce((s, v) => s + v, 0) / ring.length;
    ring.forEach((v, i) => { ring[i] = v - mean; });
    const start = Math.round((.5 + c * 2 + beat + string * .012) * sampleRate);
    const end = Math.round((.5 + (c + 1) * 2) * sampleRate);
    for (let i = start, cursor = 0; i < end; i++, cursor = (cursor + 1) % ring.length) {
      const at = age => ring[(cursor - age + ring.length) % ring.length];
      const v = .996 * .5 * ((1 - fraction) * (at(length) + at(length + 1)) + fraction * (at(length + 1) + at(length + 2)));
      ring[cursor] = v;
      const fade = Math.min(1, (end - i) / (sampleRate * .015));
      y[i] += .18 * v * fade;
    }
  })));
  return y;
}

// Duration-weighted accuracy over labelled intervals; silence is evaluated separately.
export function chordAccuracy(segments, truth) {
  let correct = 0, total = 0, exact = 0;
  for (const { t0, t1, name } of truth) {
    let hit = 0;
    for (const s of segments) if (s.name === name) hit += Math.max(0, Math.min(t1, s.t1) - Math.max(t0, s.t0));
    correct += hit; total += t1 - t0;
    if (Math.abs(hit - (t1 - t0)) < 1e-6) exact++;
  }
  return { exact, count: truth.length, percent: +(100 * correct / total).toFixed(2) };
}

export function audioFixtures() {
  const fixtures = [1, 5].map(harmonics => ({
    name: harmonics === 1 ? 'Sine C G Am F' : 'Harmonic C G Am F',
    y: joinAudio(new Float32Array(11025), ...Object.values(CHORDS).map(ps => tone(ps, { harmonics })), new Float32Array(11025)),
    truth: Object.keys(CHORDS).map((name, i) => ({ name, t0: .5 + i, t1: 1.5 + i })),
  }));
  for (const names of [['C', 'G', 'Am', 'F'], ['D', 'A', 'Bm', 'G'], ['Em', 'C', 'G', 'D']]) {
    for (const cents of [0, 35, -35]) fixtures.push({
      name: `KS ${names.join(' ')}${cents ? ` (${cents > 0 ? '+' : ''}${cents} cents)` : ''}`,
      y: ksProgression(names, { cents }), truth: names.map((name, i) => ({ name, t0: .5 + 2 * i, t1: 2.5 + 2 * i })),
    });
  }
  return fixtures;
}
