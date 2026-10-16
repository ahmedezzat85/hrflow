/**
 * requests.js — Pending Requests management & action queue
 */

let currentRequestsFilter = 'all';

// Display label for a request type (stored values are unchanged)
function requestTypeLabel(type) {
  if (type === 'Work From Home' || type === 'WFH') return 'Work from home';
  if (type === 'Medical Insurance') return 'Medical claim';
  return type || '';
}

function getRequestTypeBadge(type) {
  const map = {
    'Vacation': { icon: 'fa-umbrella-beach', cls: 'pill-info' },
    'Work From Home': { icon: 'fa-house-laptop', cls: 'pill-warning' },
    'Medical Insurance': { icon: 'fa-briefcase-medical', cls: 'pill-success' }
  };
  const conf = map[type] || { icon: 'fa-file-lines', cls: 'pill-neutral' };
  return `<span class="badge-pill ${conf.cls}"><i class="fa-solid ${conf.icon}"></i> ${escapeHtml(requestTypeLabel(type))}</span>`;
}

// "7 Oct 2026 - 1 day": the days the request covers, then how long
function requestWhenLine(r) {
  const start = r.startDate || r.start_date || r.date;
  const end = r.endDate || r.end_date || start;
  const range = start ? fmtDateRange(start, end) : '';
  const days = Number(r.days);
  const len = days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : '';
  return [range, len].filter(Boolean).join(' · ');
}

function updateRequestFilterCounts() {
  const allCount = requests.length;
  const vacCount = requests.filter(r => r.type === 'Vacation').length;
  const wfhCount = requests.filter(r => r.type === 'Work From Home').length;
  const insCount = requests.filter(r => r.type === 'Medical Insurance').length;

  const elAll = document.getElementById('countReqAll');
  const elVac = document.getElementById('countReqVacation');
  const elWfh = document.getElementById('countReqWFH');
  const elIns = document.getElementById('countReqInsurance');

  if (elAll) elAll.textContent = allCount;
  if (elVac) elVac.textContent = vacCount;
  if (elWfh) elWfh.textContent = wfhCount;
  if (elIns) elIns.textContent = insCount;
}

let currentRequestsStatus = 'all';

function renderRequestStatusPills(typeList) {
  const el = document.getElementById('requestStatusPills');
  if (!el) return;
  const n = (st) => typeList.filter(r => r.status === st).length;
  const defs = [['all', 'All', typeList.length, ''], ['Pending', 'Pending', n('Pending'), 'hv-sp--pending'], ['Approved', 'Approved', n('Approved'), 'hv-sp--approved'], ['Rejected', 'Rejected', n('Rejected'), 'hv-sp--rejected']];
  el.innerHTML = defs.map(([k, label, c, cls]) => `<button type="button" class="fv-pill hv-sp ${cls}${currentRequestsStatus === k ? ' active' : ''}" data-reqstatus="${k}" aria-pressed="${currentRequestsStatus === k}">${k === 'all' ? '' : '<span class="hv-dot"></span>'}${label} <span class="hv-sp-n">${c}</span></button>`).join('');
}

let currentRequestsSearch = '';

function filterRequests(val) {
  currentRequestsSearch = (val || '').toLowerCase().trim();
  renderRequestsTable();
}
window.filterRequests = filterRequests;

function renderRequestsTable(filter) {
  if (filter) {
    currentRequestsFilter = filter;
  }
  updateRequestFilterCounts();

  const body = document.getElementById('requestsTableBody');
  if (!body) return;

  const typeList = currentRequestsFilter === 'all' ? requests : requests.filter(r => r.type === currentRequestsFilter);
  renderRequestStatusPills(typeList);
  let list = currentRequestsStatus === 'all' ? typeList : typeList.filter(r => r.status === currentRequestsStatus);
  if (currentRequestsSearch) {
    list = list.filter(r => {
      const empName = (r.employee_name || r.emp || '').toLowerCase();
      const type = (r.type || '').toLowerCase();
      const details = (r.details || r.reason || '').toLowerCase();
      return empName.includes(currentRequestsSearch) || type.includes(currentRequestsSearch) || details.includes(currentRequestsSearch);
    });
  }

  if (!list.length) {
    body.innerHTML = renderEmptyTableRow(6, currentRequestsSearch ? `No requests match "${escapeHtml(currentRequestsSearch)}".` : (currentRequestsFilter === 'all' ? 'No pending requests found.' : `No requests found in category "${currentRequestsFilter}".`), 'fa-solid fa-inbox');
    return;
  }

  body.innerHTML = list.map(r => {
    const matchedEmp = (typeof employees !== 'undefined' && employees) ? employees.find(e => e.name === r.employee_name) : null;
    const deptTag = matchedEmp && matchedEmp.dept ? `<span class="badge-pill pill-neutral" style="font-size:10.5px;padding:2px 6px;">${escapeHtml(matchedEmp.dept)}</span>` : '';

    return `
      <tr class="${r.status === 'Pending' ? 'hv-row-pending' : ''}">
        <td data-label="Employee" class="tname">
          <div class="avatar">${initials(r.employee_name)}</div>
          <div>
            <div style="font-weight:600;color:var(--ink-strong);">${escapeHtml(r.employee_name)}</div>
            ${matchedEmp && matchedEmp.dept ? `<div style="font-size:12px;color:var(--ink-muted);">${escapeHtml(matchedEmp.dept)}</div>` : ''}
          </div>
        </td>
        <td data-label="Request">
          ${getRequestTypeBadge(r.type)}
          ${requestWhenLine(r) ? `<div class="hv-sub-line">${escapeHtml(requestWhenLine(r))}</div>` : ''}
        </td>
        <td data-label="Reason">
          <div class="request-details-cell">
            <div class="request-details-title">${r.details || r.reason ? escapeHtml(r.details || r.reason) : '<span class="hv-muted">No reason given</span>'}</div>
          </div>
        </td>
        <td data-label="Submitted">
          <div style="font-size:13px;color:var(--ink-strong);white-space:nowrap;">${r.date ? escapeHtml(fmtDateShort(r.date)) : '—'}</div>
        </td>
        <td data-label="Status">${statusPill(r.status)}</td>
        <td data-label="Actions" class="col-actions">
          <div class="request-actions">
            ${r.status === 'Pending' ? `
              <button class="btn btn-sm btn-success-outline" onclick="actionRequest(${r.id}, 'Approved', this)">
                <i class="fa-solid fa-check"></i> Approve
              </button>
              <button class="btn btn-sm btn-danger-outline" onclick="actionRequest(${r.id}, 'Rejected', this)">
                <i class="fa-solid fa-xmark"></i> Reject
              </button>
            ` : `
              <span style="color:var(--text3);font-size:12px;font-style:italic;">Resolved</span>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  setTableFoot('requestsTableBody', list.length, 'requests');
}

document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-reqstatus]');
  if (!b) return;
  currentRequestsStatus = b.dataset.reqstatus;
  renderRequestsTable();
});

document.querySelectorAll('[data-reqfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-reqfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderRequestsTable(btn.dataset.reqfilter);
  });
});

async function actionRequest(id, status, btn) {
  const approving = status === 'Approved';
  const ok = await FinanceCommand.confirmAction({
    title: approving ? 'Approve request' : 'Reject request',
    consequence: approving ? 'Approve this request?' : 'Reject this request? The employee will see it as rejected.',
    actionLabel: approving ? 'Approve request' : 'Reject request',
    actionClass: approving ? 'btn btn-fill' : 'btn btn-danger',
    severity: approving ? 'warning' : undefined,
  });
  if (!ok.confirmed) return;
  const container = btn ? btn.closest('.request-actions') : null;
  const siblingBtns = container ? container.querySelectorAll('button') : [];

  if (btn) {
    setButtonLoading(btn, true, status === 'Approved' ? 'Approving...' : 'Rejecting...');
  }
  siblingBtns.forEach(b => { if (b !== btn) b.disabled = true; });

  try {
    await Api.actionRequest(id, status);
    toast(`Request marked as ${status}.`, status === 'Approved' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark');
    await loadAdminData();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    if (btn) setButtonLoading(btn, false);
    siblingBtns.forEach(b => { if (b !== btn) b.disabled = false; });
  }
}
