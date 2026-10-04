/**
 * public/js/router.js
 * Hash routing for the whole app: #/<module>/<page>[/<id>][/<step>]
 *
 *   #/hr/employees            #/hr/employee-detail/12
 *   #/finance/invoices        #/finance/accounts/5        #/finance/reports/profit-and-loss
 *   #/payroll/payroll-runs/17/4   (run 17, screen 4)      #/system/roles     #/me/salary
 *
 * showSection() is the single navigation primitive and records the route here.
 * popstate/hashchange restore module, page and the open record. Hashes that do not
 * start with "#/" (e.g. the finance drawer's "#detail=bill:5") are left alone.
 */
const Router = (() => {
  const DEFAULT_PAGE = {
    hr: 'a-dashboard',
    finance: 'a-finance-dashboard',
    payroll: 'a-finance-payroll-runs',
    system: 'a-system-roles',
    me: 'e-dashboard',
  };
  const MODULE_PREFIX = { hr: 'a-', finance: 'a-finance-', payroll: 'a-finance-', system: 'a-system-', me: 'e-' };
  const state = { applying: false, current: { pageId: null, portal: null, params: [] }, seq: 0, lastHash: '' };

  function moduleOfPage(pageId, portal) {
    if (portal === 'employee') return 'me';
    if (window.AdminNav && typeof window.AdminNav.moduleOf === 'function') return window.AdminNav.moduleOf(pageId) || 'hr';
    return 'hr';
  }

  function slugOf(pageId, mod) {
    const prefix = MODULE_PREFIX[mod] || 'a-';
    return pageId.startsWith(prefix) ? pageId.slice(prefix.length) : pageId.replace(/^[ae]-/, '');
  }

  function build(pageId, portal, params) {
    const mod = moduleOfPage(pageId, portal);
    const tail = (params || []).filter((p) => p !== undefined && p !== null && p !== '').map((p) => encodeURIComponent(String(p)));
    return '#/' + [mod, slugOf(pageId, mod), ...tail].join('/');
  }

  function parse(hash) {
    if (!hash || !hash.startsWith('#/')) return null;
    const segs = hash.slice(2).split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    if (segs.length < 2) return segs.length === 1 ? { module: segs[0], page: '', params: [] } : null;
    return { module: segs[0], page: segs[1], params: segs.slice(2) };
  }

  function resolvePage(mod, page) {
    if (!MODULE_PREFIX[mod]) return null;
    if (!page) return DEFAULT_PAGE[mod];
    const id = MODULE_PREFIX[mod] + page;
    return typeof titles !== 'undefined' && titles[id] ? id : null;
  }

  function write(hash, mode) {
    if (location.hash === hash) { state.lastHash = hash; return; }
    try {
      if (mode === 'push') history.pushState(null, '', hash);
      else history.replaceState(null, '', hash);
    } catch (e) { location.hash = hash; }
    state.lastHash = location.hash;
  }

  // Called by showSection for every navigation.
  function record(pageId, portal, params) {
    const prev = state.current;
    state.current = { pageId, portal, params: params || [] };
    state.seq += 1;
    if (state.applying) { state.lastHash = location.hash; return; }
    const hash = build(pageId, portal, params);
    const samePage = prev.pageId === pageId && prev.portal === portal;
    write(hash, samePage ? 'replace' : 'push');
  }

  // Called by record openers (employee profile, account workspace, report, payroll run/step).
  function setParams(params, onlyPages) {
    const cur = state.current;
    if (!cur.pageId) return;
    if (onlyPages && !onlyPages.includes(cur.pageId)) return;
    const hadParams = cur.params.length > 0;
    state.current = { ...cur, params: params || [] };
    if (state.applying) return;
    write(build(cur.pageId, cur.portal, params), !hadParams && (params || []).length > 0 ? 'push' : 'replace');
  }

  // Navigation entry for user clicks and restores: showSection plus the domain loader, exactly once.
  function navigate(pageId, portal, params) {
    showSection(pageId, portal, params);
    if (portal === 'admin' && typeof window.runFinanceLoader === 'function') return window.runFinanceLoader(pageId);
    if (pageId === 'e-payslips' && typeof window.runFinanceLoader === 'function') return window.runFinanceLoader(pageId);
    return undefined;
  }

  function canSee(mod) {
    if (mod === 'me') return true;
    if (window.AdminNav && typeof window.AdminNav.canSeeModule === 'function') return window.AdminNav.canSeeModule(mod);
    return true;
  }

  function fallback(reason) {
    const portal = typeof currentPortal !== 'undefined' && currentPortal === 'employee' ? 'employee' : 'admin';
    let pageId = DEFAULT_PAGE.me;
    if (portal === 'admin') {
      const mod = ['hr', 'finance', 'payroll', 'system'].find((m) => canSee(m)) || 'hr';
      pageId = DEFAULT_PAGE[mod];
    }
    state.applying = true;
    try { navigate(pageId, portal); } finally { state.applying = false; }
    write(build(pageId, portal, []), 'replace');
    const t = titles[pageId];
    toast(reason === 'forbidden'
      ? `You do not have access to that page. Showing ${t ? t[0] : 'your home page'}.`
      : `That page was not found. Showing ${t ? t[0] : 'your home page'}.`, 'fa-solid fa-circle-info');
    return true;
  }

  async function openEntity(pageId, params) {
    if (!params.length) return;
    if (pageId === 'a-employee-detail' && typeof viewProfile === 'function') {
      await viewProfile(params[0]);
    } else if ((pageId === 'a-finance-accounts' || pageId === 'a-finance-banking') && typeof openAccountWorkspace === 'function' && /^\d+$/.test(params[0])) {
      await openAccountWorkspace(parseInt(params[0], 10));
    } else if (pageId === 'a-finance-reports' && typeof openReportFromLibrary === 'function') {
      await openReportFromLibrary(params[0]);
    } else if ((pageId === 'a-finance-payroll-runs' || pageId === 'a-finance-payroll') && window.PayrollApp) {
      await window.PayrollApp.openRun(params[0]);
      const step = parseInt(params[1], 10);
      if (!isNaN(step)) await window.PayrollApp.setStep(step - 1);
    }
  }

  // Restore the page described by a hash. Returns false when the hash is not an app route.
  async function restore(hash) {
    const route = parse(hash);
    if (!route) return false;
    const portal = route.module === 'me' ? 'employee' : 'admin';
    const activePortal = typeof currentPortal !== 'undefined' ? currentPortal : portal;
    const pageId = resolvePage(route.module, route.page);
    if (!pageId) return fallback('unknown');
    if (portal !== activePortal || !canSee(route.module)) return fallback('forbidden');
    state.applying = true;
    try {
      const loaded = navigate(pageId, portal);
      if (loaded && typeof loaded.then === 'function') await loaded.catch(() => {});
      await openEntity(pageId, route.params);
    } finally {
      state.applying = false;
    }
    state.lastHash = location.hash;
    return true;
  }

  // First route after sign-in or reload, once data is loaded.
  async function boot() {
    const handled = await restore(location.hash);
    if (!handled) {
      const portal = typeof currentPortal !== 'undefined' && currentPortal === 'employee' ? 'employee' : 'admin';
      const active = document.querySelector((portal === 'admin' ? '#admin-app' : '#employee-app') + ' .page-section.active');
      if (active) write(build(active.id, portal, []), 'replace');
    }
  }

  function onNavigate() {
    if (location.hash === state.lastHash) return;
    state.lastHash = location.hash;
    restore(location.hash);
  }

  function hrefFor(pageId, portal) { return build(pageId, portal, []); }

  // Real, copyable links on every sidebar item
  function decorateLinks() {
    document.querySelectorAll('#admin-app .nav-item[data-page]').forEach((el) => { el.setAttribute('href', hrefFor(el.dataset.page, 'admin')); });
    document.querySelectorAll('#employee-app .nav-item[data-page]').forEach((el) => { el.setAttribute('href', hrefFor(el.dataset.page, 'employee')); });
  }

  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLinks);
  else decorateLinks();

  return { record, setParams, navigate, restore, boot, build, parse, hrefFor, getSeq: () => state.seq, current: () => state.current };
})();
window.Router = Router;
