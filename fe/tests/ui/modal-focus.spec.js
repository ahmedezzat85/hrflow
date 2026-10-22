import { test, expect } from '@playwright/test';

// ModalController moves focus into a dialog 45 ms after it opens. It must do that for a user who has not
// touched the dialog yet, and must NOT move focus away from a field the user (or autofill, or a test) already
// focused inside the dialog: that used to send keystrokes to the wrong field.
async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
}

test.describe('dialog initial focus', () => {
  test('moves focus to the first field when nothing inside the dialog is focused', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openEmployeeModal());
    await expect(page.locator('#employeeModal #fEmpName')).toBeFocused();
  });

  test('leaves focus alone when a field inside the dialog was focused before the delayed focus runs', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => {
      openEmployeeModal();
      document.getElementById('fEmpEmail').focus();   // the user started on another field right away
    });
    await page.waitForTimeout(300);                    // well past the 45 ms auto-focus
    await expect(page.locator('#employeeModal #fEmpEmail')).toBeFocused();
  });

  test('typing right after opening lands in the intended field', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => { openEmployeeModal(); document.getElementById('fEmpLegalName').focus(); });
    await page.keyboard.type('Laila Ahmed Hassan Ali');
    await page.waitForTimeout(200);
    await expect(page.locator('#fEmpLegalName')).toHaveValue('Laila Ahmed Hassan Ali');
    await expect(page.locator('#fEmpName')).toHaveValue('Laila Ali');   // pre-filled from the legal name, not typed into
  });
});
