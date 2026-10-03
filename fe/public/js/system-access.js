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

  function isMockMode() {
    return typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
  }

  // Fallback / Initial Mock Catalog
  const DEFAULT_CATALOG = [
    { key: "system.users.manage", group: "System / Access", description: "Manage user accounts and identity", assignable: false, implies: [] },
    { key: "system.roles.manage", group: "System / Access", description: "Manage RBAC roles and permissions", assignable: false, implies: [] },
    { key: "system.audit.read", group: "System / Audit", description: "View audit log entries", assignable: false, implies: [] },

    { key: "hr.employee.read", group: "HR / Employees", description: "View company employee profiles", assignable: true, implies: [] },
    { key: "hr.employee.write", group: "HR / Employees", description: "Create, edit, and delete employee records", assignable: true, implies: ["hr.employee.read"] },
    { key: "hr.salary.read", group: "HR / Compensation", description: "View employee salaries and raise history", assignable: true, implies: [] },
    { key: "hr.salary.write", group: "HR / Compensation", description: "Update employee salaries and record compensation changes", assignable: true, implies: ["hr.salary.read"] },
    { key: "hr.employee_bank_account.read", group: "HR / Bank Accounts", description: "View employee bank account details", assignable: true, implies: [] },
    { key: "hr.employee_bank_account.write", group: "HR / Bank Accounts", description: "Create and update employee bank account details", assignable: true, implies: ["hr.employee_bank_account.read"] },
    { key: "hr.employee_bank_account.reveal", group: "HR / Bank Accounts", description: "Reveal unmasked employee bank account and IBAN identifiers", assignable: true, implies: ["hr.employee_bank_account.read"] },
    { key: "hr.employee_document.read", group: "HR / Documents", description: "View employee documents", assignable: true, implies: [] },
    { key: "hr.employee_document.write", group: "HR / Documents", description: "Upload and delete employee documents", assignable: true, implies: ["hr.employee_document.read"] },
    { key: "hr.company_document.read", group: "HR / Documents", description: "View company documents", assignable: true, implies: [] },
    { key: "hr.company_document.write", group: "HR / Documents", description: "Upload and manage company documents", assignable: true, implies: ["hr.company_document.read"] },
    { key: "hr.salary_payment_doc.read", group: "HR / Salary Payment Docs", description: "View salary payment documents and receipts", assignable: true, implies: [] },
    { key: "hr.salary_payment_doc.write", group: "HR / Salary Payment Docs", description: "Upload and manage salary payment documents", assignable: true, implies: ["hr.salary_payment_doc.read"] },
    { key: "hr.vacation.read", group: "HR / Leave", description: "View company vacation requests and balances", assignable: true, implies: [] },
    { key: "hr.vacation.write", group: "HR / Leave", description: "Manage and approve vacation requests", assignable: true, implies: ["hr.vacation.read"] },
    { key: "hr.request.read", group: "HR / Requests", description: "View company employee requests", assignable: true, implies: [] },
    { key: "hr.request.write", group: "HR / Requests", description: "Manage and approve company employee requests", assignable: true, implies: ["hr.request.read"] },
    { key: "hr.insurance.read", group: "HR / Insurance", description: "View medical insurance categories and claims", assignable: true, implies: [] },
    { key: "hr.insurance.write", group: "HR / Insurance", description: "Manage medical insurance categories and process claims", assignable: true, implies: ["hr.insurance.read"] },
    { key: "hr.export.run", group: "HR / Export", description: "Run HR and company data exports", assignable: true, implies: [] },

    { key: "finance.customer.read", group: "Finance / Sales", description: "View customers", assignable: true, implies: [] },
    { key: "finance.customer.write", group: "Finance / Sales", description: "Create, update, and manage customers", assignable: true, implies: ["finance.customer.read"] },
    { key: "finance.invoice.read", group: "Finance / Sales", description: "View sales invoices", assignable: true, implies: [] },
    { key: "finance.invoice.write", group: "Finance / Sales", description: "Create, update, and void sales invoices", assignable: true, implies: ["finance.invoice.read"] },
    { key: "finance.vendor.read", group: "Finance / Spend", description: "View vendors", assignable: true, implies: [] },
    { key: "finance.vendor.write", group: "Finance / Spend", description: "Create, update, and manage vendors", assignable: true, implies: ["finance.vendor.read"] },
    { key: "finance.vendor_payment.manage", group: "Finance / Spend", description: "Add and update sensitive vendor payment details", assignable: true, implies: [] },
    { key: "finance.vendor_payment.verify", group: "Finance / Spend", description: "Verify and approve vendor payment instructions", assignable: true, implies: [] },
    { key: "finance.vendor_payment.reveal", group: "Finance / Spend", description: "Reveal sensitive vendor payment and bank instructions", assignable: true, implies: [] },
    { key: "finance.bill.read", group: "Finance / Spend", description: "View vendor bills", assignable: true, implies: [] },
    { key: "finance.bill.write", group: "Finance / Spend", description: "Create, update, and void vendor bills", assignable: true, implies: ["finance.bill.read"] },
    { key: "finance.subscription.read", group: "Finance / Spend", description: "View vendor subscriptions", assignable: true, implies: [] },
    { key: "finance.subscription.write", group: "Finance / Spend", description: "Create and manage vendor subscriptions", assignable: true, implies: ["finance.subscription.read"] },
    { key: "finance.statutory.read", group: "Finance / Statutory", description: "View statutory obligations and payments", assignable: true, implies: [] },
    { key: "finance.statutory.write", group: "Finance / Statutory", description: "Create and manage statutory obligations and payments", assignable: true, implies: ["finance.statutory.read"] },
    { key: "finance.account.read", group: "Finance / Banking", description: "View company bank accounts", assignable: true, implies: [] },
    { key: "finance.account.write", group: "Finance / Banking", description: "Manage company bank accounts and balances", assignable: true, implies: ["finance.account.read"] },
    { key: "finance.bank_account.reveal", group: "Finance / Banking", description: "Reveal unmasked company bank account identifiers", assignable: true, implies: ["finance.account.read"] },
    { key: "finance.adjustment.manage", group: "Finance / Banking", description: "Authorize and record manual balance adjustments and journal corrections", assignable: true, implies: [] },
    { key: "finance.report.read", group: "Finance / Reports", description: "View finance summary reports and metrics", assignable: true, implies: [] },
    { key: "finance.settings.read", group: "Finance / Settings", description: "View finance settings, feature flags, and rollout controls", assignable: true, implies: [] },
    { key: "finance.settings.write", group: "Finance / Settings", description: "Manage finance settings, feature flags, and rollout controls", assignable: true, implies: ["finance.settings.read"] },

    { key: "finance.payroll.read", group: "Payroll / Processing", description: "View company payroll runs and history", assignable: true, implies: [] },
    { key: "finance.payroll.prepare", group: "Payroll / Processing", description: "Prepare, adjust, and submit payroll runs and compensation plans", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll.approve", group: "Payroll / Processing", description: "Approve and finalize company payroll runs", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll.pay", group: "Payroll / Processing", description: "Disburse payments and post journal entries for payroll runs", assignable: true, implies: ["finance.payroll.read"] },
    { key: "finance.payroll_tax.read", group: "Payroll / Settings", description: "View payroll income tax settings", assignable: true, implies: [] },
    { key: "finance.payroll_tax.write", group: "Payroll / Settings", description: "Create and update payroll income tax settings", assignable: true, implies: ["finance.payroll_tax.read"] },

    { key: "self.profile.read", group: "Self-Service", description: "View own employee profile", assignable: true, implies: [] },
    { key: "self.payslip.read", group: "Self-Service", description: "View own salary payment documents and payslips", assignable: true, implies: [] },
    { key: "self.requests.read", group: "Self-Service", description: "View own submitted requests", assignable: true, implies: [] },
    { key: "self.requests.write", group: "Self-Service", description: "Submit and manage own requests", assignable: true, implies: ["self.requests.read"] },
    { key: "self.salary.read", group: "Self-Service", description: "View own salary and compensation details", assignable: true, implies: [] },
    { key: "self.vacation.read", group: "Self-Service", description: "View own vacation balance and history", assignable: true, implies: [] },
    { key: "self.vacation.write", group: "Self-Service", description: "Submit and cancel own vacation requests", assignable: true, implies: ["self.vacation.read"] },
    { key: "self.claim.read", group: "Self-Service", description: "View own medical insurance claims and consumption", assignable: true, implies: [] },
    { key: "self.claim.write", group: "Self-Service", description: "Submit own medical insurance claims", assignable: true, implies: ["self.claim.read"] },
    { key: "self.bank_account.read", group: "Self-Service", description: "View own masked bank account details", assignable: true, implies: [] },
    { key: "self.document.read", group: "Self-Service", description: "View own employee documents", assignable: true, implies: [] },
    { key: "self.document.write", group: "Self-Service", description: "Upload and manage own employee documents", assignable: true, implies: ["self.document.read"] }
  ];

  const INITIAL_MOCK_ROLES = [
    {
      id: 1,
      name: "Super-Admin",
      description: "Full system and domain administrative access",
      is_system: true,
      assignable: false,
      user_count: 1,
      permissions: DEFAULT_CATALOG.map(p => p.key)
    },
    {
      id: 2,
      name: "HR-Admin",
      description: "HR domain administration and employee operations",
      is_system: true,
      assignable: true,
      user_count: 0,
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
      is_system: true,
      assignable: true,
      user_count: 0,
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
      is_system: true,
      assignable: true,
      user_count: 0,
      permissions: ["finance.payroll.read", "finance.payroll.prepare"]
    }
  ];

  // Same shape as GET /api/access/users: one assigned role (or null). Employee access is derived, never listed.
  const INITIAL_MOCK_USERS = [
    { id: 1, name: "Sarah Connor", email: "sarah@voyance.com", employee_id: 1, is_external: false, archived_at: null, role: { id: 1, name: "Super-Admin", system_key: "super_admin" } },
    { id: 2, name: "John Doe", email: "john@voyance.com", employee_id: 2, is_external: false, archived_at: null, role: null },
    { id: 3, name: "Alex Rivera", email: "alex@voyance.com", employee_id: 3, is_external: false, archived_at: null, role: { id: 2, name: "HR-Admin", system_key: "hr_admin" } },
    { id: 4, name: "Elena Rostova", email: "elena@voyance.com", employee_id: 4, is_external: false, archived_at: null, role: { id: 3, name: "Financial-Admin", system_key: "financial_admin" } },
    { id: 5, name: "Marcus Vance", email: "marcus@voyance.com", employee_id: 5, is_external: false, archived_at: null, role: { id: 4, name: "Payroll-Maker", system_key: "payroll_maker" } }
  ];

  function escHtml(val) {
    return String(val ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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

  async function loadCatalog() {
    if (_permissionCatalog.length > 0) return _permissionCatalog;
    if (isMockMode()) {
      _permissionCatalog = DEFAULT_CATALOG;
      return _permissionCatalog;
    }
    try {
      const data = await Api.getPermissionCatalog();
      _permissionCatalog = (data && data.permissions) ? data.permissions : DEFAULT_CATALOG;
    } catch (_) {
      _permissionCatalog = DEFAULT_CATALOG;
    }
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
      const isSuperAdmin = role.name === 'Super-Admin';
      const isSystem = !!role.is_system;
      const permCount = (role.permissions || []).length;
      const permText = isSuperAdmin ? `All (${_permissionCatalog.length})` : `${permCount} permission${permCount === 1 ? '' : 's'}`;

      return `
        <tr data-role-id="${role.id}">
          <td data-label="Role Name" style="font-weight:600;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span>${role.name}</span>
              ${isSystem ? `<span class="badge" style="background:var(--accent-soft); color:var(--accent); font-size:11px; padding:2px 6px;">System</span>` : ''}
            </div>
          </td>
          <td data-label="Description" style="color:var(--text2); font-size:13px;">${role.description || '—'}</td>
          <td data-label="Assigned Users">
            <span class="badge" style="background:var(--surface2);">${role.user_count ?? (role.users ? role.users.length : 0)}</span>
          </td>
          <td data-label="Permissions">
            <span class="badge badge-neutral" style="font-size:12px;">${permText}</span>
          </td>
          <td data-label="Actions" class="col-actions">
            <button class="btn btn-sm btn-outline btn-edit-role" onclick="openEditRoleModal(${role.id})" ${isSuperAdmin ? 'disabled title="Super-Admin role cannot be modified"' : 'title="Edit role permissions"'}>
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="btn btn-sm btn-outline btn-delete-role" onclick="deleteRole(${role.id})" ${isSystem ? 'disabled title="System roles cannot be deleted"' : 'title="Delete role"'} style="${isSystem ? 'opacity:0.4; cursor:not-allowed;' : 'color:var(--danger); border-color:var(--danger);'}">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPermissionPicker() {
    const container = document.getElementById('rolePermissionsContainer');
    if (!container) return;

    // Group permissions by category
    const groups = {};
    for (const p of _permissionCatalog) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }

    const q = (document.getElementById('rolePermSearch')?.value || '').toLowerCase().trim();

    container.innerHTML = Object.keys(groups).map(grp => {
      const items = groups[grp].filter(p => !q || p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
      if (items.length === 0) return '';

      return `
        <div class="perm-group-card" style="border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; padding: 12px; background: var(--surface);">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: var(--text); display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fa-solid fa-folder-open" style="color:var(--accent); margin-right:6px;"></i>${grp}</span>
            <span style="font-size: 11px; color:var(--text3); font-weight:normal;">${items.length} key${items.length === 1 ? '' : 's'}</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px;">
            ${items.map(p => {
              const isAssignable = p.assignable !== false;
              return `
                <label class="perm-checkbox-item" style="display:flex; align-items:flex-start; gap:8px; font-size:12.5px; cursor:${isAssignable ? 'pointer' : 'not-allowed'}; opacity:${isAssignable ? '1' : '0.6'}; margin:0;">
                  <input type="checkbox"
                         data-perm-key="${p.key}"
                         ${!isAssignable ? 'disabled title="Reserved to Super-Admin"' : ''}
                         onchange="handlePermissionCheckboxChange(event, '${p.key}')"
                         style="margin-top:2px;">
                  <div>
                    <div style="font-family:monospace; font-size:11.5px; font-weight:600; color:var(--text);">${p.key}</div>
                    <div style="font-size:11px; color:var(--text2);">${p.description}</div>
                    <div class="perm-implied-badge" data-implied-badge="${p.key}" style="display:none; font-size:10px; color:var(--accent); font-weight:600;">(implied)</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    syncImplicationUI();
  }

  function syncImplicationUI() {
    // Implied keys computed from explicitly checked permissions
    const implied = computeImpliedPermissions(_userExplicitPermissions);

    document.querySelectorAll('#rolePermissionsContainer input[type="checkbox"]').forEach(cb => {
      const key = cb.dataset.permKey;
      const def = _permissionCatalog.find(p => p.key === key);
      const isAssignable = def ? def.assignable !== false : true;
      const badge = document.querySelector(`[data-implied-badge="${key}"]`);

      if (!isAssignable) return;

      if (_userExplicitPermissions.has(key)) {
        cb.checked = true;
        cb.disabled = false;
        if (badge) badge.style.display = 'none';
      } else if (implied.has(key)) {
        cb.checked = true;
        cb.disabled = true;
        if (badge) badge.style.display = 'block';
      } else {
        cb.checked = false;
        cb.disabled = false;
        if (badge) badge.style.display = 'none';
      }
    });
  }

  window.handlePermissionCheckboxChange = function(evt, key) {
    if (evt.target.checked) {
      _userExplicitPermissions.add(key);
    } else {
      _userExplicitPermissions.delete(key);
    }
    syncImplicationUI();
  };

  window.openCreateRoleModal = function() {
    _currentEditingRoleId = null;
    _userExplicitPermissions.clear();
    document.getElementById('roleModalTitle').textContent = 'Create Role';
    document.getElementById('fRoleName').value = '';
    document.getElementById('fRoleName').readOnly = false;
    document.getElementById('fRoleDescription').value = '';
    renderPermissionPicker();
    document.getElementById('roleModal').classList.add('active');
  };

  window.openEditRoleModal = function(roleId) {
    const role = _systemRoles.find(r => r.id === roleId);
    if (!role) return;
    if (role.name === 'Super-Admin') {
      toast('Super-Admin role cannot be edited', 'fa-solid fa-triangle-exclamation');
      return;
    }
    _currentEditingRoleId = roleId;
    _userExplicitPermissions = new Set(role.permissions || []);
    document.getElementById('roleModalTitle').textContent = `Edit Role: ${role.name}`;
    document.getElementById('fRoleName').value = role.name;
    document.getElementById('fRoleName').readOnly = !!role.is_system;
    document.getElementById('fRoleDescription').value = role.description || '';
    renderPermissionPicker();
    document.getElementById('roleModal').classList.add('active');
  };

  window.saveRole = async function(evt) {
    const btn = (evt && evt.currentTarget) || document.getElementById('roleModalSaveBtn');
    const name = document.getElementById('fRoleName').value.trim();
    const description = document.getElementById('fRoleDescription').value.trim();

    if (!name) {
      toast('Please enter a role name', 'fa-solid fa-triangle-exclamation');
      return;
    }

    // Combine explicit + implied
    const implied = computeImpliedPermissions(_userExplicitPermissions);
    const finalPermissions = Array.from(new Set([..._userExplicitPermissions, ...implied]));

    if (finalPermissions.length === 0) {
      toast('Please select at least one permission for this role', 'fa-solid fa-triangle-exclamation');
      return;
    }

    setButtonLoading(btn, true, 'Saving...');
    try {
      if (isMockMode()) {
        if (_currentEditingRoleId) {
          const role = _systemRoles.find(r => r.id === _currentEditingRoleId);
          if (role) {
            role.name = name;
            role.description = description;
            role.permissions = finalPermissions;
          }
          toast('Role updated successfully');
        } else {
          const newId = _systemRoles.length ? Math.max(..._systemRoles.map(r => r.id)) + 1 : 1;
          _systemRoles.push({
            id: newId,
            name,
            description,
            is_system: false,
            assignable: true,
            user_count: 0,
            permissions: finalPermissions
          });
          toast('New role created');
        }
        closeModal('roleModal');
        renderRolesTable();
      } else {
        if (_currentEditingRoleId) {
          await Api.updateRole(_currentEditingRoleId, { description, permissions: finalPermissions });
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

    if (role.is_system) {
      toast('System roles cannot be deleted', 'fa-solid fa-triangle-exclamation');
      return;
    }

    const userCount = role.user_count ?? (role.users ? role.users.length : 0);
    if (userCount > 0) {
      toast(`Cannot delete role assigned to ${userCount} active user(s)`, 'fa-solid fa-triangle-exclamation');
      return;
    }

    if (!confirm(`Are you sure you want to delete role "${role.name}"?`)) return;

    try {
      if (isMockMode()) {
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

  async function loadUsers() {
    const loadingBar = document.getElementById('usersTableLoadingBar');
    if (loadingBar) loadingBar.style.display = 'block';
    try {
      if (isMockMode()) {
        if (_systemUsers.length === 0) {
          _systemUsers = JSON.parse(JSON.stringify(INITIAL_MOCK_USERS));
        }
      } else {
        const data = await Api.getUsers();
        _systemUsers = Array.isArray(data) ? data : (data.users || []);
      }
      renderUsersTable();
    } catch (err) {
      toast(err.message || 'Failed to load users', 'fa-solid fa-triangle-exclamation');
    } finally {
      if (loadingBar) loadingBar.style.display = 'none';
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('systemUsersTableBody');
    if (!tbody) return;

    const q = (document.getElementById('systemUsersSearch')?.value || '').toLowerCase().trim();
    const roleFilter = document.getElementById('systemUsersRoleFilter')?.value || 'all';

    const filtered = _systemUsers.filter(u => {
      const roleName = (getUserRole(u) || {}).name || '';
      const matchesSearch = !q || (u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q)) || roleName.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || roleName === roleFilter;
      return matchesSearch && matchesRole;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text3);">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      const isArchived = !!u.is_archived || !!u.archived_at;
      const statusPill = isArchived
        ? `<span class="badge" style="background:var(--danger-soft, #fee2e2); color:var(--danger, #ef4444);"><i class="fa-solid fa-circle-xmark"></i> Archived</span>`
        : `<span class="badge" style="background:var(--success-soft, #dcfce7); color:var(--success, #10b981);"><i class="fa-solid fa-circle-check"></i> Active</span>`;

      const assignedRole = getUserRole(u);
      const roleBadges = assignedRole
        ? `<span class="badge" style="background:var(--accent-soft); color:var(--accent); margin-right:4px;">${escHtml(assignedRole.name)}</span>`
        : `<span style="color:var(--text3); font-size:12px;">${u.employee_id ? 'Employee access only' : 'No role'}</span>`;

      return `
        <tr data-user-id="${u.id}">
          <td data-label="User" class="tname">
            <div class="avatar">${initials(u.name || u.email)}</div>
            <div>
              <div style="font-weight:600; color:var(--text);">${escHtml(u.name || 'External User')}</div>
              ${u.employee_id ? `<div style="font-size:11px; color:var(--text3);">Employee #${u.employee_id}</div>` : `<div style="font-size:11px; color:var(--text3);">External Account</div>`}
            </div>
          </td>
          <td data-label="Email" style="color:var(--text2); font-size:13px;">${escHtml(u.email)}</td>
          <td data-label="Role">${roleBadges}</td>
          <td data-label="Status">${statusPill}</td>
          <td data-label="Actions" class="col-actions">
            <button class="btn btn-sm btn-outline btn-assign-roles" onclick="openAssignRolesModal(${u.id})" title="Assign role">
              <i class="fa-solid fa-user-gear"></i> Role
            </button>
            ${isArchived
              ? `<button class="btn btn-sm btn-outline btn-unarchive-user" onclick="toggleUserArchive(${u.id}, false)" title="Restore user access" style="color:var(--success); border-color:var(--success);"><i class="fa-solid fa-rotate-left"></i> Restore</button>`
              : `<button class="btn btn-sm btn-outline btn-archive-user" onclick="toggleUserArchive(${u.id}, true)" title="Archive user account" style="color:var(--danger); border-color:var(--danger);"><i class="fa-solid fa-user-slash"></i> Archive</button>`
            }
          </td>
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

    document.getElementById('assignRolesModal').classList.add('active');
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

  window.toggleUserArchive = async function(userId, archive) {
    const user = _systemUsers.find(u => u.id === userId);
    if (!user) return;

    const actionText = archive ? 'archive' : 'restore';
    if (!confirm(`Are you sure you want to ${actionText} user account "${user.email}"?`)) return;

    try {
      if (isMockMode()) {
        user.is_archived = archive;
        user.archived_at = archive ? new Date().toISOString() : null;
        toast(`User account ${archive ? 'archived' : 'restored'}`);
        renderUsersTable();
      } else {
        if (archive) {
          await Api.archiveUser(userId);
        } else {
          await Api.unarchiveUser(userId);
        }
        toast(`User account ${archive ? 'archived' : 'restored'}`);
        await loadUsers();
      }
    } catch (err) {
      toast(err.message || `Failed to ${actionText} user`, 'fa-solid fa-triangle-exclamation');
    }
  };

  // Wire up event listeners
  document.addEventListener('DOMContentLoaded', () => {
    const permSearch = document.getElementById('rolePermSearch');
    if (permSearch) {
      permSearch.addEventListener('input', () => renderPermissionPicker());
    }

    const userSearch = document.getElementById('systemUsersSearch');
    if (userSearch) {
      userSearch.addEventListener('input', () => renderUsersTable());
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
