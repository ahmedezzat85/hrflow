import { test, expect } from '@playwright/test';

test.describe('Finance Subscriptions & Charges UI Testing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Subscriptions Page: renders table, navigation, and Add Subscription button', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-subscriptions"]');
    await expect(page.locator('#a-finance-subscriptions')).toBeVisible();

    // Toolbar elements
    await expect(page.locator('#a-finance-subscriptions .section-title')).toContainText('Recurring Subscriptions');
    const addSubBtn = page.locator('#financeAddSubscriptionBtn');
    await expect(addSubBtn).toBeVisible();

    // Table elements
    const table = page.locator('#financeSubscriptionsTableBody');
    await expect(table).toBeVisible();
  });

  test('Add Subscription: opens modal, fills form, and creates subscription', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-subscriptions"]');
    await expect(page.locator('#a-finance-subscriptions')).toBeVisible();

    // Open modal
    await page.click('#financeAddSubscriptionBtn');
    const modal = page.locator('#subscriptionModal');
    await expect(modal).toBeVisible();

    // Fill form
    await page.fill('#subName', 'GitHub Enterprise');
    await page.selectOption('#subVendorId', { index: 1 });
    await page.fill('#subAmount', '840.00');
    await page.selectOption('#subCurrency', 'USD');
    await page.selectOption('#subBillingCycle', 'monthly');
    await page.fill('#subNextRenewal', '2026-10-01');

    // Submit
    await page.click('#btnSaveSubscription');
    await expect(modal).not.toBeVisible();

    // Verify row appears
    await expect(page.locator('#financeSubscriptionsTableBody')).toContainText('GitHub Enterprise');
  });

  test('Log Charge: opens modal from subscription row, logs charge with notes', async ({ page }) => {
    await page.click('#adminSidebar a[data-page="a-finance-subscriptions"]');
    await expect(page.locator('#a-finance-subscriptions')).toBeVisible();

    // Click "Log Charge" button on first subscription row
    const logChargeBtn = page.locator('#financeSubscriptionsTableBody .btn-log-charge').first();
    await expect(logChargeBtn).toBeVisible();
    await logChargeBtn.click();

    const chargeModal = page.locator('#subscriptionChargeModal');
    await expect(chargeModal).toBeVisible();

    // Fill charge details
    await page.fill('#chargeAmount', '450.00');
    await page.fill('#chargeNote', 'September compute overage');
    
    // Submit charge
    await page.click('#btnSaveSubscriptionCharge');
    await expect(chargeModal).not.toBeVisible();

    // Open charges history drawer / modal
    const historyBtn = page.locator('#financeSubscriptionsTableBody .btn-sub-history').first();
    await historyBtn.click();

    const historyModal = page.locator('#subscriptionHistoryModal');
    await expect(historyModal).toBeVisible();
    await expect(historyModal).toContainText('September compute overage');

    await historyModal.locator('.modal-close').click();
    await expect(historyModal).not.toBeVisible();
  });
});
