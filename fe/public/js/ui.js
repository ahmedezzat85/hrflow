function showAppLoader(title, message){
  const overlay = document.getElementById('appLoader');
  if(!overlay) return;
  const h = overlay.querySelector('h3');
  const p = overlay.querySelector('p');
  h.textContent = title || 'Loading HRFlow';
  p.textContent = message || 'Fetching your latest data, this only takes a moment.';
  overlay.style.display = 'flex';
}
function hideAppLoader(){
  const overlay = document.getElementById('appLoader');
  if(!overlay) return;
  overlay.style.display = 'none';
}

function showTableSkeleton(tbodyId, colCount, rowCount=5){
  const body = document.getElementById(tbodyId);
  if(!body) return;
  let rows = '';
  for(let r=0;r<rowCount;r++){
    let cells = `<td><div style="display:flex;align-items:center;gap:10px;"><span class="skeleton skeleton-avatar"></span><span class="skeleton skeleton-line" style="width:120px;"></span></div></td>`;
    for(let c=1;c<colCount;c++){ cells += `<td><span class="skeleton skeleton-line" style="width:${60 + (c*13)%70}px;"></span></td>`; }
    rows += `<tr class="skeleton-row">${cells}</tr>`;
  }
  body.innerHTML = rows;
}
/**
 * Shared HTML-escaping helpers. Every module that interpolates data into
 * innerHTML delegates to escapeHtml(); use setText() when no markup is needed.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function setText(el, value) {
  if (el) el.textContent = value === null || value === undefined ? '' : String(value);
}

// Delegated handler for row actions that carry their data in data-* attributes
// (no inline onclick with data embedded in a JS string).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (el.tagName === 'A') e.preventDefault();
  const num = (v) => (v !== '' && !isNaN(v) ? Number(v) : v);
  switch (d.action) {
    case 'preview-employee-doc': return previewEmployeeDocument(num(d.id), d.name, d.type);
    case 'preview-company-doc': return previewCompanyDocument(num(d.id), d.name, d.type);
    case 'preview-salary-doc': return previewInvoicePdf(num(d.id), d.number);
    case 'regenerate-salary-doc':
      return openRegenerateInvoiceModal(num(d.employeeId), d.name, num(d.year), num(d.month), d.number);
    case 'open-employee-profile': return viewProfile(num(d.employeeId));
    case 'payroll-fix-issue': return PayrollApp.fixIssue(d.code, d.employeeId ? num(d.employeeId) : null);
    case 'payroll-recheck': return PayrollApp.recheckReadiness();
    case 'open-comp-plan': return openCompPlanModal(num(d.employeeId));
    case 'open-employee-bank': return openEmployeeBankSection(num(d.employeeId));
    case 'view-own-claim-receipt': return viewOwnClaimReceipt(Number(d.index));
    case 'view-claim-receipt': return viewClaimReceipt(num(d.id));
    default: return undefined;
  }
});

// Dropzones behave like buttons for the keyboard: Enter or Space opens the file picker.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const zone = e.target.closest && e.target.closest('.doc-drop-zone[role="button"]');
  if (!zone || e.target !== zone) return;
  e.preventDefault();
  zone.click();
});

document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('is-invalid') && window.FinanceForm) FinanceForm.clearFieldError(e.target);
});
document.addEventListener('change', (e) => {
  if (e.target.classList && e.target.classList.contains('is-invalid') && window.FinanceForm) FinanceForm.clearFieldError(e.target);
});

function showSectionLoadingBar(id){ const el = document.getElementById(id); if(el) el.classList.add('show'); }
function hideSectionLoadingBar(id){ const el = document.getElementById(id); if(el) el.classList.remove('show'); }

/**
 * Standardized Empty & Loading state helpers across all domain modules
 */
function getEmptyStateHtml(message = 'No data available.', icon = 'fa-solid fa-inbox') {
  return `<div class="empty-state"><i class="${escapeHtml(icon)}"></i><p>${escapeHtml(message)}</p></div>`;
}

function getEmptyTableRowHtml(colCount = 1, message = 'No data available.', icon = 'fa-solid fa-inbox') {
  return `<tr><td colspan="${colCount}">${getEmptyStateHtml(message, icon)}</td></tr>`;
}

function getLoadingStateHtml(message = 'Loading data...') {
  return `<div class="empty-state loading-state"><i class="fa-solid fa-circle-notch fa-spin" style="color:var(--accent-text);"></i><p style="color:var(--text2);margin-top:10px;">${message}</p></div>`;
}

function getLoadingTableRowHtml(colCount = 1, message = 'Loading data...') {
  return `<tr><td colspan="${colCount}">${getLoadingStateHtml(message)}</td></tr>`;
}

function renderEmptyState(target, message, icon = 'fa-solid fa-inbox') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  const html = getEmptyStateHtml(message, icon);
  if (el) el.innerHTML = html;
  return html;
}

function renderEmptyTableRow(colCount, message, icon = 'fa-solid fa-inbox') {
  return getEmptyTableRowHtml(colCount, message, icon);
}

function renderLoadingState(target, message = 'Loading...') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  const html = getLoadingStateHtml(message);
  if (el) el.innerHTML = html;
  return html;
}

function renderLoadingTableRow(colCount, message = 'Loading...') {
  return getLoadingTableRowHtml(colCount, message);
}

function toggleSidebarCollapse(id){
  if (id === 'adminSidebar') {
    const sidebar = document.getElementById('adminSidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('panel-collapsed');
    const collapsed = sidebar.classList.contains('panel-collapsed');
    localStorage.setItem('hrflow.admin.navPanelCollapsed', collapsed ? '1' : '0');
    return;
  }
  const sidebar = document.getElementById(id);
  if(!sidebar) return;
  sidebar.classList.toggle('collapsed');
  const collapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('hrflow-sidebar-collapsed', collapsed ? '1' : '0');
}
function applySavedSidebarCollapse(){
  const adminCollapsed = localStorage.getItem('hrflow.admin.navPanelCollapsed') === '1';
  const adminSidebar = document.getElementById('adminSidebar');
  if (adminSidebar && adminCollapsed) {
    adminSidebar.classList.add('panel-collapsed');
  }

  const empCollapsed = localStorage.getItem('hrflow-sidebar-collapsed') === '1';
  if(!empCollapsed) return;
  const empSidebar = document.getElementById('empSidebar');
  if (empSidebar) {
    empSidebar.classList.add('collapsed');
  }
}

function getInitials(name){
  if(!name) return '--';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase() || '--';
}

// On phones the closed navigation drawer is off-screen: make it inert so it is not focusable.
function syncSidebarInert(){
  const mobile = window.matchMedia('(max-width: 768px)').matches;
  ['adminSidebar', 'empSidebar'].forEach(sid => {
    const el = document.getElementById(sid);
    if (!el) return;
    if (mobile && !el.classList.contains('open')) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });
}
window.addEventListener('resize', syncSidebarInert);
document.addEventListener('DOMContentLoaded', syncSidebarInert);

function toggleSidebar(id){
  const sb = document.getElementById(id);
  if(!sb) return;
  sb.classList.toggle('open');
  syncSidebarInert();
  const isOpened = sb.classList.contains('open');
  const backdrop = document.getElementById(id === 'adminSidebar' ? 'adminSidebarBackdrop' : 'empSidebarBackdrop');
  if(backdrop) backdrop.classList.toggle('active', isOpened);
}

function closeAllSidebars(){
  ['adminSidebar', 'empSidebar'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.classList.remove('open');
  });
  ['adminSidebarBackdrop', 'empSidebarBackdrop'].forEach(bid => {
    const el = document.getElementById(bid);
    if (el) el.classList.remove('active');
  });
  syncSidebarInert();
}

// One delegated handler for every sidebar item: one click is one navigation and one loader run.
document.addEventListener('click', (e) => {
  const el = e.target.closest('.nav-item[data-page]');
  if (!el) return;
  const portal = el.closest('#employee-app') ? 'employee' : (el.closest('#admin-app') ? 'admin' : null);
  if (!portal) return;
  e.preventDefault();
  if (window.Router) Router.navigate(el.dataset.page, portal);
  else showSection(el.dataset.page, portal);
});
document.querySelectorAll('[data-goto]').forEach(el=>{ el.addEventListener('click',()=>showSection(el.dataset.goto, el.dataset.portal || 'admin')); });
const titles = {
  'a-dashboard':['General Dashboard',"Welcome back, here's what's happening today."],
  'a-employees':['Employees',"Manage employee profiles and information."],
  'a-employee-detail':['Employee Profile',"View and manage employee profile and records."],
  'a-requests':['Pending Requests',"Review and action employee requests."],
  'a-salary':['Salary & Raises',"Apply raises and review compensation history."],
  'a-invoices':['Salary Payment Docs',"Generate and manage external-salary payment docs."],
  'a-vacations':['Vacations',"Track balances and leave across the company."],
  'a-insurance':['Medical Insurance',"Manage claims, categories and coverage limits."],
  'a-dochub':['Document Hub',"Manage company-wide documents and policies."],
  'a-finance-dashboard':['Finance Overview','Executive summary of cash flow, revenue, and operating expenses.'],
  'a-finance-sales':['Sales & Receivables','Manage customer invoices, receivables, and customer accounts.'],
  'a-finance-spend':['Spend & Payables','Track vendor bills, payments, and recurring subscriptions.'],
  'a-finance-banking':['Banking & Cash Management','Manage company treasury, continuous ledger, cheques, and reconciliation.'],
  'a-finance-payroll':['Payroll Runs','Review and execute company payroll cycles.'],
  'a-finance-payroll-runs':['Payroll Runs','Review and execute company payroll cycles.'],
  'a-finance-payroll-settings':['Payroll Settings','Configure payroll company bank accounts and cycle defaults.'],
  'a-finance-reports':['Financial Reports & Export','Category spend rollups, annual spend matrix, point-in-time balances, and Excel downloads.'],
  'a-finance-settings':['Finance Settings','Configure transaction categories and payment method rules.'],
  'a-finance-invoices':['Sales Invoices','Manage customer invoices and accounts receivable.'],
  'a-finance-bills':['Vendor Bills','Track supplier bills and accounts payable.'],
  'a-finance-accounts':['Company Bank Accounts','Manage company treasury and operating accounts.'],
  'a-finance-transfers':['Account Transfers','Manage transfers between company bank and cash accounts.'],
  'a-finance-cheques':['Cheque Register','Track issued and received bank cheques.'],
  'a-finance-statements':['Statements & Reconciliation','Import bank statements and reconcile operating accounts.'],
  'a-finance-subscriptions':['Recurring Subscriptions','Manage recurring vendor software and obligations.'],
  'a-finance-statutory':['Statutory Obligations','Track and remit government tax and social insurance liabilities.'],
  'a-system-roles':['Roles & Permissions','Manage system roles, descriptions, and fine-grained permission assignments.'],
  'a-system-users':['User Accounts & Access','Manage user identity, assigned RBAC roles, and account access status.'],
  'e-dashboard':['My Dashboard','Welcome back, here is your snapshot.'],
  'e-salary':['Salary & Raises','Your compensation history and growth.'],
  'e-payslips':['My Payslips','Your monthly payslip history and compensation breakdown.'],
  'e-vacations':['Vacations','Your balance, requests and history.'],
  'e-insurance':['Medical Insurance','Your plan, category limits and claims history.'],
  'e-dochub':['Document Hub','Company documents and policies.'],
};
function showSection(pageId, portal, params){
  const appSel = portal==='admin' ? '#admin-app' : '#employee-app';

  // Finance Information Architecture domain mapping (Story 1.1)
  const financeDomainMap = {
    'a-finance-sales': 'a-finance-invoices',
    'a-finance-spend': 'a-finance-bills',
    'a-finance-banking': 'a-finance-accounts',
    'a-finance-transfers': 'a-finance-accounts',
    'a-finance-cheques': 'a-finance-accounts',
    'a-finance-statements': 'a-finance-accounts',
    'a-finance-payroll-runs': 'a-finance-payroll',
    'a-finance-payroll-settings': 'a-finance-payroll',
  };

  const targetSectionId = financeDomainMap[pageId] || pageId;
  const targetSection = document.getElementById(targetSectionId);
  if (targetSection) {
    document.querySelectorAll(appSel+' .page-section').forEach(s=>s.classList.remove('active'));
    targetSection.classList.add('active');
  }

  const isPayrollSubItem = (p) => p === 'a-finance-payroll-runs' || p === 'a-finance-payroll-settings';
  const financeParentMap = {
    'a-finance-invoices': 'a-finance-sales',
    'a-finance-bills': 'a-finance-spend',
    'a-finance-subscriptions': 'a-finance-spend',
    'a-finance-statutory': 'a-finance-spend',
    'a-finance-accounts': 'a-finance-banking',
    'a-finance-transfers': 'a-finance-banking',
    'a-finance-cheques': 'a-finance-banking',
    'a-finance-statements': 'a-finance-banking',
  };
  document.querySelectorAll(appSel+' .nav-item[data-page]').forEach(n=>{
    const p = n.dataset.page;
    let isActive = false;
    if (p === pageId) {
      isActive = true;
    } else if (p === 'a-finance-payroll' && (pageId === 'a-finance-payroll-runs' || pageId === 'a-finance-payroll-settings')) {
      isActive = true;
    } else if (p === 'a-finance-payroll-runs' && pageId === 'a-finance-payroll') {
      isActive = true;
    } else if (!isPayrollSubItem(p) && (financeParentMap[pageId] === p || financeDomainMap[p] === targetSectionId || financeDomainMap[pageId] === p)) {
      isActive = true;
    }
    n.classList.toggle('active', isActive);
  });

  const t = titles[pageId] || titles[targetSectionId];
  if(t){
    document.getElementById(portal==='admin'?'adminPageTitle':'empPageTitle').textContent=t[0];
  }
  // An error toast belongs to the page that raised it: drop it when the user moves to another page.
  if (showSection.lastPage !== undefined && showSection.lastPage !== pageId) clearErrorToasts();
  showSection.lastPage = pageId;
  closeAllSidebars();
  if (typeof closeTopbarPopovers === 'function') closeTopbarPopovers();
  if (window.Router) Router.record(pageId, portal, params);
  if(pageId === 'a-invoices' && typeof initInvoicesPage === 'function') initInvoicesPage();
  if(portal === 'admin') {
    if(typeof PayrollApp !== 'undefined' && PayrollApp.showPage) {
      if(pageId === 'a-finance-payroll' || pageId === 'a-finance-payroll-runs') {
        PayrollApp.showPage('list');
      } else if(pageId === 'a-finance-payroll-settings') {
        PayrollApp.showPage('settings');
      }
    }
    if(typeof switchFinanceAccountsSubTab === 'function') {
      if(pageId === 'a-finance-transfers') {
        switchFinanceAccountsSubTab('transfers');
      } else if(pageId === 'a-finance-cheques') {
        switchFinanceAccountsSubTab('cheques');
      } else if(pageId === 'a-finance-statements') {
        switchFinanceAccountsSubTab('statements');
      }
    }
    if(pageId === 'a-system-roles' && window.SystemAccess && typeof window.SystemAccess.loadRoles === 'function') {
      window.SystemAccess.loadRoles();
    } else if(pageId === 'a-system-users' && window.SystemAccess && typeof window.SystemAccess.loadUsers === 'function') {
      window.SystemAccess.loadUsers();
    }
    if(window.AdminNav && typeof window.AdminNav.syncFromPage === 'function') {
      window.AdminNav.syncFromPage(pageId);
    }
  }
}
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('hrflow-theme', theme);
  document.querySelectorAll('.theme-fab i').forEach(i=>{ i.className = theme==='dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'; });
  document.querySelectorAll('[data-theme-choice]').forEach(b=>{ b.setAttribute('aria-pressed', String(b.dataset.themeChoice===theme)); });
}
const savedTheme = localStorage.getItem('hrflow-theme') || 'light';
applyTheme(savedTheme);
document.getElementById('loginThemeToggle').addEventListener('click',()=>{
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur==='dark'?'light':'dark');
  setTimeout(()=>{ if(window._charts) refreshCharts(); },50);
});
document.addEventListener('click',e=>{
  const choice = e.target.closest && e.target.closest('[data-theme-choice]');
  if(!choice) return;
  applyTheme(choice.dataset.themeChoice);
  setTimeout(()=>{ if(window._charts) refreshCharts(); },50);
});

// Account identity: fills every copy of the signed-in user's initials, name and role in a top bar.
function fillAccountIdentity(portal, {name, role}){
  const initials = getInitials(name);
  document.querySelectorAll('[data-account-initials="'+portal+'"]').forEach(el=>{ el.textContent = initials; });
  document.querySelectorAll('#'+portal+'UserName').forEach(el=>{ el.textContent = name || ''; });
  document.querySelectorAll('#'+portal+'UserRole').forEach(el=>{ el.textContent = role || ''; });
}

// Top-bar disclosure popovers (account menu, notifications): one open at a time.
// Escape closes and returns focus to the trigger; a click outside closes.
const topbarPopovers = [];
function closeTopbarPopovers(except, restoreFocusTo){
  topbarPopovers.forEach(p=>{
    if(p===except || p.panel.hidden) return;
    p.panel.hidden = true;
    p.btn.setAttribute('aria-expanded','false');
  });
  if(restoreFocusTo) restoreFocusTo.focus();
}
function initTopbarPopover(btnId, panelId){
  const btn = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if(!btn || !panel) return;
  const entry = {btn, panel};
  topbarPopovers.push(entry);
  btn.addEventListener('click',()=>{
    const willOpen = panel.hidden;
    closeTopbarPopovers(entry);
    panel.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  });
}
document.addEventListener('click',e=>{
  const outside = topbarPopovers.filter(p=>!p.btn.contains(e.target) && !p.panel.contains(e.target));
  outside.forEach(p=>{
    if(p.panel.hidden) return;
    p.panel.hidden = true;
    p.btn.setAttribute('aria-expanded','false');
  });
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  const open = topbarPopovers.find(p=>!p.panel.hidden);
  if(open) closeTopbarPopovers(null, open.btn);
});
initTopbarPopover('adminAccountBtn','adminAccountPanel');
initTopbarPopover('empAccountBtn','empAccountPanel');
initTopbarPopover('adminNotifBtn','adminNotifPanel');
initTopbarPopover('empNotifBtn','empNotifPanel');
// Toasts: text is set with textContent (never parsed as HTML). Errors use role="alert",
// stay until dismissed and carry a close button; other toasts use role="status" and fade after 3.2s.
function toast(msg, icon='fa-solid fa-circle-check'){
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const isError = /triangle-exclamation|circle-exclamation|circle-xmark/.test(String(icon));
  const el = document.createElement('div');
  el.className = isError ? 'toast toast-error' : 'toast';
  el.setAttribute('role', isError ? 'alert' : 'status');
  const iconEl = document.createElement('i');
  iconEl.className = String(icon);
  iconEl.setAttribute('aria-hidden', 'true');
  const textEl = document.createElement('span');
  textEl.textContent = msg === null || msg === undefined ? '' : String(msg);
  el.append(iconEl, textEl);
  if (isError) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.textContent = '×';
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
  }
  wrap.appendChild(el);
  if (!isError) setTimeout(()=>el.remove(), 3200);
}
function clearErrorToasts(){
  document.querySelectorAll('#toastWrap .toast-error').forEach(el=>el.remove());
}
function initials(name){ return name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase(); }
// HR-page money helpers: thin wrappers over the one formatter in finance-core.js
// (up to 2 decimals, trailing zeros trimmed on whole numbers).
function fmtMoney(n){ return FinanceFormat.formatMoney(n, 'EGP', { decimals: 2, minDecimals: 0 }); }
function fmtUSD(n){ return FinanceFormat.formatMoney(n, 'USD', { decimals: 2, minDecimals: 0 }); }
function fmtDateShort(d){
  if(!d || d === '—') return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function statusPill(status){
  const map = {Pending:'pill-warning',Approved:'pill-success','Active':'pill-success',Rejected:'pill-danger','On Leave':'pill-info',Suspended:'pill-danger'};
  return `<span class="badge-pill ${map[status]||'pill-neutral'}">${status}</span>`;
}
/**
 * Accessible Modal Controller (Story 0.3)
 * Manages modal stack, focus traps, scroll locks, keyboard Escape,
 * accessible ARIA attributes, and focus restoration to the invoking element.
 */
const ModalController = {
  _stack: [],
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Keyboard navigation: Escape key closes top modal, Tab traps focus
    document.addEventListener('keydown', (e) => this.handleKeydown(e), true);

    // Global backdrop click listener
    document.addEventListener('click', (e) => {
      if (this._stack.length === 0) return;
      const top = this._stack[this._stack.length - 1];
      if (e.target === top.overlay) {
        this.close(top.id);
      }
    });
  },

  open(modalId, triggerEl = null) {
    this.init();
    const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!el) return null;

    // Save invoking element for focus restoration upon close
    const invoker = triggerEl || (document.activeElement && document.activeElement !== document.body ? document.activeElement : null);

    // Find inner dialog container
    const dialog = el.querySelector('.modal') || el;

    // Ensure dialog semantics
    if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // Ensure accessible name if not already defined
    if (!dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')) {
      const heading = el.querySelector('.modal-head h3, .modal-head [id*="Title"], h3, h2');
      if (heading) {
        if (!heading.id) heading.id = 'modal_title_' + (el.id || Math.random().toString(36).substr(2, 6));
        dialog.setAttribute('aria-labelledby', heading.id);
      } else {
        dialog.setAttribute('aria-label', el.id || 'Dialog');
      }
    }

    // Show modal and apply scroll lock
    el.classList.add('active');
    el.style.display = 'flex';
    document.body.classList.add('modal-open');

    // Remove existing instance if reopened
    const existingIdx = this._stack.findIndex(entry => entry.id === el.id);
    if (existingIdx !== -1) {
      this._stack.splice(existingIdx, 1);
    }

    const entry = { id: el.id, overlay: el, dialog, invoker };
    this._stack.push(entry);

    // Set initial focus into modal
    setTimeout(() => {
      const autoFocusEl = dialog.querySelector('[autofocus], [data-autofocus]');
      if (autoFocusEl && typeof autoFocusEl.focus === 'function') {
        autoFocusEl.focus();
        return;
      }

      const firstInput = dialog.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus();
        return;
      }

      const focusable = this.getFocusableElements(dialog);
      if (focusable.length > 0) {
        const nonClose = focusable.find(btn => !btn.classList.contains('modal-close'));
        if (nonClose) nonClose.focus();
        else focusable[0].focus();
      } else {
        dialog.setAttribute('tabindex', '-1');
        dialog.focus();
      }
    }, 45);

    window.dispatchEvent(new CustomEvent('hrflow:modal-opened', { detail: { modalId: el.id, dialog } }));
    return entry;
  },

  close(modalId) {
    // Drop stale inline errors and summaries so the next open starts clean
    { const el = document.getElementById(modalId); if (el && window.FinanceForm) FinanceForm.clearErrors(el); }
    let entry = null;
    if (modalId) {
      const idx = this._stack.findIndex(e => e.id === modalId || e.overlay === modalId);
      if (idx !== -1) {
        entry = this._stack.splice(idx, 1)[0];
      }
    } else {
      entry = this._stack.pop();
    }

    const el = entry ? entry.overlay : (typeof modalId === 'string' ? document.getElementById(modalId) : modalId);
    if (!el) return;

    el.classList.remove('active');
    el.style.display = 'none';

    // Clear any active field errors or summaries in this modal
    if (window.FinanceForm && typeof window.FinanceForm.clearErrors === 'function') {
      window.FinanceForm.clearErrors(el);
    }

    // If no more open modals, restore body scroll
    if (this._stack.length === 0) {
      document.body.classList.remove('modal-open');
    }

    // Restore focus to invoker
    if (entry && entry.invoker && typeof entry.invoker.focus === 'function' && document.contains(entry.invoker)) {
      try {
        entry.invoker.focus();
      } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('hrflow:modal-closed', { detail: { modalId: el.id } }));
  },

  getFocusableElements(container) {
    if (!container) return [];
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  },

  handleKeydown(e) {
    if (this._stack.length === 0) return;
    const current = this._stack[this._stack.length - 1];

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close(current.id);
      return;
    }

    if (e.key === 'Tab') {
      const focusable = this.getFocusableElements(current.dialog);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !current.dialog.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !current.dialog.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
};

function openModal(id, triggerEl){ ModalController.open(id, triggerEl); }
function closeModal(id){ ModalController.close(id); }
window.ModalController = ModalController;
ModalController.init();
function readFileAsDataUrl(file){ return new Promise((resolve, reject)=>{ const reader = new FileReader(); reader.onload = ()=>resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

function setButtonLoading(buttonEl, isLoading, loadingText = 'Saving…') {
  const btn = typeof buttonEl === 'string' ? document.getElementById(buttonEl) : buttonEl;
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}