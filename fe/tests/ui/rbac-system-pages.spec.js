import { test, expect } from '@playwright/test';

test.describe('RBAC Slice 7b: Roles and Users Management Pages', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Navigate to Roles page and verify seeded roles render with proper action constraints', async ({ page }) => {
    // Click System module rail button
    await page.click('#systemRailBtn');
    await expect(page.locator('#adminSystemNavGroup')).toBeVisible();

    // Click Roles nav item
    await page.click('#systemNavRoles');
    await expect(page.locator('#a-system-roles')).toBeVisible();

    // Check table rows
    const tbody = page.locator('#rolesTableBody');
    await expect(tbody.locator('tr')).toHaveCount(4);

    // Verify Super-Admin constraints
    const superAdminRow = tbody.locator('tr:has-text("Super-Admin")');
    await expect(superAdminRow).toBeVisible();
    await expect(superAdminRow.locator('.btn-edit-role')).toBeDisabled();
    await expect(superAdminRow.locator('.btn-delete-role')).toBeDisabled();

    // Verify HR-Admin has Edit enabled but Delete disabled
    const hrAdminRow = tbody.locator('tr:has-text("HR-Admin")');
    await expect(hrAdminRow.locator('.btn-edit-role')).toBeEnabled();
    await expect(hrAdminRow.locator('.btn-delete-role')).toBeDisabled();
  });

  test('Implication auto-ticking in Create Role Modal and role lifecycle', async ({ page }) => {
    await page.click('#systemRailBtn');
    await page.click('#systemNavRoles');

    // Open Create Role modal
    await page.click('#btnCreateRole');
    const modal = page.locator('#roleModal');
    await expect(modal).toHaveClass(/active/);

    const writeCb = modal.locator('input[data-perm-key="hr.employee.write"]');
    const readCb = modal.locator('input[data-perm-key="hr.employee.read"]');
    const impliedBadge = modal.locator('[data-implied-badge="hr.employee.read"]');

    // Initially readCb is unchecked and enabled
    expect(await readCb.isChecked()).toBe(false);
    expect(await readCb.isDisabled()).toBe(false);

    // Check writeCb -> readCb must become checked and disabled (auto-ticked)
    await writeCb.check();
    expect(await readCb.isChecked()).toBe(true);
    expect(await readCb.isDisabled()).toBe(true);
    await expect(impliedBadge).toBeVisible();

    // Uncheck writeCb -> readCb must revert to unchecked and enabled
    await writeCb.uncheck();
    expect(await readCb.isChecked()).toBe(false);
    expect(await readCb.isDisabled()).toBe(false);
    await expect(impliedBadge).toBeHidden();

    // Fill form and create Custom-Auditor role
    await modal.locator('#fRoleName').fill('Custom-Auditor');
    await modal.locator('#fRoleDescription').fill('Test role for auditing reports');
    await modal.locator('input[data-perm-key="finance.report.read"]').check();

    await modal.locator('#roleModalSaveBtn').click();
    await expect(modal).not.toHaveClass(/active/);

    // Verify Custom-Auditor appears in table
    const customRow = page.locator('#rolesTableBody tr:has-text("Custom-Auditor")');
    await expect(customRow).toBeVisible();
    await expect(customRow.locator('.btn-edit-role')).toBeEnabled();
    await expect(customRow.locator('.btn-delete-role')).toBeEnabled();

    // Handle delete confirm
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    // Delete Custom-Auditor
    await customRow.locator('.btn-delete-role').click();
    await expect(page.locator('#rolesTableBody tr:has-text("Custom-Auditor")')).toHaveCount(0);
  });

  test('Users page: table rendering, searching, filtering, role assignment and archiving', async ({ page }) => {
    await page.click('#systemRailBtn');
    await page.click('#systemNavUsers');
    await expect(page.locator('#a-system-users')).toBeVisible();

    const tbody = page.locator('#systemUsersTableBody');
    await expect(tbody.locator('tr')).toHaveCount(5);

    // Search filter
    await page.fill('#systemUsersSearch', 'Elena');
    await expect(tbody.locator('tr')).toHaveCount(1);
    await expect(tbody.locator('tr:has-text("Elena Rostova")')).toBeVisible();
    await page.fill('#systemUsersSearch', '');
    await expect(tbody.locator('tr')).toHaveCount(5);

    // Role filter
    await page.selectOption('#systemUsersRoleFilter', 'Payroll-Maker');
    await expect(tbody.locator('tr')).toHaveCount(1);
    await expect(tbody.locator('tr:has-text("Marcus Vance")')).toBeVisible();
    await page.selectOption('#systemUsersRoleFilter', 'all');
    await expect(tbody.locator('tr')).toHaveCount(5);

    // Assign Role to John Doe
    const johnRow = tbody.locator('tr:has-text("John Doe")');
    await johnRow.locator('.btn-assign-roles').click();

    const assignModal = page.locator('#assignRolesModal');
    await expect(assignModal).toHaveClass(/active/);

    // One role per user: radio buttons, and the derived Employee role is never offered
    await expect(assignModal.locator('#assignRolesChecklist input[type="checkbox"]')).toHaveCount(0);
    await expect(assignModal.locator('input[data-role-name="Employee"]')).toHaveCount(0);
    await expect(assignModal.locator('#assignRolesChecklist label:has-text("No additional role") input')).toBeChecked();

    // Selecting a second role replaces the first
    await assignModal.locator('input[data-role-name="HR-Admin"]').check();
    await assignModal.locator('input[data-role-name="Payroll-Maker"]').check();
    await expect(assignModal.locator('input[data-role-name="HR-Admin"]')).not.toBeChecked();
    await assignModal.locator('#assignRolesSaveBtn').click();
    await expect(assignModal).not.toHaveClass(/active/);

    // John Doe now displays Payroll-Maker badge
    await expect(johnRow.locator('.badge:has-text("Payroll-Maker")')).toBeVisible();
    await expect(johnRow.locator('.badge:has-text("HR-Admin")')).toHaveCount(0);

    // Archive Marcus Vance
    page.on('dialog', async dialog => {
      await dialog.accept();
    });
    const marcusRow = tbody.locator('tr:has-text("Marcus Vance")');
    await marcusRow.locator('.btn-archive-user').click();
    await expect(marcusRow.locator('.badge:has-text("Archived")')).toBeVisible();

    // Restore Marcus Vance
    await marcusRow.locator('.btn-unarchive-user').click();
    await expect(marcusRow.locator('.badge:has-text("Active")')).toBeVisible();
  });

});
