// Chord consistency check: the chord NAME shown must match the DIAGRAM, the FRETTING-HAND shape, the STRUMMED strings and the
// SYNTH notes, at every stroke. Runs the real chord-mode builders (js/chordsong.js buildChordSong, js/chords-mode.js
// diagramSVG; synth.renderStrokes plays OPEN_LOW[string] + stroke.frets[k]) on
//   (a) library progressions (every common chord, shapes 0-2, several strum patterns), and
//   (b) songs detected from audio: synthetic strummed recordings -> js/audio-chords.js -> js/strumdetect.js
//       (strumForScore + strumProgression) -> buildChordSong, i.e. the "play it as recorded" path.
//   node tools/chordcheck.mjs            (exit code 1 on any mismatch)
import fs from 'node:fs';
import { buildChordSong } from '../js/chordsong.js';
import { diagramSVG } from '../js/chords-mode.js';
import { detectAudioChords } from '../js/audio-chords.js';
import { strumForScore, strumProgression } from '../js/strumdetect.js';
import { renderCase } from './synth_guitar.mjs';
const J = f => JSON.parse(fs.readFileSync(new URL('../chords/' + f, import.meta.url)));
const lib = J('chord_shapes.json'), L = J('chord_library.json'), pats = J('strum_patterns.json');
const pat = id => pats.strum.find(p => p.id === id);
const OPEN_LOW = [40, 45, 50, 55, 59, 64], isX = f => f === 'x' || f === -1 || f == null;
let checks = 0; const fails = [];
const bad = (ctx, msg) => fails.push(ctx + ': ' + msg);

function chordPcs(sym) {
  const c = L.chords[sym]; if (!c) return null;
  return { root: c.rootpc, pcs: new Set(L.types[c.type].intervals.map(i => (c.rootpc + i) % 12)) };
}
function verify(cs, ctx) {
  cs.chords.forEach((c, k) => {
    const where = `${ctx} chord ${k} ${c.symbol}`, fr = c.shape.frets, want = chordPcs(c.symbol);
    if (!want) return bad(where, 'symbol not in chord_library.json');
    // 1. the shape spells the named chord (all sounding notes in the chord, root present, at most one tone omitted)
    const snd = fr.map((f, s) => (isX(f) ? null : (OPEN_LOW[s] + f) % 12)).filter(p => p != null);
    checks++; if (snd.some(p => !want.pcs.has(p)) || !snd.includes(want.root) || new Set(snd).size < want.pcs.size - 1) bad(where, `shape ${fr} does not spell it`);
    // 2. fretting hand: event notes (3D order, string 0 = high e) == shape
    const ev = cs.events[k];
    checks++; if (ev.symbol !== c.symbol) bad(where, `event symbol ${ev.symbol}`);
    const evMap = new Map(ev.notes.map(n => [5 - n.s, n.f]));
    fr.forEach((f, s) => { checks++; if (isX(f) ? evMap.has(s) : evMap.get(s) !== f) bad(where, `fretting hand string ${s}: ${evMap.get(s)} vs shape ${f}`); });
    // 3. diagram (rendered SVG): open circles, mutes, fretted dots match the shape
    const svg = diagramSVG(c), open = (svg.match(/fill="none"/g) || []).length, mutes = (svg.match(/<path /g) || []).length;
    checks++; if (open !== fr.filter(f => f === 0).length || mutes !== fr.filter(isX).length) bad(where, `diagram open ${open} mutes ${mutes} vs shape ${fr}`);
    c.notes.forEach(n => { checks++; if (fr[5 - n.s] !== n.f) bad(where, `diagram note s${n.s} f${n.f} vs shape ${fr}`); });
  });
  // 4. strokes: each strums only strings the CURRENT chord's shape sounds, with the shape's frets; synth pitches in the chord
  for (const st of cs.strokes) {
    const c = cs.chords[st.chord], where = `${ctx} stroke t=${st.t.toFixed(2)} ${c.symbol}`, want = chordPcs(c.symbol);
    checks++; if (!(st.t >= c.t0 - 0.03 && st.t < c.t1)) bad(where, `outside its chord's time ${c.t0}-${c.t1}`);
    st.strings.forEach((s, i) => {
      checks += 2;
      if (isX(c.shape.frets[s]) || st.frets[i] !== c.shape.frets[s]) bad(where, `string ${s} fret ${st.frets[i]} vs shape ${c.shape.frets}`);
      if (!want.pcs.has((OPEN_LOW[s] + st.frets[i]) % 12)) bad(where, `synth note ${OPEN_LOW[s] + st.frets[i]} not in ${c.symbol}`);
    });
  }
}

// (a) library progressions
const SYMS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'F#m', 'Bb', 'Eb', 'Ab', 'Db',
  'A7', 'B7', 'C7', 'D7', 'E7', 'G7', 'Am7', 'Dm7', 'Em7', 'Cmaj7', 'Fmaj7', 'Gmaj7', 'Dsus2', 'Dsus4', 'Asus2', 'Asus4', 'Esus4', 'E5', 'A5', 'Bdim', 'Caug'];
let songs = 0;
for (const id of ['basic', 'folk', 'funk16', 'waltz', 'shuffle', 'pop'])
  for (let si = 0; si < 3; si++) {
    const prog = SYMS.filter(s => lib.chords[s]).map(s => ({ symbol: s, shape: lib.chords[s].shapes[Math.min(si, lib.chords[s].shapes.length - 1)], bars: 1 }));
    verify(buildChordSong(prog, pat(id), 100, { patterns: pats }), `lib ${id} shape${si}`); songs++;
  }
// (b) detected from audio
for (const [pattern, bpm, prog] of [['basic', 90, ['G', 'D', 'Em', 'C']], ['folk', 100, ['Am', 'F', 'C', 'G']], ['down8', 110, ['D', 'A', 'Bm', 'G']], ['pop', 100, ['E', 'A', 'E7', 'A']]]) {
  const { y } = renderCase({ pattern, bpm, prog, loops: 2, seed: 7 });
  const chords = await detectAudioChords(y), strum = strumForScore(y, chords, pats), sp = strumProgression(chords, strum, lib);
  if (!sp) { bad(`audio ${pattern}`, 'no strum progression'); continue; }
  const cs = buildChordSong(sp.prog, sp.pattern, sp.bpm, { patterns: pats });
  verify(cs, `audio ${pattern}@${bpm}`); songs++;
  console.log(`audio ${pattern}@${bpm}: detected ${sp.prog.map(p => p.symbol + 'x' + p.bars).join(' ')} | pattern ${sp.pattern.id} @ ${sp.bpm} bpm`);
}
console.log(`${songs} chord songs, ${checks} checks, ${fails.length} mismatches`);
fails.slice(0, 30).forEach(f => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
