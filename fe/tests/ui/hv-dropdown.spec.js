import { test, expect } from '@playwright/test';

// Themed dropdown (dropdown.js): the Users filters and the Add Employee modal selects are enhanced,
// the real <select> stays in sync, and the popup and Active pill follow the theme.

async function openUsers(page, theme = 'light') {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.click('#systemRailBtn');
  await page.click('#systemNavUsers');
  await expect(page.locator('#a-system-users')).toBeVisible();
  await expect(page.locator('#systemUsersTableBody tr')).toHaveCount(6);
}

const trigger = (page, id) => page.locator(`.hv-dd:has(#${id}) .hv-dd__btn`);

test('click selects an option, updates the label and fires change on the real select', async ({ page }) => {
  await openUsers(page);
  const btn = trigger(page, 'systemUsersRoleFilter');
  await expect(btn).toContainText('All Roles');
  await btn.click();
  const list = page.locator('.hv-dd__list');
  await expect(list).toBeVisible();
  await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveText('All Roles');
  await list.locator('[role="option"]', { hasText: 'Payroll-Maker' }).click();
  await expect(list).toHaveCount(0);
  await expect(btn).toContainText('Payroll-Maker');
  await expect(page.locator('#systemUsersRoleFilter')).toHaveValue('Payroll-Maker');
  await expect(page.locator('#systemUsersTableBody tr')).toHaveCount(1);
});

test('keyboard opens, moves, selects and Escape closes without losing focus', async ({ page }) => {
  await openUsers(page);
  const btn = trigger(page, 'systemUsersFilter');
  await btn.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.hv-dd__list')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hv-dd__list')).toHaveCount(0);
  await expect(page.locator('#systemUsersFilter')).not.toHaveValue('all');
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hv-dd__list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hv-dd__list')).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test('selectOption and programmatic value keep the trigger label in sync', async ({ page }) => {
  await openUsers(page);
  await page.selectOption('#systemUsersFilter', 'archived');
  await expect(trigger(page, 'systemUsersFilter')).toContainText('Archived');
  await page.evaluate(() => { document.getElementById('systemUsersFilter').value = 'all'; });
  await expect(trigger(page, 'systemUsersFilter')).not.toContainText('Archived');
});

test('outside click closes the popup', async ({ page }) => {
  await openUsers(page);
  await trigger(page, 'systemUsersFilter').click();
  await expect(page.locator('.hv-dd__list')).toBeVisible();
  await page.locator('#a-system-users').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.hv-dd__list')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`popup uses theme surface colours (${theme})`, async ({ page }) => {
    await openUsers(page, theme);
    await trigger(page, 'systemUsersRoleFilter').click();
    const colours = await page.evaluate(() => {
      const list = getComputedStyle(document.querySelector('.hv-dd__list'));
      const root = getComputedStyle(document.documentElement);
      return { bg: list.backgroundColor, surface: root.getPropertyValue('--fv-surface').trim() };
    });
    const probe = await page.evaluate((s) => {
      const el = document.createElement('i');
      el.style.color = s;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    }, colours.surface);
    expect(colours.bg).toBe(probe);
  });

  test(`Active pill uses the shared success pill, not inline colours (${theme})`, async ({ page }) => {
    await openUsers(page, theme);
    const pill = page.locator('#systemUsersTableBody .badge-pill.pill-success', { hasText: 'Active' }).first();
    await expect(pill).toBeVisible();
    expect(await pill.getAttribute('style')).toBeNull();
    const bg = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgb(227, 245, 236)');
  });
}

test('Add Employee modal selects are enhanced and still drive the real select', async ({ page }) => {
  await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => openModal('employeeModal'));
  const btn = trigger(page, 'fEmpDept');
  await expect(btn).toBeVisible();
  await btn.click();
  await page.locator('.hv-dd__list [role="option"]', { hasText: 'Design' }).click();
  await expect(page.locator('#fEmpDept')).toHaveValue('Design');
  await expect(btn).toContainText('Design');
  await btn.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#employeeModal')).toHaveClass(/active/);
  await page.evaluate(() => closeModal('employeeModal'));
});
