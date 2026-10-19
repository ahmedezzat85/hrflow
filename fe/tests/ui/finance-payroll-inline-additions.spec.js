import { test, expect } from '@playwright/test';
import { submitAndApprove } from './helpers/payroll.js';
import { openAdminPage } from './helpers/admin-nav.js';

// Review pay (screen 2): Bonus, Sales Commission and Support Commission are added per employee from the
// inline "+" row, with an Internal (EGP cash) or External (USD transfer) payment source. Replaces the
// specs of the removed wizard modal (finance-payroll-runner-adjustments / finance-payroll-commission-bonus).

const money = async (locator) => parseFloat((await locator.innerText()).replace(/[^0-9.-]/g, ''));

async function addAddition(page, rowIndex, { type, amount, source }) {
  const row = page.locator('#payrollTableBody tr:not(.expand)').nth(rowIndex);
  await row.locator('.col-actions .plus').click();
  const expand = page.locator('#payrollTableBody tr.expand');
  await expect(expand).toBeVisible();
  const id = (await row.locator('.col-id').textContent()).trim();
  await page.selectOption(`#inlineBonusType_${id}`, type);
  await page.fill(`#inlineBonusAmount_${id}`, String(amount));
  await page.click(`#inlineBonusSourceToggle_${id} button[data-source="${source}"]`);
  await page.click(`#btnSubmitInlineBonus_${id}`);
  await expect(expand).not.toBeVisible();
  return id;
}

test.describe('Payroll review: inline bonus and commission additions', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
    await openAdminPage(page, 'a-finance-payroll');
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
    await page.click('#btnOpenCurrentCycle');
    await page.click('#btnP1Proceed');
    await expect(page.locator('#payrollScreen2')).toBeVisible();
    await expect(page.locator('#payrollTableBody tr').first()).toBeVisible();
  });

  test('commission and bonus lines keep their type, source and reason, and move the totals', async ({ page }) => {
    const bonusTotal0 = await money(page.locator('#fBonus'));
    const netTotal0 = await money(page.locator('#fNet'));

    // Sales commission, External source
    await addAddition(page, 0, { type: 'COMMISSION', amount: 750, source: 'EXT' });
    const first = page.locator('#payrollTableBody tr:not(.expand)').first();
    await expect(first.locator('.pv-bonus-amount')).toContainText('$750.00');
    await expect(first.locator('.pv-src-dot--ext')).toHaveCount(1);
    await expect(first.locator('.pv-reason-tag--sales')).toContainText('Sales Commission');
    expect(await money(page.locator('#fBonus'))).toBeCloseTo(bonusTotal0 + 750, 2);
    expect(await money(page.locator('#fNet'))).toBeCloseTo(netTotal0 + 750, 2);

    // Plain bonus, Internal source, same employee: two lines
    await addAddition(page, 0, { type: 'BONUS', amount: 300, source: 'INT' });
    await expect(first.locator('.pv-bonus-amount')).toHaveCount(2);
    await expect(first.locator('.pv-src-dot--int')).toHaveCount(1);
    expect(await money(page.locator('#fBonus'))).toBeCloseTo(bonusTotal0 + 1050, 2);

    // Support commission on another employee
    await addAddition(page, 1, { type: 'SUPPORT_COMMISSION', amount: 120.5, source: 'INT' });
    const second = page.locator('#payrollTableBody tr:not(.expand)').nth(1);
    await expect(second.locator('.pv-reason-tag--support').last()).toContainText('Support Commission');
    expect(await money(page.locator('#fBonus'))).toBeCloseTo(bonusTotal0 + 1170.5, 2);
    expect(await money(page.locator('#fNet'))).toBeCloseTo(netTotal0 + 1170.5, 2);
  });

  test('removing a line restores the totals; a zero amount is rejected inline', async ({ page }) => {
    const bonusTotal0 = await money(page.locator('#fBonus'));
    const netTotal0 = await money(page.locator('#fNet'));
    const first = page.locator('#payrollTableBody tr:not(.expand)').first();

    const id = await addAddition(page, 0, { type: 'BONUS', amount: 500, source: 'EXT' });
    expect(await money(page.locator('#fNet'))).toBeCloseTo(netTotal0 + 500, 2);

    await first.locator('.pv-bonus-x').click();
    await expect(first.locator('.pv-bonus-amount')).toHaveCount(0);
    expect(await money(page.locator('#fBonus'))).toBeCloseTo(bonusTotal0, 2);
    expect(await money(page.locator('#fNet'))).toBeCloseTo(netTotal0, 2);

    // Zero amount: error shown, nothing added
    await first.locator('.col-actions .plus').click();
    await page.fill(`#inlineBonusAmount_${id}`, '0');
    await page.click(`#btnSubmitInlineBonus_${id}`);
    await expect(page.locator('#payrollTableBody tr.expand')).toContainText('Enter a bonus amount greater than zero');
    await expect(first.locator('.pv-bonus-amount')).toHaveCount(0);
    expect(await money(page.locator('#fNet'))).toBeCloseTo(netTotal0, 2);
  });

  test('after approval the run is finalized and additions can no longer be added', async ({ page }) => {
    await addAddition(page, 0, { type: 'BONUS', amount: 200, source: 'INT' });
    await submitAndApprove(page);
    await expect(page.locator('#payrollScreen3')).toBeVisible();

    // Back to Review pay: read-only
    await page.locator('#payrollStepper .payroll-step-pill', { hasText: 'Review pay' }).click();
    await expect(page.locator('#payrollScreen2')).toBeVisible();
    await expect(page.locator('#a-finance-payroll')).toHaveClass(/payroll-locked/);
    await expect(page.locator('#payrollTableBody .col-actions .plus').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#btnP2Approve')).toBeHidden();
    await expect(page.locator('#payrollTableBody .pv-bonus-x').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#payrollTableBody tr:not(.expand)').first().locator('.pv-bonus-amount')).toContainText('$200.00');
  });
});
