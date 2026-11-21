"""Synthetic evaluation: render library shapes as strummed Karplus-Strong guitar, detect, score."""
import sys, os, json, numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chords import load, OPEN
from detect_audio import detect
SR = 22050
rng = np.random.default_rng(0)

def pluck(midi, dur, sr=SR):
    f = 440 * 2 ** ((midi - 69) / 12); N = int(sr / f)
    buf = rng.uniform(-1, 1, N); buf = np.convolve(buf, [.5, .5], 'same'); out = np.zeros(int(dur * sr))
    for i in range(len(out)):
        out[i] = buf[i % N]; buf[i % N] = 0.4985 * (buf[i % N] + buf[(i + 1) % N])
    return out

def render(prog, bpm=90, beats_per=2, noise=0.0, drums=False, shape_kind='any'):
    lib = load(); beat = 60 / bpm; seg = beat * beats_per
    y = np.zeros(int((len(prog) * seg + 1) * SR))
    for k, name in enumerate(prog):
        shapes = lib['chords'][name]['shapes']
        sh = shapes[0] if shape_kind == 'any' else shapes[min(1, len(shapes) - 1)]
        t = k * seg
        for rep in range(beats_per):              # one strum per beat (down)
            for s, f in enumerate(sh['frets']):
                if f == 'x': continue
                n = pluck(OPEN[s] + f, beat * 1.2) * (0.8 + 0.4 * rng.random())
                i0 = int((t + rep * beat + s * 0.012) * SR); y[i0:i0 + len(n)] += n[:len(y) - i0]
    if drums:
        for k in range(int(len(prog) * beats_per * 2)):
            i0 = int(k * beat / 2 * SR); n = rng.normal(size=int(0.05 * SR)) * np.exp(-np.arange(int(0.05 * SR)) / (0.01 * SR)); y[i0:i0 + len(n)] += 0.5 * n[:len(y) - i0]
    y /= np.abs(y).max()
    if noise: y += rng.normal(scale=noise, size=len(y))
    return y / np.abs(y).max() * 0.9, seg

BASIC = ['C', 'G', 'Am', 'F', 'D', 'A', 'E', 'Em', 'Dm', 'Bm', 'G', 'D', 'A', 'E', 'C', 'G', 'F', 'C', 'Am', 'Em', 'Bb', 'Eb', 'Gm', 'Cm', 'Ab', 'Db', 'F#m', 'B', 'Dm', 'Bb', 'G', 'C']
SEV = ['Am7', 'D7', 'Gmaj7', 'Cmaj7', 'Em7', 'A7', 'Dm7', 'G7', 'Cmaj7', 'F', 'B7', 'E7', 'Am', 'Asus4', 'A', 'Dsus2', 'D', 'Dsus4', 'D', 'E7', 'Fmaj7', 'Bm7', 'Em7', 'A7']

def score(prog, seg, res, vocab):
    base = lambda c: c.rstrip('0123456789').replace('maj', '').replace('sus', 'sus')
    from chords import load as L
    lib = L(); n = ex = rt = tri = 0
    for k, name in enumerate(prog):
        t = k * seg + seg / 2
        got = next((r['chord'] for r in res if r['t0'] <= t < r['t1']), None); n += 1
        if got is None: continue
        g, w = lib['chords'][got], lib['chords'][name]
        ex += got == name; rt += g['rootpc'] == w['rootpc']
        q = lambda c: 'm' if c['type'].startswith('m') and not c['type'].startswith('maj') or c['type'] in ('dim', 'm7b5', 'dim7') else 'M'
        tri += g['rootpc'] == w['rootpc'] and q(g) == q(w)
    return dict(exact=ex / n, root=rt / n, root_quality=tri / n)

if __name__ == '__main__':
    out = {}
    for label, prog in [('triads', BASIC), ('sevenths', SEV)]:
        for cond, kw in [('clean', {}), ('noise+drums', dict(noise=0.05, drums=True))]:
            y, seg = render(prog, **kw); sf.write('_t.wav', y, SR)
            for vocab in ['triads', 'basic', 'full']:
                for segm in ['beats', '2.0' if False else str(round(seg, 4))]:
                    r = detect('_t.wav', vocab, segm)
                    out[f'{label}|{cond}|{vocab}|{"beat" if segm=="beats" else "known-seg"}'] = score(prog, seg, r, vocab)
    for k, v in out.items(): print(k, {a: round(b, 2) for a, b in v.items()})
    os.remove('_t.wav')
