import { test, expect } from '@playwright/test';

test.describe('Story 0.1 — Verified Finance Loading, Error, and Stale States', () => {

  test('Acceptance Criteria 1: No believable monetary value appears before successful response', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Delay the API call so we can assert the loading skeleton state in the DOM
    await page.evaluate(() => {
      window._summaryDelayedResolve = null;
      window.FinanceApi.getFinanceSummary = () => {
        return new Promise((resolve) => {
          window._summaryDelayedResolve = () => resolve({
            balance: 245000.0,
            revenue_mtd: 48200.0,
            cost_mtd: 31400.0,
            net_mtd: 16800.0,
            currency: 'USD',
            base_currency: 'USD',
            period: 'MTD',
            data_scope: 'all_accounts',
            generated_at: new Date().toISOString(),
          });
        });
      };
    });

    // Navigate to Finance Overview (triggers loadFinanceDashboard)
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Verify stat values show skeletons with em-dash and no believable monetary values
    const balanceEl = page.locator('#statFinanceBalance');
    const revenueEl = page.locator('#statFinanceRevenue');
    const costEl = page.locator('#statFinanceCost');
    const netEl = page.locator('#statFinanceNet');

    await expect(balanceEl).toBeVisible();
    await expect(balanceEl.locator('.finance-skeleton')).toBeVisible();
    await expect(balanceEl).toContainText('—');
    await expect(balanceEl).not.toContainText('$245,000');

    await expect(revenueEl.locator('.finance-skeleton')).toBeVisible();
    await expect(revenueEl).toContainText('—');
    await expect(revenueEl).not.toContainText('$48,200');

    await expect(costEl.locator('.finance-skeleton')).toBeVisible();
    await expect(costEl).toContainText('—');
    await expect(costEl).not.toContainText('$31,400');

    await expect(netEl.locator('.finance-skeleton')).toBeVisible();
    await expect(netEl).toContainText('—');
    await expect(netEl).not.toContainText('$16,800');

    // Now resolve the promise and verify real data cleanly replaces skeletons
    await page.evaluate(() => {
      if (typeof window._summaryDelayedResolve === 'function') {
        window._summaryDelayedResolve();
      }
    });

    await expect(balanceEl).toContainText('$245,000.00');
    await expect(balanceEl.locator('.finance-skeleton')).not.toBeVisible();
  });

  test('Acceptance Criteria 2: Dashboard KPIs show currency, period, scope, and last updated context', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Overview
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Verify successful KPI population
    const balanceEl = page.locator('#statFinanceBalance');
    await expect(balanceEl).toBeVisible();
    await expect(balanceEl).toContainText('$');

    // Context badges
    const currencyBadge = page.locator('#financeDashboardCurrencyBadge');
    await expect(currencyBadge).toBeVisible();
    await expect(currencyBadge).toContainText('USD');

    const periodBadge = page.locator('#financeDashboardPeriodBadge');
    await expect(periodBadge).toBeVisible();
    await expect(periodBadge).toContainText('MTD');

    const scopeBadge = page.locator('#financeDashboardScopeBadge');
    await expect(scopeBadge).toBeVisible();
    await expect(scopeBadge).toContainText('All Accounts');

    const lastUpdated = page.locator('#financeDashboardLastUpdated');
    await expect(lastUpdated).toBeVisible();
    await expect(lastUpdated).toContainText(/Last updated: \d{1,2}:\d{2}/);

    // Unimplemented chart card has clear unavailable indication, no roadmap copy
    const activityCard = page.locator('#a-finance-dashboard .card:has(#financeDashboardSummaryEmpty)');
    await expect(activityCard).toBeVisible();
    await expect(activityCard).toContainText('Visualizations in development');
    await expect(activityCard).not.toContainText('Phase 6');
  });

  test('Acceptance Criteria 3 & 4: Failed request shows inline error, retry action recovers without reload', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Force error response on initial load
    await page.evaluate(() => {
      window._mockFailSummary = true;
      window.FinanceApi.getFinanceSummary = async () => {
        if (window._mockFailSummary) {
          throw new Error('Internal ledger service timeout');
        }
        return {
          balance: 245000.0,
          revenue_mtd: 48200.0,
          cost_mtd: 31400.0,
          net_mtd: 16800.0,
          currency: 'USD',
          base_currency: 'USD',
          period: 'MTD',
          data_scope: 'all_accounts',
          generated_at: new Date().toISOString(),
        };
      };
    });

    // Navigate to Finance Overview
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();

    // Verify inline error banner is visible with specific message
    const errorBanner = page.locator('#financeDashboardErrorState');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Internal ledger service timeout');

    // Retained page context: stats grid still present with non-believable placeholders
    await expect(page.locator('#a-finance-dashboard .grid.g4')).toBeVisible();
    await expect(page.locator('#statFinanceBalance')).toContainText('—');

    // Now disable failure for retry
    await page.evaluate(() => {
      window._mockFailSummary = false;
    });

    const retryBtn = page.locator('#financeDashboardRetryBtn');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Error banner should disappear and real data should appear without page reload
    await expect(errorBanner).not.toBeVisible();
    await expect(page.locator('#statFinanceBalance')).toContainText('$245,000.00');
    await expect(page.locator('#financeDashboardLastUpdated')).toContainText(/Last updated:/);
  });

  test('Acceptance Criteria 5: Stale data remains visible with clear stale label and timestamp', async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });

    // Navigate to Finance Overview with normal successful response
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#statFinanceBalance')).toContainText('$245,000.00');

    // Stale badge should initially be hidden
    const staleBadge = page.locator('#financeDashboardStaleBadge');
    await expect(staleBadge).not.toBeVisible();

    // Now configure next call to fail
    await page.evaluate(() => {
      window.FinanceApi.getFinanceSummary = async () => {
        throw new Error('Service temporarily unavailable');
      };
    });

    // Trigger refresh (which will fail)
    await page.click('#btnRefreshFinanceDashboard');

    // Previous data should be retained (not cleared)
    await expect(page.locator('#statFinanceBalance')).toContainText('$245,000.00');
    await expect(page.locator('#statFinanceRevenue')).toContainText('$48,200.00');

    // Stale badge should now be visible
    await expect(staleBadge).toBeVisible();
    await expect(staleBadge).toContainText('Stale Data');

    // Inline error banner shows with message and retry option
    const errorBanner = page.locator('#financeDashboardErrorState');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Service temporarily unavailable');
  });

});
