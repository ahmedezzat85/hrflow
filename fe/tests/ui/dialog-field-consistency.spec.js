import { test, expect } from '@playwright/test';

// Guards against dialog fields falling back to browser defaults (Arial/monospace font, no padding),
// which happened when a dialog used .form-group instead of the shared .form-field markup.
const MONO_ALLOWED = new Set(['fCompanyAccountNumber']);

test('finance dialog text fields use the app font, padding and border', async ({ page }) => {
  await page.goto('/?mock=admin');
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
  const offenders = await page.evaluate((monoAllowed) => {
    const bad = [];
    document.querySelectorAll('.modal-overlay.fv-dialog').forEach((ov) => {
      ov.style.display = 'flex';
      ov.style.visibility = 'hidden';
      ov.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || monoAllowed.includes(el.id)) return;
        // Skip bare inputs embedded in an input group (no own border)
        if (cs.borderTopWidth === '0px') return;
        const font = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        if (/^(Arial|monospace)$/i.test(font) || parseFloat(cs.paddingLeft) < 8) {
          bad.push(`${ov.id}#${el.id}: font=${font} padL=${cs.paddingLeft}`);
        }
      });
      ov.style.display = '';
      ov.style.visibility = '';
    });
    return bad;
  }, [...MONO_ALLOWED]);
  expect(offenders).toEqual([]);
});
