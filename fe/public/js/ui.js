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

function toggleSidebar(id){ document.getElementById(id).classList.toggle('open'); }
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
  'e-dashboard':['My Dashboard','Welcome back, here is your snapshot.'],
  'e-salary':['Salary & Raises','Your compensation history and growth.'],
  'e-vacations':['Vacations','Your balance, requests and history.'],
  'e-insurance':['Medical Insurance','Your plan, category limits and claims history.'],
  'e-dochub':['Document Hub','Company documents and policies.'],
};
function showSection(pageId, portal){
  const appSel = portal==='admin' ? '#admin-app' : '#employee-app';
  document.querySelectorAll(appSel+' .page-section').forEach(s=>s.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.querySelectorAll(appSel+' .nav-item[data-page]').forEach(n=>n.classList.toggle('active', n.dataset.page===pageId));
  const t = titles[pageId];
  if(t){ document.getElementById(portal==='admin'?'adminPageTitle':'empPageTitle').textContent=t[0]; document.getElementById(portal==='admin'?'adminPageSub':'empPageSub').textContent=t[1]; }
  document.getElementById(portal==='admin'?'adminSidebar':'empSidebar').classList.remove('open');
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
function statusPill(status){
  const map = {Pending:'pill-warning',Approved:'pill-success','Active':'pill-success',Rejected:'pill-danger','On Leave':'pill-info',Suspended:'pill-danger'};
  return `<span class="badge-pill ${map[status]||'pill-neutral'}">${status}</span>`;
}
function closeModal(id){ document.getElementById(id).classList.remove('active'); }
function readFileAsDataUrl(file){ return new Promise((resolve, reject)=>{ const reader = new FileReader(); reader.onload = ()=>resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

function setButtonLoading(buttonEl, isLoading, loadingText) {
  const btn = typeof buttonEl === 'string' ? document.getElementById(buttonEl) : buttonEl;
  if (!btn) return;
  if (isLoading) {
    if (btn.dataset.loading === 'true') return;
    btn.dataset.loading = 'true';
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    const txt = loadingText || 'Saving...';
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${txt}`;
  } else {
    if (btn.dataset.loading !== 'true') return;
    delete btn.dataset.loading;
    if (btn.dataset.originalHtml !== undefined) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
    btn.disabled = false;
  }
}