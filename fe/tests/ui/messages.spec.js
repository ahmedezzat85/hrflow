import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

// R1 Messages: no session-expired toast, a quiet login notice, "Not set up" vs "Could not load",
// and error toasts that do not follow the user to another page.

const ADMIN_SESSION = {
  portal: 'admin',
  roles: ['Super-Admin'],
  employee_id: 1,
  name: 'Test Admin',
  permissions: ['hr.employee.read'],
};

// Stubs the backend. `state.expired` flips every non-auth request to 401.
async function stubBackend(page, { signedIn }) {
  const state = { expired: false };
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/api/auth/me')) {
      return signedIn && !state.expired ? json(200, ADMIN_SESSION) : json(401, { detail: 'Not authenticated' });
    }
    if (url.includes('/api/auth/logout')) return json(200, { ok: true });
    if (state.expired) return json(401, { detail: 'Not authenticated' });
    return json(200, []);
  });
  return state;
}

test.describe('R1 Messages', () => {
  test('1. a first visit with no session shows no toast and no notice', async ({ page }) => {
    await stubBackend(page, { signedIn: false });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500); // let any early authenticated request (finance badges) settle
    await expect(page.locator('#toastWrap .toast')).toHaveCount(0);
    await expect(page.locator('#loginNotice')).toBeHidden();
  });

  test('2. signing out shows the login screen with no notice', async ({ page }) => {
    await stubBackend(page, { signedIn: true });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => logout());
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#loginNotice')).toBeHidden();
    await expect(page.locator('#toastWrap .toast')).toHaveCount(0);
  });

  test('3. a 401 while signed in returns to login with the quiet notice and no toast', async ({ page }) => {
    const state = await stubBackend(page, { signedIn: true });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // The generic stub answers every list with [], which can raise unrelated toasts during bootstrap.
    await page.evaluate(() => document.querySelectorAll('#toastWrap .toast').forEach((t) => t.remove()));
    state.expired = true;
    await page.evaluate(() => Api.getEmployees().catch(() => {}));
    await expect(page.locator('#login-screen')).toBeVisible();
    const notice = page.locator('#loginNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('You were signed out after a period of inactivity. Sign in to continue.');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(page.locator('#toastWrap .toast')).toHaveCount(0);
  });

  test.describe('employee profile status cards', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
      await openAdminPage(page, 'a-employees');
      await page.locator('#employeesTableBody tr').first().locator('.icon-action[title="View Profile"]').click();
      await expect(page.locator('#a-employee-detail')).toBeVisible();
    });

    test('4. no record reads "Not set up"; a failed request reads "Could not load" with "Try again"', async ({ page }) => {
      const pill = page.locator('#socialInsurancePill');
      const action = page.locator('#socialInsuranceStatusActionBtn');

      await page.evaluate(() => {
        Api.getSocialInsurance = () => Promise.resolve(null);
        return loadSocialInsuranceStatus(currentDetailEmployeeId);
      });
      await expect(pill).toContainText('Not set up');
      await expect(action).toHaveText('Set up');

      await page.evaluate(() => {
        Api.getSocialInsurance = () => Promise.reject(new Error('Request failed (500)'));
        return loadSocialInsuranceStatus(currentDetailEmployeeId);
      });
      await expect(pill).toContainText('Could not load');
      await expect(action).toHaveText('Try again');

      // "Try again" repeats the request and clears the failure once it succeeds.
      await page.evaluate(() => { Api.getSocialInsurance = () => Promise.resolve(null); });
      await action.click();
      await expect(pill).toContainText('Not set up');
    });
  });

  test('6. an error toast is removed when the user navigates to another page', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    await openAdminPage(page, 'a-employees');
    await page.evaluate(() => toast('Something failed', 'fa-solid fa-triangle-exclamation'));
    await expect(page.locator('#toastWrap .toast-error')).toHaveCount(1);
    await openAdminPage(page, 'a-vacations');
    await expect(page.locator('#toastWrap .toast-error')).toHaveCount(0);
  });

  test('5. describeLoadFailure names what failed and drops bare status text', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    const out = await page.evaluate(() => [
      describeLoadFailure('bank statements', new Error('Not Found')),
      describeLoadFailure('bank statements', new Error('Account 7 is closed')),
    ]);
    expect(out[0]).toBe('Bank statements could not be loaded.');
    expect(out[1]).toBe('Bank statements could not be loaded: Account 7 is closed');
  });
});
