import { test, expect } from '@playwright/test';
import { openAdminPage } from './helpers/admin-nav.js';

test.describe('Employee Directory Table Layout & Action Columns', () => {
  test('Action buttons in employee table render horizontally and row height is compact', async ({ page }) => {
    await page.goto('/?mock=admin');
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });

    await openAdminPage(page, 'a-employees');
    await expect(page.locator('#a-employees')).toBeVisible();

    const firstRow = page.locator('#employeesTableBody tr').first();
    await expect(firstRow).toBeVisible();

    // Check row height: should be compact (<= 65px), not bloated/spacious (~150px)
    const rowBox = await firstRow.boundingBox();
    expect(rowBox).not.toBeNull();
    console.log('Current employee row height:', rowBox.height);
    expect(rowBox.height).toBeLessThanOrEqual(65);

    // Check that all 4 action buttons inside td.col-actions are on the same horizontal line
    const actionButtons = firstRow.locator('td.col-actions .icon-action');
    const count = await actionButtons.count();
    expect(count).toBe(4);

    const buttonBoxes = [];
    for (let i = 0; i < count; i++) {
      const box = await actionButtons.nth(i).boundingBox();
      buttonBoxes.push(box);
    }

    console.log('Button boxes Y coordinates:', buttonBoxes.map(b => b.y));

    // In a horizontal layout, all button Y coordinates should be identical (within 2px)
    for (let i = 1; i < count; i++) {
      expect(Math.abs(buttonBoxes[i].y - buttonBoxes[0].y)).toBeLessThanOrEqual(2);
    }

    // In a horizontal layout, X coordinates must be strictly increasing
    for (let i = 1; i < count; i++) {
      expect(buttonBoxes[i].x).toBeGreaterThan(buttonBoxes[i - 1].x);
    }

    // td.col-actions width should accommodate all buttons horizontally (>= 130px), not 44px
    const actionsColBox = await firstRow.locator('td.col-actions').boundingBox();
    console.log('Actions column width:', actionsColBox.width);
    expect(actionsColBox.width).toBeGreaterThanOrEqual(130);
  });
});
