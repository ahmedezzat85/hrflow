import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const feDir = resolve(__dirname, '..');
const stylesDir = resolve(feDir, 'src/styles');

function walkDir(dir, filter) {
  let files = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (['node_modules', 'dist', 'tests', 'test-results', 'playwright-report'].includes(entry)) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(walkDir(fullPath, filter));
    } else if (!filter || filter(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getDefinedVars() {
  const cssFiles = walkDir(stylesDir, p => p.endsWith('.css'));
  const defined = new Set();
  const defRegex = /(--[a-zA-Z0-9_-]+)\s*:/g;

  for (const file of cssFiles) {
    const raw = readFileSync(file, 'utf-8');
    const content = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    let m;
    while ((m = defRegex.exec(content)) !== null) {
      defined.add(m[1]);
    }
  }
  return defined;
}

function getUsedVars() {
  const searchDirs = [
    resolve(feDir, 'src'),
    resolve(feDir, 'public/js'),
    resolve(feDir, 'api'),
  ];

  const files = [];
  for (const dir of searchDirs) {
    files.push(...walkDir(dir, p => p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.js')));
  }

  const usageRegex = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  const used = new Map(); // varName -> Array<{ file, line }>

  for (const file of files) {
    const rel = relative(feDir, file).replace(/\\/g, '/');
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      while ((m = usageRegex.exec(line)) !== null) {
        const varName = m[1];
        if (!used.has(varName)) {
          used.set(varName, []);
        }
        used.get(varName).push({ file: rel, line: i + 1 });
      }
    }
  }
  return used;
}

export function checkCssVars() {
  const defined = getDefinedVars();
  const used = getUsedVars();

  const missing = [];
  for (const [varName, occurrences] of used.entries()) {
    if (!defined.has(varName)) {
      missing.push({ varName, occurrences });
    }
  }

  if (missing.length > 0) {
    console.error(`\x1b[31m[check-css-vars] FAILED: Found ${missing.length} undefined CSS variable(s):\x1b[0m\n`);
    for (const { varName, occurrences } of missing.sort((a, b) => b.occurrences.length - a.occurrences.length)) {
      console.error(`  - \x1b[33m${varName}\x1b[0m (${occurrences.length} usage(s)):`);
      const sample = occurrences.slice(0, 5);
      for (const occ of sample) {
        console.error(`      at ${occ.file}:${occ.line}`);
      }
      if (occurrences.length > 5) {
        console.error(`      ... and ${occurrences.length - 5} more`);
      }
    }
    console.error(`\nTotal undefined CSS variable usages: ${missing.reduce((sum, m) => sum + m.occurrences.length, 0)}`);
    return false;
  }

  console.log(`\x1b[32m[check-css-vars] PASSED: All ${used.size} CSS variables used in HTML/JS/CSS are defined.\x1b[0m`);
  return true;
}

// Direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = checkCssVars();
  process.exit(ok ? 0 : 1);
}
