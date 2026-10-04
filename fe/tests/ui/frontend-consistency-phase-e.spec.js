import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Frontend Consistency — Phase E Verification (Debt Reduction & Layout Integrity)', () => {
  test('AC 1: Payroll hidden helper class functions deterministically', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    await openAdminPage(page, 'a-finance-payroll');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    const isHidden = await page.evaluate(() => {
      const testEl = document.createElement('div');
      testEl.className = 'payroll-hidden';
      testEl.textContent = 'Hidden Element';
      const root = document.getElementById('a-finance-payroll');
      root.appendChild(testEl);
      const display = window.getComputedStyle(testEl).display;
      root.removeChild(testEl);
      return display;
    });

    expect(isHidden).toBe('none');
  });

  test('AC 2: Mobile responsive breakpoints (640px) render month-form and save-bar without regressions', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    await openAdminPage(page, 'a-finance-payroll-settings');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(300);

    const saveBarMetrics = await page.evaluate(() => {
      const bar = document.querySelector('#payrollViewSettings .save-bar');
      if (!bar) return null;
      return {
        flexDirection: window.getComputedStyle(bar).flexDirection,
      };
    });

    expect(saveBarMetrics).not.toBeNull();
    expect(saveBarMetrics.flexDirection).toBe('column');
  });
});
