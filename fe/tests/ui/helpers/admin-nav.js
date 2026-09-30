/**
 * Navigation test helpers for HRFlow Admin Portal.
 *
 * In Slice 1+: Coordinates module rail switching and contextual panel navigation.
 */

const childToParentMap = {
  'a-finance-invoices': { parent: 'a-finance-sales', tabId: '#tabFinanceInvoices' },
  'a-finance-bills': { parent: 'a-finance-spend', tabId: '#tabFinanceBills' },
  'a-finance-subscriptions': { parent: 'a-finance-spend', tabId: '#tabFinanceSubscriptions' },
  'a-finance-statutory': { parent: 'a-finance-spend', tabId: '#tabFinanceStatutory' },
  'a-finance-accounts': { parent: 'a-finance-banking', tabId: '#subtabFinanceAccounts' },
  'a-finance-payroll': { directPage: 'a-finance-payroll-runs' },
};

/**
 * Open or switch to an admin module (HR, Finance, Payroll) by clicking its rail button.
 * @param {import('@playwright/test').Page} page
 * @param {string} moduleId
 */
export async function openAdminModule(page, moduleId) {
  const railBtn = page.locator(`#adminSidebar .rail-btn[data-module="${moduleId}"]`);
  if (await railBtn.isVisible().catch(() => false)) {
    const isCur = await railBtn.evaluate(el => el.classList.contains('active') || el.classList.contains('on')).catch(() => false);
    if (!isCur) {
      await railBtn.click();
      await page.waitForTimeout(50);
    }
  }
}

/**
 * Navigate to an admin page by its data-page ID, switching modules first if needed.
 * @param {import('@playwright/test').Page} page
 * @param {string} pageId
 */
export async function openAdminPage(page, pageId) {
  const mapping = childToParentMap[pageId];
  if (mapping) {
    if (mapping.directPage) {
      await openAdminPage(page, mapping.directPage);
      return;
    }
    await openAdminPage(page, mapping.parent);
    if (mapping.tabId) {
      const tab = page.locator(mapping.tabId);
      if (await tab.isVisible().catch(() => false)) {
        const isSelected = await tab.evaluate(el => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true').catch(() => false);
        if (!isSelected) {
          await tab.click();
        }
      }
    }
    return;
  }

  const targetItem = page.locator(`#adminSidebar a[data-page="${pageId}"]`);
  const isVisible = await targetItem.isVisible().catch(() => false);

  if (!isVisible) {
    const mod = await page.evaluate((pid) => {
      if (window.AdminNav && typeof window.AdminNav.moduleOf === 'function') {
        return window.AdminNav.moduleOf(pid);
      }
      return pid && pid.startsWith('a-finance-') ? 'finance' : 'hr';
    }, pageId);

    if (mod) {
      await openAdminModule(page, mod);
    }
  }

  await targetItem.click();
}
