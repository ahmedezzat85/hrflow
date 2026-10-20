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

// I3: cheques. Handwritten scans are the weakest input, so required fields and confidence are checked per row.
const CHQ_HEADER = 'row_ref,source_file,confidence,review_flags,notes,account,cheque_number,payee,amount,currency,issue_date';
const chqCsv = (...rows) => Buffer.from([CHQ_HEADER, ...rows].join('\n'));
const CHQ_GOOD = 'C-0001,chq-0001.pdf,0.95,,,Voyance Operating USD,900001,Acme Supplies,1500.00,USD,2026-03-05';
const CHQ_LOW = 'C-0002,chq-0002.pdf,0.5,amount faint,,Voyance Operating USD,900002,Acme Supplies,200.00,USD,2026-03-06';
const CHQ_BLANK_FLAGGED = 'C-0003,chq-0003.pdf,0.4,amount unreadable,,Voyance Operating USD,900003,Acme Supplies,,USD,2026-03-07';
const CHQ_BLANK = 'C-0004,chq-0004.pdf,,,,Voyance Operating USD,900004,Acme Supplies,,USD,2026-03-08';
const CHQ_BAD_ACCOUNT = 'C-0005,chq-0005.pdf,0.9,,,No Such Bank,900005,Acme Supplies,10.00,USD,2026-03-09';
const CHQ_DUP = 'C-0006,chq-0006.pdf,0.9,,,Voyance Operating USD,001011,Acme Supplies,10.00,USD,2026-03-10';

test.describe('Finance Import screen (I3) - cheques', () => {
  test('cheque dry run applies the stricter rules and the commit creates draft cheques only', async ({ page }) => {
    await openImport(page);
    await page.selectOption('#financeImportKind', 'cheques');
    const [tpl] = await Promise.all([page.waitForEvent('download'), page.click('#financeImportTemplateBtn')]);
    expect(tpl.suggestedFilename()).toBe('import-template-cheques.csv');
    expect((await (await import('fs')).promises.readFile(await tpl.path(), 'utf-8')).replace('﻿', '').trim()).toBe(CHQ_HEADER);

    await chooseFiles(page, chqCsv(CHQ_GOOD, CHQ_LOW, CHQ_BLANK_FLAGGED, CHQ_BLANK, CHQ_BAD_ACCOUNT, CHQ_DUP));
    await page.click('#financeImportDryRunBtn');
    const rows = page.locator('#financeImportReportBody tr');
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: 'C-0001' })).toContainText('Ready');
    await expect(rows.filter({ hasText: 'C-0002' })).toContainText('Warning');
    await expect(rows.filter({ hasText: 'C-0002' })).toContainText('below 0.8');
    await expect(rows.filter({ hasText: 'C-0003' })).toContainText('enter this one by hand');
    await expect(rows.filter({ hasText: 'C-0004' })).toContainText('amount is required');
    await expect(rows.filter({ hasText: 'C-0005' })).toContainText('does not exist');
    await expect(rows.filter({ hasText: 'C-0006' })).toContainText('Duplicate');
    expect(await page.evaluate(() => FinanceMockState.cheques.filter((c) => c.import_batch_id).length)).toBe(0);

    await page.click('#financeImportCommitBtn');
    await confirmDialog(page);
    await expect(page.locator('#financeImportResult')).toContainText('2 drafts created, 4 rows not created');
    const created = await page.evaluate(() => FinanceMockState.cheques.filter((c) => c.import_batch_id).map((c) => ({ n: c.cheque_number, s: c.status, scan: c.attachments.length })));
    expect(created.sort((a, b) => a.n.localeCompare(b.n))).toEqual([{ n: '900001', s: 'draft', scan: 1 }, { n: '900002', s: 'draft', scan: 1 }]);
  });
});

// I4: sales invoices. Customers are never created, so an unknown customer is a row error.
const INV_HEADER = 'row_ref,source_file,confidence,review_flags,notes,customer_name,invoice_number,issue_date,due_date,currency,description,amount,vat_rate';
const invCsv = (...rows) => Buffer.from([INV_HEADER, ...rows].join('\n'));
const INV_GOOD = 'I-0001,inv-0001.pdf,,,,Apex Health Partners,HIST-0001,2025-11-02,2025-12-02,USD,Annual licence,1200.00,';
const INV_NO_CUSTOMER = 'I-0002,inv-0002.pdf,,,,Nobody Inc,HIST-0002,2025-11-02,2025-12-02,USD,Annual licence,100.00,';
const INV_DUP = 'I-0003,inv-0003.pdf,,,,Apex Health Partners,INV-2026-001,2025-11-02,2025-12-02,USD,x,10.00,';
const INV_NO_AMOUNT = 'I-0004,,,,,BioCare Diagnostics,HIST-0004,2025-11-02,2025-12-02,USD,,,';

test.describe('Finance Import screen (I4) - sales invoices', () => {
  test('invoice dry run and commit create Draft invoices only', async ({ page }) => {
    await openImport(page);
    await page.selectOption('#financeImportKind', 'invoices');
    const [tpl] = await Promise.all([page.waitForEvent('download'), page.click('#financeImportTemplateBtn')]);
    expect(tpl.suggestedFilename()).toBe('import-template-invoices.csv');

    await chooseFiles(page, invCsv(INV_GOOD, INV_NO_CUSTOMER, INV_DUP, INV_NO_AMOUNT));
    await page.click('#financeImportDryRunBtn');
    const rows = page.locator('#financeImportReportBody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: 'I-0001' })).toContainText('Ready');
    await expect(rows.filter({ hasText: 'I-0002' })).toContainText('never created by an import');
    await expect(rows.filter({ hasText: 'I-0003' })).toContainText('Duplicate');
    await expect(rows.filter({ hasText: 'I-0004' })).toContainText('Warning');
    expect(await page.evaluate(() => FinanceMockState.invoices.filter((i) => i.import_batch_id).length)).toBe(0);

    await page.click('#financeImportCommitBtn');
    await confirmDialog(page);
    await expect(page.locator('#financeImportResult')).toContainText('2 drafts created, 2 rows not created');
    const created = await page.evaluate(() => FinanceMockState.invoices.filter((i) => i.import_batch_id).map((i) => ({ n: i.invoice_number, s: i.status, paid: i.amount_paid, scan: i.has_scan })));
    expect(created).toEqual([{ n: 'HIST-0001', s: 'draft', paid: 0, scan: true }, { n: 'HIST-0004', s: 'draft', paid: 0, scan: false }]);
  });
});
