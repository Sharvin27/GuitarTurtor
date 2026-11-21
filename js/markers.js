// Lesson markers on the 3D neck (guitar space G, see guitar.js): target rings at the exact string+fret,
// approaching ghost rings, onset pings, technique cues (slide trail, hammer-on "H" + down pulse, pull-off "P" +
// flick, bend / held bend / release arrows, vibrato wave, pluck pulse) and static labels (string names at the
// nut and next to the hand, fret numbers along the bass edge, note names on sounding notes).
import * as THREE from 'three';
import { contactX, fretX, fbWidth, stringY, stringZ } from './guitar.js';
import { bendOffset, PLUCK_X } from './timeline.js';
import { midiOf, noteName, STRING_LABELS } from './theory.js';

export const FINGER_HEX = [0x4cc9f0, 0x80ed99, 0xffd166, 0xef476f];
const FINGER_CSS = ['#4cc9f0', '#80ed99', '#ffd166', '#ef476f'];
const OPEN_HEX = 0xf4f6fa, OPEN_CSS = '#f4f6fa';
const KEY_FRETS = new Set([1, 3, 5, 7, 9, 12, 15, 17, 19, 21]);
const AHEAD = 0.6;                     // ghost rings this many seconds ahead
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const bendText = semis => semis >= 3 ? '1½' : semis >= 2 ? 'full' : semis >= 1 ? '½' : '¼';

// ---------- text sprites ----------
const texCache = new Map();
/** parts: [[text, cssColor], ...] drawn left to right on a dark pill */
function textTexture(parts, opts = {}) {
  const key = JSON.stringify([parts, opts]);
  if (texCache.has(key)) return texCache.get(key);
  const size = 44, pad = opts.pad ?? 12, font = `${opts.weight || 700} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  c.font = font;
  const widths = parts.map(p => c.measureText(p[0]).width);
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + 2 * pad), h = size + 16;
  cv.width = w; cv.height = h;
  if (opts.bg !== null) {
    c.fillStyle = opts.bg || 'rgba(10,12,16,0.78)';
    const r = h / 2.4;
    c.beginPath(); c.moveTo(r, 0); c.arcTo(w, 0, w, h, r); c.arcTo(w, h, 0, h, r); c.arcTo(0, h, 0, 0, r); c.arcTo(0, 0, w, 0, r); c.fill();
    if (opts.border) { c.strokeStyle = opts.border; c.lineWidth = 4; c.stroke(); }
  }
  c.font = font; c.textBaseline = 'middle';
  let x = pad;
  parts.forEach((p, i) => {
    if (opts.bg === null) { c.lineWidth = 8; c.strokeStyle = 'rgba(8,9,12,0.85)'; c.strokeText(p[0], x, h / 2 + 2); }
    c.fillStyle = p[1]; c.fillText(p[0], x, h / 2 + 2); x += widths[i];
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const out = { tex, aspect: w / h };
  texCache.set(key, out);
  return out;
}
function makeSprite(height, depthTest = false) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest, depthWrite: false }));
  sp.userData.h = height;
  sp.renderOrder = 12;
  sp.visible = false;
  return sp;
}
function setSpriteText(sp, parts, opts, opacity = 1, scale = 1) {
  const t = textTexture(parts, opts);
  if (sp.material.map !== t.tex) { sp.material.map = t.tex; sp.material.needsUpdate = true; }
  const h = sp.userData.h * scale;
  sp.scale.set(h * t.aspect, h, 1);
  sp.material.opacity = opacity;
  sp.visible = opacity > 0.01;
}

// ---------- flat ribbon (polyline with width in the board plane) + optional arrow head ----------
class Ribbon {
  constructor(parent, max = 40) {
    this.max = max;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, this.mat);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.head = new THREE.Mesh(hg, this.mat);
    for (const m of [this.mesh, this.head]) { m.frustumCulled = false; m.renderOrder = 11; m.visible = false; parent.add(m); }
  }
  hide() { this.mesh.visible = this.head.visible = false; }
  /** pts: array of Vector3 (G space); width in metres */
  set(pts, width, color, opacity, head = false) {
    const n = Math.min(pts.length, this.max);
    if (n < 2 || opacity <= 0.01) { this.hide(); return; }
    const p = this.mesh.geometry.attributes.position;
    const d = new THREE.Vector3(), perp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      d.subVectors(b, a); d.y = 0;
      perp.set(-d.z, 0, d.x).normalize().multiplyScalar(width / 2);
      p.setXYZ(2 * i, pts[i].x + perp.x, pts[i].y, pts[i].z + perp.z);
      p.setXYZ(2 * i + 1, pts[i].x - perp.x, pts[i].y, pts[i].z - perp.z);
    }
    p.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
    this.mat.color.setHex(color);
    this.mat.opacity = opacity;
    this.mesh.visible = true;
    if (head) {
      const e = pts[n - 1];
      d.subVectors(e, pts[n - 2]); d.y = 0; d.normalize();
      perp.set(-d.z, 0, d.x);
      const hl = width * 2.6, hw = width * 1.9;
      const hp = this.head.geometry.attributes.position;
      hp.setXYZ(0, e.x + d.x * hl, e.y, e.z + d.z * hl);
      hp.setXYZ(1, e.x + perp.x * hw, e.y, e.z + perp.z * hw);
      hp.setXYZ(2, e.x - perp.x * hw, e.y, e.z - perp.z * hw);
      hp.needsUpdate = true;
      this.head.geometry.computeBoundingSphere();
      this.head.visible = true;
    } else this.head.visible = false;
  }
}

function pool(n, make) { const a = Array.from({ length: n }, make); a.i = 0; return a; }
function take(p) { return p.i < p.length ? p[p.i++] : null; }

export class LessonMarkers {
  constructor(guitar) {
    this.root = new THREE.Group();
    this.root.name = 'lessonMarkers';
    guitar.add(this.root);
    this.events = [];
    const ringGeo = new THREE.RingGeometry(0.0036, 0.0050, 40).rotateX(-Math.PI / 2);
    const dotGeo = new THREE.CircleGeometry(0.0021, 24).rotateX(-Math.PI / 2);
    const mk = (geo, order, depthTest = true) => () => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = order; this.root.add(m); return m;
    };
    this.rings = pool(16, mk(ringGeo, 3));
    this.dots = pool(10, mk(dotGeo, 3));
    this.pings = pool(10, mk(ringGeo, 4, false));
    this.noteLabels = pool(10, () => { const s = makeSprite(0.0082); this.root.add(s); return s; });
    this.badges = pool(6, () => { const s = makeSprite(0.0105); this.root.add(s); return s; });
    const coneGeo = new THREE.ConeGeometry(0.0021, 0.005, 14).rotateX(Math.PI);   // points down (-y)
    this.cones = pool(3, mk(coneGeo, 11, false));
    this.ribbons = pool(14, () => new Ribbon(this.root));
    this._pts = Array.from({ length: 40 }, () => new THREE.Vector3());

    // static labels: string names at the nut, fret numbers along the bass edge
    this.nutLabels = STRING_LABELS.map((name, s) => {
      const sp = makeSprite(0.0066, true);
      sp.position.set(-0.016, stringY(0) + 0.002, stringZ(s, 0));
      this.root.add(sp);
      return sp;
    });
    this.handLabels = STRING_LABELS.map(() => { const sp = makeSprite(0.006); this.root.add(sp); return sp; });
    this.handLabelX = null;
    this.fretLabels = {};
    for (let f = 1; f <= 22; f++) {
      const sp = makeSprite(0.0068, true);
      const x = (fretX(f) + fretX(f - 1)) / 2;
      sp.position.set(x, 0.002, fbWidth(x) / 2 + 0.0058);
      this.root.add(sp);
      this.fretLabels[f] = sp;
    }
    this.visible = true;
  }

  setEvents(events) { this.events = events || []; }
  setVisible(v) { this.root.visible = this.visible = v; }

  /** world position of a note's contact point at time T (follows slides and bends) */
  _notePos(e, n, T, out, idx) {
    let x = n.f > 0 ? contactX(n.f) : -0.0075;
    if (e.slide && n.f > 0 && T > e.t) {
      const nx = this.events[idx + 1], nn = nx && nx.notes.find(m => m.s === n.s && m.f > 0);
      if (nn) { const d = Math.min(e.dur, nx.t - e.t); x += (contactX(nn.f) - x) * smooth((T - (e.t + 0.3 * d)) / (0.5 * d)); }
    }
    const xs = Math.max(x, 0);
    out.set(x, stringY(xs) + 0.0005, stringZ(n.s, xs) + bendOffset(e, n, T));
    return out;
  }

  update(T) {
    const ev = this.events;
    for (const p of [this.rings, this.dots, this.pings, this.noteLabels, this.badges, this.cones, this.ribbons]) p.i = 0;
    const lit = [0, 0, 0, 0, 0, 0];
    let cur = -1;
    { let lo = 0, hi = ev.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ev[m].t <= T) { cur = m; lo = m + 1; } else hi = m - 1; } }
    const P = new THREE.Vector3();
    let upcomingEvents = 0;
    for (let j = Math.max(0, cur - 6); j < ev.length; j++) {
      const e = ev[j], age = T - e.t;
      if (age < -AHEAD) break;
      const hold = Math.max(e.dur, 0.18);
      const nextT = ev[j + 1] ? ev[j + 1].t : Infinity;
      const sounding = age >= 0 && age < hold + 0.05;
      const current = j === cur && age < Math.max(hold, Math.min(nextT - e.t, 1.2)) + 0.05;
      if (age < 0 && ++upcomingEvents > 2) break;
      if (age >= 0 && !sounding && !current) continue;
      for (const n of e.notes) {
        const col = n.finger ? FINGER_HEX[n.finger - 1] : OPEN_HEX;
        const css = n.finger ? FINGER_CSS[n.finger - 1] : OPEN_CSS;
        this._notePos(e, n, T, P, j);
        if (age < 0) {
          // ghost: a ring closing in on the target as the onset approaches
          const k = 1 + age / AHEAD;             // 0 .. 1
          const r = take(this.rings); if (!r) continue;
          r.position.copy(P); r.scale.setScalar(1 + 1.6 * (1 - k));
          r.material.color.setHex(col); r.material.opacity = 0.12 + 0.5 * k * k; r.visible = true;
          if (j === cur + 1 && k > 0.35) {
            const lb = take(this.noteLabels);
            if (lb) { lb.position.set(P.x - 0.0115, P.y + 0.003, P.z + 0.003); setSpriteText(lb, [[String(n.f), css], [' ' + noteName(midiOf(n.s, n.f)), '#e9ecf1']], {}, 0.35 * k, 0.85); }
          }
        } else {
          lit[n.s] = Math.max(lit[n.s], sounding ? 1 : 0.5);
          const fade = sounding ? 1 - 0.45 * Math.min(1, age / hold) : 0.45;
          const r = take(this.rings);
          if (r) { r.position.copy(P); r.scale.setScalar(1); r.material.color.setHex(col); r.material.opacity = 0.95 * fade; r.visible = true; }
          const d = take(this.dots);
          if (d) { d.position.copy(P); d.position.y += 0.0002; d.material.color.setHex(col); d.material.opacity = 0.9 * fade; d.visible = true; }
          if (age < 0.35) {
            const pg = take(this.pings);
            if (pg) { const u = age / 0.35; pg.position.copy(P); pg.scale.setScalar(1 + 2.2 * u); pg.material.color.setHex(col); pg.material.opacity = 0.9 * (1 - u) * (1 - u); pg.visible = true; }
          }
          const lb = take(this.noteLabels);
          if (lb) { lb.position.set(P.x - 0.0115, P.y + 0.003, P.z + 0.003); setSpriteText(lb, [[String(n.f), css], [' ' + noteName(midiOf(n.s, n.f)), '#ffffff']], { border: css }, 0.95 * Math.max(0.6, fade), 1); }
          // pluck pulse on the string at the picking position (legato notes are not picked: no pulse)
          if (!e.legato && age < 0.6) {
            const rb = take(this.ribbons);
            if (rb) {
              const pts = this._pts, x0 = PLUCK_X - 0.03, x1 = PLUCK_X + 0.03;
              for (let k = 0; k < 2; k++) { const x = k ? x1 : x0; pts[k].set(x, stringY(x) + 0.0006, stringZ(n.s, x)); }
              rb.set(pts.slice(0, 2), 0.0026, 0xffd9a0, 0.9 * Math.exp(-age / 0.22));
            }
          }
        }
      }
      this._techniques(j, e, T, age);
    }
    this._labels(T, cur, lit);
    for (const p of [this.rings, this.dots, this.pings, this.noteLabels, this.badges, this.cones]) for (let k = p.i; k < p.length; k++) p[k].visible = false;
    for (let k = this.ribbons.i; k < this.ribbons.length; k++) this.ribbons[k].hide();
    return { cur, lit };
  }

  _techniques(j, e, T, age) {
    const ev = this.events, nx = ev[j + 1], pv = ev[j - 1];
    const n0 = e.fretted[0] || e.notes[0];
    if (!n0) return;
    const col = n0.finger ? FINGER_HEX[n0.finger - 1] : OPEN_HEX, css = n0.finger ? FINGER_CSS[n0.finger - 1] : OPEN_CSS;
    const pts = this._pts;
    const pre = age < 0 ? 1 + age / AHEAD : 1;    // 0..1 while approaching

    // slide: trail along the string from the start fret to the end fret, filled as the finger glides
    if (e.slide && nx && T < nx.t + 0.3) {
      const nn = nx.notes.find(m => m.s === n0.s && m.f > 0);
      if (nn && n0.f > 0) {
        const xa = contactX(n0.f), xb = contactX(nn.f), d = Math.min(e.dur, nx.t - e.t);
        const u = age < 0 ? 0 : smooth((T - (e.t + 0.3 * d)) / (0.5 * d));
        const tail = T > nx.t ? 1 - (T - nx.t) / 0.3 : 1;
        const line = (from, to, cnt) => { for (let k = 0; k < cnt; k++) { const x = from + (to - from) * k / (cnt - 1); pts[k].set(x, stringY(x) + 0.0012, stringZ(n0.s, x)); } return pts.slice(0, cnt); };
        const rb = take(this.ribbons);
        if (rb) rb.set(line(xa, xb + Math.sign(xb - xa) * -0.004, 2), 0.0034, col, (age < 0 ? 0.35 * pre : 0.4) * tail, true);
        if (u > 0.01) { const rb2 = take(this.ribbons); if (rb2) rb2.set(line(xa, xa + (xb - xa) * u, 2), 0.0048, col, 0.95 * tail); }
        const b = take(this.badges);
        if (b) { b.position.set((xa + xb) / 2, stringY(xa) + 0.009, stringZ(n0.s, xa)); setSpriteText(b, [[xb > xa ? 'slide ↑' : 'slide ↓', css]], {}, (age < 0 ? 0.6 * pre : 0.95) * tail, 0.8); }
      }
    }

    // hammer-on: this note is hammered (previous note had ham): "H" + a downward pulse onto the target fret
    if (e.legato === 'ham' && age > -AHEAD && age < 0.3) {
      const n = e.fretted[0];
      if (n) {
        const P = this._notePos(e, n, T, new THREE.Vector3(), j);
        const c = n.finger ? FINGER_HEX[n.finger - 1] : OPEN_HEX, cs = n.finger ? FINGER_CSS[n.finger - 1] : OPEN_CSS;
        const b = take(this.badges);
        if (b) { b.position.set(P.x, P.y + 0.017, P.z); setSpriteText(b, [['H', cs]], { border: cs }, age < 0 ? 0.4 + 0.6 * pre : 1 - age / 0.3); }
        const cn = take(this.cones);
        if (cn) {
          const drop = age < -0.18 ? 0 : age < 0 ? (age + 0.18) / 0.18 : 1;
          cn.position.set(P.x, P.y + 0.012 - 0.008 * drop * drop, P.z);
          cn.material.color.setHex(c); cn.material.opacity = age < 0 ? 0.35 + 0.6 * pre : 0.95 * (1 - age / 0.3); cn.visible = true;
        }
      }
    }

    // pull-off: this note is pulled off to (previous note had pull): "P" at the source fret + flick toward the floor
    if (e.legato === 'pull' && pv && age > -AHEAD && age < 0.35) {
      const n = pv.fretted[0];
      if (n) {
        const S = this._notePos(pv, n, Math.min(T, e.t - 0.001), new THREE.Vector3(), j - 1);
        const cs = n.finger ? FINGER_CSS[n.finger - 1] : OPEN_CSS, c = n.finger ? FINGER_HEX[n.finger - 1] : OPEN_HEX;
        const b = take(this.badges);
        if (b) { b.position.set(S.x, S.y + 0.017, S.z); setSpriteText(b, [['P', cs]], { border: cs }, age < 0 ? 0.4 + 0.6 * pre : 1 - age / 0.35); }
        const u = age < -0.1 ? 0.25 : Math.min(1, 0.25 + 0.75 * (age + 0.1) / 0.2);
        const cnt = 12;
        for (let k = 0; k < cnt; k++) {
          const v = u * k / (cnt - 1);
          pts[k].set(S.x + 0.006 * Math.sin(v * Math.PI * 0.9), S.y + 0.001, S.z - 0.011 * v);
        }
        const rb = take(this.ribbons);
        if (rb) rb.set(pts.slice(0, cnt), 0.0026, c, age < 0 ? 0.35 + 0.4 * pre : 0.95 * (1 - age / 0.35), true);
      }
    }

    // bends: curved arrow pushing across the neck (toward the bass side for treble strings), held = steady, release = back
    if ((e.bend || e.hb || e.rel) && n0.f > 0 && age > -AHEAD && age < e.dur + 0.1) {
      const semis = e.hb ? e.hb - n0.f : e.bend ? e.bend - n0.f : (pv && (pv.hb || pv.bend) ? (pv.hb || pv.bend) - n0.f : 2);
      const dir = Math.sign(2.5 - n0.s) || 1;
      const L = Math.min(0.011, 0.0042 * Math.max(1, semis));
      const x0 = contactX(n0.f) + 0.008, y = stringY(x0) + 0.0016, z0 = stringZ(n0.s, x0);
      const relNow = e.rel && age > 0.4 * e.dur;
      const cnt = 14;
      const curve = (a, b) => {                 // quarter-curve like a tab bend arrow, from fraction a to b
        let m = 0;
        for (let k = 0; k < cnt; k++) {
          const v = a + (b - a) * k / (cnt - 1);
          const ang = v * Math.PI / 2;
          pts[m++].set(x0 + 0.005 * (1 - Math.cos(ang)), y, z0 + dir * L * Math.sin(ang));
        }
        return pts.slice(0, m);
      };
      const full = semis > 0 ? Math.abs(bendOffset(e, n0, T)) / (0.0026 * semis) : 0;
      const label = bendText(semis);
      const rb = take(this.ribbons), rb2 = take(this.ribbons), b = take(this.badges);
      if (relNow) {
        const u = smooth((age - 0.45 * e.dur) / (0.15 * e.dur));
        const back = [];
        for (let k = 0; k < cnt; k++) { const v = 1 - k / (cnt - 1); back.push(new THREE.Vector3(x0 + 0.009 - 0.004 * (1 - v), y, z0 + dir * L * v)); }
        if (rb) rb.set(back, 0.003, col, 0.35);
        if (rb2) rb2.set(back.slice(0, Math.max(2, Math.round(cnt * Math.max(0.15, u)))), 0.0042, col, 0.95, true);
        if (b) { b.position.set(x0 + 0.012, y + 0.006, z0 + dir * L * 0.5); setSpriteText(b, [['release', css]], {}, 0.95, 0.8); }
      } else if (e.hb) {
        if (rb) rb.set(curve(0, 1), 0.0042, col, age < 0 ? 0.3 + 0.5 * pre : 0.95, true);
        if (rb2) rb2.hide();
        if (b) { b.position.set(x0 + 0.006, y + 0.006, z0 + dir * (L + 0.005)); setSpriteText(b, [['hold ' + label, css]], {}, age < 0 ? 0.5 * pre + 0.3 : 0.95, 0.8); }
      } else if (e.bend) {
        if (rb) rb.set(curve(0, 1), 0.003, col, age < 0 ? 0.3 * pre + 0.1 : 0.3, true);
        if (rb2) { if (age >= 0 && full > 0.02) rb2.set(curve(0, Math.min(1, full)), 0.0044, col, 0.95, full > 0.97); else rb2.hide(); }
        if (b) { b.position.set(x0 + 0.006, y + 0.006, z0 + dir * (L + 0.005)); setSpriteText(b, [['bend ' + label, css]], {}, age < 0 ? 0.5 * pre + 0.3 : 0.95, 0.8); }
      } else { if (rb) rb.hide(); if (rb2) rb2.hide(); if (b) b.visible = false; }
    }

    // vibrato: a wavy glow along the string next to the fretting finger
    if (e.vib && age >= 0 && age < e.dur + 0.15) {
      const cnt = 30, xc = contactX(n0.f) + 0.012, ph = 2 * Math.PI * 6 * T;
      const zb = bendOffset(e, n0, T);
      for (let k = 0; k < cnt; k++) {
        const v = k / (cnt - 1), x = xc - 0.011 + 0.022 * v;
        pts[k].set(x, stringY(x) + 0.0014, stringZ(n0.s, x) + zb + 0.0013 * Math.sin(v * 2 * Math.PI * 2.5 - ph) * Math.sin(v * Math.PI));
      }
      const rb = take(this.ribbons);
      if (rb) rb.set(pts.slice(0, cnt), 0.0024, col, 0.9 * Math.min(1, (e.dur + 0.15 - age) / 0.2));
      const b = take(this.badges);
      if (b) { b.position.set(xc + 0.006, stringY(xc) + 0.009, stringZ(n0.s, xc) + zb); setSpriteText(b, [['vib ~', css]], {}, 0.85, 0.75); }
    }
  }

  _labels(T, cur, lit) {
    const ev = this.events;
    for (let s = 0; s < 6; s++) {
      const on = lit[s] > 0;
      setSpriteText(this.nutLabels[s], [[STRING_LABELS[s], on ? '#ffb347' : '#c9d0dc']], { bg: null }, on ? 1 : 0.8, on ? 1.35 : 1);
    }
    // string names next to the hand: one fret toward the nut from the hand window (smoothed)
    const e = ev[Math.max(0, cur)] || ev[0];
    const pos = e ? e.pos : 1;
    const target = pos > 2 ? (fretX(pos - 1) + fretX(pos - 2)) / 2 : null;
    if (target === null) this.handLabelX = null;
    else this.handLabelX = this.handLabelX === null ? target : this.handLabelX + (target - this.handLabelX) * 0.12;
    for (let s = 0; s < 6; s++) {
      const sp = this.handLabels[s];
      if (this.handLabelX === null) { sp.visible = false; continue; }
      const x = this.handLabelX, on = lit[s] > 0;
      sp.position.set(x, stringY(x) + 0.0028, stringZ(s, x));
      setSpriteText(sp, [[STRING_LABELS[s], on ? '#ffb347' : '#d5dbe5']], { bg: null }, on ? 1 : 0.8, on ? 1.3 : 1);
    }
    // fret numbers; frets in the current hand window are brighter, the played fret is lit
    const played = new Set();
    if (cur >= 0 && T - ev[cur].t < Math.max(ev[cur].dur, 0.25) + 0.3) for (const n of ev[cur].notes) if (n.f > 0) played.add(n.f);
    for (const [fs, sp] of Object.entries(this.fretLabels)) {
      const f = +fs, on = played.has(f), inWin = f >= pos && f <= pos + 3;
      if (!(on || inWin || KEY_FRETS.has(f))) { sp.visible = false; continue; }
      setSpriteText(sp, [[fs, on ? '#ffb347' : inWin ? '#e9ecf1' : '#9aa3b2']], { bg: null }, on ? 1 : inWin ? 0.95 : 0.7, on ? 1.3 : 1);
    }
  }
}
