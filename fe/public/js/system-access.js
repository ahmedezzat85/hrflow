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
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text3);">No roles defined.</td></tr>`;
      return;
    }

    tbody.innerHTML = _systemRoles.map(role => {
      const isLocked = !!role.is_locked;
      const isSystem = !!role.system_key;
      const isEmployee = role.system_key === 'employee';
      const noDelete = isLocked || isEmployee;
      const deleteTitle = isLocked ? 'Locked roles cannot be deleted' : (isEmployee ? 'The Employee role provides baseline access and cannot be deleted' : 'Delete role');
      const permCount = (role.permissions || []).length;
      const permText = isLocked ? `All (${_permissionCatalog.length})` : `${permCount} permission${permCount === 1 ? '' : 's'}`;
      const rid = Number(role.id);

      return `
        <tr data-role-id="${rid}">
          <td data-label="Role Name" style="font-weight:600;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span>${escHtml(role.name)}</span>
              ${isSystem ? `<span class="badge" style="background:var(--accent-soft); color:var(--accent); font-size:11px; padding:2px 6px;">System</span>` : ''}
            </div>
          </td>
          <td data-label="Description" style="color:var(--text2); font-size:13px;">${escHtml(role.description) || '—'}</td>
          <td data-label="Assigned Users">
            <span class="badge" style="background:var(--surface2);">${escHtml(role.user_count ?? (role.users ? role.users.length : 0))}</span>
          </td>
          <td data-label="Permissions">
            <span class="badge badge-neutral" style="font-size:12px;">${escHtml(permText)}</span>
          </td>
          <td data-label="Actions" class="col-actions">
            <button class="btn btn-sm btn-outline btn-edit-role" onclick="openEditRoleModal(${rid})" title="${isLocked ? 'View role permissions (read-only)' : 'Edit role permissions'}">
              <i class="fa-solid ${isLocked ? 'fa-eye' : 'fa-pen'}"></i> ${isLocked ? 'View' : 'Edit'}
            </button>
            <button class="btn btn-sm btn-outline btn-delete-role" onclick="deleteRole(${rid})" ${noDelete ? 'disabled' : ''} title="${escHtml(deleteTitle)}" style="${noDelete ? 'opacity:0.4; cursor:not-allowed;' : 'color:var(--danger); border-color:var(--danger);'}">
              <i class="fa-solid fa-trash"></i>
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

      return `
        <div class="perm-group-card" style="border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 12px; background: var(--surface);">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: var(--text); display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-folder-open" style="color:var(--accent); margin-right:6px;"></i>${escHtml(grp)}</span>
            <span style="font-size: 11px; color:var(--text3); font-weight:normal;">${items.length} key${items.length === 1 ? '' : 's'}</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">
            ${items.map(p => `
                <label class="perm-checkbox-item" style="display:flex; align-items:flex-start; gap:8px; font-size:12.5px; cursor:${readOnly ? 'default' : 'pointer'}; margin:0;">
                  <input type="checkbox"
                         data-perm-key="${escHtml(p.key)}"
                         ${readOnly ? 'disabled' : ''}
                         onchange="handlePermissionCheckboxChange(event, this.dataset.permKey)"
                         style="margin-top:2px;">
                  <div>
                    <div style="font-family:monospace; font-size:11.5px; font-weight:600; color:var(--text);">${escHtml(p.key)}</div>
                    <div style="font-size:11px; color:var(--text2);">${escHtml(p.description)}</div>
                  </div>
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
    document.getElementById('roleModalTitle').textContent = 'Create Role';
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
    document.getElementById('roleModalTitle').textContent = `${locked ? 'View' : 'Edit'} Role: ${role.name}`;
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

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text3);">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      const uid = Number(u.id);
      const isArchived = !!u.archived_at;
      const isSelf = !!u.is_self;
      const statusPill = isArchived
        ? `<span class="badge" style="background:var(--danger-soft, #fee2e2); color:var(--danger, #ef4444);"><i class="fa-solid fa-circle-xmark"></i> Archived</span>`
        : `<span class="badge" style="background:var(--success-soft, #dcfce7); color:var(--success, #10b981);"><i class="fa-solid fa-circle-check"></i> Active</span>`;

      const assignedRole = getUserRole(u);
      const roleBadges = assignedRole
        ? `<span class="badge" style="background:var(--accent-soft); color:var(--accent); margin-right:4px;">${escHtml(assignedRole.name)}</span>`
        : `<span style="color:var(--text3); font-size:12px;">${u.employee_id ? 'Employee access only' : 'No role'}</span>`;

      const selfTitle = 'You cannot change your own access';
      let actions;
      if (isArchived) {
        // Archived users keep their record but offer no actions (no reinstatement control until Q-006 is decided)
        actions = '<span style="color:var(--text3); font-size:12px;">—</span>';
      } else {
        actions = `
            <button class="btn btn-sm btn-outline btn-assign-roles" onclick="openAssignRolesModal(${uid})" ${isSelf ? `disabled title="${selfTitle}"` : 'title="Assign role"'}>
              <i class="fa-solid fa-user-gear"></i> Role
            </button>
            <button class="btn btn-sm btn-outline btn-archive-user" onclick="archiveUser(${uid})" ${isSelf ? `disabled title="${selfTitle}"` : 'title="Archive user account"'} style="${isSelf ? 'opacity:0.4; cursor:not-allowed;' : 'color:var(--danger); border-color:var(--danger);'}">
              <i class="fa-solid fa-user-slash"></i> Archive
            </button>`;
      }

      return `
        <tr data-user-id="${uid}">
          <td data-label="User" class="tname">
            <div class="avatar">${escHtml(initials(u.name || u.email))}</div>
            <div>
              <div style="font-weight:600; color:var(--text);">${escHtml(u.name || 'External User')}</div>
              ${u.employee_id ? `<div style="font-size:11px; color:var(--text3);">Employee #${escHtml(u.employee_id)}</div>` : `<span class="badge badge-external" style="font-size:10.5px; padding:1px 6px; background:var(--surface2); color:var(--text2);">External</span>`}
            </div>
          </td>
          <td data-label="Email" style="color:var(--text2); font-size:13px;">${escHtml(u.email)}</td>
          <td data-label="Role">${isArchived ? '<span style="color:var(--text3); font-size:12px;">—</span>' : roleBadges}</td>
          <td data-label="Status">${statusPill}</td>
          <td data-label="Actions" class="col-actions">${actions}</td>
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
    if (display) display.textContent = `Assign a role for ${user.name || user.email} (${user.email})`;

    const note = document.getElementById('assignRoleNote');
    if (note) {
      note.textContent = isLinkedEmployee
        ? 'Employee access is automatic for this user. You can add one role on top of it.'
        : 'External user: exactly one role is required. To remove access, archive the user.';
    }

    const current = getUserRole(user);
    const optionStyle = 'display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid var(--border-color, #e2e8f0); border-radius:6px; background:var(--surface); cursor:pointer;';

    const checklist = document.getElementById('assignRolesChecklist');
    if (checklist) {
      // One role per user: radio buttons. The Employee role is derived, so it is never offered.
      const options = _systemRoles.filter(role => !isEmployeeBaselineRole(role)).map(role => {
        const isChecked = !!current && (current.id === role.id || current.name === role.name);
        return `
          <label style="${optionStyle}">
            <input type="radio" name="assignRoleChoice" data-role-id="${role.id}" data-role-name="${escHtml(role.name)}" ${isChecked ? 'checked' : ''}>
            <div>
              <div style="font-weight:600; font-size:13px; color:var(--text);">${escHtml(role.name)}</div>
              <div style="font-size:11.5px; color:var(--text2);">${escHtml(role.description || '')}</div>
            </div>
          </label>
        `;
      });

      // Only a linked employee may have no assigned role (they keep the Employee baseline).
      const noneOption = isLinkedEmployee ? `
          <label style="${optionStyle}">
            <input type="radio" name="assignRoleChoice" data-role-id="" data-role-name="" ${current ? '' : 'checked'}>
            <div>
              <div style="font-weight:600; font-size:13px; color:var(--text);">No additional role</div>
              <div style="font-size:11.5px; color:var(--text2);">Employee access only</div>
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
