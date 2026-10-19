import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock cheque scan') });

test.describe('X1: Cheque scans and entry shortcuts (D-032)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-accounts');
    await page.click('#subtabFinanceCheques');
    await expect(page.locator('#financeSubPaneCheques')).toBeVisible();
  });

  test('missing-scan filter, upload from the scans dialog, and delete', async ({ page }) => {
    const rows = page.locator('#financeChequesTableBody tr');
    const row1 = page.locator('#financeChequesTableBody tr:has-text("001011")');
    const row2 = page.locator('#financeChequesTableBody tr:has-text("001012")');

    await expect(row1.locator('.btn-cheque-scans')).toContainText('1 scan');
    await expect(row2.locator('.btn-cheque-scans')).toContainText('Scan missing');

    // Filter: Scan missing -> only the cheque without a scan
    await page.selectOption('#financeChequeScanFilter', 'false');
    await expect(rows).toHaveCount(1);
    await expect(row2).toBeVisible();

    // Upload a scan from the dialog
    await row2.locator('.btn-cheque-scans').click();
    await expect(page.locator('#financeChequeScansModal')).toBeVisible();
    await expect(page.locator('#chequeScansEmpty')).toBeVisible();
    await page.setInputFiles('#chequeScansAddInput', pdf('chq-1012.pdf'));
    await expect(page.locator('#chequeScansList li')).toHaveCount(1);
    await expect(page.locator('#chequeScansList')).toContainText('chq-1012.pdf');

    // Download works from the list
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#chequeScansList .btn-scan-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe('chq-1012.pdf');

    await page.click('#financeChequeScansModal button:has-text("Close")');
    await expect(page.locator('#financeChequeScansModal')).not.toBeVisible();

    // Row left the missing-scan filter
    await expect(rows).toHaveCount(0);
    await page.selectOption('#financeChequeScanFilter', 'true');
    await expect(rows).toHaveCount(2);

    // Delete it again -> flagged missing
    await row2.locator('.btn-cheque-scans').click();
    await page.locator('#chequeScansList .btn-scan-delete').click();
    await expect(page.locator('#chequeScansEmpty')).toBeVisible();
    await page.click('#financeChequeScansModal button:has-text("Close")');
    await expect(page.locator('#financeChequeScansModal')).not.toBeVisible();
    await page.selectOption('#financeChequeScanFilter', '');
    await expect(row2.locator('.btn-cheque-scans')).toContainText('Scan missing');
  });

  test('issue dialog suggests the next number and uploads queued scans after save', async ({ page }) => {
    await page.click('button:has-text("Issue cheque")');
    await expect(page.locator('#financeChequeModal')).toBeVisible();

    // Next number: last numeric serial on account 1 is 001012 -> 001013 (zero padding kept)
    await page.selectOption('#chequeAccountId', { index: 1 });
    await expect(page.locator('#chequeNumber')).toHaveValue('001013');

    // Queue two scans, then remove one
    await page.setInputFiles('#chequeScanInput', [pdf('front.pdf'), pdf('back.pdf')]);
    await expect(page.locator('#chequeScanQueue li')).toHaveCount(2);
    await page.locator('#chequeScanQueue li:has-text("back.pdf") button').click();
    await expect(page.locator('#chequeScanQueue li')).toHaveCount(1);

    await page.fill('#chequePayee', 'Scan Test Payee');
    await page.fill('#chequeAmount', '250');
    await page.click('#chequeModalSaveBtn');
    await expect(page.locator('#financeChequeModal')).not.toBeVisible();

    const created = page.locator('#financeChequesTableBody tr:has-text("001013")');
    await expect(created).toBeVisible();
    await expect(created.locator('.btn-cheque-scans')).toContainText('1 scan');
  });

  test('a typed cheque number is not overwritten by the suggestion', async ({ page }) => {
    await page.click('button:has-text("Issue cheque")');
    await page.fill('#chequeNumber', 'MANUAL-9');
    await page.selectOption('#chequeAccountId', { index: 1 });
    await expect(page.locator('#chequeNumber')).toHaveValue('MANUAL-9');
    await page.click('#financeChequeModal button:has-text("Cancel")');
    await expect(page.locator('#financeChequeModal')).not.toBeVisible();
  });

  test('selecting a linked bill prefills payee, open balance and currency', async ({ page }) => {
    await page.click('button:has-text("Issue cheque")');
    await page.selectOption('#chequePurposeType', 'vendor_payment');
    const bill = page.locator('#chequeLinkedBillId option:not([value=""])').first();
    await expect(bill).toBeAttached();
    const label = await bill.textContent();
    const open = label.match(/([A-Z]{3}) ([\d.]+) open/);
    expect(open).not.toBeNull();
    await page.selectOption('#chequeLinkedBillId', { index: 1 });
    await expect(page.locator('#chequePayee')).not.toHaveValue('');
    await expect(page.locator('#chequeAmount')).toHaveValue(open[2]);
    await expect(page.locator('#chequeCurrency')).toHaveValue(open[1]);
    await page.click('#financeChequeModal button:has-text("Cancel")');
    await expect(page.locator('#financeChequeModal')).not.toBeVisible();
  });
});
