function chartColors(){
  // Canvas cannot use var(): read the active theme's token values at draw time.
  const cs = getComputedStyle(document.documentElement);
  const tok = (name) => cs.getPropertyValue(name).trim();
  return {
    grid: tok('--border2'),
    text: tok('--text2'),
    accent: tok('--accent'),
    warning: tok('--id-orange'),
    success: tok('--id-green'),
    info: tok('--id-sky'),
    vacation: tok('--id-teal'),
    wfh: tok('--id-sky'),
    insurance: tok('--id-pink'),
    external: tok('--id-blue'),
    internal: tok('--id-green')
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

  // 1. Bar Chart: Last 6 Months Requests & Claims (Stacked)
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
          { label: 'Vacation', data: vacData, backgroundColor: c.vacation, borderRadius: 5, borderSkipped: false, maxBarThickness: 34 },
          { label: 'Work from home', data: wfhData, backgroundColor: c.wfh, borderRadius: 5, borderSkipped: false, maxBarThickness: 34 },
          { label: 'Medical claim', data: insData, backgroundColor: c.insurance, borderRadius: 5, borderSkipped: false, maxBarThickness: 34 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: c.text }
          },
          y: {
            stacked: true,
            display: false,
            beginAtZero: true
          }
        }
      },
      plugins: [{
        // Request count above each stacked month bar (HR dashboard mock)
        id: 'stackTotals',
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          const top = chart.getDatasetMeta(data.datasets.length - 1);
          ctx.save();
          ctx.font = '600 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = chartColors().text;
          const lastVisible = (i) => {
            for (let d = data.datasets.length - 1; d >= 0; d--) { if (Number(data.datasets[d].data[i]) > 0) return chart.getDatasetMeta(d).data[i]; }
            return top.data[i];
          };
          top.data.forEach((_, i) => {
            const total = data.datasets.reduce((sum, d) => sum + (Number(d.data[i]) || 0), 0);
            if (total > 0) { const bar = lastVisible(i); ctx.fillText(String(total), bar.x, bar.y - 6); }
          });
          ctx.restore();
        }
      }]
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

  // 3. Stacked Bar Chart: Employee Compensation Growth
  const emp = (Array.isArray(employees) ? employees.find(e => e.id === window.LOGGED_IN_EMPLOYEE_ID) : null) || currentLoggedInEmployee;
  const ctx3 = document.getElementById('chartSalary');
  if (ctx3 && emp && emp.salaryHistory && emp.salaryHistory.length) {
    if (window._charts.salary) {
      window._charts.salary.destroy();
    }
    const sorted = emp.salaryHistory.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    window._charts.salary = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: sorted.map((s, i) => {
          if (!s.date) return '—';
          if (i === sorted.length - 1 && new Date(s.date) <= new Date()) return 'Today';
          return new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        }),
        datasets: [
          {
            label: 'External USD',
            data: sorted.map(s => s.newExternal || 0),
            backgroundColor: c.external,
            borderRadius: 5,
            maxBarThickness: 44,
            stack: 'pay'
          },
          {
            label: 'Internal USD cash',
            data: sorted.map(s => s.newInternal || 0),
            backgroundColor: c.internal,
            borderRadius: 5,
            maxBarThickness: 44,
            stack: 'pay'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: c.text } },
          y: { stacked: true, display: false, beginAtZero: true }
        }
      },
      plugins: [{
        // Monthly total above each stacked bar (Employee Salary mock)
        id: 'stackTotals',
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          const last = chart.getDatasetMeta(data.datasets.length - 1);
          ctx.save();
          ctx.font = '600 12px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = chartColors().text;
          last.data.forEach((bar, i) => {
            const total = data.datasets.reduce((sum, d) => sum + (Number(d.data[i]) || 0), 0);
            ctx.fillText('$' + total.toLocaleString('en-US'), bar.x, bar.y - 6);
          });
          ctx.restore();
        }
      }]
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
    // Dataset fills follow the theme too (identity colours differ between light and dark).
    const fills = { 'Vacation': c.vacation, 'Work from home': c.wfh, 'Medical claim': c.insurance, 'External USD': c.external, 'Internal USD cash': c.internal };
    (ch.data.datasets || []).forEach(ds => {
      if (Array.isArray(ds.backgroundColor)) ds.backgroundColor = [c.accent, c.warning, c.success];
      else if (fills[ds.label]) ds.backgroundColor = fills[ds.label];
    });
    ch.update();
  });
}
