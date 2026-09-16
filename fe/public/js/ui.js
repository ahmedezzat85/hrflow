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
function showSectionLoadingBar(id){ const el = document.getElementById(id); if(el) el.classList.add('show'); }
function hideSectionLoadingBar(id){ const el = document.getElementById(id); if(el) el.classList.remove('show'); }

/**
 * Standardized Empty & Loading state helpers across all domain modules
 */
function getEmptyStateHtml(message = 'No data available.', icon = 'fa-solid fa-inbox') {
  return `<div class="empty-state"><i class="${icon}"></i><p>${message}</p></div>`;
}

function getEmptyTableRowHtml(colCount = 1, message = 'No data available.', icon = 'fa-solid fa-inbox') {
  return `<tr><td colspan="${colCount}">${getEmptyStateHtml(message, icon)}</td></tr>`;
}

function getLoadingStateHtml(message = 'Loading data...') {
  return `<div class="empty-state loading-state"><i class="fa-solid fa-circle-notch fa-spin" style="color:var(--accent);"></i><p style="color:var(--text2);margin-top:10px;">${message}</p></div>`;
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
  const sidebar = document.getElementById(id);
  if(!sidebar) return;
  sidebar.classList.toggle('collapsed');
  const collapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('hrflow-sidebar-collapsed', collapsed ? '1' : '0');
  ['adminSidebar','empSidebar'].forEach(sid=>{
    const el = document.getElementById(sid);
    if(el && sid !== id) el.classList.toggle('collapsed', collapsed);
  });
}
function applySavedSidebarCollapse(){
  const collapsed = localStorage.getItem('hrflow-sidebar-collapsed') === '1';
  if(!collapsed) return;
  ['adminSidebar','empSidebar'].forEach(sid=>{
    const el = document.getElementById(sid);
    if(el) el.classList.add('collapsed');
  });
}

function getInitials(name){
  if(!name) return '--';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase() || '--';
}

function toggleSidebar(id){
  const sb = document.getElementById(id);
  if(!sb) return;
  sb.classList.toggle('open');
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
}

document.querySelectorAll('#admin-app .nav-item[data-page]').forEach(el=>{ el.addEventListener('click',()=>showSection(el.dataset.page,'admin')); });
document.querySelectorAll('#employee-app .nav-item[data-page]').forEach(el=>{ el.addEventListener('click',()=>showSection(el.dataset.page,'employee')); });
document.querySelectorAll('[data-goto]').forEach(el=>{ el.addEventListener('click',()=>showSection(el.dataset.goto, el.dataset.portal || 'admin')); });
const titles = {
  'a-dashboard':['General Dashboard',"Welcome back, here's what's happening today."],
  'a-employees':['Employees',"Manage employee profiles and information."],
  'a-requests':['Pending Requests',"Review and action employee requests."],
  'a-salary':['Salary & Raises',"Apply raises and review compensation history."],
  'a-invoices':['Invoices',"Generate and manage external-salary invoices."],
  'a-vacations':['Vacations',"Track balances and leave across the company."],
  'a-insurance':['Medical Insurance',"Manage claims, categories and coverage limits."],
  'a-dochub':['Document Hub',"Manage company-wide documents and policies."],
  'a-finance-dashboard':['Finance Overview','Executive summary of cash flow, revenue, and operating expenses.'],
  'a-finance-sales':['Sales & Receivables','Manage customer invoices, receivables, and customer accounts.'],
  'a-finance-spend':['Spend & Payables','Track vendor bills, payments, and recurring subscriptions.'],
  'a-finance-banking':['Banking & Cash Management','Manage company treasury, continuous ledger, cheques, and reconciliation.'],
  'a-finance-payroll':['Payroll Runs','Review and execute company payroll cycles.'],
  'a-finance-reports':['Financial Reports & Export','Category spend rollups, annual spend matrix, point-in-time balances, and Excel downloads.'],
  'a-finance-settings':['Finance Settings','Configure transaction categories and payment method rules.'],
  'a-finance-invoices':['Sales Invoices','Manage customer invoices and accounts receivable.'],
  'a-finance-bills':['Vendor Bills','Track supplier bills and accounts payable.'],
  'a-finance-accounts':['Company Bank Accounts','Manage company treasury and operating accounts.'],
  'a-finance-subscriptions':['Recurring Subscriptions','Manage recurring vendor software and obligations.'],
  'a-finance-statutory':['Statutory Obligations','Track and remit government tax and social insurance liabilities.'],
  'e-dashboard':['My Dashboard','Welcome back, here is your snapshot.'],
  'e-salary':['Salary & Raises','Your compensation history and growth.'],
  'e-payslips':['My Payslips','Your monthly payslip history and compensation breakdown.'],
  'e-vacations':['Vacations','Your balance, requests and history.'],
  'e-insurance':['Medical Insurance','Your plan, category limits and claims history.'],
  'e-dochub':['Document Hub','Company documents and policies.'],
};
function showSection(pageId, portal){
  const appSel = portal==='admin' ? '#admin-app' : '#employee-app';

  // Finance Information Architecture domain mapping (Story 1.1)
  const financeDomainMap = {
    'a-finance-sales': 'a-finance-invoices',
    'a-finance-spend': 'a-finance-bills',
    'a-finance-banking': 'a-finance-accounts',
  };

  const targetSectionId = financeDomainMap[pageId] || pageId;
  const targetSection = document.getElementById(targetSectionId);
  if (targetSection) {
    document.querySelectorAll(appSel+' .page-section').forEach(s=>s.classList.remove('active'));
    targetSection.classList.add('active');
  }

  document.querySelectorAll(appSel+' .nav-item[data-page]').forEach(n=>{
    const p = n.dataset.page;
    const isDirect = (p === pageId);
    const isDomainMatch = (financeDomainMap[p] === targetSectionId || financeDomainMap[pageId] === p);
    n.classList.toggle('active', isDirect || isDomainMatch);
  });

  const t = titles[pageId] || titles[targetSectionId];
  if(t){
    document.getElementById(portal==='admin'?'adminPageTitle':'empPageTitle').textContent=t[0];
    document.getElementById(portal==='admin'?'adminPageSub':'empPageSub').textContent=t[1];
  }
  closeAllSidebars();
  if(pageId === 'a-invoices' && typeof initInvoicesPage === 'function') initInvoicesPage();
}
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('hrflow-theme', theme);
  document.querySelectorAll('.theme-fab i, #adminThemeToggle i, #empThemeToggle i').forEach(i=>{ i.className = theme==='dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon'; });
}
const savedTheme = localStorage.getItem('hrflow-theme') || 'light';
applyTheme(savedTheme);
['loginThemeToggle','adminThemeToggle','empThemeToggle'].forEach(id=>{
  document.getElementById(id).addEventListener('click',()=>{
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur==='dark'?'light':'dark');
    setTimeout(()=>{ if(window._charts) refreshCharts(); },50);
  });
});
function toast(msg, icon='fa-solid fa-circle-check'){
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className='toast';
  el.innerHTML = `<i class="${icon}"></i> ${msg}`;
  wrap.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
function initials(name){ return name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase(); }
function fmtMoney(n){
  const val = Number(n);
  if(isNaN(val)) return 'EGP 0';
  return 'EGP ' + val.toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtUSD(n){ return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
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