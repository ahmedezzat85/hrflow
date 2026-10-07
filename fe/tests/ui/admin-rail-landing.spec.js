import { test, expect } from '@playwright/test';

// Rail clicks land on a page: remembered page for the module, else its default (D-015).
const activePage = (page) => page.locator('#adminSidebar .nav-panel .nav-item.active').first().getAttribute('data-page');
const rail = (page, mod) => page.locator(`#adminSidebar .rail-btn[data-module="${mod}"]`);

test.describe('Admin rail landing pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('first click on each module opens its default page', async ({ page }) => {
    await rail(page, 'finance').click();
    await expect(page.locator('#a-finance-dashboard')).toHaveClass(/active/);
    expect(await activePage(page)).toBe('a-finance-dashboard');
    await expect(page.locator('#adminNavPanelTitle')).toHaveText('Finance');

    await rail(page, 'payroll').click();
    await expect(page.locator('#adminNavPanelTitle')).toHaveText('Payroll');
    expect(await activePage(page)).toBe('a-finance-payroll-runs');
    await expect(page.locator('#a-dashboard')).not.toHaveClass(/active/);

    await rail(page, 'hr').click();
    await expect(page.locator('#a-dashboard')).toHaveClass(/active/);
    expect(await activePage(page)).toBe('a-dashboard');
  });

  test('returns to the last page visited in a module', async ({ page }) => {
    await page.locator('#adminSidebar a[data-page="a-employees"]').click();
    await expect(page.locator('#a-employees')).toHaveClass(/active/);
    await rail(page, 'finance').click();
    await page.locator('#adminSidebar a[data-page="a-finance-spend"]').click();
    await expect(page.locator('#a-finance-spend, #a-finance-bills').first()).toBeVisible();

    await rail(page, 'hr').click();
    await expect(page.locator('#a-employees')).toHaveClass(/active/);
    expect(await activePage(page)).toBe('a-employees');

    await rail(page, 'finance').click();
    expect(await activePage(page)).toBe('a-finance-spend');
  });

  test('a detail page is remembered as its list page', async ({ page }) => {
    await page.evaluate(() => window.showSection('a-employee-detail', 'admin'));
    await rail(page, 'finance').click();
    await rail(page, 'hr').click();
    await expect(page.locator('#a-employees')).toHaveClass(/active/);
  });

  test('clicking the current module leaves the current page alone', async ({ page }) => {
    await page.locator('#adminSidebar a[data-page="a-salary"]').click();
    await expect(page.locator('#a-salary')).toHaveClass(/active/);
    await rail(page, 'hr').click();
    await expect(page.locator('#a-salary')).toHaveClass(/active/);
    expect(await activePage(page)).toBe('a-salary');
  });

  test('memory is cleared on sign-out and by resetMemory', async ({ page }) => {
    await page.locator('#adminSidebar a[data-page="a-employees"]').click();
    await rail(page, 'finance').click();
    await page.evaluate(() => window.AdminNav.resetMemory());
    await rail(page, 'hr').click();
    await expect(page.locator('#a-dashboard')).toHaveClass(/active/);

    await page.evaluate(() => {
      window.__resets = 0;
      const orig = window.AdminNav.resetMemory;
      window.AdminNav.resetMemory = () => { window.__resets++; return orig(); };
    });
    await page.locator('#adminAccountBtn').click();
    await page.locator('#adminSignOutBtn').click();
    await expect(page.locator('#login-screen')).toBeVisible();
    expect(await page.evaluate(() => window.__resets)).toBe(1);
  });

  test('phone: with the drawer open the rail only swaps the panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('#adminPageTitle')).toBeVisible({ timeout: 15000 });
    await page.locator('#admin-app .hamburger').click();
    await expect(page.locator('#adminSidebar')).toHaveClass(/open/);
    await rail(page, 'finance').click();
    await expect(page.locator('#adminNavPanelTitle')).toHaveText('Finance');
    await expect(page.locator('#adminSidebar')).toHaveClass(/open/);
    await expect(page.locator('#a-dashboard')).toHaveClass(/active/);
    await page.locator('#adminSidebar a[data-page="a-finance-spend"]').click();
    await expect(page.locator('#adminSidebar')).not.toHaveClass(/open/);
  });
});
