(function () {
  'use strict';

  // Module Registry & Metadata
  const MODULES = {
    hr: {
      id: 'hr',
      title: 'HR',
      sub: 'People, leave and salary documents',
      icon: 'fa-people-group',
      groupId: 'adminHrNavGroup',
      pages: [
        'a-dashboard',
        'a-employees',
        'a-employee-detail',
        'a-requests',
        'a-salary',
        'a-invoices',
        'a-vacations',
        'a-insurance',
        'a-dochub',
      ],
    },
    finance: {
      id: 'finance',
      title: 'Finance',
      sub: 'Ledger, bills, banking and reports',
      icon: 'fa-coins',
      groupId: 'adminFinanceNavGroup',
      pages: [
        'a-finance-dashboard',
        'a-finance-sales',
        'a-finance-invoices',
        'a-finance-spend',
        'a-finance-bills',
        'a-finance-subscriptions',
        'a-finance-statutory',
        'a-finance-banking',
        'a-finance-accounts',
        'a-finance-transfers',
        'a-finance-cheques',
        'a-finance-statements',
        'a-finance-reports',
        'a-finance-settings',
      ],
    },
    payroll: {
      id: 'payroll',
      title: 'Payroll',
      sub: 'Payroll cycles, calculations and bank configuration',
      icon: 'fa-money-check-dollar',
      groupId: 'adminPayrollNavGroup',
      pages: [
        'a-finance-payroll',
        'a-finance-payroll-runs',
        'a-finance-payroll-settings',
      ],
    },
  };

  let activeModuleId = 'hr';

  function moduleOf(pageId) {
    if (!pageId) return activeModuleId;
    for (const modId of Object.keys(MODULES)) {
      if (MODULES[modId].pages.includes(pageId)) {
        return modId;
      }
    }
    // Unknown or unlisted page keeps current module (C4)
    return activeModuleId;
  }

  function canSeeModule(moduleId) {
    if (moduleId === 'hr') return true;
    if (moduleId === 'finance' || moduleId === 'payroll') {
      if (typeof SessionInfo === 'undefined') return true;
      const role = SessionInfo.getRole();
      const perms = typeof SessionInfo.getPermissions === 'function' ? SessionInfo.getPermissions() : [];
      const hasFinancePerm = perms.some((p) => p.startsWith('finance.'));
      return role === 'admin' || role === 'system_admin' || hasFinancePerm;
    }
    return true;
  }

  function setModule(moduleId) {
    if (!MODULES[moduleId]) return;
    activeModuleId = moduleId;

    // Update rail buttons
    document.querySelectorAll('#adminSidebar .rail-btn[data-module]').forEach((btn) => {
      const isCur = btn.dataset.module === moduleId;
      btn.classList.toggle('active', isCur);
      btn.classList.toggle('on', isCur);
      if (isCur) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    // Update panel header
    const titleEl = document.getElementById('adminNavPanelTitle');
    const subEl = document.getElementById('adminNavPanelSub');
    if (titleEl) titleEl.textContent = MODULES[moduleId].title;
    if (subEl) subEl.textContent = MODULES[moduleId].sub;

    // Switch visible nav group in panel
    const hrGroup = document.getElementById('adminHrNavGroup');
    const financeGroup = document.getElementById('adminFinanceNavGroup');
    const payrollGroup = document.getElementById('adminPayrollNavGroup');

    if (moduleId === 'hr') {
      if (hrGroup) hrGroup.removeAttribute('hidden');
      if (financeGroup) financeGroup.setAttribute('hidden', 'until-found');
      if (payrollGroup) payrollGroup.setAttribute('hidden', 'until-found');
    } else if (moduleId === 'finance') {
      if (hrGroup) hrGroup.setAttribute('hidden', 'until-found');
      if (financeGroup) {
        if (canSeeModule('finance')) {
          financeGroup.removeAttribute('hidden');
        } else {
          financeGroup.setAttribute('hidden', 'until-found');
        }
      }
      if (payrollGroup) payrollGroup.setAttribute('hidden', 'until-found');
    } else if (moduleId === 'payroll') {
      if (hrGroup) hrGroup.setAttribute('hidden', 'until-found');
      if (financeGroup) financeGroup.setAttribute('hidden', 'until-found');
      if (payrollGroup) {
        if (canSeeModule('payroll')) {
          payrollGroup.removeAttribute('hidden');
        } else {
          payrollGroup.setAttribute('hidden', 'until-found');
        }
      }
    }
  }

  function syncFromPage(pageId) {
    const targetModule = moduleOf(pageId);
    if (targetModule && targetModule !== activeModuleId) {
      setModule(targetModule);
    }
  }

  function togglePanel() {
    if (typeof window.toggleSidebarCollapse === 'function') {
      window.toggleSidebarCollapse('adminSidebar');
    }
  }

  function go(pageId) {
    if (typeof window.showSection === 'function') {
      window.showSection(pageId, 'admin');
    }
    if (typeof window.runFinanceLoader === 'function') {
      window.runFinanceLoader(pageId);
    }
    if (typeof PayrollApp !== 'undefined' && PayrollApp.showPage) {
      if (pageId === 'a-finance-payroll' || pageId === 'a-finance-payroll-runs') {
        PayrollApp.showPage('list');
      } else if (pageId === 'a-finance-payroll-settings') {
        PayrollApp.showPage('settings');
      }
    }
  }

  function syncBadges() {
    const reqBadge = document.getElementById('reqBadge');
    const hrDot = document.getElementById('hrRailDot');
    if (reqBadge && hrDot) {
      const text = (reqBadge.textContent || '').trim();
      const count = parseInt(text, 10);
      if (!isNaN(count) && count > 0) {
        hrDot.style.display = 'block';
        reqBadge.style.display = '';
      } else {
        hrDot.style.display = 'none';
        reqBadge.style.display = 'none';
      }
    }
  }

  function syncModuleVisibility() {
    const financeBtn = document.getElementById('financeRailBtn');
    if (financeBtn) {
      if (canSeeModule('finance')) {
        financeBtn.style.display = '';
      } else {
        financeBtn.style.display = 'none';
        if (activeModuleId === 'finance') {
          setModule('hr');
        }
      }
    }
    const payrollBtn = document.getElementById('payrollRailBtn');
    if (payrollBtn) {
      if (canSeeModule('payroll')) {
        payrollBtn.style.display = '';
      } else {
        payrollBtn.style.display = 'none';
        if (activeModuleId === 'payroll') {
          setModule('hr');
        }
      }
    }
  }

  function init() {
    // Bind click handlers to rail module buttons
    document.querySelectorAll('#adminSidebar .rail-btn[data-module]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const modId = btn.dataset.module;
        if (modId) {
          setModule(modId);
        }
      });
    });

    // Observer for reqBadge changes
    const reqBadge = document.getElementById('reqBadge');
    if (reqBadge && window.MutationObserver) {
      const observer = new MutationObserver(() => syncBadges());
      observer.observe(reqBadge, { childList: true, characterData: true, subtree: true });
    }
    syncBadges();
    syncModuleVisibility();

    // Keyboard support: Escape closes mobile drawer and focuses hamburger (AC 8)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const adminSidebar = document.getElementById('adminSidebar');
        if (adminSidebar && adminSidebar.classList.contains('open')) {
          if (typeof window.closeAllSidebars === 'function') {
            window.closeAllSidebars();
          }
          const hamb = document.querySelector('#admin-app .hamburger');
          if (hamb) hamb.focus();
        }
      }
    });

    window.addEventListener('hrflow:session-changed', () => {
      syncModuleVisibility();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export single public API
  window.AdminNav = {
    moduleOf,
    canSeeModule,
    setModule,
    syncFromPage,
    togglePanel,
    go,
    syncBadges,
    syncModuleVisibility,
    getActiveModule: () => activeModuleId,
  };
})();
