import { test, expect } from '@playwright/test';

test.describe('RBAC Slice 7b: Roles and Users Management Pages', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Navigate to Roles page and verify seeded roles render with proper action constraints', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.location().url.includes('favicon')) errors.push(msg.text()); });

    // Click System module rail button
    await page.click('#systemRailBtn');
    await expect(page.locator('#adminSystemNavGroup')).toBeVisible();

    // Click Roles nav item
    await page.click('#systemNavRoles');
    await expect(page.locator('#a-system-roles')).toBeVisible();

    // Five seeded roles, each with the System badge (is_locked / system_key come from the API shape)
    const tbody = page.locator('#rolesTableBody');
    await expect(tbody.locator('tr')).toHaveCount(5);
    await expect(tbody.locator('.badge:has-text("System")')).toHaveCount(5);

    // Super-Admin: locked. Edit opens a read-only view with the banner; delete is disabled.
    const superAdminRow = tbody.locator('tr:has-text("Super-Admin")');
    await expect(superAdminRow).toBeVisible();
    await expect(superAdminRow.locator('.btn-edit-role')).toBeEnabled();
    await expect(superAdminRow.locator('.btn-delete-role')).toBeDisabled();
    await superAdminRow.locator('.btn-edit-role').click();
    const modal = page.locator('#roleModal');
    await expect(modal).toHaveClass(/active/);
    await expect(page.locator('#roleModalLockedBanner')).toBeVisible();
    await expect(page.locator('#roleModalSaveBtn')).toBeHidden();
    await expect(modal.locator('#fRoleName')).toHaveJSProperty('readOnly', true);
    await expect(modal.locator('input[data-perm-key="system.users.manage"]')).toBeChecked();
    await expect(modal.locator('input[data-perm-key="hr.employee.write"]')).toBeDisabled();
    await modal.locator('.modal-close').click();
    await expect(modal).not.toHaveClass(/active/);

    // HR-Admin has Edit enabled but Delete disabled; system.* keys are not offered
    const hrAdminRow = tbody.locator('tr:has-text("HR-Admin")');
    await expect(hrAdminRow.locator('.btn-edit-role')).toBeEnabled();
    await hrAdminRow.locator('.btn-edit-role').click();
    await expect(modal).toHaveClass(/active/);
    await expect(modal.locator('#roleModalLockedBanner')).toBeHidden();
    await expect(modal.locator('#fRoleName')).toHaveJSProperty('readOnly', true);
    await expect(modal.locator('input[data-perm-key^="system."]')).toHaveCount(0);
    await expect(modal.locator('input[data-perm-key="hr.employee.write"]')).toBeChecked();
    await modal.locator('.modal-close').click();

    // HR-Admin is assigned to a user: delete is offered and the server rule (R7) message is shown verbatim
    page.once('dialog', async dialog => { await dialog.accept(); });
    await hrAdminRow.locator('.btn-delete-role').click();
    await expect(page.locator('#toast, .toast').filter({ hasText: "Cannot delete role 'HR-Admin' while it is assigned" }).first()).toBeVisible();
    await expect(hrAdminRow).toBeVisible();

    // Employee role: editable, never deletable
    const employeeRow = tbody.locator('tr[data-role-id="5"]');
    await expect(employeeRow).toContainText('Employee');
    await expect(employeeRow.locator('.btn-edit-role')).toBeEnabled();
    await expect(employeeRow.locator('.btn-delete-role')).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('Implication ticking, rename, escaping and role lifecycle', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error' && !msg.location().url.includes('favicon')) errors.push(msg.text()); });
    page.on('dialog', async dialog => { await dialog.accept(); });

    await page.click('#systemRailBtn');
    await page.click('#systemNavRoles');

    // Open Create Role modal
    await page.click('#btnCreateRole');
    const modal = page.locator('#roleModal');
    await expect(modal).toHaveClass(/active/);

    const writeCb = modal.locator('input[data-perm-key="hr.employee.write"]');
    const readCb = modal.locator('input[data-perm-key="hr.employee.read"]');

    // Initially unchecked
    await expect(readCb).not.toBeChecked();

    // Ticking write ticks read; both stay editable
    await writeCb.check();
    await expect(readCb).toBeChecked();
    await expect(readCb).toBeEnabled();

    // Unticking read unticks write
    await readCb.uncheck();
    await expect(writeCb).not.toBeChecked();
    await expect(readCb).not.toBeChecked();

    // Create a role whose name is markup: it must render as text
    const markupName = '<img src=x onerror=alert(1)>';
    await modal.locator('#fRoleName').fill(markupName);
    await modal.locator('#fRoleDescription').fill('Test role for auditing reports');
    await modal.locator('input[data-perm-key="finance.report.read"]').check();
    await modal.locator('#roleModalSaveBtn').click();
    await expect(modal).not.toHaveClass(/active/);

    const customRow = page.locator('#rolesTableBody tr', { hasText: markupName });
    await expect(customRow).toBeVisible();
    await expect(page.locator('#rolesTableBody img')).toHaveCount(0);
    await expect(customRow.locator('.btn-edit-role')).toBeEnabled();
    await expect(customRow.locator('.btn-delete-role')).toBeEnabled();

    // Rename the custom role (seeded roles keep a read-only name)
    await customRow.locator('.btn-edit-role').click();
    await expect(modal).toHaveClass(/active/);
    await expect(modal.locator('#fRoleName')).toHaveJSProperty('readOnly', false);
    await modal.locator('#fRoleName').fill('Custom-Auditor');
    await modal.locator('#roleModalSaveBtn').click();
    await expect(modal).not.toHaveClass(/active/);
    const renamedRow = page.locator('#rolesTableBody tr:has-text("Custom-Auditor")');
    await expect(renamedRow).toBeVisible();
    await expect(page.locator('#rolesTableBody tr', { hasText: markupName })).toHaveCount(0);

    // Delete Custom-Auditor
    await renamedRow.locator('.btn-delete-role').click();
    await expect(page.locator('#rolesTableBody tr:has-text("Custom-Auditor")')).toHaveCount(0);

    expect(errors).toEqual([]);
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
