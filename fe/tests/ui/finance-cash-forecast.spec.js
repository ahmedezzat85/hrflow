import { test, expect } from '@playwright/test';

test.describe('Story 2.3 — Finance Cash Position and Forecast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
    // Navigate to Finance Overview
    await page.click('#adminSidebar a[data-page="a-finance-dashboard"]');
    await expect(page.locator('#a-finance-dashboard')).toBeVisible();
    await expect(page.locator('#financeCashForecastCard')).toBeVisible();
    await expect(page.locator('#tableCashAccounts tbody tr').first()).toBeVisible({ timeout: 10000 });
  });

  test('Acceptance Criteria 1: Bank, book, available, and reconciled balances are never conflated in multi-account view', async ({ page }) => {
    const forecastCard = page.locator('#financeCashForecastCard');
    await expect(forecastCard).toBeVisible();

    const accountsTable = page.locator('#tableCashAccounts');
    await expect(accountsTable).toBeVisible();

    // Verify distinct table header labels
    const headers = accountsTable.locator('thead th');
    const headerTexts = await headers.allTextContents();
    const joinedHeaders = headerTexts.join(' ');

    expect(joinedHeaders).toContain('Book Balance');
    expect(joinedHeaders).toContain('Uncleared Cheques');
    expect(joinedHeaders).toContain('Pending Transfers');
    expect(joinedHeaders).toContain('Available Balance');
    expect(joinedHeaders).toContain('Reconciled Balance');

    // Verify account rows have values populated
    const rows = accountsTable.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();
    const rowText = await firstRow.textContent();
    expect(rowText).not.toContain('Loading accounts');
  });

  test('Acceptance Criteria 2: 30/60/90-Day horizon projections separate confirmed and expected items with confidence ratings', async ({ page }) => {
    // 3 horizon cards present
    const card30 = page.locator('#cardHorizon30');
    const card60 = page.locator('#cardHorizon60');
    const card90 = page.locator('#cardHorizon90');

    await expect(card30).toBeVisible();
    await expect(card60).toBeVisible();
    await expect(card90).toBeVisible();

    // Verify 30-day card has projected ending cash and split breakdown
    await expect(page.locator('#valProjectedCash30')).toBeVisible();
    const cash30 = await page.locator('#valProjectedCash30').textContent();
    expect(cash30).not.toBe('—');

    await expect(page.locator('#valInflowsSplit30')).toBeVisible();
    const split30 = await page.locator('#valInflowsSplit30').textContent();
    expect(split30).toContain('conf');
    expect(split30).toContain('exp');

    // Verify confidence badges
    await expect(page.locator('#badgeConfidence30')).toHaveText('High Confidence');

    // Toggle horizon buttons
    const btn60 = page.locator('#btnForecastHorizon60');
    await btn60.click();
    await expect(btn60).toHaveClass(/active/);

    const btn90 = page.locator('#btnForecastHorizon90');
    await btn90.click();
    await expect(btn90).toHaveClass(/active/);
  });

  test('Acceptance Criteria 3: Material obligations drill-down to sources and filter by flow type', async ({ page }) => {
    const obligationsTable = page.locator('#tableForecastObligations');
    await expect(obligationsTable).toBeVisible();

    // Verify filter buttons and initial counts
    const btnAll = page.locator('#btnObligationsFilterAll');
    const btnInflows = page.locator('#btnObligationsFilterInflows');
    const btnOutflows = page.locator('#btnObligationsFilterOutflows');

    await expect(btnAll).toBeVisible();
    await expect(btnInflows).toBeVisible();
    await expect(btnOutflows).toBeVisible();

    const countAllText = await page.locator('#countObligationsAll').textContent();
    expect(parseInt(countAllText || '0', 10)).toBeGreaterThan(0);

    // Filter to Inflows only
    await btnInflows.click();
    await expect(btnInflows).toHaveClass(/active/);
    const inflowRows = obligationsTable.locator('tbody tr');
    const inCount = await inflowRows.count();
    expect(inCount).toBeGreaterThan(0);
    for (let i = 0; i < inCount; i++) {
      const text = await inflowRows.nth(i).textContent();
      expect(text).toContain('Inflow');
    }

    // Filter to Outflows only
    await btnOutflows.click();
    await expect(btnOutflows).toHaveClass(/active/);
    const outflowRows = obligationsTable.locator('tbody tr');
    const outCount = await outflowRows.count();
    expect(outCount).toBeGreaterThan(0);
    for (let i = 0; i < outCount; i++) {
      const text = await outflowRows.nth(i).textContent();
      expect(text).toContain('Outflow');
    }

    // Return to All
    await btnAll.click();
    await expect(btnAll).toHaveClass(/active/);
  });

  test('Acceptance Criteria 4: Explicit forecast assumptions and multi-currency disclosure banner', async ({ page }) => {
    // Assumptions box
    const assumptionsBox = page.locator('#forecastAssumptionsBox');
    await expect(assumptionsBox).toBeVisible();
    await expect(assumptionsBox).toContainText('Cash Forecast Assumptions & Safeguards');
    await expect(assumptionsBox).toContainText('Draft sales invoices and unapproved vendor bills are strictly excluded');
    await expect(assumptionsBox).toContainText('never conflated');

    // Check currency switcher to ALL currencies
    await page.selectOption('#financeContextCurrency', 'all');
    await page.waitForTimeout(400);

    // Multi-currency FX warning notice should appear
    const fxWarning = page.locator('#financeForecastFxWarning');
    await expect(fxWarning).toBeVisible();
    await expect(fxWarning).toContainText('Multi-currency forecast aggregates values within native currencies');
  });
});
