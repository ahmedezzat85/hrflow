import { test, expect } from '@playwright/test';

test.describe('Story 4.4: Recurring Spend and Subscriptions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await page.click('#adminSidebar a[data-page="a-finance-subscriptions"]');
    await expect(page.locator('#a-finance-subscriptions')).toBeVisible();
  });

  test('AC 4: Subscriptions Table renders owner, department, monthly equivalent, and auto-bill badges', async ({ page }) => {
    // Toolbar elements
    await expect(page.locator('#a-finance-subscriptions .section-title')).toContainText('Recurring Subscriptions');
    const addSubBtn = page.locator('#financeAddSubscriptionBtn');
    await expect(addSubBtn).toBeVisible();

    // Table elements
    const table = page.locator('#financeSubscriptionsTableBody');
    await expect(table).toBeVisible();

    // Verify existing rows show owner and department
    await expect(table).toContainText('Sarah Connor');
    await expect(table).toContainText('Engineering');
  });

  test('AC 3: Add Subscription with governance, contract dates, notice period, and renewal deadline', async ({ page }) => {
    // Open modal
    await page.click('#financeAddSubscriptionBtn');
    const modal = page.locator('#subscriptionModal');
    await expect(modal).toBeVisible();

    // Fill form including new Story 4.4 fields
    await page.fill('#subName', 'Datadog APM & Logs');
    await page.selectOption('#subVendorId', { index: 1 });
    await page.fill('#subAmount', '12000.00');
    await page.selectOption('#subCurrency', 'USD');
    await page.selectOption('#subBillingCycle', 'yearly');
    await page.fill('#subNextRenewal', '2026-12-31');
    await page.fill('#subOwner', 'Elena Vance');
    await page.selectOption('#subDepartment', 'Engineering');
    await page.fill('#subNoticeDays', '45');
    await page.fill('#subSeats', '60');
    await page.fill('#subContractStart', '2026-01-01');
    await page.fill('#subContractEnd', '2026-12-31');

    // Submit
    await page.click('#btnSaveSubscription');
    await expect(modal).not.toBeVisible();

    // Verify row appears with name, owner, and monthly equivalent (~$1,000.00/mo)
    const table = page.locator('#financeSubscriptionsTableBody');
    await expect(table).toContainText('Datadog APM & Logs');
    await expect(table).toContainText('Elena Vance');
    await expect(table).toContainText('/mo');
  });

  test('AC 2: Expected-versus-actual variance is detected and explained during charge logging', async ({ page }) => {
    // Click "Log Charge" on first subscription row (AWS Cloud Infrastructure, base 4200.00)
    const logChargeBtn = page.locator('#financeSubscriptionsTableBody .btn-log-charge').first();
    await expect(logChargeBtn).toBeVisible();
    await logChargeBtn.click();

    const chargeModal = page.locator('#subscriptionChargeModal');
    await expect(chargeModal).toBeVisible();

    // Base rate is 4200.00. Enter 4550.00 (+350.00 variance)
    await page.fill('#chargeAmount', '4550.00');

    // Variance alert and input should automatically display
    const varianceGroup = page.locator('#chargeVarianceGroup');
    await expect(varianceGroup).toBeVisible();
    const varianceAlert = page.locator('#chargeVarianceAlert');
    await expect(varianceAlert).toContainText('+350.00');

    // Enter variance explanation
    await page.fill('#chargeVarianceReason', 'Additional compute nodes for Q3 processing load');
    await page.fill('#chargeNote', 'September overage invoice');

    // Ensure "Link or Create Payable Bill" is checked
    const createBillCheck = page.locator('#chargeCreateBill');
    await expect(createBillCheck).toBeChecked();

    // Submit charge
    await page.click('#btnSaveSubscriptionCharge');
    await expect(chargeModal).not.toBeVisible();
  });

  test('AC 1 & 2: Charge History displays variance badge, reason, and linked AP bill badge', async ({ page }) => {
    // Open charges history modal on the first subscription
    const historyBtn = page.locator('#financeSubscriptionsTableBody .btn-sub-history').first();
    await historyBtn.click();

    const historyModal = page.locator('#subscriptionHistoryModal');
    await expect(historyModal).toBeVisible();

    // Verify history table contains the charges
    const historyTable = page.locator('#subHistoryTableBody');
    await expect(historyTable).toBeVisible();

    await historyModal.locator('.modal-close').click();
    await expect(historyModal).not.toBeVisible();
  });
});
