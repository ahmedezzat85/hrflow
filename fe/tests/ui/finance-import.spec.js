import { test, expect } from '@playwright/test';
import { confirmDialog } from './helpers/confirm.js';
import { openAdminPage } from './helpers/admin-nav.js';

// Bulk / historical import (D-033, slice I2). Mock mode reads the manifest only; it cannot open the ZIP, so these
// tests cover the screen and its states, not the backend's file safety or permissions (backend tests do).
const HEADER = 'row_ref,source_file,confidence,review_flags,notes,vendor_name,bill_number,issue_date,due_date,currency,category,total_amount,description';
const csv = (...rows) => Buffer.from([HEADER, ...rows].join('\n'));
const ZIP = { name: 'package.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04 synthetic') };

const GOOD = 'B-0001,bill-0001.pdf,,,,Amazon Web Services,IMP-001,2026-04-10,2026-05-10,USD,,100.00,Hosting';
const UNKNOWN_VENDOR = 'B-0002,bill-0002.pdf,,,,Nobody Ltd,IMP-002,2026-04-10,2026-05-10,USD,,50.00,Misc';
const BAD_DATE = 'B-0003,bill-0003.pdf,,,,Slack Technologies,IMP-003,10/04/2026,2026-05-10,USD,,10.00,Seats';
const DUPLICATE = 'B-0004,bill-0004.pdf,,,,Slack Technologies,DUP-004,2026-04-10,2026-05-10,USD,,10.00,Seats';

async function openImport(page) {
  await page.goto('/?mock=admin');
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await openAdminPage(page, 'a-finance-settings');
  await page.click('#subtabSettingsImport');
  await expect(page.locator('#financeSettingsPaneImport')).toBeVisible();
}

async function chooseFiles(page, manifestBuffer, name = 'manifest.csv') {
  await page.setInputFiles('#financeImportManifest', { name, mimeType: 'text/csv', buffer: manifestBuffer });
  await page.setInputFiles('#financeImportArchive', ZIP);
}

test.describe('Finance Import screen (I2)', () => {
  test('shows the ledger notice, and the dry run needs both files', async ({ page }) => {
    await openImport(page);
    const notice = page.locator('#financeImportNotice');
    await expect(notice).toContainText('stay Drafts');
    await expect(notice).toContainText('posts a ledger entry');
    await expect(notice).toContainText('counted twice');
    await expect(page.locator('#financeImportDryRunBtn')).toBeDisabled();
    await page.setInputFiles('#financeImportManifest', { name: 'm.csv', mimeType: 'text/csv', buffer: csv(GOOD) });
    await expect(page.locator('#financeImportDryRunBtn')).toBeDisabled();
    await page.setInputFiles('#financeImportArchive', ZIP);
    await expect(page.locator('#financeImportDryRunBtn')).toBeEnabled();
    await expect(page.locator('#financeImportLimits')).toContainText('50 documents');
  });

  test('dry run reports each row and saves nothing; filters narrow the table', async ({ page }) => {
    await openImport(page);
    await chooseFiles(page, csv(GOOD, UNKNOWN_VENDOR, BAD_DATE, DUPLICATE));
    await page.click('#financeImportDryRunBtn');

    const rows = page.locator('#financeImportReportBody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'B-0001' })).toContainText('Ready');
    await expect(rows.filter({ hasText: 'B-0002' })).toContainText('Warning');
    await expect(rows.filter({ hasText: 'B-0002' })).toContainText('does not exist; it was not created');
    await expect(rows.filter({ hasText: 'B-0003' })).toContainText('not an ISO date');
    await expect(rows.filter({ hasText: 'B-0004' })).toContainText('Duplicate');

    await page.click('#financeImportStatusPills [data-filter="error"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('B-0003');
    await page.click('#financeImportStatusPills [data-filter="all"]');
    await expect(rows).toHaveCount(4);

    // a dry run created nothing: no Open draft links, no result line, and the bill list is unchanged
    await expect(page.locator('.btn-import-open')).toHaveCount(0);
    await expect(page.locator('#financeImportResult')).toBeHidden();
    const imported = await page.evaluate(() => FinanceMockState.bills.filter((b) => b.capture_source === 'import').length);
    expect(imported).toBe(0);
    await expect(page.locator('#financeImportCommitBtn')).toHaveText('Create 2 drafts');
  });

  test('commit creates Drafts only for ready and warning rows and links to them', async ({ page }) => {
    await openImport(page);
    await chooseFiles(page, csv(GOOD, UNKNOWN_VENDOR, BAD_DATE, DUPLICATE));
    await page.click('#financeImportDryRunBtn');
    await expect(page.locator('#financeImportReportBody tr')).toHaveCount(4);

    await page.click('#financeImportCommitBtn');
    await confirmDialog(page);

    await expect(page.locator('#financeImportResult')).toContainText('Batch #1: 2 drafts created, 2 rows not created');
    await expect(page.locator('.btn-import-open')).toHaveCount(2);
    await expect(page.locator('#financeImportCommitBtn')).toBeDisabled(); // no double commit

    const created = await page.evaluate(() => FinanceMockState.bills.filter((b) => b.capture_source === 'import').map((b) => ({ n: b.bill_number, s: b.status, r: b.is_reviewed, c: b.vendor_to_confirm })));
    expect(created).toEqual([
      { n: 'IMP-001', s: 'draft', r: false, c: false },
      { n: 'IMP-002', s: 'draft', r: false, c: true },
    ]);
    // the new Drafts are in the normal bill list
    await openAdminPage(page, 'a-finance-bills');
    await page.evaluate(() => setBillWorkQueue('draft'));
    await expect(page.locator('#financeBillsTableBody tr:has-text("IMP-001")')).toBeVisible();
  });

  test('a package error is shown and cannot be committed', async ({ page }) => {
    await openImport(page);
    await page.setInputFiles('#financeImportManifest', { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from('row_ref,vendor_name\nB-1,x') });
    await page.setInputFiles('#financeImportArchive', ZIP);
    await page.click('#financeImportDryRunBtn');
    await expect(page.locator('#financeImportFileErrors')).toContainText('missing required column');
    await expect(page.locator('#financeImportReportBody tr')).toHaveCount(0);
    await expect(page.locator('#financeImportCommitBtn')).toBeDisabled();

    await page.setInputFiles('#financeImportManifest', { name: 'm.csv', mimeType: 'text/csv', buffer: csv(GOOD) });
    await page.setInputFiles('#financeImportArchive', { name: 'package.rar', mimeType: 'application/x-rar', buffer: Buffer.from('Rar!') });
    await page.click('#financeImportDryRunBtn');
    await expect(page.locator('#financeImportFileErrors')).toContainText('not a ZIP');
  });

  test('choosing other files discards the report so a stale dry run cannot be committed', async ({ page }) => {
    await openImport(page);
    await chooseFiles(page, csv(GOOD));
    await page.click('#financeImportDryRunBtn');
    await expect(page.locator('#financeImportCommitBtn')).toBeEnabled();
    await page.setInputFiles('#financeImportManifest', { name: 'other.csv', mimeType: 'text/csv', buffer: csv(UNKNOWN_VENDOR) });
    await expect(page.locator('#financeImportReport')).toBeHidden();
    await expect(page.locator('#financeImportCommitBtn')).toBeDisabled();
  });

  test('template and report downloads; report cells cannot run as spreadsheet formulas', async ({ page }) => {
    await openImport(page);
    const [tpl] = await Promise.all([page.waitForEvent('download'), page.click('#financeImportTemplateBtn')]);
    expect(tpl.suggestedFilename()).toBe('import-template-bills.csv');
    const tplText = await (await import('fs')).promises.readFile(await tpl.path(), 'utf-8');
    expect(tplText.replace('﻿', '').trim()).toBe(HEADER);

    await chooseFiles(page, csv(GOOD, 'B-0009,x.pdf,,,,"=HYPERLINK(""http://x"")",IMP-9,2026-04-10,2026-05-10,USD,,5.00,x'));
    await page.click('#financeImportDryRunBtn');
    const [rep] = await Promise.all([page.waitForEvent('download'), page.click('#financeImportDownloadReportBtn')]);
    expect(rep.suggestedFilename()).toBe('import-report-bills-dry-run.csv');
    const out = await page.evaluate(() => financeImportReportCsv({ rows: [{ line: 2, row_ref: '=1+1', source_file: '@cmd', status: 'ok', findings: [], created_id: null, duplicate_of: null }] }));
    expect(out).toContain('"\'=1+1"');
    expect(out).toContain('"\'@cmd"');
  });

  test('a user without an import permission does not see the Import tab', async ({ page }) => {
    await page.goto('/?mock=finance');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-finance-settings');
    await expect(page.locator('#subtabSettingsImport')).toBeVisible(); // Financial-Admin holds finance.bill.write

    const visible = await page.evaluate(() => {
      const original = SessionInfo.hasPermission;
      SessionInfo.hasPermission = (k) => !['finance.bill.write', 'finance.account.write', 'finance.invoice.write'].includes(k) && original.call(SessionInfo, k);
      const v = applyFinanceImportVisibility();
      SessionInfo.hasPermission = original;
      return v;
    });
    expect(visible).toBe(false);
    await expect(page.locator('#subtabSettingsImport')).toBeHidden();
  });
});
