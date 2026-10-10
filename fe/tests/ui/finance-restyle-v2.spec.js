import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Finance UI restyle v2 (D-027, doc 21): structural checks on computed styles.
// Extended slice by slice; mock mode only.

async function openAdmin(page, theme = 'light', size = { width: 1440, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

const css = (page, selector, prop) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);

const rgb = (page, value) =>
  page.evaluate((v) => {
    const probe = document.createElement('i');
    probe.style.color = v;
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);

test.describe('Finance restyle v2: foundations (S1)', () => {
  test('tokens resolve in light and dark', async ({ page }) => {
    await openAdmin(page, 'light');
    const read = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
    expect(await read('--ink-strong')).toBe('#16245e');
    expect(await read('--brand')).toBe('#2056e8');
    expect(await read('--id-teal')).toBe('#0f9d8c');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await read('--ink-strong')).toBe('#e9eeff');
    expect(await read('--id-teal')).toBe('#1f9d8e');
    expect(await read('--fv-canvas')).toBe('#0f1117');
  });

  test('FinanceUI helpers: hue by id, initials, markup is class based', async ({ page }) => {
    await openAdmin(page);
    const out = await page.evaluate(() => ({
      h1: FinanceUI.hueForId(1), h8: FinanceUI.hueForId(8), h9: FinanceUI.hueForId(9),
      cat: FinanceUI.hueForCategory({ id: 3, name: 'SaaS', color: 'pink' }, []),
      catFallback: FinanceUI.hueForCategory({ id: 2, name: 'Rent' }, [{ id: 1 }, { id: 2 }]),
      catOther: FinanceUI.hueForCategory({ id: 9, name: 'Other' }, []),
      ini: FinanceUI.initials('Amazon Web Services'), ini1: FinanceUI.initials('Slack'),
      date: FinanceUI.formatDate('2026-09-01'),
      pill: FinanceUI.statusPill('paid', '<b>Paid</b>'),
      av: FinanceUI.avatar('Amazon Web Services', 'orange'),
      rows: FinanceUI.rowActions({ primary: { label: 'Pay', onclick: 'x()' }, icons: [1, 2, 3, 4].map((n) => ({ icon: 'fa-pen', label: 'L' + n })) }),
      money: FinanceUI.amountCell(470000, 'EGP'),
    }));
    expect([out.h1, out.h8, out.h9]).toEqual(['blue', 'ochre', 'blue']);
    expect(out.cat).toBe('pink');
    expect(out.catFallback).toBe('orange');
    expect(out.catOther).toBe('faint');
    expect(out.ini).toBe('AW');
    expect(out.ini1).toBe('SL');
    expect(out.date).toBe('1 Sep 2026');
    expect(out.pill).toContain('fv-status--settled');
    expect(out.pill).not.toContain('<b>');
    expect(out.av).not.toMatch(/style=|#[0-9a-f]{3,6}/i);
    expect((out.rows.match(/fv-icon-btn/g) || []).length).toBe(3);
    expect(out.money).toContain('<span class="fv-cur">EGP</span>');
  });

  test('Finance pages get the canvas, area tile and compact top bar; HR pages do not', async ({ page }) => {
    await openAdmin(page);
    const canvas = await rgb(page, '#f4f6fd');
    const areas = [
      ['a-finance-dashboard', 'Overview'],
      ['a-finance-invoices', 'Sales'],
      ['a-finance-bills', 'Spend'],
      ['a-finance-accounts', 'Banking'],
      ['a-finance-reports', 'Reports'],
      ['a-finance-settings', 'Settings'],
    ];
    for (const [pageId, area] of areas) {
      await openAdminPage(page, pageId);
      await expect(page.locator('#adminAreaName')).toHaveText(area);
      await expect(page.locator('#adminAreaTile')).toBeVisible();
      expect(await css(page, '#admin-app .main', 'backgroundColor')).toBe(canvas);
      expect(await css(page, '#adminQuickAddTxBtn', 'height')).toBe('30px');
      expect(await css(page, '#adminQuickAddTxBtn i', 'display')).toBe('none');
      expect(await css(page, '#adminPageTitle', 'fontSize')).toBe('16px');
    }
  });

  test('Payroll and HR pages keep the existing chrome', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-finance-payroll-runs', 'admin'));
    await expect(page.locator('#adminAreaTile')).toBeHidden();
    await expect(page.locator('#admin-app .main.fv-shell')).toHaveCount(0);
    await page.evaluate(() => showSection('a-dashboard', 'admin'));
    await expect(page.locator('#adminAreaName')).toBeHidden();
    await expect(page.locator('#admin-app .main.fv-shell')).toHaveCount(0);
    expect(await css(page, '#adminPageTitle', 'fontSize')).not.toBe('16px');
  });
});

// ---------- S2: Spend I (Bills, Vendors, bill dialogs) ----------
test.describe('Finance restyle v2: Bills and Vendors (S2)', () => {
  for (const theme of ['light', 'dark']) {
    test(`Bills table chrome in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await openAdminPage(page, 'a-finance-bills');
      await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
      const surface = await rgb(page, 'var(--fv-surface)');
      const ink = await rgb(page, 'var(--ink-strong)');
      const brand = await rgb(page, 'var(--brand)');

      // white header row, sentence case, sorted column is brand text
      expect(await css(page, '#financeBillsTable thead th', 'backgroundColor')).toBe(surface);
      expect(await css(page, '#financeBillsTable thead th', 'textTransform')).toBe('none');
      expect(await css(page, '#financeBillsTable thead th', 'letterSpacing')).toMatch(/^(normal|0px)$/);

      // buttons: page 32, row 28
      expect(await css(page, '#financeRecordBillBtn', 'height')).toBe('32px');
      expect(await css(page, '#financeBillsTableBody .btn-pay-bill', 'height')).toBe('28px');
      expect(await css(page, '#financeBillsTableBody .fv-icon-btn', 'height')).toBe('30px');

      // amounts navy, never green or red
      expect(await css(page, '#financeBillsTableBody .fv-amount__value', 'color')).toBe(ink);

      // selected status pill is brand filled; the row of pills has dots
      expect(await css(page, '#tabBillQueueAll', 'backgroundColor')).toBe(brand);
      expect(await css(page, '#tabBillQueueAll', 'height')).toBe('28px');
      expect(await css(page, '#tabBillQueueAll', 'borderRadius')).not.toBe('0px');

      // no icons in the sub-nav, the pills or any text button of the header
      await expect(page.locator('#financeBillSubNav .fa-solid')).toHaveCount(0);
      await expect(page.locator('#financeBillWorkQueueTabs .fa-solid')).toHaveCount(0);
      for (const id of ['financeAddVendorBtn', 'financeUploadDraftsBtn', 'financeRecordBillBtn']) {
        await expect(page.locator(`#${id} .fa-solid`)).toHaveCount(0);
      }
      // sub-nav: active tab 2px brand underline
      const active = page.locator('#tabFinanceBills');
      expect(await active.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('2px');
      expect(await active.evaluate((el) => getComputedStyle(el).borderBottomColor)).toBe(brand);

      // no "more" menu and no duplicate record count above the table
      await expect(page.locator('#financeBillsTable .fa-ellipsis, #financeBillsTable .fa-ellipsis-vertical')).toHaveCount(0);
      await expect(page.locator('#financeBillViewResultCount')).toHaveCount(0);

      // vendor avatar and category dot are class based (no inline colour)
      await expect(page.locator('#financeBillsTableBody tr').first().locator('.fv-avatar')).toHaveCount(1);
      expect(await page.locator('#financeBillsTableBody').evaluate((el) => /style="[^"]*(color|background)/i.test(el.innerHTML))).toBe(false);
    });
  }

  test('Vendors view: Add vendor is the primary, Bills is an outline row action, open bills come from payables', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-bills');
    await page.click('#tabFinanceVendors');
    await expect(page.locator('#financeVendorsTableBody tr').first()).toBeVisible();
    const brandRgb = await rgb(page, 'var(--brand)');
    await expect.poll(() => css(page, '#financeAddVendorBtn', 'backgroundColor')).toBe(brandRgb);
    expect(await css(page, '#financeVendorsTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
    const aws = page.locator('#financeVendorsTableBody tr:has-text("Amazon Web Services")');
    await expect(aws.locator('.fv-amount__value')).toContainText('$13,740.00');
    await expect(aws).toContainText('3 open bills');
    await expect(aws.locator('.btn-vendor-bills')).toHaveText('Bills');
    // "Bills" opens the bills list narrowed to that vendor through the existing search
    await aws.locator('.btn-vendor-bills').click();
    await expect(page.locator('#financeBillSearch')).toHaveValue('Amazon Web Services');
    await expect(page.locator('#financeBillsTableBody tr:has-text("Slack")')).toHaveCount(0);
  });

  test('bill dialogs: scoped, field height 36, footer buttons 34, no icons in footer buttons', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible();
    await page.evaluate(() => openAddBillModal());
    await expect(page.locator('#billModal')).toBeVisible();
    await expect(page.locator('#billModal.fv.fv-dialog')).toHaveCount(1);
    expect(await css(page, '#billNumber', 'height')).toBe('36px');
    expect(await css(page, '#billModalSaveBtn', 'height')).toBe('34px');
    expect(await css(page, '#billSaveDraftBtn', 'height')).toBe('34px');
    await expect(page.locator('#billModal .modal-foot .fa-solid')).toHaveCount(0);
    expect(await css(page, '#billModal .modal-head-icon', 'width')).toBe('36px');
    await page.evaluate(() => closeBillModal());

    // approval: decision bar drives the existing select and the primary label follows it
    await page.evaluate(() => { FinanceState.bills = FinanceState.bills || []; });
    await page.click('#tabBillQueuePendingApproval');
    await page.locator('#financeBillsTableBody .btn-approve-bill').first().click();
    await expect(page.locator('#billApprovalModal')).toBeVisible();
    await expect(page.locator('#billApprovalSubmitBtn')).toHaveText('Approve bill');
    await page.click('#billApprovalDecisionBar [data-decision="reject"]');
    await expect(page.locator('#billApprovalDecision')).toHaveValue('reject');
    await expect(page.locator('#billApprovalSubmitBtn')).toHaveText('Reject bill');
    await expect(page.locator('#billApprovalDecisionBar [data-decision="reject"]')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#billApprovalModal .modal-close');
  });
});

// ---------- S3: Subscriptions and Statutory ----------
test.describe('Finance restyle v2: Subscriptions and Statutory (S3)', () => {
  test('Subscriptions: white header, pills with counts, Notice due only, row actions, run rate', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-subscriptions');
    await expect(page.locator('#financeSubscriptionsTableBody tr').first()).toBeVisible();
    expect(await css(page, '#financeSubscriptionsTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
    expect(await css(page, '#financeSubscriptionsTable thead th', 'textTransform')).toBe('none');
    expect(await css(page, '#financeAddSubscriptionBtn', 'height')).toBe('32px');
    expect(await css(page, '#financeSubscriptionsTableBody .btn-log-charge', 'height')).toBe('28px');
    await expect(page.locator('#financeAddSubscriptionBtn .fa-solid')).toHaveCount(0);
    await expect(page.locator('#financeSpendSubNavSubscriptions .fa-solid')).toHaveCount(0);
    expect(await css(page, '#financeSubscriptionStatusPills .active', 'backgroundColor')).toBe(await rgb(page, 'var(--brand)'));
    await expect(page.locator('#subPillCountAll')).toHaveText('2');
    await expect(page.locator('#financeSubscriptionsFooter')).toContainText('monthly run rate');
    // History is an icon, not a text button; no uppercase cycle chips
    await expect(page.locator('#financeSubscriptionsTableBody .btn-sub-history').first()).toHaveClass(/fv-icon-btn/);
    await expect(page.locator('#financeSubscriptionsTableBody .badge')).toHaveCount(0);
    // Notice due only narrows the list
    const noticeCount = Number(await page.locator('#financeSubNoticeCount').innerText());
    await page.locator('#financeSubNoticeOnly').check();
    await expect(page.locator('#financeSubscriptionsTableBody tr')).toHaveCount(noticeCount);
  });

  test('Statutory: cards with currency prefix, period select, no variance currency bug, nowrap amounts', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-statutory');
    await expect(page.locator('#financeStatutoryTableBody tr').first()).toBeVisible();
    expect(await css(page, '#financeStatutoryTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
    await expect(page.locator('#statutorySummaryEstimated .fv-cur')).toHaveText('EGP');
    expect(await page.locator('#financeVatEstimateMonth').evaluate((el) => el.tagName)).toBe('SELECT');
    await expect(page.locator('#financeStatutoryTable')).not.toContainText('$0.00');
    expect(await css(page, '#financeStatutoryTableBody .fv-amount__value', 'whiteSpace')).toBe('nowrap');
    await expect(page.locator('#financeStatutoryFooter')).toContainText('Amounts in EGP');
    // period filter narrows to that month
    await page.selectOption('#financeVatEstimateMonth', '2026-08');
    await expect(page.locator('#financeStatutoryFooter')).toContainText('Variance for Aug 2026');
    expect(await css(page, '#financeGenerateVatEstimateBtn', 'height')).toBe('32px');
    await expect(page.locator('#financeStatutoryTableBody .btn-stat-confirm').first()).toHaveClass(/btn-fill/);
    await page.locator('#financeStatutoryTableBody .btn-stat-remit').first().click();
    await expect(page.locator('#statutorySettleModal.fv-dialog')).toBeVisible();
    expect(await css(page, '#statSettleAmount', 'height')).toBe('36px');
    expect(await css(page, '#statSettleSaveBtn', 'height')).toBe('34px');
  });
});

// ---------- S4: Sales (Invoices, Customers, invoice and receipt dialogs) ----------
test.describe('Finance restyle v2: Sales (S4)', () => {
  for (const theme of ['light', 'dark']) {
    test(`Invoices table chrome in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await openAdminPage(page, 'a-finance-invoices');
      await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible();
      expect(await css(page, '#financeInvoicesTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
      expect(await css(page, '#financeInvoicesTable thead th', 'textTransform')).toBe('none');
      expect(await css(page, '#financeNewInvoiceBtn', 'height')).toBe('32px');
      expect(await css(page, '#financeInvoicesTableBody .btn-record-receipt', 'height')).toBe('28px');
      expect(await css(page, '#financeInvoicesTableBody .fv-amount__value', 'color')).toBe(await rgb(page, 'var(--ink-strong)'));
      expect(await css(page, '#tabQueueAll', 'backgroundColor')).toBe(await rgb(page, 'var(--brand)'));
      await expect(page.locator('#financeInvoiceSubNav .fa-solid')).toHaveCount(0);
      await expect(page.locator('#financeInvoiceWorkQueueTabs .fa-solid')).toHaveCount(0);
      // at most one text button and three icon buttons per row, no menu
      const counts = await page.locator('#financeInvoicesTableBody tr').evaluateAll((rows) => rows.map((r) => [r.querySelectorAll('.fv-row-actions .btn').length, r.querySelectorAll('.fv-row-actions .fv-icon-btn').length]));
      for (const [text, icons] of counts) { expect(text).toBeLessThanOrEqual(1); expect(icons).toBeLessThanOrEqual(3); }
      // the primary action is "Record receipt" (no "Pay") and the outstanding total sits in the footer, per currency
      await expect(page.locator('#financeInvoicesTableBody .btn-record-receipt').first()).toHaveText('Record receipt');
      await expect(page.locator('#financeInvoicesPagination')).toContainText('outstanding');
    });
  }

  test('Customers: pills, open balance from receivables, Invoices opens the 360 drawer', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabFinanceCustomers');
    await expect(page.locator('#financeCustomersTableBody tr').first()).toBeVisible();
    expect(await css(page, '#financeAddCustomerBtn', 'backgroundColor')).toBe(await rgb(page, 'var(--brand)'));
    expect(await css(page, '#financeCustomersTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
    await expect(page.locator('#custPillLate')).toBeVisible();
    const apex = page.locator('#financeCustomersTableBody tr:has-text("Apex Health Partners")');
    await expect(apex.locator('.fv-amount__value')).toContainText('$12,500.00');
    await expect(apex).toContainText('1 open invoice');
    const care = page.locator('#financeCustomersTableBody tr:has-text("CareFirst Health")');
    await expect(care.locator('.fv-note--late')).toContainText('1 late');
    await page.click('#custPillLate');
    await expect(page.locator('#financeCustomersTableBody tr')).toHaveCount(1);
    await page.click('#financeCustomerStatusPills [data-filter="all"]');
    // the 360 drawer opens from the "Invoices" row action; the old "View 360" button is gone
    await expect(page.locator('#financeCustomersTable')).not.toContainText('View 360');
    await apex.locator('.btn-customer-invoices').click();
    await expect(page.locator('#financeDetailDrawerOverlay')).toBeVisible();
  });

  test('Customers without BE-2 receivables: dash and no late pill', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-invoices');
    await page.click('#tabFinanceCustomers');
    await expect(page.locator('#financeCustomersTableBody tr').first()).toBeVisible();
    await page.evaluate(() => { FinanceState.customers = FinanceState.customers.map((c) => { const { receivables, ...rest } = c; return rest; }); applyAndRenderCustomers(); });
    await expect(page.locator('#custPillLate')).toBeHidden();
    await expect(page.locator('#financeCustomersTableBody tr').first().locator('td').nth(4)).toHaveText('–');
  });

  test('invoice and receipt dialogs: scoped, 36 px fields, 34 px footer, "Record receipt"', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible();
    await page.evaluate(() => openAddInvoiceModal());
    await expect(page.locator('#invoiceModal.fv-dialog')).toBeVisible();
    expect(await css(page, '#invoiceNumber', 'height')).toBe('36px');
    expect(await css(page, '#invoiceModalSaveBtn', 'height')).toBe('34px');
    await expect(page.locator('#invoiceModal .modal-foot .fa-solid')).toHaveCount(0);
    await page.evaluate(() => closeInvoiceModal());
    await page.locator('#financeInvoicesTableBody .btn-record-receipt').first().click();
    await expect(page.locator('#invoicePaymentModal')).toBeVisible();
    await expect(page.locator('#invoicePaymentTitleText')).toHaveText('Record receipt');
    await expect(page.locator('#invoicePaymentSubmitBtn')).toHaveText('Record receipt');
    expect(await css(page, '#paymentAmount', 'height')).toBe('36px');
  });
});

// ---------- S5: Banking I (Accounts, Ledger, transaction dialog) ----------
test.describe('Finance restyle v2: Banking I (S5)', () => {
  for (const theme of ['light', 'dark']) {
    test(`Accounts page chrome in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await openAdminPage(page, 'a-finance-accounts');
      await expect(page.locator('#financeAccountsTableBody tr').first()).toBeVisible();
      expect(await css(page, '#financeAccountsTable thead th', 'backgroundColor')).toBe(await rgb(page, 'var(--fv-surface)'));
      expect(await css(page, '#financeAccountsTable thead th', 'textTransform')).toBe('none');
      // Banking tabs are the shortened underline tabs without icons
      await expect(page.locator('#financeAccountsSubNav .filter-tab')).toHaveText(['Accounts', 'Ledger', 'Statements', 'Cheques', 'Transfers']);
      await expect(page.locator('#financeAccountsSubNav .fa-solid')).toHaveCount(0);
      // header: Transfer and Withdraw cash outline, Add account primary; Upload statement moved out
      const head = page.locator('#financeHeadActionsAccounts');
      await expect(head.locator('button')).toHaveText(['Transfer', 'Withdraw cash', 'Add account']);
      expect(await css(page, '#financeHeadActionsAccounts .btn-fill', 'height')).toBe('32px');
      // cards: one per currency (never mixed), uncleared cheques, statement lines
      await expect(page.locator('#financeAccountsCards .fv-card')).toHaveCount(4);
      await expect(page.locator('#financeAccountsCards')).toContainText('USD accounts');
      await expect(page.locator('#financeAccountsCards')).toContainText('EGP accounts');
      await expect(page.locator('#financeAccountsCards')).toContainText('Uncleared cheques');
      await expect(page.locator('#financeAccountsCards')).toContainText('Statement lines to match');
      // one Balance column; the ledger and mock balances agree
      await expect(page.locator('#financeAccountsTable thead th')).toHaveText(['Account', 'Type', 'Last statement', 'Balance', 'Actions']);
      await expect(page.locator('#financeAccountsTableBody tr').first()).toContainText('145,800.00');
      // currency filter narrows the list
      await page.selectOption('#financeAccountCurrencyFilter', 'EGP');
      await expect(page.locator('#financeAccountsTableBody tr')).toHaveCount(2);
    });
  }

  test('Ledger tab: account select, period, cards, signed navy amounts, no Rate / Equiv column', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-accounts');
    await page.click('#subtabFinanceLedger');
    await expect(page.locator('#financeLedgerTableBody tr').first()).toBeVisible();
    await expect(page.locator('#financeAccountsSubNav')).toBeVisible();
    await expect(page.locator('#financeLedgerAccountSelect')).toBeVisible();
    expect(await css(page, '#financeLedgerRecordBtn', 'height')).toBe('32px');
    await expect(page.locator('#financeLedgerTable thead th')).toHaveText(['Date', 'Details', 'Category', 'Payment type', 'Amount', 'Balance', 'Actions']);
    await expect(page.locator('#financeLedgerTable')).not.toContainText('Rate / Equiv');
    await expect(page.locator('#financeLedgerTotalOut')).toContainText('4,200.00');
    await expect(page.locator('#financeLedgerCurrentBalance')).toContainText('145,800.00');
    const amount = page.locator('#financeLedgerTableBody .fv-amount__value').first();
    await expect(amount).toHaveText('−4,200.00');
    expect(await amount.evaluate((el) => getComputedStyle(el).color)).toBe(await rgb(page, 'var(--ink-strong)'));
    // the direction pills filter the rows but not the period cards
    await page.click('#financeLedgerDirectionPills [data-direction="in"]');
    await expect(page.locator('#financeLedgerTableBody tr')).toHaveCount(0);
    await expect(page.locator('#financeLedgerTotalOut')).toContainText('4,200.00');
    await page.click('#financeLedgerDirectionPills [data-direction="all"]');
    await expect(page.locator('#financeLedgerTableBody tr')).toHaveCount(1);
    // period "This month" has no data in the mock; the footer and empty state follow
    await page.selectOption('#financeLedgerPeriod', 'custom');
    await expect(page.locator('#financeLedgerDateFrom')).toBeVisible();
  });

  test('Transaction dialog: scoped, sky tile, choice bar, Paid-to pills drive the payee select', async ({ page }) => {
    await openAdmin(page);
    await openAdminPage(page, 'a-finance-accounts');
    await expect(page.locator('#financeAccountsTableBody tr').first()).toBeVisible();
    await page.locator('.btn-open-workspace').first().click();
    await page.click('#btnWorkspaceNewTx');
    await expect(page.locator('#financeTransactionModal.fv-dialog')).toBeVisible();
    expect(await css(page, '#fFinanceTxAmount', 'height')).toBe('36px');
    expect(await css(page, '#financeTxSaveBtn', 'height')).toBe('34px');
    await expect(page.locator('#financeTransactionModal .modal-foot .fa-solid')).toHaveCount(0);
    await expect(page.locator('#fFinanceTxTypeMoneyOut')).toHaveClass(/active/);
    await page.click('#fFinanceTxTypeMoneyIn');
    await expect(page.locator('#fFinanceTxEntryType')).toHaveValue('money_in');
    await page.click('#fFinanceTxPayeePills [data-payee="vendor"]');
    await expect(page.locator('#fFinanceTxPayeeType')).toHaveValue('vendor');
    await expect(page.locator('#fFinanceTxPayeePills [data-payee="vendor"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
