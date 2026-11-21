"""Guitar chord library generator + lookup. Standard tuning, strings listed low->high (E A D G B e).

  python chords.py build     # regenerate chord_library.json + chord_shapes.json, run verification
  python chords.py C         # print shapes for a chord
  from chords import load, name_pcs
"""
import itertools, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OPEN = [40, 45, 50, 55, 59, 64]            # MIDI of E2 A2 D3 G3 B3 E4
ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']   # preferred spellings
MAXFRET, SPAN = 22, 4

# suffix: (long name, intervals, omittable intervals)
TYPES = {
    '':      ('major', [0, 4, 7], []),
    'm':     ('minor', [0, 3, 7], []),
    '5':     ('power (5)', [0, 7], []),
    '6':     ('major 6th', [0, 4, 7, 9], [7]),
    'm6':    ('minor 6th', [0, 3, 7, 9], [7]),
    '7':     ('dominant 7th', [0, 4, 7, 10], [7]),
    'maj7':  ('major 7th', [0, 4, 7, 11], [7]),
    'm7':    ('minor 7th', [0, 3, 7, 10], [7]),
    'm7b5':  ('half-diminished', [0, 3, 6, 10], []),
    'dim':   ('diminished', [0, 3, 6], []),
    'dim7':  ('diminished 7th', [0, 3, 6, 9], []),
    'aug':   ('augmented', [0, 4, 8], []),
    'sus2':  ('suspended 2nd', [0, 2, 7], []),
    'sus4':  ('suspended 4th', [0, 5, 7], []),
    '7sus4': ('7 suspended 4th', [0, 5, 7, 10], [7]),
    'add9':  ('add 9', [0, 2, 4, 7], [7]),
    '9':     ('dominant 9th', [0, 2, 4, 7, 10], [7]),
    'm9':    ('minor 9th', [0, 2, 3, 7, 10], [7]),
    'maj9':  ('major 9th', [0, 2, 4, 7, 11], [7]),
    '11':    ('dominant 11th', [0, 2, 4, 5, 7, 10], [7, 2, 4]),
    'm11':   ('minor 11th', [0, 2, 3, 5, 7, 10], [7, 2]),
    '13':    ('dominant 13th', [0, 2, 4, 7, 9, 10], [7, 2]),
    '6/9':   ('6 add 9', [0, 2, 4, 7, 9], [7]),
    '7b9':   ('7 flat 9', [0, 1, 4, 7, 10], [7]),
    '7#9':   ('7 sharp 9', [0, 3, 4, 7, 10], [7]),
}
# slash-chord bass notes (semitones above root) for the basic chords
SLASH = {'': [4, 7, 10, 11, 2], 'm': [3, 7, 10, 11, 2], '7': [4, 7], 'maj7': [4, 7], 'm7': [3, 7]}

def nm(pc): return ROOT_NAMES[pc % 12]
def symbol(r, suf, bass=None): return nm(r) + suf + ('/' + nm(bass) if bass is not None else '')
def pc_of(s, f): return (OPEN[s] + f) % 12

def search(root, intervals, omit, bass=None, max_out=40):
    """All playable shapes (4-fret window, <=4 fingers) ranked by a 'common shape' cost."""
    req = {(root + i) % 12 for i in intervals if i not in omit or i == 0}
    allowed = {(root + i) % 12 for i in intervals}
    omitted_pcs = {(root + i) % 12 for i in omit}
    if bass is not None: allowed.add(bass)
    out = {}
    for b in range(0, 20):
        win = list(range(0, SPAN)) if b == 0 else [0] + list(range(b, min(b + SPAN - 1, MAXFRET) + 1))
        opts = [[None] + [f for f in win if pc_of(s, f) in allowed] for s in range(6)]
        for combo in itertools.product(*opts):
            snd = [s for s in range(6) if combo[s] is not None]
            if len(snd) < (2 if len(intervals) == 2 else 3): continue
            if snd[-1] - snd[0] + 1 - len(snd) > 1: continue          # at most one interior mute
            pcs = {pc_of(s, combo[s]) for s in snd}
            if not req <= pcs: continue
            lowest = pc_of(snd[0], combo[snd[0]])
            if bass is not None and lowest != bass: continue
            if len(intervals) == 2 and len(snd) > 3: continue
            fr = [combo[s] for s in snd if combo[s] > 0]
            base = min(fr) if fr else 0
            if fr and max(fr) - base >= SPAN: continue
            if base > 4 and any(combo[x] == 0 for x in snd): continue      # no open strings up the neck
            barre = None
            if fr:
                bs = [s for s in snd if combo[s] == base]
                if len(bs) >= 2 and all(combo[s] is not None and combo[s] >= base for s in range(bs[0], bs[-1] + 1)):
                    barre = (base, bs[0], bs[-1])
            n_f = len([s for s in snd if combo[s] > 0])
            fingers = n_f - ((len([s for s in snd if combo[s] == base and barre[1] <= s <= barre[2]]) - 1) if barre else 0)
            if fingers > 4: continue
            c = 0.0
            if bass is None and lowest != root: c += 4 if lowest in req else 6
            c += (6 - len(snd)) * (0.4 if len(intervals) == 2 else 1.0)
            c += 3.0 * (snd[-1] - snd[0] + 1 - len(snd))
            c += 0.8 * fingers + (0.7 if barre else 0)
            c += 0.12 * base + 0.3 * ((max(fr) - base) if fr else 0)
            c += 1.0 * len(omitted_pcs - pcs) + 0.08 * sum(fr)
            if not barre: c -= 0.3 * len([s for s in snd if combo[s] == 0])
            if snd[-1] < 5: c += 0.6 * (5 - snd[-1])
            key = tuple(-1 if combo[s] is None else combo[s] for s in range(6))
            if key not in out or out[key][0] > c: out[key] = (c, barre, fingers)
    return sorted(out.items(), key=lambda kv: kv[1][0])[:max_out]

def barre_of(fx):
    fr = [f for f in fx if f > 0]
    if not fr: return None
    base = min(fr); bs = [i for i, f in enumerate(fx) if f == base]
    if len(bs) >= 2 and all(fx[i] >= base for i in range(bs[0], bs[-1] + 1)): return (base, bs[0], bs[-1])
    return None

def assign_fingers(fx, barre):
    """Suggested finger per string (0 = open/muted, 1 index .. 4 pinky)."""
    fing = [0] * 6
    if barre:
        for s in range(barre[1], barre[2] + 1): fing[s] = 1
    rest = sorted((f, s) for s, f in enumerate(fx) if f > 0 and fing[s] == 0)
    nxt = 2 if barre else 1
    for f, s in rest:
        fing[s] = min(nxt, 4); nxt += 1
    return fing

def make_shape(fx, barre, c, root):
    snd = [s for s in range(6) if fx[s] >= 0]
    low = snd[0]
    bass_string = low if pc_of(low, fx[low]) == root else None
    base = min([f for f in fx if f > 0], default=0)
    if any(f == 0 for f in fx) and base <= 5: kind = 'open'
    elif bass_string is not None and not any(f == 0 for f in fx):
        kind = {0: 'E-form', 1: 'A-form', 2: 'D-form', 3: 'G-form'}.get(bass_string, 'movable')
    else: kind = 'alt'
    return {'frets': ['x' if f < 0 else f for f in fx], 'fingers': assign_fingers(fx, barre),
            'barre': ({'fret': barre[0], 'from': barre[1], 'to': barre[2]} if barre else None),
            'kind': kind, 'base': base, 'cost': round(c, 2)}

def build():
    chords, index = {}, {}
    entries = [(r, suf, None) for r in range(12) for suf in TYPES]
    entries += [(r, suf, (r + d) % 12) for r in range(12) for suf, ds in SLASH.items() for d in ds]
    for r, suf, bass in entries:
        _, iv, omit = TYPES[suf]
        shapes, cnt = [], {}
        for fx, (c, barre, fn) in search(r, iv, omit, bass):
            sh = make_shape(fx, barre, c, r)
            if bass is not None and sh['kind'] not in ('open', 'alt'): sh['kind'] = 'slash'
            k = sh['kind']
            if cnt.get(k, 0) >= {'open': 4, 'alt': 4}.get(k, 2): continue
            cnt[k] = cnt.get(k, 0) + 1
            shapes.append(sh)
        sym = symbol(r, suf, bass)
        if sym in VERIFIED:
            fx = parse(VERIFIED[sym])
            shapes = [x for x in shapes if [-1 if f == 'x' else f for f in x['frets']] != fx]
            sh = make_shape(fx, barre_of(fx), 0, r); sh['kind'] = 'open' if sh['kind'] in ('open', 'alt') and 0 in fx else sh['kind']; sh['curated'] = True
            shapes.insert(0, sh)
        pcs = sorted({(r + i) % 12 for i in iv} | ({bass} if bass is not None else set()))
        chords[sym] = {'root': nm(r), 'rootpc': r, 'type': suf, 'bass': nm(bass) if bass is not None else None,
                       'basspc': bass, 'notes': [nm((r + i) % 12) for i in iv], 'pcs': pcs, 'shapes': shapes}
        if bass is None: index.setdefault('-'.join(map(str, pcs)), []).append(sym)
    return {'tuning': ['E', 'A', 'D', 'G', 'B', 'e'], 'open_midi': OPEN, 'max_fret': MAXFRET,
            'note': "frets listed low E to high e; 'x' muted, 0 open; fingers 1=index..4=pinky, 0 none",
            'types': {s: {'name': n, 'intervals': iv} for s, (n, iv, _) in TYPES.items()},
            'pcs_index': index, 'chords': chords}

# hand-checked well-known shapes (low E -> high e)
VERIFIED = {
 'C': 'x32010', 'G': '320003', 'D': 'xx0232', 'A': 'x02220', 'E': '022100', 'Am': 'x02210', 'Em': '022000',
 'Dm': 'xx0231', 'F': '133211', 'Bm': 'x24432', 'F#m': '244222', 'Bb': 'x13331', 'B7': 'x21202', 'E7': '020100',
 'A7': 'x02020', 'D7': 'xx0212', 'G7': '320001', 'C7': 'x32310', 'Am7': 'x02010', 'Em7': '022030', 'Dm7': 'xx0211',
 'Cmaj7': 'x32000', 'Fmaj7': 'xx3210', 'Amaj7': 'x02120', 'Dsus2': 'xx0230', 'Dsus4': 'xx0233', 'Asus2': 'x02200',
 'Asus4': 'x02230', 'Esus4': '022200', 'Cadd9': 'x32030', 'G/B': 'x20003', 'D/F#': '200232', 'C/G': '332010',
 'Am/G': '302210', 'E5': '022xxx', 'A5': 'x022xx', 'D6': 'xx0202', 'A9': 'x02423',
 'Bdim': 'x2343x', 'E9': '020102',
}
def parse(s): return [-1 if ch == 'x' else int(ch) for ch in s]

def verify(lib):
    res = {}
    for name, sh in VERIFIED.items():
        ch = lib['chords'].get(name)
        fx = parse(sh)
        if ch is None: res[name] = ('missing', None, False); continue
        spells = {pc_of(s, f) for s, f in enumerate(fx) if f >= 0} <= set(ch['pcs'])
        pool = [list(k) for k, _ in search(ch['rootpc'], TYPES[ch['type']][1], TYPES[ch['type']][2], ch['basspc'], max_out=10**6)]
        rank = pool.index(fx) + 1 if fx in pool else None
        inlib = any(['x' if f < 0 else f for f in fx] == s['frets'] for s in ch['shapes'])
        res[name] = ('ok' if spells and rank else 'FAIL', rank, inlib)
    return res

def load(path=None):
    return json.load(open(path or os.path.join(HERE, 'chord_library.json')))

def name_pcs(pcs, lib=None):
    """Pitch-class set -> chord symbols whose pitch classes match exactly (root-position names, no slash)."""
    lib = lib or load()
    return lib['pcs_index'].get('-'.join(map(str, sorted({p % 12 for p in pcs}))), [])

def slim(lib):
    keep = {'open', 'E-form', 'A-form', 'D-form', 'G-form'}
    ch = {}
    for sym, c in lib['chords'].items():
        sh = [{k: s[k] for k in ('frets', 'fingers', 'barre', 'kind', 'base')} for s in c['shapes'] if s['kind'] in keep]
        for s in sh:
            if s['barre'] is None: del s['barre']
        ch[sym] = {'pcs': c['pcs'], 'shapes': sh[:5]}
    return {'tuning': lib['tuning'], 'chords': ch}

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'build':
        lib = build()
        P = lambda n: os.path.join(HERE, n)
        json.dump(lib, open(P('chord_library.json'), 'w'), separators=(',', ':'))
        json.dump(slim(lib), open(P('chord_shapes.json'), 'w'), separators=(',', ':'))
        print('chords', len(lib['chords']), 'shapes', sum(len(c['shapes']) for c in lib['chords'].values()),
              'lib KB', os.path.getsize(P('chord_library.json')) // 1024, 'slim KB', os.path.getsize(P('chord_shapes.json')) // 1024)
        v = verify(lib)
        bad = {k: x for k, x in v.items() if x[0] != 'ok'}
        print('verified ok %d/%d' % (len(v) - len(bad), len(v)), bad)
        print('rank1:', sum(1 for x in v.values() if x[1] == 1), ' in library shapes:', sum(1 for x in v.values() if x[2]))
        print({k: (x[1], x[2]) for k, x in v.items() if x[1] != 1 or not x[2]})
    elif len(sys.argv) > 1:
        for s in load()['chords'][sys.argv[1]]['shapes']: print(s['kind'], ''.join(map(str, s['frets'])), s['fingers'], s['barre'])
