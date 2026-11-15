import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Computed-style regression guard. For each shared component selector the first matching element in the
// loaded app is read, in light and dark, and compared with tests/ui/style-baseline.json. Only properties that do
// not depend on the machine's font metrics are recorded, so the result is identical on Windows and Linux CI.
// Intentional restyle: run `UPDATE_STYLE_BASELINE=1 npx playwright test tests/ui/style-baseline.spec.js`
// and review the baseline diff in the PR. An unintended change names the selector and property that moved.
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'style-baseline.json');
const UPDATE = process.env.UPDATE_STYLE_BASELINE === '1';

const PROPS = ['display', 'color', 'background-color', 'border-top-color', 'border-top-width', 'border-top-style',
  'border-top-left-radius', 'font-size', 'font-weight', 'font-family', 'letter-spacing', 'text-transform', 'text-align',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'box-shadow', 'opacity'];

const SELECTORS = [
  // buttons
  '.btn:not(.btn-fill):not(.btn-outline):not(.btn-success):not(.btn-warning):not(.btn-danger-outline)',
  '.btn-fill', '.btn-outline', '.btn-success', '.btn-warning', '.btn-danger-outline', '.btn-sm',
  // pills and badges
  '.badge-pill.pill-success', '.badge-pill.pill-warning', '.badge-pill.pill-danger', '.badge-pill.pill-info',
  '.badge-pill.pill-neutral', '.badge-pill.pill-primary',
  // surfaces and tables
  '.card', '.fv-card', '.fv-table-card', '.fv-table th', '.fv-table td',
  // callouts and alerts
  '.fv-callout', '.fv-callout--warn', '.fv-callout--danger',
  '.alert-box.alert-warning', '.alert-box.alert-danger', '.alert.alert-warning', '.alert.alert-info',
  // form controls
  '.form-field label', '.form-field input:not([type=checkbox]):not([type=radio]):not([type=file])', '.form-field select',
  '.form-field textarea', 'input[type=date]', '.fv-select', '.hv-dd__btn', '.hv-file', '.hv-file__btn',
  // dialogs
  '.modal-v2 .modal-head h3', '.modal-v2 .modal-foot', '.modal-v2 .modal-close',
  // navigation and filters
  '.sidebar .nav-item', '.filter-tab', '.fv-pill',
  // shared utility classes
  '.ui-lbl', '.ui-note', '.ui-control', '.ui-h15',
];

async function collect(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(300);
  return page.evaluate(({ SELECTORS, PROPS }) => {
    const out = {};
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const cs = getComputedStyle(el);
      out[sel] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  }, { SELECTORS, PROPS });
}

for (const mock of ['admin', 'employee']) {
  test(`computed styles of shared components: ${mock}`, async ({ page }) => {
    await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(mock === 'admin' ? '#adminSidebar' : 'body', { timeout: 20000 });
    await page.waitForTimeout(2500);
    const current = {};
    for (const theme of ['light', 'dark']) current[`${mock}/${theme}`] = await collect(page, theme);

    if (UPDATE) {
      const merged = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
      Object.assign(merged, current);
      fs.writeFileSync(FILE, JSON.stringify(merged, null, 1) + '\n');
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const problems = [];
    for (const theme of ['light', 'dark']) {
      const key = `${mock}/${theme}`;
      for (const sel of SELECTORS) {
        const want = baseline[key]?.[sel];
        const got = current[key][sel];
        if (want == null && got == null) continue;
        if (want == null || got == null) {
          problems.push(`${key} ${sel}: ${got == null ? 'element no longer found' : 'new element found, update baseline'}`);
          continue;
        }
        for (const p of PROPS) if (want[p] !== got[p]) problems.push(`${key} ${sel} ${p}: ${want[p]} -> ${got[p]}`);
      }
    }
    expect(problems, 'Shared component styles changed. If intentional, regenerate with UPDATE_STYLE_BASELINE=1.').toEqual([]);
  });
}
