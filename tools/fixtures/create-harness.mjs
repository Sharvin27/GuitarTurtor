// Run the actual create.html controller with local audio/model/storage doubles; no network or microphone.
import fs from 'node:fs';
import vm from 'node:vm';
import { toScore, reconcileChords, findTrim } from '../../js/songmaker.js';
import { shiftScore } from '../../js/song-audio.js';

export function createHarness({ saved = true, audioSaved = true, notes = [{ t: .2, e: .7, p: 64, a: 1 }], chords = [{ t0: 0, t1: 1, name: 'C', conf: .9 }], audio = null } = {}) {
  const elements = new Map(), songs = new Map(), blobs = new Map(), navigation = [];
  const element = () => ({ value: '', textContent: '', checked: true, hidden: false, disabled: false,
    style: {}, firstChild: { style: {} }, children: [], classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
    querySelector() { return element(); }, focus() {} });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get('offset').value = '0'; get('model').value = 'guitab';
  let recorder, calls = 0;
  const tracks = [{ stop() {} }, { stop() {} }];
  const stream = { getAudioTracks: () => tracks.slice(0, 1), getTracks: () => tracks };
  const context = vm.createContext({
    document: { getElementById: get, createElement: element }, window: {},
    navigator: { mediaDevices: { getUserMedia: async () => stream, getDisplayMedia: async () => stream } },
    MediaStream: class {}, MediaRecorder: class {
      constructor() { recorder = this; this.mimeType = 'audio/webm'; this.state = 'inactive'; }
      start() { this.state = 'recording'; this.onstart?.(); }
      stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['test recording']) }); this.done = this.onstop(); }
    },
    YTSync: class { constructor() { this.ready = true; } async load() {} pause() {} time() { return 12; } play() {} },
    Blob, Date, Math, console, URL, setTimeout, setInterval, clearInterval, performance,
    confirm: () => true, location: { assign: url => navigation.push(url) },
    UserSongs: { list: () => [...songs.values()], save(s) { if (saved) songs.set(s.id, s); return saved; }, remove(id) { return songs.delete(id); } },
    decodeAudio: async () => audio || new Float32Array(22050), findTrim,
    trimmedWav: async (blob, start, end) => new Blob([`trimmed ${start.toFixed(2)}-${end.toFixed(2)}`]),
    transcribe: async () => { calls++; return { notes, engine: 'fixture' }; },
    toScore, reconcileChords, shiftScore, loadChordShapes: async () => null,
    detectAudioChords: async () => chords,
    saveSongAudio: async (id, blob) => { if (audioSaved) blobs.set(id, blob); return audioSaved; },
    deleteSongAudio: async id => blobs.delete(id),
  });
  const src = fs.readFileSync(new URL('../../create.html', import.meta.url), 'utf8');
  new vm.Script(src.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm, '')).runInContext(context);
  return { get, songs, blobs, navigation, context, tracks, get calls() { return calls; },
    async stop(shared = false) { if (shared) tracks[1].onended(); else recorder.stop(); await recorder.done; } };
}
