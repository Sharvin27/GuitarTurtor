"""Optional stronger recogniser: BTC (Bi-directional Transformer for chords, ISMIR 2019, MIT) large-vocab (170 chords) on CPU.
Vendored in third_party/BTC (2 patches: yaml.safe_load, torch.load map_location=cpu). Needs torch, mir_eval, pretty_midi, pyyaml, librosa.
  python detect_btc.py in.wav [--out chords.json]   ->  [{t0,t1,chord,confidence}] (confidence=None: BTC gives labels only)
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); BTC = os.path.join(HERE, 'third_party', 'BTC')
SUF = {'maj': '', 'min': 'm', '7': '7', 'maj7': 'maj7', 'min7': 'm7', 'dim': 'dim', 'aug': 'aug', 'sus2': 'sus2', 'sus4': 'sus4',
       'dim7': 'dim7', 'hdim7': 'm7b5', 'maj6': '6', 'min6': 'm6'}
ENH = {'C#': 'Db', 'D#': 'Eb', 'Gb': 'F#', 'G#': 'Ab', 'A#': 'Bb', 'Cb': 'B', 'E#': 'F', 'Fb': 'E', 'B#': 'C'}

def to_symbol(lab):
    if lab in ('N', 'X'): return 'N'
    root, _, q = lab.partition(':'); bass = None
    if '/' in q: q, bass = q.split('/')
    root = ENH.get(root, root)
    return root + SUF.get(q or 'maj', q)

def detect(wav):
    d = tempfile.mkdtemp()
    try:
        shutil.copy(wav, os.path.join(d, 'a.wav'))
        subprocess.run([sys.executable, 'test.py', '--voca', 'True', '--audio_dir', d, '--save_dir', d], cwd=BTC, check=True, capture_output=True)
        out = []
        for ln in open(os.path.join(d, 'a.lab')):
            a, b, lab = ln.split()
            out.append({'t0': float(a), 't1': float(b), 'chord': to_symbol(lab), 'confidence': None, 'raw': lab})
        return out
    finally: shutil.rmtree(d, ignore_errors=True)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('wav'); ap.add_argument('--out'); a = ap.parse_args()
    r = detect(a.wav); t = json.dumps(r, indent=1)
    open(a.out, 'w').write(t) if a.out else print(t)
