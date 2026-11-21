"""Chord recognition from audio: CQT chroma + template matching on the chord library, beat-synced, Viterbi-smoothed.

  python detect_audio.py in.wav [--vocab basic|triads|full] [--segments beats|N(seconds)] [--out chords.json]
Output: [{t0, t1, chord, confidence}]. Vocab 'basic' = maj, m, 7, maj7, m7, sus2, sus4, dim (default).
"""
import argparse, json, sys, os
import numpy as np, librosa
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chords import load

VOCABS = {'triads': ['', 'm'], 'basic': ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim'],
          'full': ['', 'm', '5', '6', 'm6', '7', 'maj7', 'm7', 'm7b5', 'dim', 'dim7', 'aug', 'sus2', 'sus4', '7sus4', 'add9', '9', 'm9', 'maj9']}

def templates(vocab, lib):
    names, T, NT = [], [], []
    for sym, c in lib['chords'].items():
        if c['bass'] is not None or c['type'] not in VOCABS[vocab]: continue
        v = np.zeros(12)
        for i in lib['types'][c['type']]['intervals']:
            v[(c['rootpc'] + i) % 12] = 1.0
        v[c['rootpc']] = 1.3                                  # root/bass dominates a strummed chord
        if len(lib['types'][c['type']]['intervals']) > 3: v[(c['rootpc'] + lib['types'][c['type']]['intervals'][-1]) % 12] *= 0.8
        names.append(sym); T.append(v / np.linalg.norm(v)); NT.append(len(lib['types'][c['type']]['intervals']))
    return names, np.array(T), np.array(NT)

def chroma(y, sr, hop=512):
    yh = librosa.effects.harmonic(y, margin=2.0)
    C = librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=hop, fmin=librosa.note_to_hz('C2'), n_octaves=6, bins_per_octave=36, tuning=None)
    return C

PEN, SHARP = 0.04, 30

def detect(path, vocab='basic', segments='beats', stay=0.5):
    lib = load()
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 512
    C = chroma(y, sr, hop)
    n = C.shape[1]
    if segments == 'beats':
        _, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, trim=False)
        edges = np.unique(np.concatenate([[0], beats, [n]]))
    else:
        step = max(1, int(float(segments) * sr / hop)); edges = np.arange(0, n + step, step); edges[-1] = n
    edges = np.unique(np.clip(edges, 0, n))
    segs = [(a, b) for a, b in zip(edges[:-1], edges[1:]) if b - a >= 2]
    X = np.array([np.median(C[:, a:b], axis=1) for a, b in segs])
    X = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
    names, T, NT = templates(vocab, lib)
    S = X @ T.T - PEN * (NT[None, :] - 3).clip(0)                                              # cosine similarity (segments x chords)
    # Viterbi smoothing (sticky): emission ~ softmax(similarity), self-transition `stay`
    P = np.exp(SHARP * S); P /= P.sum(1, keepdims=True)
    k = len(names)
    trans = np.full((k, k), (1 - stay) / (k - 1)); np.fill_diagonal(trans, stay)
    path_idx = librosa.sequence.viterbi(P.T, trans)
    out = []
    for j, ((a, b), i) in enumerate(zip(segs, path_idx)):
        t0, t1 = float(a * hop / sr), float(b * hop / sr)
        row = S[j]; others = np.delete(row, i)
        conf = float(np.clip(0.5 * row[i] + 5 * (row[i] - others.max()), 0, 1))   # similarity + margin to runner-up
        if out and out[-1]['chord'] == names[i]:
            out[-1]['t1'] = round(t1, 3); out[-1]['confidence'] = round((out[-1]['confidence'] + conf) / 2, 3)
        else:
            out.append({'t0': round(t0, 3), 't1': round(t1, 3), 'chord': names[i], 'confidence': round(conf, 3)})
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('--vocab', default='basic', choices=VOCABS); ap.add_argument('--segments', default='beats')
    ap.add_argument('--out')
    a = ap.parse_args()
    res = detect(a.wav, a.vocab, a.segments)
    txt = json.dumps(res, indent=1)
    if a.out: open(a.out, 'w').write(txt)
    print(txt if not a.out else f'{len(res)} segments -> {a.out}')
