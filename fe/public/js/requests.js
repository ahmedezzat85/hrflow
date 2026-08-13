function renderRequestsTable(filter){
  const body = document.getElementById('requestsTableBody');
  const list = filter==='all' ? requests : requests.filter(r=>r.type===filter);
  body.innerHTML = list.map(r=>`<tr><td class="tname"><div class="avatar">${initials(r.employee_name)}</div>${r.employee_name}</td><td>${r.type}</td><td>${r.details}</td><td>${r.date}</td><td>${statusPill(r.status)}</td><td style="display:flex;gap:6px;">${r.status==='Pending' ? `<button class="btn btn-sm btn-success-outline" onclick="actionRequest(${r.id},'Approved')"><i class="fa-solid fa-check"></i> Approve</button><button class="btn btn-sm btn-danger-outline" onclick="actionRequest(${r.id},'Rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>` : `<span style="color:var(--text3);font-size:12.5px;">No actions</span>`}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>No requests in this category.</p></div></td></tr>`;
}
document.querySelectorAll('[data-reqfilter]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-reqfilter]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderRequestsTable(btn.dataset.reqfilter);
  });
});
async function actionRequest(id, status){
  try{ await Api.actionRequest(id, status); toast(`Request marked as ${status}.`, status==='Approved'?'fa-solid fa-circle-check':'fa-solid fa-circle-xmark'); await loadAdminData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
