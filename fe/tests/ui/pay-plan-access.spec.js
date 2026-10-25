import { test, expect } from '@playwright/test';

// D-038: the Pay plan opens for finance.payroll.prepare OR hr.salary.write.
// Entry points: Edit plan on the employee profile (needs the Compensation card, hr.salary.read) and openCompPlanModal.
async function openAs(page, mock) {
  await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Router && typeof openCompPlanModal === 'function' && typeof employees !== 'undefined' && employees.length);
}

const OPENS = { admin: true, hr: true, payroll: true, finance: false };

for (const [mock, opens] of Object.entries(OPENS)) {
  test(`Pay plan modal ${opens ? 'opens' : 'stays closed'} for ${mock}`, async ({ page }) => {
    await openAs(page, mock);
    await page.evaluate(() => openCompPlanModal(employees[0].id));
    if (opens) {
      await expect(page.locator('#compensationPlanModal')).toHaveClass(/active/);
      await expect(page.locator('#compPlanSaveBtn')).toBeVisible();
      await page.click('#compPlanCloseBtn');
      await expect(page.locator('#compensationPlanModal')).toBeHidden();
    } else {
      await page.waitForTimeout(300);
      await expect(page.locator('#compensationPlanModal')).not.toHaveClass(/active/);
    }
  });
}

test('Edit plan and Apply raise on the profile follow their own keys', async ({ page }) => {
  await openAs(page, 'hr');
  await page.evaluate(() => viewProfile(employees[0].id));
  await expect(page.locator('#employeeCompensationCard')).toBeVisible();
  await expect(page.locator('#compEditPlanBtn')).toBeVisible();
  await expect(page.locator('#compApplyRaiseBtn')).toBeVisible();
  await page.evaluate(() => { SessionInfo.set({ portal: 'admin', roles: ['Custom'], employee_id: 1, name: 'Test', permissions: ['hr.employee.read', 'hr.salary.read', 'finance.payroll.prepare', 'finance.payroll.read'] }); renderCompensationCard(employees[0]); });
  await expect(page.locator('#compEditPlanBtn')).toBeVisible(); // finance.payroll.prepare alone is enough
  await expect(page.locator('#compApplyRaiseBtn')).toBeHidden(); // raises stay on hr.salary.write
});
