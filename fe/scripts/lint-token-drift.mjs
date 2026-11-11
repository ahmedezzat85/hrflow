// Ratcheting token-drift lint. Counts raw colour literals (#hex, rgb[a]()) per file in styles, scripts and
// partials, and fails when a file has MORE than its recorded baseline (scripts/drift-baseline.json).
// Existing drift is tolerated, new drift is not; lower a count by fixing code, then run with --update to ratchet.
// tokens.css is the only file allowed to define colours.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = join(ROOT, 'scripts', 'drift-baseline.json');
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const TARGETS = [
  ['src/styles', /\.css$/],
  ['public/js', /\.js$/],
  ['src/partials', /\.html$/],
];

function walk(dir, re, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, re, out);
    else if (re.test(name)) out.push(p);
  }
  return out;
}

const counts = {};
for (const [dir, re] of TARGETS) {
  for (const file of walk(join(ROOT, dir), re)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel === 'src/styles/tokens.css') continue;
    let n = 0;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('//')) continue;
      if (LITERAL.test(line)) n += 1;
    }
    if (n) counts[rel] = n;
  }
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Baseline written: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} literal lines.`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const worse = Object.entries(counts).filter(([f, n]) => n > (base[f] || 0));
const better = Object.entries(base).filter(([f, n]) => (counts[f] || 0) < n);
if (worse.length) {
  console.error('Token drift: new colour literals outside tokens.css (use a token from tokens.css):');
  worse.forEach(([f, n]) => console.error(`  ${f}: ${n} (baseline ${base[f] || 0})`));
  process.exit(1);
}
if (better.length) console.log(`Token drift improved in ${better.length} file(s); run "npm run lint:token-drift -- --update" to lock it in.`);
console.log('Token drift lint clean (no new literals).');
