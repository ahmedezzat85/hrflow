import { test, expect } from '@playwright/test';

// Money-moving requests carry an Idempotency-Key (audit 2026-11, M-4). A repeat of the same request within 30 seconds
// (double submit, retry) reuses the key so the server posts once; a different request gets its own key.
test.describe('Idempotency keys for money-moving requests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  });

  test('the same request reuses its key, a different request does not', async ({ page }) => {
    const keys = await page.evaluate(() => {
      const path = '/api/finance/accounts/7/transactions';
      const body = { date: '2026-10-05', amount: 42, direction: 'out' };
      const a = window._intentHeaders(path, body)['Idempotency-Key'];
      const b = window._intentHeaders(path, { ...body })['Idempotency-Key'];
      const c = window._intentHeaders(path, { ...body, amount: 43 })['Idempotency-Key'];
      const d = window._intentHeaders('/api/finance/accounts/8/transactions', body)['Idempotency-Key'];
      return { a, b, c, d };
    });
    expect(keys.a).toBeTruthy();
    expect(keys.b).toBe(keys.a);
    expect(keys.c).not.toBe(keys.a);
    expect(keys.d).not.toBe(keys.a);
  });

  test('a key expires after 30 seconds so a deliberate repeat is a new request', async ({ page }) => {
    const [first, later] = await page.evaluate(() => {
      const realNow = Date.now;
      const path = '/api/finance/revenue-receipts';
      const body = { amount: 300 };
      const k1 = window._intentHeaders(path, body)['Idempotency-Key'];
      Date.now = () => realNow() + 31000;
      try {
        return [k1, window._intentHeaders(path, body)['Idempotency-Key']];
      } finally {
        Date.now = realNow;
      }
    });
    expect(later).not.toBe(first);
  });
});
