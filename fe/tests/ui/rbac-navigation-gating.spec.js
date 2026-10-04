import { test, expect } from '@playwright/test';

test.describe('RBAC Slice 7a: Frontend Session, Navigation & Control Gating', () => {

  test('Super-Admin mock (?mock=admin) sees all 4 modules and admin controls', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Rail buttons
    await expect(page.locator('#hrRailBtn')).toBeVisible();
    await expect(page.locator('#financeRailBtn')).toBeVisible();
    await expect(page.locator('#payrollRailBtn')).toBeVisible();
    await expect(page.locator('#systemRailBtn')).toBeVisible();

    // Verify SessionInfo has all permissions and strict check works
    const isStrict = await page.evaluate(() => {
      return (
        SessionInfo.hasPermission('hr.employee.read') === true &&
        SessionInfo.hasPermission('system.roles.manage') === true &&
        SessionInfo.hasPermission('nonexistent.bogus.permission') === false &&
        SessionInfo.getPortal() === 'admin'
      );
    });
    expect(isStrict).toBe(true);

    // Verify Add Employee button is visible
    await page.click('a[data-page="a-employees"]');
    await expect(page.locator('#btnAddEmployee')).toBeVisible();
  });

  test('HR-Admin mock (?mock=hr_admin) sees HR module only, finance/payroll/system hidden', async ({ page }) => {
    await page.goto('/?mock=hr_admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#hrRailBtn')).toBeVisible();
    await expect(page.locator('#financeRailBtn')).toBeHidden();
    await expect(page.locator('#payrollRailBtn')).toBeHidden();
    await expect(page.locator('#systemRailBtn')).toBeHidden();

    // Has HR write permissions
    await page.click('a[data-page="a-employees"]');
    await expect(page.locator('#btnAddEmployee')).toBeVisible();

    // Verify permission evaluation
    const permsCheck = await page.evaluate(() => {
      return {
        hrRead: SessionInfo.hasPermission('hr.employee.read'),
        financeRead: SessionInfo.hasPermission('finance.invoice.read'),
        systemManage: SessionInfo.hasPermission('system.roles.manage'),
        roles: SessionInfo.getRoles(),
      };
    });
    expect(permsCheck.hrRead).toBe(true);
    expect(permsCheck.financeRead).toBe(false);
    expect(permsCheck.systemManage).toBe(false);
    expect(permsCheck.roles).toEqual(['HR-Admin']);
  });

  test('Financial-Admin mock (?mock=financial_admin) sees Finance and Payroll modules, HR and System hidden', async ({ page }) => {
    await page.goto('/?mock=financial_admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#hrRailBtn')).toBeHidden();
    await expect(page.locator('#financeRailBtn')).toBeVisible();
    await expect(page.locator('#payrollRailBtn')).toBeVisible();
    await expect(page.locator('#systemRailBtn')).toBeHidden();

    // Lands on Finance module
    const activeMod = await page.evaluate(() => AdminNav.getActiveModule());
    expect(activeMod).toBe('finance');
  });

  test('Payroll-Maker mock (?mock=payroll_maker) lands on Payroll module and lacks approve/pay', async ({ page }) => {
    await page.goto('/?mock=payroll_maker', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#hrRailBtn')).toBeHidden();
    await expect(page.locator('#financeRailBtn')).toBeHidden();
    await expect(page.locator('#payrollRailBtn')).toBeVisible();
    await expect(page.locator('#systemRailBtn')).toBeHidden();

    // Automatically switched active module to payroll
    const activeMod = await page.evaluate(() => AdminNav.getActiveModule());
    expect(activeMod).toBe('payroll');

    // Verify permissions
    const perms = await page.evaluate(() => {
      return {
        payrollRead: SessionInfo.hasPermission('finance.payroll.read'),
        payrollPrepare: SessionInfo.hasPermission('finance.payroll.prepare'),
        payrollApprove: SessionInfo.hasPermission('finance.payroll.approve'),
        payrollPay: SessionInfo.hasPermission('finance.payroll.pay'),
      };
    });
    expect(perms.payrollRead).toBe(true);
    expect(perms.payrollPrepare).toBe(true);
    expect(perms.payrollApprove).toBe(false);
    expect(perms.payrollPay).toBe(false);
  });

  test('Employee mock (?mock=employee) opens employee portal with self-service permissions', async ({ page }) => {
    await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#employee-app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#admin-app')).not.toHaveClass(/active/);

    const empSession = await page.evaluate(() => {
      return {
        portal: SessionInfo.getPortal(),
        selfProfile: SessionInfo.hasPermission('self.profile.read'),
        hrWrite: SessionInfo.hasPermission('hr.employee.write'),
      };
    });
    expect(empSession.portal).toBe('employee');
    expect(empSession.selfProfile).toBe(true);
    expect(empSession.hrWrite).toBe(false);
  });

});
