import { test, expect } from '@playwright/test';

// H2: Salary and Raises is a read-only overview (docs/hr/01-compensation-entry-points-plan.md).

async function openSalary(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof viewProfile === 'function' && employees.length);
  await page.evaluate(() => showSection('a-salary', 'admin'));
  await expect(page.locator('#salaryTableBody tr.salary-row').first()).toBeVisible();
}

test.describe('H2: Salary and Raises read-only overview', () => {
  test('AC1: no toolbar, no Actions column, no control opens the raise or plan modal', async ({ page }) => {
    await openSalary(page);
    const sec = page.locator('#a-salary');
    await expect(sec.locator('.toolbar')).toHaveCount(0);
    await expect(sec.locator('#btnOpenRaiseModal')).toHaveCount(0);
    await expect(sec.locator('thead th', { hasText: 'Actions' })).toHaveCount(0);
    await expect(sec.locator('#salaryTableBody button')).toHaveCount(0);
    await expect(sec.locator('[onclick*="openRaiseModal"], [onclick*="openCompPlanModal"]')).toHaveCount(0);
    await page.locator('#salaryTableBody tr').first().locator('td').nth(2).click();
    await expect(page.locator('#raiseModal')).not.toBeVisible();
    await expect(page.locator('#compensationPlanModal')).not.toBeVisible();
  });

  test('AC2: a row click and the name link open the profile', async ({ page }) => {
    await openSalary(page);
    const row = page.locator('#salaryTableBody tr[data-employee-id="EMP001"]');
    await expect(row.locator('a.salary-emp-link')).toHaveAttribute('href', /employee-detail\/EMP001/);
    await row.locator('td').nth(1).click();
    await expect(page.locator('#a-employee-detail')).toHaveClass(/active/);
    await expect(page.locator('#employeeCompensationCard')).toBeVisible();

    await page.evaluate(() => showSection('a-salary', 'admin'));
    await page.locator('#salaryTableBody tr[data-employee-id="EMP002"] a.salary-emp-link').click();
    await expect(page.locator('#a-employee-detail')).toHaveClass(/active/);
    await expect(page).toHaveURL(/employee-detail\/EMP002/);
  });

  test('AC3: search filters by name and department and sits in the card header', async ({ page }) => {
    await openSalary(page);
    await expect(page.locator('#a-salary .card-head #salarySearch')).toBeVisible();
    const rows = page.locator('#salaryTableBody tr.salary-row');
    const all = await rows.count();
    await page.locator('#salarySearch').fill('sarah');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Sarah Connor');
    await page.locator('#salarySearch').fill('design');
    await expect(rows.first()).toContainText('John Doe');
    await page.locator('#salarySearch').fill('zzzz-none');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#salaryTableBody')).toContainText('No employees match');
    await page.locator('#salarySearch').fill('');
    await expect(rows).toHaveCount(all);
  });

  for (const [name, vp] of [['1440px', { width: 1440, height: 900 }], ['390px', { width: 390, height: 844 }]]) {
    test(`AC4: no toolbar strip and no page-level horizontal scroll at ${name}`, async ({ page }) => {
      await openSalary(page, vp);
      await expect(page.locator('#a-salary .toolbar')).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await page.locator('#a-salary .card-head #salarySearch').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    });
  }

  test('AC5: stat cards and raise history intact; raises-this-year uses the current year', async ({ page }) => {
    await openSalary(page);
    await expect(page.locator('#statPayroll')).not.toBeEmpty();
    await expect(page.locator('#companyRaiseHistoryBody')).toBeVisible();
    const year = new Date().getFullYear();
    await page.evaluate((y) => {
      employees = [
        { id: 1, name: 'A One', dept: 'Eng', internalSalaryUsd: 100, externalSalaryUsd: 200, salary: 300, salaryHistory: [
          { date: `${y}-02-01`, pct: '10%', newInternal: 100, newExternal: 200, reason: 'x' },
          { date: `${y - 1}-02-01`, pct: '5%', newInternal: 90, newExternal: 190, reason: 'y' } ] },
        { id: 2, name: 'B Two', dept: 'Ops', internalSalaryUsd: 50, externalSalaryUsd: 0, salary: 50, salaryHistory: [
          { date: `${y}-03-01`, pct: '20%', newInternal: 50, newExternal: 0, reason: 'z' } ] },
      ];
      renderSalaryPage();
    }, year);
    await expect(page.locator('#statRaisesYtd')).toHaveText('2');
    await expect(page.locator('#statAvgRaise')).toHaveText('+15.0%');
    await expect(page.locator('#companyRaiseHistoryBody tr')).toHaveCount(3);
    // Last raise is the newest by date, not the last array element
    await expect(page.locator('#salaryTableBody tr[data-employee-id="1"]')).toContainText(`${year}-02-01`);
  });
});
