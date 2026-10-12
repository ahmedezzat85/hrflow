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
  test.describe(`Restyle v3 conformance [${theme}]`, () => {
    test(`S0.5 helper verification and theme attribute in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(currentTheme).toBe(theme);

      await expectStyle(page.locator('#adminSidebar'), {
        display: 'flex',
      });
    });

    test(`S1.1 Dialog shell computed styles in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      // Raise modal
      await page.evaluate(() => openModal('raiseModal'));
      await expect(page.locator('#raiseModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#raiseModal .modal'), {
        borderRadius: '18px',
        width: '600px',
      });
      await expectStyle(page.locator('#raiseModal .modal-head'), {
        paddingTop: '16px',
        paddingBottom: '16px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await expectStyle(page.locator('#raiseModal .modal-head-icon'), {
        width: '36px',
        height: '36px',
        borderRadius: '11px',
      });
      await expectStyle(page.locator('#raiseModal .modal-foot'), {
        paddingTop: '12px',
        paddingBottom: '12px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await page.evaluate(() => closeModal('raiseModal'));

      // Confirm modal (440px variant)
      await page.evaluate(() => openModal('confirmModal'));
      await expect(page.locator('#confirmModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#confirmModal .modal'), {
        borderRadius: '18px',
        width: '440px',
      });
      await expectStyle(page.locator('#confirmModal .modal-head'), {
        paddingTop: '20px',
        paddingBottom: '6px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await expectStyle(page.locator('#confirmModal .modal-foot'), {
        paddingTop: '16px',
        paddingBottom: '16px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await page.evaluate(() => closeModal('confirmModal'));

      // Employee modal
      await page.evaluate(() => openModal('employeeModal'));
      await expect(page.locator('#employeeModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#employeeModal .modal'), {
        borderRadius: '18px',
      });
      await expectStyle(page.locator('#employeeModal .modal-head'), {
        paddingTop: '16px',
        paddingBottom: '16px',
      });
      await expectStyle(page.locator('#employeeModal .modal-head-icon'), {
        width: '36px',
        height: '36px',
        borderRadius: '11px',
      });
      await page.evaluate(() => closeModal('employeeModal'));

      // Verify no form-section-label in inventory modals
      const strayLabels = await page.locator('.modal-overlay:not(#billModal):not(#invoiceModal) .form-section-label').count();
      expect(strayLabels).toBe(0);
    });
  });
}
