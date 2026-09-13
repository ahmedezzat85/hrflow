import { test, expect } from '@playwright/test';

test.describe('HRFlow Frontend Sanity Checks', () => {
  test('Loads admin mock app and shows core navigation', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page).toHaveTitle(/HRFlow/);
    
    // Check sidebar navigation elements
    const sidebar = page.locator('#adminSidebar');
    await expect(sidebar).toBeVisible();
  });
});
