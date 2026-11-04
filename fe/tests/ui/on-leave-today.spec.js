import { test, expect } from '@playwright/test';

test.describe('On leave today derives from approved vacation dates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('approved vacation covering today counts; pending, past and future do not', async ({ page }) => {
    const res = await page.evaluate(() => {
      const iso = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const emp = { id: 9001, status: 'Active' };
      const check = (v) => { allVacationHistory = [{ employee_id: 9001, ...v }]; return isOnLeaveToday(emp); };
      const out = {
        covering: check({ status: 'Approved', start_date: iso(-2), end_date: iso(2) }),
        singleDay: check({ status: 'Approved', start_date: iso(0), end_date: iso(0) }),
        pending: check({ status: 'Pending', start_date: iso(-2), end_date: iso(2) }),
        past: check({ status: 'Approved', start_date: iso(-9), end_date: iso(-3) }),
        future: check({ status: 'Approved', start_date: iso(3), end_date: iso(9) }),
        manualStatus: (allVacationHistory = [], isOnLeaveToday({ id: 9001, status: 'On Leave' })),
      };
      allVacationHistory = [];
      return out;
    });
    expect(res).toEqual({ covering: true, singleDay: true, pending: false, past: false, future: false, manualStatus: true });
  });
});
