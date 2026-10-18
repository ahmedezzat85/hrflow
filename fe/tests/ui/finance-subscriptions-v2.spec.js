import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('X5: Subscriptions v2 (D-031)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-subscriptions');
    await expect(page.locator('#financeSubscriptionsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows the charge waiting to be settled and the Paid from book column', async ({ page }) => {
    await expect(page.locator('#financeBookSwitcherSubscriptions [data-book="consolidated"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#subChgCountExpected')).toHaveText('1');
    const row = page.locator('#financeSubChargesBody tr').first();
    await expect(row).toContainText('Slack Business+');
    await expect(row.locator('.fv-note--late')).toContainText('Not settled');
    await expect(page.locator('#financeSubscriptionsTableBody tr').first().locator('[data-book-chip]')).toContainText('Local');

    // the Overseas view has no subscriptions paid from an overseas account
    await page.locator('#financeBookSwitcherSubscriptions [data-book="overseas"]').click();
    await expect(page.locator('#financeSubscriptionsEmpty')).toBeVisible();
    await page.locator('#financeBookSwitcherSubscriptions [data-book="consolidated"]').click();
    await expect(page.locator('#financeSubscriptionsTableBody tr').first()).toBeVisible();
  });

  test('settle as an Already paid bill advances the renewal and leaves the to-settle list', async ({ page }) => {
    const renewalBefore = await page.evaluate(() => FinanceMockState.subscriptions.find((s) => s.id === 2).next_renewal_date);
    await page.locator('#financeSubChargesBody tr .btn-charge-settle').click();
    await expect(page.locator('#subSettleModal')).toBeVisible();
    await page.selectOption('#subSettleMode', 'already_paid_bill');
    await expect(page.locator('#subSettleAccountGroup')).toBeVisible();
    await page.fill('#subSettleAmount', '350');
    await page.fill('#subSettleVarianceReason', 'Extra seats');
    await page.click('#subSettleSaveBtn');
    await expect(page.locator('#subSettleModal')).not.toBeVisible();
    await expect(page.locator('#subChgCountExpected')).toHaveText('0');
    await expect(page.locator('#financeSubChargesEmpty')).toBeVisible();
    const result = await page.evaluate(() => ({
      renewal: FinanceMockState.subscriptions.find((s) => s.id === 2).next_renewal_date,
      charge: FinanceMockState.subscriptionCharges.find((c) => c.id === 3),
    }));
    expect(result.renewal > renewalBefore).toBe(true);
    expect(result.charge.status).toBe('settled');
    expect(result.charge.variance_amount).toBe(30);
  });

  test('proofs missing are listed, never block, and can be marked unavailable with a reason', async ({ page }) => {
    await page.click('#financeSubChargePills [data-filter="proofs_missing"]');
    const rows = page.locator('#financeSubChargesBody tr');
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    await rows.first().locator('.btn-charge-proof').click();
    await expect(page.locator('#subProofModal')).toBeVisible();
    // a reason is required
    await page.click('#subProofUnavailableBtn');
    await expect(page.locator('#subProofModal')).toBeVisible();
    await page.fill('#subProofReason', 'The vendor portal is down');
    await page.click('#subProofUnavailableBtn');
    await expect(page.locator('#subProofModal')).not.toBeVisible();
    await expect(page.locator('#subChgCountProofs')).toHaveText(String(before - 1));
  });

  test('skipping needs a reason and removes the charge from the list', async ({ page }) => {
    await page.locator('#financeSubChargesBody tr .btn-charge-skip').click();
    await page.fill('#financeConfirmReason', 'Seat removed this month');
    await page.click('#financeConfirmSubmitBtn');
    await expect(page.locator('#subChgCountExpected')).toHaveText('0');
    const status = await page.evaluate(() => FinanceMockState.subscriptionCharges.find((c) => c.id === 3).status);
    expect(status).toBe('skipped');
  });

  test('the subscription dialog carries Paid from, billing email and proof settings', async ({ page }) => {
    await page.click('#financeAddSubscriptionBtn');
    await expect(page.locator('#subscriptionModal')).toBeVisible();
    await expect(page.locator('#subPaymentAccount')).toBeVisible();
    await expect(page.locator('#subBillingEmail')).toBeVisible();
    await expect(page.locator('#subProofSource option')).toHaveCount(4);
    await expect(page.locator('#subProofExpected')).toBeChecked();
    await page.click('#subscriptionModal button:has-text("Cancel")');
  });
});
