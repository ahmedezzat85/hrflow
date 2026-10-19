import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('X2: Books, visibility, checkpoints and the view switcher (D-028)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('accounts are grouped by book and a partial account shows its unrecorded difference', async ({ page }) => {
    await openAdminPage(page, 'a-finance-accounts');
    const rows = page.locator('#financeAccountsTableBody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // Local accounts first, the Overseas account last
    const chips = await page.locator('#financeAccountsTableBody [data-book-chip]').allTextContents();
    expect(chips[0]).toBe('Local');
    expect(chips[chips.length - 1]).toContain('Overseas');
    expect(chips[chips.length - 1]).toContain('Partial');

    const overseas = page.locator('#financeAccountsTableBody tr:has-text("Voyance Overseas USD")');
    await expect(overseas.locator('[data-unrecorded]')).toContainText('Unrecorded difference');
    await expect(overseas.locator('[data-unrecorded]')).toContainText('1,250');
    // Full-visibility accounts have no checkpoint action
    await expect(page.locator('#financeAccountsTableBody tr:has-text("CIB EGP Operating") .btn-account-checkpoints')).toHaveCount(0);

    // Record a checkpoint: the difference is shown, nothing is posted
    await overseas.locator('.btn-account-checkpoints').click();
    await expect(page.locator('#accountCheckpointModal')).toBeVisible();
    await expect(page.locator('#accountCheckpointList li')).toHaveCount(1);
    await page.fill('#fCheckpointBalance', '30500');
    await page.fill('#fCheckpointNote', 'Second look at the portal');
    await page.click('#accountCheckpointSaveBtn');
    await expect(page.locator('#accountCheckpointList li')).toHaveCount(2);
    await page.click('#accountCheckpointModal button:has-text("Close")');
    await expect(page.locator('#accountCheckpointModal')).not.toBeVisible();
    await expect(overseas.locator('[data-unrecorded]')).toContainText('500');
  });

  test('account dialog has Book and Visibility; the book locks once the account has postings', async ({ page }) => {
    await openAdminPage(page, 'a-finance-accounts');
    await expect(page.locator('#financeAccountsTableBody tr').first()).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Add account")');
    await expect(page.locator('#companyBankAccountModal')).toBeVisible();
    await expect(page.locator('#fCompanyBook option')).toHaveCount(2);
    await expect(page.locator('#fCompanyBook')).toHaveValue('1');
    await expect(page.locator('#fCompanyVisibility')).toHaveValue('full');
    await page.click('#companyBankAccountModal button:has-text("Cancel")');
    await expect(page.locator('#companyBankAccountModal')).not.toBeVisible();

    // Account 1 has mock postings: the book is read-only
    await page.locator('#financeAccountsTableBody tr:has-text("Voyance Operating USD") button[title="Edit Account"]').click();
    await expect(page.locator('#fCompanyBook')).toBeDisabled();
    await expect(page.locator('#fCompanyBookWarning')).toBeVisible();
    await page.click('#companyBankAccountModal button:has-text("Cancel")');
  });

  test('dashboard switcher defaults to Local, changes the KPIs and is remembered', async ({ page }) => {
    await openAdminPage(page, 'a-finance-dashboard');
    const sw = page.locator('#financeBookSwitcherDashboard');
    await expect(sw.locator('[data-book="local"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#statFinanceRevenue')).toBeVisible({ timeout: 10000 });
    const localText = await page.locator('#statFinanceRevenue').textContent();

    await sw.locator('[data-book="overseas"]').click();
    await expect(sw.locator('[data-book="overseas"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#statFinanceRevenue')).toContainText('14,000');
    expect(await page.locator('#statFinanceRevenue').textContent()).not.toBe(localText);

    // remembered across a reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#financeBookSwitcherDashboard [data-book="overseas"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#financeBookSwitcherDashboard [data-book="consolidated"]').click();
    await expect(page.locator('#financeBookSwitcherDashboard [data-book="consolidated"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('reports API passes the page view; Overseas P&L keeps the inter-book transfer out of operating spend', async ({ page }) => {
    await expect(page.locator('#financeBookSwitcherReports [data-book]')).toHaveCount(3);
    const pnl = await page.evaluate(() => FinanceApi.getProfitAndLossReport({ currency: 'USD', book: 'overseas' }));
    expect(pnl.total_revenue).toBe(14000);
    expect(pnl.total_expenses).toBe(3345);
    expect(pnl.inter_book_items).toEqual([{ label: 'Transferred to local entity', amount: 5000 }]);
    const local = await page.evaluate(() => FinanceApi.getProfitAndLossReport({ currency: 'USD' }));
    expect(local.total_revenue).toBe(125000); // Local default is unchanged
    const cf = await page.evaluate(() => FinanceApi.getCashFlowReport({ currency: 'USD', book: 'overseas' }));
    expect(cf.financing_activities[0].name).toBe('Transferred to local entity');
  });
});
