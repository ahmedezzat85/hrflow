import { test, expect } from '@playwright/test';

// Regression: a dialog must open again after it was closed, in the same page load.
// ModalController.close leaves an inline display:none, so every opener has to go through openModal
// (a bare classList.add('active') left the dialog hidden until a page refresh).
const OPENERS = [
  ['employeeModal', "openEmployeeModal('EMP001')"],
  ['confirmModal', "askDelete('EMP001')"],
  ['behalfVacationModal', "openBehalfVacationModal('EMP001')"],
  ['behalfClaimModal', "openBehalfClaimModal('EMP001')"],
  ['employeeDocumentModal', 'openEmployeeDocumentModal()'],
  ['socialInsuranceModal', 'openSocialInsuranceModal()'],
  ['categoryModal', 'openCategoryModal()'],
  ['invoicePeriodModal', 'openInvoicePeriodModal()'],
  ['regenerateInvoiceModal', "openRegenerateInvoiceModal('EMP001', 'Sarah Connor', 2026, 8, '260208')"],
  ['raiseModal', "openRaiseModal('EMP001')"],
  ['companyDocumentModal', 'openCompanyDocumentModal()'],
  ['compensationPlanModal', "openCompPlanModal('EMP001')"],
];

test.describe('dialogs reopen after closing', () => {
  for (const [id, call] of OPENERS) {
    test(id, async ({ page }) => {
      await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
      await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
      await page.evaluate(() => { currentDetailEmployeeId = 'EMP001'; });
      const dialog = page.locator(`#${id}`);
      for (let round = 1; round <= 2; round += 1) {
        await page.evaluate((expr) => eval(expr), call);
        await expect(dialog, `${id} open #${round}`).toBeVisible();
        await page.evaluate((m) => closeModal(m), id);
        await expect(dialog, `${id} closed #${round}`).toBeHidden();
      }
    });
  }

  test('document preview opens, closes through its Close button, and opens again', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    const dialog = page.locator('#documentPreviewModal');
    for (let round = 1; round <= 2; round += 1) {
      await page.evaluate(() => openModal('documentPreviewModal'));
      await expect(dialog).toBeVisible();
      await page.evaluate(() => closeDocumentPreview());
      await expect(dialog).toBeHidden();
    }
  });
});
