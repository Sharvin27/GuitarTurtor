// Cache-bust local ES modules, their re-exports, and classic js/ scripts.
// npm run stamp regenerates import maps/preloads. Unchanged classic-only pages
// retain their bytes; generated module pages and hashes are LF-normalised.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'tabs.html', 'create.html'];
const THREE_PRELOAD = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js',
];
const lf = s => s.replace(/\r\n?/g, '\n');

// Static imports, re-exports and literal dynamic imports. Remote computed imports
// in songmaker are pinned independently; they are not local content-hashed assets.
export function localImports(source) {
  return [...source.matchAll(/(?:^\s*(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+?\.m?js)(?:\?v=[0-9a-f]+)?['"]/gm)].map(m => m[1]);
}

export function stampHTML(input, root = ROOT) {
  const read = f => lf(fs.readFileSync(path.join(root, f), 'utf8'));
  const hashes = new Map();
  const hashed = f => {
    if (!hashes.has(f)) hashes.set(f, crypto.createHash('sha256').update(read(f)).digest('hex').slice(0, 10));
    return `${f}?v=${hashes.get(f)}`;
  };
  const modules = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && /^\s*(import|export)\s/m.test(read('js/' + f))).sort().map(f => 'js/' + f);
  const inline = [...input.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  const entries = [...input.matchAll(/<script type="module" src="(js\/[^"?]+\.js)/g)].map(m => m[1]);
  for (const m of inline) entries.push(...localImports(m[1]).map(f => path.posix.normalize(f)));
  const graph = new Set();
  function visit(file) {
    if (file.startsWith('../') || path.posix.isAbsolute(file)) throw new Error('Module outside site: ' + file);
    if (graph.has(file)) return;
    graph.add(file);
    for (const specifier of localImports(read(file))) visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
  entries.forEach(visit);
  let s = entries.length ? lf(input) : input;
  // An import map must precede ALL module preloads/scripts. Create one when absent.
  if (entries.length && !s.includes('<script type="importmap">')) s = s.replace('</head>', '<script type="importmap">{"imports":{}}</script>\n</head>');
  s = s.replace(/<script type="importmap">([\s\S]*?)<\/script>/, (all, body) => {
    const map = JSON.parse(body);
    const imports = Object.fromEntries(Object.entries(map.imports || {}).filter(([k]) => !k.startsWith('./js/') && !graph.has(k.replace(/^\.\//, ''))));
    for (const f of new Set([...modules, ...graph])) imports[`./${f}`] = `./${hashed(f)}`;
    map.imports = imports;
    return `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n</script>`;
  });
  s = s.replace(/(<script\b[^>]*\bsrc=")((?:js\/)[\w.-]+\.js)(?:\?v=[0-9a-f]+)?(")/g,
    (all, a, f, b) => `${a}${hashed(f)}${b}`);
  // Let the same map resolve entry imports and transitive imports to ONE URL.
  s = s.replace(/(<script type="module">)([\s\S]*?)(<\/script>)/g, (all, a, body, b) =>
    a + body.replace(/(['"])(\.\/js\/[\w.-]+\.js)\?v=[0-9a-f]+\1/g, (m, q, f) => q + f + q) + b);
  s = s.replace(/[ \t]*<link rel="modulepreload"[^>]*>\r?\n/g, '');
  if (entries.length) {
    const usesThree = [...graph].some(f => /from ['"]three/.test(read(f)));
    const links = [...(usesThree ? THREE_PRELOAD.map(u => `<link rel="modulepreload" href="${u}" crossorigin>`) : []),
      ...[...graph].map(f => `<link rel="modulepreload" href="${hashed(f)}">`)];
    s = s.replace(/(<script type="importmap">[\s\S]*?<\/script>\n)/, `$1${links.join('\n')}\n`);
  }
  return s;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let changed = 0;
  for (const page of PAGES) {
    const p = path.join(ROOT, page);
    if (!fs.existsSync(p)) continue;
    const before = fs.readFileSync(p, 'utf8'), after = stampHTML(before);
    if (after !== before) { fs.writeFileSync(p, after); changed++; console.log(`stamped ${page}`); }
  }
  console.log(changed ? `${changed} page(s) updated` : 'already up to date');
}
