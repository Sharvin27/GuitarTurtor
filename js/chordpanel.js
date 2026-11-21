// Chord panel for the 3D view: audio chords when available, otherwise implied harmony, and a diagram of a
// playable shape from the chord library (chords/chord_shapes.json), and the next chord with a countdown.
// Toggle with the panel's button or the C key. Only touches the DOM when what it shows changes.
import { analyzeHarmony } from './harmony.js';
import { reconcileChords } from './chord-agreement.js';

export function chordSource(score, events) {
  const audio = Array.isArray(score.chords);
  const segs = reconcileChords(audio ? score.chords : analyzeHarmony(events), events || score.notes || []);
  return { segs, label: segs.some(s => s.source === 'notes') ? 'from played notes and audio' :
    audio ? 'from the audio' : 'estimated from the melody' };
}

const FINGER_CSS = ['#4cc9f0', '#80ed99', '#ffd166', '#ef476f'];   // index, middle, ring, pinky (as the 3D markers)
const KEY = 'guitar3d.chords';
const store = {
  get(d) { try { const v = localStorage.getItem(KEY); return v === null ? d : v === '1'; } catch (e) { return d; } },
  set(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* private mode */ } },
};
const CSS = `
.chordpanel { position: fixed; left: 16px; top: calc(var(--top-h, 0px) + 88px); z-index: 3; width: 150px;
  background: rgba(13,15,20,0.88); border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 6px 10px 8px; color: #e9ecf1;
  font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; backdrop-filter: blur(6px); }
.chordpanel .cp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: #9aa3b2; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.chordpanel .cp-head button { font: 600 11px/1 system-ui, sans-serif; color: #e9ecf1; background: #222733; border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px; padding: 4px 7px; cursor: pointer; text-transform: none; letter-spacing: 0; }
.chordpanel .cp-name { font: 800 26px/1.05 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ffb347; margin: 2px 0 1px; min-height: 28px; }
.chordpanel .cp-kind { color: #aab2c0; font-size: 11px; min-height: 14px; }
.chordpanel svg { display: block; width: 130px; height: 126px; margin: 2px 0 0; }
.chordpanel .cp-next { color: #c9d0dc; font-size: 12px; min-height: 16px; }
.chordpanel .cp-next b { color: #fff; }
.chordpanel .cp-note { color: #7d8696; font-size: 10.5px; font-weight: 500; margin-top: 4px; }
.chordpanel.off .cp-body { display: none; }
body.rec .chordpanel .cp-head button { display: none; }
body.rec .chordpanel { top: 84px; }
@media (max-width: 600px) { .chordpanel { width: 132px; padding: 6px 8px 8px; top: calc(var(--top-h, 0px) + 72px); } .chordpanel svg { width: 112px; height: 124px; } .chordpanel .cp-name { font-size: 24px; } }
`;

export class ChordPanel {
  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.className = 'chordpanel';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="cp-head"><span>Chord</span><button type="button" aria-pressed="true" title="Show or hide chords (C)">Hide</button></div>
      <div class="cp-body"><div class="cp-name">–</div><div class="cp-kind"></div><svg viewBox="0 0 136 132" aria-hidden="true"></svg>
      <div class="cp-next"></div><div class="cp-note">Chords are read from the melody (estimated).</div></div>`;
    document.body.appendChild(this.el);
    this.ui = { btn: this.el.querySelector('button'), name: this.el.querySelector('.cp-name'), kind: this.el.querySelector('.cp-kind'), svg: this.el.querySelector('svg'), next: this.el.querySelector('.cp-next') };
    this.segs = []; this.lib = null; this.shown = undefined; this.nextTxt = '';
    this.setOn(store.get(true));
    this.ui.btn.addEventListener('click', () => this.setOn(!this.on));
    window.addEventListener('keydown', e => {
      if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !/input|select|textarea/i.test(e.target.tagName)) this.setOn(!this.on);
    });
    this._libP = fetch('chords/chord_shapes.json').then(r => r.json()).then(j => { this.lib = j; this.shown = undefined; }).catch(e => console.warn('chord shapes', e));
  }

  setOn(on) {
    this.on = on; store.set(on);
    this.el.classList.toggle('off', !on);
    this.ui.btn.textContent = on ? 'Hide' : 'Show';
    this.ui.btn.setAttribute('aria-pressed', String(on));
  }

  /** segments from analyzeHarmony(); an empty list hides the panel */
  setSegments(segs) { this.segs = segs || []; this.shown = undefined; this.el.hidden = !this.segs.length; }

  setScore(score, events) {
    const { segs, label } = chordSource(score, events);
    this.el.querySelector('.cp-note').textContent = label;
    this.setSegments(segs);
  }

  update(T) {
    if (!this.segs.length) return;
    // current segment (binary search on t0) and the next one with a different chord
    let lo = 0, hi = this.segs.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.segs[m].t0 <= T) { i = m; lo = m + 1; } else hi = m - 1; }
    const cur = i >= 0 && T < this.segs[i].t1 + 0.05 ? this.segs[i] : null;
    const nx = this.segs[i + 1] || null;
    const key = (cur ? cur.name : '') + '|' + (this.lib ? 1 : 0);
    if (key !== this.shown) { this.shown = key; this._show(cur); }
    const nt = nx ? `next: <b>${pretty(nx.name)}</b> in ${Math.max(0, nx.t0 - T).toFixed(1)} s` : '';
    if (nt !== this.nextTxt) { this.nextTxt = nt; this.ui.next.innerHTML = nt; }
  }

  _show(seg) {
    this.ui.name.textContent = seg ? pretty(seg.name) : '–';
    const shape = seg && this.lib ? pickShape(this.lib, seg.name) : null;
    this.ui.kind.textContent = seg ? (shape ? `${KIND[shape.kind] || shape.kind}${shape.base > 1 && shape.kind !== 'open' ? ` · fret ${shape.base}` : ''}` : '') : 'no clear chord here';
    this.ui.svg.innerHTML = shape ? diagram(shape) : '';
  }
}

const KIND = { open: 'open shape', 'E-form': 'barre (E shape)', 'A-form': 'barre (A shape)', 'D-form': 'D shape', slash: 'slash chord', alt: 'shape' };
const pretty = n => n.replace('b', '♭').replace('#', '♯').replace(/maj7/, 'maj7');

/** easiest shape for a learner: open first, then the lowest movable shape with the fewest fingers */
function pickShape(lib, name) {
  const c = lib.chords[name];
  if (!c || !c.shapes || !c.shapes.length) return null;
  const fingers = s => new Set(s.fingers.filter(f => f > 0)).size;
  const score = s => (s.kind === 'open' ? 0 : 10) + s.base * 0.5 + fingers(s) * 0.3 + (s.frets.filter(f => f === 'x').length > 2 ? 3 : 0);
  return [...c.shapes].sort((a, b) => score(a) - score(b))[0];
}

/** SVG chord box: strings low E (left) to high e, 5 frets from shape.base, finger colours as in the 3D view */
function diagram(shape) {
  const W = 136, x0 = 18, x1 = W - 14, y0 = 24, fh = 18, nF = 5, sx = (x1 - x0) / 5;
  const base = shape.base > 1 && shape.kind !== 'open' ? shape.base : 1;
  const sxOf = s => x0 + s * sx;
  let g = '';
  // fret lines and nut
  for (let f = 0; f <= nF; f++) g += `<line x1="${x0}" x2="${x1}" y1="${y0 + f * fh}" y2="${y0 + f * fh}" stroke="#7d8696" stroke-width="${f === 0 && base === 1 ? 4 : 1.2}"/>`;
  for (let s = 0; s < 6; s++) g += `<line x1="${sxOf(s)}" x2="${sxOf(s)}" y1="${y0}" y2="${y0 + nF * fh}" stroke="#c9d0dc" stroke-width="${1 + (5 - s) * 0.18}"/>`;
  if (base > 1) g += `<text x="${x1 + 3}" y="${y0 + fh * 0.62}" fill="#aab2c0" font-size="11" font-weight="700">${base}</text>`;
  // barre
  if (shape.barre) {
    const fy = y0 + (shape.barre.fret - base + 0.5) * fh;
    g += `<rect x="${sxOf(shape.barre.from) - 7}" y="${fy - 7}" width="${sxOf(shape.barre.to) - sxOf(shape.barre.from) + 14}" height="14" rx="7" fill="${FINGER_CSS[0]}"/>`;
  }
  // per string: x / o above, finger dots on the board
  shape.frets.forEach((f, s) => {
    const x = sxOf(s);
    if (f === 'x') g += `<text x="${x}" y="${y0 - 8}" fill="#ef476f" font-size="13" font-weight="800" text-anchor="middle">×</text>`;
    else if (f === 0) g += `<circle cx="${x}" cy="${y0 - 12}" r="5" fill="none" stroke="#e9ecf1" stroke-width="1.6"/>`;
    else {
      const fg = shape.fingers[s] || 0;
      const inBarre = shape.barre && f === shape.barre.fret && s >= shape.barre.from && s <= shape.barre.to && fg === 1;
      if (inBarre) return;
      const y = y0 + (f - base + 0.5) * fh, col = FINGER_CSS[fg - 1] || '#e9ecf1';
      g += `<circle cx="${x}" cy="${y}" r="8" fill="${col}"/>`;
      if (fg) g += `<text x="${x}" y="${y + 4}" fill="#14161b" font-size="11" font-weight="800" text-anchor="middle">${fg}</text>`;
    }
  });
  // string names
  ['E', 'A', 'D', 'G', 'B', 'e'].forEach((n, s) => { g += `<text x="${sxOf(s)}" y="${y0 + nF * fh + 14}" fill="#7d8696" font-size="10" text-anchor="middle">${n}</text>`; });
  return g;
}
