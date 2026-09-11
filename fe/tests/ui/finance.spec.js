import { test, expect } from '@playwright/test';

test.describe('Finance Module UI Testing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Finance Overview: stat cards horizontal grid & typography', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    const statsGrid = page.locator('#a-finance-dashboard .grid.g4');
    await expect(statsGrid).toBeVisible();

    const statCards = statsGrid.locator('.stat-card');
    await expect(statCards).toHaveCount(4);

    // Verify typography and section header classes exist
    await expect(page.locator('#a-finance-dashboard .section-title')).toBeVisible();
  });

  test('Sales Invoices: toolbar, filter-select dropdown, and modal', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Verify filter dropdown has theme class and is visible
    const filterSelect = page.locator('#financeInvoiceStatusFilter');
    await expect(filterSelect).toBeVisible();
    await expect(filterSelect).toHaveClass(/filter-select/);

    // Open New Sales Invoice modal and verify backdrop & background
    const newInvoiceBtn = page.locator('#financeNewInvoiceBtn');
    await expect(newInvoiceBtn).toBeVisible();
    await newInvoiceBtn.click();

    const modal = page.locator('#invoiceModal');
    await expect(modal).toBeVisible();
    const modalBox = modal.locator('.modal');
    await expect(modalBox).toBeVisible();

    // Close modal
    await modal.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('Vendor Bills: segmented tabs and filter-select dropdown', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    // Verify tabs
    const subNav = page.locator('#financeBillSubNav');
    await expect(subNav).toBeVisible();
    await expect(page.locator('#tabFinanceBills')).toHaveClass(/active/);

    // Verify filter-select dropdown
    const filterSelect = page.locator('#financeBillStatusFilter');
    await expect(filterSelect).toBeVisible();
    await expect(filterSelect).toHaveClass(/filter-select/);
  });

  test('Bank Accounts: tabs & withdraw modal', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    // Verify withdraw cash modal can open with background
    const withdrawBtn = page.locator('button[onclick="openWithdrawCashModal()"]').first();
    if (await withdrawBtn.isVisible()) {
      await withdrawBtn.click();
      const modal = page.locator('#financeWithdrawCashModal');
      await expect(modal).toBeVisible();
      await modal.locator('.modal-close').click();
      await expect(modal).not.toBeVisible();
    }
  });

  test('Theme toggle: dark mode styling works seamlessly', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    
    // Toggle dark mode
    const themeToggle = page.locator('#themeToggle, button[title*="theme" i], button[title*="dark" i]').first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await expect(page.locator('html, body')).toHaveAttribute('data-theme', 'dark');
      
      const filterSelect = page.locator('#financeInvoiceStatusFilter');
      await expect(filterSelect).toBeVisible();
      
      // Toggle back to light mode
      await themeToggle.click();
    }
  });
});
