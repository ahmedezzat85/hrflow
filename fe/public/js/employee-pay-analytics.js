/**
 * Employee detail: Overview / Pay analytics tabs (#a-employee-detail).
 * Overview is the existing page; the Pay analytics panel is lazy and renders only
 * the sections the viewer is permitted to see (HR plan, Finance payments).
 */
(function (root) {
  const state = { empId: null, active: 'overview', loaded: false };

  function hasPerm(key) {
    return typeof SessionInfo !== 'undefined' && SessionInfo.hasPermission(key);
  }
  function canViewPlan() { return hasPerm('hr.salary.read'); }
  function canViewPayments() { return hasPerm('finance.report.read'); }
  function tabVisible() { return canViewPlan() || canViewPayments(); }

  const $ = (id) => document.getElementById(id);

  function selectTab(which, opts) {
    const o = opts || {};
    if (which === 'pay' && !tabVisible()) which = 'overview';
    state.active = which;
    const pay = which === 'pay';
    const tabs = { overview: $('employeeOverviewTab'), pay: $('employeePayTab') };
    const panels = { overview: $('employeeOverviewPanel'), pay: $('employeePayPanel') };
    if (!tabs.overview || !panels.overview) return;
    Object.keys(tabs).forEach((k) => {
      const on = k === which;
      tabs[k].classList.toggle('is-active', on);
      tabs[k].setAttribute('aria-selected', String(on));
      tabs[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (o.focus) tabs[which].focus();
    if (pay && !state.loaded) {
      state.loaded = true;
      if (root.EmployeePayAnalyticsPanel && typeof root.EmployeePayAnalyticsPanel.open === 'function') {
        root.EmployeePayAnalyticsPanel.open(state.empId);
      }
    }
  }

  // Arrow/Home/End keys come from the shared initAccessibleTablist (finance-core.js), which clicks the target tab.
  let wired = false;
  function wire() {
    if (wired) return;
    const strip = $('employeeDetailTabs');
    if (!strip) return;
    wired = true;
    $('employeeOverviewTab').addEventListener('click', () => selectTab('overview'));
    $('employeePayTab').addEventListener('click', () => selectTab('pay'));
  }

  // Called from viewProfile for every employee shown: reset to Overview, clear Pay state.
  function onEmployee(id) {
    wire();
    const strip = $('employeeDetailTabs');
    if (!strip) return;
    const changed = String(state.empId) !== String(id);
    if (changed) {
      state.empId = id;
      state.loaded = false;
      if (root.EmployeePayAnalyticsPanel && typeof root.EmployeePayAnalyticsPanel.reset === 'function') {
        root.EmployeePayAnalyticsPanel.reset();
      }
      selectTab('overview');
    }
    state.empId = id;
    strip.hidden = !tabVisible();
  }

  root.EmployeePayAnalytics = { onEmployee, selectTab, canViewPlan, canViewPayments, tabVisible };
})(window);
