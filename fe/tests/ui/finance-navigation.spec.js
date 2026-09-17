import { test, expect } from '@playwright/test';

test.describe('Story 1.1 — Finance Information Architecture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Acceptance Criteria 1: Reorganized Finance into 7 domains reachable in two navigation decisions or fewer', async ({ page }) => {
    const navGroup = page.locator('#adminFinanceNavGroup');
    await expect(navGroup).toBeVisible();

    // Verify the 7 primary domain items exist in sidebar
    await expect(navGroup.locator('a[data-page="a-finance-dashboard"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-sales"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-spend"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-banking"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-payroll"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-reports"]')).toBeVisible();
    await expect(navGroup.locator('a[data-page="a-finance-settings"]')).toBeVisible();

    // Decision 1: Click Sales -> reaches Sales Invoices
    await page.click('#adminSidebar a[data-page="a-finance-sales"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    // Decision 2: Click Customers sub-tab -> reaches Customers view
    await page.click('#tabFinanceCustomers');
    await expect(page.locator('#financeCustomersContainer')).toBeVisible();

    // Decision 1: Click Spend -> reaches Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-spend"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    // Decision 2: Click Vendors sub-tab -> reaches Vendors view
    await page.click('#tabFinanceVendors');
    await expect(page.locator('#financeVendorsContainer')).toBeVisible();

    // Decision 1: Click Banking -> reaches Bank & Cash Accounts
    await page.click('#adminSidebar a[data-page="a-finance-banking"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    // Decision 2: Click Transfers sub-tab -> reaches Transfers view
    await page.click('#subtabFinanceTransfers');
    await expect(page.locator('#financeSubPaneTransfers')).toBeVisible();

    // Decision 1: Click Settings -> reaches Finance Settings
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await expect(page.locator('#a-finance-settings')).toBeVisible();
    // Decision 2: Click Payment Types sub-tab -> reaches Payment Types view
    await page.click('#subtabSettingsPaymentTypes');
    await expect(page.locator('#financeSettingsPanePaymentTypes')).toBeVisible();
  });

  test('Acceptance Criteria 2: Backward compatibility and redirect mapping for legacy section routes', async ({ page }) => {
    // Navigate using legacy route showSection('a-finance-invoices')
    await page.evaluate(() => {
      window.showSection('a-finance-invoices', 'admin');
    });
    await expect(page.locator('#a-finance-invoices')).toBeVisible();
    await expect(page.locator('#adminSidebar a[data-page="a-finance-sales"]')).toHaveClass(/active/);

    // Navigate using legacy route showSection('a-finance-bills')
    await page.evaluate(() => {
      window.showSection('a-finance-bills', 'admin');
    });
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#adminSidebar a[data-page="a-finance-spend"]')).toHaveClass(/active/);

    // Navigate using legacy route showSection('a-finance-accounts')
    await page.evaluate(() => {
      window.showSection('a-finance-accounts', 'admin');
    });
    await expect(page.locator('#a-finance-accounts')).toBeVisible();
    await expect(page.locator('#adminSidebar a[data-page="a-finance-banking"]')).toHaveClass(/active/);
  });

  test('Acceptance Criteria 3: Categories and Payment Types live exclusively under Settings, not Banking operations', async ({ page }) => {
    // Navigate to Banking
    await page.click('#adminSidebar a[data-page="a-finance-banking"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Verify Categories and Payment Types are NOT in Banking sub navigation
    const bankingNav = page.locator('#financeAccountsSubNav');
    await expect(bankingNav.locator('#subtabFinanceCategories')).toHaveCount(0);
    await expect(bankingNav.locator('#subtabFinancePaymentTypes')).toHaveCount(0);

    // Navigate to Settings
    await page.click('#adminSidebar a[data-page="a-finance-settings"]');
    await expect(page.locator('#a-finance-settings')).toBeVisible();

    // Verify Settings sub navigation contains Categories and Payment Types
    const settingsNav = page.locator('#financeSettingsSubNav');
    await expect(settingsNav.locator('#subtabSettingsCategories')).toBeVisible();
    await expect(settingsNav.locator('#subtabSettingsPaymentTypes')).toBeVisible();

    // Switch to Payment Types in Settings
    await page.click('#subtabSettingsPaymentTypes');
    await expect(page.locator('#financeSettingsPanePaymentTypes')).toBeVisible();
    await expect(page.locator('#financeSettingsPaneCategories')).not.toBeVisible();

    // Switch back to Categories in Settings
    await page.click('#subtabSettingsCategories');
    await expect(page.locator('#financeSettingsPaneCategories')).toBeVisible();
    await expect(page.locator('#financeSettingsPanePaymentTypes')).not.toBeVisible();
  });

  test('Acceptance Criteria 4: Actionable badges display item counts with accessible role and labels', async ({ page }) => {
    // Trigger badge update
    await page.evaluate(async () => {
      await window.updateFinanceBadges();
    });

    const salesBadge = page.locator('#financeSalesBadge');
    await expect(salesBadge).toBeVisible();
    await expect(salesBadge).toHaveAttribute('role', 'status');
    const salesText = await salesBadge.textContent();
    expect(parseInt(salesText, 10)).toBeGreaterThan(0);
    await expect(salesBadge).toHaveAttribute('aria-label', /open sales invoices/i);

    const spendBadge = page.locator('#financeSpendBadge');
    await expect(spendBadge).toBeVisible();
    await expect(spendBadge).toHaveAttribute('role', 'status');
    const spendText = await spendBadge.textContent();
    expect(parseInt(spendText, 10)).toBeGreaterThan(0);
    await expect(spendBadge).toHaveAttribute('aria-label', /unpaid vendor bills/i);
  });

  test('Acceptance Criteria 5: Unauthorized roles cannot view finance navigation group', async ({ page }) => {
    // Load app as regular employee
    await page.goto('/?mock=employee');
    await expect(page.locator('#employee-app')).toBeVisible({ timeout: 15000 });

    // Verify finance navigation group is hidden
    const financeNav = page.locator('#adminFinanceNavGroup');
    await expect(financeNav).not.toBeVisible();
  });
});
