import { test, expect } from '@playwright/test';

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
  });
}


