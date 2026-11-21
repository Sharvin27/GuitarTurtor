// Chords practice mode: pick a progression + strum pattern + tempo; the page builds a chord "song"
// (js/chordsong.js: fretting-hand events, strokes, strum path), renders its sound (synth.renderStrokes) and
// shows the teaching UI: big chord name, chord diagrams (now / next), the strum pattern as an arrow strip with a
// moving playhead and the count (1 & 2 & ...). main.js only creates it, calls update() every frame and loads
// the song it builds; the hands, strings and audio are driven by the page's normal clock.
import { buildChordSong, canonicalSymbol, shapesOf, LEAD_IN } from './chordsong.js';
import { renderStrokes } from './synth.js';

const FINGER_CSS = ['#4cc9f0', '#80ed99', '#ffd166', '#ef476f'];
const PRESETS = [
  { id: 'g-d-em-c', name: 'G – D – Em – C  (pop/folk)', chords: 'G D Em C', bars: 2 },
  { id: 'c-g-am-f', name: 'C – G – Am – F  (I V vi IV)', chords: 'C G Am F', bars: 2 },
  { id: 'am-f-c-g', name: 'Am – F – C – G  (vi IV I V)', chords: 'Am F C G', bars: 2 },
  { id: 'em-c-g-d', name: 'Em – C – G – D', chords: 'Em C G D', bars: 2 },
  { id: 'e-a-b7', name: 'E – A – B7  (rock/blues)', chords: 'E A B7', bars: 2 },
  { id: 'blues-a', name: '12-bar blues in A', chords: 'A7 A7 A7 A7 D7 D7 A7 A7 E7 D7 A7 E7', bars: 1 },
];
const CSS = `
.cp { position: fixed; z-index: 3; top: calc(var(--top-h, 0px) + 8px); left: 8px; width: min(344px, calc(100vw - 16px)); pointer-events: none;
  display: flex; flex-direction: column; gap: 6px; color: #e9ecf1; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
.cp[hidden] { display: none; }
.cp > * { pointer-events: auto; }
.cp-card { background: rgba(13,15,20,0.84); border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; backdrop-filter: blur(6px); }
.cp-now { display: flex; align-items: stretch; gap: 8px; padding: 8px 10px; }
.cp-left { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
.cp-name { font: 800 54px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; letter-spacing: 0.01em; }
.cp-name.soon { color: #ffb347; }
.cp-nextname { color: #aab2c0; font-size: 13px; }
.cp-nextname b { color: #ffd9a0; font-size: 16px; }
.cp-dias { display: flex; gap: 6px; flex: none; }
.cp-dia { display: flex; flex-direction: column; align-items: center; font-size: 11px; color: #aab2c0; }
.cp-dia svg { display: block; width: 96px; height: 120px; color: #cfd5e0; }
.cp-dia.next { opacity: 0.8; } .cp-dia.next svg { width: 76px; height: 95px; margin-top: 25px; }
.cp-btns { display: flex; gap: 6px; }
.cp button, .cp select, .cp input[type=text], .cp input:not([type]) { font: 600 12.5px/1 system-ui, sans-serif; color: #e9ecf1; background: #222733; border: 1px solid rgba(255,255,255,0.16);
  border-radius: 7px; padding: 7px 9px; min-height: 32px; }
.cp button { cursor: pointer; } .cp button:hover { background: #2c3240; }
.cp button[aria-pressed="true"] { border-color: #ffb347; color: #ffd9a0; }
.cp-set { padding: 8px 10px; display: grid; gap: 7px; max-height: calc(100vh - var(--top-h, 0px) - var(--bottom-h, 0px) - var(--strip-h, 184px) - 178px); overflow: auto; }
.cp-set[hidden] { display: none; }
.cp-set label { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 6px; color: #aab2c0; }
.cp-set label.chk { grid-template-columns: auto auto; justify-content: start; gap: 6px; }
.cp-set select, .cp-set input[type=text], .cp-set input:not([type]) { width: 100%; min-width: 0; }
.cp-set input[type=range] { width: 100%; accent-color: #ffb347; }
.cp-row { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.cp-shapes { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-shapes select { width: auto; max-width: 150px; padding: 4px 6px; min-height: 28px; font-weight: 500; }
.cp-msg { color: #ef476f; min-height: 1.2em; font-size: 12px; }
.cp-hint { color: #8a93a3; font-size: 11.5px; }
#cp-strip { position: absolute; left: 0; right: 0; bottom: 0; top: var(--cp-head, 42px); width: 100%; height: calc(100% - var(--cp-head, 42px));
  background: #0d0f14; z-index: 1; display: none; touch-action: pan-y; }
body.chords #cp-strip { display: block; }
body.chords .learn-hud, body.chords .learn-sub, body.chords #info { display: none !important; }
@media (max-width: 700px) {
  .cp { width: auto; right: 8px; }
  .cp-name { font-size: 40px; }
  .cp-dia svg { width: 72px; height: 90px; } .cp-dia.next svg { width: 58px; height: 72px; margin-top: 18px; }
  .cp-set { max-height: 52vh; } .cp-set label { grid-template-columns: 78px 1fr; }
}`;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

/** chord diagram as inline SVG. notes: {s (0=high e), f, finger}, muted: 3D string indices, barre: {fret, strings} */
export function diagramSVG(c) {
  const X0 = 20, DX = 16, Y0 = 32, DY = 22, NF = 5;
  const col = s => 5 - s;                                     // low E on the left
  const fretted = c.notes.filter(n => n.f > 0);
  const maxF = fretted.length ? Math.max(...fretted.map(n => n.f)) : 0, minF = fretted.length ? Math.min(...fretted.map(n => n.f)) : 1;
  const base = maxF <= NF ? 1 : minF;
  let g = '';
  for (let i = 0; i < 6; i++) g += `<line x1="${X0 + i * DX}" y1="${Y0}" x2="${X0 + i * DX}" y2="${Y0 + NF * DY}" stroke="currentColor" stroke-width="${1.2 + (5 - i) * 0.12}" opacity="0.85"/>`;
  for (let r = 0; r <= NF; r++) g += `<line x1="${X0}" y1="${Y0 + r * DY}" x2="${X0 + 5 * DX}" y2="${Y0 + r * DY}" stroke="currentColor" stroke-width="${r === 0 && base === 1 ? 4 : 1}" opacity="${r === 0 && base === 1 ? 1 : 0.6}"/>`;
  if (base > 1) g += `<text x="${X0 + 5 * DX + 6}" y="${Y0 + DY * 0.65}" font-size="11" fill="currentColor">${base}fr</text>`;
  for (const n of c.notes) if (n.f === 0) g += `<circle cx="${X0 + col(n.s) * DX}" cy="${Y0 - 11}" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
  for (const s of c.muted) { const x = X0 + col(s) * DX, y = Y0 - 11; g += `<path d="M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}" stroke="#ef476f" stroke-width="1.8" stroke-linecap="round"/>`; }
  if (c.barre) {
    const xs = c.barre.strings.map(col), x1 = X0 + Math.min(...xs) * DX - 8, x2 = X0 + Math.max(...xs) * DX + 8, y = Y0 + (c.barre.fret - base + 0.5) * DY;
    g += `<rect x="${x1}" y="${y - 7.5}" width="${x2 - x1}" height="15" rx="7.5" fill="${FINGER_CSS[0]}" opacity="0.92"/>`;
  }
  for (const n of fretted) {
    const cx = X0 + col(n.s) * DX, cy = Y0 + (n.f - base + 0.5) * DY;
    const isBar = c.barre && c.barre.strings.includes(n.s) && n.finger === 1;
    if (!isBar || n.s === c.barre.tip) g += `<circle cx="${cx}" cy="${cy}" r="8" fill="${FINGER_CSS[(n.finger || 1) - 1]}"/>`;
    g += `<text x="${cx}" y="${cy + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#14161b">${n.finger || ''}</text>`;
  }
  return `<svg viewBox="0 0 132 ${Y0 + NF * DY + 6}" role="img" aria-label="chord diagram">${g}</svg>`;
}

/** count syllable for step i of a pattern */
export function countLabel(p, i) {
  if (p.time_sig === '6/8') return i % 3 === 0 ? String(i / 3 + 1) : i % 3 === 1 ? 'la' : 'li';
  const b = i * p.step_beats, w = Math.floor(b + 1e-6), f = b - w;
  if (f < 1e-3) return String(w + 1);
  if (Math.abs(f - 0.5) < 1e-3) return '&';
  if (Math.abs(f - 0.25) < 1e-3) return 'e';
  if (Math.abs(f - 0.75) < 1e-3) return 'a';
  return f < 0.5 ? 'tr' : 'let';
}

export function initChords(ctx) {
  const st = document.createElement('style');
  st.textContent = CSS; document.head.appendChild(st);

  const state = { chords: store.get('g3d.chords', 'G D Em C'), bars: +store.get('g3d.chords.bars', 2), shapeIdx: {}, pattern: store.get('g3d.chords.pattern', 'basic'),
    bpm: +store.get('g3d.chords.bpm', 90), sound: 'clean', hand: 'pick', click: false, loop: true, palm: false };
  let lib = null, pats = null, patById = {}, active = false, song = null, buildTok = 0, timer = null, loadingData = null;
  let curChord = -2, nextChord = -2;

  const panel = document.createElement('div');
  panel.className = 'cp'; panel.hidden = true;
  panel.innerHTML = `
    <div class="cp-card cp-now">
      <div class="cp-left">
        <div><div class="cp-name" id="cp-name">–</div><div class="cp-nextname" id="cp-next"></div></div>
        <div class="cp-btns"><button id="cp-play" aria-pressed="false">Play</button><button id="cp-setup" aria-expanded="false">Setup</button></div>
      </div>
      <div class="cp-dias"><div class="cp-dia" id="cp-dia-cur"></div><div class="cp-dia next" id="cp-dia-next"></div></div>
    </div>
    <div class="cp-card cp-set" id="cp-set" hidden>
      <label>Progression <select id="cp-preset"></select></label>
      <label>Chords <input id="cp-chords" list="cp-symbols" autocomplete="off" spellcheck="false" placeholder="G D Em C" aria-label="Chord symbols separated by spaces"></label>
      <datalist id="cp-symbols"></datalist>
      <div class="cp-msg" id="cp-msg" role="status"></div>
      <div class="cp-shapes" id="cp-shapes" aria-label="Chord shapes"></div>
      <label>Strum pattern <select id="cp-pattern"></select></label>
      <div class="cp-hint" id="cp-pdesc"></div>
      <label>Tempo <span><input type="range" id="cp-bpm" min="40" max="180" step="1"> <output id="cp-bpm-out"></output> bpm</span></label>
      <label>Bars / chord <select id="cp-bars"><option>1</option><option>2</option><option>4</option></select></label>
      <label>Sound <select id="cp-sound"><option value="clean">Clean acoustic</option><option value="pick">Electric (distorted)</option></select></label>
      <label>Strumming hand <select id="cp-hand"><option value="pick">Pick</option><option value="fingers">Fingers</option></select></label>
      <div class="cp-row">
        <label class="chk"><input type="checkbox" id="cp-click"> Metronome</label>
        <label class="chk"><input type="checkbox" id="cp-loop" checked> Loop</label>
        <label class="chk"><input type="checkbox" id="cp-palm"> Palm mute</label>
      </div>
    </div>`;
  document.body.appendChild(panel);
  const $ = id => panel.querySelector('#' + id);
  const learnWrap = document.querySelector('.learn');
  const canvas = document.createElement('canvas');
  canvas.id = 'cp-strip'; canvas.setAttribute('aria-label', 'Strum pattern: arrows with count and moving playhead');
  if (learnWrap) learnWrap.appendChild(canvas);
  const g2 = canvas.getContext('2d');
  const modeBtn = document.getElementById('mode-chords');

  // ---------- data ----------
  function ensureData() {
    if (!loadingData) loadingData = Promise.all([fetch('chords/chord_shapes.json').then(r => r.json()), fetch('chords/strum_patterns.json').then(r => r.json())]).then(([l, p]) => {
      lib = l; pats = p;
      for (const x of [...p.strum, ...p.pick]) patById[x.id] = x;
      const dl = $('cp-symbols'); dl.innerHTML = Object.keys(l.chords).map(k => `<option value="${k}">`).join('');
      $('cp-preset').innerHTML = PRESETS.map(x => `<option value="${x.id}">${x.name}</option>`).join('') + '<option value="custom">Your own chords…</option>';
      const stars = d => '★'.repeat(d) + '☆'.repeat(Math.max(0, 4 - d));
      const opt = x => `<option value="${x.id}">${x.name} · ${stars(x.difficulty)}</option>`;
      $('cp-pattern').innerHTML = `<optgroup label="Strumming">${p.strum.map(opt).join('')}</optgroup><optgroup label="Fingerpicking">${p.pick.map(opt).join('')}</optgroup>`;
      if (!patById[state.pattern]) state.pattern = 'basic';
      syncControls();
    });
    return loadingData;
  }
  function syncControls() {
    $('cp-chords').value = state.chords;
    const pr = PRESETS.find(x => x.chords === state.chords.trim().replace(/\s+/g, ' '));
    $('cp-preset').value = pr ? pr.id : 'custom';
    $('cp-pattern').value = state.pattern; $('cp-bpm').value = state.bpm; $('cp-bpm-out').textContent = state.bpm;
    $('cp-bars').value = String(state.bars); $('cp-sound').value = state.sound; $('cp-hand').value = state.hand;
    $('cp-click').checked = state.click; $('cp-loop').checked = state.loop; $('cp-palm').checked = state.palm;
    const p = patById[state.pattern];
    if (p) $('cp-pdesc').textContent = `${p.description || ''} (${p.time_sig}, typical ${p.bpm[0]}–${p.bpm[1]} bpm${p.songs && p.songs.length ? '; e.g. ' + p.songs[0] : ''})`;
  }
  const parseChords = txt => txt.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 16);

  // ---------- build ----------
  function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 140); }
  async function rebuild() {
    if (!active || !lib) return;
    const my = ++buildTok;
    const syms = parseChords(state.chords);
    const msg = $('cp-msg');
    const bad = syms.filter(s => !shapesOf(lib, s).length);
    if (!syms.length || bad.length) { msg.textContent = syms.length ? `Unknown chord: ${bad.join(', ')}` : 'Type some chords, e.g. G D Em C'; return; }
    msg.textContent = '';
    const pattern = patById[state.pattern];
    const prog = syms.map((s, i) => { const sh = shapesOf(lib, s); return { symbol: canonicalSymbol(s), shape: sh[state.shapeIdx[i] < sh.length ? state.shapeIdx[i] | 0 : 0], bars: state.bars }; });
    drawShapePickers(syms);
    const cs = buildChordSong(prog, pattern, state.bpm, { patterns: pats, strumHand: state.hand, palmMute: state.palm });
    cs.label = `Chords ${syms.join(' ')} · ${pattern.name} · ${state.bpm} bpm`;
    cs.renderAudio = () => renderStrokes(cs.strokes, state.sound, cs.total + 2.2, { click: state.click ? { bpm: state.bpm, beatsPerBar: pattern.beats_per_bar, startT: LEAD_IN } : null });
    song = cs; curChord = nextChord = -2;
    store.set('g3d.chords', state.chords); store.set('g3d.chords.bars', state.bars); store.set('g3d.chords.pattern', state.pattern); store.set('g3d.chords.bpm', state.bpm);
    if (my !== buildTok) return;
    await ctx.load(cs);
  }
  function drawShapePickers(syms) {
    const box = $('cp-shapes');
    box.innerHTML = syms.map((s, i) => {
      const sh = shapesOf(lib, s);
      if (sh.length < 2) return '';
      return `<select data-i="${i}" aria-label="Shape for ${s}">${sh.map((x, k) => `<option value="${k}"${(state.shapeIdx[i] | 0) === k ? ' selected' : ''}>${s}: ${x.frets.map(f => f === 'x' ? 'x' : f).join(' ')}</option>`).join('')}</select>`;
    }).join('');
  }

  // ---------- controls ----------
  $('cp-preset').addEventListener('change', e => {
    const p = PRESETS.find(x => x.id === e.target.value);
    if (p) { state.chords = p.chords; state.bars = p.bars; state.shapeIdx = {}; syncControls(); schedule(); } else $('cp-chords').focus();
  });
  $('cp-chords').addEventListener('input', e => { state.chords = e.target.value; state.shapeIdx = {}; schedule(); });
  $('cp-shapes').addEventListener('change', e => { state.shapeIdx[+e.target.dataset.i] = +e.target.value; schedule(); });
  $('cp-pattern').addEventListener('change', e => {
    state.pattern = e.target.value; const p = patById[state.pattern];
    state.bpm = clamp(state.bpm, p.bpm[0], p.bpm[1]); syncControls(); schedule();
  });
  $('cp-bpm').addEventListener('input', e => { $('cp-bpm-out').textContent = e.target.value; });
  $('cp-bpm').addEventListener('change', e => { state.bpm = +e.target.value; schedule(); });
  $('cp-bars').addEventListener('change', e => { state.bars = +e.target.value; schedule(); });
  $('cp-sound').addEventListener('change', e => { state.sound = e.target.value; schedule(); });
  $('cp-hand').addEventListener('change', e => { state.hand = e.target.value; schedule(); });
  $('cp-click').addEventListener('change', e => { state.click = e.target.checked; schedule(); });
  $('cp-loop').addEventListener('change', e => { state.loop = e.target.checked; });
  $('cp-palm').addEventListener('change', e => { state.palm = e.target.checked; schedule(); });
  $('cp-play').addEventListener('click', () => { ctx.setPlaying(!ctx.isPlaying()); $('cp-play').blur(); });
  $('cp-setup').addEventListener('click', () => { const set = $('cp-set'); set.hidden = !set.hidden; $('cp-setup').setAttribute('aria-expanded', String(!set.hidden)); ctx.resize && ctx.resize(); });
  if (modeBtn) modeBtn.addEventListener('click', () => { if (active) { deactivate(); ctx.restore(); } else activate(); modeBtn.blur(); });

  async function activate() {
    if (active) return;
    await ensureData();
    active = true;
    document.body.classList.add('chords');
    panel.hidden = false;
    if (modeBtn) { modeBtn.setAttribute('aria-pressed', 'true'); modeBtn.textContent = 'Chords: on'; }
    const set = $('cp-set');
    if (window.innerWidth > 700 && set.hidden) { set.hidden = false; $('cp-setup').setAttribute('aria-expanded', 'true'); }
    syncControls();
    const h = document.querySelector('.learn-head'); if (h) document.documentElement.style.setProperty('--cp-head', h.offsetHeight + 'px');
    await rebuild();
  }
  function deactivate() {
    if (!active) return;
    active = false; buildTok++; song = null; curChord = -2;
    document.body.classList.remove('chords');
    panel.hidden = true;
    if (modeBtn) { modeBtn.setAttribute('aria-pressed', 'false'); modeBtn.textContent = 'Chords'; }
  }

  // ---------- per-frame teaching UI ----------
  const chordAt = T => { let k = 0; song.chords.forEach((c, i) => { if (T >= c.t0 - 1e-6) k = i; }); return k; };
  function showChord(k) {
    const c = song.chords, n = c.length;
    curChord = k;
    $('cp-name').textContent = c[k].symbol;
    $('cp-dia-cur').innerHTML = diagramSVG(c[k]) + '<span>now</span>';
    const nx = state.loop ? (k + 1) % n : k + 1 < n ? k + 1 : -1;
    nextChord = nx;
    $('cp-next').innerHTML = nx >= 0 ? `next: <b>${c[nx].symbol}</b>` : 'last chord';
    $('cp-dia-next').innerHTML = nx >= 0 ? diagramSVG(c[nx]) + '<span>next</span>' : '';
  }
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g2.setTransform(canvas.width / Math.max(1, w), 0, 0, canvas.height / Math.max(1, h), 0, 0);
    return [w, h];
  }
  function arrow(x, cy, dir, size, color, alpha, lw) {
    const L = size, hw = size * 0.52, tip = cy + dir * L, tail = cy - dir * L;
    g2.globalAlpha = alpha; g2.strokeStyle = color; g2.fillStyle = color; g2.lineWidth = lw; g2.lineCap = 'round';
    g2.beginPath(); g2.moveTo(x, tail); g2.lineTo(x, tip - dir * hw * 0.9); g2.stroke();
    g2.beginPath(); g2.moveTo(x, tip); g2.lineTo(x - hw, tip - dir * hw * 1.25); g2.lineTo(x + hw, tip - dir * hw * 1.25); g2.closePath(); g2.fill();
    g2.globalAlpha = 1;
  }
  function drawStrip(T) {
    const [W, H] = fitCanvas();
    if (!W || !song) return;
    const p = song.pattern, isPick = p.type === 'pick';
    const toks = isPick ? p.steps : p.grid.split(/\s+/), N = toks.length;
    const barDur = song.barDur, tb = T - song.startT;
    const frac = tb < 0 ? 0 : (tb % barDur) / barDur, stepNow = tb < 0 ? -1 : Math.floor(frac * N + 1e-9), barNo = Math.floor(Math.max(0, tb) / barDur);
    const k = chordAt(T), c = song.chords[k];
    g2.fillStyle = '#0d0f14'; g2.fillRect(0, 0, W, H);
    const pad = 16, wStep = (W - 2 * pad) / N, xs = i => pad + (i + 0.5) * wStep;
    const small = H < 110;
    const top = small ? 20 : 26, bot = small ? 24 : 30, cy = top + (H - top - bot) / 2, size = Math.min(wStep * 0.4, (H - top - bot) * 0.36);
    // header: chord, bar of chord, beats to the change
    g2.font = '700 13px system-ui, sans-serif'; g2.textBaseline = 'middle'; g2.textAlign = 'left';
    g2.fillStyle = '#ffb347'; g2.fillText(c.symbol, pad, 12);
    const barInChord = clamp(Math.floor((Math.max(0, T - c.t0)) / barDur) + 1, 1, c.bars);
    g2.fillStyle = '#aab2c0'; g2.font = '12px system-ui, sans-serif';
    g2.fillText(`bar ${barInChord}/${c.bars}${tb < 0 ? '  ·  count in' : ''}`, pad + 8 + g2.measureText(c.symbol).width + 4, 12);
    g2.textAlign = 'right'; g2.fillText(`${p.name} · ${state.bpm} bpm`, W - pad, 12); g2.textAlign = 'left';
    // current step band
    if (stepNow >= 0) {
      const tn = (frac * N) - stepNow;
      g2.fillStyle = `rgba(255,179,71,${0.16 + 0.14 * (1 - tn)})`;
      g2.beginPath(); g2.roundRect(pad + stepNow * wStep + 2, top - 4, wStep - 4, H - top - bot + 18, 6); g2.fill();
    }
    toks.forEach((raw, i) => {
      const x = xs(i);
      const played = stepNow >= 0 && i < stepNow, isNow = i === stepNow;
      const alpha = isNow ? 1 : played ? 0.9 : 0.62;
      if (isPick) {
        g2.globalAlpha = alpha; g2.fillStyle = raw.startsWith('p') ? '#ffb347' : '#4cc9f0';
        g2.beginPath(); g2.roundRect(x - wStep * 0.34, cy - size * 0.55, wStep * 0.68, size * 1.1, 6); g2.fill();
        g2.fillStyle = '#14161b'; g2.font = `800 ${Math.min(16, wStep * 0.36)}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.fillText(raw.replace('2', '').replace(/\+/g, '+'), x, cy + 1); g2.globalAlpha = 1;
        return;
      }
      const m = /^([DUdux-])(>?)(p?)$/.exec(raw);
      if (!m || m[1] === '-') { g2.fillStyle = '#4a5160'; g2.beginPath(); g2.arc(x, cy, 2.5, 0, 7); g2.fill(); return; }
      const [, ch, acc, pm] = m;
      if (ch === 'x') {
        g2.globalAlpha = alpha; g2.strokeStyle = '#9aa3b2'; g2.lineWidth = 3; g2.lineCap = 'round';
        const r = size * 0.45; g2.beginPath(); g2.moveTo(x - r, cy - r); g2.lineTo(x + r, cy + r); g2.moveTo(x + r, cy - r); g2.lineTo(x - r, cy + r); g2.stroke(); g2.globalAlpha = 1;
        return;
      }
      const dir = ch.toUpperCase() === 'D' ? 1 : -1, light = ch === 'd' || ch === 'u';
      const color = pm ? '#80ed99' : dir > 0 ? '#ffb347' : '#4cc9f0';
      arrow(x, cy, dir, size * (acc ? 1.1 : light ? 0.68 : 0.88), color, alpha * (light ? 0.75 : 1), acc ? 5 : light ? 2.2 : 3.4);
      if (acc) { g2.fillStyle = '#fff'; g2.font = '800 11px system-ui, sans-serif'; g2.textAlign = 'center'; g2.fillText('>', x, cy - size * 1.3 + 2); }
      if (pm) { g2.fillStyle = '#80ed99'; g2.font = '700 10px system-ui, sans-serif'; g2.textAlign = 'center'; g2.fillText('PM', x, cy - size * 1.2 + 2); }
    });
    // count row
    g2.textAlign = 'center';
    toks.forEach((_, i) => {
      const lab = countLabel(p, i), isNum = /^\d$/.test(lab), isNow = i === stepNow;
      g2.fillStyle = isNow ? '#fff' : isNum ? '#e9ecf1' : '#8a93a3';
      g2.font = `${isNow || isNum ? 800 : 600} ${isNow ? (small ? 16 : 19) : (small ? 13 : 15)}px system-ui, sans-serif`;
      g2.fillText(lab, xs(i), H - bot / 2 + 2);
    });
    // playhead
    if (tb >= 0) { const x = pad + frac * (W - 2 * pad); g2.strokeStyle = '#fff'; g2.globalAlpha = 0.85; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(x, top - 6); g2.lineTo(x, H - bot + 8); g2.stroke(); g2.globalAlpha = 1; }
    g2.textAlign = 'left';
  }

  return {
    activate, deactivate, get active() { return active; }, state, get song() { return song; }, get ready() { return !!lib; },
    update(T) {
      if (!active || !song) return;
      try {
        if (ctx.isPlaying() && T >= song.total - 0.004) {       // end of the progression: loop (back to the first stroke) or stop
          if (state.loop) ctx.seek(song.startT); else { ctx.setPlaying(false); ctx.seek(0); }
        }
        const k = chordAt(T);
        if (k !== curChord) showChord(k);
        const c = song.chords[k], beat = 60 / state.bpm;
        $('cp-name').classList.toggle('soon', c.t1 - T < 1.0 * beat && c.t1 - T > 0);
        const pl = ctx.isPlaying(), btn = $('cp-play');
        if (btn.getAttribute('aria-pressed') !== String(pl)) { btn.setAttribute('aria-pressed', String(pl)); btn.textContent = pl ? 'Pause' : 'Play'; }
        drawStrip(T);
      } catch (err) { if (!this._warned) { this._warned = true; console.error('chords mode: ' + (err && err.stack || err)); } }
    },
  };
}
