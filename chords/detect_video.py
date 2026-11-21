"""Chord from fretting-hand fingertip positions (handtrack output) -> best library chord + 'closest correct shape' feedback.

Input = fingertips as handtrack's track.py computes them (`tips_simple`):
    [(finger 0..3 = index..pinky, string 0..5 with 0 = high e, fret int), ...]
  from detect_video import match_tips
  r = match_tips(tips_simple, target=None)     # target='G' -> feedback against the G shapes only
  r -> chord, confidence, shape, fingers, exact, feedback[], candidates[]
CLI:  python detect_video.py tips.json [--target G]   (list of tips, or list of such lists = frames, majority-voted)
      python detect_video.py --selftest
Hook into track.py (read-only here): after `tips_simple` is built call match_tips(tips_simple).
Handles missing fingers (occlusion) and barres (index tip on the barre fret on any barred string counts for the whole barre).
"""
import json, os, sys, random
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chords import load, barre_of, assign_fingers

_LIB = None
STR = ['E', 'A', 'D', 'G', 'B', 'e']

def lib():
    global _LIB
    if _LIB is None: _LIB = load()
    return _LIB

def to_lib(tips):
    """handtrack (finger, string0=high e, fret) -> {lib_string(0=low E): [(fret, finger)]}; fret 0 ignored."""
    obs = {}
    for f, s, fr in tips:
        if fr and fr > 0: obs.setdefault(5 - int(s), []).append((int(fr), int(f)))
    return obs

def score_shape(obs, sh):
    fr = sh['frets']; b = sh.get('barre')
    need = {s: f for s, f in enumerate(fr) if f not in ('x', 0)}
    matched = set(); bad = []
    for s, f in need.items():
        if any(of == f for of, _ in obs.get(s, [])): matched.add(s)
    if b and any(of == b['fret'] and ofi == 0 for s in range(b['from'], b['to'] + 1) for of, ofi in obs.get(s, [])):
        for s in range(b['from'], b['to'] + 1):
            if s in need and need[s] >= b['fret']: matched.add(s)
    for s, lst in obs.items():
        for of, ofi in lst:
            if need.get(s) == of: continue
            if b and b['from'] <= s <= b['to'] and of == b['fret']: continue
            bad.append((s, of))
    missing = [s for s in need if s not in matched]
    n = max(len(need), 1)
    return (len(matched) - 1.5 * len(bad) - 0.4 * len(missing)) / n, missing, bad, need

def match_tips(tips, target=None, top=3):
    L = lib(); obs = to_lib(tips)
    if not obs: return {'chord': None, 'confidence': 0.0, 'note': 'no fretted fingers on the board', 'candidates': []}
    best = {}
    for sym, c in L['chords'].items():
        if (target and sym != target) or (c['type'] == '5' and not target): continue
        for sh in c['shapes']:
            if not any(f not in ('x', 0) for f in sh['frets']): continue
            sc, missing, bad, need = score_shape(obs, sh)
            # priors: fretted-only evidence cannot see open strings, so favour curated/open/common shapes and simple names
            sc += (0.06 if sh.get('curated') else 0.03 if sh['kind'] == 'open' else 0) - 0.01 * min(sh.get('cost', 0), 6) - 0.02 * len(sym) - (0.05 if c['bass'] else 0)
            if sym not in best or sc > best[sym][0]: best[sym] = (sc, sh, missing, bad, need)
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])
    if not ranked: return {'chord': None, 'confidence': 0.0, 'candidates': []}
    sym, (sc, sh, missing, bad, need) = ranked[0]
    margin = sc - ranked[1][1][0] if len(ranked) > 1 else 1.0
    conf = max(0.0, min(1.0, sc)) * (0.5 + 0.5 * min(1.0, margin / 0.15))
    fb = [f'put a finger on {STR[s]} string, fret {need[s]}' for s in missing]
    for s, f in bad:
        want = sh['frets'][s]
        fb.append(f'{STR[s]} string: fret {f} is not in this shape (should be ' + ('muted' if want == 'x' else 'open' if want == 0 else f'fret {want}') + ')')
    return {'chord': sym, 'confidence': round(conf, 3), 'shape': sh['frets'], 'fingers': sh['fingers'],
            'exact': not missing and not bad, 'feedback': fb or ['shape matches'],
            'candidates': [(k, round(v[0], 2)) for k, v in ranked[:top]]}

def vote(frames):
    rs = [match_tips(t) for t in frames]; names = Counter(r['chord'] for r in rs if r['chord'])
    return max(rs, key=lambda r: (names[r['chord']] if r['chord'] else -1, r['confidence']))

def tips_from_shape(frets, drop=0.0, shift=0.0, seed=0):
    """Synthetic handtrack tips for a library shape (testing): fingers per suggested numbering, with occlusion / 1-fret noise."""
    rnd = random.Random(seed); tips = []
    fx = [-1 if f == 'x' else f for f in frets]; b = barre_of(fx); fing = assign_fingers(fx, b)
    for s, f in enumerate(fx):
        if f <= 0: continue
        if b and b[1] < s < b[2] and f == b[0]: continue            # barre: index tip visible on the end strings
        if rnd.random() < drop: continue
        if rnd.random() < shift: f = max(1, f + rnd.choice([-1, 1]))
        tips.append((max(fing[s] - 1, 0), 5 - s, f))
    return tips

def selftest():
    L = lib(); rnd = random.Random(1)
    names = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'F', 'Bm', 'B7', 'E7', 'A7', 'D7', 'G7', 'C7', 'Am7', 'Em7', 'Cmaj7', 'Fmaj7',
             'Dsus2', 'Dsus4', 'Asus2', 'Esus4', 'Cadd9', 'Bb', 'F#m', 'D/F#', 'G/B', 'Amaj7']
    for cond, kw in [('perfect', {}), ('20% fingers hidden', dict(drop=0.2)), ('20% fingers 1 fret off', dict(shift=0.2)), ('both 15%', dict(drop=0.15, shift=0.15))]:
        ok = same = n = 0
        for nm in names:
            r = match_tips(tips_from_shape(L['chords'][nm]['shapes'][0]['frets'], seed=rnd.randint(0, 99999), **kw)); n += 1
            ok += r['chord'] == nm
            same += bool(r['chord']) and (r['chord'] == nm or L['chords'][r['chord']]['pcs'] == L['chords'][nm]['pcs'])
        print(f'{cond}: top1 exact {ok}/{n}, same notes {same}/{n}')
    print('feedback demo (target G, wrong fret on high e):', match_tips([(1, 5, 3), (0, 4, 2), (2, 0, 4)], target='G')['feedback'])

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] == '--selftest': selftest()
    else:
        d = json.load(open(a[0])); tg = a[a.index('--target') + 1] if '--target' in a else None
        framed = bool(d) and isinstance(d[0], list) and d[0] and isinstance(d[0][0], (list, tuple))
        print(json.dumps(vote(d) if framed else match_tips(d, tg), indent=1))
