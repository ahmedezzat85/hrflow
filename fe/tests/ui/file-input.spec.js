import { test, expect } from '@playwright/test';

// Themed file input (public/js/file-input.js): English button and file-name label over the real input.
test('file inputs show an English button and the chosen file name, and reset with value=""', async ({ page }) => {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

  const wrap = page.locator('.hv-file:has(#financeImportManifest)');
  await expect(wrap).toHaveCount(1);
  await expect(wrap.locator('.hv-file__btn')).toHaveText('Choose file');
  await expect(wrap.locator('.hv-file__name')).toHaveText('No file chosen');

  await page.locator('#financeImportManifest').setInputFiles({ name: 'bills.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') });
  await expect(wrap.locator('.hv-file__name')).toHaveText('bills.csv');

  await page.evaluate(() => { document.getElementById('financeImportManifest').value = ''; });
  await expect(wrap.locator('.hv-file__name')).toHaveText('No file chosen');
});
