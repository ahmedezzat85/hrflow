import { test, expect } from '@playwright/test';

// H1: the Compensation card on the employee profile (docs/hr/01-compensation-entry-points-plan.md).

async function ready(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof showSection === 'function' && typeof viewProfile === 'function');
  // Numeric ids, as the real backend returns them; two employees so the history must be filtered per person
  await page.evaluate(() => {
    employees = [
      {
        id: 1, name: 'Sarah Connor', role: 'Engineering Lead', dept: 'Engineering', status: 'Active', email: 's@voyance.com',
        internalSalaryUsd: 5000, externalSalaryUsd: 7500, nextRaise: '2027-01-01',
        salaryHistory: [
          { date: '2024-01-15', newInternal: 4500, newExternal: 6500, prevInternal: 4000, prevExternal: 6000, reason: 'Mid-year adjustment' },
          { date: '2025-01-15', newInternal: 5000, newExternal: 7500, prevInternal: 4500, prevExternal: 6500, reason: 'Annual performance raise' },
        ],
      },
      {
        id: 2, name: 'John Doe', role: 'Product Designer', dept: 'Design', status: 'Active', email: 'j@voyance.com',
        internalSalaryUsd: 3000, externalSalaryUsd: 0, nextRaise: '2027-03-01',
        salaryHistory: [{ date: '2025-06-01', newInternal: 3000, newExternal: 0, prevInternal: 2800, prevExternal: 0, reason: 'John only reason' }],
      },
      { id: 3, name: 'Alex Rivera', role: 'QA', dept: 'Engineering', status: 'Active', email: 'a@voyance.com', internalSalaryUsd: 1000, externalSalaryUsd: 0, salaryHistory: [] },
    ];
  });
}

async function openProfile(page, id) {
  await page.evaluate((i) => viewProfile(i), id);
  await expect(page.locator('#a-employee-detail')).toHaveClass(/active/);
}

test.describe('H1: Compensation card on the employee profile', () => {
  test('AC1: shows the split, next raise, last raise and only this employee\'s history, newest first', async ({ page }) => {
    await ready(page);
    await openProfile(page, 1);
    const card = page.locator('#employeeCompensationCard');
    await expect(card).toBeVisible();
    await expect(card.locator('#compInternalVal')).toHaveText('$5,000');
    await expect(card.locator('#compExternalVal')).toHaveText('$7,500');
    await expect(card.locator('#compTotalVal')).toHaveText('$12,500');
    await expect(card.locator('#compNextRaiseVal')).toContainText('2027');
    await expect(card.locator('#compLastRaiseVal')).toContainText('2025');
    const rows = card.locator('#compensationHistoryBody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Annual performance raise');
    await expect(rows.nth(1)).toContainText('Mid-year adjustment');
    await expect(card).not.toContainText('John only reason');
    // The profile head keeps only the monthly total and a link to the card
    await expect(page.locator('#detailCompZone')).toContainText('$12,500');
    await expect(page.locator('#detailCompZone')).not.toContainText('Internal');
    await expect(page.locator('#compDetailsLink')).toBeVisible();
  });

  test('empty state when the employee has no raises', async ({ page }) => {
    await ready(page);
    await openProfile(page, 3);
    await expect(page.locator('#compensationHistoryBody')).toContainText('No raises recorded yet.');
    await expect(page.locator('#compLastRaiseVal')).toContainText('No raises yet');
  });

  test('AC2: without hr.salary.read there is no card and no salary figure in Payroll and payments', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { SessionInfo._permissions = SessionInfo._permissions.filter((p) => !p.startsWith('hr.salary')); });
    await openProfile(page, 1);
    await expect(page.locator('#employeeCompensationCard')).toBeHidden();
    await expect(page.locator('#payrollPaymentsBody')).not.toContainText('Monthly total');
    await expect(page.locator('#detailCompZone')).not.toContainText('$12,500');
  });

  test('AC3: with read but not write the card has no action buttons', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { SessionInfo._permissions = SessionInfo._permissions.filter((p) => p !== 'hr.salary.write'); });
    await openProfile(page, 1);
    await expect(page.locator('#employeeCompensationCard')).toBeVisible();
    await expect(page.locator('#compApplyRaiseBtn')).toBeHidden();
    await expect(page.locator('#compEditPlanBtn')).toBeHidden();
  });

  test('AC4: Apply raise fixes the employee in the modal and the card updates in place', async ({ page }) => {
    await ready(page);
    await openProfile(page, 1);
    await page.evaluate(() => {
      Api.applyRaise = async (payload) => ({
        total_delta_pct: 10, new_internal_salary_usd: payload.new_internal_salary_usd, new_external_salary_usd: payload.new_external_salary_usd,
      });
      window.loadAdminData = async () => {
        const e = employees.find((x) => x.id === 1);
        e.internalSalaryUsd = 5500; e.externalSalaryUsd = 8000;
        e.salaryHistory.push({ date: '2026-10-01', newInternal: 5500, newExternal: 8000, prevInternal: 5000, prevExternal: 7500, reason: 'Annual performance raise' });
      };
    });
    await page.locator('#compApplyRaiseBtn').click();
    await expect(page.locator('#raiseModal')).toHaveClass(/active/);
    await expect(page.locator('#rEmpName')).toBeVisible();
    await expect(page.locator('#rEmpName')).toHaveValue(/Sarah Connor/);
    await expect(page.locator('#rEmpSelect')).toBeHidden();
    await page.locator('#rNewInternal').fill('5500');
    await page.locator('#rNewExternal').fill('8000');
    await page.locator('#raiseModalSaveBtn').click();
    await expect(page.locator('#raiseModal')).not.toHaveClass(/active/);
    await expect(page.locator('#a-employee-detail')).toHaveClass(/active/);
    await expect(page.locator('#compTotalVal')).toHaveText('$13,500');
    await expect(page.locator('#compensationHistoryBody tr')).toHaveCount(3);
    await expect(page.locator('#detailCompZone')).toContainText('$13,500');
  });

  test('raise modal called without an employee keeps the dropdown', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => openRaiseModal());
    await expect(page.locator('#rEmpSelect')).toBeVisible();
    await expect(page.locator('#rEmpName')).toBeHidden();
    await page.evaluate(() => closeModal('raiseModal'));
  });

  test('AC5: Edit plan opens the compensation plan modal for that employee', async ({ page }) => {
    await ready(page);
    await openProfile(page, 1);
    await page.locator('#compEditPlanBtn').click();
    await expect(page.locator('#compensationPlanModal')).toHaveClass(/active/);
    await expect(page.locator('#compPlanEmpName')).toContainText('Sarah Connor');
    await page.locator('#compPlanCloseBtn').click();
  });

  test('AC6: no Apply Salary Raise quick action and no View compensation plan button', async ({ page }) => {
    await ready(page);
    await openProfile(page, 1);
    await expect(page.locator('#a-employee-detail')).not.toContainText('Apply Salary Raise');
    await expect(page.locator('#a-employee-detail')).not.toContainText('View compensation plan');
  });

  test('deep link: viewProfile(id, "compensation") lands on the card', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => viewProfile(1, 'compensation'));
    await expect(page.locator('#employeeCompensationCard')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('compensation');
  });

  test('AC7: the payroll fix-issue link for a missing plan still opens the plan modal', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'fakeFixIssue';
      b.dataset.action = 'payroll-fix-issue';
      b.dataset.code = 'MISSING_COMP_PLAN';
      b.dataset.employeeId = '1';
      document.body.appendChild(b);
    });
    await page.locator('#fakeFixIssue').dispatchEvent('click');
    await expect(page.locator('#compensationPlanModal')).toHaveClass(/active/);
    await expect(page.locator('#compPlanEmpName')).toContainText('Sarah Connor');
    await page.evaluate(() => document.getElementById('fakeFixIssue').remove());
    await page.locator('#compPlanCloseBtn').click();
  });
});
