import { test, expect } from '@playwright/test';

async function navigateMobile(page, pageId) {
  // On mobile viewports (<900px), click admin hamburger menu to reveal sidebar
  await page.click('#admin-app .hamburger');
  await expect(page.locator('#adminSidebar')).toHaveClass(/open/);
  await page.click(`#adminSidebar a[data-page="${pageId}"]`);
}

test.describe('Story 8.2: Mobile Priority Workflows', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12/13/14 mobile viewport

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#admin-app .hamburger')).toBeVisible({ timeout: 10000 });
  });

  test('AC 1 & AC 2: Mobile dashboard layout has zero horizontal overflow, usable touch targets, and mobile camera receipt capture', async ({ page }) => {
    // 1. Navigate to Finance Dashboard
    await navigateMobile(page, 'a-finance-dashboard');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Verify dashboard fits within mobile viewport without horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // 2. Verify touch targets meet minimum usable size on mobile
    const refreshBtn = page.locator('#btnRefreshFinanceDashboard');
    await expect(refreshBtn).toBeVisible();
    const btnBox = await refreshBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    if (btnBox) {
      expect(btnBox.height).toBeGreaterThanOrEqual(36);
    }

    // 3. Navigate to Vendor Bills section using mobile hamburger menu
    await navigateMobile(page, 'a-finance-bills');
    await expect(page.locator('#a-finance-bills')).toBeVisible();

    // Verify bills page has no horizontal overflow
    const billsHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(billsHorizontalScroll).toBe(false);

    // 4. Open Bill Upload / Capture modal
    await page.click('#financeCaptureBillBtn');
    const billModal = page.locator('#billModal');
    await expect(billModal).toBeVisible();

    // Verify mobile-responsive full-width dialog
    const modalBox = await billModal.locator('.modal').boundingBox();
    expect(modalBox).not.toBeNull();
    if (modalBox) {
      expect(modalBox.width).toBeGreaterThanOrEqual(360);
    }

    // 5. Verify camera capture button and environment capture input exist
    const cameraBtn = billModal.locator('#btnMobileCameraCapture');
    await expect(cameraBtn).toBeVisible();
    await expect(cameraBtn).toContainText('Take Photo / Scan Receipt');

    const cameraInput = billModal.locator('#billCameraInput');
    await expect(cameraInput).toHaveAttribute('capture', 'environment');
    await expect(cameraInput).toHaveAttribute('accept', 'image/*');

    // Close modal
    await billModal.locator('.modal-close').click();
    await expect(billModal).not.toBeVisible();
  });

  test('AC 3 & AC 4: Complex desktop-first tasks show clear advisory banners, and sensitive data is masked in mobile cards', async ({ page }) => {
    // 1. Navigate to Accounts workspace -> Statements & Reconciliation subtab
    await navigateMobile(page, 'a-finance-accounts');
    await expect(page.locator('#a-finance-accounts')).toBeVisible();

    await page.click('#subtabFinanceStatements');
    await expect(page.locator('#financeSubPaneStatements')).toBeVisible();

    // 2. Verify clear desktop recommendation banner is displayed for mobile users
    const advisory = page.locator('#reconciliationMobileAdvisory');
    await expect(advisory).toBeVisible();
    await expect(advisory).toContainText('Desktop Recommended for Bank Reconciliation');

    // 3. Switch to Bank Accounts subtab and check masked account identifiers
    await page.click('#subtabFinanceAccounts');
    await expect(page.locator('#financeSubPaneAccounts')).toBeVisible();

    // Account rows should render with masked identifiers (e.g. ******4821 or ••••4821)
    const tableBody = page.locator('#financeAccountsTableBody');
    await expect(tableBody).toBeVisible();
    const cellText = await tableBody.innerText();
    expect(cellText).toMatch(/••••|\.\.\.\.|\*{4,}/);

    // 4. Navigate to Reports -> Open a report to verify multi-column matrix advisory
    await navigateMobile(page, 'a-finance-reports');
    await expect(page.locator('#a-finance-reports')).toBeVisible();

    // Click Open Report on first card in library
    const openReportBtn = page.locator('#reportLibraryGrid .card button').first();
    await expect(openReportBtn).toBeVisible();
    await openReportBtn.click();

    // Report shell should be visible with wide layout advisory note
    const reportShell = page.locator('#reportShellContainer');
    await expect(reportShell).toBeVisible();
    const reportAdvisory = page.locator('#reportMatrixMobileAdvisory');
    await expect(reportAdvisory).toBeVisible();
    await expect(reportAdvisory).toContainText('Wide Layout Note');
  });
});
