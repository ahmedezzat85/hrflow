import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('X3: Product catalog (D-030)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('Settings > Products: list, add, duplicate code refused, deactivate', async ({ page }) => {
    await openAdminPage(page, 'a-finance-settings');
    await page.click('#subtabSettingsProducts');
    await expect(page.locator('#financeSettingsPaneProducts')).toBeVisible();
    const body = page.locator('#financeProductsTableBody');
    await expect(body.locator('tr')).toHaveCount(3);
    await expect(body).toContainText('HRFlow Cloud (SaaS)');

    // Add
    await page.click('#financeAddProductBtn');
    await expect(page.locator('#financeProductModal')).toBeVisible();
    await page.fill('#fFinanceProductName', 'Premium Support');
    await page.fill('#fFinanceProductCode', 'sup-prem');
    await page.selectOption('#fFinanceProductType', 'support');
    await page.fill('#fFinanceProductPrice', '300');
    // Only same-currency accounts are offered
    const optionTexts = await page.locator('#fFinanceProductAccount option').allTextContents();
    expect(optionTexts.filter((t) => t.includes('(EGP)')).length).toBe(0);
    await page.click('#financeProductSaveBtn');
    await expect(page.locator('#financeProductModal')).not.toBeVisible();
    await expect(body.locator('tr:has-text("SUP-PREM")')).toBeVisible();

    // Duplicate code is refused and the dialog stays open
    await page.click('#financeAddProductBtn');
    await page.fill('#fFinanceProductName', 'Other');
    await page.fill('#fFinanceProductCode', 'SAAS-CLOUD');
    await page.click('#financeProductSaveBtn');
    await expect(page.locator('#financeProductModal')).toBeVisible();
    await page.click('#financeProductModal button:has-text("Cancel")');
    await expect(page.locator('#financeProductModal')).not.toBeVisible();

    // Deactivate
    await body.locator('tr:has-text("SUP-PREM") .btn-product-toggle').click();
    await page.click('button:has-text("Deactivate Product")');
    await page.click('#financeProductStatusPills [data-filter="inactive"]');
    await expect(body.locator('tr:has-text("SUP-PREM")')).toBeVisible();
  });

  test('Invoice line product picker prefills a draft', async ({ page }) => {
    await openAdminPage(page, 'a-finance-invoices');
    await expect(page.locator('#financeInvoicesTableBody tr').first()).toBeVisible({ timeout: 10000 });
    await page.click('#financeNewInvoiceBtn');
    await expect(page.locator('#invoiceModal')).toBeVisible();

    const row = page.locator('#invoiceLinesBody tr').first();
    const picker = row.locator('.inv-product');
    // Inactive products are not offered on a new line
    await expect(picker.locator('option', { hasText: 'Legacy On-prem Licence' })).toHaveCount(0);
    await picker.selectOption({ label: 'HRFlow Cloud (SaaS)' });
    await expect(row.locator("input[type='text']")).toHaveValue('HRFlow Cloud (SaaS)');
    await expect(row.locator('.inv-price')).toHaveValue('1200');
    await expect(row.locator('.inv-total')).toHaveValue('1200.00');
    await page.click('#invoiceModal .modal-close');
    await expect(page.locator('#invoiceModal')).not.toBeVisible();
  });
});
