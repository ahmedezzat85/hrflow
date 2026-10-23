import { expect } from '@playwright/test';

// Chart.js comes from a CDN. On machines without CDN access, point PW_CHARTJS_PATH at a local chart.umd.js.
export async function openPay(page, mock, { empId = 1, scenario = '' } = {}) {
  if (process.env.PW_CHARTJS_PATH) await page.route('**/chart.umd.min.js', (route) => route.fulfill({ path: process.env.PW_CHARTJS_PATH }));
  await page.clock.setFixedTime(new Date('2026-10-23T10:00:00'));
  await page.goto(`/?mock=${mock}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => window.Router && window.AnalyticsApi && typeof viewProfile === 'function');
  await page.evaluate(([s]) => {
    window.__payFixture = s;
    window.__payCalls = [];
    const orig = AnalyticsApi.getEmployeePay.bind(AnalyticsApi);
    AnalyticsApi.getEmployeePay = (id, f) => { window.__payCalls.push({ id, ...f }); return orig(id, f); };
  }, [scenario]);
  await page.evaluate((id) => { viewProfile(id); }, empId);
  await expect(page.locator('#employeePayTab')).toBeVisible();
}
export const calls = (page) => page.evaluate(() => window.__payCalls.length);
