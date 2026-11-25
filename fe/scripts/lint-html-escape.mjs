// Ratcheting lint against stored XSS (audit 2026-11, finding H-5).
// Finds `${...}` interpolations inside HTML-building template literals in public/js whose value looks like
// user-entered text (a name, note, reference, ...) and is not passed through an escape helper. Such a value goes
// into innerHTML as markup, so a customer called `<img src=x onerror=...>` runs script for every admin who sees it.
//   npm run lint:html-escape             fail if any file has more findings than scripts/html-escape-baseline.json
//   npm run lint:html-escape -- --list   print every finding (file:line expression)
//   npm run lint:html-escape -- --update rewrite the baseline (only after fixing findings, never to admit new ones)
// Escape with FinanceUI.esc(v) / escapeHtml(v) / escHtml(v), or set text with textContent / new Option(text, value).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = join(ROOT, 'scripts', 'html-escape-baseline.json');

// Text a person typed or imported: customer/vendor/account names, notes, references...
const RISKY = /(name|title|label|desc|note|reason|payee|vendor|customer|counterparty|reference|\bref\b|email|memo|purpose|comment|message|detail|account_name|bank_name|category|department|legal_entity|_number|summary|source|channel|owner|contact|address|holder|role|type|status)/i;
// Already escaped, or HTML produced by a helper that escapes its own inputs
const SAFE_CALL = /^(?:[\w$.]*\.)?(esc|escape\w*|escHtml|escapeHtml|_esc\w*|encodeURIComponent|Number|parseInt|parseFloat|Math\.\w+|String\(Number)\b|^FinanceUI\.\w+\(|^FinanceFormat\.\w+\(|^fmt\w*\(|^format\w*\(|^initials\(/;
// Values that are numbers or ids, or variables that hold already-built HTML
const SAFE_SHAPE = /(\.length|\.id|Id|_id|Count|count|\.toFixed\(\d*\)|\.toLocaleString\([^)]*\)|Html|html|Cells|cells|Rows|rows|Options|options|Pill|pill|Badge|badge|Icon|icon|Btn|btn|Cls|cls|Class|class|Tone|tone|Attr|attr|Attrs|attrs)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Template literals with their `${}` parts, nested templates included (scanned on their own).
function templates(src) {
  const found = [];
  const stack = [];
  let i = 0, line = 1;
  let mode = 'code', quote = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') line++;
    if (mode === 'code') {
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); line += (src.slice(i, e).match(/\n/g) || []).length; i = e < 0 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") {
        mode = 'str'; quote = c;
        if (stack.length && stack[stack.length - 1].inExpr) stack[stack.length - 1].cur += c;
        i++; continue;
      }
      if (c === '`') { stack.push({ text: '', exprs: [], line, depth: 0 }); mode = 'tpl'; i++; continue; }
      if (c === '}' && stack.length && stack[stack.length - 1].inExpr) {
        const t = stack[stack.length - 1];
        if (t.depth === 0) { t.exprs.push({ expr: t.cur, line: t.exprLine, start: t.exprStart, end: i }); t.inExpr = false; t.text += '\u0000'; mode = 'tpl'; i++; continue; }
        t.depth--;
      } else if (c === '{' && stack.length && stack[stack.length - 1].inExpr) stack[stack.length - 1].depth++;
      if (stack.length && stack[stack.length - 1].inExpr) stack[stack.length - 1].cur += c;
      i++; continue;
    }
    if (mode === 'str') {
      if (c === '\\') { i += 2; continue; }
      if (c === quote || c === '\n') mode = 'code';
      if (stack.length && stack[stack.length - 1].inExpr) stack[stack.length - 1].cur += c;
      i++; continue;
    }
    // inside a template literal's text
    const t = stack[stack.length - 1];
    if (c === '\\') { t.text += src.slice(i, i + 2); i += 2; continue; }
    if (c === '`') {
      stack.pop(); found.push(t);
      mode = 'code';
      if (stack.length && stack[stack.length - 1].inExpr) stack[stack.length - 1].cur += '`…`';
      i++; continue;
    }
    if (c === '$' && src[i + 1] === '{') { t.inExpr = true; t.cur = ''; t.exprLine = line; t.exprStart = i + 2; t.depth = 0; mode = 'code'; i += 2; continue; }
    t.text += c; i++;
  }
  return found;
}

function findings(file) {
  const out = [];
  for (const t of templates(readFileSync(file, 'utf8'))) {
    if (!/<[a-zA-Z!\/]/.test(t.text)) continue; // not HTML
    const parts = t.text.split('\u0000');
    t.exprs.forEach((e, k) => {
      const expr = e.expr.trim();
      if (!expr || expr.includes('`')) return; // builds HTML from nested templates, scanned separately
      const before = parts[k] || '';
      if (/=\s*["']?$/.test(before) && /\b(class|id|data-[\w-]+|for|style|type|aria-hidden|role|width|height|colspan)=["']?$/.test(before)) return; // markup attribute values
      if (SAFE_CALL.test(expr) || SAFE_SHAPE.test(expr.replace(/\s*\|\|.*$/, '').replace(/\)$/, ''))) return;
      if (/^[\d.]+$/.test(expr) || /^["'][^"']*["']$/.test(expr)) return;
      const subject = expr.replace(/\?.*$/s, '');
      if (!RISKY.test(subject)) return;
      out.push({ line: e.line, start: e.start, end: e.end, before: before.slice(-80), expr: expr.replace(/\s+/g, ' ').slice(0, 120) });
    });
  }
  return out;
}

const files = walk(join(ROOT, 'public', 'js'));
const counts = {};
const all = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const list = findings(f);
  if (list.length) counts[rel] = list.length;
  for (const x of list) all.push(`${rel}:${x.line}  \${${x.expr}}`);
}

if (process.argv.includes('--json')) {
  const out = [];
  for (const f of files) {
    const list = findings(f);
    if (list.length) out.push({ file: relative(ROOT, f).replace(/\\/g, '/'), findings: list });
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}
if (process.argv.includes('--list')) { console.log(all.join('\n')); console.log(`${all.length} finding(s)`); process.exit(0); }
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Baseline written: ${all.length} finding(s) in ${Object.keys(counts).length} file(s).`);
  process.exit(0);
}
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const worse = Object.entries(counts).filter(([f, n]) => n > (base[f] || 0));
const better = Object.entries(base).filter(([f, n]) => (counts[f] || 0) < n);
if (worse.length) {
  console.error('Unescaped text in HTML templates increased (stored XSS risk). Escape it with FinanceUI.esc / escapeHtml:');
  for (const [f, n] of worse) {
    console.error(`  ${f}: ${n} (baseline ${base[f] || 0})`);
    for (const line of all.filter((l) => l.startsWith(f + ':'))) console.error(`    ${line}`);
  }
  process.exit(1);
}
if (better.length) console.log(`Fewer findings than the baseline in ${better.length} file(s); run with --update to lock in the improvement.`);
console.log(`html-escape lint passed (${all.length} known finding(s), none new).`);
