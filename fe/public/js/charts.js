function chartColors(){ const dark = document.documentElement.getAttribute('data-theme')==='dark'; return { grid: dark?'#2a2e3d':'#e7e9f3', text: dark?'#9aa0b4':'#6b7280' }; }
function initCharts(){
  const c = chartColors();
  Chart.defaults.font.family = "'Inter',sans-serif";
  const ctx1 = document.getElementById('chartRequests');
  window._charts.requests = new Chart(ctx1, { type:'bar', data:{ labels:['Feb','Mar','Apr','May','Jun','Jul'], datasets:[ {label:'Vacation', data:[12,18,15,22,19,26], backgroundColor:'#2056e8', borderRadius:6}, {label:'WFH', data:[8,10,7,13,11,15], backgroundColor:'#4f7af8', borderRadius:6}, {label:'Insurance', data:[5,7,9,6,8,9], backgroundColor:'#e07d10', borderRadius:6}, ]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{color:c.text, boxWidth:10, font:{size:11}}}}, scales:{ x:{grid:{display:false}, ticks:{color:c.text}}, y:{grid:{color:c.grid}, ticks:{color:c.text}} } } });
  const ctx2 = document.getElementById('chartDonut');
  window._charts.donut = new Chart(ctx2, { type:'doughnut', data:{ labels:['Vacation','WFH','Insurance'], datasets:[{data:[45,28,27], backgroundColor:['#2056e8','#4f7af8','#e07d10'], borderWidth:0}]}, options:{ responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{legend:{position:'bottom', labels:{color:c.text, boxWidth:10, font:{size:11}}}} } });
  const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee;
  const ctx3 = document.getElementById('chartSalary');
  if (ctx3 && emp && emp.salaryHistory) {
    window._charts.salary = new Chart(ctx3, { type:'line', data:{ labels: emp.salaryHistory.map(s=>s.date.slice(0,7)), datasets:[{label:'Salary (EGP)', data: emp.salaryHistory.map(s=>s.next), borderColor:'#2056e8', backgroundColor:'rgba(32,86,232,.12)', fill:true, tension:.4, pointBackgroundColor:'#2056e8', pointRadius:5}]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{grid:{display:false}, ticks:{color:c.text}}, y:{grid:{color:c.grid}, ticks:{color:c.text}} } } });
  }
}
function refreshCharts(){
  const c = chartColors();
  Object.values(window._charts).forEach(ch=>{
    if(ch.options.scales){ if(ch.options.scales.x) ch.options.scales.x.ticks.color=c.text; if(ch.options.scales.y){ch.options.scales.y.ticks.color=c.text; ch.options.scales.y.grid.color=c.grid;} }
    if(ch.options.plugins.legend.labels) ch.options.plugins.legend.labels.color = c.text;
    ch.update();
  });
}
