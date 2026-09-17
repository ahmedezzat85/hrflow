import { test, expect } from '@playwright/test';

test.describe('Story 7.1: Standard Report Library and Shell', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Reports
    await page.click('#adminSidebar a[data-page="a-finance-reports"]');
    await expect(page.locator('#a-finance-reports')).toBeVisible({ timeout: 5000 });
  });

  test('AC 1: Report library catalog displays 6 domains, search filtering, and domain pills', async ({ page }) => {
    const dirView = page.locator('#reportLibraryDirectoryView');
    await expect(dirView).toBeVisible();

    // Verify domain pills
    const pills = page.locator('#reportLibraryCategoryPills .filter-tab');
    await expect(pills).toHaveCount(7); // All + 6 domains

    // Verify catalog cards are rendered
    const cards = page.locator('#reportLibraryGrid .report-catalog-card');
    await expect(cards).toHaveCount(17);

    // Search filter
    const searchInput = page.locator('#reportLibrarySearch');
    await searchInput.fill('Matrix');
    await expect(page.locator('#reportLibraryGrid .report-catalog-card')).toHaveCount(1);
    await expect(page.locator('#reportLibraryGrid')).toContainText('Annual Spend Matrix');

    // Clear search
    await searchInput.fill('');
    await expect(page.locator('#reportLibraryGrid .report-catalog-card')).toHaveCount(17);

    // Domain pill filter
    await page.click('#reportLibraryCategoryPills button[data-domain="Audit & Compliance"]');
    const auditCards = page.locator('#reportLibraryGrid .report-catalog-card');
    await expect(auditCards).toHaveCount(4); // Transactions + Cheques + Balance Sheet + Trial Balance
  });

  test('AC 2: Shared report shell top bar, universal filter bar, and back navigation', async ({ page }) => {
    // Reset domain filter to all
    await page.click('#reportLibraryCategoryPills button[data-domain="all"]');

    // Open "Category Spend Rollup" report
    const openBtn = page.locator('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await openBtn.click();

    // Directory view should hide, shell container should appear
    await expect(page.locator('#reportLibraryDirectoryView')).not.toBeVisible();
    const shell = page.locator('#reportShellContainer');
    await expect(shell).toBeVisible();

    // Verify Shell Top Bar
    await expect(shell.locator('#reportShellTitle')).toContainText('Category Spend Rollup');
    await expect(shell.locator('#reportShellCategoryBadge')).toContainText('Performance');
    await expect(shell.locator('#reportShellQuestion')).toContainText('Answers:');
    await expect(shell.locator('#reportShellFreshness')).toBeVisible();

    // Verify Universal Filter Bar controls
    await expect(shell.locator('#reportShellEntity')).toBeVisible();
    await expect(shell.locator('#reportShellPeriodPreset')).toBeVisible();
    await expect(shell.locator('#reportShellDateFrom')).toBeVisible();
    await expect(shell.locator('#reportShellDateTo')).toBeVisible();
    await expect(shell.locator('#reportShellBasis')).toBeVisible();
    await expect(shell.locator('#reportShellCurrency')).toBeVisible();
    await expect(shell.locator('#reportShellComparison')).toBeVisible();
    await expect(shell.locator('#reportShellSavedViews')).toBeVisible();
    await expect(shell.locator('#reportShellExportBtn')).toBeVisible();
    await expect(shell.locator('#reportShellRefreshBtn')).toBeVisible();

    // Verify Back to Library button returns to directory
    await shell.locator('#reportShellBackBtn').click();
    await expect(page.locator('#reportLibraryDirectoryView')).toBeVisible();
    await expect(shell).not.toBeVisible();
  });

  test('AC 3: Saved views creation, application, and deletion', async ({ page }) => {
    // Open Category Spend Rollup
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Change basis to accrual
    await page.selectOption('#reportShellBasis', 'accrual');
    await page.selectOption('#reportShellPeriodPreset', 'ytd');

    // Click Save View button
    await page.click('#reportShellSaveViewBtn');
    const modal = page.locator('#saveReportViewModal');
    await expect(modal).toBeVisible();

    // Enter view name and save
    await modal.locator('#saveReportViewName').fill('YTD Accrual Review');
    await modal.locator('#saveReportViewSubmitBtn').click();
    await expect(modal).not.toBeVisible();

    // Verify saved view is selected in dropdown
    const sel = page.locator('#reportShellSavedViews');
    await expect(sel).toContainText('YTD Accrual Review');

    // Delete saved view
    const delBtn = page.locator('#reportShellDeleteViewBtn');
    await expect(delBtn).toBeVisible();

    // Mock confirm dialog
    page.once('dialog', (dialog) => dialog.accept());
    await delBtn.click();
    await expect(delBtn).not.toBeVisible();
  });

  test('AC 4: Contextual drill-down modal displays contributing transactions and handles export', async ({ page }) => {
    // Open Category Spend Rollup
    await page.click('#reportLibraryGrid .report-catalog-card:has-text("Category Spend Rollup") button');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    // Click first category row in table
    const firstRow = page.locator('#reportCategorySummaryTableBody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    await firstRow.click();

    // Drilldown modal should open
    const drillModal = page.locator('#reportDrilldownModal');
    await expect(drillModal).toBeVisible();
    await expect(drillModal.locator('#reportDrilldownTitle')).toBeVisible();
    await expect(drillModal.locator('#reportDrilldownContextBadge')).toBeVisible();
    await expect(drillModal.locator('#reportDrilldownTable')).toBeVisible();
    await expect(drillModal.locator('#reportDrilldownTableBody tr').first()).toBeVisible();

    // Test CSV export button
    await drillModal.locator('#reportDrilldownExportBtn').click();

    // Close drilldown modal
    await drillModal.locator('.modal-close').click();
    await expect(drillModal).not.toBeVisible();
  });
});
