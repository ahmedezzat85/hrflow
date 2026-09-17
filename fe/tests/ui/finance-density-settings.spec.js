import { test, expect } from '@playwright/test';

test.describe('FUX-415 — Global Table Row Density Setting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.removeItem('hrflow_finance_table_density');
      if (typeof FinanceTable !== 'undefined') {
        FinanceTable.initAllTablesDensity();
      }
    });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('AC 1: No Finance list page renders per-page density switcher in its toolbar', async ({ page }) => {
    // 1. Bills page
    await page.click('#adminSidebar a[data-page="a-finance-spend"]');
    await expect(page.locator('#financeBillsTable tbody tr').first()).toBeVisible();
    await expect(page.locator('#financeBillDensityControl')).toHaveCount(0);
    await expect(page.locator('#a-finance-bills .density-toggle-group')).toHaveCount(0);

    // 2. Vendors subview
    const vendorTab = page.locator('#financeBillSubTabVendors');
    if (await vendorTab.isVisible()) {
      await vendorTab.click();
      await expect(page.locator('#financeVendorsTable')).toBeVisible();
      await expect(page.locator('#a-finance-bills .density-toggle-group')).toHaveCount(0);
    }

    // 3. Invoices page
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#financeInvoicesTable tbody tr').first()).toBeVisible();
    await expect(page.locator('#financeInvoiceDensityControl')).toHaveCount(0);
    await expect(page.locator('#a-finance-invoices .density-toggle-group')).toHaveCount(0);

    // 4. Banking / Transactions page
    await page.click('#adminSidebar a[data-page="a-finance-banking"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    await expect(page.locator('#a-finance-accounts .density-toggle-group')).toHaveCount(0);
  });

  test('AC 2: Finance -> Settings -> Display contains exactly one 3-option segmented control (Regular, Compact, Spacious)', async ({ page }) => {
    // Navigate to Finance Settings
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await expect(page.locator('#a-finance-settings')).toBeVisible();

    // Verify Display subtab exists and click it
    const displaySubTab = page.locator('#subtabSettingsDisplay');
    await expect(displaySubTab).toBeVisible();
    await displaySubTab.click();

    // Display pane should be visible
    const displayPane = page.locator('#financeSettingsPaneDisplay');
    await expect(displayPane).toBeVisible();

    // Label and segmented control
    await expect(displayPane.locator('#financeTableDensityLabel')).toContainText('Table row density');
    const control = displayPane.locator('#financeGlobalDensityControl .density-toggle-group');
    await expect(control).toBeVisible();

    const buttons = control.locator('.density-btn');
    await expect(buttons).toHaveCount(3);

    // Order: Regular, Compact, Spacious
    const regBtn = buttons.nth(0);
    const compBtn = buttons.nth(1);
    const spacBtn = buttons.nth(2);

    await expect(regBtn).toHaveAttribute('data-density', 'regular');
    await expect(regBtn).toContainText('Regular');

    await expect(compBtn).toHaveAttribute('data-density', 'compact');
    await expect(compBtn).toContainText('Compact');

    await expect(spacBtn).toHaveAttribute('data-density', 'spacious');
    await expect(spacBtn).toContainText('Spacious');

    // Default without preference is Regular
    await expect(regBtn).toHaveClass(/active/);
    await expect(regBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(compBtn).not.toHaveClass(/active/);
    await expect(compBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(spacBtn).not.toHaveClass(/active/);
    await expect(spacBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('AC 3 & 4: Changing setting updates density across multiple finance pages live and persists across reload', async ({ page }) => {
    // Navigate to Finance Settings -> Display
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await page.click('#subtabSettingsDisplay');

    const control = page.locator('#financeSettingsPaneDisplay #financeGlobalDensityControl');
    const compBtn = control.locator('button[data-density="compact"]');
    const spacBtn = control.locator('button[data-density="spacious"]');

    // Select Compact
    await compBtn.click();
    await expect(compBtn).toHaveClass(/active/);
    await expect(compBtn).toHaveAttribute('aria-pressed', 'true');

    // Check localStorage persistence
    let stored = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(stored).toBe('compact');

    // Navigate to Bills in the same session: verify compact class is applied
    await page.click('#adminSidebar a[data-page="a-finance-spend"]');
    await expect(page.locator('#financeBillsTable')).toHaveClass(/density-compact/);

    // Navigate to Invoices in the same session: verify compact class is applied
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#financeInvoicesTable')).toHaveClass(/density-compact/);

    // Go back to Settings -> Display and set Spacious
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await page.click('#subtabSettingsDisplay');
    await spacBtn.click();
    await expect(spacBtn).toHaveClass(/active/);
    await expect(spacBtn).toHaveAttribute('aria-pressed', 'true');

    stored = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(stored).toBe('spacious');

    // Reload page to test cold persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Invoices after reload: must still be spacious
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#financeInvoicesTable')).toHaveClass(/density-spacious/);

    // Navigate to Bills after reload: must still be spacious
    await page.click('#adminSidebar a[data-page="a-finance-spend"]');
    await expect(page.locator('#financeBillsTable')).toHaveClass(/density-spacious/);

    // Navigate to Settings -> Display: Spacious button must be active
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await page.click('#subtabSettingsDisplay');
    const spacBtnAfterReload = page.locator('#financeSettingsPaneDisplay button[data-density="spacious"]');
    await expect(spacBtnAfterReload).toHaveClass(/active/);
    await expect(spacBtnAfterReload).toHaveAttribute('aria-pressed', 'true');
  });

  test('AC 5: Keyboard accessibility allows cycling through density options', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await page.click('#subtabSettingsDisplay');

    const control = page.locator('#financeSettingsPaneDisplay #financeGlobalDensityControl');
    const regBtn = control.locator('button[data-density="regular"]');
    const compBtn = control.locator('button[data-density="compact"]');
    const spacBtn = control.locator('button[data-density="spacious"]');

    // Focus on the first option (Regular)
    await regBtn.focus();
    await expect(regBtn).toBeFocused();

    // Press ArrowRight -> should focus and activate Compact
    await page.keyboard.press('ArrowRight');
    await expect(compBtn).toBeFocused();
    await expect(compBtn).toHaveClass(/active/);
    let stored = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(stored).toBe('compact');

    // Press ArrowRight again -> should focus and activate Spacious
    await page.keyboard.press('ArrowRight');
    await expect(spacBtn).toBeFocused();
    await expect(spacBtn).toHaveClass(/active/);
    stored = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(stored).toBe('spacious');

    // Press ArrowLeft -> back to Compact
    await page.keyboard.press('ArrowLeft');
    await expect(compBtn).toBeFocused();
    await expect(compBtn).toHaveClass(/active/);
    stored = await page.evaluate(() => localStorage.getItem('hrflow_finance_table_density'));
    expect(stored).toBe('compact');
  });
});
