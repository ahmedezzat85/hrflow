import { test, expect } from '@playwright/test';

test.describe('FUX-407 — Bill document storage and repository view', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    // Navigate to Vendor Bills section
    await page.click('#adminSidebar a[data-page="a-finance-bills"]');
    await expect(page.locator('#a-finance-bills')).toBeVisible();
    await expect(page.locator('#financeBillsContainer')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('1. Bill list displays paperclip attachment action only when attachment exists, and clicking it opens preview modal', async ({ page }) => {
    // In mock state: BILL-2026-003 and BILL-2026-006 have attachments
    const billWithAttRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    await expect(billWithAttRow).toBeVisible();

    const paperclipBtn = billWithAttRow.locator('.btn-bill-attachment');
    await expect(paperclipBtn).toBeVisible();

    // Bill without attachment (BILL-2026-001) should NOT have paperclip button
    const billWithoutAttRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")');
    await expect(billWithoutAttRow).toBeVisible();
    await expect(billWithoutAttRow.locator('.btn-bill-attachment')).toHaveCount(0);

    // Click paperclip button on BILL-2026-003
    await paperclipBtn.click();

    // Verify document preview modal opens
    const previewModal = page.locator('#documentPreviewModal');
    await expect(previewModal).toBeVisible();
    await expect(page.locator('#docPreviewTitle')).toContainText('aws_september_invoice.pdf');
    await expect(page.locator('#docPreviewContainer')).toBeVisible();
    await expect(page.locator('#docPreviewDownloadBtn')).toBeVisible();

    // Close preview modal
    await page.click('#documentPreviewModal button:has-text("Close")');
    await expect(previewModal).not.toBeVisible();
  });

  test('2. Detail drawer shows working Preview and Download buttons on the Attachments panel', async ({ page }) => {
    // Open detail drawer for BILL-2026-003
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    await billRow.locator('.btn-view-bill').click();

    await expect(page.locator('#financeDetailDrawerOverlay')).toBeVisible();
    await expect(page.locator('#financeDetailDrawerTitle')).toContainText('BILL-2026-003');

    // Switch to Attachments tab
    await page.click('#financeDrawerTablist button[data-drawer-tab="attachments"]');
    await expect(page.locator('#financeDrawerAttachmentsPanel')).toBeVisible();

    // Verify attachment card is present with Preview and Download buttons
    const attachCard = page.locator('#financeDrawerAttachmentsList .related-record-card');
    await expect(attachCard).toBeVisible();
    await expect(attachCard).toContainText('aws_september_invoice.pdf');

    const previewBtn = attachCard.locator('.btn-drawer-preview-attachment');
    const downloadBtn = attachCard.locator('.btn-drawer-download-attachment');
    await expect(previewBtn).toBeVisible();
    await expect(downloadBtn).toBeVisible();

    // Click Preview in drawer
    await previewBtn.click();
    await expect(page.locator('#documentPreviewModal')).toBeVisible();
    await expect(page.locator('#docPreviewTitle')).toContainText('aws_september_invoice.pdf');

    // Close preview modal
    await page.click('#documentPreviewModal button:has-text("Close")');
    await expect(page.locator('#documentPreviewModal')).not.toBeVisible();

    // Close drawer
    await page.click('#financeDetailDrawerCloseBtn');
    await expect(page.locator('#financeDetailDrawerOverlay')).not.toBeVisible();
  });

  test('3. Edit bill modal provides preview, download, and remove buttons for existing attachment', async ({ page }) => {
    // Open edit modal for BILL-2026-003
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    await billRow.locator('button[title="Edit Bill"]').click();

    await expect(page.locator('#billModal')).toBeVisible();
    await expect(page.locator('#billFileAttachedInfo')).toBeVisible();
    await expect(page.locator('#billAttachedFileName')).toContainText('aws_september_invoice.pdf');

    const modalPreviewBtn = page.locator('#billAttachedFilePreviewBtn');
    const modalDownloadBtn = page.locator('#billAttachedFileDownloadBtn');
    const modalRemoveBtn = page.locator('#billAttachedFileRemoveBtn');

    await expect(modalPreviewBtn).toBeVisible();
    await expect(modalDownloadBtn).toBeVisible();
    await expect(modalRemoveBtn).toBeVisible();

    // Click Preview inside edit modal
    await modalPreviewBtn.click();
    await expect(page.locator('#documentPreviewModal')).toBeVisible();
    await expect(page.locator('#docPreviewTitle')).toContainText('aws_september_invoice.pdf');

    // Close preview modal
    await page.click('#documentPreviewModal button:has-text("Close")');
    await expect(page.locator('#documentPreviewModal')).not.toBeVisible();

    // Close bill modal
    await page.click('#billModal button:has-text("Cancel")');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('4. Repository toolbar filter "Has Attachment" / "No Attachment" toggles table rows correctly', async ({ page }) => {
    const toggleBtn = page.locator('#financeBillFilterToggleBtn');
    if (await toggleBtn.isVisible()) {
      if (await toggleBtn.getAttribute('aria-expanded') !== 'true') {
        await toggleBtn.click();
      }
    }
    const filterSelect = page.locator('#financeBillAttachmentFilter');
    await expect(filterSelect).toBeVisible();

    // Filter by "Has Attachment"
    await filterSelect.selectOption('with_attachment');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-006")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toHaveCount(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toHaveCount(0);

    // Filter by "No Attachment"
    await filterSelect.selectOption('no_attachment');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toHaveCount(0);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-006")')).toHaveCount(0);

    // Reset to "All Documents"
    await filterSelect.selectOption('');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toBeVisible();
  });

  test('5. Plain search matches vendor, bill number, and category without switching queue tabs', async ({ page }) => {
    const searchInput = page.locator('#financeBillSearch');

    // Search by bill number substring
    await searchInput.fill('003');
    await expect(page.locator('#financeBillsTableBody tr')).toHaveCount(1);
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")')).toBeVisible();

    // Search by vendor name
    await searchInput.fill('Slack');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-002")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-004")')).toBeVisible();
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toHaveCount(0);

    // Clear search
    await searchInput.fill('');
    await expect(page.locator('#financeBillsTableBody tr:has-text("BILL-2026-001")')).toBeVisible();
  });
});
