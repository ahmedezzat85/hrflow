/**
 * Employee detail: Overview / Pay analytics tabs (#a-employee-detail).
 * Overview is the existing page; the Pay analytics panel is lazy and renders only
 * the sections the viewer is permitted to see (HR plan, Finance payments).
 */
(function (root) {
  const state = { empId: null, active: 'overview', loaded: false };

  function hasPerm(key) {
    return typeof SessionInfo !== 'undefined' && SessionInfo.hasPermission(key);
  }
  function canViewPlan() { return hasPerm('hr.salary.read'); }
  function canViewPayments() { return hasPerm('finance.report.read'); }
  function tabVisible() { return canViewPlan() || canViewPayments(); }

  const $ = (id) => document.getElementById(id);

  function selectTab(which, opts) {
    const o = opts || {};
    if (which === 'pay' && !tabVisible()) which = 'overview';
    state.active = which;
    const pay = which === 'pay';
    const tabs = { overview: $('employeeOverviewTab'), pay: $('employeePayTab') };
    const panels = { overview: $('employeeOverviewPanel'), pay: $('employeePayPanel') };
    if (!tabs.overview || !panels.overview) return;
    Object.keys(tabs).forEach((k) => {
      const on = k === which;
      tabs[k].classList.toggle('is-active', on);
      tabs[k].setAttribute('aria-selected', String(on));
      tabs[k].tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (o.focus) tabs[which].focus();
    if (pay && !state.loaded) {
      state.loaded = true;
      if (root.EmployeePayAnalyticsPanel && typeof root.EmployeePayAnalyticsPanel.open === 'function') {
        root.EmployeePayAnalyticsPanel.open(state.empId);
      }
    }
  }

  // Arrow/Home/End keys come from the shared initAccessibleTablist (finance-core.js), which clicks the target tab.
  let wired = false;
  function wire() {
    if (wired) return;
    const strip = $('employeeDetailTabs');
    if (!strip) return;
    wired = true;
    $('employeeOverviewTab').addEventListener('click', () => selectTab('overview'));
    $('employeePayTab').addEventListener('click', () => selectTab('pay'));
    const link = $('payrollPaymentsAnalyticsLink');
    if (link) link.addEventListener('click', () => selectTab('pay', { focus: true }));
  }

  // Called from viewProfile for every employee shown: reset to Overview, clear Pay state.
  function onEmployee(id) {
    wire();
    const strip = $('employeeDetailTabs');
    if (!strip) return;
    const changed = String(state.empId) !== String(id);
    if (changed) {
      state.empId = id;
      state.loaded = false;
      if (root.EmployeePayAnalyticsPanel && typeof root.EmployeePayAnalyticsPanel.reset === 'function') {
        root.EmployeePayAnalyticsPanel.reset();
      }
      selectTab('overview');
    }
    state.empId = id;
    strip.hidden = !tabVisible();
    const link = $('payrollPaymentsAnalyticsLink');
    if (link) link.hidden = !tabVisible();
  }

  root.EmployeePayAnalytics = { onEmployee, selectTab, canViewPlan, canViewPayments, tabVisible };
})(window);

/**
 * Pay analytics panel. Sections render only when their key is in the response:
 *   payments -> summary, "Pay by month" chart, monthly breakdown (Finance, finance.report.read)
 *   plan     -> raise markers on the chart, or plan summary and "Pay plan history" when payments is absent (HR, hr.salary.read)
 * Figures are payroll-line amounts, not statutory results.
 */
(function (root) {
  const P = {
    empId: null, preset: 'ytd', start: '', end: '', group: 'month', currency: 'USD',
    cache: new Map(), data: null, status: 'idle', error: '', token: 0, chart: null, built: false, currencies: ['USD'],
  };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(n) { return FinanceFormat.formatMoney(Number(n || 0), P.currency, { decimals: 2, minDecimals: 0 }); }
  function compact(n) {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }
  function pct(n) { return Number(n).toFixed(1).replace(/\.0$/, ''); }
  function share(part, whole) { return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'; }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  function resolveRange() {
    const now = new Date();
    if (P.preset === 'ytd') return { start: `${now.getFullYear()}-01-01`, end: ymd(now) };
    if (P.preset === '12m') return { start: ymd(new Date(now.getFullYear(), now.getMonth() - 11, 1)), end: ymd(now) };
    if (!P.start || !P.end || P.start > P.end) return null;
    return { start: P.start, end: P.end };
  }

  // ---- controls ---------------------------------------------------------------------------------
  function buildShell(panel) {
    panel.innerHTML = `
      <div class="pay-controls" id="payControls">
        <div class="pay-field"><label for="payPeriodSelect">Period</label>
          <select id="payPeriodSelect" data-hv-dropdown="sm">
            <option value="ytd">1 Jan to today</option>
            <option value="12m">Last 12 months</option>
            <option value="custom">Custom range</option>
          </select></div>
        <div class="pay-field" id="payCustomRange" hidden>
          <label for="payStartDate">From</label><input type="date" id="payStartDate">
        </div>
        <div class="pay-field" id="payCustomRangeEnd" hidden>
          <label for="payEndDate">To</label><input type="date" id="payEndDate">
        </div>
        <div class="pay-field"><span class="pay-label" id="payGroupByLabel">Group by</span>
          <div class="pay-seg" id="payGroupBy" role="group" aria-labelledby="payGroupByLabel">
            <button type="button" data-group="month" aria-pressed="true">Monthly</button>
            <button type="button" data-group="quarter" aria-pressed="false">Quarterly</button>
          </div></div>
        <div class="pay-field" id="payCurrencyField" hidden><label for="payCurrencySelect">Currency</label>
          <select id="payCurrencySelect" data-hv-dropdown="sm"></select></div>
        <div class="pay-spacer"></div>
        <div id="payControlsEnd"></div>
      </div>
      <div id="payBody" aria-live="polite"></div>`;
    if (typeof HvDropdown !== 'undefined') HvDropdown.init(panel);
    $('payPeriodSelect').addEventListener('change', (e) => {
      P.preset = e.target.value;
      $('payCustomRange').hidden = $('payCustomRangeEnd').hidden = P.preset !== 'custom';
      load();
    });
    $('payStartDate').addEventListener('change', (e) => { P.start = e.target.value; load(); });
    $('payEndDate').addEventListener('change', (e) => { P.end = e.target.value; load(); });
    $('payGroupBy').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-group]');
      if (!b || b.dataset.group === P.group) return;
      P.group = b.dataset.group;
      syncGroupButtons();
      load();
    });
    $('payCurrencySelect').addEventListener('change', (e) => { P.currency = e.target.value; load(); });
    $('payBody').addEventListener('click', onBodyClick);
    P.built = true;
  }

  function syncGroupButtons() {
    document.querySelectorAll('#payGroupBy button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === P.group)));
  }

  function syncCurrency(data) {
    const list = (data && data.currencies_available) || [];
    const field = $('payCurrencyField');
    if (!field) return;
    const show = list.length > 1;
    field.hidden = !show;
    if (show && list.join() !== P.currencies.join()) {
      P.currencies = list.slice();
      const sel = $('payCurrencySelect');
      sel.innerHTML = list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      sel.value = P.currency;
    }
  }

  // ---- loading ------------------------------------------------------------------------------------
  async function load() {
    if (!P.built || P.empId == null) return;
    const range = resolveRange();
    if (!range) { destroyChart(); P.status = 'invalid'; renderBody(); return; }
    const key = [P.empId, range.start, range.end, P.group, P.currency].join('|');
    const token = ++P.token;
    if (P.cache.has(key)) { P.data = P.cache.get(key); P.status = 'ready'; renderBody(); return; }
    P.status = 'loading';
    renderBody();
    try {
      const data = await AnalyticsApi.getEmployeePay(P.empId, { startDate: range.start, endDate: range.end, groupBy: P.group, currency: P.currency });
      if (token !== P.token) return;
      P.cache.set(key, data);
      P.data = data;
      P.status = 'ready';
    } catch (err) {
      if (token !== P.token) return;
      P.status = 'error';
      P.error = (err && err.message) || 'Could not load pay analytics.';
    }
    renderBody();
  }

  function open(empId) {
    const panel = $('employeePayPanel');
    if (!panel) return;
    P.empId = empId;
    if (!P.built) buildShell(panel);
    load();
  }

  function reset() {
    P.token++;
    destroyChart();
    P.cache.clear();
    P.data = null;
    P.status = 'idle';
    P.empId = null;
    P.preset = 'ytd'; P.start = ''; P.end = ''; P.group = 'month'; P.currency = 'USD'; P.currencies = ['USD'];
    const panel = $('employeePayPanel');
    if (panel) panel.innerHTML = '';
    P.built = false;
  }

  // ---- rendering ----------------------------------------------------------------------------------
  function card(titleHtml, iconCls, tile, metaHtml, bodyHtml) {
    return `<div class="card pay-card"><div class="card-head"><h3><span class="ed-tile ed-tile--${tile}"><i class="fa-solid ${iconCls}"></i></span> ${titleHtml}</h3>${metaHtml ? `<span class="ed-card-meta">${metaHtml}</span>` : ''}</div>${bodyHtml}</div>`;
  }
  function note(text) { return `<div class="pay-empty">${esc(text)}</div>`; }
  function kpi(label, valueHtml, sub, sw) {
    return `<div class="ed-kpi"><div class="ed-kpi-k">${sw ? `<span class="pay-sw pay-sw--${sw}" aria-hidden="true"></span>` : ''}${esc(label)}</div><div class="ed-kpi-v">${valueHtml}</div>${sub ? `<div class="ed-kpi-s">${esc(sub)}</div>` : ''}</div>`;
  }

  function renderBody() {
    const body = $('payBody');
    if (!body) return;
    destroyChart();
    if (P.status === 'loading') { body.setAttribute('aria-busy', 'true'); body.innerHTML = note('Loading pay analytics…'); return; }
    body.removeAttribute('aria-busy');
    if (P.status === 'invalid') { body.innerHTML = note('Choose a start date on or before the end date.'); return; }
    if (P.status === 'error') {
      body.innerHTML = `<div class="card pay-card"><div class="pay-empty pay-empty--error" role="alert">${esc(P.error)} <button type="button" class="btn btn-outline btn-sm" id="payRetryBtn">Retry</button></div></div>`;
      return;
    }
    const d = P.data;
    if (!d) { body.innerHTML = ''; return; }
    syncCurrency(d);
    const parts = [];
    if (d.payments) parts.push(...paymentsSections(d));
    else if (d.plan) parts.push(...planSections(d.plan));
    else parts.push(note('No pay analytics are available for your access.'));
    body.innerHTML = parts.join('');
    afterRender(d);
  }

  function raisesInPeriod(d) {
    if (!d.plan) return [];
    const { start_date: s, end_date: e } = d.period;
    return (d.plan.changes || []).filter((c) => c.date >= s && c.date <= e);
  }

  function paymentsSections(d) {
    const t = d.payments.totals;
    const series = d.payments.series || [];
    if (!series.length) return [card('Pay by month', 'fa-chart-column', 'blue', '', note('No payroll recorded for this period'))];
    const base = t.base_external + t.base_internal;
    const bonusPayments = series.filter((b) => b.bonus > 0).length;
    const unit = P.group === 'quarter' ? 'quarters' : 'months';
    const summary = `<div class="card pay-card" id="paySummary"><div class="pay-kpis ed-kpis">
      ${kpi('Total paid', `<span class="ed-kpi-v--brand">${esc(money(t.total))}</span>`, plural(t.cycles, 'payroll cycle', 'payroll cycles'))}
      ${kpi('Base pay', esc(money(base)), `${share(base, t.total)} of total`, 'base')}
      ${kpi('Commission', esc(money(t.commission)), `${share(t.commission, t.total)} · ${t.buckets_with_commission} ${unit} paid`, 'commission')}
      ${kpi('Bonus', esc(money(t.bonus)), `${share(t.bonus, t.total)} · ${plural(bonusPayments, 'payment', 'payments')}`, 'bonus')}
    </div></div>`;
    const raises = raisesInPeriod(d);
    const legend = `<div class="pay-legend" aria-hidden="true">
      <span><i class="pay-sw pay-sw--ext"></i>Base (external)</span><span><i class="pay-sw pay-sw--int"></i>Base (internal)</span>
      <span><i class="pay-sw pay-sw--commission"></i>Commission</span><span><i class="pay-sw pay-sw--bonus"></i>Bonus</span>
      ${d.plan ? '<span><i class="pay-sw pay-sw--raise"></i>Raise</span>' : ''}<span class="pay-legend-cur">${esc(P.currency)}</span></div>`;
    const raiseLine = d.plan ? `<div class="pay-chart-meta">${plural(raises.length, 'raise', 'raises')} in this period ${raises.length ? '· ' : ''}<button type="button" class="ed-link-btn" id="paySeeRaisesBtn">See raise history</button></div>` : '';
    const chart = card('Pay by month', 'fa-chart-column', 'blue', 'Payroll-line amounts · dashed line marks a raise',
      `${legend}<div class="pay-chart-wrap"><canvas id="payChartCanvas" role="img"></canvas><div class="pay-tip" id="payTip" hidden></div></div>${raiseLine}`);
    return [summary, chart];
  }

  function timeAt(dateStr) {
    const [y, m, dd] = dateStr.split('-').map(Number);
    const n = new Date();
    let months = (n.getFullYear() - y) * 12 + (n.getMonth() + 1 - m) - (n.getDate() < dd ? 1 : 0);
    if (months < 0) months = 0;
    if (months < 1) { const days = Math.max(0, Math.round((n - new Date(y, m - 1, dd)) / 86400000)); return plural(days, 'day', 'days'); }
    const yrs = Math.floor(months / 12), mo = months % 12;
    return yrs ? `${yrs} yr${mo ? ` ${mo} mo` : ''}` : plural(mo, 'month', 'months');
  }

  function planBars(plan) {
    if (plan.changes && plan.changes.length) return plan.changes.map((c) => ({ date: c.date, internal: c.new_internal, external: c.new_external, reason: c.reason || '', pct: c.pct_change }));
    return [{ date: plan.current.effective_date, internal: plan.current.internal, external: plan.current.external, reason: 'Current plan', pct: null }];
  }

  function planSections(plan) {
    if (!plan.current) return [card('Pay plan history', 'fa-chart-column', 'blue', '', note('No pay plan set'))];
    const ch = plan.changes || [];
    const first = ch[0];
    const overall = first && first.previous_total > 0 ? ((plan.current.total / first.previous_total) - 1) * 100 : null;
    const summary = `<div class="card pay-card" id="paySummary"><div class="pay-kpis pay-kpis--3 ed-kpis">
      ${kpi('Raises since joining', String(ch.length), ch.length ? `last on ${fmtDateShort(ch[ch.length - 1].date)}` : 'none yet')}
      ${kpi('Overall change', overall == null ? '—' : `${overall >= 0 ? '+' : ''}${pct(overall)}%`, first ? `${money(first.previous_total)} → ${money(plan.current.total)}` : '')}
      ${kpi('Time at current pay', esc(timeAt(plan.current.effective_date)), `since ${fmtDateShort(plan.current.effective_date)}`)}
    </div></div>`;
    const legend = `<div class="pay-legend" aria-hidden="true"><span><i class="pay-sw pay-sw--ext"></i>Base (external)</span><span><i class="pay-sw pay-sw--int"></i>Base (internal)</span><span class="pay-legend-cur">${esc(P.currency)}</span></div>`;
    const chart = card('Pay plan history', 'fa-chart-column', 'blue', 'Monthly base at each change',
      `${legend}<div class="pay-chart-wrap"><canvas id="payChartCanvas" role="img"></canvas><div class="pay-tip" id="payTip" hidden></div></div>`);
    return [summary, chart];
  }

  function onBodyClick(e) {
    if (e.target.closest('#payRetryBtn')) { load(); return; }
    if (e.target.closest('#paySeeRaisesBtn')) {
      if (root.EmployeePayAnalytics) EmployeePayAnalytics.selectTab('overview');
      const c = $('employeeCompensationCard');
      if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // ---- chart --------------------------------------------------------------------------------------
  const cssVar = (name) => getComputedStyle($('employeePayPanel')).getPropertyValue(name).trim();
  function palette() {
    return {
      ext: cssVar('--pay-ext'), int: cssVar('--pay-int'), com: cssVar('--pay-com'), bon: cssVar('--pay-bon'),
      grid: cssVar('--fv-line'), text: cssVar('--ink-muted'), strong: cssVar('--ink-strong'),
      pillBg: cssVar('--ink-strong'), pillFg: cssVar('--surface'), upFg: cssVar('--id-green-ink'), upBg: cssVar('--id-green'),
      surface: cssVar('--surface'),
    };
  }
  function destroyChart() { if (P.chart) { P.chart.destroy(); P.chart = null; } }

  const mKey = (k) => { const [y, m] = k.split('-').map(Number); return y * 12 + m - 1; };
  const qKey = (k) => { const [y, q] = k.split('-Q').map(Number); return y * 4 + q - 1; };
  function buildAxis(series, group) {
    const q = group === 'quarter';
    const toIdx = q ? qKey : mKey;
    const byIdx = new Map(series.map((r) => [toIdx(r.bucket), r]));
    const idxs = [...byIdx.keys()];
    const lo = Math.min(...idxs), hi = Math.max(...idxs);
    const axis = [];
    for (let i = lo; i <= hi; i++) {
      const y = q ? Math.floor(i / 4) : Math.floor(i / 12);
      const n = q ? (i % 4) + 1 : (i % 12) + 1;
      const showYear = i === lo || n === 1;
      const name = q ? `Q${n}` : MON[n - 1];
      axis.push({ idx: i, row: byIdx.get(i) || null, label: showYear ? [name, String(y)] : [name], full: q ? `Q${n} ${y}` : `${name} ${y}` });
    }
    return axis;
  }
  function bucketFraction(dateStr, group) {
    const [y, m, dd] = dateStr.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const inMonth = (dd - 1) / days;
    return group === 'quarter' ? { idx: y * 4 + Math.floor((m - 1) / 3), frac: (((m - 1) % 3) + inMonth) / 3 } : { idx: y * 12 + m - 1, frac: inMonth };
  }

  function totalsPlugin(totals, c) {
    return {
      id: 'payTotals',
      afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        const w = (x.right - x.left) / Math.max(1, totals.length);
        ctx.save();
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = c.strong;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        totals.forEach((t, i) => { if (t != null) ctx.fillText(w < 54 ? compact(t) : money(t).replace(/\.00$/, ''), x.getPixelForValue(i), y.getPixelForValue(t) - 5); });
        ctx.restore();
      },
    };
  }

  function pill(ctx, text, cx, cy, bg, fg) {
    ctx.save();
    ctx.font = '700 11px Inter, sans-serif';
    const w = ctx.measureText(text).width + 16, h = 20;
    const x = cx - w / 2;
    ctx.beginPath();
    ctx.roundRect(x, cy - h / 2, w, h, 10);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 0.5);
    ctx.restore();
    return { left: x, right: x + w };
  }

  function raisePlugin(axis, raises, c, hits, group) {
    return {
      id: 'payRaises',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x } } = chart;
        const cat = (x.right - x.left) / axis.length;
        hits.length = 0;
        let lastRight = -Infinity, row = 0;
        raises.forEach((r) => {
          const pos = bucketFraction(r.date, group);
          const i = axis.findIndex((b) => b.idx === pos.idx);
          if (i < 0) return;
          const px = x.getPixelForValue(i) + (pos.frac - 0.5) * cat;
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = c.strong;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
          ctx.restore();
          const label = `Raise +${pct(r.pct_change)}% · ${fmtDateShort(r.date)}`;
          ctx.font = '700 11px Inter, sans-serif';
          const w = ctx.measureText(label).width + 16;
          if (px - w / 2 < lastRight + 4) row++; else row = 0;
          const box = pill(ctx, label, Math.min(Math.max(px, a.left + w / 2), a.right - w / 2), a.top + 2 + row * 22, c.pillBg, c.pillFg);
          lastRight = box.right;
          hits.push({ x: px, r });
        });
      },
    };
  }

  function changePillsPlugin(bars, c) {
    return {
      id: 'payChangePills',
      afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        bars.forEach((b, i) => {
          if (i === 0 || b.pct == null) return;
          const prev = bars[i - 1];
          const cx = (x.getPixelForValue(i - 1) + x.getPixelForValue(i)) / 2;
          const top = Math.max(prev.internal + prev.external, b.internal + b.external);
          const sign = b.pct >= 0 ? '+' : '';
          pill(ctx, `${sign}${pct(b.pct)}%`, cx, y.getPixelForValue(top) - 6, `color-mix(in srgb, ${c.upBg} 20%, ${c.surface})`, c.upFg);
        });
      },
    };
  }

  function dataset(label, key, color, rows, c) {
    return { label, data: rows.map((r) => (r ? r[key] : null)), backgroundColor: color, borderColor: c.surface, borderWidth: 1, borderSkipped: false, maxBarThickness: 56 };
  }

  function tooltipConfig(rows, money_) {
    return {
      filter: (item) => item.raw > 0,
      callbacks: {
        title: (items) => (items.length ? rows[items[0].dataIndex].full : ''),
        label: (item) => ` ${item.dataset.label}: ${money_(item.raw)}`,
        afterBody: (items) => (items.length ? [`Total: ${money_(rows[items[0].dataIndex].total)}`] : []),
      },
    };
  }

  function afterRender(d) {
    const canvas = $('payChartCanvas');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'pay-empty', textContent: 'The chart library did not load. The figures above are unaffected.' })); return; }
    const c = palette();
    Chart.defaults.font.family = "'Inter', sans-serif";
    let labels, datasets, totals, plugins, tipRows, maxTotal, summaryText;
    const hits = [];
    if (d.payments) {
      const axis = buildAxis(d.payments.series, P.group);
      const rows = axis.map((b) => b.row);
      labels = axis.map((b) => b.label);
      totals = rows.map((r) => (r ? r.total : null));
      datasets = [
        dataset('Base (external)', 'base_external', c.ext, rows, c), dataset('Base (internal)', 'base_internal', c.int, rows, c),
        dataset('Commission', 'commission', c.com, rows, c), dataset('Bonus', 'bonus', c.bon, rows, c),
      ];
      tipRows = axis.map((b) => (b.row ? { ...b.row, full: b.full } : { total: 0, full: b.full }));
      const lo = axis[0].idx, hi = axis[axis.length - 1].idx;
      const inSpan = raisesInPeriod(d).filter((r) => { const p = bucketFraction(r.date, P.group); return p.idx >= lo && p.idx <= hi; });
      plugins = [totalsPlugin(totals, c), raisePlugin(axis, inSpan, c, hits, P.group)];
      const t = d.payments.totals;
      summaryText = `Pay by ${P.group}, ${fmtDateShort(d.period.start_date)} to ${fmtDateShort(d.period.end_date)}. Total paid ${money(t.total)} over ${plural(t.cycles, 'payroll cycle', 'payroll cycles')}, ${P.currency}. ${plural(raisesInPeriod(d).length, 'raise', 'raises')} in this period. The monthly breakdown lists the same figures.`;
    } else {
      const bars = planBars(d.plan);
      labels = bars.map((b) => [fmtDateShort(b.date), b.reason.length > 18 ? `${b.reason.slice(0, 17)}…` : b.reason]);
      totals = bars.map((b) => b.internal + b.external);
      const rows = bars.map((b) => ({ base_external: b.external, base_internal: b.internal, total: b.internal + b.external }));
      datasets = [dataset('Base (external)', 'base_external', c.ext, rows, c), dataset('Base (internal)', 'base_internal', c.int, rows, c)];
      tipRows = bars.map((b, i) => ({ total: totals[i], full: `${fmtDateShort(b.date)}${b.reason ? ` · ${b.reason}` : ''}` }));
      plugins = [totalsPlugin(totals, c), changePillsPlugin(bars, c)];
      summaryText = `Pay plan history: ${plural(bars.length, 'plan entry', 'plan entries')}, current monthly base ${money(totals[totals.length - 1])}, ${P.currency}.`;
    }
    canvas.setAttribute('aria-label', summaryText);
    maxTotal = Math.max(...totals.filter((t) => t != null), 0);
    const tick = (v) => compact(v);
    P.chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      plugins,
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: d.plan && d.payments ? 30 : 20 } },
        interaction: { mode: 'index', intersect: true },
        plugins: { legend: { display: false }, tooltip: tooltipConfig(tipRows, money) },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: c.text, font: { size: 11 }, maxRotation: 0, autoSkip: false } },
          y: { stacked: true, beginAtZero: true, suggestedMax: maxTotal * 1.1, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, font: { size: 11 }, callback: tick, maxTicksLimit: 6 } },
        },
      },
    });
    wireMarkerTip(canvas, hits);
  }

  function wireMarkerTip(canvas, hits) {
    const tip = $('payTip');
    if (!tip || !hits) return;
    const hide = () => { tip.hidden = true; };
    canvas.addEventListener('mouseleave', hide);
    canvas.addEventListener('mousemove', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const area = P.chart && P.chart.chartArea;
      const hit = area && py >= area.top && py <= area.bottom ? hits.find((h) => Math.abs(h.x - px) <= 6) : null;
      if (!hit) { hide(); return; }
      const r = hit.r;
      tip.textContent = '';
      const line = (text, strong) => { const el = document.createElement(strong ? 'strong' : 'div'); el.textContent = text; tip.appendChild(el); };
      line(`Raise · ${fmtDateShort(r.date)}`, true);
      line(`Previous total: ${money(r.previous_total)}`);
      line(`New total: ${money(r.new_total)}`);
      line(`Change: +${pct(r.pct_change)}%`);
      if (r.reason) line(`Reason: ${r.reason}`);
      tip.hidden = false;
      const wrap = canvas.parentElement.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(8, px + 12), wrap.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.max(8, py - tip.offsetHeight - 8)}px`;
    });
  }

  // Re-render the chart when the theme flips (colours are read from CSS variables at render time).
  new MutationObserver(() => { if (P.chart && P.status === 'ready') renderBody(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  root.EmployeePayAnalyticsPanel = { open, reset };
})(window);
