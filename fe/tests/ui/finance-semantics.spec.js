import { test, expect } from '@playwright/test';

test.describe('Story 0.2 — Shared Money, Date, and Status Semantics', () => {

  test('Unit & Semantics: formatMoney handles currency context, negatives, zero, and large values', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const results = await page.evaluate(() => {
      const F = window.FinanceFormat;
      return {
        usdPositive: F.formatMoney(1250, 'USD'),
        usdNegative: F.formatMoney(-1250, 'USD'),
        usdZero: F.formatMoney(0, 'USD'),
        usdLarge: F.formatMoney(1250000.5, 'USD'),
        usdAccounting: F.formatMoney(-4200, 'USD', { accounting: true }),
        egpPositive: F.formatMoney(450000, 'EGP'),
        egpNegative: F.formatMoney(-3500.75, 'EGP'),
        egpZero: F.formatMoney(0, 'EGP'),
        eurPositive: F.formatMoney(980, 'EUR'),
        missingVal: F.formatMoney(null, 'USD'),
        customDecimals: F.formatMoney(150.876, 'USD', { decimals: 0 }),
      };
    });

    // $ never appears without unambiguous currency context
    expect(results.usdPositive).toBe('$1,250.00 USD');
    expect(results.usdNegative).toBe('-$1,250.00 USD');
    expect(results.usdZero).toBe('$0.00 USD');
    expect(results.usdLarge).toBe('$1,250,000.50 USD');
    expect(results.usdAccounting).toBe('($1,4200.00 USD)'.replace('1,4200', '4,200'));

    // EGP formatting
    expect(results.egpPositive).toBe('EGP 450,000.00');
    expect(results.egpNegative).toBe('-EGP 3,500.75');
    expect(results.egpZero).toBe('EGP 0.00');

    // EUR formatting
    expect(results.eurPositive).toBe('€980.00 EUR');

    // Missing value defaults safely to 0
    expect(results.missingVal).toBe('$0.00 USD');
    expect(results.customDecimals).toBe('$151 USD');
  });

  test('Unit & Semantics: renderMoneyHtml produces tabular numerals and accessible labels', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const results = await page.evaluate(() => {
      const F = window.FinanceFormat;
      return {
        posHtml: F.renderMoneyHtml(500, 'USD'),
        negHtml: F.renderMoneyHtml(-250, 'USD'),
        zeroHtml: F.renderMoneyHtml(0, 'USD'),
        egpHtml: F.renderMoneyHtml(1500, 'EGP'),
      };
    });

    expect(results.posHtml).toContain('class="money money-positive');
    expect(results.posHtml).toContain('aria-label="500.00 US Dollars"');
    expect(results.posHtml).toContain('$500.00 USD');

    expect(results.negHtml).toContain('class="money money-negative');
    expect(results.negHtml).toContain('aria-label="negative 250.00 US Dollars"');
    expect(results.negHtml).toContain('-$250.00 USD');

    expect(results.zeroHtml).toContain('class="money money-zero');
    expect(results.zeroHtml).toContain('$0.00 USD');

    expect(results.egpHtml).toContain('aria-label="1500.00 Egyptian Pounds"');
    expect(results.egpHtml).toContain('EGP 1,500.00');
  });

  test('Unit & Semantics: formatFinanceDate standardizes application dates and discloses time zones', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const results = await page.evaluate(() => {
      const F = window.FinanceFormat;
      return {
        plainDate: F.formatFinanceDate('2026-09-01'),
        isoDateTime: F.formatFinanceDate('2026-09-01T08:30:00Z'),
        emptyDate: F.formatFinanceDate(null),
        dashDate: F.formatFinanceDate('--'),
      };
    });

    expect(results.plainDate).toBe('2026-09-01');
    expect(results.isoDateTime).toMatch(/^2026-09-01 \d{2}:\d{2} \([A-Za-z0-9+-]+\)$/);
    expect(results.emptyDate).toBe('—');
    expect(results.dashDate).toBe('—');
  });

  test('Unit & Semantics: formatStatusBadge ensures status never relies on color alone', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const results = await page.evaluate(() => {
      const F = window.FinanceFormat;
      return {
        paid: F.formatStatusBadge('invoice', 'paid'),
        overdue: F.formatStatusBadge('invoice', 'overdue'),
        sent: F.formatStatusBadge('invoice', 'sent'),
        draft: F.formatStatusBadge('invoice', 'draft'),
        void: F.formatStatusBadge('invoice', 'void'),
      };
    });

    // Every status badge must include an accessible icon, role="status", aria-label, and text
    expect(results.paid).toContain('fa-circle-check');
    expect(results.paid).toContain('role="status"');
    expect(results.paid).toContain('aria-label="Status: Paid"');
    expect(results.paid).toContain('Paid');

    expect(results.overdue).toContain('fa-circle-exclamation');
    expect(results.overdue).toContain('aria-label="Status: Overdue"');
    expect(results.overdue).toContain('Overdue');

    expect(results.sent).toContain('fa-paper-plane');
    expect(results.sent).toContain('aria-label="Status: Sent"');

    expect(results.draft).toContain('fa-file-pen');
    expect(results.draft).toContain('aria-label="Status: Draft"');

    expect(results.void).toContain('fa-ban');
    expect(results.void).toContain('aria-label="Status: Void"');
  });

  test('Acceptance Criteria 5: Overdue is derived from due date, balance, and void status', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    const results = await page.evaluate(() => {
      const F = window.FinanceFormat;
      return {
        // Due date in the past, status sent => should derive overdue
        pastDueSent: F.getDerivedInvoiceStatus({ status: 'sent', due_date: '2020-01-01' }),
        // Due date in the past, status paid => remains paid
        pastDuePaid: F.getDerivedInvoiceStatus({ status: 'paid', due_date: '2020-01-01' }),
        // Due date in the past, status void => remains void
        pastDueVoid: F.getDerivedInvoiceStatus({ status: 'void', due_date: '2020-01-01' }),
        // Future due date => remains original status
        futureDueSent: F.getDerivedInvoiceStatus({ status: 'sent', due_date: '2099-12-31' }),
        // Bill past due unpaid => overdue
        billPastDue: F.getDerivedBillStatus({ status: 'unpaid', due_date: '2020-01-01' }),
        // Bill past due paid => paid
        billPastPaid: F.getDerivedBillStatus({ status: 'paid', due_date: '2020-01-01' }),
      };
    });

    expect(results.pastDueSent).toBe('overdue');
    expect(results.pastDuePaid).toBe('paid');
    expect(results.pastDueVoid).toBe('void');
    expect(results.futureDueSent).toBe('sent');
    expect(results.billPastDue).toBe('overdue');
    expect(results.billPastPaid).toBe('paid');
  });

  test('UI Verification: Invoices & Bills display tabular right-aligned currency and accessible badges', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // 1. Sales Invoices
    await page.click('#adminSidebar a[data-page="a-finance-invoices"]');
    await expect(page.locator('#a-finance-invoices')).toBeVisible();

    // Verify Total header has cell-money
    const invTotalHeader = page.locator('#financeInvoicesContainer th.cell-money');
    await expect(invTotalHeader).toBeVisible();
    await expect(invTotalHeader).toContainText('Total');

    // Verify first row has right-aligned money with currency code USD
    const firstInvAmount = page.locator('#financeInvoicesTableBody td.cell-money').first();
    await expect(firstInvAmount).toBeVisible();
    await expect(firstInvAmount).toContainText('$12,500.00 USD');

    // Verify status badge has accessible icon and role="status"
    const firstInvBadge = page.locator('#financeInvoicesTableBody .status-badge-wrap').first();
    await expect(firstInvBadge).toBeVisible();
    await expect(firstInvBadge.locator('i')).toBeVisible();
    await expect(firstInvBadge).toHaveAttribute('role', 'status');

    // 2. Vendor Bills
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    const billTotalHeader = page.locator('#financeBillsContainer th.cell-money');
    await expect(billTotalHeader).toBeVisible();

    const firstBillAmount = page.locator('#financeBillsTableBody td.cell-money').first();
    await expect(firstBillAmount).toBeVisible();
    await expect(firstBillAmount).toContainText('$4,200.00 USD');

    const firstBillBadge = page.locator('#financeBillsTableBody .status-badge-wrap').first();
    await expect(firstBillBadge).toBeVisible();
    await expect(firstBillBadge.locator('i')).toBeVisible();

    // 3. Bank Accounts
    await page.click('#adminSidebar a[data-page="a-finance-accounts"]');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    const accBalanceHeader = page.locator('#financeSubPaneAccounts th.cell-money');
    await expect(accBalanceHeader).toBeVisible();

    const firstAccBalance = page.locator('#financeAccountsTableBody td.cell-money').first();
    await expect(firstAccBalance).toBeVisible();
    await expect(firstAccBalance).toContainText('$150,000.00 USD');

    // Verify EGP bank account renders EGP
    const egpAccRow = page.locator('#financeAccountsTableBody tr:has-text("CIB EGP Operating")');
    await expect(egpAccRow.locator('td.cell-money')).toContainText('EGP 450,000.00');
  });

});
