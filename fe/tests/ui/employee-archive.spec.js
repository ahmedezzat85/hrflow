import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// Archived employees: archive / unarchive from the table, an Archived tab, no salary-document button for an archived row,
// the status field locked in the edit dialog, and archived employees left out of the raise picker.
async function openEmployees(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
  await openAdminPage(page, 'a-employees');
  await expect(page.locator('#employeesTableBody tr').first()).toBeVisible();
}

async function stubArchiveApi(page) {
  const calls = [];
  await page.route('**/api/employees/*/archive', async (route) => {
    calls.push('archive');
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ archived: true, archived_at: '2026-11-01T09:00:00', status: 'Archived' }) });
  });
  await page.route('**/api/employees/*/unarchive', async (route) => {
    calls.push('unarchive');
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ archived: false, archived_at: null, status: 'Active' }) });
  });
  return calls;
}

test.describe('Employee archived state', () => {
  test('archiving moves an employee from All to the Archived tab and unarchiving brings them back', async ({ page }) => {
    await openEmployees(page);
    const calls = await stubArchiveApi(page);
    const before = await page.evaluate(() => employees.filter(e => !e.archived).length);
    const first = await page.evaluate(() => ({ id: employees[0].id, name: employees[0].name }));
    const row = page.locator(`#employeesTableBody tr:has-text("${first.name}")`);

    await row.locator('button[title="Archive"]').click();
    await expect(page.locator('#archiveModal')).toBeVisible();
    await expect(page.locator('#archiveEmpName')).toHaveText(first.name);
    await page.locator('#archiveConfirmBtn').click();
    await expect.poll(() => calls).toContain('archive');

    await expect(page.locator(`#employeesTableBody tr:has-text("${first.name}")`)).toHaveCount(0);
    await expect(page.locator('#empCountAll')).toHaveText(String(before - 1));
    await expect(page.locator('#empCountArchived')).toHaveText('1');

    await page.locator('#employeeStatusFilterGroup [data-emp-status="Archived"]').click();
    const archivedRow = page.locator(`#employeesTableBody tr:has-text("${first.name}")`);
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow).toContainText('Archived');
    await expect(archivedRow.locator('button[title="Generate salary payment doc"]')).toHaveCount(0);
    await expect(archivedRow.locator('button[title="Archive"]')).toHaveCount(0);

    await archivedRow.locator('button[title="Unarchive"]').click();
    await expect.poll(() => calls).toContain('unarchive');
    await page.locator('#employeeStatusFilterGroup [data-emp-status="all"]').click();
    await expect(page.locator(`#employeesTableBody tr:has-text("${first.name}")`)).toBeVisible();
    await expect(page.locator('#empCountArchived')).toHaveText('0');
  });

  test('cancelling the archive dialog changes nothing', async ({ page }) => {
    await openEmployees(page);
    const calls = await stubArchiveApi(page);
    await page.locator('#employeesTableBody tr').first().locator('button[title="Archive"]').click();
    await expect(page.locator('#archiveModal')).toBeVisible();
    await page.locator('#archiveModal .btn', { hasText: 'Cancel' }).click();
    await expect(page.locator('#archiveModal')).toBeHidden();
    expect(calls).toEqual([]);
  });

  test('the edit dialog of an archived employee locks the status and never sends it', async ({ page }) => {
    await openEmployees(page);
    await page.evaluate(() => { const e = employees[0]; e.archived = true; e.status = 'Archived'; renderEmployeesTable(''); });
    const id = await page.evaluate(() => employees[0].id);
    const sent = { body: null };
    await page.route('**/api/employees/*', async (route) => {
      if (route.request().method() === 'PUT') {
        sent.body = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
      } else {
        await route.continue();
      }
    });
    await page.evaluate((empId) => openEmployeeModal(empId), id);
    const modal = page.locator('#employeeModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpStatus')).toBeDisabled();
    await modal.locator('#fEmpRole').fill('Archive Role');
    await modal.locator('#empModalSaveBtn').click();
    await expect.poll(() => sent.body).not.toBeNull();
    expect(sent.body.job_role).toBe('Archive Role');
    expect(sent.body).not.toHaveProperty('status');
  });

  test('archived employees are not offered in the raise picker', async ({ page }) => {
    await openEmployees(page);
    const { archivedId, otherId } = await page.evaluate(() => {
      employees[0].archived = true;
      return { archivedId: String(employees[0].id), otherId: String(employees[1].id) };
    });
    await page.evaluate(() => openRaiseModal());
    const values = await page.locator('#rEmpSelect option').evaluateAll((opts) => opts.map((o) => o.value));
    expect(values).toContain(otherId);
    expect(values).not.toContain(archivedId);
  });
});
