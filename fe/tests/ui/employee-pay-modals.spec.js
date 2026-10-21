import { test, expect } from '@playwright/test';

// D-036 / S3: pay is not part of the employee dialog. A new employee goes straight to the Pay plan,
// and editing an employee never sends pay.
async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
}

test.describe('S3: employee dialog without pay', () => {
  test('Create has no pay fields, sends none, and opens the Pay plan for the new employee', async ({ page }) => {
    await openAdmin(page);
    let posted = null;
    await page.route('**/api/employees', async (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        // Answer with an id the mock list already knows, so the Pay plan has an employee to open for.
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'EMP002', message: 'ok' }) });
      } else {
        await route.continue();
      }
    });
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpInternalSalary')).toHaveCount(0);
    await expect(modal.locator('#fEmpExternalSalary')).toHaveCount(0);
    await expect(modal.locator('#fEmpPayFrom')).toHaveCount(0);

    await modal.locator('#fEmpLegalName').fill('Pay Plan Next Person');
    await modal.locator('#fEmpEmail').fill('payplannext@hrflow.test');
    await modal.locator('#fEmpPhone').fill('+20 100 123 4567');
    await modal.locator('#fEmpAddressLine1').fill('1 Test Street');
    await modal.locator('#fEmpJoin').fill('2026-05-01');
    await modal.locator('#empModalSaveBtn').click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted).not.toHaveProperty('internal_salary_usd');
    expect(posted).not.toHaveProperty('external_salary_usd');
    expect(posted).not.toHaveProperty('pay_effective_from');
    expect(posted.join_date).toBe('2026-05-01');

    const plan = page.locator('#compensationPlanModal');
    await expect(plan).toBeVisible();
    await expect(plan.locator('#compPlanEmpName')).toContainText('John Doe');
    await plan.locator('#compPlanCloseBtn').click();             // "set it later"
    await expect(plan).not.toBeVisible();
  });

  test('Edit shows no pay fields or pay shortcuts', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openEmployeeModal('EMP001'));
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpName')).toHaveValue('Sarah Connor');
    await expect(modal.locator('#fEmpInternalSalary')).toHaveCount(0);
    await expect(modal.locator('#fEmpEditPayBtn')).toHaveCount(0);
  });

  test('Saving an edit sends neither pay nor address with the profile update', async ({ page }) => {
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
    expect(put).not.toHaveProperty('internal_salary_usd');
    expect(put).not.toHaveProperty('external_salary_usd');
    expect(put).not.toHaveProperty('address_line_1');
    expect(await page.evaluate(() => window._mockPersonalStore.EMP001.address_line_1)).toBe('1 Test Street');
  });

  test('An employee with no pay shows "Not set" on the profile and the salary overview', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => {
      const e = employees.find((x) => String(x.id) === 'EMP002');
      e.internalSalaryUsd = 0; e.externalSalaryUsd = 0; e.salary = 0;
      viewProfile('EMP002');
    });
    await expect(page.locator('#detailCompZone')).toContainText('Not set');
    await page.evaluate(() => { showSection('a-salary', 'admin'); renderSalaryPage(''); });
    await expect(page.locator('#salaryTableBody tr[data-employee-id="EMP002"]')).toContainText('Not set');
  });
});
