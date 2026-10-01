import { test, expect } from '@playwright/test';
import { checkCssVars } from '../../scripts/check-css-vars.js';

test.describe('Frontend Consistency — Phase A Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('A5 Guard: Zero undefined CSS variables used in HTML/JS/CSS', async () => {
    const isClean = checkCssVars();
    expect(isClean).toBe(true);
  });

  test('A1 Token Aliases: Resolve correctly in light and dark themes', async ({ page }) => {
    // Light mode checks
    const lightTokens = await page.evaluate(() => {
      const s = window.getComputedStyle(document.documentElement);
      return {
        primary: s.getPropertyValue('--primary').trim(),
        textMuted: s.getPropertyValue('--text-muted').trim(),
        bgSecondary: s.getPropertyValue('--bg-secondary').trim(),
        borderColor: s.getPropertyValue('--border-color').trim(),
      };
    });

    expect(lightTokens.primary).toBe('#2056e8');
    expect(lightTokens.textMuted).toBe('#7a8ea8');
    expect(lightTokens.bgSecondary).toBe('#fafbfd');

    // Toggle to Dark mode
    await page.evaluate(() => window.applyTheme('dark'));
    await page.waitForTimeout(200);

    const darkTokens = await page.evaluate(() => {
      const s = window.getComputedStyle(document.documentElement);
      return {
        primary: s.getPropertyValue('--primary').trim(),
        textMuted: s.getPropertyValue('--text-muted').trim(),
        bgSecondary: s.getPropertyValue('--bg-secondary').trim(),
        borderColor: s.getPropertyValue('--border-color').trim(),
      };
    });

    expect(darkTokens.primary).toBe('#3e72f8');
    expect(darkTokens.textMuted).toBe('#9aa0b4');
    expect(darkTokens.bgSecondary).toBe('#1d2130');
  });

  test('A2 Payroll Dark Mode: #a-finance-payroll inherits theme tokens and renders dark background', async ({ page }) => {
    await page.click('#payrollRailBtn');
    await page.waitForTimeout(300);

    // Switch to dark
    await page.evaluate(() => window.applyTheme('dark'));
    await page.waitForTimeout(300);

    const payrollColors = await page.evaluate(() => {
      const payrollEl = document.getElementById('a-finance-payroll');
      const comp = window.getComputedStyle(payrollEl);
      return {
        bgVar: comp.getPropertyValue('--bg').trim(),
        surfaceVar: comp.getPropertyValue('--surface').trim(),
        textVar: comp.getPropertyValue('--text').trim(),
      };
    });

    expect(payrollColors.bgVar).toBe('#0f1117');
    expect(payrollColors.surfaceVar).toBe('#171a24');
    expect(payrollColors.textVar).toBe('#f1f2f6');
  });

  test('A3 Icon Fix: fa-shield-halved renders with visible dimensions in callout', async ({ page }) => {
    await page.click('#payrollRailBtn');
    await page.waitForTimeout(300);
    await page.click('#payrollNavSettings');
    await page.waitForTimeout(400);

    const icon = page.locator('#a-finance-payroll .settings-card-callout.callout-blue i');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveClass(/fa-shield-halved/);

    const box = await icon.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('A4 Page Title: Navigating to a-employee-detail displays Employee Profile topbar title', async ({ page }) => {
    await page.evaluate(() => window.showSection('a-employees', 'admin'));
    await page.waitForTimeout(200);
    await expect(page.locator('#adminPageTitle')).toHaveText('Employees');

    await page.evaluate(() => window.showSection('a-employee-detail', 'admin'));
    await page.waitForTimeout(200);
    await expect(page.locator('#adminPageTitle')).toHaveText('Employee Profile');
    await expect(page.locator('#adminPageSub')).toHaveText('View and manage employee profile and records.');
  });
});
