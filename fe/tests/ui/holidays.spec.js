import { test, expect } from '@playwright/test';

// Official holidays: HR manages them, everyone sees them, and the leave preview skips them.
async function openAdmin(page) {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof showSection === 'function' && typeof renderHolidays === 'function');
}

test.describe('Official holidays', () => {
  test('admin adds, edits and deletes a holiday for the chosen year', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-holidays', 'admin'));
    const body = page.locator('#adminHolidaysBody');
    await page.selectOption('#adminHolidayYear', '2026');
    await expect(body.locator('tr:has-text("Labour Day")')).toBeVisible();
    await expect(body.locator('tr:has-text("Eid al-Adha")')).toContainText('4 days');

    await page.locator('#btnAddHoliday').click();
    await page.fill('#holName', 'Revolution Day');
    await page.fill('#holStart', '2026-07-23');
    await page.locator('#holidaySaveBtn').click();
    const added = body.locator('tr:has-text("Revolution Day")');
    await expect(added).toContainText('1 day');

    await added.locator('.btn-edit-holiday').click();
    await page.fill('#holEnd', '2026-07-24');
    await page.locator('#holidaySaveBtn').click();
    await expect(added).toContainText('2 days');

    await added.locator('.btn-delete-holiday').click();
    await page.locator('#financeConfirmSubmitBtn').click();
    await expect(body.locator('tr:has-text("Revolution Day")')).toHaveCount(0);
  });

  test('a year with no holidays shows an empty state, and the name is required', async ({ page }) => {
    await openAdmin(page);
    await page.evaluate(() => showSection('a-holidays', 'admin'));
    await page.selectOption('#adminHolidayYear', '2027');
    await expect(page.locator('#adminHolidaysBody')).toContainText('No official holidays added for 2027');
    await page.locator('#btnAddHoliday').click();
    await page.locator('#holidaySaveBtn').click();
    await expect(page.locator('#holidayModal')).toBeVisible();
    await page.locator('#holidayCancelBtn').click();
  });

  test('employee sees a read-only list', async ({ page }) => {
    await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof showSection === 'function' && typeof renderHolidays === 'function');
    await page.evaluate(() => showSection('e-holidays', 'employee'));
    await page.selectOption('#empHolidayYear', '2026');
    await expect(page.locator('#empHolidaysBody tr:has-text("Labour Day")')).toBeVisible();
    await expect(page.locator('#e-holidays button')).toHaveCount(0);
  });

  test('the leave preview skips weekends and official holidays', async ({ page }) => {
    await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof showSection === 'function' && typeof ensureHolidayDates === 'function');
    await page.evaluate(() => showSection('e-vacations', 'employee'));
    await page.waitForFunction(() => window.holidayDateSet && window.holidayDateSet.size > 0);
    // Mon 2026-05-25 .. Sun 05-31: Eid 26-29 May off, Fri/Sat off, so only Mon 25 and Sun 31 count
    await page.fill('#vacStart', '2026-05-25');
    await page.fill('#vacEnd', '2026-05-31');
    await expect(page.locator('#vacComputedDays')).toHaveText('2 days');
  });
});
