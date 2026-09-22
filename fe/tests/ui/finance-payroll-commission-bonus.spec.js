import { test, expect } from '@playwright/test';

test.describe('FUX-418: Commission & Bonus Entry within a Payroll Run', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Payroll section
    await page.click('#adminSidebar a[data-page="a-finance-payroll"]');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
  });

  test('Adds commission & bonus lines in draft run, recalculates aggregates, deletes line, and enforces locking', async ({ page }) => {
    // 1. Launch Wizard to create a new draft run
    await page.click('#btnRunPayrollWizard');
    const wizardModal = page.locator('#runPayrollWizardModal');
    await expect(wizardModal).toBeVisible();

    await page.fill('#wizardPeriodLabel', '2026-11');
    // Advance steps 1 -> 2 -> 3 -> 4
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep2')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep3')).toBeVisible();
    await page.click('#wizardNextBtn');
    await expect(page.locator('#wizardStep4')).toBeVisible();

    // Create Draft Run (we will create it and leave it in draft to test FUX-418 ad-hoc additions)
    await page.click('#btnWizardSaveDraft');

    // Run detail modal should open
    const detailModal = page.locator('#payrollRunDetailModal');
    await expect(detailModal).toBeVisible();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('DRAFT');

    // 2. In draft run, "Add Commission / Bonus" toolbar button is visible
    const addBonusToolbarBtn = page.locator('#btnRunDetailAddBonus');
    await expect(addBonusToolbarBtn).toBeVisible();

    const initialNetText = await page.locator('#runDetailNet').textContent();
    const initialNet = parseFloat(initialNetText.replace(/[^0-9.]/g, ''));

    // 3. Open Add Bonus Modal from toolbar
    await addBonusToolbarBtn.click();
    const bonusModal = page.locator('#payrollAddBonusModal');
    await expect(bonusModal).toBeVisible();

    // Select employee, type Sales Commission, amount 750, note
    await page.selectOption('#bonusCompensationType', 'commission_sales');
    await page.fill('#bonusAmount', '750.00');
    await page.fill('#bonusNotes', 'Q3 Sales Milestone Commission');

    // Select Sarah Connor (employee 1)
    const empOptions = await page.locator('#bonusEmployeeSelect option').allTextContents();
    expect(empOptions.length).toBeGreaterThan(1);
    await page.selectOption('#bonusEmployeeSelect', { index: 1 });

    // Submit modal
    await page.click('#btnSubmitAddBonus');
    await expect(bonusModal).not.toBeVisible();

    // 4. Verify Sales Commission badge and row in lines table
    const salesBadge = page.locator('#runDetailLinesTableBody .badge:has-text("Sales Commission")');
    await expect(salesBadge).toBeVisible();

    // Verify net increased by 750
    const netAfterSalesText = await page.locator('#runDetailNet').textContent();
    const netAfterSales = parseFloat(netAfterSalesText.replace(/[^0-9.]/g, ''));
    expect(netAfterSales).toBeCloseTo(initialNet + 750.0, 1);

    // 5. Add second variable line: Discretionary Bonus via per-row action button
    const rowAddBtn = page.locator('#runDetailLinesTableBody tr:has-text("Sarah Connor") .btn-add-bonus').first();
    await rowAddBtn.click();
    await expect(bonusModal).toBeVisible();

    await page.selectOption('#bonusCompensationType', 'bonus');
    await page.fill('#bonusAmount', '300.00');
    await page.fill('#bonusNotes', 'Discretionary spot bonus');
    await page.click('#btnSubmitAddBonus');
    await expect(bonusModal).not.toBeVisible();

    // Verify Bonus badge appears
    const bonusBadge = page.locator('#runDetailLinesTableBody .badge:has-text("Bonus")');
    await expect(bonusBadge).toBeVisible();

    const netAfterBonusText = await page.locator('#runDetailNet').textContent();
    const netAfterBonus = parseFloat(netAfterBonusText.replace(/[^0-9.]/g, ''));
    expect(netAfterBonus).toBeCloseTo(netAfterSales + 300.0, 1);

    // 6. Delete the bonus line
    page.on('dialog', (dialog) => dialog.accept());
    const bonusRow = page.locator('#runDetailLinesTableBody tr:has-text("Bonus")');
    await expect(bonusRow).toBeVisible();
    const deleteBonusBtn = bonusRow.locator('.btn-delete-line');
    await deleteBonusBtn.click();

    // Verify bonus line removed and total net reverted
    await expect(bonusBadge).not.toBeVisible();
    const netAfterDeleteText = await page.locator('#runDetailNet').textContent();
    const netAfterDelete = parseFloat(netAfterDeleteText.replace(/[^0-9.]/g, ''));
    expect(netAfterDelete).toBeCloseTo(netAfterSales, 1);

    // 7. Approve & Finalize run -> verify locking
    const approveBtn = detailModal.locator('#btnRunDetailApprove');
    await approveBtn.click();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('APPROVED');

    // In approved status, adding bonus button should be hidden
    await expect(addBonusToolbarBtn).not.toBeVisible();
    await expect(page.locator('#runDetailLinesTableBody .btn-delete-line')).toHaveCount(0);

    // Finalize run
    const finalizeBtn = detailModal.locator('#btnRunDetailFinalize');
    await finalizeBtn.click();
    await expect(detailModal.locator('#runDetailStatusBadge')).toContainText('FINALIZED');

    // In finalized status, adding bonus button and delete button remain hidden
    await expect(addBonusToolbarBtn).not.toBeVisible();
    await expect(page.locator('#runDetailLinesTableBody .btn-delete-line')).toHaveCount(0);

    // Clean teardown
    await page.click('#payrollRunDetailModal .modal-close');
    await expect(detailModal).not.toBeVisible();
  });
});
