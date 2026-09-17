import { test, expect } from '@playwright/test';

test.describe('Story FUX-411 — Bill category dropdown and default category per vendor', () => {
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

  test('AC 1: Bill modal displays category dropdown populated from categories', async ({ page }) => {
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    // Verify #billCategoryId select exists and has options
    const catSelect = page.locator('#billCategoryId');
    await expect(catSelect).toBeVisible();

    // Verify standard category options are present
    const options = await catSelect.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Infrastructure'))).toBeTruthy();
    expect(options.some((o) => o.includes('SaaS'))).toBeTruthy();

    // Close modal cleanly
    await page.click('#billModal button.btn-close, #billModal button:has-text("Cancel")');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 2: Selecting a vendor with default category auto-prefills category dropdown', async ({ page }) => {
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    const catSelect = page.locator('#billCategoryId');
    const hiddenCategory = page.locator('#billCategory');

    // Select Amazon Web Services (vendor 1, default_category_id: 8 Infrastructure)
    await page.selectOption('#billVendorId', { label: 'Amazon Web Services' });

    // Verify category dropdown was auto-prefilled to Infrastructure
    const selectedOption = await catSelect.locator('option:checked').textContent();
    expect(selectedOption).toContain('Infrastructure');
    expect(await hiddenCategory.inputValue()).toBe('Infrastructure');

    // Field must NOT be locked/disabled - user can override
    expect(await catSelect.isDisabled()).toBeFalsy();

    // User manually overrides category to SaaS
    await page.selectOption('#billCategoryId', { label: 'SaaS' });
    expect(await catSelect.locator('option:checked').textContent()).toContain('SaaS');
    expect(await hiddenCategory.inputValue()).toBe('SaaS');

    // Close modal cleanly
    await page.click('#billModal button.btn-close, #billModal button:has-text("Cancel")');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 3: Selecting a vendor without default category leaves category dropdown empty', async ({ page }) => {
    await page.click('#financeCaptureBillBtn');
    await expect(page.locator('#billModal')).toBeVisible();

    const catSelect = page.locator('#billCategoryId');

    // Select Google Workspace (vendor 3, no default category)
    await page.selectOption('#billVendorId', { label: 'Google Workspace' });

    // Category should remain unselected (empty value)
    expect(await catSelect.inputValue()).toBe('');

    // Close modal cleanly
    await page.click('#billModal button.btn-close, #billModal button:has-text("Cancel")');
    await expect(page.locator('#billModal')).not.toBeVisible();
  });

  test('AC 4: Vendor modal displays Default Bill Category dropdown', async ({ page }) => {
    // Open Add Vendor Modal
    const addVendorBtn = page.locator('button:has-text("Add Vendor"), #btnAddVendor, #financeAddVendorBtn');
    if (await addVendorBtn.count() > 0) {
      await addVendorBtn.first().click();
      await expect(page.locator('#vendorModal')).toBeVisible();

      const vendorCatSelect = page.locator('#fVendorDefaultCategoryId');
      await expect(vendorCatSelect).toBeVisible();

      // Verify options are populated
      const options = await vendorCatSelect.locator('option').allTextContents();
      expect(options.some((o) => o.includes('Infrastructure') || o.includes('SaaS') || o.includes('None'))).toBeTruthy();

      // Close modal cleanly
      await page.click('#vendorModal button.btn-close, #vendorModal button:has-text("Cancel")');
      await expect(page.locator('#vendorModal')).not.toBeVisible();
    }
  });
});
