import { test, expect } from '@playwright/test';

test.describe('FUX-413 — Bill PDF Extraction & Text Layer Verification', () => {
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

  test('AC 1 & 2: Readable PDF extracts invoice fields and starts unreviewed', async ({ page }) => {
    // Open Upload / Capture modal
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Verify modal initialized for capture / upload
    await expect(page.locator('#billCaptureSection')).toBeVisible();
    await expect(page.locator('#billIsReviewed')).not.toBeChecked();

    // Prepare simulated readable invoice PDF
    const invoicePdfContent = `Vendor: Amazon Web Services
Invoice Number: INV-2026-991
Date: 2026-09-10
Due Date: 2026-10-10
Total: 450.00 USD
Cloud Hosting & Compute Services 1 450.00 450.00`;

    // Upload file via file input
    await page.setInputFiles('#billFileInput', {
      name: 'aws_invoice_readable.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(invoicePdfContent, 'utf-8'),
    });

    // Check file display
    await expect(page.locator('#billFileAttachedInfo')).toBeVisible();
    await expect(page.locator('#billAttachedFileName')).toHaveText('aws_invoice_readable.pdf');

    // Confidence badge should be visible and high confidence
    const confidenceBadge = page.locator('#billExtractionConfidenceBadge');
    await expect(confidenceBadge).toBeVisible();
    await expect(confidenceBadge).toContainText('Confidence: 94%');

    // Prefilled fields
    await expect(page.locator('#billNumber')).toHaveValue('INV-2026-991');
    const selectedVendor = await page.locator('#billVendorId option:checked').textContent();
    expect(selectedVendor).toContain('Amazon Web Services');
    await expect(page.locator('#billIssueDate')).toHaveValue('2026-09-10');
    await expect(page.locator('#billDueDate')).toHaveValue('2026-10-10');
    await expect(page.locator('#billTotalDisplay')).toHaveText('450.00');

    // Ensure review checkbox is strictly unchecked
    await expect(page.locator('#billIsReviewed')).not.toBeChecked();

    // Unreadable alert must NOT be displayed
    await expect(page.locator('#billUnreadableAlert')).not.toBeVisible();

    // Close modal
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 3: Scanned / raster PDF flags unreadable alert without fabricating dummy values', async ({ page }) => {
    // Open Upload / Capture modal
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Upload an unreadable / scanned file
    await page.setInputFiles('#billFileInput', {
      name: 'scanned_paper_receipt_unreadable.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('scanned image binary bytes with no text layer', 'utf-8'),
    });

    // Unreadable banner should be displayed
    const unreadableAlert = page.locator('#billUnreadableAlert');
    await expect(unreadableAlert).toBeVisible();
    await expect(unreadableAlert).toContainText('Unreadable Document — Manual Entry Required');

    // Confidence badge should reflect unreadable / 0%
    const confidenceBadge = page.locator('#billExtractionConfidenceBadge');
    await expect(confidenceBadge).toBeVisible();
    await expect(confidenceBadge).toContainText('Unreadable (0%)');

    // Crucial safeguard: Bill number must NOT have been fabricated with fake INV-OCR-XXXX
    const billNumberVal = await page.locator('#billNumber').inputValue();
    expect(billNumberVal).not.toContain('INV-OCR-');
    expect(billNumberVal).toBe('');

    // Review checkbox remains unchecked
    await expect(page.locator('#billIsReviewed')).not.toBeChecked();

    // Close modal
    await page.click('#billModal .modal-close');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 4: Extracted bill cannot move to ready_to_pay without explicit human review checkbox', async ({ page }) => {
    // Open Upload / Capture modal
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Upload readable file
    await page.setInputFiles('#billFileInput', {
      name: 'invoice_review_check.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Vendor: Amazon Web Services\nInvoice Number: INV-2026-999\nDate: 2026-09-12\nDue Date: 2026-10-12\nTotal: 250.00 USD\nCloud Server 1 250.00 250.00', 'utf-8'),
    });

    await expect(page.locator('#billExtractionConfidenceBadge')).toBeVisible();
    await expect(page.locator('#billIsReviewed')).not.toBeChecked();

    // Try setting status to ready_to_pay
    await page.selectOption('#billStatus', 'ready_to_pay');
    await page.click('#billModalSaveBtn');

    // Modal must NOT close because is_reviewed is still unchecked!
    await expect(page.locator('#billModal')).toBeVisible();

    // Fill missing required coding
    await page.selectOption('#billDepartment', 'Engineering');
    await page.selectOption('#billCategoryId', { label: 'Infrastructure' });

    // Now explicitly check the human review checkbox
    await page.check('#billIsReviewed');
    await page.click('#billModalSaveBtn');

    // Modal closes upon verified save
    await expect(page.locator('#billModal')).not.toBeVisible();
  });
});
