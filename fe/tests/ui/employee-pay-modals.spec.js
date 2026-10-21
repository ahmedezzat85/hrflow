import { test, expect } from '@playwright/test';

// P3 (D-034): create modal gets "Pay effective from"; edit modal shows pay read-only
// and routes pay changes through the Pay plan modal.
async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
}

test.describe('P3: employee create/edit pay handling', () => {
  test('Create modal defaults Pay effective from to the Join date and sends it', async ({ page }) => {
    await openAdmin(page);
    let posted = null;
    await page.route('**/api/employees', async (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 99, message: 'ok' }) });
      } else {
        await route.continue();
      }
    });
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpPayFromField')).toBeVisible();
    await expect(modal.locator('#fEmpEditPayRow')).toBeHidden();
    await expect(modal.locator('#fEmpInternalSalary')).toBeEditable();

    await modal.locator('#fEmpName').fill('Pay From Test');
    await modal.locator('#fEmpEmail').fill('payfrom@hrflow.test');
    await modal.locator('#fEmpLegalName').fill('Pay From Test Legal');
    await modal.locator('#fEmpPhone').fill('+20 100 123 4567');
    await modal.locator('#fEmpAddressLine1').fill('1 Test Street');
    await modal.locator('#fEmpJoin').fill('2022-05-01');
    await expect(modal.locator('#fEmpPayFrom')).toHaveValue('2022-05-01');
    await modal.locator('#fEmpPayFrom').fill('2026-01-01');
    await modal.locator('#fEmpJoin').fill('2022-06-01');
    await expect(modal.locator('#fEmpPayFrom')).toHaveValue('2026-01-01'); // edited value is not overwritten
    await modal.locator('#fEmpExternalSalary').fill('2000');
    await modal.locator('#empModalSaveBtn, .btn-fill').first().click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted.pay_effective_from).toBe('2026-01-01');
    expect(posted.join_date).toBe('2022-06-01');
    expect(posted.external_salary_usd).toBe(2000);
  });

  test('Edit modal shows pay read-only, hides Pay effective from, and opens the Pay plan', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openEmployeeModal('EMP001'));
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpInternalSalary')).toHaveValue('5000');
    await expect(modal.locator('#fEmpInternalSalary')).not.toBeEditable();
    await expect(modal.locator('#fEmpExternalSalary')).not.toBeEditable();
    await expect(modal.locator('#fEmpPayFromField')).toBeHidden();
    await modal.locator('#fEmpEditPayBtn').click();
    await expect(modal).not.toBeVisible();
    const plan = page.locator('#compensationPlanModal');
    await expect(plan).toBeVisible();
    await expect(plan.locator('#compPlanEmpName')).toContainText('Sarah Connor');
    await plan.locator('#compPlanCloseBtn').click();
    await expect(plan).not.toBeVisible();
  });

  test('Saving other fields on edit never sends salary fields', async ({ page }) => {
    await openAdmin(page);
    let put = null;
    await page.route('**/api/employees/**', async (route) => {
      if (route.request().method() === 'PUT') {
        put = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
      } else {
        await route.continue();
      }
    });
    await page.evaluate(() => openEmployeeModal('EMP001'));
    const modal = page.locator('#employeeModal');
    await expect(modal.locator('#fEmpAddressLine1')).not.toHaveValue('');   // personal details load asynchronously
    await modal.locator('#fEmpAddressLine1').fill('1 Test Street');
    await modal.locator('#empModalSaveBtn, .btn-fill').first().click();
    await expect.poll(() => put).not.toBeNull();
    // Address now travels with the personal details, never with the profile update.
    expect(put).not.toHaveProperty('address_line_1');
    expect(await page.evaluate(() => window._mockPersonalStore.EMP001.address_line_1)).toBe('1 Test Street');
    expect(put).not.toHaveProperty('internal_salary_usd');
    expect(put).not.toHaveProperty('external_salary_usd');
  });
});
