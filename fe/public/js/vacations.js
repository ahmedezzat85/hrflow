function renderVacationBalances(){
  const body = document.getElementById('vacationBalanceBody');
  body.innerHTML = employees.map(e=>{ const pct = Math.round((e.vacUsed/e.vacTotal)*100); return `<tr><td class="tname"><div class="avatar">${initials(e.name)}</div>${e.name}</td><td>${e.dept}</td><td>${e.vacTotal}</td><td>${e.vacUsed}</td><td>${e.vacTotal-e.vacUsed}</td><td style="min-width:140px;"><div class="progress-bar"><span style="width:${pct}%;"></span></div></td></tr>`; }).join('');
  document.getElementById('statVacAllotted').textContent = employees.reduce((s,e)=>s+e.vacTotal,0).toLocaleString();
  document.getElementById('statVacUsed').textContent = employees.reduce((s,e)=>s+e.vacUsed,0).toLocaleString();
  document.getElementById('statEmployeesOnLeave').textContent = employees.filter(e=>e.status==='On Leave').length;
  document.getElementById('statOnLeave').textContent = employees.filter(e=>e.status==='On Leave').length;
}
async function submitVacation(){
  const type = document.getElementById('vacType').value;
  const start = document.getElementById('vacStart').value, end = document.getElementById('vacEnd').value;
  if(!start){ toast('Please select a start date.','fa-solid fa-triangle-exclamation'); return; }
  try{ await Api.requestVacation({ employee_name: currentLoggedInEmployee.name, leave_type: type, start_date: start, end_date: end || start, days: 1 }); toast('Request submitted for approval.'); await loadEmployeeData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
