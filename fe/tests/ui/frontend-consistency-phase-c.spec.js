import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Frontend Consistency — Phase C Verification (Stop CSS Leaking)', () => {
  test('AC 1: .section-title outside Payroll renders with components.css standard (18px), while Payroll preserves 17px', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // D-027: Finance Settings no longer has an in-page title block; the System roles page keeps a standard .section-title
    await page.evaluate(() => showSection('a-system-roles', 'admin'));
    await expect(page.locator('#a-system-roles')).toBeVisible();

    const financeSettingsTitleSize = await page.evaluate(() => {
      const el = document.querySelector('#a-system-roles .section-title');
      return el ? window.getComputedStyle(el).fontSize : null;
    });
    expect(financeSettingsTitleSize).toBe('18px');

    // Navigate to Payroll
    await openAdminPage(page, 'a-finance-payroll');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    const payrollTitleSize = await page.evaluate(() => {
      const el = document.querySelector('#a-finance-payroll .section-title');
      return el ? window.getComputedStyle(el).fontSize : null;
    });
    expect(payrollTitleSize).toBe('17px');
  });

  test('AC 2: Generic labels outside Payroll do NOT leak Payroll uppercase 10.5px styling', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Finance Settings
    await openAdminPage(page, 'a-finance-settings');
    await expect(page.locator('#a-finance-settings')).toBeVisible();

    const labelStyles = await page.evaluate(() => {
      const label = document.querySelector('#a-finance-settings label');
      if (!label) return null;
      const comp = window.getComputedStyle(label);
      return {
        fontSize: comp.fontSize,
        textTransform: comp.textTransform,
      };
    });

    if (labelStyles) {
      // Must NOT be the payroll leaked 10.5px uppercase
      expect(labelStyles.fontSize).not.toBe('10.5px');
      expect(labelStyles.textTransform).not.toBe('uppercase');
    }
  });

  test('AC 3: login.css .btn-login is strictly scoped under #login-screen', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Check that a test element with .btn-login outside #login-screen does not inherit width: 100% or padding: 14px
    const leakedButtonMetrics = await page.evaluate(() => {
      const testBtn = document.createElement('button');
      testBtn.className = 'btn-login';
      testBtn.textContent = 'Test Button';
      document.body.appendChild(testBtn);
      const comp = window.getComputedStyle(testBtn);
      const metrics = {
        width: comp.width,
        paddingTop: comp.paddingTop,
        borderRadius: comp.borderRadius,
      };
      document.body.removeChild(testBtn);
      return metrics;
    });

    // Login's .btn-login had 14px padding and 12px border radius
    expect(leakedButtonMetrics.paddingTop).not.toBe('14px');

    // On login screen itself, .btn-login matches login styling
    const loginBtnMetrics = await page.evaluate(() => {
      const loginScreen = document.getElementById('login-screen');
      if (!loginScreen) return null;
      const testBtn = document.createElement('button');
      testBtn.className = 'btn-login';
      testBtn.textContent = 'Login Action';
      loginScreen.appendChild(testBtn);
      const comp = window.getComputedStyle(testBtn);
      const metrics = {
        paddingTop: comp.paddingTop,
        borderRadius: comp.borderRadius,
      };
      loginScreen.removeChild(testBtn);
      return metrics;
    });

    expect(loginBtnMetrics.paddingTop).toBe('14px');
    expect(loginBtnMetrics.borderRadius).toBe('12px');
  });

  test('AC 4: Payroll stepper, badges, and internal cards retain proper styling', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    await openAdminPage(page, 'a-finance-payroll');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();

    const payrollBadge = await page.evaluate(() => {
      const badge = document.querySelector('#a-finance-payroll .badge-pill');
      if (!badge) return null;
      const comp = window.getComputedStyle(badge);
      return {
        fontWeight: comp.fontWeight,
        display: comp.display,
      };
    });

    expect(payrollBadge).not.toBeNull();
    expect(payrollBadge.fontWeight).toBe('700');
    expect(['inline-flex', 'flex']).toContain(payrollBadge.display);
  });
});
