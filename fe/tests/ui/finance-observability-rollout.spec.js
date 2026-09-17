import { test, expect } from '@playwright/test';

test.describe('Story 8.3: Performance, Observability, and Rollout Controls', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#admin-app')).toBeVisible({ timeout: 10000 });
  });

  test('AC 1 & AC 2: Feature flags API, safe phase toggles, and rollout status', async ({ page }) => {
    // 1. Verify feature flags retrieval via FinanceApi
    const flagsResult = await page.evaluate(async () => {
      return await window.FinanceApi.getFeatureFlags();
    });

    expect(flagsResult).toBeDefined();
    expect(flagsResult.status).toBe('success');
    expect(flagsResult.flags).toBeDefined();
    expect(flagsResult.flags.phase8_guided_payroll).toBe(true);
    expect(flagsResult.flags.mobile_priority_ui).toBe(true);
    expect(flagsResult.total_count).toBeGreaterThanOrEqual(9);

    // 2. Verify isFeatureEnabled helper
    const isPayrollEnabled = await page.evaluate(async () => {
      return await window.FinanceApi.isFeatureEnabled('phase8_guided_payroll');
    });
    expect(isPayrollEnabled).toBe(true);

    // 3. Verify updating/toggling a feature flag safely
    const updateResult = await page.evaluate(async () => {
      return await window.FinanceApi.updateFeatureFlags({ mobile_priority_ui: false });
    });
    expect(updateResult.status).toBe('success');
    expect(updateResult.flags.mobile_priority_ui).toBe(false);

    const isMobileEnabled = await page.evaluate(async () => {
      return await window.FinanceApi.isFeatureEnabled('mobile_priority_ui');
    });
    expect(isMobileEnabled).toBe(false);

    // Re-enable flag
    await page.evaluate(async () => {
      await window.FinanceApi.updateFeatureFlags({ mobile_priority_ui: true });
    });
  });

  test('AC 3: Observability metrics and correlation ID tracing', async ({ page }) => {
    // 1. Retrieve observability metrics
    const metricsResult = await page.evaluate(async () => {
      return await window.FinanceApi.getObservabilityMetrics();
    });

    expect(metricsResult).toBeDefined();
    expect(metricsResult.status).toBe('success');
    expect(typeof metricsResult.uptime_seconds).toBe('number');
    expect(typeof metricsResult.total_commands).toBe('number');
    expect(typeof metricsResult.avg_latency_ms).toBe('number');
    expect(typeof metricsResult.reconciliation_throughput_items_per_sec).toBe('number');

    // 2. Perform an action to verify correlation ID tracking
    await page.evaluate(async () => {
      await window.FinanceApi.listAccounts();
    });

    const correlationId = await page.evaluate(() => {
      if (typeof window.FinanceApi !== 'undefined' && window.FinanceApi.getLastCorrelationId) {
        return window.FinanceApi.getLastCorrelationId();
      }
      if (typeof window.Api !== 'undefined' && window.Api.getLastCorrelationId) {
        return window.Api.getLastCorrelationId();
      }
      return null;
    });

    expect(correlationId).not.toBeNull();
    expect(typeof correlationId).toBe('string');
    expect(correlationId.length).toBeGreaterThan(0);
  });
});
