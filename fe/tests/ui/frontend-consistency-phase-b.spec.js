import { test, expect } from '@playwright/test';

test.describe('Frontend Consistency — Phase B Verification (Payroll Settings)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Payroll Settings
    await page.click('#payrollRailBtn');
    await page.waitForTimeout(300);
    await page.click('#payrollNavSettings');
    await page.waitForTimeout(500);
  });

  test('AC 1: Standard section-title-group header; hero & duplicate buttons removed; Save/Cancel bar preserved', async ({ page }) => {
    // Header check
    const headerGroup = page.locator('#payrollViewSettings .payroll-settings-header .section-title-group');
    await expect(headerGroup).toBeVisible();
    await expect(headerGroup.locator('.section-title')).toContainText('Payroll Settings');
    await expect(headerGroup.locator('.section-subtitle')).toContainText('Configure disbursement funding accounts');

    // Hero, Configuration pill, and duplicate top buttons should NOT exist
    await expect(page.locator('#payrollViewSettings .payroll-settings-hero')).toHaveCount(0);
    await expect(page.locator('#payrollViewSettings .settings-pill:has-text("Configuration")')).toHaveCount(0);

    // Bottom save bar is present and visible
    const saveBar = page.locator('#payrollViewSettings .save-bar');
    await expect(saveBar).toBeVisible();
    await expect(saveBar.locator('button:has-text("Cancel")')).toBeVisible();
    await expect(saveBar.locator('button:has-text("Save settings")')).toBeVisible();
  });

  test('AC 2: Field dimensions match modal standards (13.5px text, 10px radius, 40px height, 1px border)', async ({ page }) => {
    const inputMetrics = await page.evaluate(() => {
      const input = document.getElementById('payrollTaxEffectiveFrom');
      const select = document.getElementById('payrollTargetExternalAccount');
      const compInput = window.getComputedStyle(input);
      const compSelect = window.getComputedStyle(select);
      const rectInput = input.getBoundingClientRect();
      const rectSelect = select.getBoundingClientRect();

      return {
        inputFontSize: compInput.fontSize,
        inputBorderRadius: compInput.borderRadius,
        inputHeight: Math.round(rectInput.height),
        inputBorderWidth: compInput.borderWidth,
        selectFontSize: compSelect.fontSize,
        selectBorderRadius: compSelect.borderRadius,
        selectHeight: Math.round(rectSelect.height),
        selectBorderWidth: compSelect.borderWidth,
      };
    });

    expect(inputMetrics.inputFontSize).toBe('13.5px');
    expect(inputMetrics.inputBorderRadius).toBe('10px');
    expect(inputMetrics.inputHeight).toBe(40);
    expect(inputMetrics.inputBorderWidth).toBe('1px');

    expect(inputMetrics.selectFontSize).toBe('13.5px');
    expect(inputMetrics.selectBorderRadius).toBe('10px');
    expect(inputMetrics.selectHeight).toBe(40);
    expect(inputMetrics.selectBorderWidth).toBe('1px');
  });

  test('AC 3: Funding bank accounts display masked numbers with last four digits', async ({ page }) => {
    const optionsText = await page.evaluate(() => {
      const selExt = document.getElementById('payrollTargetExternalAccount');
      const selInt = document.getElementById('payrollTargetInternalAccount');
      return {
        ext: Array.from(selExt.options).map(o => o.text),
        int: Array.from(selInt.options).map(o => o.text),
      };
    });

    expect(optionsText.ext.length).toBeGreaterThan(0);
    expect(optionsText.int.length).toBeGreaterThan(0);

    // Must match format containing •••• <last4>
    for (const opt of [...optionsText.ext, ...optionsText.int]) {
      expect(opt).toMatch(/•••• [A-Za-z0-9-]{4}/);
    }
  });

  test('AC 4: Dark theme renders settings inputs and cards correctly', async ({ page }) => {
    await page.evaluate(() => window.applyTheme('dark'));
    await page.waitForTimeout(300);

    const darkStyles = await page.evaluate(() => {
      const select = document.getElementById('payrollTargetExternalAccount');
      const card = document.getElementById('payrollFundingAccountsSettingsCard');
      const compSelect = window.getComputedStyle(select);
      const compCard = window.getComputedStyle(card);
      return {
        selectBg: compSelect.backgroundColor,
        selectColor: compSelect.color,
        cardBg: compCard.backgroundColor,
      };
    });

    // Dark surface color #171a24 = rgb(23, 26, 36)
    expect(darkStyles.selectBg).toBe('rgb(23, 26, 36)');
    expect(darkStyles.cardBg).toBe('rgb(23, 26, 36)');
  });
});
