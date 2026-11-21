// Learning layer for index.html: the scrolling tab strip, lesson markers on the neck, a chord/note HUD,
// the Hands on/off toggle, the "Lesson cam" preset and a clean screen-recording mode (key H).
// main.js only creates it and calls setEvents() / update(); everything else lives here.
import * as THREE from 'three';
import { TabStrip } from './tabstrip.js';
import { LessonMarkers } from './markers.js';
import { describeNotes, noteName, midiOf, STRING_LABELS } from './theory.js';
import { fretX } from './guitar.js';

const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'];
const FINGER_CSS = ['#4cc9f0', '#80ed99', '#ffd166', '#ef476f'];
const HANDS_KEY = 'guitar3d.hands';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

const CSS = `
:root { --strip-h: 184px; --bottom-h: 0px; --top-h: 0px; }
#stage { bottom: calc(var(--bottom-h) + var(--strip-h)) !important; }
.learn { position: fixed; left: 0; right: 0; bottom: var(--bottom-h); height: var(--strip-h); z-index: 2;
  background: #0d0f14; border-top: 1px solid rgba(255,255,255,0.12); display: flex; flex-direction: column; color: #e9ecf1; }
.learn-head { display: flex; align-items: center; gap: 10px; padding: 6px 12px 0; min-height: 36px; min-width: 0; }
.learn-chord { font: 750 19px/1.1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ffb347; white-space: nowrap; letter-spacing: 0.01em; }
.learn-sub { flex: 1 1 auto; min-width: 0; font-size: 12.5px; color: #aab2c0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.learn-sub b { font-weight: 650; }
.learn-tools { display: flex; gap: 6px; flex: none; }
.learn-tools button { font: 600 12px/1 system-ui, sans-serif; color: #e9ecf1; background: #222733; border: 1px solid rgba(255,255,255,0.14);
  border-radius: 7px; padding: 6px 10px; min-height: 30px; cursor: pointer; }
.learn-tools button:hover { background: #2c3240; }
.learn-tools button[aria-pressed="true"] { border-color: #ffb347; color: #ffd9a0; }
.learn-tools button:focus-visible { outline: 2px solid #ffb347; outline-offset: 1px; }
.learn canvas { flex: 1 1 auto; width: 100%; min-height: 0; display: block; cursor: pointer; touch-action: pan-y; }
.learn-hud { position: fixed; left: 16px; top: calc(var(--top-h) + 10px); z-index: 1; pointer-events: none;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6); max-width: calc(100vw - 32px); }
.learn-hud .big { font: 800 34px/1.05 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; letter-spacing: 0.01em; }
.learn-hud .small { font: 600 13px/1.35 system-ui, sans-serif; color: #d5dbe5; margin-top: 2px; }
.learn-hud .tech { display: inline-block; margin-top: 4px; font: 700 12px/1 system-ui, sans-serif; color: #14161b; background: #ffb347;
  border-radius: 5px; padding: 3px 6px; text-shadow: none; }
.learn-hud .tech:empty { display: none; }
.learn-toast { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 5; background: rgba(13,15,20,0.9); color: #e9ecf1;
  font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); transition: opacity .4s; pointer-events: none; }
body.rec #top, body.rec #bottom, body.rec .learn-tools, body.rec #loading, body.rec .ytpanel { display: none !important; }
body.rec .learn-hud { top: 14px; }
@media (max-width: 600px) {
  :root { --strip-h: 164px; }
  .learn-head { gap: 8px; padding: 5px 10px 0; }
  .learn-chord { font-size: 16px; }
  .learn-sub { display: none; }
  .learn-tools { margin-left: auto; }
  .learn-tools button { padding: 6px 8px; }
  .learn-hud .big { font-size: 24px; }
  .learn-hud .small { font-size: 12px; }
}
`;

/**
 * ctx: { guitar, camera, controls, now(), seek(t), hands() -> [left, right], pickMesh, markers (old sphere pool), resize() }
 */
export function initLearn(ctx) {
  const st = document.createElement('style');
  st.id = 'learn-css'; st.textContent = CSS;
  document.head.appendChild(st);

  const wrap = document.createElement('div');
  wrap.className = 'learn';
  wrap.innerHTML = `
    <div class="learn-head">
      <div class="learn-chord" id="learn-chord" aria-live="off">–</div>
      <div class="learn-sub" id="learn-sub"></div>
      <div class="learn-tools">
        <button id="learn-hands" aria-pressed="true" title="Show or hide the hand models (markers keep working)">Hands</button>
        <button id="learn-lesson" aria-pressed="false" title="Fixed camera framing the frets this song uses">Lesson cam</button>
        <button id="learn-rec" title="Hide the controls for screen recording (key H)">Hide UI</button>
      </div>
    </div>
    <canvas id="learn-strip" aria-label="Tab: click a note to jump to it, drag to scrub"></canvas>`;
  document.body.appendChild(wrap);
  const hud = document.createElement('div');
  hud.className = 'learn-hud';
  hud.innerHTML = '<div class="big"></div><div class="small"></div><span class="tech"></span>';
  document.body.appendChild(hud);
  const $ = id => document.getElementById(id);
  const ui = { chord: $('learn-chord'), sub: $('learn-sub'), hands: $('learn-hands'), lesson: $('learn-lesson'), rec: $('learn-rec'),
    big: hud.querySelector('.big'), small: hud.querySelector('.small'), tech: hud.querySelector('.tech') };

  const strip = new TabStrip($('learn-strip'), { seek: t => ctx.seek(t) });
  const marks = new LessonMarkers(ctx.guitar);
  window.__learnStrip = strip;   // for headless checks
  let events = [];

  // ---- layout: the 3D stage ends above the strip, which sits above the bottom bar ----
  const root = document.documentElement;
  const measure = () => {
    const b = $('bottom'), t = $('top');
    const bh = b && getComputedStyle(b).display !== 'none' ? b.getBoundingClientRect().height : 0;
    const th = t && getComputedStyle(t).display !== 'none' ? t.getBoundingClientRect().height : 0;
    root.style.setProperty('--bottom-h', bh + 'px');
    root.style.setProperty('--top-h', th + 'px');
    const sh = wrap.getBoundingClientRect().height;
    root.style.setProperty('--ytpanel-bottom', Math.round(bh + sh + 10) + 'px');
  };
  const ro = new ResizeObserver(() => { measure(); strip.layout(); ctx.resize && ctx.resize(); });
  for (const id of ['bottom', 'top', 'stage', 'learn-strip']) { const el = $(id); if (el) ro.observe(el); }
  measure();

  // ---- hands on/off ----
  let handsOn = store.get(HANDS_KEY, '1') !== '0';
  const setHands = on => {
    handsOn = on;
    ui.hands.setAttribute('aria-pressed', String(on));
    ui.hands.textContent = on ? 'Hands: on' : 'Hands: off';
    store.set(HANDS_KEY, on ? '1' : '0');
  };
  setHands(handsOn);
  ui.hands.addEventListener('click', () => { setHands(!handsOn); ui.hands.blur(); });

  // ---- lesson cam: fixed camera framing the song's fret range ----
  let lessonOn = false;
  const follow = $('follow');
  const setLesson = on => { lessonOn = on; ui.lesson.setAttribute('aria-pressed', String(on)); };
  function lessonCam() {
    const fr = [];
    for (const e of events) for (const n of e.notes) if (n.f > 0) { fr.push(n.f); if (e.bend || e.hb) fr.push(n.f); }
    const lo = fr.length ? Math.min(...fr) : 1, hi = fr.length ? Math.max(...fr) : 5;
    const xa = fretX(Math.max(0, lo - 1.7)), xb = fretX(Math.min(22.6, hi + 0.9));
    if (follow) follow.checked = false;
    const g = ctx.guitar, cam = ctx.camera;
    g.updateMatrixWorld();
    const target = g.localToWorld(new THREE.Vector3((xa + xb) / 2 + 0.01, 0, -0.022));   // a little toward the hand side + body
    const span = Math.max(0.14, (xb - xa) * 1.32);
    const vf = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
    const dist = Math.max((span / 2) / Math.tan(hf / 2), 0.1 / Math.tan(vf / 2));
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(g.matrixWorld);   // out of the fingerboard
    const bass = new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld);     // toward the low E (top of the view)
    const dir = normal.multiplyScalar(1).addScaledVector(bass, 0.22).normalize();
    ctx.controls.target.copy(target);
    cam.position.copy(target).addScaledVector(dir, dist);
    ctx.controls.update();
    setLesson(true);
  }
  ui.lesson.addEventListener('click', () => { lessonCam(); ui.lesson.blur(); });
  if (follow) follow.addEventListener('change', () => { if (follow.checked) setLesson(false); });
  for (const b of document.querySelectorAll('[id^="view-"]')) b.addEventListener('click', () => setLesson(false));

  // ---- clean recording mode (H) ----
  let toastT = null;
  const toast = msg => {
    let el = document.querySelector('.learn-toast');
    if (!el) { el = document.createElement('div'); el.className = 'learn-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  };
  const setRec = on => {
    document.body.classList.toggle('rec', on);
    measure();
    if (on) toast('Recording view: press H (or Esc) to show the controls');
  };
  ui.rec.addEventListener('click', () => { setRec(true); ui.rec.blur(); });
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setRec(!document.body.classList.contains('rec')); }
    else if (e.key === 'Escape' && document.body.classList.contains('rec')) setRec(false);
  });

  // ---- HUD text (only rebuilt when the current note changes) ----
  let shownCur = -2;
  const info = $('info'), SEP = '  ·  ♪ ';
  let infoLabel = '';
  function describe(i) {
    const e = events[i];
    if (!e) return null;
    const d = describeNotes(e.notes);
    const notes = [...e.notes].sort((a, b) => b.s - a.s);
    const parts = notes.map(n => {
      const c = n.finger ? FINGER_CSS[n.finger - 1] : '#f4f6fa';
      return `<b style="color:${c}">${STRING_LABELS[n.s]}${n.f}</b> ${noteName(midiOf(n.s, n.f))}${n.finger ? ' · ' + FINGER_NAMES[n.finger - 1] : ' · open'}`;
    });
    const tech = [e.legato === 'ham' && 'hammer-on', e.legato === 'pull' && 'pull-off', e.legato === 'slide' && 'slide in', e.slide && 'slide',
      e.bend && 'bend', e.hb && 'held bend', e.rel && 'release', e.vib && 'vibrato', e.pm && 'palm mute'].filter(Boolean);
    const bar = Number.isFinite(e._q) ? Math.floor(e._q / 4 + 1e-9) + 1 : null;
    const sec = e.sec ? e.sec.split('|').filter((x, k) => k < 2 && x).join(' · ') : '';
    return { d, parts, tech, bar, sec, single: notes.length === 1, notes };
  }
  function showCur(i) {
    shownCur = i;
    const r = describe(i);
    if (!r) { ui.chord.textContent = '–'; ui.sub.textContent = 'Click a note in the tab to jump there'; ui.big.textContent = ''; ui.small.textContent = ''; ui.tech.textContent = ''; infoLabel = ''; return; }
    const name = r.d ? r.d.name : '';
    ui.chord.textContent = name;
    ui.sub.innerHTML = `${r.parts.join('  +  ')}${r.bar ? `  <span style="opacity:.7">|  bar ${r.bar}${r.sec ? ' · ' + r.sec : ''}</span>` : ''}`;
    ui.big.textContent = name;
    const n0 = r.notes[0];
    ui.small.textContent = r.single
      ? `${STRING_LABELS[n0.s]} string · fret ${n0.f}${n0.finger ? ' · ' + FINGER_NAMES[n0.finger - 1] + ' finger' : ' · open'}`
      : r.notes.map(n => `${STRING_LABELS[n.s]}${n.f} ${noteName(midiOf(n.s, n.f))}`).join(' + ');
    ui.tech.textContent = r.tech.join(' · ');
    infoLabel = r.single ? noteName(midiOf(n0.s, n0.f)) : name;
  }

  return {
    strip, markers: marks,
    get handsOn() { return handsOn; }, setHands, lessonCam, setRec,
    setEvents(ev) {
      events = ev || [];
      strip.setEvents(events);
      marks.setEvents(events);
      shownCur = -2;
      if (lessonOn) requestAnimationFrame(lessonCam);
    },
    update(T) {
      // never break main.js's render loop
      try { this._update(T); } catch (err) { if (!this._warned) { this._warned = true; console.error('learn layer: ' + (err && err.stack || err)); } }
    },
    _update(T) {
      // our markers replace main.js's sphere markers
      if (ctx.markers) for (const m of ctx.markers) m.visible = false;
      const [L, R] = ctx.hands ? ctx.hands() : [];
      for (const h of [L, R]) if (h) { h.root.visible = handsOn; h.arm.visible = handsOn; }
      if (!handsOn && ctx.pickMesh) ctx.pickMesh.visible = false;
      strip.update(T);
      const { cur } = marks.update(T);
      // the HUD keeps the last note until the next one starts (so a student can pause and read it)
      if (cur !== shownCur) showCur(cur);
      if (info) {
        const base = info.textContent.split(SEP)[0];
        const want = infoLabel ? base + SEP + infoLabel : base;
        if (info.textContent !== want) info.textContent = want;
      }
    },
  };
}
