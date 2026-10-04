import { test, expect } from '@playwright/test';

test.describe('Frontend Consistency — Phase D Verification (Accessibility & Attention Queue Routes)', () => {
  test('AC 1: Admin topbar buttons have valid aria-labels and clean notification bell', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    const hamburger = page.locator('#admin-app .topbar .hamburger');
    await expect(hamburger).toHaveAttribute('aria-label', 'Toggle navigation menu');

    const exportBtn = page.locator('#adminExportBtn');
    await expect(exportBtn).toHaveAttribute('aria-label', 'Export Data');

    const searchBtn = page.locator('#adminSearchBtn');
    await expect(searchBtn).toHaveAttribute('aria-label', 'Search across workspace (Ctrl+K)');

    // Notification bell removed until it is wired up (U3)
    await expect(page.locator('#adminNotificationBtn')).toHaveCount(0);

    const themeToggle = page.locator('#adminThemeToggle');
    await expect(themeToggle).toHaveAttribute('aria-label', 'Toggle light/dark theme');
  });

  test('AC 2: Employee topbar buttons have valid aria-labels and clean notification bell', async ({ page }) => {
    await page.goto('/?mock=employee');
    await expect(page.locator('#empSidebar')).toBeVisible({ timeout: 15000 });

    const hamburger = page.locator('#employee-app .topbar .hamburger');
    await expect(hamburger).toHaveAttribute('aria-label', 'Toggle navigation menu');

    const searchBtn = page.locator('#empSearchBtn');
    await expect(searchBtn).toHaveAttribute('aria-label', 'Search across workspace (Ctrl+K)');

    await expect(page.locator('#empNotificationBtn')).toHaveCount(0);

    const themeToggle = page.locator('#empThemeToggle');
    await expect(themeToggle).toHaveAttribute('aria-label', 'Toggle light/dark theme');
  });

  test('AC 3: Attention-item route for Transfers opens Banking page on Transfers tab', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Trigger openAttentionItem with transfers route
    await page.evaluate(() => {
      window.openAttentionItem('a-finance-transfers');
    });

    // Accounts section must be active
    const accountsSection = page.locator('#a-finance-accounts');
    await expect(accountsSection).toHaveClass(/active/);

    // Transfers tab button must be active
    const transfersTab = page.locator('#subtabFinanceTransfers');
    await expect(transfersTab).toHaveClass(/active/);

    // Transfers sub-pane must be visible
    const transfersPane = page.locator('#financeSubPaneTransfers');
    await expect(transfersPane).toBeVisible();

    // Topbar title reflects Account Transfers
    await expect(page.locator('#adminPageTitle')).toHaveText('Account Transfers');
  });

  test('AC 4: Attention-item routes for Cheques and Statements open matching tabs', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Cheques route
    await page.evaluate(() => {
      window.openAttentionItem('a-finance-cheques');
    });
    await expect(page.locator('#a-finance-accounts')).toHaveClass(/active/);
    await expect(page.locator('#subtabFinanceCheques')).toHaveClass(/active/);
    await expect(page.locator('#financeSubPaneCheques')).toBeVisible();
    await expect(page.locator('#adminPageTitle')).toHaveText('Cheque Register');

    // Statements route
    await page.evaluate(() => {
      window.openAttentionItem('a-finance-statements');
    });
    await expect(page.locator('#a-finance-accounts')).toHaveClass(/active/);
    await expect(page.locator('#subtabFinanceStatements')).toHaveClass(/active/);
    await expect(page.locator('#financeSubPaneStatements')).toBeVisible();
    await expect(page.locator('#adminPageTitle')).toHaveText('Statements & Reconciliation');
  });
});
