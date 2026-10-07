import { test, expect } from '@playwright/test';
import { openAdminPage, openAdminModule } from './helpers/admin-nav.js';

test.describe('Admin Dual-Rail Navigation Shell (Slice 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('AC 1: At load, rail shows HR and Finance; HR active; panel lists 8 HR pages; no vertical scroll at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const rail = page.locator('#adminSidebar .rail');
    await expect(rail).toBeVisible();

    const hrBtn = page.locator('#adminSidebar .rail-btn[data-module="hr"]');
    const finBtn = page.locator('#adminSidebar .rail-btn[data-module="finance"]');
    await expect(hrBtn).toBeVisible();
    await expect(finBtn).toBeVisible();
    await expect(hrBtn).toHaveClass(/active|on/);
    await expect(hrBtn).toHaveAttribute('aria-current', 'true');

    // Panel lists exactly the 8 HR pages
    const hrGroup = page.locator('#adminHrNavGroup');
    await expect(hrGroup).toBeVisible();
    const hrItems = hrGroup.locator('.nav-item');
    await expect(hrItems).toHaveCount(8);

    const expectedPages = [
      'a-dashboard',
      'a-employees',
      'a-requests',
      'a-salary',
      'a-invoices',
      'a-vacations',
      'a-insurance',
      'a-dochub',
    ];

    for (let i = 0; i < expectedPages.length; i++) {
      await expect(hrItems.nth(i)).toHaveAttribute('data-page', expectedPages[i]);
    }

    // Salary Payment Docs rename verification
    const salaryDocsItem = hrGroup.locator('.nav-item[data-page="a-invoices"]');
    await expect(salaryDocsItem).toContainText('Salary Payment Docs');
    await expect(salaryDocsItem).toHaveAttribute('title', 'Salary Payment Docs');

    // Verify panel inner needs no vertical scroll at 1440x900
    const isScrollable = await page.evaluate(() => {
      const nav = document.querySelector('#adminSidebar .sidebar-nav');
      return nav ? nav.scrollHeight > nav.clientHeight : false;
    });
    expect(isScrollable).toBe(false);
  });

  test('AC 2: Clicking Finance rail button shows Finance group and hides HR; clicking Finance item loads page and data', async ({ page }) => {
    const hrGroup = page.locator('#adminHrNavGroup');
    const finGroup = page.locator('#adminFinanceNavGroup');

    // Click Finance rail button
    await openAdminModule(page, 'finance');

    await expect(finGroup).toBeVisible();
    await expect(hrGroup).not.toBeVisible();

    const finBtn = page.locator('#adminSidebar .rail-btn[data-module="finance"]');
    await expect(finBtn).toHaveClass(/active|on/);
    await expect(page.locator('#adminNavPanelTitle')).toHaveText('Finance');

    // Click Vendor Bills in Finance
    await openAdminPage(page, 'a-finance-bills');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('AC 3: Calling showSection switches rail to Finance and highlights correct item', async ({ page }) => {
    // Start on HR
    await openAdminModule(page, 'hr');
    await expect(page.locator('#adminHrNavGroup')).toBeVisible();

    // Call showSection programmatically
    await page.evaluate(() => {
      window.showSection('a-finance-bills', 'admin');
    });

    // Rail should have switched to Finance
    const finBtn = page.locator('#adminSidebar .rail-btn[data-module="finance"]');
    await expect(finBtn).toHaveClass(/active|on/);
    await expect(page.locator('#adminFinanceNavGroup')).toBeVisible();
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#adminSidebar a[data-page="a-finance-spend"]')).toHaveClass(/active/);
  });

  test('AC 4: Collapsing hides panel only; rail stays; reload restores state; Employee collapse unchanged', async ({ page }) => {
    const adminSidebar = page.locator('#adminSidebar');
    const collapseBtn = page.locator('#adminSidebarCollapseBtn');
    const rail = page.locator('#adminSidebar .rail');
    const panel = page.locator('#adminNavPanel');

    // Collapse admin panel
    await collapseBtn.click();
    await expect(adminSidebar).toHaveClass(/panel-collapsed/);
    await expect(rail).toBeVisible();
    await expect(panel).toHaveCSS('width', '0px');

    // Reload page to verify persistence
    await page.reload();
    await expect(page.locator('#adminSidebar')).toHaveClass(/panel-collapsed/);
    await expect(page.locator('#adminSidebar .rail')).toBeVisible();

    // Uncollapse
    await page.locator('#adminSidebarCollapseBtn').click();
    await expect(page.locator('#adminSidebar')).not.toHaveClass(/panel-collapsed/);

    // Verify Employee portal collapse is independent
    await page.goto('/?mock=employee');
    const empSidebar = page.locator('#empSidebar');
    await expect(empSidebar).toBeVisible();
    await expect(empSidebar).not.toHaveClass(/collapsed/);
  });

  test('AC 5: Programmatic navigation to sub-pages with no nav items keeps the current module', async ({ page }) => {
    await openAdminPage(page, 'a-employees');
    await expect(page.locator('#adminSidebar .rail-btn[data-module="hr"]')).toHaveClass(/active|on/);

    // Navigate to a-employee-detail
    await page.evaluate(() => {
      window.showSection('a-employee-detail', 'admin');
    });
    // HR remains active
    await expect(page.locator('#adminSidebar .rail-btn[data-module="hr"]')).toHaveClass(/active|on/);

    // Navigate to finance-transfers
    await page.evaluate(() => {
      window.showSection('a-finance-transfers', 'admin');
    });
    // Finance becomes active
    await expect(page.locator('#adminSidebar .rail-btn[data-module="finance"]')).toHaveClass(/active|on/);
  });

  test('AC 6: Exactly one nav item is active at a time within visible HR panel', async ({ page }) => {
    await openAdminModule(page, 'hr');

    // Click Employees
    await openAdminPage(page, 'a-employees');
    const activeItemsEmp = page.locator('#adminHrNavGroup .nav-item.active');
    await expect(activeItemsEmp).toHaveCount(1);
    await expect(activeItemsEmp).toHaveAttribute('data-page', 'a-employees');

    // Click Salary & Raises
    await openAdminPage(page, 'a-salary');
    const activeItemsSal = page.locator('#adminHrNavGroup .nav-item.active');
    await expect(activeItemsSal).toHaveCount(1);
    await expect(activeItemsSal).toHaveAttribute('data-page', 'a-salary');
  });

  test('AC 7: HR rail dot matches #reqBadge and is hidden when count is 0', async ({ page }) => {
    const hrDot = page.locator('#hrRailDot');

    // Set badge to 5
    await page.evaluate(() => {
      const badge = document.getElementById('reqBadge');
      if (badge) badge.textContent = '5';
    });
    await expect(hrDot).toBeVisible();

    // Set badge to 0
    await page.evaluate(() => {
      const badge = document.getElementById('reqBadge');
      if (badge) badge.textContent = '0';
    });
    await expect(hrDot).not.toBeVisible();
  });

  test('AC 8: Keyboard navigation: Tab, Enter, and Escape mobile drawer close', async ({ page }) => {
    // Focus HR rail button and press Tab to reach Finance button
    const hrBtn = page.locator('#adminSidebar .rail-btn[data-module="hr"]');
    await hrBtn.focus();
    await page.keyboard.press('Tab');

    const finBtn = page.locator('#adminSidebar .rail-btn[data-module="finance"]');
    await expect(finBtn).toBeFocused();

    // Enter activates Finance module
    await page.keyboard.press('Enter');
    await expect(finBtn).toHaveClass(/active|on/);
    await expect(page.locator('#adminFinanceNavGroup')).toBeVisible();

    // Test mobile drawer Escape key:
    await page.setViewportSize({ width: 390, height: 844 });
    const hamb = page.locator('#admin-app .hamburger');
    await hamb.click();
    const adminSidebar = page.locator('#adminSidebar');
    await expect(adminSidebar).toHaveClass(/open/);

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(adminSidebar).not.toHaveClass(/open/);
    await expect(hamb).toBeFocused();
  });

  test('AC 9: Light and dark themes render with tokens only', async ({ page }) => {
    const adminSidebar = page.locator('#adminSidebar');

    // Check light theme
    const lightBg = await adminSidebar.locator('.rail').evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(lightBg).not.toBe('');

    // Toggle dark theme
    await page.locator('#adminAccountBtn').click();
    await page.locator('#adminAccountPanel [data-theme-choice="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBg = await adminSidebar.locator('.rail').evaluate(el => window.getComputedStyle(el).backgroundColor);
    expect(darkBg).not.toBe(lightBg);

    // Switch back to light
    await page.locator('#adminAccountPanel [data-theme-choice="light"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('AC 10: ?mock=employee shows unchanged Employee sidebar', async ({ page }) => {
    await page.goto('/?mock=employee');
    await expect(page.locator('#empSidebar')).toBeVisible();
    await expect(page.locator('#empSidebar')).not.toHaveClass(/dual-rail/);
    await expect(page.locator('#empSidebar .sidebar-top-row .brand')).toBeVisible();
  });
});

test.describe('Slice 2 — Finance Simplification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('AC 1: Finance panel shows exactly the 6 primary domain entries and Finance Settings label (Payroll moved to dedicated module)', async ({ page }) => {
    await openAdminModule(page, 'finance');
    const group = page.locator('#adminFinanceNavGroup');
    await expect(group).toBeVisible();

    // Verify parent rows exist
    await expect(group.locator('a[data-page="a-finance-dashboard"]')).toBeVisible();
    await expect(group.locator('a[data-page="a-finance-sales"]')).toBeVisible();
    await expect(group.locator('a[data-page="a-finance-spend"]')).toBeVisible();
    await expect(group.locator('a[data-page="a-finance-banking"]')).toBeVisible();
    await expect(group.locator('a[data-page="a-finance-reports"]')).toBeVisible();
    await expect(group.locator('a[data-page="a-finance-settings"]')).toBeVisible();

    // Verify removed child rows and moved payroll rows do NOT exist in the finance group
    await expect(group.locator('a[data-page="a-finance-invoices"]')).toHaveCount(0);
    await expect(group.locator('a[data-page="a-finance-bills"]')).toHaveCount(0);
    await expect(group.locator('a[data-page="a-finance-subscriptions"]')).toHaveCount(0);
    await expect(group.locator('a[data-page="a-finance-statutory"]')).toHaveCount(0);
    await expect(group.locator('a[data-page="a-finance-accounts"]')).toHaveCount(0);
    await expect(group.locator('a[data-page="a-finance-payroll"]')).toHaveCount(0);

    // Verify Finance Settings label
    await expect(group.locator('a[data-page="a-finance-settings"] .nav-label')).toHaveText('Finance Settings');
  });

  test('AC 6: Spend tab bar is identical in labels and order across Vendor Bills, Subscriptions, and Statutory', async ({ page }) => {
    const expectedLabels = ['Vendor Bills', 'Vendors', 'Subscriptions', 'Statutory'];

    // 1. Check Spend (Bills page)
    await openAdminPage(page, 'a-finance-spend');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    const billsTabs = page.locator('#financeBillSubNav .filter-tab');
    await expect(billsTabs).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      expect((await billsTabs.nth(i).innerText()).trim()).toContain(expectedLabels[i]);
    }
    await expect(page.locator('#tabFinanceBills')).toHaveClass(/active/);

    // 2. Click Subscriptions tab from bills
    await page.locator('#tabFinanceSubscriptions').click();
    await expect(page.locator('#a-finance-subscriptions')).toBeVisible();
    const subTabs = page.locator('#financeSpendSubNavSubscriptions .filter-tab');
    await expect(subTabs).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      expect((await subTabs.nth(i).innerText()).trim()).toContain(expectedLabels[i]);
    }
    await expect(page.locator('#subtabSpendSubSubscriptions')).toHaveClass(/active/);

    // 3. Click Statutory tab from subscriptions
    await page.locator('#subtabSpendSubStatutory').click();
    await expect(page.locator('#a-finance-statutory')).toBeVisible();
    const statTabs = page.locator('#financeSpendSubNavStatutory .filter-tab');
    await expect(statTabs).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      expect((await statTabs.nth(i).innerText()).trim()).toContain(expectedLabels[i]);
    }
    await expect(page.locator('#subtabSpendStatStatutory')).toHaveClass(/active/);

    // 4. Click Vendor Bills tab from statutory to return
    await page.locator('#subtabSpendStatBills').click();
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#tabFinanceBills')).toHaveClass(/active/);
  });
});

test.describe('Slice 3 — Payroll Module', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('AC 1 & AC 2: Payroll is reachable from rail button; Runs and Settings work; single active item', async ({ page }) => {
    // 1. Click Payroll rail button
    await openAdminModule(page, 'payroll');
    const payrollBtn = page.locator('#payrollRailBtn');
    await expect(payrollBtn).toHaveClass(/active|on/);
    await expect(payrollBtn).toHaveAttribute('aria-current', 'true');

    // Panel title and subtitle
    await expect(page.locator('#adminNavPanelTitle')).toHaveText('Payroll');
    const payrollGroup = page.locator('#adminPayrollNavGroup');
    await expect(payrollGroup).toBeVisible();

    // Verify Runs and Settings entries
    const runsItem = page.locator('#payrollNavList');
    const settingsItem = page.locator('#payrollNavSettings');
    await expect(runsItem).toBeVisible();
    await expect(settingsItem).toBeVisible();
    await expect(runsItem.locator('.nav-label')).toHaveText('Payroll Runs');
    await expect(settingsItem.locator('.nav-label')).toHaveText('Payroll Settings');

    // Click Runs item
    await runsItem.click();
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
    await expect(page.locator('#payrollViewList')).toBeVisible();
    await expect(runsItem).toHaveClass(/active/);
    await expect(settingsItem).not.toHaveClass(/active/);

    // Click Settings item
    await settingsItem.click();
    await expect(page.locator('#payrollViewSettings')).toBeVisible();
    await expect(settingsItem).toHaveClass(/active/);
    await expect(runsItem).not.toHaveClass(/active/);

    // Call showPage('run') directly to verify it keeps Runs active with single highlight
    await page.evaluate(() => {
      if (typeof PayrollApp !== 'undefined' && PayrollApp.showPage) {
        PayrollApp.showPage('run');
      }
    });
    await expect(page.locator('#payrollViewRun')).toBeVisible();
    await expect(runsItem).toHaveClass(/active/);
    await expect(settingsItem).not.toHaveClass(/active/);
  });

  test('AC 3: Finance panel lists exactly six pages and does not include Payroll', async ({ page }) => {
    await openAdminModule(page, 'finance');
    const group = page.locator('#adminFinanceNavGroup');
    await expect(group).toBeVisible();

    // Verify exactly 6 pages
    const financeNavItems = group.locator('a.nav-item');
    await expect(financeNavItems).toHaveCount(6);

    const expectedPages = [
      'a-finance-dashboard',
      'a-finance-sales',
      'a-finance-spend',
      'a-finance-banking',
      'a-finance-reports',
      'a-finance-settings',
    ];
    for (let i = 0; i < expectedPages.length; i++) {
      await expect(financeNavItems.nth(i)).toHaveAttribute('data-page', expectedPages[i]);
    }
  });

  test('AC 5: Finance dashboard attention link targeting a-finance-payroll lands on Payroll Runs with Payroll module active', async ({ page }) => {
    await openAdminPage(page, 'a-finance-dashboard');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Trigger openAttentionItem targeting a-finance-payroll
    await page.evaluate(() => {
      window.openAttentionItem('a-finance-payroll');
    });

    // Verify Payroll module is active on rail and Runs view is shown
    await expect(page.locator('#payrollRailBtn')).toHaveClass(/active|on/);
    await expect(page.locator('#adminPayrollNavGroup')).toBeVisible();
    await expect(page.locator('#a-finance-payroll')).toBeVisible();
    await expect(page.locator('#payrollNavList')).toHaveClass(/active/);
  });
});


