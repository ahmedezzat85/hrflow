// Token lint (doc 21 section 0.5): no raw colour literals in Finance JS or partials, and none in
// finance-v2.css. Only lines added on this branch (git diff main) are checked in JS/partials.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const hits = [];

const diff = execSync(
  'git diff main --unified=0 -- public/js/finance-*.js src/partials src/styles/modules/finance-v2.css',
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
let file = '';
for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (file.endsWith('finance-payroll.js') || file.includes('finance-payroll.html')) continue;
  if (LITERAL.test(line)) hits.push(`${file}: ${line.slice(1).trim().slice(0, 140)}`);
}

// finance-v2.css may still be untracked: scan the whole file as well.
readFileSync('src/styles/modules/finance-v2.css', 'utf8').split(/\r?\n/).forEach((l, i) => {
  if (LITERAL.test(l) && !l.trim().startsWith('/*')) hits.push(`src/styles/modules/finance-v2.css:${i + 1}: ${l.trim().slice(0, 140)}`);
});

const unique = [...new Set(hits)];
if (unique.length) {
  console.error(`Token lint: ${unique.length} colour literal(s) outside tokens.css:`);
  unique.forEach((h) => console.error('  ' + h));
  process.exit(1);
}
console.log('Token lint clean.');
