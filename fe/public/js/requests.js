/**
 * requests.js — Pending Requests management & action queue
 */

let currentRequestsFilter = 'all';

function getRequestTypeBadge(type) {
  const map = {
    'Vacation': { icon: 'fa-umbrella-beach', cls: 'pill-info' },
    'Work From Home': { icon: 'fa-house-laptop', cls: 'pill-warning' },
    'Medical Insurance': { icon: 'fa-briefcase-medical', cls: 'pill-success' }
  };
  const conf = map[type] || { icon: 'fa-file-lines', cls: 'pill-neutral' };
  return `<span class="badge-pill ${conf.cls}"><i class="fa-solid ${conf.icon}"></i> ${type}</span>`;
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

function renderRequestsTable(filter) {
  if (filter) {
    currentRequestsFilter = filter;
  }
  updateRequestFilterCounts();

  const body = document.getElementById('requestsTableBody');
  if (!body) return;

  const list = currentRequestsFilter === 'all' 
    ? requests 
    : requests.filter(r => r.type === currentRequestsFilter);

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No requests found in this category.</p></div></td></tr>`;
    return;
  }

  body.innerHTML = list.map(r => {
    const matchedEmp = (typeof employees !== 'undefined' && employees) ? employees.find(e => e.name === r.employee_name) : null;
    const deptTag = matchedEmp && matchedEmp.dept ? `<span class="badge-pill pill-neutral" style="font-size:10.5px;padding:2px 6px;">${matchedEmp.dept}</span>` : '';

    return `
      <tr>
        <td class="tname">
          <div class="avatar">${initials(r.employee_name)}</div>
          <div>
            <div style="font-weight:600;color:var(--text);">${r.employee_name}</div>
            ${deptTag ? `<div style="margin-top:2px;">${deptTag}</div>` : ''}
          </div>
        </td>
        <td>${getRequestTypeBadge(r.type)}</td>
        <td>
          <div class="request-details-cell">
            <div class="request-details-title">${r.details || 'No details provided'}</div>
          </div>
        </td>
        <td>
          <div style="font-size:12.5px;color:var(--text2);display:inline-flex;align-items:center;gap:6px;">
            <i class="fa-regular fa-calendar" style="color:var(--text3);"></i> ${r.date || '—'}
          </div>
        </td>
        <td>${statusPill(r.status)}</td>
        <td>
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
}

document.querySelectorAll('[data-reqfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-reqfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderRequestsTable(btn.dataset.reqfilter);
  });
});

async function actionRequest(id, status, btn) {
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
