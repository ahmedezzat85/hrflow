import { test, expect } from '@playwright/test';

// D-036 / S2: legal name, phone, address and ID behind hr.employee_personal.*; the display name is what
// lists show. Mock mode serves the personal endpoint from window._mockPersonalStore.
async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof openEmployeeModal === 'function' && employees.length);
}

async function captureCreate(page) {
  const box = { posted: null };
  await page.route('**/api/employees', async (route) => {
    if (route.request().method() === 'POST') {
      box.posted = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 99, message: 'ok' }) });
    } else {
      await route.continue();
    }
  });
  return box;
}

async function fillRequired(modal) {
  await modal.locator('#fEmpEmail').fill('personal@hrflow.test');
  await modal.locator('#fEmpLegalName').fill('Laila Ahmed Hassan Ali');
  await modal.locator('#fEmpPhone').fill('+20 100 123 4567');
  await modal.locator('#fEmpAddressLine1').fill('15 Example Street');
}

test.describe('S2: employee personal details', () => {
  test('legal name pre-fills the display name until it is edited, with a soft hint for one word', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await modal.locator('#fEmpLegalName').fill('Laila Ahmed Hassan Ali');
    await expect(modal.locator('#fEmpName')).toHaveValue('Laila Ali');
    await expect(modal.locator('#fEmpNameHint')).toBeHidden();

    await modal.locator('#fEmpName').fill('Laila');
    await expect(modal.locator('#fEmpNameHint')).toBeVisible();      // soft: it does not block
    await modal.locator('#fEmpLegalName').fill('Laila Ahmed Hassan Mostafa');
    await expect(modal.locator('#fEmpName')).toHaveValue('Laila');   // edited display name is not overwritten
  });

  test('create sends the normalised personal details and keeps the ID optional', async ({ page }) => {
    await openAdmin(page);
    const box = await captureCreate(page);
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await fillRequired(modal);
    await modal.locator('#empModalSaveBtn').click();
    await expect.poll(() => box.posted).not.toBeNull();
    expect(box.posted.name).toBe('Laila Ali');
    expect(box.posted.legal_name).toBe('Laila Ahmed Hassan Ali');
    expect(box.posted.phone).toBe('+20 100 123 4567');          // the server normalises it
    expect(box.posted.address_line_1).toBe('15 Example Street');
    expect(box.posted).not.toHaveProperty('id_type');
    expect(box.posted).not.toHaveProperty('id_number');
  });

  test('a bad phone number is rejected before sending', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await fillRequired(modal);
    await modal.locator('#fEmpPhone').fill('call me');
    await modal.locator('#empModalSaveBtn').click();
    await expect(modal.locator('#fEmpPhone')).toHaveAttribute('aria-invalid', 'true');
  });

  test('national ID needs 14 digits; a passport takes letters and is sent upper-cased', async ({ page }) => {
    await openAdmin(page);
    const box = await captureCreate(page);
    await page.evaluate(() => openEmployeeModal());
    const modal = page.locator('#employeeModal');
    await fillRequired(modal);
    await expect(modal.locator('#fEmpIdNumberField')).toBeHidden();

    await modal.locator('#fEmpIdType').selectOption('national_id');
    await expect(modal.locator('#fEmpIdNumberField')).toBeVisible();
    await modal.locator('#fEmpIdNumber').fill('1234');
    await modal.locator('#empModalSaveBtn').click();
    await expect(modal.locator('.form-error-summary')).toContainText('exactly 14 digits');
    expect(box.posted).toBeNull();

    await modal.locator('#fEmpIdType').selectOption('passport');
    await modal.locator('#fEmpIdNumber').fill('ab 123456');
    await modal.locator('#empModalSaveBtn').click();
    await expect.poll(() => box.posted).not.toBeNull();
    expect(box.posted.id_type).toBe('passport');
    expect(box.posted.id_number).toBe('AB123456');
  });

  test('edit loads the saved details, keeps an untouched ID, and clears it only on request', async ({ page }) => {
    await openAdmin(page);
    await page.route('**/api/employees/**', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
      } else {
        await route.continue();
      }
    });
    await page.evaluate(() => openEmployeeModal('EMP001'));
    const modal = page.locator('#employeeModal');
    await expect(modal.locator('#fEmpLegalName')).toHaveValue('Sarah Connor');
    await expect(modal.locator('#fEmpIdType')).toHaveValue('national_id');
    await expect(modal.locator('#fEmpIdKeepHint')).toContainText('1234');
    await expect(modal.locator('#fEmpIdKeepHint')).not.toContainText('12345678901234');   // masked, never the full number

    await modal.locator('#fEmpPhone').fill('+20 111 222 3333');
    await modal.locator('#empModalSaveBtn').click();
    await expect(modal).not.toBeVisible();
    const kept = await page.evaluate(() => window._mockPersonalStore.EMP001);
    expect(kept.phone).toBe('+20 111 222 3333');
    expect(kept.id_number).toBe('12345678901234');      // untouched ID stays

    await page.waitForFunction(() => !document.getElementById('employeeModal').classList.contains('active'));
    await page.evaluate(() => openEmployeeModal('EMP001'));
    await expect(modal).toBeVisible();
    await expect(modal.locator('#fEmpIdType')).toHaveValue('national_id');
    await modal.locator('#fEmpIdType').selectOption('');
    await modal.locator('#empModalSaveBtn').dispatchEvent('click');   // the first save's toast may cover the button
    await expect(modal).not.toBeVisible();
    const cleared = await page.evaluate(() => window._mockPersonalStore.EMP001);
    expect(cleared.id_type).toBe('');
    expect(cleared.id_number).toBe('');
  });

  test('the employee page shows personal details with the ID masked until revealed', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => viewProfile('EMP001'));
    const rows = page.locator('#detailPersonalRows');
    await expect(rows).toContainText('Legal name');
    await expect(rows).toContainText('Phone');
    await expect(rows).toContainText('Address');
    await expect(rows.locator('#detailIdValue')).toHaveText('**********1234');
    await rows.locator('#detailIdToggleBtn').click();
    await expect(rows.locator('#detailIdValue')).toHaveText('12345678901234');
    await rows.locator('#detailIdToggleBtn').click();
    await expect(rows.locator('#detailIdValue')).toHaveText('**********1234');
  });

  test('the legal name stays off the employees table', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => {
      window._mockPersonalStore = { EMP001: { legal_name: 'Sarah Jane Connor Legal', phone: '', address_line_1: 'x', address_line_2: '', id_type: '', id_number: '' } };
    });
    await page.evaluate(() => { showSection('a-employees', 'admin'); renderEmployeesTable(''); });
    const table = page.locator('#employeesTableBody');
    await expect(table).toContainText('Sarah Connor');
    await expect(table).not.toContainText('Legal');
  });

  test('without the personal permissions the section and rows are hidden', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => {
      SessionInfo._permissions = SessionInfo._permissions.filter((p) => !p.startsWith('hr.employee_personal'));
    });
    await page.evaluate(() => openEmployeeModal('EMP001'));
    await expect(page.locator('#fEmpPersonalSection')).toBeHidden();
    await page.evaluate(() => closeModal('employeeModal'));
    await page.evaluate(() => viewProfile('EMP001'));
    await expect(page.locator('#detailPersonalRows')).toBeEmpty();
  });
});
