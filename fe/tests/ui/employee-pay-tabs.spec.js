import { test, expect } from '@playwright/test';

async function openEmployee(page, mock) {
  await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof viewProfile === 'function');
  await page.evaluate(() => { viewProfile(1); });
  await expect(page.locator('#a-employee-detail')).toBeVisible();
}

test.describe('Employee detail tabs', () => {
  for (const [mock, visible] of [['admin', true], ['hr', true], ['finance', true], ['payroll', false]]) {
    test(`tab strip ${visible ? 'shows' : 'is absent'} for ${mock}`, async ({ page }) => {
      await openEmployee(page, mock);
      if (visible) {
        await expect(page.locator('#employeeDetailTabs')).toBeVisible();
        await expect(page.locator('#employeeOverviewTab')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#employeeOverviewPanel')).toBeVisible();
        await expect(page.locator('#employeePayPanel')).toHaveAttribute('hidden', '');
      } else {
        await expect(page.locator('#employeeDetailTabs')).toBeHidden();
        await expect(page.locator('#employeeOverviewPanel')).toBeVisible();
      }
    });
  }

  test('keyboard arrows switch tabs and Overview keeps its content', async ({ page }) => {
    await openEmployee(page, 'admin');
    await page.locator('#employeeOverviewTab').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#employeePayTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#employeePayTab')).toBeFocused();
    await expect(page.locator('#employeePayPanel')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#employeeOverviewPanel')).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#employeeOverviewTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#employeeCompensationCard')).toBeAttached();
    await expect(page.locator('#payrollPaymentsCard')).toBeVisible();
  });

  test('switching employee resets to Overview', async ({ page }) => {
    await openEmployee(page, 'admin');
    await page.click('#employeePayTab');
    await page.evaluate(() => { viewProfile(2); });
    await expect(page.locator('#employeeOverviewTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#employeePayPanel')).toHaveAttribute('hidden', '');
  });
});
