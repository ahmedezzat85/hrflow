import { test, expect } from '@playwright/test';

// Restyle v3 fixes, slice 2: employee detail header, KPI strip and bank card states (HR-EmployeeDetail mock).
async function openProfile(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.locator('a.nav-item[data-page="a-employees"]').click();
  await page.locator('#employeesTableBody tr').first().locator('td.tname a').click();
  await expect(page.locator('#a-employee-detail')).toBeVisible();
}

test.describe('v3 employee detail (fixes slice 2)', () => {
  test('header shows the employee code, sentence-case pill and no joined date', async ({ page }) => {
    await openProfile(page);
    const head = page.locator('#detailProfileHead');
    await expect(head.locator('.esc-meta')).toContainText(/EMP\d{3}/);
    await expect(head.locator('.esc-meta')).not.toContainText('Joined');
    await expect(head).toContainText('Full-time');
    await expect(head).not.toContainText('Full-Time');
  });

  test('KPI strip has the mock labels and sub lines', async ({ page }) => {
    await openProfile(page);
    const kpis = page.locator('#detailInfoGrid .ed-kpi');
    await expect(kpis).toHaveCount(5);
    await expect(kpis.nth(0)).toContainText('Monthly total');
    await expect(kpis.nth(0)).toContainText('per month, USD');
    await expect(kpis.nth(1)).toContainText('paid locally');
    await expect(kpis.nth(2)).toContainText('US transfer');
    await expect(kpis.nth(3)).toContainText('Next raise');
    await expect(kpis.nth(4)).toContainText('Vacation left');
    await expect(kpis.nth(4)).toContainText(/days, \d+ used in \d{4}/);
  });

  test('bank card: missing details show a flag, the alert text and an Add action; on file shows the details', async ({ page }) => {
    await openProfile(page);
    const pill = page.locator('#bankAccountPill');
    await page.evaluate(() => {
      Api.getBankAccount = () => Promise.resolve({ has_details: false });
      return loadBankAccountStatus(currentDetailEmployeeId);
    });
    await expect(pill).toContainText('Missing');
    await expect(page.locator('#bankAccountStatusText')).toBeVisible();
    await expect(page.locator('#bankAccountStatusActionBtn')).toHaveText('Add bank details');
    await expect(page.locator('#bankAccountDetailsBody')).toBeHidden();
    await expect(page.locator('#bankAccountActionBtn')).toBeHidden();

    await page.evaluate(() => {
      Api.getBankAccount = () => Promise.resolve({ has_details: true, bank_name: 'CIB', iban: 'EG38 **** 0721', swift_code: 'CIBEEGCX' });
      return loadBankAccountStatus(currentDetailEmployeeId);
    });
    await expect(pill).toContainText('On file');
    await expect(page.locator('#bankAccountStatusText')).toBeHidden();
    await expect(page.locator('#bankAccountDetailsBody')).toBeVisible();
    await expect(page.locator('#bankDetailName')).toHaveText('CIB');
    await expect(page.locator('#bankAccountActionBtn')).toHaveText('Edit');
  });

  test('unset details read "Not set" and edit actions are text links', async ({ page }) => {
    await openProfile(page);
    await expect(page.locator('#detailMetaBody .ed-unset').first()).toHaveText('Not set');
    await expect(page.locator('#socialInsuranceActionBtn')).toHaveText('Edit');
    await expect(page.locator('#a-employee-detail').getByRole('button', { name: 'Upload document' })).toBeVisible();
  });
});
