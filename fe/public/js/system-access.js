/**
 * fe/public/js/system-access.js
 * Controller for RBAC System Access: Roles & Permissions and User Accounts.
 */
(function() {
  'use strict';

  // In-memory state
  let _permissionCatalog = [];
  let _systemRoles = [];
  let _systemUsers = [];
  let _currentEditingRoleId = null;
  let _currentAssignUserId = null;
  let _userExplicitPermissions = new Set();
  let _pickerReadOnly = false;
  let _userSearchTimer = null;

  function isMockMode() {
    return typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
  }

  // Fallback / Initial Mock Catalog
  // Mirrors be/core/permission_catalog.py (mock mode only; the real page uses GET /api/access/catalog).
  const DEFAULT_CATALOG = [
    { key: "system.users.manage", group: "System / Access", description: "Manage user accounts and identity", assignable: false, implies: [] },
    { key: "system.roles.manage", group: "System / Access", description: "Manage RBAC roles and permissions", assignable: false, implies: [] },
    { key: "system.audit.read", group: "System / Audit", description: "View audit log entries", assignable: false, implies: [] },

    { key: "hr.employee.read", group: "HR / Employees", description: "View company employee profiles", assignable: true, implies: [] },
    { key: "hr.employee.write", group: "HR / Employees", description: "Create, edit, and delete employee records", assignable: true, implies: ["hr.employee.read"] },
    { key: "hr.salary.read", group: "HR / Compensation", description: "View employee salaries and raise history", assignable: true, implies: [] },
    { key: "hr.salary.write", group: "HR / Compensation", description: "Update employee salaries and record compensation changes", assignable: true, implies: ["hr.salary.read"] },
    { key: "hr.employee_bank_account.read", group: "HR / Employee bank details", description: "View employee bank account details", assignable: true, implies: [] },
    { key: "hr.employee_bank_account.write", group: "HR / Employee bank details", description: "Create and update employee bank account details", assignable: true, implies: ["hr.employee_bank_account.read"] },
    { key: "hr.employee_bank_account.reveal", group: "HR / Employee bank details", description: "Reveal unmasked employee bank account and IBAN identifiers", assignable: true, implies: ["hr.employee_bank_account.read"] },
    { key: "hr.employee_document.read", group: "HR / Documents", description: "View employee documents", assignable: true, implies: [] },
    { key: "hr.employee_document.write", group: "HR / Documents", description: "Upload and delete employee documents", assignable: true, implies: ["hr.employee_document.read"] },
    { key: "hr.company_document.read", group: "HR / Documents", description: "View company documents", assignable: true, implies: [] },
    { key: "hr.company_document.write", group: "HR / Documents", description: "Upload and manage company documents", assignable: true, implies: ["hr.company_document.read"] },
    { key: "hr.salary_payment_doc.read", group: "HR / Salary payment documents", description: "View salary payment documents and receipts", assignable: true, implies: [] },
    { key: "hr.salary_payment_doc.write", group: "HR / Salary payment documents", description: "Upload and manage salary payment documents", assignable: true, implies: ["hr.salary_payment_doc.read"] },
    { key: "hr.vacation.read", group: "HR / Leave and requests", description: "View company vacation requests and balances", assignable: true, implies: [] },
    { key: "hr.vacation.write", group: "HR / Leave and requests", description: "Manage and approve vacation requests", assignable: true, implies: ["hr.vacation.read"] },
    { key: "hr.request.read", group: "HR / Leave and requests", description: "View company employee requests", assignable: true, implies: [] },
    { key: "hr.request.write", group: "HR / Leave and requests", description: "Manage and approve company employee requests", assignable: true, implies: ["hr.request.read"] },
    { key: "hr.insurance.read", group: "HR / Medical insurance", description: "View medical insurance categories and claims", assignable: true, implies: [] },
    { key: "hr.insurance.write", group: "HR / Medical insurance", description: "Manage medical insurance categories and process claims", assignable: true, implies: ["hr.insurance.read"] },
    { key: "hr.export.run", group: "HR / Data export", description: "Run HR and company data exports", assignable: true, implies: [] },

    { key: "self.profile.read", group: "Self-service", description: "View own employee profile", assignable: true, implies: [] },
    { key: "self.payslip.read", group: "Self-service", description: "View own salary payment documents and payslips", assignable: true, implies: [] },
    { key: "self.requests.read", group: "Self-service", description: "View own submitted requests", assignable: true, implies: [] },
    { key: "self.requests.write", group: "Self-service", description: "Submit and manage own requests", assignable: true, implies: ["self.requests.read"] },
    { key: "self.salary.read", group: "Self-service", description: "View own salary and compensation details", assignable: true, implies: [] },
    { key: "self.vacation.read", group: "Self-service", description: "View own vacation balance and history", assignable: true, implies: [] },
    { key: "self.vacation.write", group: "Self-service", description: "Submit and cancel own vacation requests", assignable: true, implies: ["self.vacation.read"] },
    { key: "self.claim.read", group: "Self-service", description: "View own medical insurance claims and consumption", assignable: true, implies: [] },
    { key: "self.claim.write", group: "Self-service", description: "Submit own medical insurance claims", assignable: true, implies: ["self.claim.read"] },
    { key: "self.bank_account.read", group: "Self-service", description: "View own masked bank account details", assignable: true, implies: [] },
    { key: "self.document.read", group: "Self-service", description: "View own employee documents", assignable: true, implies: [] },
    { key: "self.document.write", group: "Self-service", description: "Upload and manage own employee documents", assignable: true, implies: ["self.document.read"] },

    { key: "finance.customer.read", group: "Finance / Sales", description: "View customers", assignable: true, implies: [] },
    { key: "finance.customer.write", group: "Finance / Sales", description: "Create, update, and manage customers", assignable: true, implies: ["finance.customer.read"] },
    { key: "finance.invoice.read", group: "Finance / Sales", description: "View sales invoices", assignable: true, implies: [] },
    { key: "finance.invoice.write", group: "Finance / Sales", description: "Create, update, and void sales invoices", assignable: true, implies: ["finance.invoice.read"] },
    { key: "finance.vendor.read", group: "Finance / Spend", description: "View vendors", assignable: true, implies: [] },
    { key: "finance.vendor.write", group: "Finance / Spend", description: "Create, update, and manage vendors", assignable: true, implies: ["finance.vendor.read"] },
    { key: "finance.vendor_payment.manage", group: "Finance / Spend", description: "Add and update sensitive vendor payment details", assignable: true, implies: ["finance.vendor.read"] },
    { key: "finance.vendor_payment.verify", group: "Finance / Spend", description: "Verify and approve vendor payment instructions", assignable: true, implies: ["finance.vendor.read"] },
    { key: "finance.vendor_payment.reveal", group: "Finance / Spend", description: "Reveal sensitive vendor payment and bank instructions", assignable: true, implies: ["finance.vendor.read"] },
    { key: "finance.bill.read", group: "Finance / Spend", description: "View vendor bills", assignable: true, implies: [] },
    { key: "finance.bill.write", group: "Finance / Spend", description: "Create, update, and void vendor bills", assignable: true, implies: ["finance.bill.read"] },
    { key: "finance.bill.approve", group: "Finance / Spend", description: "Approve or reject vendor bills; bills saved by an approver are auto-approved", assignable: true, implies: ["finance.bill.read"] },
    { key: "finance.bill.pay", group: "Finance / Spend", description: "Record payments against vendor bills (including already-paid bills, linked cheques and transactions)", assignable: true, implies: ["finance.bill.read"] },
    { key: "finance.subscription.read", group: "Finance / Spend", description: "View vendor subscriptions", assignable: true, implies: [] },
    { key: "finance.subscription.write", group: "Finance / Spend", description: "Create and manage vendor subscriptions", assignable: true, implies: ["finance.subscription.read"] },
    { key: "finance.statutory.read", group: "Finance / Spend", description: "View statutory obligations and payments", assignable: true, implies: [] },
    { key: "finance.statutory.write", group: "Finance / Spend", description: "Create and manage statutory obligations and payments", assignable: true, implies: ["finance.statutory.read"] },
    { key: "finance.account.read", group: "Finance / Banking", description: "View company bank accounts", assignable: true, implies: [] },
    { key: "finance.account.write", group: "Finance / Banking", description: "Manage company bank accounts and balances", assignable: true, implies: ["finance.account.read"] },
    { key: "finance.bank_account.reveal", group: "Finance / Banking", description: "Reveal unmasked company bank account identifiers", assignable: true, implies: ["finance.account.read"] },
    { key: "finance.adjustment.manage", group: "Finance / Banking", description: "Authorize and record manual balance adjustments and journal corrections", assignable: true, implies: ["finance.account.write"] },
    { key: "finance.report.read", group: "Finance / Reports", description: "View finance summary reports and metrics", assignable: true, implies: [] },
    { key: "finance.settings.read", group: "Finance / Settings", description: "View finance settings, feature flags, and rollout controls", assignable: true, implies: [] },
    { key: "finance.settings.write", group: "Finance / Settings", description: "Manage finance settings, feature flags, and rollout controls", assignable: true, implies: ["finance.settings.read"] },

    { key: "finance.payroll.read", group: "Payroll / Runs", description: "View company payroll runs and history", assignable: true, implies: [] },
    { key: "finance.payroll.prepare", group: "Payroll / Runs", description: "Prepare, adjust, and submit payroll runs and compensation plans", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll.approve", group: "Payroll / Runs", description: "Approve and finalize company payroll runs", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll.pay", group: "Payroll / Runs", description: "Disburse payments and post journal entries for payroll runs", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll_tax.read", group: "Payroll / Tax settings", description: "View payroll income tax settings", assignable: true, implies: [] },
    { key: "finance.payroll_tax.write", group: "Payroll / Tax settings", description: "Create and update payroll income tax settings", assignable: true, implies: ["finance.payroll_tax.read"] }
  ];

  // Same shape as GET /api/access/roles (system_key and is_locked, no is_system). Employee is the editable baseline role.
  const INITIAL_MOCK_ROLES = [
    {
      id: 1,
      name: "Super-Admin",
      description: "Full system and domain administrative access",
      system_key: "super_admin",
      is_locked: true,
      user_count: 1,
      permissions: DEFAULT_CATALOG.map(p => p.key)
    },
    {
      id: 2,
      name: "HR-Admin",
      description: "HR domain administration and employee operations",
      system_key: "hr_admin",
      is_locked: false,
      user_count: 1,
      permissions: [
        "hr.employee.read", "hr.employee.write", "hr.salary.read", "hr.salary.write",
        "hr.employee_bank_account.read", "hr.employee_bank_account.write", "hr.employee_bank_account.reveal",
        "hr.employee_document.read", "hr.employee_document.write", "hr.company_document.read", "hr.company_document.write",
        "hr.salary_payment_doc.read", "hr.salary_payment_doc.write", "hr.vacation.read", "hr.vacation.write",
        "hr.request.read", "hr.request.write", "hr.insurance.read", "hr.insurance.write", "hr.export.run"
      ]
    },
    {
      id: 3,
      name: "Financial-Admin",
      description: "Finance and accounting operations across sales, spend, banking, and payroll",
      system_key: "financial_admin",
      is_locked: false,
      user_count: 1,
      permissions: [
        "finance.customer.read", "finance.customer.write", "finance.invoice.read", "finance.invoice.write",
        "finance.vendor.read", "finance.vendor.write", "finance.vendor_payment.manage", "finance.vendor_payment.verify", "finance.vendor_payment.reveal",
        "finance.bill.read", "finance.bill.write", "finance.subscription.read", "finance.subscription.write",
        "finance.statutory.read", "finance.statutory.write", "finance.account.read", "finance.account.write",
        "finance.bank_account.reveal", "finance.adjustment.manage", "finance.report.read",
        "finance.settings.read", "finance.settings.write", "finance.payroll.read", "finance.payroll.approve", "finance.payroll.pay",
        "finance.payroll_tax.read", "finance.payroll_tax.write"
      ]
    },
    {
      id: 4,
      name: "Payroll-Maker",
      description: "Preparation and adjustment of draft payroll runs",
      system_key: "payroll_maker",
      is_locked: false,
      user_count: 1,
      permissions: ["finance.payroll.read", "finance.payroll.prepare"]
    },
    {
      id: 5,
      name: "Employee",
      description: "Standard self-service employee access",
      system_key: "employee",
      is_locked: false,
      user_count: 0,
      permissions: ["hr.company_document.read", "self.bank_account.read", "self.claim.read", "self.claim.write", "self.document.read", "self.document.write", "self.payslip.read", "self.profile.read", "self.requests.read", "self.requests.write", "self.salary.read", "self.vacation.read", "self.vacation.write"]
    }
  ];

  // Same shape as GET /api/access/users: one assigned role (or null). Employee access is derived, never listed.
  const INITIAL_MOCK_USERS = [
    { id: 1, name: "Sarah Connor", email: "sarah@voyance.com", employee_id: 1, is_external: false, is_self: true, archived_at: null, role: { id: 1, name: "Super-Admin", system_key: "super_admin" } },
    { id: 2, name: "John Doe", email: "john@voyance.com", employee_id: 2, is_external: false, archived_at: null, role: null },
    { id: 3, name: "Alex Rivera", email: "alex@voyance.com", employee_id: 3, is_external: false, archived_at: null, role: { id: 2, name: "HR-Admin", system_key: "hr_admin" } },
    { id: 4, name: "Elena Rostova", email: "elena@voyance.com", employee_id: 4, is_external: false, archived_at: null, role: { id: 3, name: "Financial-Admin", system_key: "financial_admin" } },
    { id: 5, name: "Marcus Vance", email: "marcus@voyance.com", employee_id: 5, is_external: false, archived_at: null, role: { id: 4, name: "Payroll-Maker", system_key: "payroll_maker" } },
    { id: 6, name: "Priya Nair", email: "priya@partner.example", employee_id: null, is_external: true, archived_at: null, role: { id: 3, name: "Financial-Admin", system_key: "financial_admin" } }
  ];

  function escHtml(val) {
    return window.escapeHtml(val);
  }

  // The user's single assigned role as { id, name, system_key } or null.
  function getUserRole(u) {
    const r = u ? u.role : null;
    return (r && typeof r === 'object') ? r : null;
  }

  // The Employee role is derived from the employee link and is never assignable to a user.
  function isEmployeeBaselineRole(role) {
    return !!role && (role.system_key === 'employee' || role.name === 'Employee');
  }

  // Helper: Transitive implication closure
  function computeImpliedPermissions(keys) {
    const implied = new Set();
    const catalogMap = new Map(_permissionCatalog.map(p => [p.key, p]));
    const queue = [...keys];
    while (queue.length > 0) {
      const cur = queue.shift();
      const def = catalogMap.get(cur);
      if (def && Array.isArray(def.implies)) {
        for (const imp of def.implies) {
          if (!implied.has(imp)) {
            implied.add(imp);
            queue.push(imp);
          }
        }
      }
    }
    return implied;
  }

  /* ==========================================================================
     CATALOG & ROLES LOGIC
     ========================================================================== */

  // GET /api/access/catalog returns [{ group, permissions: [{ key, description, implies, assignable }] }].
  // Flatten it to the internal list of { key, group, description, implies, assignable }.
  function flattenCatalog(data) {
    const groups = Array.isArray(data) ? data : ((data && data.groups) || []);
    const flat = [];
    for (const g of groups) {
      for (const p of (g.permissions || [])) {
        flat.push({
          key: p.key,
          group: g.group,
          description: p.description || '',
          implies: Array.isArray(p.implies) ? p.implies : [],
          assignable: p.assignable !== false
        });
      }
    }
    return flat;
  }

  async function loadCatalog() {
    if (_permissionCatalog.length > 0) return _permissionCatalog;
    if (isMockMode()) {
      _permissionCatalog = DEFAULT_CATALOG;
      return _permissionCatalog;
    }
    const data = await Api.getPermissionCatalog();
    _permissionCatalog = flattenCatalog(data);
    return _permissionCatalog;
  }

  async function loadRoles() {
    const loadingBar = document.getElementById('rolesTableLoadingBar');
    if (loadingBar) loadingBar.style.display = 'block';
    try {
      await loadCatalog();
      if (isMockMode()) {
        if (_systemRoles.length === 0) {
          _systemRoles = JSON.parse(JSON.stringify(INITIAL_MOCK_ROLES));
        }
      } else {
        const data = await Api.getRoles();
        _systemRoles = Array.isArray(data) ? data : (data.roles || []);
      }
      renderRolesTable();
    } catch (err) {
      toast(err.message || 'Failed to load roles', 'fa-solid fa-triangle-exclamation');
    } finally {
      if (loadingBar) loadingBar.style.display = 'none';
    }
  }

  function renderRolesTable() {
    const tbody = document.getElementById('rolesTableBody');
    if (!tbody) return;
    if (_systemRoles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--ink-muted);">No roles defined.</td></tr>`;
      return;
    }

    tbody.innerHTML = _systemRoles.map(role => {
      const isLocked = !!role.is_locked;
      const isSystem = !!role.system_key;
      const isEmployee = role.system_key === 'employee';
      const noDelete = isLocked || isEmployee;
      const deleteTitle = isLocked
        ? "Protected role, cannot be deleted"
        : (isSystem ? "Built-in role, cannot be deleted" : (isEmployee ? "The baseline Employee role cannot be deleted" : "Delete role"));

      const perms = role.permissions || [];
      const permText = isLocked ? `All ${_permissionCatalog.length}` : `${perms.length} permission${perms.length === 1 ? '' : 's'}`;
      const rid = Number(role.id);

      return `
        <tr data-role-id="${rid}">
          <td data-label="Role" style="padding: 10px 16px; white-space: nowrap;">
            <span style="display: flex; align-items: center; gap: 10px;">
              <span style="width: 32px; height: 32px; flex: none; border-radius: 10px; background: var(--pink-soft, #fbe7f0); color: var(--pink-text, #ad3469); display: inline-flex; align-items: center; justify-content: center;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"></path></svg>
              </span>
              <span>
                <span style="display: block; font-weight: 600; color: var(--ink-strong);">${escHtml(role.name)}</span>
                <span style="font-size: 12px; color: var(--ink-muted);">${isSystem ? 'Built-in role' : 'Custom role'} <span class="badge" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);">${isSystem ? 'System' : ''}</span></span>
              </span>
            </span>
          </td>
          <td data-label="Description" style="padding: 10px 12px; color: var(--ink-body); font-size: 13.5px;">${escHtml(role.description) || '—'}</td>
          <td data-label="Users" style="padding: 10px 12px; text-align: right; font-weight: 600; color: var(--ink-strong);">${escHtml(role.user_count ?? (role.users ? role.users.length : 0))}</td>
          <td data-label="Permissions" style="padding: 10px 12px;">
            <span style="padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--brand-dark, #1a46bd); background: var(--brand-soft, #e8eeff); white-space: nowrap;">${escHtml(permText)}</span>
          </td>
          <td data-label="Actions" class="col-actions" style="padding: 10px 16px; text-align: right; white-space: nowrap;">
            <button class="btn btn-sm btn-outline btn-edit-role" onclick="openEditRoleModal(${rid})" title="${isLocked ? 'View role permissions (read-only)' : 'Edit role permissions'}" style="display: inline-flex; align-items: center; box-sizing: border-box; height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--fv-line); background: var(--fv-surface); color: var(--brand-dark, #1a46bd); font-weight: 600; font-size: 12.5px; vertical-align: middle;">
              ${isLocked ? 'View' : 'Edit'}
            </button>
            <button class="btn-delete-role" onclick="${noDelete ? '' : `deleteRole(${rid})`}" ${noDelete ? 'disabled' : ''} title="${escHtml(deleteTitle)}" aria-label="${escHtml(deleteTitle)}" style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; margin-left: 2px; border: 0; background: transparent; border-radius: 8px; color: var(--ink-muted, #5d6b8f); vertical-align: middle; cursor: ${noDelete ? 'not-allowed' : 'pointer'}; opacity: ${noDelete ? '0.45' : '1'};">
              ${noDelete
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>`}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPermissionPicker(readOnly) {
    _pickerReadOnly = !!readOnly;
    const container = document.getElementById('rolePermissionsContainer');
    if (!container) return;

    // Keys the role editor can grant. A locked (read-only) role shows every key, as it holds them all.
    const visible = _permissionCatalog.filter(p => readOnly || p.assignable !== false);
    const groups = {};
    for (const p of visible) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }

    const q = (document.getElementById('rolePermSearch')?.value || '').toLowerCase().trim();

    container.innerHTML = Object.keys(groups).map(grp => {
      const items = groups[grp].filter(p => !q || p.key.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
      if (items.length === 0) return '';
      const checkedInGrp = items.filter(p => _userExplicitPermissions.has(p.key)).length;

      return `
        <div class="perm-group-section" style="border-bottom: 1px solid var(--fv-line);">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: var(--fv-surface-soft); border-bottom: 1px solid var(--fv-line); font-size: 12.5px; font-weight: 700; color: var(--ink-strong);">
            <span>${escHtml(grp)}</span>
            <span style="font-weight: 500; color: var(--ink-muted);" class="perm-group-count">${checkedInGrp} of ${items.length}</span>
          </div>
          <div>
            ${items.map(p => `
              <label class="perm-checkbox-item" style="display: flex; align-items: flex-start; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--fv-line); cursor: ${readOnly ? 'default' : 'pointer'}; margin: 0;">
                <input type="checkbox"
                       data-perm-key="${escHtml(p.key)}"
                       ${readOnly ? 'disabled' : ''}
                       onchange="handlePermissionCheckboxChange(event, this.dataset.permKey)"
                       style="width: 16px; height: 16px; margin-top: 2px; accent-color: var(--brand);">
                <span style="flex: 1;">
                  <span style="display: block; font-size: 13.5px; color: var(--ink-strong); font-weight: 500;">${escHtml(p.description)}</span>
                  <span style="font-size: 12px; color: var(--ink-muted); font-family: inherit;">${escHtml(p.key)}${Array.isArray(p.implies) && p.implies.length ? ` · includes ${escHtml(p.implies.join(', '))}` : ''}</span>
                </span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    syncPermissionChecks();
  }

  function syncPermissionChecks() {
    document.querySelectorAll('#rolePermissionsContainer input[type="checkbox"]').forEach(cb => {
      cb.checked = _userExplicitPermissions.has(cb.dataset.permKey);
    });

    const countEl = document.getElementById('rolePermSelectedCount');
    if (countEl) {
      countEl.textContent = `· ${_userExplicitPermissions.size} selected`;
    }

    document.querySelectorAll('.perm-group-section').forEach(sec => {
      const allCbs = sec.querySelectorAll('input[type="checkbox"]');
      const checkedCbs = sec.querySelectorAll('input[type="checkbox"]:checked');
      const countSpan = sec.querySelector('.perm-group-count');
      if (countSpan && allCbs.length) {
        countSpan.textContent = `${checkedCbs.length} of ${allCbs.length}`;
      }
    });
  }

  // Every key that (transitively) implies `key`.
  function computeImplyingPermissions(key) {
    const result = new Set();
    const queue = [key];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const p of _permissionCatalog) {
        if (Array.isArray(p.implies) && p.implies.includes(cur) && !result.has(p.key)) {
          result.add(p.key);
          queue.push(p.key);
        }
      }
    }
    return result;
  }

  window.handlePermissionCheckboxChange = function(evt, key) {
    if (evt.target.checked) {
      // Ticking a key ticks everything it implies
      _userExplicitPermissions.add(key);
      computeImpliedPermissions([key]).forEach(k => _userExplicitPermissions.add(k));
    } else {
      // Unticking a key unticks everything that implies it
      _userExplicitPermissions.delete(key);
      computeImplyingPermissions(key).forEach(k => _userExplicitPermissions.delete(k));
    }
    syncPermissionChecks();
  };

  // Shows or hides the read-only banner and the save button of the role modal.
  function setRoleModalReadOnly(readOnly, nameLocked) {
    const banner = document.getElementById('roleModalLockedBanner');
    if (banner) banner.style.display = readOnly ? 'block' : 'none';
    const saveBtn = document.getElementById('roleModalSaveBtn');
    if (saveBtn) saveBtn.style.display = readOnly ? 'none' : '';
    document.getElementById('fRoleName').readOnly = !!(readOnly || nameLocked);
    document.getElementById('fRoleDescription').readOnly = !!readOnly;
  }

  window.openCreateRoleModal = function() {
    _currentEditingRoleId = null;
    _userExplicitPermissions = new Set();
    document.getElementById('roleModalTitle').textContent = 'Create role';
    document.getElementById('fRoleName').value = '';
    document.getElementById('fRoleDescription').value = '';
    setRoleModalReadOnly(false, false);
    renderPermissionPicker(false);
    openModal('roleModal');
  };

  window.openEditRoleModal = function(roleId) {
    const role = _systemRoles.find(r => r.id === roleId);
    if (!role) return;
    const locked = !!role.is_locked;
    _currentEditingRoleId = roleId;
    _userExplicitPermissions = locked
      ? new Set(_permissionCatalog.map(p => p.key))
      : new Set(role.permissions || []);
    document.getElementById('roleModalTitle').textContent = `${locked ? 'View' : 'Edit'} role: ${role.name}`;
    document.getElementById('fRoleName').value = role.name;
    document.getElementById('fRoleDescription').value = role.description || '';
    // Seeded roles keep a read-only name; custom roles can be renamed
    setRoleModalReadOnly(locked, !!role.system_key);
    renderPermissionPicker(locked);
    openModal('roleModal');
  };

  window.saveRole = async function(evt) {
    const btn = (evt && evt.currentTarget) || document.getElementById('roleModalSaveBtn');
    const name = document.getElementById('fRoleName').value.trim();
    const description = document.getElementById('fRoleDescription').value.trim();

    if (!name) {
      toast('Please enter a role name', 'fa-solid fa-triangle-exclamation');
      return;
    }

    // The picker keeps the set closed under implication; the server normalizes again.
    const implied = computeImpliedPermissions(_userExplicitPermissions);
    const finalPermissions = Array.from(new Set([..._userExplicitPermissions, ...implied]));

    if (finalPermissions.length === 0) {
      toast('Please select at least one permission for this role', 'fa-solid fa-triangle-exclamation');
      return;
    }

    const editing = _currentEditingRoleId ? _systemRoles.find(r => r.id === _currentEditingRoleId) : null;

    setButtonLoading(btn, true, 'Saving...');
    try {
      if (isMockMode()) {
        if (editing) {
          if (!editing.system_key) editing.name = name;
          editing.description = description;
          editing.permissions = finalPermissions;
          toast('Role updated successfully');
        } else {
          const newId = _systemRoles.length ? Math.max(..._systemRoles.map(r => r.id)) + 1 : 1;
          _systemRoles.push({
            id: newId,
            name,
            description,
            system_key: null,
            is_locked: false,
            user_count: 0,
            permissions: finalPermissions
          });
          toast('New role created');
        }
        closeModal('roleModal');
        renderRolesTable();
      } else {
        if (editing) {
          const body = { description, permissions: finalPermissions };
          if (!editing.system_key) body.name = name;
          await Api.updateRole(_currentEditingRoleId, body);
          toast('Role updated successfully');
        } else {
          await Api.createRole({ name, description, permissions: finalPermissions });
          toast('New role created');
        }
        closeModal('roleModal');
        await loadRoles();
      }
    } catch (err) {
      toast(err.message || 'Failed to save role', 'fa-solid fa-triangle-exclamation');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  window.deleteRole = async function(roleId) {
    const role = _systemRoles.find(r => r.id === roleId);
    if (!role) return;
    if (role.is_locked || role.system_key === 'employee') return;

    const roleOk = await FinanceCommand.confirmAction({
      title: 'Delete role',
      consequence: `Delete role "${role.name}"? Users must be moved to another role first.`,
      actionLabel: 'Delete role',
    });
    if (!roleOk.confirmed) return;

    try {
      if (isMockMode()) {
        // Same rule and wording as the server (R7)
        const assigned = Number(role.user_count || 0);
        if (assigned > 0) {
          throw new Error(`Cannot delete role '${role.name}' while it is assigned to ${assigned} user(s).`);
        }
        _systemRoles = _systemRoles.filter(r => r.id !== roleId);
        toast('Role deleted', 'fa-solid fa-trash');
        renderRolesTable();
      } else {
        await Api.deleteRole(roleId);
        toast('Role deleted', 'fa-solid fa-trash');
        await loadRoles();
      }
    } catch (err) {
      toast(err.message || 'Failed to delete role', 'fa-solid fa-triangle-exclamation');
    }
  };

  /* ==========================================================================
     USERS LOGIC
     ========================================================================== */

  function currentUsersFilter() {
    return document.getElementById('systemUsersFilter')?.value || 'all';
  }

  function currentUsersSearch() {
    return (document.getElementById('systemUsersSearch')?.value || '').trim();
  }

  // Role filter options come from the roles list, not a hard-coded set.
  async function populateUsersRoleFilter() {
    const select = document.getElementById('systemUsersRoleFilter');
    if (!select) return;
    try {
      if (_systemRoles.length === 0) {
        if (isMockMode()) {
          _systemRoles = JSON.parse(JSON.stringify(INITIAL_MOCK_ROLES));
        } else {
          const data = await Api.getRoles();
          _systemRoles = Array.isArray(data) ? data : (data.roles || []);
        }
      }
    } catch (err) {
      console.warn('Could not load roles for the users filter:', err);
    }
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">All Roles</option>' + _systemRoles
      .map(role => `<option value="${escHtml(role.name)}">${escHtml(role.name)}</option>`).join('');
    select.value = [...select.options].some(o => o.value === current) ? current : 'all';
  }

  async function loadUsers() {
    const loadingBar = document.getElementById('usersTableLoadingBar');
    if (loadingBar) loadingBar.style.display = 'block';
    try {
      await populateUsersRoleFilter();
      if (isMockMode()) {
        if (_systemUsers.length === 0) {
          _systemUsers = JSON.parse(JSON.stringify(INITIAL_MOCK_USERS));
        }
      } else {
        // Filter and search are applied by the server (GET /api/access/users?filter=&search=)
        const data = await Api.getUsers({ filter: currentUsersFilter(), search: currentUsersSearch() });
        _systemUsers = Array.isArray(data) ? data : (data.users || []);
      }
      renderUsersTable();
    } catch (err) {
      toast(err.message || 'Failed to load users', 'fa-solid fa-triangle-exclamation');
    } finally {
      if (loadingBar) loadingBar.style.display = 'none';
    }
  }

  // Mock mode applies the same All / Employees / External / Archived rules the server does.
  function matchesUsersFilter(u, filter) {
    const archived = !!u.archived_at;
    if (filter === 'archived') return archived;
    if (archived) return filter === 'all';
    if (filter === 'employees') return !!u.employee_id;
    if (filter === 'external') return !u.employee_id;
    return true;
  }

  function renderUsersTable() {
    const tbody = document.getElementById('systemUsersTableBody');
    if (!tbody) return;

    const q = currentUsersSearch().toLowerCase();
    const roleFilter = document.getElementById('systemUsersRoleFilter')?.value || 'all';
    const mock = isMockMode();
    const filter = currentUsersFilter();

    const filtered = _systemUsers.filter(u => {
      const roleName = (getUserRole(u) || {}).name || '';
      // Real mode: the server already applied filter and search; only the role dropdown is client-side.
      const matchesSearch = !mock || !q || (u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q)) || roleName.toLowerCase().includes(q);
      const matchesKind = !mock || matchesUsersFilter(u, filter);
      const matchesRole = roleFilter === 'all' || roleName === roleFilter;
      return matchesSearch && matchesKind && matchesRole;
    });

    const footerText = document.getElementById('systemUsersCountText');
    if (footerText) {
      footerText.innerHTML = `Showing <strong style="color: var(--brand);">1–${filtered.length}</strong> of <strong style="color: var(--brand);">${_systemUsers.length}</strong> users · you cannot archive your own account`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--ink-muted);">No users found.</td></tr>`;
      return;
    }

    const AVATAR_PALETTE = [
      'background: var(--brand-soft, #e8eeff); color: var(--brand-dark, #1a46bd);',
      'background: var(--warning-soft, #fdf0e1); color: var(--warning-text, #b2560f);',
      'background: var(--teal-soft, #e0f4f1); color: var(--teal-ink, #0b7a6d);',
      'background: var(--violet-soft, #f1eafe); color: var(--violet-ink, #6236c0);',
      'background: var(--pink-soft, #fbe7f0); color: var(--pink-text, #ad3469);',
      'background: var(--sky-soft, #e2f2fb); color: var(--sky-ink, #146fa3);'
    ];

    tbody.innerHTML = filtered.map((u, idx) => {
      const uid = Number(u.id);
      const isArchived = !!u.archived_at;
      const isSelf = !!u.is_self;
      const statusPill = isArchived
        ? `<span class="badge badge-status" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--ink-muted); background: var(--fv-surface-soft);"><span style="width: 7px; height: 7px; border-radius: 50%; background: var(--ink-muted);"></span>Archived</span>`
        : `<span class="badge badge-status" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #06703f; background: #e3f5ec;"><span style="width: 7px; height: 7px; border-radius: 50%; background: #06703f;"></span>Active</span>`;

      const assignedRole = getUserRole(u);
      const roleBadges = assignedRole
        ? `<span class="badge badge-role" style="background:transparent; color:inherit; font-weight:600; font-size:inherit; padding:0; border:0; display:inline;">${escHtml(assignedRole.name)}</span>`
        : `<span style="color:var(--ink-muted); font-size:12.5px; font-weight:normal;">${u.employee_id ? 'Employee access only' : 'No role'}</span>`;

      const selfTitle = 'You cannot change your own access';
      let actions;
      if (isArchived) {
        // Archived users keep their record but offer no actions (no reinstatement control until Q-006 is decided)
        actions = '<span style="color:var(--ink-muted); font-size:12.5px;">—</span>';
      } else {
        actions = `
            <button class="btn btn-sm btn-outline btn-assign-roles" onclick="openAssignRolesModal(${uid})" ${isSelf ? `disabled title="${selfTitle}" style="display: inline-flex; align-items: center; box-sizing: border-box; height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--fv-line); background: var(--fv-surface); color: var(--brand-dark, #1a46bd); font-weight: 600; font-size: 12.5px; vertical-align: middle; opacity: 0.4; cursor: not-allowed;"` : 'title="Assign role" style="display: inline-flex; align-items: center; box-sizing: border-box; height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--fv-line); background: var(--fv-surface); color: var(--brand-dark, #1a46bd); font-weight: 600; font-size: 12.5px; vertical-align: middle;"'}>
              Change role
            </button>
            <button class="btn-archive-user" onclick="${isSelf ? '' : `archiveUser(${uid})`}" ${isSelf ? `disabled title="${selfTitle}" style="display: inline-flex; width: 30px; height: 30px; margin-left: 2px; border: 0; background: transparent; opacity: 0; pointer-events: none; vertical-align: middle; cursor: default;"` : `title="Archive user account" aria-label="Archive ${escHtml(u.name || u.email)}" style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; margin-left: 2px; border: 0; background: transparent; border-radius: 8px; color: var(--ink-muted, #5d6b8f); vertical-align: middle; cursor: pointer;"`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"></path></svg>
            </button>`;
      }

      const avatarStyle = AVATAR_PALETTE[idx % AVATAR_PALETTE.length];

      return `
        <tr data-user-id="${uid}">
          <td data-label="User" class="tname" style="padding: 9px 16px;">
            <span style="display: flex; align-items: center; gap: 10px;">
              <span class="avatar" style="width: 32px; height: 32px; flex: none; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; ${avatarStyle}">${escHtml(initials(u.name || u.email))}</span>
              <span>
                <span style="display: block; font-weight: 600; color: var(--ink-strong);">${escHtml(u.name || 'External User')}</span>
                <span style="font-size: 12px; color: var(--ink-muted);">
                  ${u.employee_id ? `Employee EMP${String(u.employee_id).padStart(3, '0')}${isSelf ? ' · you' : ''}` : `<span class="badge" style="font-size: 12px; color: var(--ink-muted); background: transparent; padding: 0; border: 0; font-weight: normal;">External user</span>`}
                </span>
              </span>
            </span>
          </td>
          <td data-label="Email" style="padding: 9px 12px; color: var(--ink-body); font-size: 13.5px;">${escHtml(u.email)}</td>
          <td data-label="Role" style="padding: 9px 12px; font-weight: 600; color: var(--ink-strong);">${isArchived ? '<span style="color:var(--ink-muted); font-size:12px;">—</span>' : roleBadges}</td>
          <td data-label="Status" style="padding: 9px 12px;">${statusPill}</td>
          <td data-label="Actions" class="col-actions" style="padding: 9px 16px; text-align: right; white-space: nowrap;">${actions}</td>
        </tr>
      `;
    }).join('');
  }

  window.openAssignRolesModal = async function(userId) {
    _currentAssignUserId = userId;
    const user = _systemUsers.find(u => u.id === userId);
    if (!user) return;

    await loadRoles();

    const isLinkedEmployee = !!user.employee_id;
    const display = document.getElementById('assignUserDisplay');
    if (display) display.textContent = `${user.email} · every user has exactly one role`;

    const titleEl = document.getElementById('assignRolesModalTitle');
    if (titleEl) titleEl.textContent = `Change role · ${user.name || user.email}`;

    const headIcon = document.getElementById('assignRolesHeadIcon');
    if (headIcon) {
      headIcon.textContent = initials(user.name || user.email);
    }

    const note = document.getElementById('assignRoleNote');
    if (note) {
      note.textContent = isLinkedEmployee
        ? 'Employee access is automatic for this user. You can add one role on top of it.'
        : 'External user: exactly one role is required. To remove access, archive the user.';
    }

    const current = getUserRole(user);
    const optionStyle = 'display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--fv-line); background: var(--fv-surface); cursor: pointer;';

    const checklist = document.getElementById('assignRolesChecklist');
    if (checklist) {
      // One role per user: radio buttons. The Employee role is derived, so it is never offered.
      const options = _systemRoles.filter(role => !isEmployeeBaselineRole(role)).map(role => {
        const isChecked = !!current && (current.id === role.id || current.name === role.name);
        return `
          <label style="${optionStyle}">
            <input type="radio" name="assignRoleChoice" data-role-id="${role.id}" data-role-name="${escHtml(role.name)}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; margin-top: 2px; accent-color: var(--brand);">
            <div>
              <div style="font-weight: 600; font-size: 13.5px; color: var(--ink-strong);">${escHtml(role.name)}</div>
              <div style="font-size: 12.5px; color: var(--ink-muted);">${escHtml(role.description || '')}</div>
            </div>
          </label>
        `;
      });

      // Only a linked employee may have no assigned role (they keep the Employee baseline).
      const noneOption = isLinkedEmployee ? `
          <label style="${optionStyle}">
            <input type="radio" name="assignRoleChoice" data-role-id="" data-role-name="" ${current ? '' : 'checked'} style="width: 16px; height: 16px; margin-top: 2px; accent-color: var(--brand);">
            <div>
              <div style="font-weight: 600; font-size: 13.5px; color: var(--ink-strong);">No additional role</div>
              <div style="font-size: 12.5px; color: var(--ink-muted);">Employee access only</div>
            </div>
          </label>
        ` : '';

      checklist.innerHTML = noneOption + options.join('');
    }

    openModal('assignRolesModal');
  };

  window.saveUserRoleAssignments = async function(evt) {
    const btn = (evt && evt.currentTarget) || document.getElementById('assignRolesSaveBtn');
    const user = _systemUsers.find(u => u.id === _currentAssignUserId);
    if (!user) return;

    const selected = document.querySelector('#assignRolesChecklist input[name="assignRoleChoice"]:checked');
    const parsedId = selected ? parseInt(selected.dataset.roleId, 10) : NaN;
    const roleId = isNaN(parsedId) ? null : parsedId;

    if (roleId === null && !user.employee_id) {
      toast('An external user must have a role. Archive the user to remove access.', 'fa-solid fa-triangle-exclamation');
      return;
    }

    setButtonLoading(btn, true, 'Saving...');
    try {
      if (isMockMode()) {
        const picked = _systemRoles.find(r => r.id === roleId);
        user.role = picked ? { id: picked.id, name: picked.name, system_key: picked.system_key || null } : null;
        toast('Role saved');
        closeModal('assignRolesModal');
        renderUsersTable();
      } else {
        await Api.setUserRole(_currentAssignUserId, roleId);
        toast('Role saved');
        closeModal('assignRolesModal');
        await loadUsers();
      }
    } catch (err) {
      toast(err.message || 'Failed to save role', 'fa-solid fa-triangle-exclamation');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  window.archiveUser = async function(userId) {
    const user = _systemUsers.find(u => u.id === userId);
    if (!user || user.is_self) return;

    const userOk = await FinanceCommand.confirmAction({
      title: 'Archive user account',
      consequence: `Archive user account "${user.email}"? They will no longer be able to sign in.`,
      actionLabel: 'Archive user',
    });
    if (!userOk.confirmed) return;

    try {
      if (isMockMode()) {
        user.archived_at = new Date().toISOString();
        toast('User account archived');
        renderUsersTable();
      } else {
        await Api.archiveUser(userId);
        toast('User account archived');
        await loadUsers();
      }
    } catch (err) {
      toast(err.message || 'Failed to archive user', 'fa-solid fa-triangle-exclamation');
    }
  };

  window.openExternalUserModal = async function() {
    await loadRoles();
    document.getElementById('fExtUserEmail').value = '';
    document.getElementById('fExtUserName').value = '';
    // One role is required; the derived Employee role is never offered
    const select = document.getElementById('fExtUserRole');
    select.innerHTML = '<option value="">Select a role…</option>' + _systemRoles
      .filter(role => !isEmployeeBaselineRole(role))
      .map(role => `<option value="${Number(role.id)}">${escHtml(role.name)}</option>`)
      .join('');
    openModal('externalUserModal');
  };

  window.saveExternalUser = async function(evt) {
    const btn = (evt && evt.currentTarget) || document.getElementById('extUserSaveBtn');
    const email = document.getElementById('fExtUserEmail').value.trim();
    const name = document.getElementById('fExtUserName').value.trim();
    const roleId = parseInt(document.getElementById('fExtUserRole').value, 10);

    if (!FinanceForm.validateRequiredFields('externalUserModal', [
      { id: 'fExtUserEmail', message: 'Enter a valid email address.', check: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
      { id: 'fExtUserRole', message: 'Select a role for the external user.', check: (v) => !isNaN(parseInt(v, 10)) },
    ])) return;

    setButtonLoading(btn, true, 'Saving...');
    try {
      if (isMockMode()) {
        if (_systemUsers.some(u => (u.email || '').toLowerCase() === email.toLowerCase())) {
          throw new Error('A user with this email already exists.');
        }
        const picked = _systemRoles.find(r => r.id === roleId);
        const newId = _systemUsers.length ? Math.max(..._systemUsers.map(u => u.id)) + 1 : 1;
        _systemUsers.push({
          id: newId,
          name: name || email.split('@')[0],
          email,
          employee_id: null,
          is_external: true,
          is_self: false,
          archived_at: null,
          role: picked ? { id: picked.id, name: picked.name, system_key: picked.system_key || null } : null
        });
        toast('External user added');
        closeModal('externalUserModal');
        renderUsersTable();
      } else {
        await Api.createExternalUser({ email, name, role_id: roleId });
        toast('External user added');
        closeModal('externalUserModal');
        await loadUsers();
      }
    } catch (err) {
      toast(err.message || 'Failed to add external user', 'fa-solid fa-triangle-exclamation');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  // Wire up event listeners
  document.addEventListener('DOMContentLoaded', () => {
    const permSearch = document.getElementById('rolePermSearch');
    if (permSearch) {
      permSearch.addEventListener('input', () => renderPermissionPicker(_pickerReadOnly));
    }

    const userSearch = document.getElementById('systemUsersSearch');
    if (userSearch) {
      userSearch.addEventListener('input', () => {
        if (isMockMode()) { renderUsersTable(); return; }
        clearTimeout(_userSearchTimer);
        _userSearchTimer = setTimeout(() => loadUsers(), 250);
      });
    }

    const kindFilter = document.getElementById('systemUsersFilter');
    if (kindFilter) {
      kindFilter.addEventListener('change', () => {
        if (isMockMode()) renderUsersTable(); else loadUsers();
      });
    }

    const roleFilter = document.getElementById('systemUsersRoleFilter');
    if (roleFilter) {
      roleFilter.addEventListener('change', () => renderUsersTable());
    }
  });

  // Hook into showSection navigation
  window.addEventListener('hrflow:page-loaded', (e) => {
    if (e.detail === 'a-system-roles') {
      loadRoles();
    } else if (e.detail === 'a-system-users') {
      loadUsers();
    }
  });

  window.SystemAccess = {
    loadRoles,
    loadUsers,
    renderRolesTable,
    renderUsersTable,
    computeImpliedPermissions,
  };
})();
