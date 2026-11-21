// Cache-busting for GitHub Pages (which serves every file with max-age=600): gives every local script a
// content hash, so after a push browsers fetch exactly the files that changed and keep the rest cached.
//
//   node tools/stamp.mjs        (or: npm run stamp)  - run before committing changes to js/*.js
//
// In index.html, tabs.html and create.html it
//  - adds "./js/<file>.js": "./js/<file>.js?v=<hash>" to the import map for every module in js/, so the
//    relative imports between modules (./guitar.js, ./hand.js, ...) also resolve to the hashed URLs
//  - adds ?v=<hash> to <script src="js/..."> tags (classic scripts and the module entry point)
//  - writes <link rel="modulepreload"> for the entry point's whole local import graph plus three.js, so the
//    browser downloads all modules in parallel instead of discovering them one import at a time
// Running it twice is harmless: unchanged files keep their hash.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
const PAGES = ['index.html', 'tabs.html', 'create.html'];
const THREE_PRELOAD = [   // what main.js pulls from the CDN (three r160)
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
];

// hash the text with LF line endings, so Windows (CRLF checkout) and macOS/Linux get the same hash
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 10);
const files = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
const H = Object.fromEntries(files.map(f => [f, hash(path.join(JS, f))]));
const isModule = f => /^\s*(import|export)\s/m.test(fs.readFileSync(path.join(JS, f), 'utf8'));
const modules = files.filter(isModule);

// local static import graph of a module (relative './x.js' imports only)
function graph(entry, seen = new Set()) {
  if (seen.has(entry) || !files.includes(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(path.join(JS, entry), 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"]\.\/([\w.-]+\.js)['"]/gm)) graph(m[1], seen);
  return seen;
}

let changed = 0;
for (const page of PAGES) {
  const p = path.join(ROOT, page);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;

  // 1. import map: keep the bare specifiers (three, three/addons/), regenerate the ./js/ entries
  s = s.replace(/<script type="importmap">([\s\S]*?)<\/script>/, (all, body) => {
    const map = JSON.parse(body);
    const imports = Object.fromEntries(Object.entries(map.imports || {}).filter(([k]) => !k.startsWith('./js/')));
    for (const f of modules) imports[`./js/${f}`] = `./js/${f}?v=${H[f]}`;
    const lines = Object.entries(imports).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `<script type="importmap">\n{ "imports": {\n${lines.join(',\n')}\n} }\n</script>`;
  });

  // 2. script tags pointing at js/
  s = s.replace(/(<script\b[^>]*\bsrc=")js\/([\w.-]+\.js)(?:\?v=[0-9a-f]+)?(")/g, (all, a, f, b) => H[f] ? `${a}js/${f}?v=${H[f]}${b}` : all);

  // 2b. inline module scripts on pages without an import map (create.html): hash their './js/' imports
  s = s.replace(/(<script type="module">)([\s\S]*?)(<\/script>)/g, (all, a, body, b) =>
    a + body.replace(/(['"])\.\/js\/([\w.-]+\.js)(?:\?v=[0-9a-f]+)?\1/g, (m, q, f) => H[f] ? `${q}./js/${f}?v=${H[f]}${q}` : m) + b);

  // 3. modulepreload for the module entry point(s) of this page
  s = s.replace(/[ \t]*<link rel="modulepreload"[^>]*>\r?\n/g, '');
  const entries = [...s.matchAll(/<script type="module" src="js\/([\w.-]+\.js)/g)].map(m => m[1]);
  for (const m of s.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) for (const i of m[1].matchAll(/['"]\.\/js\/([\w.-]+\.js)(?:\?v=[0-9a-f]+)?['"]/g)) entries.push(i[1]);
  if (entries.length) {
    const all = new Set(); for (const e of entries) graph(e, all);
    const local = [...all].map(f => `<link rel="modulepreload" href="js/${f}?v=${H[f]}">`);
    const usesThree = [...all].some(f => /from ['"]three/.test(fs.readFileSync(path.join(JS, f), 'utf8')));
    const links = [...(usesThree ? THREE_PRELOAD.map(u => `<link rel="modulepreload" href="${u}" crossorigin>`) : []), ...local];
    if (/<script type="importmap">/.test(s)) s = s.replace(/(<script type="importmap">[\s\S]*?<\/script>\r?\n)/, `$1${links.join('\n')}\n`);
    else s = s.replace(/(<\/head>)/, `${links.join('\n')}\n$1`);
  }

  if (s !== before) { fs.writeFileSync(p, s); changed++; console.log(`stamped ${page}`); }
}
console.log(changed ? `${changed} page(s) updated` : 'already up to date');
