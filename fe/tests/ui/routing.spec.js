import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

async function ready(page, url = '/?mock=admin') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar, #empSidebar').first()).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && typeof showSection === 'function' && window.PayrollApp);
  await page.waitForTimeout(300);
}

const activeSection = (page) => page.evaluate(() => document.querySelector('#admin-app .page-section.active, #employee-app .page-section.active')?.id);

test.describe('U6 URLs and navigation', () => {
  test('reload keeps the same page', async ({ page }) => {
    await ready(page);
    await openAdminPage(page, 'a-finance-invoices');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/finance/sales');
    await page.reload();
    await ready(page, page.url());
    expect(await activeSection(page)).toBe('a-finance-invoices');
    await expect(page.locator('#adminPageTitle')).toHaveText('Sales & Receivables');
  });

  test('reload returns to an employee profile, a report and payroll run step 4', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => viewProfile(1));
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/hr/employee-detail/1');
    await page.reload();
    await ready(page, page.url());
    expect(await activeSection(page)).toBe('a-employee-detail');
    expect(await page.evaluate(() => String(currentDetailEmployeeId))).toBe('1');

    await page.evaluate(() => { showSection('a-finance-reports', 'admin'); });
    await page.evaluate(() => openReportFromLibrary('category-summary'));
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/finance/reports/category-summary');
    await page.reload();
    await ready(page, page.url());
    expect(await activeSection(page)).toBe('a-finance-reports');
    await expect(page.locator('#reportShellContainer')).toBeVisible();

    await page.evaluate(() => Router.navigate('a-finance-payroll-runs', 'admin'));
    await page.evaluate(async () => { PayrollApp.showPage('run'); await PayrollApp.setStep(3); });
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/payroll/payroll-runs/current/4');
    await page.reload();
    await ready(page, page.url());
    await expect(page.locator('#payrollScreen4')).toBeVisible();
  });

  test('Back and Forward move between visited pages; a copied URL opens the same page in a new tab', async ({ page, context }) => {
    await ready(page);
    await openAdminPage(page, 'a-employees');
    await openAdminPage(page, 'a-finance-bills');
    await openAdminPage(page, 'a-finance-settings');
    expect(await activeSection(page)).toBe('a-finance-settings');
    await page.goBack();
    await expect.poll(() => activeSection(page)).toBe('a-finance-bills');
    await page.goBack();
    await expect.poll(() => activeSection(page)).toBe('a-employees');
    await page.goForward();
    await expect.poll(() => activeSection(page)).toBe('a-finance-bills');

    const copied = page.url();
    const tab = await context.newPage();
    await ready(tab, copied);
    expect(await activeSection(tab)).toBe('a-finance-bills');
  });

  test('unknown or forbidden routes land on a page the user may see, with a message', async ({ page }) => {
    await ready(page, '/?mock=admin#/finance/not-a-page');
    expect(await activeSection(page)).toBe('a-dashboard');
    await expect(page.locator('#toastWrap .toast').filter({ hasText: 'not found' })).toBeVisible();

    await ready(page, '/?mock=hr#/finance/invoices');
    expect(await activeSection(page)).toBe('a-dashboard');
    await expect(page.locator('#toastWrap .toast').filter({ hasText: 'do not have access' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/hr/dashboard');
  });

  test('one navigation click runs one loader', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      window.__loads = 0;
      const orig = window.loadFinanceInvoices;
      window.loadFinanceInvoices = (...a) => { window.__loads += 1; return orig(...a); };
    });
    await openAdminPage(page, 'a-finance-invoices');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__loads)).toBe(1);
  });

  test('sidebar items carry real links', async ({ page }) => {
    await ready(page);
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('#adminSidebar .nav-item[data-page]')].map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(h).toMatch(/^#\/[a-z]+\/[a-z-]+$/);
    await ready(page, '/?mock=employee');
    const eh = await page.evaluate(() => [...document.querySelectorAll('#empSidebar .nav-item[data-page]')].map((a) => a.getAttribute('href')));
    for (const h of eh) expect(h).toMatch(/^#\/me\/[a-z-]+$/);
  });

  test('command palette lists pages, gates finance actions and hides employee search for employees', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => openCommandPalette());
    await expect(page.locator('#commandPaletteModal')).toBeVisible();
    await page.fill('#commandPaletteInput', 'invoices');
    await expect(page.locator('#commandPaletteResults')).toContainText('Sales Invoices');
    await page.locator('#commandPaletteResults .palette-item').filter({ hasText: 'Sales Invoices' }).first().click();
    expect(await activeSection(page)).toBe('a-finance-invoices');

    await ready(page, '/?mock=hr');
    await page.evaluate(() => openCommandPalette());
    await page.fill('#commandPaletteInput', 'transaction');
    await expect(page.locator('#commandPaletteResults')).not.toContainText('Record Transaction');

    await ready(page, '/?mock=employee');
    await page.evaluate(() => openCommandPalette());
    await page.fill('#commandPaletteInput', 'a');
    await expect(page.locator('#commandPaletteResults .palette-section-title')).not.toContainText('Employees');
  });
});
