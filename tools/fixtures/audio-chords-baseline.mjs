// Browser-sized port of chords/detect_audio.py: chroma, cosine templates, sticky Viterbi.
// Hann-windowed spectral peaks replace librosa's harmonic CQT; no audio leaves the browser.
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const N = 8192, SHARP = 30, CHANGE = Math.log(23);
const hann = Float64Array.from({ length: N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1)));
const templates = ROOTS.flatMap((root, r) => ['', 'm'].map(type => {
  const v = new Float64Array(12);
  for (const iv of [0, type === 'm' ? 3 : 4, 7]) v[(r + iv) % 12] = iv === 0 ? 1.3 : 1;
  const norm = Math.hypot(...v);
  return { name: root + type, v: v.map(x => x / norm) };
}));

function fft(re, im) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let size = 2; size <= N; size *= 2) {
    const angle = -2 * Math.PI / size, cr = Math.cos(angle), ci = Math.sin(angle);
    for (let start = 0; start < N; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = nr;
      }
    }
  }
}

function chroma(y, a, b, sr) {
  const frames = [], re = new Float64Array(N), im = new Float64Array(N), mag = new Float64Array(N / 2);
  const span = b - a, count = Math.max(1, Math.ceil(span / (N / 2)));
  for (let frame = 0; frame < count; frame++) {
    const start = a + Math.round(Math.max(0, span - N) * frame / Math.max(1, count - 1));
    let energy = 0;
    re.fill(0); im.fill(0);
    for (let i = 0; i < N && start + i < b; i++) {
      const v = y[start + i]; energy += v * v;
      re[i] = v * hann[i];
    }
    const c = new Float64Array(12);
    if (energy / Math.min(N, span) < 1e-8) { frames.push(c); continue; }
    fft(re, im);
    for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k], im[k]);
    const peak = Math.max(...mag);
    for (let k = 2; k < mag.length - 1; k++) {
      if (mag[k] < peak * .02 || mag[k] <= mag[k - 1] || mag[k] <= mag[k + 1]) continue;
      // Interpolate peaks before folding octaves so low guitar notes land in the right pitch class.
      const l = Math.log(mag[k - 1] + 1e-12), m = Math.log(mag[k] + 1e-12), r = Math.log(mag[k + 1] + 1e-12);
      const delta = Math.max(-.5, Math.min(.5, .5 * (l - r) / (l - 2 * m + r)));
      const pitch = 69 + 12 * Math.log2((k + delta) * sr / N / 440), note = Math.round(pitch);
      if (note >= 36 && note <= 95 && Math.abs(pitch - note) < .4) c[note % 12] += mag[k];
    }
    frames.push(c);
  }
  const c = Float64Array.from({ length: 12 }, (_, p) => {
    const xs = frames.map(f => f[p]).sort((a, b) => a - b), mid = xs.length >> 1;
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  });
  const norm = Math.hypot(...c), peak = Math.max(...c);
  if (!norm || c.filter(x => x > peak * .18).length < 3) return null;
  return c.map(x => x / norm);
}

// Fixed half-second windows include leading/trailing silence; times are relative to the decoded recording.
export async function detectAudioChords(y, { sampleRate = 22050, windowSeconds = .5, progress = () => {} } = {}) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate) || !(windowSeconds >= .1) || !Number.isFinite(windowSeconds)) throw new Error('Invalid chord analysis timing');
  const step = Math.max(1, Math.round(sampleRate * windowSeconds)), rows = [], NONE = templates.length, states = NONE + 1;
  for (let a = 0; a < y.length; a += step) {
    const b = Math.min(y.length, a + step), c = chroma(y, a, b, sampleRate);
    const sims = templates.map(t => c ? t.v.reduce((sum, v, p) => sum + v * c[p], 0) : 0);
    const clear = c && Math.max(...sims) >= .65;
    rows.push({ a, b, sims, emit: [...sims.map(s => clear ? SHARP * s : -Infinity), clear ? SHARP * .55 : 0] });
    if (rows.length % 8 === 0) { progress(b / y.length); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  if (!rows.length) return [];
  // Log-softmax has a common per-frame constant, so raw scaled similarities give the same path.
  let prev = rows[0].emit.slice(); const back = [];
  for (let i = 1; i < rows.length; i++) {
    let best = 0; for (let j = 1; j < states; j++) if (prev[j] > prev[best]) best = j;
    const cur = [], bp = new Uint8Array(states);
    for (let j = 0; j < states; j++) {
      const move = prev[best] - CHANGE;
      bp[j] = prev[j] >= move ? j : best;
      cur[j] = Math.max(prev[j], move) + rows[i].emit[j];
    }
    back.push(bp); prev = cur;
  }
  let state = 0; for (let j = 1; j < states; j++) if (prev[j] > prev[state]) state = j;
  const path = new Uint8Array(rows.length); path[path.length - 1] = state;
  for (let i = back.length - 1; i >= 0; i--) { state = back[i][state]; path[i] = state; }
  const segments = [];
  path.forEach((s, i) => {
    if (s === NONE) return;
    const row = rows[i], runner = Math.max(...row.sims.filter((_, j) => j !== s));
    const conf = Math.max(0, Math.min(1, .5 * row.sims[s] + 5 * (row.sims[s] - runner)));
    const t0 = row.a / sampleRate, t1 = row.b / sampleRate, name = templates[s].name, last = segments.at(-1);
    if (last && last.name === name && Math.abs(last.t1 - t0) < 1e-6) {
      last.conf = (last.conf * (last.t1 - last.t0) + conf * (t1 - t0)) / (t1 - last.t0); last.t1 = t1;
    } else segments.push({ t0, t1, name, conf });
  });
  progress(1);
  return segments.map(s => ({ ...s, t0: +s.t0.toFixed(3), t1: +s.t1.toFixed(3), conf: +s.conf.toFixed(3) }));
}
