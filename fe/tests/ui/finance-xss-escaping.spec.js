import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Stored XSS (audit 2026-11, H-5): names people type (customers, bank accounts) are shown as text, never run as markup.
// The payload would set window.__xss if any of these renderers put it into innerHTML unescaped.
const PAYLOAD = '<img src=x onerror="window.__xss=1">Evil & Co';

test.describe('Finance names are escaped, not executed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible();
  });

  test('a customer name with markup appears literally in the invoice customer dropdown', async ({ page }) => {
    await page.evaluate((name) => {
      FinanceMockState.customers.push({ id: 9901, name, is_active: true, default_currency: 'USD' });
    }, PAYLOAD);
    await page.evaluate(() => _populateInvoiceCustomerDropdown());

    const option = page.locator('#invoiceCustomerId option[value="9901"]');
    await expect(option).toHaveCount(1);
    expect(await option.textContent()).toBe(PAYLOAD);
    await expect(page.locator('#invoiceCustomerId img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('a bank account name with markup appears literally in the expected-account dropdown', async ({ page }) => {
    await page.evaluate((name) => {
      FinanceMockState.accounts.push({ id: 9902, account_name: name, currency: 'USD', account_type: 'bank', is_active: true, current_balance: 0 });
    }, PAYLOAD);
    await page.evaluate(() => _populateInvoiceBankDropdown());

    const option = page.locator('#invoiceExpectedBankAccount option[value="9902"]');
    await expect(option).toHaveCount(1);
    expect(await option.textContent()).toContain(PAYLOAD);
    await expect(page.locator('#invoiceExpectedBankAccount img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});
