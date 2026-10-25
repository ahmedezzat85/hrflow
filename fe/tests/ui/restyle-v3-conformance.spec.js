import { test, expect } from '@playwright/test';
import { submitAndApprove } from './helpers/payroll.js';

// Restyle v3 conformance test suite (S0.5 skeleton)
// Validates computed styles against the approved restyle-v3 mocks in both light and dark themes.

export async function expectStyle(locator, expectedStyles) {
  const actual = await locator.first().evaluate((el, keys) => {
    const cs = window.getComputedStyle(el);
    const res = {};
    for (const k of keys) {
      res[k] = cs[k] || cs.getPropertyValue(k);
    }
    return res;
  }, Object.keys(expectedStyles));

  for (const [key, val] of Object.entries(expectedStyles)) {
    if (val instanceof RegExp) {
      expect(actual[key]).toMatch(val);
    } else {
      expect(actual[key]).toBe(val);
    }
  }
}

async function openAdmin(page, theme = 'light') {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeAttached({ timeout: 15000 });
  await page.evaluate((th) => {
    if (typeof applyTheme === 'function') applyTheme(th);
    else document.documentElement.setAttribute('data-theme', th);
  }, theme);
}

async function openEmployee(page, theme = 'light') {
  await page.goto('/?mock=employee', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#empSidebar')).toBeAttached({ timeout: 15000 });
  await page.evaluate((th) => {
    if (typeof applyTheme === 'function') applyTheme(th);
    else document.documentElement.setAttribute('data-theme', th);
  }, theme);
}

for (const theme of ['light', 'dark']) {
  test.describe(`Restyle v3 conformance [${theme}]`, () => {
    test(`S0.5 helper verification and theme attribute in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(currentTheme).toBe(theme);

      await expectStyle(page.locator('#adminSidebar'), {
        display: 'flex',
      });
    });

    test(`S1.1 Dialog shell computed styles in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      // Raise modal
      await page.evaluate(() => openModal('raiseModal'));
      await expect(page.locator('#raiseModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#raiseModal .modal'), {
        borderRadius: '18px',
        width: '600px',
      });
      await expectStyle(page.locator('#raiseModal .modal-head'), {
        paddingTop: '16px',
        paddingBottom: '16px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await expectStyle(page.locator('#raiseModal .modal-head-icon'), {
        width: '36px',
        height: '36px',
        borderRadius: '11px',
      });
      await expectStyle(page.locator('#raiseModal .modal-foot'), {
        paddingTop: '12px',
        paddingBottom: '12px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await page.evaluate(() => closeModal('raiseModal'));

      // Confirm modal (440px variant)
      await page.evaluate(() => openModal('confirmModal'));
      await expect(page.locator('#confirmModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#confirmModal .modal'), {
        borderRadius: '18px',
        width: '440px',
      });
      await expectStyle(page.locator('#confirmModal .modal-head'), {
        paddingTop: '20px',
        paddingBottom: '6px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await expectStyle(page.locator('#confirmModal .modal-foot'), {
        paddingTop: '16px',
        paddingBottom: '16px',
        paddingLeft: '22px',
        paddingRight: '22px',
      });
      await page.evaluate(() => closeModal('confirmModal'));

      // Employee modal
      await page.evaluate(() => openModal('employeeModal'));
      await expect(page.locator('#employeeModal')).toHaveClass(/active/);
      await expectStyle(page.locator('#employeeModal .modal'), {
        borderRadius: '18px',
      });
      await expectStyle(page.locator('#employeeModal .modal-head'), {
        paddingTop: '16px',
        paddingBottom: '16px',
      });
      await expectStyle(page.locator('#employeeModal .modal-head-icon'), {
        width: '36px',
        height: '36px',
        borderRadius: '11px',
      });
      await page.evaluate(() => closeModal('employeeModal'));

      // Verify no form-section-label in inventory modals
      const strayLabels = await page.locator('.modal-overlay:not(#billModal):not(#invoiceModal) .form-section-label').count();
      expect(strayLabels).toBe(0);
    });

    test(`S1.2 Area colours and tokens computed styles in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      const checkTile = async (modalId, expectedLightBg, expectedLightColor) => {
        await page.evaluate((id) => openModal(id), modalId);
        const iconLocator = page.locator(`#${modalId} .modal-head-icon`);
        const styles = await iconLocator.first().evaluate((el) => {
          const cs = window.getComputedStyle(el);
          return { bg: cs.backgroundColor, color: cs.color };
        });
        if (theme === 'light') {
          expect(styles.bg).toBe(expectedLightBg);
          expect(styles.color).toBe(expectedLightColor);
        } else {
          expect(styles.bg).not.toBe(expectedLightBg);
        }
        await page.evaluate((id) => closeModal(id), modalId);
      };

      // Green: Raise
      await checkTile('raiseModal', 'rgb(227, 245, 236)', 'rgb(47, 122, 45)');
      // Blue: Employee
      await checkTile('employeeModal', 'rgb(232, 238, 255)', 'rgb(26, 70, 189)');
      // Teal: Vacation, Social insurance
      await checkTile('behalfVacationModal', 'rgb(224, 244, 241)', 'rgb(11, 122, 109)');
      await checkTile('socialInsuranceModal', 'rgb(224, 244, 241)', 'rgb(11, 122, 109)');
      // Ochre: Company doc
      await checkTile('companyDocumentModal', 'rgb(248, 238, 214)', 'rgb(138, 96, 0)');
      // Pink: Role
      await checkTile('roleModal', 'rgb(251, 231, 240)', 'rgb(173, 52, 105)');
      // Violet: Revert
      await checkTile('payrollRevertModal', 'rgb(241, 234, 254)', 'rgb(98, 54, 192)');
      // Danger: Confirm
      await checkTile('confirmModal', 'rgb(253, 232, 232)', 'rgb(185, 36, 36)');
    });

    test(`S1.3 Table and card primitives in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      // 1. Employees table
      await page.evaluate(() => {
        showSection('a-employees', 'admin');
        if (typeof renderEmployeesTable === 'function') renderEmployeesTable();
      });
      const empTh = page.locator('#a-employees table thead th').first();
      await expect(empTh).toBeVisible();
      await expectStyle(empTh, {
        fontSize: '12px',
        fontWeight: '600',
        paddingTop: '12px',
        paddingBottom: '12px',
      });
      const empTd = page.locator('#a-employees table tbody td').first();
      await expect(empTd).toBeVisible();
      await expectStyle(empTd, {
        paddingTop: '9px',
        paddingBottom: '9px',
      });
      const empFoot = page.locator('#a-employees .fv-tablefoot');
      await expect(empFoot).toBeVisible();
      await expect(empFoot).toContainText('Showing');
      await expect(empFoot).toContainText('Page 1 of 1');

      // 2. Requests table
      await page.evaluate(() => {
        showSection('a-requests', 'admin');
        if (typeof renderRequestsTable === 'function') renderRequestsTable();
      });
      const reqTh = page.locator('#a-requests table thead th').first();
      await expect(reqTh).toBeVisible();
      await expectStyle(reqTh, {
        fontSize: '12px',
        fontWeight: '600',
        paddingTop: '12px',
        paddingBottom: '12px',
      });
      const reqTd = page.locator('#a-requests table tbody td').first();
      await expect(reqTd).toBeVisible();
      await expectStyle(reqTd, {
        paddingTop: '9px',
        paddingBottom: '9px',
      });
      const reqFoot = page.locator('#a-requests .fv-tablefoot');
      await expect(reqFoot).toBeVisible();
      await expect(reqFoot).toContainText('Showing');

      // 3. Document hub table
      await page.evaluate(() => {
        showSection('a-dochub', 'admin');
        if (typeof renderCompanyDocumentsAdmin === 'function') renderCompanyDocumentsAdmin();
      });
      const docTh = page.locator('#a-dochub table thead th').first();
      await expect(docTh).toBeVisible();
      await expectStyle(docTh, {
        fontSize: '12px',
        fontWeight: '600',
        paddingTop: '12px',
        paddingBottom: '12px',
      });
      const docTd = page.locator('#a-dochub table tbody td').first();
      await expect(docTd).toBeVisible();
      await expectStyle(docTd, {
        paddingTop: '9px',
        paddingBottom: '9px',
      });
      const docFoot = page.locator('#a-dochub .fv-tablefoot');
      await expect(docFoot).toBeVisible();
      await expect(docFoot).toContainText('Showing');
    });

    test(`S1.4 Shared pills, tiles, and footers in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      // 1. Salary tiles
      await page.evaluate(() => showSection('a-salary', 'admin'));
      const salaryTile = page.locator('#a-salary .hv-stat-tile').first();
      await expect(salaryTile).toBeVisible();
      await expectStyle(salaryTile, {
        paddingTop: '14px',
        paddingBottom: '14px',
        borderRadius: '14px',
      });
      await expectStyle(salaryTile.locator('.hv-stat-label'), {
        fontSize: '12.5px',
        fontWeight: '600',
      });
      await expectStyle(salaryTile.locator('.hv-stat-value'), {
        fontSize: '24px',
        fontWeight: '700',
      });
      await expectStyle(salaryTile.locator('.hv-stat-sub'), {
        fontSize: '12.5px',
      });

      // 2. Vacations tiles (must pass the same assertion per S1.4)
      await page.evaluate(() => showSection('a-vacations', 'admin'));
      const vacTile = page.locator('#a-vacations .hv-stat-tile').first();
      await expect(vacTile).toBeVisible();
      await expectStyle(vacTile, {
        paddingTop: '14px',
        paddingBottom: '14px',
        borderRadius: '14px',
      });
      await expectStyle(vacTile.locator('.hv-stat-label'), {
        fontSize: '12.5px',
        fontWeight: '600',
      });
      await expectStyle(vacTile.locator('.hv-stat-value'), {
        fontSize: '24px',
        fontWeight: '700',
      });
      await expectStyle(vacTile.locator('.hv-stat-sub'), {
        fontSize: '12.5px',
      });

      // 3. Amber strip primitives
      const amberStrip = await page.evaluate(() => {
        const el = document.createElement('div');
        el.className = 'fv-amber-strip';
        document.querySelector('#a-salary').appendChild(el);
        const cs = window.getComputedStyle(el);
        return {
          borderRadius: cs.borderRadius,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          fontSize: cs.fontSize,
        };
      });
      expect(amberStrip.borderRadius).toBe('12px');
      expect(amberStrip.paddingTop).toBe('10px');
      expect(amberStrip.paddingBottom).toBe('10px');
      expect(amberStrip.fontSize).toBe('13px');
    });

    test(`S2.1 Rail badge in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const reqBadge = page.locator('#reqBadge');
      const hrDot = page.locator('#hrRailDot');

      const badgeText = (await reqBadge.textContent() || '').trim();
      const count = parseInt(badgeText, 10);
      if (!isNaN(count) && count > 0) {
        await expect(hrDot).toBeVisible();
        await expect(hrDot).toHaveText(String(count));
      }

      // Dynamic update test
      await page.evaluate(() => {
        const b = document.getElementById('reqBadge');
        if (b) b.textContent = '7';
      });
      await expect(hrDot).toBeVisible();
      await expect(hrDot).toHaveText('7');

      await page.evaluate(() => {
        const b = document.getElementById('reqBadge');
        if (b) b.textContent = '0';
      });
      await expect(hrDot).not.toBeVisible();
    });

    test(`S2.2 Collapse control in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const collapseBtn = page.locator('#adminSidebarCollapseBtn');
      await expect(collapseBtn).toBeVisible();
      await expect(collapseBtn).toContainText('Collapse');

      // Verify no overlap with top bar (collapse button is in bottom area, below top bar)
      const topBarBox = await page.locator('.topbar, header').first().boundingBox();
      const collapseBox = await collapseBtn.boundingBox();
      expect(collapseBox.y).toBeGreaterThan(topBarBox.y + topBarBox.height);

      // Toggle collapse
      await collapseBtn.click();
      await expect(page.locator('#adminSidebar')).toHaveClass(/panel-collapsed/);
      await expect(page.locator('#adminNavPanel')).toHaveCSS('width', '0px');

      // Reload verifies persistence
      await page.reload();
      await expect(page.locator('#adminSidebar')).toHaveClass(/panel-collapsed/);

      // Uncollapse
      await page.locator('#adminSidebarCollapseBtn').click();
      await expect(page.locator('#adminSidebar')).not.toHaveClass(/panel-collapsed/);
      await expect(page.locator('#adminSidebarCollapseBtn')).toContainText('Collapse');
    });

    test(`S2.3 Top bar and titles in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      const topbar = page.locator('#admin-app .topbar');
      await expect(topbar).toBeVisible();
      await expectStyle(topbar, {
        height: '52px',
      });

      // Right side buttons: export and bell are 30px square outlined buttons
      const exportBtn = page.locator('#adminExportBtn');
      await expect(exportBtn).toBeVisible();
      await expectStyle(exportBtn, {
        width: '30px',
        height: '30px',
        borderRadius: '8px',
      });

      const notifBtn = page.locator('#adminNotifBtn');
      await expect(notifBtn).toBeVisible();
      await expectStyle(notifBtn, {
        width: '30px',
        height: '30px',
        borderRadius: '8px',
      });

      // Search button is REMOVED in topbar (D9)
      await expect(page.locator('#adminSearchBtn')).toHaveCount(0);

      // Account menu avatar is visible
      const accountBtn = page.locator('#adminAccountBtn');
      await expect(accountBtn).toBeVisible();

      // Page title block: 30px tinted tile, title 16px/700, sub text
      await page.evaluate(() => showSection('a-dashboard', 'admin'));
      const tile = page.locator('#adminAreaTile');
      await expect(tile).toBeVisible();
      await expectStyle(tile, {
        width: '30px',
        height: '30px',
        borderRadius: '9px',
      });

      const title = page.locator('#adminPageTitle');
      await expectStyle(title, {
        fontSize: '16px',
        fontWeight: '700',
      });

      // Test sentence-case titles on several pages
      await expect(title).toHaveText('HR dashboard');

      await page.evaluate(() => showSection('a-requests', 'admin'));
      await expect(title).toHaveText('Pending requests');

      await page.evaluate(() => showSection('a-salary', 'admin'));
      await expect(title).toHaveText('Salary and raises');

      await page.evaluate(() => showSection('a-invoices', 'admin'));
      await expect(title).toHaveText('Salary payment docs');

      await page.evaluate(() => showSection('a-dochub', 'admin'));
      await expect(title).toHaveText('Document hub');

      await page.evaluate(() => showSection('a-finance-payroll-runs', 'admin'));
      await expect(title).toHaveText('Payroll runs');

      // Test employee breadcrumb
      await page.evaluate(() => {
        if (typeof viewProfile === 'function') viewProfile('1');
        else showSection('a-employee-detail', 'admin', ['1']);
      });
      await expect(title).toContainText('Employees / ');
    });

    test(`S2.4 Sidebar labels, portal head, command palette in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);

      // Admin sidebar sentence-case labels
      await expect(page.locator('#adminSidebar a[data-page="a-requests"] .nav-label')).toHaveText('Pending requests');
      await expect(page.locator('#adminSidebar a[data-page="a-salary"] .nav-label')).toHaveText('Salary and raises');
      await expect(page.locator('#adminSidebar a[data-page="a-invoices"] .nav-label')).toHaveText('Salary payment docs');
      await expect(page.locator('#adminSidebar a[data-page="a-insurance"] .nav-label')).toHaveText('Medical insurance');
      await expect(page.locator('#adminSidebar a[data-page="a-dochub"] .nav-label')).toHaveText('Document hub');
      await expect(page.locator('#adminSidebar a[data-page="a-finance-payroll-runs"] .nav-label')).toHaveText('Payroll runs');
      await expect(page.locator('#adminSidebar a[data-page="a-finance-payroll-settings"] .nav-label')).toHaveText('Payroll settings');
      await expect(page.locator('#adminSidebar a[data-page="a-system-roles"] .nav-label')).toHaveText('Roles and permissions');
      await expect(page.locator('#adminSidebar a[data-page="a-system-users"] .nav-label')).toHaveText('User accounts');

      // Command palette modal classes and structure
      const cmdPalette = page.locator('#commandPaletteModal');
      await expect(cmdPalette).toHaveClass(/fv/);
      await expect(cmdPalette).toHaveClass(/fv-dialog/);

      // Employee portal sidebar labels and head
      await openEmployee(page, theme);
      await expect(page.locator('#empSidebar a[data-page="e-salary"] .nav-label')).toHaveText('My salary');
      await expect(page.locator('#empSidebar a[data-page="e-payslips"] .nav-label')).toHaveText('Payslips');
      await expect(page.locator('#empSidebar a[data-page="e-insurance"] .nav-label')).toHaveText('Medical insurance');
      await expect(page.locator('#empSidebar a[data-page="e-dochub"] .nav-label')).toHaveText('Document hub');

      // Employee portal head
      const empSub = page.locator('#empNavPanelSub');
      await expect(empSub).toHaveText(/Sarah Connor · Engineering/);
    });

    test(`S3.1 HR dashboard in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-dashboard', 'admin'));

      // 4 stat cards in hero-banner with dynamic sublines
      const heroStats = page.locator('#a-dashboard .hero-stats .hero-card');
      await expect(heroStats).toHaveCount(4);
      await expect(page.locator('#statEmployeesSub')).toBeVisible();
      await expect(page.locator('#statPendingSub')).toBeVisible();
      await expect(page.locator('#statOnLeaveSub')).toBeVisible();
      await expect(page.locator('#statOpenClaimsSub')).toBeVisible();

      // Requests by month custom legend (no "View all")
      const legendItems = page.locator('#a-dashboard .hv-chart-legend .hv-legend-item');
      await expect(legendItems).toHaveCount(3);
      await expect(legendItems.nth(0)).toContainText('Vacation');
      await expect(legendItems.nth(1)).toContainText('Work from home');
      await expect(legendItems.nth(2)).toContainText('Medical claim');

      // Request types horizontal progress bars and summary
      await expect(page.locator('#a-dashboard h3:has-text("Request types")')).toBeVisible();
      const reqBars = page.locator('#requestTypeBars .hv-req-bar-item');
      await expect(reqBars).toHaveCount(3);
      await expect(page.locator('#requestTypeSummary')).toBeVisible();

      // Card titles & links
      await expect(page.locator('#a-dashboard .card:has(#upcomingRaisesList) h3')).toHaveText('Upcoming raises');
      await expect(page.locator('#a-dashboard .card:has(#dashPendingBody) h3')).toHaveText('Waiting for a decision');

      // Table headers in Waiting for a decision
      const headers = page.locator('#a-dashboard .card:has(#dashPendingBody) th');
      await expect(headers.nth(0)).toHaveText('Employee');
      await expect(headers.nth(1)).toHaveText('Request');
      await expect(headers.nth(2)).toHaveText('Dates');
      await expect(headers.nth(3)).toHaveText('Actions');

      // Check Review button in Waiting for a decision
      const firstRowBtn = page.locator('#dashPendingBody tr:first-child .btn');
      if (await firstRowBtn.count() > 0) {
        await expect(firstRowBtn).toHaveText('Review');
      }

      // Medical insurance bottom strip
      await expect(page.locator('#a-dashboard .hv-dash-insurance-card h3')).toHaveText('Medical insurance this year');
      await expect(page.locator('#dashInsuranceSub')).toBeVisible();
      await expect(page.locator('#a-dashboard .hv-dash-ins-btn')).toHaveText('Medical insurance');
    });

    test(`S3.2 Employees table & actions in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-employees', 'admin'));

      // Filter pills
      const filterPills = page.locator('#employeeStatusFilterGroup .filter-tab');
      await expect(filterPills).toHaveCount(4);
      await expect(filterPills.first()).toHaveClass(/active/);

      // Table headers
      const ths = page.locator('#a-employees table thead th:not([style*="display:none"]):not([style*="display: none"])');
      await expect(ths.nth(0)).toHaveText(/Employee/);
      await expect(ths.nth(1)).toHaveText('Role');
      await expect(ths.nth(2)).toHaveText('Employment');
      await expect(ths.nth(3)).toHaveText('Next raise');
      await expect(ths.nth(4)).toHaveText('Status');
      await expect(ths.nth(5)).toHaveText('Actions');

      // Table row actions
      const firstRow = page.locator('#employeesTableBody tr').first();
      await expect(firstRow.locator('button:has-text("View")')).toHaveCount(0);
      await expect(firstRow.locator('td.tname a')).toBeVisible();
      await expect(firstRow.locator('button[title="Edit"]')).toBeVisible();
      await expect(firstRow.locator('button[title="Generate salary payment doc"]')).toBeVisible();
    });

    test(`S3.3 Employee detail card & KPI strip in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => {
        const empId = (window.employees && window.employees[0]) ? window.employees[0].id : 'EMP001';
        if (typeof viewProfile === 'function') viewProfile(empId);
        else showSection('a-employee-detail', 'admin', [empId]);
      });

      // Employee summary card and actions
      await expect(page.locator('#edBehalfVacationBtn')).toHaveText('Leave on behalf');
      await expect(page.locator('#edBehalfClaimBtn')).toHaveText('Claim on behalf');
      await expect(page.locator('#edEditEmployeeBtn')).toHaveText('Edit employee');

      // Card headings
      await expect(page.locator('#a-employee-detail .card:has(#detailVacationBody) h3')).toHaveText(/Leave history/);
      await expect(page.locator('#a-employee-detail .card:has(#detailClaimsBody) h3')).toHaveText(/Insurance claims/);
      await expect(page.locator('#detailMetaCard h3')).toHaveText('Details');
    });

    test(`S3.4 Requests tabs & pills in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-requests', 'admin'));

      // Tab bar tabs
      const tabs = page.locator('#a-requests .filter-tab.hv-tab');
      await expect(tabs).toHaveCount(4);
      await expect(tabs.first()).toHaveClass(/active/);

      // Status pills
      const pills = page.locator('#requestStatusPills .hv-sp');
      await expect(pills).toHaveCount(4);
      await expect(pills.first()).toHaveClass(/active/);

      // Pending row action buttons
      const pendingRow = page.locator('#requestsTableBody tr.hv-row-pending').first();
      if (await pendingRow.count() > 0) {
        await expect(pendingRow.locator('.btn-success-outline')).toHaveText(/Approve/);
        await expect(pendingRow.locator('.btn-danger-outline')).toBeVisible();
      }
    });

    test(`S3.5 Salary and raises in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-salary', 'admin'));

      // 4 stat tiles
      const statTiles = page.locator('#a-salary .hv-stat-tile');
      await expect(statTiles).toHaveCount(4);
      await expect(statTiles.nth(0).locator('.hv-stat-label')).toHaveText('Monthly pay, all employees');
      await expect(statTiles.nth(1).locator('.hv-stat-label')).toHaveText('Average raise, last cycle');
      await expect(statTiles.nth(2).locator('.hv-stat-label')).toHaveText('Raises applied this year');
      await expect(statTiles.nth(3).locator('.hv-stat-label')).toHaveText('Raises due this quarter');

      // Current pay card & table
      await expect(page.locator('#a-salary .card:has(#salaryTableBody) h3')).toHaveText('Current pay');
      await expect(page.locator('#salarySearch')).toHaveAttribute('placeholder', 'Search employees');
      await expect(page.locator('#btnApplyRaise')).toHaveText('Apply raise');

      const payThs = page.locator('#a-salary table:has(#salaryTableBody) thead th');
      await expect(payThs.nth(0)).toHaveText('Employee');
      await expect(payThs.nth(1)).toHaveText('External USD');
      await expect(payThs.nth(2)).toHaveText('Internal USD cash');
      await expect(payThs.nth(3)).toHaveText('Monthly total');
      await expect(payThs.nth(4)).toHaveText('Next raise ↑');
      await expect(payThs.nth(5)).toHaveText('Last raise');

      // The mock has no footer on the current pay table
      await expect(page.locator('#salaryTableFooter')).toHaveCount(0);

      // Raise history card & table
      await expect(page.locator('#a-salary .card:has(#companyRaiseHistoryBody) h3')).toHaveText('Raise history');
      await expect(page.locator('#raiseHistoryYearFilter')).toBeVisible();

      const histThs = page.locator('#a-salary table:has(#companyRaiseHistoryBody) thead th');
      await expect(histThs.nth(0)).toHaveText('Employee');
      await expect(histThs.nth(1)).toHaveText('Effective ↓');
      await expect(histThs.nth(2)).toHaveText('Internal USD');
      await expect(histThs.nth(3)).toHaveText('External USD');
      await expect(histThs.nth(4)).toHaveText('New monthly total');
      await expect(histThs.nth(5)).toHaveText('Change');
      await expect(histThs.nth(6)).toHaveText('Reason');

      await expect(page.locator('#raiseHistoryFooter')).toHaveCount(0);

      // Raise modal tiles and headers
      await page.evaluate(() => openRaiseModal());
      await expect(page.locator('#raiseModal')).toBeVisible();
      await expect(page.locator('#raiseModal h3')).toHaveText('Apply raise');
      await expect(page.locator('#rvCurrentInternalTile')).toBeVisible();
      await expect(page.locator('#rvCurrentExternalTile')).toBeVisible();
      await page.evaluate(() => closeModal('raiseModal'));
      await expect(page.locator('#raiseModal')).not.toBeVisible();
    });

    test(`S3.6 Salary payment docs in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-invoices', 'admin'));

      // Toolbar elements
      await expect(page.locator('#invPeriodBtn')).toBeVisible();
      await expect(page.locator('#btnPreviewInvoices')).toHaveText('Preview employees');
      await expect(page.locator('#btnGenerateBulkInvoices')).toBeVisible();

      // Card 1: Who gets a doc
      await expect(page.locator('#a-invoices .card:has(#invoiceResultsBody) h3')).toBeVisible();
      const filterPills = page.locator('#invoiceStatusFilterGroup .filter-tab');
      await expect(filterPills).toHaveCount(4);
      await expect(filterPills.first()).toHaveClass(/active/);

      // Trigger preview
      await page.locator('#btnPreviewInvoices').click();
      await expect(page.locator('#invoiceResultsBody tr')).not.toHaveCount(0);

      // Table headers
      const ths = page.locator('#a-invoices table:has(#invoiceResultsBody) thead th');
      await expect(ths.nth(0)).toHaveText('Employee');
      await expect(ths.nth(1)).toHaveText('Payment doc ID');
      await expect(ths.nth(2)).toHaveText('External USD');
      await expect(ths.nth(3)).toHaveText('Status');

      // Modals
      await page.evaluate(() => {
        if (typeof generateBulkInvoices === 'function') generateBulkInvoices();
      });
      await expect(page.locator('#bulkInvoiceModal')).toBeVisible();
      await expect(page.locator('#bulkInvoiceModalTitle')).toHaveText('Generate salary payment docs');
      await page.evaluate(() => closeModal('bulkInvoiceModal'));
      await expect(page.locator('#bulkInvoiceModal')).not.toBeVisible();

      await page.evaluate(() => {
        if (typeof openRegenerateInvoiceModal === 'function') {
          openRegenerateInvoiceModal(1, 'Sarah Connor', 2026, 10, 'SPD-2026-10-01');
        }
      });
      await expect(page.locator('#regenerateInvoiceModal')).toBeVisible();
      await expect(page.locator('#regenModalTitle')).toHaveText('Regenerate doc?');
      await page.evaluate(() => closeModal('regenerateInvoiceModal'));
      await expect(page.locator('#regenerateInvoiceModal')).not.toBeVisible();
    });

    test(`S3.7 Vacations balances & usage bars in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-vacations', 'admin'));

      // 3 stat tiles
      const statTiles = page.locator('#a-vacations .hv-stat-tile');
      await expect(statTiles).toHaveCount(3);
      await expect(statTiles.nth(0).locator('.hv-stat-label')).toHaveText('Days allotted in 2026');
      await expect(statTiles.nth(1).locator('.hv-stat-label')).toHaveText('Days used so far');
      await expect(statTiles.nth(2).locator('.hv-stat-label')).toHaveText('On leave today');

      // Card & table
      await expect(page.locator('#a-vacations .card:has(#vacationBalanceBody) h3')).toHaveText('Balances');
      await expect(page.locator('#vacDeptFilter')).toBeVisible();
      await expect(page.locator('#vacBalanceSearch')).toHaveAttribute('placeholder', 'Search employees');
      await expect(page.locator('#btnRecordLeave')).toHaveText('Record leave');

      const ths = page.locator('#a-vacations table:has(#vacationBalanceBody) thead th');
      await expect(ths.nth(0)).toHaveText('Employee');
      await expect(ths.nth(1)).toHaveText('Entitled');
      await expect(ths.nth(2)).toHaveText('Used');
      await expect(ths.nth(3)).toHaveText('Remaining ↑');
      await expect(ths.nth(4)).toHaveText('Usage');

      const firstRow = page.locator('#vacationBalanceBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('button:has-text("Record leave")')).toBeVisible();

      await expect(page.locator('#vacTableFooter')).toHaveCount(0);

      // Behalf vacation modal
      await page.evaluate(() => openBehalfVacationModal());
      await expect(page.locator('#behalfVacationModal')).toBeVisible();
      await expect(page.locator('#behalfVacationModal .modal-head-text h3')).toBeVisible();
      await page.evaluate(() => closeModal('behalfVacationModal'));
      await expect(page.locator('#behalfVacationModal')).not.toBeVisible();
    });

    test(`S3.8 Medical insurance & categories in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-insurance', 'admin'));

      // 4 stat tiles
      const statTiles = page.locator('#a-insurance .hv-stat-tile');
      await expect(statTiles).toHaveCount(4);
      await expect(statTiles.nth(0).locator('.hv-stat-label')).toHaveText('Claims in 2026');
      await expect(statTiles.nth(1).locator('.hv-stat-label')).toHaveText('Approved');
      await expect(statTiles.nth(2).locator('.hv-stat-label')).toHaveText('Waiting for a decision');
      await expect(statTiles.nth(3).locator('.hv-stat-label')).toHaveText('Reimbursed');

      // 2-column cards
      await expect(page.locator('#a-insurance h3:has-text("Use against annual limits")')).toBeVisible();
      await expect(page.locator('#adminInsuranceCategoryHighlights .insurance-limit-item').first()).toBeVisible();

      await expect(page.locator('#a-insurance h3:has-text("Categories and limits")')).toBeVisible();
      await expect(page.locator('#a-insurance button:has-text("Add category")')).toBeVisible();
      await expect(page.locator('#categoriesTableBody tr').first()).toBeVisible();

      // Claims table
      await expect(page.locator('#a-insurance h3:has-text("Claims")')).toBeVisible();
      await expect(page.locator('#insuranceExportBtn')).toHaveText('Export');
      await expect(page.locator('#a-insurance button:has-text("Record claim")')).toBeVisible();

      const ths = page.locator('#a-insurance table:has(#insuranceTableBody) thead th');
      await expect(ths.nth(0)).toHaveText('Employee');
      await expect(ths.nth(1)).toHaveText('Category');
      await expect(ths.nth(2)).toHaveText('Provider');
      await expect(ths.nth(3)).toContainText('Date');
      await expect(ths.nth(4)).toHaveText('Status');
      await expect(ths.nth(5)).toHaveText('Amount');

      // Modals
      await page.evaluate(() => openCategoryModal());
      await expect(page.locator('#categoryModal')).toBeVisible();
      await expect(page.locator('#categoryModalTitle')).toHaveText('Add category');
      await page.evaluate(() => closeModal('categoryModal'));
      await expect(page.locator('#categoryModal')).not.toBeVisible();

      await page.evaluate(() => openBehalfClaimModal());
      await expect(page.locator('#behalfClaimModal')).toBeVisible();
      await expect(page.locator('#behalfClaimModalTitle')).toContainText('Record claim');
      await page.evaluate(() => closeModal('behalfClaimModal'));
      await expect(page.locator('#behalfClaimModal')).not.toBeVisible();
    });

    test(`S3.9 Document hub in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-dochub', 'admin'));

      // Toolbar
      const pills = page.locator('#dochubCategoryFilterGroup .filter-tab');
      await expect(pills.first()).toBeVisible();
      await expect(pills.first()).toContainText('All');

      await expect(page.locator('#dochubSearch')).toHaveAttribute('placeholder', 'Search documents');
      await expect(page.locator('#a-dochub button:has-text("Add document")')).toBeVisible();

      // Table headers
      const ths = page.locator('#a-dochub table:has(#dochubTableBody) thead th');
      await expect(ths.nth(0)).toHaveText('Document');
      await expect(ths.nth(1)).toHaveText('Category');
      await expect(ths.nth(2)).toContainText('Uploaded');

      // First row
      const firstRow = page.locator('#dochubTableBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('.doc-name-cell .doc-name-text')).toBeVisible();
      await expect(firstRow.locator('.hv-catdot')).toBeVisible();
      await expect(firstRow.locator('button:has-text("Preview")')).toBeVisible();

      // Footer
      const foot = page.locator('#dochubTableFooter');
      await expect(foot).toContainText('Showing');
      await expect(foot).toContainText('Page 1 of 1');

      // Modal
      await page.evaluate(() => openCompanyDocumentModal());
      await expect(page.locator('#companyDocumentModal')).toBeVisible();
      await expect(page.locator('#companyDocumentModalTitle')).toHaveText('Add company document');
      await expect(page.locator('#dochubUploadBtn')).toHaveText('Publish document');
      await page.evaluate(() => closeModal('companyDocumentModal'));
      await expect(page.locator('#companyDocumentModal')).not.toBeVisible();
    });

    test(`S4.1 Payroll runs list, topbar run header, and stepper in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));

      // 1. Top bar title & banner
      await expect(page.locator('#adminPageTitle')).toHaveText('Payroll runs');
      const banner = page.locator('#payrollCycleBanner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('Current cycle · step');
      await expect(banner).toContainText('Continue run');

      // 2. Filter row & New payroll run button
      await expect(page.locator('#payrollRunsFilter')).toBeVisible();
      await expect(page.locator('#btnStartNewRun')).toHaveText('New payroll run');

      // 3. Table headers
      const ths = page.locator('#payrollRunsTable thead th');
      await expect(ths.nth(0)).toContainText('Period ↓');
      await expect(ths.nth(1)).toHaveText('Salaries');
      await expect(ths.nth(2)).toHaveText('Statutory');
      await expect(ths.nth(3)).toHaveText('Employees');
      await expect(ths.nth(4)).toHaveText('Net pay');
      await expect(ths.nth(5)).toHaveText('Last saved');

      // 4. Table first row & period formatting
      const firstRow = page.locator('#payrollRunsTableBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('.pv-period')).toBeVisible();
      await expect(firstRow.locator('.pv-period-sub')).toBeVisible();

      // 5. Footer
      const foot = page.locator('#payrollRunsFoot');
      await expect(foot).toContainText('Showing');
      await expect(foot).toContainText('Page 1 of 1');

      // 6. Navigate into run view and check topbar breadcrumb + stepper
      await page.click('#btnOpenCurrentCycle');
      await expect(page.locator('#payrollViewRun')).toBeVisible();
      await expect(page.locator('#adminPageTitle')).toContainText('Payroll runs /');
      await expect(page.locator('#payrollStatusBadge')).toBeVisible();
      await expect(page.locator('#payrollFxStrip')).toBeHidden();

      // Stepper 6 steps
      const steps = page.locator('#payrollStepper .payroll-step-pill');
      await expect(steps).toHaveCount(6);
      await expect(steps.nth(0)).toContainText('Set up');
      await expect(steps.nth(1)).toContainText('Review pay');
      await expect(steps.nth(2)).toContainText('Statutory');
      await expect(steps.nth(3)).toContainText('Payment preview');
      await expect(steps.nth(4)).toContainText('Confirm payment');
      await expect(steps.nth(5)).toContainText('Statutory payments');
    });

    test(`S4.2 Step 1 Pay-Run-Setup in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');

      const s1 = page.locator('#payrollScreen1');
      await expect(s1).toBeVisible();

      // 1. Two top cards
      const cards = s1.locator('.pv-s1-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('h2')).toHaveText('Period and pay date');
      await expect(cards.nth(1).locator('h2')).toHaveText('Company funding accounts and FX');

      // 2. Period inputs
      await expect(page.locator('#p1Month')).toBeVisible();
      await expect(page.locator('#p1PayDate')).toBeVisible();
      await expect(page.locator('#p1Start')).toBeVisible();
      await expect(page.locator('#p1End')).toBeVisible();

      // 3. Accounts and FX add-on
      await expect(page.locator('#p1ExtAccount')).toBeVisible();
      await expect(page.locator('#p1IntAccount')).toBeVisible();
      await expect(s1.locator('.pv-addon')).toHaveText('1 USD =');
      await expect(page.locator('#p1FxRateInput')).toBeVisible();
      await expect(page.locator('#btnP1ApplyFx')).toHaveText('Apply');
      await expect(page.locator('#btnP1ResetFx')).toHaveText('Reset');

      // 4. Four KPI tiles
      const tiles = s1.locator('.pv-stat-tile');
      await expect(tiles).toHaveCount(4);
      await expect(tiles.nth(0).locator('.label')).toHaveText('Eligible employees');
      await expect(page.locator('#p1Headcount')).toHaveText('2');
      await expect(tiles.nth(1).locator('.label')).toHaveText('External base');
      await expect(tiles.nth(2).locator('.label')).toHaveText('Internal base');
      await expect(tiles.nth(3).locator('.label')).toHaveText('Projected net pay');

      // 5. Footer note & button
      await expect(s1.locator('.pv-s1-footer-note')).toHaveText('Saved automatically after every change');
      await expect(page.locator('#btnP1Proceed')).toContainText('Next: review pay');

      // 6. Style assertions
      await expectStyle(cards.first(), { borderRadius: '14px' });
      await expectStyle(tiles.first(), { borderRadius: '14px' });
    });

    test(`S4.3 Step 2 Review pay in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');
      await page.click('#btnP1Proceed');

      const s2 = page.locator('#payrollScreen2');
      await expect(s2).toBeVisible();

      // 1. Card header and subtitle
      const card = s2.locator('.pv-s2-card');
      await expect(card).toBeVisible();
      await expect(card.locator('h2')).toHaveText('Review pay');
      await expect(card.locator('.pv-s2-sub')).toHaveText('One employee per row. Bonus and commission are optional for each month.');

      // 2. Search input (bonus filter removed from UI per user override)
      const searchInput = page.locator('#payrollSearchInput');
      await expect(searchInput).toBeVisible();
      await expect(searchInput).toHaveAttribute('placeholder', 'Search employee name...');
      await expect(page.locator('#payrollBonusFilter')).toBeHidden();

      // 3. Table headers
      const ths = page.locator('#payrollWorksheetTable thead th');
      await expect(ths.nth(0)).toHaveText('Employee');
      await expect(ths.nth(1)).toHaveText('External base, USD');
      await expect(ths.nth(2)).toHaveText('Internal base, USD');
      await expect(ths.nth(3)).toHaveText('Bonus or commission');
      await expect(ths.nth(4)).toHaveText('Reason');
      await expect(ths.nth(5)).toHaveText('Total pay, gross');

      // 4. Employee first cell two-line structure (name + role subline)
      const firstRow = page.locator('#payrollTableBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('.payroll-emp-link')).toContainText('Youssef Adel');
      await expect(firstRow.locator('.pv-emp-sub')).toBeVisible();

      // 5. Totals row
      await expect(page.locator('#fTotalsLabel')).toContainText('Totals ·');
      await expect(page.locator('#fNet')).toBeVisible();

      // 6. Blue info strip
      await expect(s2.locator('.pv-s2-info-strip')).toHaveText('Submit for approval, then approve to move on to statutory. Approved lines are read-only until the run is reverted to draft.');

      // 7. Footer buttons
      await expect(page.locator('#btnP2Back')).toHaveText('Back');
      await expect(page.locator('#btnP2SaveDraft')).toHaveText('Save draft');
      await expect(page.locator('#btnP2Approve')).toContainText('Submit for approval');

      // 8. Style assertions
      await expectStyle(card, { borderRadius: '14px' });
    });

    test(`S4.4 Step 3 Statutory processing in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');
      await page.evaluate(() => PayrollApp.setStep(2));

      const s3 = page.locator('#payrollScreen3');
      await expect(s3).toBeVisible();

      // 1. Lock banner
      await expect(s3.locator('.pv-s3-lock-banner')).toContainText('Finalized snapshot');

      // 2. Card header & subtitle
      const card = s3.locator('.pv-s3-card');
      await expect(card).toBeVisible();
      await expect(card.locator('h2')).toHaveText('Statutory processing');
      await expect(card.locator('.pv-s3-sub')).toContainText('HRFlow estimates of social insurance and income tax');
      await expect(card.locator('.pv-pill')).toHaveText('Estimates');

      // 3. Table headers
      const ths = page.locator('#payrollProcessingTable thead th');
      await expect(ths.nth(0)).toHaveText('Employee');
      await expect(ths.nth(1)).toHaveText('Insured base, EGP');
      await expect(ths.nth(2)).toHaveText('Employee SI, EGP');
      await expect(ths.nth(3)).toHaveText('Employer SI, EGP');
      await expect(ths.nth(4)).toHaveText('Total SI, EGP');
      await expect(ths.nth(5)).toHaveText('Income tax, EGP');
      await expect(ths.nth(6)).toHaveText('Internal net payment');

      // 4. Employee first cell two-line structure
      const firstRow = page.locator('#payrollProcessingTableBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('strong')).toBeVisible();
      await expect(firstRow.locator('.pv-emp-sub')).toBeVisible();

      // 5. Totals row
      await expect(page.locator('#p3TotalsLabel')).toContainText('Totals ·');
      await expect(page.locator('#p3TotNetUsd')).toBeVisible();

      // 6. Footer hint and button
      await expect(s3.locator('.pv-s3-footer-hint')).toHaveText('Estimates only. The government portals stay authoritative.');
      await expect(page.locator('#btnP3Next')).toContainText('Next: payment preview');
    });

    test(`S4.5 Step 4 Pay-Run-Preview in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');
      await page.evaluate(() => PayrollApp.setStep(3));

      const s4 = page.locator('#payrollScreen4');
      await expect(s4).toBeVisible();

      // 1. Four KPI tiles
      const tiles = s4.locator('.pv-stat-tile');
      await expect(tiles).toHaveCount(4);
      await expect(tiles.nth(0).locator('.label')).toHaveText('External payment');
      await expect(page.locator('#p4ExtBankTotal')).toBeVisible();
      await expect(tiles.nth(1).locator('.label')).toHaveText('Internal net payment');
      await expect(page.locator('#p4IntCashTotal')).toBeVisible();
      await expect(tiles.nth(2).locator('.label')).toHaveText('Total net pay');
      await expect(page.locator('#p4TotalNet')).toBeVisible();
      await expect(tiles.nth(3).locator('.label')).toHaveText('Recipients');
      await expect(page.locator('#p4RecipientsVal')).toBeVisible();

      // 2. Card header with Who gets paid and Export CSV
      const card = s4.locator('.pv-s4-card');
      await expect(card).toBeVisible();
      await expect(card.locator('h2')).toHaveText('Who gets paid');
      await expect(page.locator('#btnP4ExportCsv')).toHaveText('Export CSV');

      // 3. Table headers (visible headers: Employee, Employee bank account, External, USD, Internal, USD, Net pay)
      const visibleThs = page.locator('#payrollPaymentPreviewTable thead th:not([style*="display:none"]):not([style*="display: none"])');
      await expect(visibleThs).toHaveCount(5);
      await expect(visibleThs.nth(0)).toHaveText('Employee');
      await expect(visibleThs.nth(1)).toHaveText('Employee bank account');
      await expect(visibleThs.nth(2)).toHaveText('External, USD');
      await expect(visibleThs.nth(3)).toHaveText('Internal, USD');
      await expect(visibleThs.nth(4)).toHaveText('Net pay');

      // 4. Employee first cell with link and avatar
      const firstRow = page.locator('#payrollPaymentPreviewTableBody tr').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow.locator('.payroll-emp-link')).toBeVisible();

      // 5. Totals row
      await expect(page.locator('#p4TotalsLabel')).toContainText('Totals ·');
      await expect(page.locator('#p4TotNet')).toBeVisible();

      // 6. Footer buttons
      await expect(page.locator('#btnP4Back')).toHaveText('Back');
      await expect(page.locator('#btnP4Next')).toContainText('Next: confirm payment');

      // 7. Style assertions
      await expectStyle(card, { borderRadius: '14px' });
      await expectStyle(tiles.first(), { borderRadius: '14px' });
    });

    test(`S4.6 Step 5 Pay-Run-Confirm and Record paid dialog in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');
      await page.evaluate(async () => {
        const usd = (PayrollApp.banks || []).find((b) => String(b.currency).toUpperCase() === 'USD');
        if (usd) { await PayrollApp.setFundingAccount('internal', usd.id); PayrollApp.drawScreen1(); }
      });
      await page.click('#btnP1Proceed');
      await submitAndApprove(page);
      await page.click('#btnP3Next');
      await page.click('#btnP4Next');

      const s5 = page.locator('#payrollScreen5');
      await expect(s5).toBeVisible();

      // 1. Two rail cards (Internal salaries, External salaries)
      const cards = s5.locator('.pv-s5-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('h2')).toHaveText('Internal salaries');
      await expect(page.locator('#p5IntTotal')).toBeVisible();
      await expect(cards.nth(1).locator('h2')).toHaveText('External salaries');
      await expect(page.locator('#p5ExtTotal')).toBeVisible();

      // Check inner tiles on cards
      await expect(page.locator('#p5IntPayDate')).toBeVisible();
      await expect(page.locator('#p5IntAccount')).toBeVisible();
      await expect(page.locator('#p5IntRecipientsCount')).toBeVisible();
      await expect(page.locator('#p5ExtPayDate')).toBeVisible();
      await expect(page.locator('#p5ExtAccount')).toBeVisible();
      await expect(page.locator('#p5ExtRecipientsCount')).toBeVisible();

      // 2. Footer elements
      await expect(page.locator('#btnP5Back')).toHaveText('Back');
      await expect(page.locator('#btnP5ExportCsv')).toHaveText('Export CSV');
      await expect(page.locator('#p5ConfirmHint')).toBeVisible();
      await expect(page.locator('#btnP5ConfirmDisburse')).toHaveText('Confirm and record as paid');

      // 3. Trigger Confirm dialog and test restyled Dlg-RecordPaid elements
      await page.click('#btnP5ConfirmDisburse');
      const modal = page.locator('#financeConfirmModal');
      await expect(modal).toBeVisible();
      await expect(modal.locator('#financeConfirmTitle')).toContainText('Record');
      await expect(modal.locator('#financeConfirmTitle')).toContainText('as paid?');
      await expect(modal.locator('#financeConfirmSubtitle')).toHaveText('Records the payment in HRFlow. No money is sent.');

      // 3 tiles in modal
      const modalTiles = modal.locator('#financeConfirmTiles > div');
      await expect(modalTiles).toHaveCount(3);
      await expect(modalTiles.nth(0)).toContainText('Total net pay');
      await expect(modalTiles.nth(1)).toContainText('Recipients');
      await expect(modalTiles.nth(2)).toContainText('Missing bank details');

      // Dismiss dialog
      await page.click('#financeConfirmCancelBtn');
      await expect(modal).not.toBeVisible();

      // 4. Style assertions
      await expectStyle(cards.first(), { borderRadius: '14px' });
    });

    test(`S4.7 Step 6 Pay-Run-Statutory in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#btnOpenCurrentCycle');
      await page.evaluate(async () => {
        const usd = (PayrollApp.banks || []).find((b) => String(b.currency).toUpperCase() === 'USD');
        if (usd) { await PayrollApp.setFundingAccount('internal', usd.id); PayrollApp.drawScreen1(); }
      });
      await page.click('#btnP1Proceed');
      await submitAndApprove(page);
      await page.click('#btnP3Next');
      await page.click('#btnP4Next');
      // "Next: Statutory payments" appears once the payment is recorded; the stepper reaches Step 6 directly
      await page.evaluate(() => PayrollApp.setStep(5));

      const s6 = page.locator('#payrollScreen6');
      await expect(s6).toBeVisible();

      // 1. Two cards: Social insurance and Salary income tax
      const cards = s6.locator('.pv-s6-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('h2')).toHaveText('Social insurance');
      await expect(cards.nth(1).locator('h2')).toHaveText('Salary income tax');

      // 2. Metrics tiles
      await expect(page.locator('#p6SocialInsEstimate')).toBeVisible();
      await expect(page.locator('#p6SocialInsActual')).toBeVisible();
      await expect(page.locator('#p6SocialInsVariance')).toBeVisible();
      await expect(page.locator('#p6TaxEstimate')).toBeVisible();
      await expect(page.locator('#p6TaxActual')).toBeVisible();
      await expect(page.locator('#p6TaxVariance')).toBeVisible();

      // Sub lines
      await expect(cards.nth(0)).toContainText('run snapshot');
      await expect(cards.nth(0)).toContainText('confirmed − estimate');

      // 3. Fields & Actions
      await expect(page.locator('#p6SiDebitAccount')).toBeVisible();
      await expect(page.locator('#p6SiPaymentDate')).toBeVisible();
      await expect(page.locator('#btnP6RecordSocialIns')).toBeVisible();

      // 4. Obligations Table
      const table = page.locator('#payrollStatutoryRecordsTable');
      await expect(table).toBeVisible();
      const headers = table.locator('thead th');
      await expect(headers).toHaveCount(6);
      await expect(headers.nth(0)).toHaveText('Obligation');
      await expect(headers.nth(1)).toHaveText('Period');
      await expect(headers.nth(2)).toHaveText('Accrued');
      await expect(headers.nth(3)).toHaveText('Remitted');
      await expect(headers.nth(4)).toHaveText('Status');
      await expect(headers.nth(5)).toHaveText('Notes');

      // 5. Footer elements
      await expect(page.locator('#btnP6Back')).toHaveText('Back');
      await expect(page.locator('#btnP6Finish')).toHaveText('Finish and return to runs');
      await expect(page.locator('.pv-s6-footer')).toContainText('The government portal is the source of truth');

      // 6. Style assertions
      await expectStyle(cards.first(), { borderRadius: '14px' });
    });

    test(`S4.8 Settings and Revert modal in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.waitForFunction(() => window.PayrollApp && typeof showSection === 'function');
      await page.evaluate(() => showSection('a-finance-payroll', 'admin'));
      await page.click('#payrollNavSettings');

      // 1. Settings view visibility & intro
      const settings = page.locator('#payrollViewSettings');
      await expect(settings).toBeVisible();
      await expect(page.locator('.pv-settings-intro')).toHaveText('Defaults for every new payroll run. The statutory rates are internal estimates; the government portals stay authoritative.');

      // 2. Four Cards
      const card1 = page.locator('#payrollFundingAccountsSettingsCard');
      const card2 = page.locator('#payrollMonthFxSettingsCard');
      const card3 = page.locator('#payrollSocialInsuranceSettingsCard');
      const card4 = page.locator('#payrollTaxSettingsCard');

      await expect(card1).toBeVisible();
      await expect(card1.locator('h2')).toHaveText('Company funding accounts');
      await expect(page.locator('#payrollTargetExternalAccount')).toBeVisible();
      await expect(page.locator('#payrollTargetInternalAccount')).toBeVisible();

      await expect(card2).toBeVisible();
      await expect(card2.locator('h2')).toHaveText('Active cycle and FX rate');
      await expect(page.locator('#payrollSetMonth')).toBeVisible();
      await expect(page.locator('.pv-affix-prefix')).toHaveText('1 USD =');
      await expect(page.locator('#payrollSetFxRate')).toBeVisible();

      await expect(card3).toBeVisible();
      await expect(card3.locator('h2')).toHaveText('Social insurance rates');
      await expect(page.locator('#payrollEmployeeInsuranceRate')).toBeVisible();
      await expect(page.locator('#payrollEmployerInsuranceRate')).toBeVisible();

      await expect(card4).toBeVisible();
      await expect(card4.locator('h2')).toHaveText('Income tax exemption');
      await expect(page.locator('#payrollTaxLimitP')).toBeVisible();
      await expect(page.locator('.pv-affix-suffix:has-text("EGP a year")')).toBeVisible();

      // 3. Save bar
      const saveBar = page.locator('.pv-settings-save-bar');
      await expect(saveBar).toBeVisible();
      await expect(saveBar).toContainText('Changes apply to the current and future runs');
      await expect(page.locator('#payrollSettingsSaveBtn')).toHaveText('Save settings');

      // 4. Style assertions
      await expect(page.locator('#payrollViewSettings button:has-text("Back to payroll runs")')).toHaveCount(0);
      await expectStyle(card1, { borderRadius: '14px' });
      await expectStyle(card1.locator('.payroll-settings-card-header'), { justifyContent: 'flex-start' });
      await expectStyle(saveBar, { marginTop: '0px' });

      // 5. Revert Run modal
      await page.evaluate(() => {
        window.PayrollApp.showPage('run');
        window.PayrollApp.openRevertModal();
      });
      const revertModal = page.locator('#payrollRevertModal');
      await expect(revertModal).toBeVisible();
      await expect(page.locator('#payrollRevertTitle')).toContainText('Revert');
      await expect(page.locator('#payrollRevertReason')).toBeVisible();
      await expect(revertModal.locator('.modal-body')).toContainText('Required. Saved in the audit log.');
      await page.evaluate(() => window.PayrollApp.closeRevertModal());
      await expect(revertModal).toBeHidden();
    });

    test(`S5.1 Roles page and role modal in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.click('#systemRailBtn');
      await page.click('#systemNavRoles');
      await expect(page.locator('#a-system-roles')).toBeVisible();

      // Table & structure
      const table = page.locator('#a-system-roles table');
      await expect(table).toBeVisible();
      const headers = table.locator('thead th');
      await expect(headers).toHaveCount(5);
      await expect(headers.nth(0)).toHaveText('Role');
      await expect(headers.nth(1)).toHaveText('Description');
      await expect(headers.nth(2)).toHaveText('Users');
      await expect(headers.nth(3)).toHaveText('Permissions');

      // Super-Admin row
      const firstRow = table.locator('tbody tr').first();
      await expect(firstRow).toContainText('Super-Admin');
      await expect(firstRow).toContainText('Built-in role');

      // Create role modal
      await page.click('#btnCreateRole');
      const roleModal = page.locator('#roleModal');
      await expect(roleModal).toHaveClass(/active/);
      await expectStyle(roleModal.locator('.modal'), { width: '700px', borderRadius: '18px' });
      await expect(page.locator('#roleModalTitle')).toHaveText('Create role');
      await page.click('#roleModalCancelBtn');
      await expect(roleModal).not.toHaveClass(/active/);
    });

    test(`S5.2 Users page and modals in ${theme}`, async ({ page }) => {
      await openAdmin(page, theme);
      await page.click('#systemRailBtn');
      await page.click('#systemNavUsers');
      await expect(page.locator('#a-system-users')).toBeVisible();

      // Table & structure
      const tbody = page.locator('#systemUsersTableBody');
      await expect(tbody.locator('tr')).toHaveCount(6);

      const headers = page.locator('#a-system-users table thead th');
      await expect(headers).toHaveCount(5);
      await expect(headers.nth(0)).toHaveText('User ↑');
      await expect(headers.nth(1)).toHaveText('Email');
      await expect(headers.nth(2)).toHaveText('Role');
      await expect(headers.nth(3)).toHaveText('Status');

      // Footer
      const footer = page.locator('#systemUsersFooter');
      await expect(footer).toBeVisible();
      await expect(footer).toContainText('users · you cannot archive your own account');

      // External user modal
      await page.click('#btnAddExternalUser');
      const extModal = page.locator('#externalUserModal');
      await expect(extModal).toHaveClass(/active/);
      await expectStyle(extModal.locator('.modal'), { width: '520px', borderRadius: '18px' });
      await expect(page.locator('#externalUserModalTitle')).toHaveText('Add external user');
      await page.click('#extUserCancelBtn');
      await expect(extModal).not.toHaveClass(/active/);

      // Assign role modal
      const johnRow = tbody.locator('tr:has-text("John Doe")');
      await johnRow.locator('.btn-assign-roles').click();
      const assignModal = page.locator('#assignRolesModal');
      await expect(assignModal).toHaveClass(/active/);
      await expectStyle(assignModal.locator('.modal'), { width: '520px', borderRadius: '18px' });
      await page.click('#assignRolesCancelBtn');
      await expect(assignModal).not.toHaveClass(/active/);
    });

    test(`S6.1 Employee Dashboard in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await expect(page.locator('#e-dashboard')).toBeVisible();

      // Greeting & action buttons
      await expect(page.locator('#empDashGreeting')).toBeVisible();
      await expect(page.locator('#e-dashboard button:has-text("Submit a claim")')).toBeVisible();
      await expect(page.locator('#e-dashboard button:has-text("Request vacation")')).toBeVisible();

      // 4 KPI cards
      const heroStats = page.locator('#e-dashboard .hero-stats .hero-card');
      await expect(heroStats).toHaveCount(4);
      await expect(page.locator('#empDashVacDays')).toBeVisible();
      await expect(page.locator('#empDashSalary')).toBeVisible();
      await expect(page.locator('#empDashWfh')).toBeVisible();
      await expect(page.locator('#empDashClaims')).toBeVisible();

      // Gradient tile styles on first card
      await expectStyle(heroStats.first(), {
        borderRadius: '14px',
      });

      // 2-column layout: Recent requests & Next raise
      await expect(page.locator('#empTimeline')).toBeVisible();
      await expect(page.locator('#empNextRaiseDate')).toBeVisible();

      // Bottom medical insurance card
      await expect(page.locator('#empDashInsuranceSub')).toBeVisible();
      await expect(page.locator('#empDashInsuranceCategoryChips')).toBeVisible();
    });

    test(`S6.2 Employee Salary and raises in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await page.click('#empSidebar [data-page="e-salary"]');
      await expect(page.locator('#e-salary')).toBeVisible();

      // 4 KPI cards
      await expect(page.locator('#empSalaryMonthly')).toBeVisible();
      await expect(page.locator('#empSalaryExternal')).toBeVisible();
      await expect(page.locator('#empSalaryInternal')).toBeVisible();
      await expect(page.locator('#empSalaryNextRaise')).toBeVisible();

      // Chart card
      await expect(page.locator('#chartSalary')).toBeAttached();

      // Raise history table
      const headers = page.locator('#e-salary table thead th');
      await expect(headers).toHaveCount(6);
      await expect(headers.nth(0)).toHaveText('Effective');
      await expect(headers.nth(1)).toHaveText('Internal USD');
      await expect(headers.nth(2)).toHaveText('External USD');
      await expect(headers.nth(3)).toHaveText('Monthly total');
      await expect(headers.nth(4)).toHaveText('Change');
      await expect(headers.nth(5)).toHaveText('Reason');
      // The portal mock fixture carries the two raise records shown in ESS-Salary
      await expect(page.locator('#salaryHistoryBody tr')).toHaveCount(2);
    });

    test(`S6.3 Employee Payslips in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await page.click('#empSidebar [data-page="e-payslips"]');
      await expect(page.locator('#e-payslips')).toBeVisible();

      const card = page.locator('#e-payslips .card');
      await expect(card).toContainText('Payslips are coming soon');
      await expect(card.locator('button:has-text("See salary and raises")')).toBeVisible();
      await expectStyle(card, { borderRadius: '14px' });
    });

    test(`S6.4 Employee Vacations in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await page.click('#empSidebar [data-page="e-vacations"]');
      await expect(page.locator('#e-vacations')).toBeVisible();

      // 3 KPI cards
      await expect(page.locator('#empStatVacEntitlement')).toBeVisible();
      await expect(page.locator('#empStatVacUsed')).toBeVisible();
      await expect(page.locator('#empStatVacRemaining')).toBeVisible();

      // Form controls
      await expect(page.locator('#empVacationForm')).toBeVisible();
      await expect(page.locator('#vacType')).toBeVisible();
      await expect(page.locator('#vacDuration')).toBeVisible();
      await expect(page.locator('#vacStart')).toBeVisible();
      await expect(page.locator('#vacEnd')).toBeVisible();
      await expect(page.locator('#btnSubmitVacation')).toBeVisible();

      // History table
      const rows = page.locator('#empVacationBody tr');
      await expect(rows.first()).toBeVisible();
    });

    test(`S6.5 Employee Medical insurance in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await page.click('#empSidebar [data-page="e-insurance"]');
      await expect(page.locator('#e-insurance')).toBeVisible();

      // Left card
      await expect(page.locator('#empInsuranceTotalConsumed')).toBeVisible();
      await expect(page.locator('#empInsuranceCategoryGrid')).toBeVisible();

      // Submit claim form
      await expect(page.locator('#empClaimForm')).toBeVisible();
      await expect(page.locator('#claimCategory')).toBeVisible();
      await expect(page.locator('#claimAmount')).toBeVisible();

      // Table
      const headers = page.locator('#e-insurance table thead th');
      await expect(headers).toHaveCount(6);
      await expect(headers.nth(0)).toHaveText('Category');
      await expect(headers.nth(1)).toHaveText('Provider');
      await expect(headers.nth(2)).toHaveText('Date ↓');
      await expect(headers.nth(3)).toHaveText('Status');
      await expect(headers.nth(4)).toHaveText('Amount');

      await expect(page.locator('#empInsuranceBody tr')).toHaveCount(1);
    });

    test(`S6.6 Employee Document hub in ${theme}`, async ({ page }) => {
      await openEmployee(page, theme);
      await page.click('#empSidebar [data-page="e-dochub"]');
      await expect(page.locator('#e-dochub')).toBeVisible();

      // Category filter pills
      const filterGroup = page.locator('#empDochubCategoryFilterGroup');
      await expect(filterGroup).toBeVisible();
      await expect(filterGroup.locator('button').first()).toContainText('All');

      // Search
      await expect(page.locator('#empDochubSearch')).toBeVisible();

      // Table & headers
      const headers = page.locator('#e-dochub table thead th');
      await expect(headers).toHaveCount(4);
      await expect(headers.nth(0)).toHaveText('Document');
      await expect(headers.nth(1)).toHaveText('Category');
      await expect(headers.nth(2)).toHaveText('Published ↓');

      // Footer
      await expect(page.locator('#empDochubTableFooter')).toBeVisible();
    });
  });
}





