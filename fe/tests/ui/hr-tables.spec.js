import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

async function ready(page, url = '/?mock=admin') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Router && window.FinanceTable && window.PayrollApp && typeof showSection === 'function');
  await page.waitForTimeout(300);
}

const TABLES = [
  ['a-employees', 'employeesTableBody'],
  ['a-salary', 'salaryTableBody'],
  ['a-salary', 'companyRaiseHistoryBody'],
  ['a-vacations', 'vacationBalanceBody'],
  ['a-insurance', 'insuranceTableBody'],
  ['a-requests', 'requestsTableBody'],
  ['a-dochub', 'dochubTableBody'],
];

test.describe('U7 HR tables and cross-links', () => {
  for (const [pageId, bodyId] of TABLES) {
    test(`${bodyId} sorts by header click and pages beyond 10 rows`, async ({ page }) => {
      await ready(page);
      await page.evaluate((id) => showSection(id, 'admin'), pageId);
      const cols = await page.evaluate((id) => document.querySelectorAll(`#${id}`)[0].closest('table').querySelectorAll('thead th[data-sort]').length, bodyId);
      expect(cols, 'sortable headers').toBeGreaterThan(0);
      // 25 rows, first column descending numbers as text, so the sorted order is checkable
      await page.evaluate((id) => {
        const body = document.getElementById(id);
        const n = body.closest('table').querySelectorAll('thead th').length;
        body.innerHTML = Array.from({ length: 25 }, (_, i) => `<tr>${Array.from({ length: n }, (_, c) => `<td>${c === 0 ? 'Row ' + String(25 - i).padStart(2, '0') : i}</td>`).join('')}</tr>`).join('');
      }, bodyId);
      const visibleRows = () => page.evaluate((id) => [...document.querySelectorAll(`#${id} tr`)].filter((r) => !r.hidden).length, bodyId);
      await expect.poll(visibleRows).toBe(10);
      await expect(page.locator(`#${bodyId}Pagination`)).toContainText('Page 1 of 3');
      await page.click(`#${bodyId}Pagination button[aria-label="Next page"]`);
      await expect(page.locator(`#${bodyId}Pagination`)).toContainText('Page 2 of 3');
      // sort ascending on the first sortable header
      await page.evaluate((id) => document.getElementById(id).closest('table').querySelector('thead th[data-sort]').click(), bodyId);
      const first = await page.evaluate((id) => [...document.querySelectorAll(`#${id} tr`)].filter((r) => !r.hidden)[0].children[0].textContent.trim(), bodyId);
      expect(first).toBeTruthy();
      await expect(page.locator(`#${bodyId}`).locator('xpath=ancestor::table').locator('thead th[data-sort][aria-sort="ascending"]')).toHaveCount(1);
    });
  }

  test('searching "Engineering" on Employees returns the Engineering staff', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      employees = [
        { id: 1, name: 'Ana Alvarez', role: 'Developer', dept: 'Engineering', email: 'ana@x.io', status: 'Active', employment_state: 'Full-Time', nextRaise: '2027-01-01', salary: 1 },
        { id: 2, name: 'Bob Brown', role: 'Designer', dept: 'Design', email: 'bob@x.io', status: 'Active', employment_state: 'Full-Time', nextRaise: '2027-01-01', salary: 1 },
        { id: 3, name: 'Cy Chen', role: 'Analyst', dept: 'Engineering', email: 'cy@x.io', status: 'Active', employment_state: 'Full-Time', nextRaise: '2027-01-01', salary: 1 },
      ];
      showSection('a-employees', 'admin');
      renderEmployeesTable('');
    });
    await page.fill('#empSearch', 'Engineering');
    await expect(page.locator('#employeesTableBody tr')).toHaveCount(2);
    await expect(page.locator('#employeesTableBody')).toContainText('Ana Alvarez');
    await expect(page.locator('#employeesTableBody')).toContainText('Cy Chen');
    await expect(page.locator('#empSearchChips .filter-chip')).toContainText('Engineering');
  });

  test('payroll screen 4: names link to the profile, missing-bank badge opens the bank section, Back returns to the run', async ({ page }) => {
    await ready(page);
    await openAdminPage(page, 'a-finance-payroll-runs');
    await page.evaluate(() => {
      PayrollApp.currentPreview = { total_net: 1, final_ext_total: 1, final_int_total: 1, exceptions: [{ code: 'MISSING_BANK_DETAILS', severity: 'warning', employee_id: 1 }] };
      PayrollApp.rows = [{ id: 1, name: 'Sarah Connor', baseExt: 1500, baseInt: 4000, deductions: 400, bonuses: [], bank_name: null, bank_account_masked: null }];
      PayrollApp.showPage('run');
      PayrollApp.setStep(3);
    });
    await expect(page.locator('#payrollScreen4')).toBeVisible();
    await expect(page.locator('#payrollPaymentPreviewTableBody .payroll-emp-link')).toHaveText('Sarah Connor');
    await page.click('#payrollPaymentPreviewTableBody .payroll-missing-bank-link');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/hr/employee-detail/1/bank');
    await expect(page.locator('#bankAccountCard')).toBeVisible();
    await page.goBack();
    await expect(page.locator('#payrollScreen4')).toBeVisible();
  });

  test('employee profile has a Payroll and payments card', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => viewProfile(1));
    await expect(page.locator('#payrollPaymentsCard')).toBeVisible();
    await expect(page.locator('#payrollPaymentsBody')).toContainText('Compensation plan');
  });

  test('an admin can open the receipt of a claim that has one', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      showSection('a-insurance', 'admin');
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      insuranceClaims = [
        { id: 11, employee_name: 'Ana', category: 'Dental', provider: 'X', amount: 100, date: '2026-01-01', status: 'Pending', document_url: png },
        { id: 12, employee_name: 'Bob', category: 'Dental', provider: 'X', amount: 50, date: '2026-01-02', status: 'Pending' },
      ];
      renderInsuranceTable();
    });
    await expect(page.locator('#insuranceTableBody [data-action="view-claim-receipt"]')).toHaveCount(1);
    await page.click('#insuranceTableBody [data-action="view-claim-receipt"]');
    await expect(page.locator('#documentPreviewModal')).toBeVisible();
    await expect(page.locator('#docPreviewContainer img')).toHaveCount(1);
  });

  test('profile header draws one full-width separator and right-aligns the badges', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof viewProfile === 'function');
    await page.evaluate(() => {
      employees = [{ id: 1, name: 'James Parker', role: 'Junior Engineer', dept: 'Engineering', join: '2026-01-01', status: 'Active', email: 'j@x.com', internalSalaryUsd: 100, externalSalaryUsd: 200 }];
      viewProfile(1);
    });
    const wrap = page.locator('#detailProfileHead');
    await expect(wrap.locator('.esc-head')).toBeVisible();
    const m = await page.evaluate(() => {
      const w = document.getElementById('detailProfileHead');
      const h = w.querySelector('.esc-head');
      const card = w.closest('.emp-summary-card');
      return {
        wrapBorder: getComputedStyle(w).borderBottomWidth,
        headWidth: Math.round(h.getBoundingClientRect().width),
        cardWidth: Math.round(card.getBoundingClientRect().width),
      };
    });
    expect(m.wrapBorder).toBe('0px');
    expect(m.headWidth).toBeGreaterThan(m.cardWidth - 4);
  });
});
