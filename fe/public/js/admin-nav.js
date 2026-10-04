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
    system: {
      id: 'system',
      title: 'System',
      sub: 'Roles, permissions and user accounts',
      icon: 'fa-shield-halved',
      groupId: 'adminSystemNavGroup',
      pages: [
        'a-system-roles',
        'a-system-users',
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
    if (typeof SessionInfo === 'undefined') return true;
    const perms = typeof SessionInfo.getPermissions === 'function' ? SessionInfo.getPermissions() : [];
    if (perms.length === 0 && !SessionInfo.isKnown()) return true;
    if (moduleId === 'hr') {
      return perms.some((p) => p.startsWith('hr.'));
    }
    if (moduleId === 'finance') {
      return perms.some((p) => p.startsWith('finance.') && !p.startsWith('finance.payroll.') && !p.startsWith('finance.payroll_tax.'));
    }
    if (moduleId === 'payroll') {
      return perms.some((p) => p.startsWith('finance.payroll.') || p.startsWith('finance.payroll_tax.'));
    }
    if (moduleId === 'system') {
      return perms.includes('system.roles.manage') || perms.includes('system.users.manage');
    }
    return false;
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
    const groups = {
      hr: document.getElementById('adminHrNavGroup'),
      finance: document.getElementById('adminFinanceNavGroup'),
      payroll: document.getElementById('adminPayrollNavGroup'),
      system: document.getElementById('adminSystemNavGroup'),
    };

    Object.keys(groups).forEach((modId) => {
      const el = groups[modId];
      if (!el) return;
      if (modId === moduleId && canSeeModule(modId)) {
        el.removeAttribute('hidden');
      } else {
        el.setAttribute('hidden', 'until-found');
      }
    });
  }

  function syncFromPage(pageId) {
    const targetModule = moduleOf(pageId);
    // "Add Transaction" follows the page being viewed, not the nav panel being browsed
    const quickAddBtn = document.getElementById('adminQuickAddTxBtn');
    if (quickAddBtn) quickAddBtn.hidden = targetModule !== 'finance';
    if (targetModule && targetModule !== activeModuleId) {
      setModule(targetModule);
    }
  }

  function togglePanel() {
    if (typeof window.toggleSidebarCollapse === 'function') {
      window.toggleSidebarCollapse('adminSidebar');
    }
  }

  // One navigation entry: showSection (page, payroll sub-page, hash) plus the domain loader, once.
  function go(pageId) {
    if (window.Router) {
      Router.navigate(pageId, 'admin');
    } else if (typeof window.showSection === 'function') {
      window.showSection(pageId, 'admin');
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
    const modules = ['hr', 'finance', 'payroll', 'system'];
    modules.forEach((modId) => {
      const btn = document.getElementById(`${modId}RailBtn`);
      if (btn) {
        btn.style.display = canSeeModule(modId) ? '' : 'none';
      }
    });

    if (!canSeeModule(activeModuleId)) {
      const firstVisible = modules.find((modId) => canSeeModule(modId));
      if (firstVisible) {
        setModule(firstVisible);
        const defaultPages = {
          hr: 'a-dashboard',
          finance: 'a-finance-dashboard',
          payroll: 'a-finance-payroll-runs',
          system: 'a-system-roles',
        };
        go(defaultPages[firstVisible]);
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
