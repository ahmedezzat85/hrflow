import { test, expect } from '@playwright/test';

// Restyle v3 conformance test suite (S0.5 skeleton)
// Validates computed styles against the approved restyle-v3 mocks in both light and dark themes.

export async function expectStyle(locator, expectedStyles) {
  const actual = await locator.first().evaluate((el, keys) => {
    const cs = window.getComputedStyle(el);
    const res = {};
    for (const k of keys) {
      res[k] = cs[k] || cs.getPropertyValue(k);
    }
    return res;
  }, Object.keys(expectedStyles));

  for (const [key, val] of Object.entries(expectedStyles)) {
    if (val instanceof RegExp) {
      expect(actual[key]).toMatch(val);
    } else {
      expect(actual[key]).toBe(val);
    }
  }
}

async function openAdmin(page, theme = 'light') {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.evaluate((th) => {
    if (typeof applyTheme === 'function') applyTheme(th);
    else document.documentElement.setAttribute('data-theme', th);
  }, theme);
}

for (const theme of ['light', 'dark']) {
  test.describe(`Restyle v3 conformance skeleton [${theme}]`, () => {
    test(`S0.5 helper verification and theme attribute in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(currentTheme).toBe(theme);

      await expectStyle(page.locator('#adminSidebar'), {
        display: 'flex',
      });
    });
  });
}
