// Writes pacer/sw.js: the precache list of every file the app needs, and a cache
// version derived from their contents (any change -> the phone picks up an update).
// Usage: node pacer/tools/build_sw.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const include = ['index.html', 'app.css', 'manifest.webmanifest', 'js', 'vendor', 'fonts', 'glyphs', 'icons',
  'data/course.json', 'data/basemap.pmtiles', 'data/practice-graph.bin', 'data/practice-dem.bin', 'data/practice-dest.json'];
const skip = (p) => /(LICENSE|\.txt$|\.map$|\.md$)/.test(p);

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const f of readdirSync(p).sort()) walk(join(p, f), out); }
  else if (!skip(p)) out.push(p);
}

const files = [];
for (const inc of include) walk(join(root, inc), files);
const hash = createHash('sha256');
const assets = ['./'];
for (const f of files) {
  const rel = relative(root, f).split(sep).join('/');
  hash.update(rel);
  hash.update(readFileSync(f));
  assets.push(rel.split('/').map(encodeURIComponent).join('/'));
}
const version = hash.digest('hex').slice(0, 12);
const tpl = readFileSync(join(root, 'tools', 'sw.template.js'), 'utf8');
const out = tpl.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets, null, 2));
writeFileSync(join(root, 'sw.js'), out);
const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
console.log(`sw.js: version ${version}, ${assets.length} assets, ${(bytes / 1e6).toFixed(2)} MB`);
