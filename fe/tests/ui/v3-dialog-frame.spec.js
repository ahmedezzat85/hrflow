import { test, expect } from '@playwright/test';

// Restyle v3 fixes, slice 1: HR/System dialogs follow the mocks (Dlg-*) for markers, add-ons and structure.
const DIALOGS = [
  'employeeModal', 'raiseModal', 'roleModal', 'behalfVacationModal', 'behalfClaimModal', 'categoryModal',
  'compensationPlanModal', 'socialInsuranceModal', 'bankAccountModal', 'companyDocumentModal',
  'externalUserModal', 'employeeDocumentModal',
];

async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
}

test.describe('v3 dialog frame (fixes slice 1)', () => {
  test('no required-asterisk markers in the HR/System dialogs', async ({ page }) => {
    await openAdmin(page);
    for (const id of DIALOGS) {
      const stars = await page.locator(`#${id} label .req`).count();
      expect(stars, id).toBe(0);
    }
  });

  test('add-on prefixes sit inside the input group (Category, Claim, Social insurance)', async ({ page }) => {
    await openAdmin(page);
    const cases = [['categoryModal', 'fCatLimit', 'EGP'], ['behalfClaimModal', 'bcAmount', 'EGP'],
      ['socialInsuranceModal', 'fSocialInsBase', 'EGP']];
    for (const [modal, input, text] of cases) {
      await page.evaluate((m) => openModal(m), modal);
      const addon = page.locator(`#${modal} .input-group:has(#${input}) > .input-addon`);
      await expect(addon, input).toHaveText(text);
      const [aBox, iBox] = await Promise.all([
        addon.evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right }; }),
        page.locator(`#${input}`).evaluate((e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top }; }),
      ]);
      expect(Math.abs(aBox.top - iBox.top), input).toBeLessThan(2);
      expect(iBox.left, input).toBeGreaterThanOrEqual(aBox.right - 1);
      expect(aBox.right, input).toBeGreaterThan(aBox.left + 10);
      await page.evaluate((m) => closeModal(m), modal);
    }
  });

  test('Role dialog: name and description sit side by side', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openModal('roleModal'));
    const [a, b] = await page.evaluate(() => ['fRoleName', 'fRoleDescription'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { top: r.top, left: r.left };
    }));
    expect(Math.abs(a.top - b.top)).toBeLessThan(2);
    expect(b.left).toBeGreaterThan(a.left);
    // The permission filter icon must not overlap the placeholder text
    const overlap = await page.evaluate(() => {
      const icon = document.querySelector('#roleModal .search-box > svg').getBoundingClientRect();
      const input = document.getElementById('rolePermSearch').getBoundingClientRect();
      return icon.right > input.left + 1;
    });
    expect(overlap).toBe(false);
  });

  test('Employee dialog has sentence-case section headings and no pay inputs', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openModal('employeeModal'));
    const titles = await page.locator('#employeeModal .fv-dialog-section-title').allTextContents();
    expect(titles).toEqual(['Basic details', 'Personal details', 'Employment', 'Salary payment docs']);
    // D-036: pay lives only in the Pay plan.
    await expect(page.locator('#employeeModal input[id*="Salary"], #employeeModal #fEmpPayFrom')).toHaveCount(0);
  });

  test('Vacation dialog follows the mock field order and button text', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => openModal('behalfVacationModal'));
    await expect(page.locator('#behalfVacationSaveBtn')).toHaveText('Record leave');
    const order = await page.evaluate(() => [...document.querySelectorAll('#behalfVacationModal .form-field label')].map((l) => l.textContent.trim()));
    expect(order).toEqual(['Type', 'Status', 'Start date', 'End date', 'Days', 'Record date, optional']);
  });
});
