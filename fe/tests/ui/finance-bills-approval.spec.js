import { test, expect } from '@playwright/test';

async function selectBillQueue(page, tabSelector) {
  const panel = page.locator('#financeBillStatusPanel');
  if (!(await panel.isVisible())) {
    await page.click('#financeBillChangeViewBtn');
    await expect(panel).toBeVisible();
  }
  await page.click(tabSelector);
}

test.describe('Story 4.2 — Bill approval and payment', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 1: Bill in needs_approval cannot be scheduled or paid before approval', async ({ page }) => {
    // Switch to Needs Approval queue tab
    await selectBillQueue(page, '#tabBillQueueApproval');
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")');
    await expect(billRow).toBeVisible();

    // Verify "Approve" button is present on the unapproved bill
    const approveBtn = billRow.locator('button.btn-approve-bill');
    await expect(approveBtn).toBeVisible();

    // Verify "Pay" and "Schedule" buttons are NOT present while bill is in needs_approval
    const payBtn = billRow.locator('button.btn-pay-bill');
    await expect(payBtn).not.toBeVisible();
    const scheduleBtn = billRow.locator('button.btn-schedule-bill');
    await expect(scheduleBtn).not.toBeVisible();
  });

  test('AC 2: Maker-checker segregation of duties and approval workflow', async ({ page }) => {
    // Filter to BILL-2026-005 in Needs Approval queue
    await selectBillQueue(page, '#tabBillQueueApproval');
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")');
    await expect(billRow).toBeVisible();

    // 1. Simulate current user being the creator (creator@voyance.health)
    await page.evaluate(() => {
      window.currentUser = { email: 'creator@voyance.health', role: 'admin' };
    });

    // Click Approve button to open modal
    await billRow.locator('button.btn-approve-bill').click();
    await expect(page.locator('#billApprovalModal')).toBeVisible();

    // Verify segregation of duties warning is displayed and submit is disabled
    const warningBanner = page.locator('#billApprovalSelfWarningBanner');
    await expect(warningBanner).toBeVisible();
    expect(await warningBanner.innerText()).toContain('Segregation of Duties Enforced');
    const submitBtn = page.locator('#billApprovalSubmitBtn');
    await expect(submitBtn).toBeDisabled();

    // Close modal
    await page.click('#billApprovalModal .modal-close');
    await expect(page.locator('#billApprovalModal')).not.toBeVisible();

    // 2. Switch to an independent approver (manager@voyance.health)
    await page.evaluate(() => {
      window.currentUser = { email: 'manager@voyance.health', role: 'admin' };
    });

    // Open approval modal again
    await billRow.locator('button.btn-approve-bill').click();
    await expect(page.locator('#billApprovalModal')).toBeVisible();
    await expect(page.locator('#billApprovalSelfWarningBanner')).not.toBeVisible();
    await expect(submitBtn).not.toBeDisabled();

    // Test rejection comment requirement: switch to reject without comment
    await page.selectOption('#billApprovalDecision', 'reject');
    await page.click('#billApprovalSubmitBtn');
    // Error toast shown, modal stays open
    await expect(page.locator('#billApprovalModal')).toBeVisible();

    // Now switch back to approve with valid limit
    await page.selectOption('#billApprovalDecision', 'approve');
    await page.fill('#billApproverLimit', '50000');
    await page.fill('#billApprovalComment', 'Approved after PO validation');
    await page.click('#billApprovalSubmitBtn');

    // Modal closes upon successful approval
    await expect(page.locator('#billApprovalModal')).not.toBeVisible();

    // Switch to Ready to Pay queue and verify the bill transitioned
    await selectBillQueue(page, '#tabBillQueueReady');
    const approvedRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-005")');
    await expect(approvedRow).toBeVisible();

    // Pay and Schedule buttons are now available!
    await expect(approvedRow.locator('button.btn-pay-bill')).toBeVisible();
    await expect(approvedRow.locator('button.btn-schedule-bill')).toBeVisible();
  });

  test('AC 3: Overpayment prevention, partial payment, and balance tracking', async ({ page }) => {
    // Switch to All queue and locate BILL-2026-001 (total: $4,200.00)
    await selectBillQueue(page, '#tabBillQueueAll');
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(billRow).toBeVisible();

    // Click Pay button
    await billRow.locator('button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentModal')).toBeVisible();

    // Verify balance breakdown cards
    await expect(page.locator('#billPaymentTotalDisplay')).toHaveText(/4,200/);
    await expect(page.locator('#billPaymentRemainingDisplay')).toHaveText(/4,200/);

    // 1. Attempt overpayment of $5,000 (exceeds remaining balance of $4,200)
    await page.fill('#billPaymentAmount', '5000');
    await page.selectOption('#billPaymentBankAccountId', { index: 1 });
    await page.click('#billPaymentSubmitBtn');

    // Overpayment blocked, modal remains visible
    await expect(page.locator('#billPaymentModal')).toBeVisible();

    // 2. Record a valid partial payment of $1,500
    await page.fill('#billPaymentAmount', '1500');
    await page.fill('#billPaymentReference', 'WIRE-PARTIAL-101');
    await page.click('#billPaymentSubmitBtn');

    // Modal closes
    await expect(page.locator('#billPaymentModal')).not.toBeVisible();

    // Verify the bill is now displayed with updated balance
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();

    // Reopen Payment modal to verify remaining balance was deducted
    await page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001") button.btn-pay-bill').click();
    await expect(page.locator('#billPaymentModal')).toBeVisible();

    await expect(page.locator('#billPaymentPaidDisplay')).toHaveText(/1,500/);
    await expect(page.locator('#billPaymentRemainingDisplay')).toHaveText(/2,700/);
    await page.click('#billPaymentModal .modal-close');
  });

  test('AC 4: Schedule approved bill and reverse recorded payment', async ({ page }) => {
    // 1. Schedule BILL-2026-001
    await selectBillQueue(page, '#tabBillQueueAll');
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(billRow).toBeVisible();

    await billRow.locator('button.btn-schedule-bill').click();
    await expect(page.locator('#billScheduleModal')).toBeVisible();
    await expect(page.locator('#billScheduleBillNumber')).toHaveText('BILL-2026-001');

    await page.fill('#billScheduledPaymentDate', '2026-09-28');
    await page.fill('#billScheduleNotes', 'Batch pay at end of month');
    await page.click('#billScheduleSubmitBtn');
    await expect(page.locator('#billScheduleModal')).not.toBeVisible();

    // 2. View bill detail drawer and verify payments with reversal capability
    // BILL-2026-002 has a recorded payment
    const billSlack = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")');
    await expect(billSlack).toBeVisible();
    await billSlack.locator('button.btn-view-bill').click();

    await expect(page.locator('#financeDetailDrawerOverlay')).toBeVisible();
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('BILL-2026-002');

    // Switch to Related tab where payments are listed
    await page.click('#financeDrawerTablist [data-drawer-tab="related"]');
    const paymentCard = page.locator('#financeDrawerRelatedList .related-record-card:has-text("Payment")').first();
    await expect(paymentCard).toBeVisible();

    // Verify Reverse button is available
    const reverseBtn = paymentCard.locator('button.btn-reverse-payment');
    await expect(reverseBtn).toBeVisible();

    // Accept prompt for reversal
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Enter reason for reversing payment');
      await dialog.accept('Duplicate batch transmission reversal');
    });

    await reverseBtn.click();

    // Verify reversal reflected
    await expect(page.locator('#financeDrawerRelatedList')).toContainText('REVERSED');
  });
});
