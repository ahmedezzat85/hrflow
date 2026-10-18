import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('X4: Revenue sources and revenue receipts (D-029)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Settings > Revenue sources: seeded list, add, system source cannot be deactivated', async ({ page }) => {
    await openAdminPage(page, 'a-finance-settings');
    await page.click('#subtabSettingsRevenueSources');
    await expect(page.locator('#financeSettingsPaneRevenueSources')).toBeVisible();
    const body = page.locator('#financeRevenueSourcesTableBody');
    await expect(body.locator('tr')).toHaveCount(5);
    await expect(body).toContainText('Stripe payout');
    // the Invoice source has no deactivate action
    await expect(body.locator('tr:has-text("Invoice") .btn-source-toggle')).toHaveCount(0);

    await page.click('#financeAddRevenueSourceBtn');
    await page.fill('#fRevenueSourceName', 'Marketplace payout');
    await page.fill('#fRevenueSourceCode', 'marketplace_payout');
    await page.click('#revenueSourceSaveBtn');
    await expect(page.locator('#revenueSourceModal')).not.toBeVisible();
    await expect(body.locator('tr')).toHaveCount(6);

    await body.locator('tr:has-text("Marketplace payout") .btn-source-toggle').click();
    await expect(body.locator('tr:has-text("Marketplace payout")')).toContainText('Inactive');
  });

  test('Record revenue receipt: posts to the account, same-currency rule, memo fields do not move the balance', async ({ page }) => {
    await openAdminPage(page, 'a-finance-accounts');
    await expect(page.locator('#financeAccountsTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await page.click('#btnRecordRevenueReceipt');
    await expect(page.locator('#revenueReceiptModal')).toBeVisible();

    // Source list has no Invoice (invoice receipts are recorded on the invoice)
    const sources = await page.locator('#fReceiptSource option').allTextContents();
    expect(sources).not.toContain('Invoice');
    expect(sources).toContain('Stripe payout');

    await page.selectOption('#fReceiptAccount', { label: 'Voyance Overseas USD (USD · Overseas)' });
    await expect(page.locator('#fReceiptCurrency')).toHaveText('(USD)');
    await page.fill('#fReceiptAmount', '90');
    await page.fill('#fReceiptGross', '100');
    await page.fill('#fReceiptFee', '10');
    await page.selectOption('#fReceiptSource', { label: 'Stripe payout' });
    await page.selectOption('#fReceiptProduct', { label: 'HRFlow Cloud (SaaS)' });
    await page.click('#revenueReceiptSaveBtn');
    await expect(page.locator('#revenueReceiptModal')).not.toBeVisible();

    // 30,000 opening + 90 received (memo gross and fees are not posted)
    const overseas = page.locator('#financeAccountsTableBody tr:has-text("Voyance Overseas USD")');
    await expect(overseas).toContainText('30,090');

    // the breakdown carries the new receipt under its product, source and book
    const bd = await page.evaluate(() => FinanceApi.getRevenueBreakdown({ book: 'overseas', currency: 'USD' }));
    const stripe = bd.rows.filter((r) => r.source === 'Stripe payout' && r.product_name === 'HRFlow Cloud (SaaS)');
    expect(stripe.reduce((s, r) => s + r.amount, 0)).toBe(4090);
    expect(bd.totals_by_currency.USD).toBe(14090);
  });

  test('a receipt for an account in another currency is refused', async ({ page }) => {
    const err = await page.evaluate(async () => {
      try {
        await FinanceApi.createRevenueReceipt({ account_id: 5, date: '2026-09-30', amount: 10, currency: 'EGP', revenue_source_id: 2 });
        return null;
      } catch (e) { return e.message; }
    });
    expect(err).toContain('must match the account currency');
  });
});
