function chartColors(){
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: dark ? '#2a2e3d' : '#e7e9f3',
    text: dark ? '#9aa0b4' : '#6b7280',
    accent: '#2056e8',
    warning: '#e07d10',
    success: '#10b981',
    info: '#0ea5e9'
  };
}

function getPastSixMonths() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString('en-US', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth()
    });
  }
  return months;
}

function initCharts(){
  if (typeof Chart === 'undefined') return;
  const c = chartColors();
  Chart.defaults.font.family = "'Inter', sans-serif";

  // 1. Bar Chart: Last 6 Months Requests & Claims
  const ctx1 = document.getElementById('chartRequests');
  if (ctx1) {
    const pastMonths = getPastSixMonths();
    const reqList = Array.isArray(requests) ? requests : [];
    const claimList = Array.isArray(insuranceClaims) ? insuranceClaims : [];

    const vacData = pastMonths.map(m => reqList.filter(r => {
      if (r.type !== 'Vacation' && r.type !== 'Annual Leave') return false;
      const d = new Date(r.date);
      return !isNaN(d.getTime()) && d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length);

    const wfhData = pastMonths.map(m => reqList.filter(r => {
      if (r.type !== 'Work From Home' && r.type !== 'WFH') return false;
      const d = new Date(r.date);
      return !isNaN(d.getTime()) && d.getFullYear() === m.year && d.getMonth() === m.month;
    }).length);

    const insData = pastMonths.map(m => {
      const claimsInMonth = claimList.filter(claim => {
        const d = new Date(claim.date);
        return !isNaN(d.getTime()) && d.getFullYear() === m.year && d.getMonth() === m.month;
      }).length;
      const reqsInMonth = reqList.filter(r => {
        if (r.type !== 'Medical Insurance') return false;
        const d = new Date(r.date);
        return !isNaN(d.getTime()) && d.getFullYear() === m.year && d.getMonth() === m.month;
      }).length;
      return claimsInMonth + reqsInMonth;
    });

    if (window._charts.requests) {
      window._charts.requests.destroy();
    }

    window._charts.requests = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: pastMonths.map(m => m.label),
        datasets: [
          { label: 'Vacation', data: vacData, backgroundColor: c.accent, borderRadius: 6 },
          { label: 'WFH', data: wfhData, backgroundColor: c.warning, borderRadius: 6 },
          { label: 'Insurance', data: insData, backgroundColor: c.success, borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: c.text, boxWidth: 10, font: { size: 11 } }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.text } },
          y: {
            grid: { color: c.grid },
            ticks: { color: c.text, stepSize: 1, precision: 0 },
            beginAtZero: true
          }
        }
      }
    });
  }

  // 2. Doughnut Chart: Distribution of Request Types
  const ctx2 = document.getElementById('chartDonut');
  if (ctx2) {
    const reqList = Array.isArray(requests) ? requests : [];
    const claimList = Array.isArray(insuranceClaims) ? insuranceClaims : [];

    const vacTotal = reqList.filter(r => r.type === 'Vacation' || r.type === 'Annual Leave').length;
    const wfhTotal = reqList.filter(r => r.type === 'Work From Home' || r.type === 'WFH').length;
    const insTotal = claimList.length + reqList.filter(r => r.type === 'Medical Insurance').length;

    const hasData = (vacTotal + wfhTotal + insTotal) > 0;
    const donutData = hasData ? [vacTotal, wfhTotal, insTotal] : [0, 0, 0];

    if (window._charts.donut) {
      window._charts.donut.destroy();
    }

    window._charts.donut = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Vacation', 'WFH', 'Insurance'],
        datasets: [{
          data: donutData,
          backgroundColor: [c.accent, c.warning, c.success],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: c.text, boxWidth: 10, font: { size: 11 } }
          }
        }
      }
    });
  }

  // 3. Line Chart: Employee Compensation Growth
  const emp = (Array.isArray(employees) ? employees.find(e => e.id === window.LOGGED_IN_EMPLOYEE_ID) : null) || currentLoggedInEmployee;
  const ctx3 = document.getElementById('chartSalary');
  if (ctx3 && emp && emp.salaryHistory && emp.salaryHistory.length) {
    if (window._charts.salary) {
      window._charts.salary.destroy();
    }
    window._charts.salary = new Chart(ctx3, {
      type: 'line',
      data: {
        labels: emp.salaryHistory.map(s => s.date ? s.date.slice(0, 7) : '—'),
        datasets: [{
          label: 'Salary Progression (USD)',
          data: emp.salaryHistory.map(s => (s.newInternal || 0) + (s.newExternal || 0) || s.next || 0),
          borderColor: c.accent,
          backgroundColor: 'rgba(32, 86, 232, 0.12)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: c.accent,
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.text } },
          y: { grid: { color: c.grid }, ticks: { color: c.text }, beginAtZero: false }
        }
      }
    });
  }
}

function refreshCharts(){
  const c = chartColors();
  Object.values(window._charts).forEach(ch => {
    if (!ch) return;
    if (ch.options.scales) {
      if (ch.options.scales.x && ch.options.scales.x.ticks) ch.options.scales.x.ticks.color = c.text;
      if (ch.options.scales.y) {
        if (ch.options.scales.y.ticks) ch.options.scales.y.ticks.color = c.text;
        if (ch.options.scales.y.grid) ch.options.scales.y.grid.color = c.grid;
      }
    }
    if (ch.options.plugins && ch.options.plugins.legend && ch.options.plugins.legend.labels) {
      ch.options.plugins.legend.labels.color = c.text;
    }
    ch.update();
  });
}
