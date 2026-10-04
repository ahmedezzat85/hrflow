/**
 * Confirms the shared in-app confirmation dialog (FinanceCommand.confirmAction).
 * Replaces the native window.confirm()/prompt() dialogs that were removed in U5.
 * @param {import('@playwright/test').Page} page
 * @param {string} [reason] filled in when the dialog asks for a reason
 */
export async function confirmDialog(page, reason) {
  const modal = page.locator('#financeConfirmModal');
  await modal.waitFor({ state: 'visible', timeout: 5000 });
  if (reason !== undefined) await page.fill('#financeConfirmReason', reason);
  await page.click('#financeConfirmSubmitBtn');
  await modal.waitFor({ state: 'hidden', timeout: 5000 });
}
