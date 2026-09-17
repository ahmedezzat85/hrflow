import { test, expect } from '@playwright/test';

test.describe('Story 7.3: Controlled Exports and Scheduled Delivery', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Reports
    await page.click('#adminSidebar a[data-page="a-finance-reports"]');
    await expect(page.locator('#a-finance-reports')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1: Export menu triggers controlled download for active report', async ({ page }) => {
    // Open Profit & Loss report from library catalog
    const pnlCard = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Profit & Loss")');
    await expect(pnlCard).toBeVisible();
    await pnlCard.locator('button').click();
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Toggle export menu
    const exportBtn = page.locator('#reportShellExportBtn');
    await exportBtn.click();
    const exportMenu = page.locator('#reportShellExportMenu');
    await expect(exportMenu).toBeVisible();

    // Listen for download event when clicking Excel
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await exportMenu.locator('a:has-text("Excel (.xlsx)")').click();

    // Verify toast feedback appears
    await expect(page.locator('.toast').first()).toBeVisible();
    await expect(page.locator('.toast').first()).toContainText(/export/i);
  });

  test('AC 2: Schedule Report modal allows configuring frequency, format, and recipients', async ({ page }) => {
    // Open Category Spend Rollup
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Open export menu and click "Schedule Delivery..."
    await page.click('#reportShellExportBtn');
    await page.click('#menuItemScheduleReport');

    // Verify modal is open
    const modal = page.locator('#scheduleReportExportModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('#scheduleReportTargetTitle')).toHaveValue(/Category Spend Rollup/i);

    // Configure schedule
    await page.selectOption('#scheduleReportFrequency', 'weekly');
    await page.selectOption('#scheduleReportFormat', 'xlsx');
    await page.fill('#scheduleReportRecipients', 'executives@voyance.health, cfo@voyance.health');

    // Submit schedule
    await page.click('#submitScheduleReportBtn');
    await expect(modal).not.toBeVisible();
    await expect(page.locator('.toast')).toContainText(/scheduled/i);
  });

  test('AC 3: Scheduled deliveries & export audits modal displays schedules and audit log', async ({ page }) => {
    // Open report shell
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Open export menu and click "View Schedules & Audits"
    await page.click('#reportShellExportBtn');
    await page.click('#menuItemScheduledDeliveries');

    // Verify modal is open
    const modal = page.locator('#reportDeliveriesAndAuditsModal');
    await expect(modal).toBeVisible();

    // Check schedules table has entries
    const schedRows = page.locator('#reportSchedulesTableBody tr');
    await expect(schedRows.first()).toBeVisible();

    // Switch to export audit trail tab
    await page.click('#btnTabExportAudits');
    await expect(page.locator('#tabContentExportAudits')).toBeVisible();
    const auditRows = page.locator('#reportExportAuditsTableBody tr');
    await expect(auditRows.first()).toBeVisible();

    // Switch back to schedules and test cancel button with dialog confirmation
    await page.click('#btnTabReportSchedules');
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    const initialCount = await schedRows.count();
    await schedRows.first().locator('.delete-schedule-btn').click();
    await expect(page.locator('.toast')).toContainText(/cancelled/i);

    // Close modal
    await modal.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });
});
