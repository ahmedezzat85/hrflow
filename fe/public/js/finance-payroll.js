/**
 * fe/public/js/finance-payroll.js
 * In-Page Payroll Module Controller for HRFlow (Six-Screen Journey)
 * Sourced and synced directly with real database employees and bank accounts
 */

(function () {
  const seedEmployees = [
    { id: 301, name: 'Youssef Adel', role: 'Software Engineer', dept: 'Engineering', baseExt: 1800, baseInt: 4300, deductions: 473.00, deductions_total: 473.00, bonuses: [], exception: null },
    { id: 302, name: 'Salma Ibrahim', role: 'Product Manager', dept: 'Product', baseExt: 0, baseInt: 4450, deductions: 489.50, deductions_total: 489.50, bonuses: [{ type: 'Support Commission', amount: 360, source: 'internal' }], exception: null },
    { id: 303, name: 'Karim Nabil', role: 'Design Lead', dept: 'Design', baseExt: 2500, baseInt: 4500, deductions: 495.00, deductions_total: 495.00, bonuses: [{ type: 'Bonus', amount: 600, source: 'external' }], exception: null },
    { id: 304, name: 'Mariam Essam', role: 'Sales Executive', dept: 'Sales', baseExt: 1200, baseInt: 4550, deductions: 500.50, deductions_total: 500.50, bonuses: [{ type: 'Sales Commission', amount: 1050, source: 'internal' }, { type: 'Bonus', amount: 200, source: 'external' }], exception: null },
    { id: 305, name: 'Omar Farouk', role: 'Support Specialist', dept: 'Support', baseExt: 0, baseInt: 4200, deductions: 462.00, deductions_total: 462.00, bonuses: [{ type: 'Support Commission', amount: 430, source: 'internal' }], exception: null },
    { id: 306, name: 'Nadine Samir', role: 'HR Coordinator', dept: 'Human Resources', baseExt: 2000, baseInt: 3100, deductions: 341.00, deductions_total: 341.00, bonuses: [], exception: null },
    { id: 307, name: 'Hassan Tarek', role: 'DevOps Engineer', dept: 'Infrastructure', baseExt: 0, baseInt: 5200, deductions: 572.00, deductions_total: 572.00, bonuses: [{ type: 'Bonus', amount: 750, source: 'internal' }], exception: null },
    { id: 308, name: 'Lina Kamal', role: 'Finance Analyst', dept: 'Finance', baseExt: 1600, baseInt: 3900, deductions: 429.00, deductions_total: 429.00, bonuses: [], exception: null }
  ];

  const seedBanks = [
    { id: 1, name: 'Primary Treasury Operating Account', type: 'internal', currency: 'USD', number: '****4021', isDefault: true },
    { id: 2, name: 'Global Payments Partner Account', type: 'external', currency: 'USD', number: '****7788', isDefault: true }
  ];

  const FLOW = ['initiation', 'approve', 'processing', 'preview', 'confirmation', 'statutory'];
  const STEP_META = {
    initiation: { label: 'Set up', hint: 'Step 1 of 6 — Confirm payroll schedule, target funding accounts, and currency exchange rate.' },
    approve: { label: 'Review pay', hint: 'Step 2 of 6 — Review base compensation and dynamic bonus/commission additions. Submit & approve run.' },
    processing: { label: 'Statutory', hint: 'Step 3 of 6 — Review frozen backend statutory snapshots. Idempotently finalized upon entry.' },
    preview: { label: 'Payment preview', hint: 'Step 4 of 6 — Preview the payment breakdown by salary type before recording payment.' },
    confirmation: { label: 'Confirm payment', hint: 'Step 5 of 6 — Disburse funds and auto-post general ledger journal entries.' },
    statutory: { label: 'Statutory payments', hint: 'Step 6 of 6 — Reconcile portal liabilities and record/settle statutory obligations.' }
  };
  const DONE_HINT = 'Cycle complete — payroll is Paid and statutory obligations are reconciled.';

  const PayrollApp = {
    rows: (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) ? JSON.parse(JSON.stringify(seedEmployees)) : [],
    banks: (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) ? JSON.parse(JSON.stringify(seedBanks)) : [],
    serverRuns: [],
    runsLoadError: null,
    selectedExternalAccountId: null,
    selectedInternalAccountId: null,
    fundingSummary: { external: null, internal: null },
    accountsDenied: false,
    month: '2026-09',
    payDate: '2026-09-30',
    start: '2026-09-01',
    end: '2026-09-30',
    fxRateValue: null,
    fxRateSource: null,
    resolvedFxRate: 50.0,
    fxResolved: false, // true only once a preview returned a real rate (manual or from transfer history)
    resolvedFxSource: 'fallback',
    employeeInsuranceRate: 0.11,
    employerInsuranceRate: 0.18,
    stepIndex: 0,
    expandedId: null,
    journalPosted: false,
    currentRun: null,
    currentPreview: null,
    audit: [],
    historyRuns: [],
    initialized: false,

    async init() {
      // 1. Sync real data from database/API
      await this.loadEmployeesFromDb();
      await this.loadBankAccountsFromDb();
      await this.loadSettingsFromDb();
      await this.loadRunsFromDb();
      await this.fetchPreview();

      // 2. Set current user name
      const userNameEl = document.getElementById('payrollCurrentUserName');
      if (userNameEl) {
        const curName = (typeof SessionInfo !== 'undefined' && SessionInfo.getName && SessionInfo.getName()) || 'Admin';
        userNameEl.textContent = curName;
      }

      // 3. Populate settings form inputs
      const monthInput = document.getElementById('payrollSetMonth');
      if (monthInput) monthInput.value = this.month;
      const payDateInput = document.getElementById('payrollSetPayDate');
      if (payDateInput) payDateInput.value = this.payDate;
      const startInput = document.getElementById('payrollSetStart');
      if (startInput) startInput.value = this.start;
      const endInput = document.getElementById('payrollSetEnd');
      if (endInput) endInput.value = this.end;
      const fxInput = document.getElementById('payrollSetFxRate');
      if (fxInput) fxInput.value = this.fxRateValue || '';

      this.drawFundingAccounts();
      this.redraw();

      if (!this.initialized) {
        this.initialized = true;
        const urlParams = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
        const targetRun = urlParams ? (urlParams.get('payroll_run_id') || urlParams.get('run_id') || urlParams.get('period')) : null;
        if (targetRun) {
          await this.openRun(targetRun);
        } else {
          this.showPage('list');
        }
      }
    },

    async loadEmployeesFromDb() {
      try {
        let rawEmployees = null;
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (isMockMode) {
          if (typeof FinanceMockState !== 'undefined' && Array.isArray(FinanceMockState.employees) && FinanceMockState.employees.length > 0) {
            rawEmployees = FinanceMockState.employees;
          } else if (typeof window !== 'undefined' && Array.isArray(window.employees) && window.employees.length > 0) {
            rawEmployees = window.employees;
          } else {
            rawEmployees = seedEmployees;
          }
        } else {
          if (typeof Api !== 'undefined' && typeof Api.getEmployees === 'function') {
            try {
              rawEmployees = await Api.getEmployees();
            } catch (apiErr) {
              console.error('[PayrollApp] API fetch employees failed:', apiErr);
              this.rows = [];
              this.showBanner('Failed to load active employees from server.', 'red');
              return;
            }
          }
          if (!rawEmployees && typeof window !== 'undefined' && Array.isArray(window.employees) && window.employees.length > 0) {
            rawEmployees = window.employees;
          }
        }

        if (Array.isArray(rawEmployees) && rawEmployees.length > 0) {
          const existingBonusesMap = {};
          (this.rows || []).forEach(r => {
            if (r.bonuses && r.bonuses.length) {
              existingBonusesMap[r.id] = r.bonuses;
            }
          });

          const activeEmps = rawEmployees.filter(e => !e.status || String(e.status).toLowerCase() === 'active');
          if (activeEmps.length > 0) {
            this.rows = activeEmps.map(e => {
              const baseExt = Number(e.externalSalaryUsd !== undefined ? e.externalSalaryUsd : (e.external_salary_usd || 0));
              let baseInt = Number(e.internalSalaryUsd !== undefined ? e.internalSalaryUsd : (e.internal_salary_usd || 0));
              if (baseExt === 0 && baseInt === 0 && e.salary) {
                baseInt = Number(e.salary);
              }
              const ded = Number(e.deductions !== undefined ? e.deductions : (e.deductions_total || 0));
              return {
                id: e.id,
                name: e.name,
                role: e.role || e.title || e.position || e.dept || 'Employee',
                dept: e.dept || e.department || 'Operations',
                baseExt: baseExt,
                baseInt: baseInt,
                deductions: ded,
                deductions_total: ded,
                bonuses: existingBonusesMap[e.id] || [],
                exception: null
              };
            });
          }
        } else if (!isMockMode) {
          this.rows = [];
          this.showBanner('No active employee records found on server.', 'red');
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load employees from database:', err);
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!isMockMode) {
          this.rows = [];
          this.showBanner('Failed to load active employee records from server.', 'red');
        }
      }
    },

    async loadBankAccountsFromDb() {
      try {
        let rawAccounts = null;
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getAccounts === 'function') {
          rawAccounts = await FinanceApi.getAccounts({ is_active: true });
        }

        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!rawAccounts && isMockMode) {
          rawAccounts = seedBanks;
        }

        if (Array.isArray(rawAccounts) && rawAccounts.length > 0) {
          this.banks = rawAccounts.map(acc => ({
            id: acc.id,
            name: acc.account_name || acc.name || `Account #${acc.id}`,
            bank_name: acc.bank_name || '',
            currency: acc.currency || 'USD',
            number: acc.account_number || '****'
          }));
        } else if (!isMockMode) {
          this.banks = [];
          this.showBanner('Failed to load company funding accounts from server.', 'red');
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load bank accounts from database:', err);
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        // A role without finance.account.read (Payroll-Maker) cannot list accounts. That is expected: the
        // run uses the accounts set in Payroll settings, which are shown from the settings response.
        this.accountsDenied = /permission denied|forbidden/i.test((err && err.message) || '');
        if (!isMockMode) {
          this.banks = [];
          if (!this.accountsDenied) this.showBanner('Failed to load company funding accounts from server.', 'red');
        }
      }
    },

    async loadRunsFromDb() {
      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getPayrollRuns === 'function') {
          const runs = await FinanceApi.getPayrollRuns();
          if (Array.isArray(runs)) {
            this.serverRuns = runs;
            this.runsLoadError = null;
          }
        }
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.listStatutoryObligations === 'function') {
          const obligations = await FinanceApi.listStatutoryObligations();
          if (Array.isArray(obligations)) {
            this.allObligations = obligations;
          }
        }
      } catch (err) {
        console.error('[PayrollApp] Could not load payroll runs from API:', err);
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!isMockMode) {
          this.serverRuns = [];
          this.runsLoadError = err.message || 'Failed to load payroll runs from server.';
          this.showBanner(this.runsLoadError, 'red');
        }
      }
    },

    // Funding accounts are owned by Payroll Settings: runs read them, they are not chosen per run.
    applyFundingFromSettings(settings) {
      this.selectedExternalAccountId = settings.external_funding_account_id || null;
      this.selectedInternalAccountId = settings.internal_funding_account_id || null;
      this.fundingSummary = {
        external: settings.external_funding_account || null,
        internal: settings.internal_funding_account || null,
      };
    },

    canSetFundingAccounts() {
      return this.canPermission('finance.settings.write') && this.canPermission('finance.account.read') && (this.banks || []).length > 0;
    },

    fundingOptionHtml(selectedId, summary) {
      if (!selectedId) return '<option value="" selected disabled>Not set</option>';
      const bank = (this.banks || []).find(b => String(b.id) === String(selectedId));
      const label = bank ? this.fundingAccountLabel(bank) : escapeHtml((summary && summary.name) || `Account #${selectedId}`);
      return `<option value="${selectedId}" selected>${label}</option>`;
    },

    money(v) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v || 0);
    },

    nowStamp() {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toISOString().slice(0, 10);
      return dateStr + ' ' + timeStr;
    },

    currentStatusKey() {
      if (this.currentRun && this.currentRun.status) return this.currentRun.status;
      const legacyMap = ['draft', 'draft', 'approved', 'finalized', 'processing', 'paid'];
      return legacyMap[this.stepIndex] || 'draft';
    },

    bonusTotals(row) {
      let internal = 0, external = 0;
      (row.bonuses || []).forEach(b => {
        if (b.source === 'internal') internal += Number(b.amount || 0);
        else external += Number(b.amount || 0);
      });
      return { internal, external, total: internal + external };
    },

    computeRow(row) {
      const b = this.bonusTotals(row);
      const totalInternal = (row.baseInt || 0) + b.internal;
      const deductions = Number(row.deductions !== undefined ? row.deductions : (row.deductions_total || 0));
      // Egyptian statutory policy: Internal cash payment is whole-dollar rounded (quantize_integer_currency)
      const internal = Math.round(totalInternal - deductions);
      const external = (row.baseExt || 0) + b.external;
      const net = internal + external;
      return { bonusTotal: b.total, totalInternal, deductions, internal, external, net };
    },

    rollup() {
      return this.rows.reduce((acc, r) => {
        const c = this.computeRow(r);
        acc.baseExt += (r.baseExt || 0);
        acc.baseInt += (r.baseInt || 0);
        acc.bonus += c.bonusTotal;
        acc.totalInt += c.totalInternal;
        acc.deductions += c.deductions;
        acc.internal += c.internal;
        acc.external += c.external;
        acc.net += c.net;
        return acc;
      }, { baseExt: 0, baseInt: 0, bonus: 0, totalInt: 0, deductions: 0, internal: 0, external: 0, net: 0 });
    },

    exceptions() {
      const out = [];
      this.rows.forEach(r => {
        const b = this.bonusTotals(r);
        if (b.total >= 1000) {
          out.push({ type: 'warning', name: r.name, text: 'Total bonus amount is unusually high and should be reviewed.', empId: r.id });
        }
        if (r.exception) {
          out.push({ type: 'blocking', name: r.name, text: r.exception, empId: r.id, retry: true });
        }
      });
      return out;
    },

    addAudit(text) {
      const who = (typeof SessionInfo !== 'undefined' && SessionInfo.getName && SessionInfo.getName()) || 'Admin';
      this.audit.unshift({ who, when: this.nowStamp(), text });
    },

    /* ---------------- Runs list view ---------------- */
    drawRunsList() {
      const tbody = document.getElementById('payrollRunsTableBody');
      const countEl = document.getElementById('payrollRunsCount');
      if (!tbody) return;
      const newRunBtn = document.getElementById('btnStartNewRun');
      if (newRunBtn) newRunBtn.hidden = !this.canPermission('finance.payroll.prepare');

      if (this.runsLoadError) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger); padding:24px;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(this.runsLoadError)}</td></tr>`;
        if (countEl) countEl.textContent = '0 runs';
        return;
      }

      const currentStatus = this.currentStatusKey();
      const statusMap = {
        draft: ['Draft', 'b-gray'],
        submitted: ['Submitted', 'b-blue'],
        approved: ['Approved', 'b-blue'],
        finalized: ['Finalized', 'b-blue'],
        processing: ['Processing', 'b-orange'],
        partially_paid: ['Partially paid', 'b-orange'],
        paid: ['Salaries paid', 'b-green']
      };
      const t = this.rollup();

      // A saved run for the current month is shown with its saved status and total;
      // the local draft row appears only when no run has been saved yet.
      const savedCurrent = (this.serverRuns || []).some(r => r.period_label === this.month);
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthName = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || '')); return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(ym || ''); };
      const rangeText = (a, b) => {
        const pa = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(a || '')); const pb = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b || ''));
        if (!pa || !pb) return `${a || ''} &rarr; ${b || ''}`;
        return `${+pa[3]}&ndash;${+pb[3]} ${SHORT[+pb[2] - 1]} ${pb[1]}`;
      };
      const dayText = (d) => { const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return p ? `${+p[3]} ${SHORT[+p[2] - 1]} ${p[1]}` : String(d || ''); };
      const dot = '<span class="pv-dot"></span>';
      const pill = (cls, text) => `<span class="pv-pill ${cls}">${dot}${text}</span>`;
      const rows = [];
      const stampText = (v) => {
        const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?:\s*([AP]M))?/i.exec(String(v || ''));
        if (!p) return null;
        let hh = +p[4];
        if (p[6]) { const pm = p[6].toUpperCase() === 'PM'; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
        return `${+p[3]} ${SHORT[+p[2] - 1]} ${p[1]}, ${String(hh).padStart(2, '0')}:${p[5]}`;
      };
      const rowHtml = (o) => `
        <tr class="clickable" data-cat="${o.cat}" data-stat-open="${o.statOpen ? 1 : 0}" onclick="PayrollApp.openRun('${o.arg}')">
          <td data-label="Period"><strong class="pv-period">${escapeHtml(o.period)}</strong><span class="pv-period-sub">${rangeText(o.start, o.end)}</span><span class="sr-only">${escapeHtml(o.periodLabel || '')}</span></td>
          <td data-label="Salaries">${o.salaries}</td>
          <td data-label="Statutory">${o.statutory}</td>
          <td data-label="Employees" class="num">${o.hc}</td>
          <td data-label="Net pay" class="payroll-num num">${o.net}${o.projected ? '<div class="pv-sub">projected</div>' : ''}</td>
          <td data-label="Last saved">${o.upd}</td>
          <td data-label="Actions" class="col-actions"><button type="button" class="btn btn-sm ${o.primary ? 'btn-fill' : 'btn-outline'}" onclick="event.stopPropagation(); PayrollApp.openRun('${o.arg}')">${o.action}</button></td>
        </tr>`;
      const salaryPill = (key, label, stepNo) => {
        if (key === 'draft') return `<span class="pv-pill pv-pill--draft">${dot}${label} \u00b7 step ${stepNo} of 6</span>`;
        if (key === 'paid') return pill('pv-pill--paid', label);
        if (key === 'partially_paid' || key === 'processing') return pill('pv-pill--part', label);
        return pill('pv-pill--open', label);
      };
      if (!savedCurrent) {
        rows.push({
          arg: 'current', cat: 'draft', statOpen: false, period: monthName(this.month), periodLabel: this.month, start: this.start, end: this.end,
          salaries: salaryPill(currentStatus, statusMap[currentStatus] ? statusMap[currentStatus][0] : 'Draft', this.stepIndex + 1),
          statutory: pill('pv-pill--none', 'Not started'), hc: this.rows.length, net: this.money(t.net), projected: true,
          upd: (this.audit[0] && stampText(this.audit[0].when)) || 'Not saved yet', action: 'Continue', primary: true
        });
      }

      const pastRuns = this.serverRuns || [];
      pastRuns.forEach(r => {
        const sKey = (r.status || 'draft').toLowerCase();
        const sBadge = statusMap[sKey] || ['Draft', 'b-gray'];
        const netVal = r.total_net !== undefined ? r.total_net : (r.net || 0);
        const hc = r.headcount !== undefined ? r.headcount : (r.employees || (r.lines ? r.lines.length : 0));
        const upd = r.paid_at || r.updated_at || r.created_at || '';
        const displayUpd = stampText(upd) || 'Not saved yet';
        let statutory = pill('pv-pill--none', 'Not started');
        let statOpen = false;
        let action = sKey === 'draft' ? 'Continue' : 'Open';
        let primary = sKey === 'draft';
        if (sKey === 'paid' || sKey === 'partially_paid') {
          const obls = (this.allObligations || []).filter(o =>
            (r.id !== undefined && r.id !== null && (o.source_id === r.id || String(o.source_id) === String(r.id))) ||
            (o.notes && o.notes.includes('payroll_run_id:' + r.id)) ||
            (r.period_label && o.period === r.period_label)
          );
          const resolved = this.resolvePayrollRunState(r, obls);
          if (resolved && resolved.badge) {
            const partial = /partial/i.test(resolved.badge);
            const settled = /reconciled$/i.test(resolved.badge) && !partial;
            statOpen = !settled;
            statutory = pill(partial ? 'pv-pill--part' : (settled ? 'pv-pill--paid' : 'pv-pill--open'), resolved.badge);
            action = partial ? 'Reconcile' : (settled ? 'Open' : 'Record statutory');
            primary = partial;
          }
        }
        rows.push({
          arg: String(r.id || r.period_label), cat: (sKey === 'paid' || sKey === 'partially_paid') ? 'paid' : 'draft', statOpen,
          period: monthName(r.period_label), periodLabel: r.period_label, start: r.period_start || (r.period_label + '-01'), end: r.period_end || (r.period_label + '-30'),
          salaries: salaryPill(sKey, sBadge[0], this.resolvePayrollRunState(r, []).stepIndex + 1), statutory, hc, net: this.money(netVal), upd: displayUpd, action, primary
        });
      });

      tbody.innerHTML = rows.map(rowHtml).join('');
      const total = rows.length;
      if (countEl) countEl.textContent = `${total} runs total`;
      const foot = document.getElementById('payrollRunsFoot');
      if (foot) foot.innerHTML = `<span>Showing <strong>${total ? '1\u2013' + total : '0'}</strong> of <strong>${total}</strong> runs \u00b7 every action is saved, open a run to continue where it stopped</span><span>Page 1 of 1</span>`;

      // Status filter pills (All / Draft / Salaries paid / Statutory open)
      const filterEl = document.getElementById('payrollRunsFilter');
      if (filterEl) {
        const count = (fn) => rows.filter(fn).length;
        const defs = [
          ['all', 'All', total, ''],
          ['draft', 'Draft', count(x => x.cat === 'draft'), 'pv-fp--draft'],
          ['paid', 'Salaries paid', count(x => x.cat === 'paid'), 'pv-fp--paid'],
          ['stat', 'Statutory open', count(x => x.statOpen), 'pv-fp--open']
        ];
        const cur = this._runsFilter || 'all';
        filterEl.innerHTML = defs.map(([k, label, n, cls]) =>
          `<button type="button" class="pv-fp ${cls}${cur === k ? ' active' : ''}" data-runs-filter="${k}" aria-pressed="${cur === k}">${k === 'all' ? '' : dot}${label} <span class="pv-fp-n">${n}</span></button>`).join('');
        const apply = () => {
          const f = this._runsFilter || 'all';
          tbody.querySelectorAll('tr').forEach(tr => {
            const show = f === 'all' || (f === 'stat' ? tr.dataset.statOpen === '1' : tr.dataset.cat === f);
            tr.hidden = !show;
          });
          filterEl.querySelectorAll('.pv-fp').forEach(b => { const on = b.dataset.runsFilter === f; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
        };
        filterEl.onclick = (e) => { const b = e.target.closest('.pv-fp'); if (!b) return; this._runsFilter = b.dataset.runsFilter; apply(); };
        apply();
      }

      // Current-cycle banner
      const banner = document.getElementById('payrollCycleBanner');
      if (banner) {
        const STEP_NAMES = ['set up', 'review pay', 'statutory', 'payment preview', 'confirm payment', 'statutory payments'];
        const savedForMonth = (this.serverRuns || []).find(r => r.period_label === this.month);
        const stepNo = (savedForMonth ? this.resolvePayrollRunState(savedForMonth, []).stepIndex : this.stepIndex) + 1;
        banner.hidden = false;
        banner.innerHTML = `
          <span class="pv-banner-main"><span class="pv-banner-kicker">Current cycle \u00b7 step ${stepNo} of 6, ${STEP_NAMES[stepNo - 1] || ''}</span><span class="pv-banner-title">${escapeHtml(monthName(this.month))}</span><span class="pv-banner-sub">Pay date ${dayText(this.payDate)} &middot; ${this.rows.length} employees eligible &middot; saved automatically</span></span>
          <span class="pv-banner-net"><span class="pv-banner-kicker">Projected net pay</span><span class="pv-banner-amt">${this.money(t.net)}</span></span>
          <span class="pv-banner-btn" id="btnOpenCurrentCycle">Continue run</span>`;
        banner.onclick = () => PayrollApp.openRun('current');
      }
    },

    // Period defaults for a calendar month "YYYY-MM": first to last day, paid on the last day.
    setPeriod(ym) {
      const [y, m] = ym.split('-').map(Number);
      const last = new Date(y, m, 0).getDate();
      this.month = ym;
      this.start = `${ym}-01`;
      this.end = `${ym}-${String(last).padStart(2, '0')}`;
      this.payDate = this.end;
    },

    // Starts a fresh run for the current calendar month (the month can be changed on screen 1).
    // If a run for that month already exists it is opened instead: only one active run per period.
    async startNewRun() {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const existing = (this.serverRuns || []).find(r => r.period_label === ym);
      if (existing && existing.id) {
        this.showBanner(`A payroll run for ${ym} already exists. Opening it; pick another month on step 1 for a different period.`, 'blue');
        await this.openHistoryRun(existing.id);
        return;
      }
      this.currentRun = null;
      this.currentPreview = null;
      this.setPeriod(ym);
      this.showPage('run');
      await this.setStep(0);
      await this.fetchPreview();
      this.drawScreen1();
    },

    async openRun(id) {
      if (id === 'current') {
        const existing = (this.serverRuns || []).find(r => r.period_label === this.month);
        if (existing && existing.id) {
          await this.openHistoryRun(existing.id);
          return;
        }
        this.showPage('run');
        this.setStep(0);
        return;
      }
      await this.openHistoryRun(id);
    },

    resolvePayrollRunState(run, linkedObligations = []) {
      if (!run || typeof run !== 'object') {
        return { stepIndex: 1, screen: 2, badge: null, badgeClass: null };
      }

      const status = (run.status || '').toLowerCase();

      if (status === 'draft' || status === 'submitted') {
        return { stepIndex: 1, screen: 2, badge: null, badgeClass: null };
      }
      if (status === 'approved') {
        return { stepIndex: 2, screen: 3, badge: null, badgeClass: null };
      }
      if (status === 'finalized') {
        return { stepIndex: 3, screen: 4, badge: null, badgeClass: null };
      }
      if (status === 'paid' || status === 'partially_paid') {
        const obls = Array.isArray(linkedObligations) ? linkedObligations : [];
        if (obls.length === 0) {
          return { stepIndex: 4, screen: 5, badge: 'Statutory not recorded', badgeClass: 'b-gray' };
        }

        const allRemitted = obls.every(o => (o.status || '').toLowerCase() === 'remitted');
        if (allRemitted) {
          return { stepIndex: 5, screen: 6, badge: 'Reconciled', badgeClass: 'b-green' };
        }

        const someRemitted = obls.some(o => (o.status || '').toLowerCase() === 'remitted');
        if (someRemitted) {
          return { stepIndex: 5, screen: 6, badge: 'Partially Reconciled', badgeClass: 'b-amber' };
        }

        // One or more accrued / estimated, none remitted
        return { stepIndex: 5, screen: 6, badge: 'Recorded — Unpaid', badgeClass: 'b-blue' };
      }

      // Safe fallback for malformed or unknown status
      return { stepIndex: 1, screen: 2, badge: null, badgeClass: null };
    },

    async getLinkedObligationsForRun(run) {
      if (!run) return [];
      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.listStatutoryObligations === 'function') {
          const period = run.period_label || this.month;
          const list = await FinanceApi.listStatutoryObligations({ period });
          const runId = run.id;
          const runTag = `payroll_run_id:${runId}`;
          return (list || []).filter(o =>
            (runId !== undefined && runId !== null && (o.source_id === runId || String(o.source_id) === String(runId))) ||
            (o.notes && o.notes.includes(runTag)) ||
            (period && o.period === period)
          );
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load linked statutory obligations for run:', err);
      }
      return [];
    },

    renderStatutoryBadge(badgeText, badgeClass) {
      const p5Badge = document.getElementById('p5StatutoryBadge');
      const p6Badge = document.getElementById('p6StatutoryBadge');
      [p5Badge, p6Badge].forEach(el => {
        if (!el) return;
        if (badgeText) {
          el.textContent = badgeText;
          el.className = `p-badge ${badgeClass || 'b-gray'}`;
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      });
    },

    async openHistoryRun(idOrPeriod) {
      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getPayrollRun === 'function') {
          const run = await FinanceApi.getPayrollRun(idOrPeriod);
          if (run) {
            this.currentRun = run;
            this.month = run.period_label || this.month;
            this.start = run.period_start || this.start;
            this.end = run.period_end || this.end;
            this.payDate = run.payment_date || this.payDate;
            this.resolvedFxRate = run.fx_rate_value || 50.0;
            this.resolvedFxSource = run.fx_rate_source || 'first_of_month';
            if (run.external_funding_account_id) this.selectedExternalAccountId = run.external_funding_account_id;
            if (run.internal_funding_account_id) this.selectedInternalAccountId = run.internal_funding_account_id;
            this.showPage('run');

            const linkedObligations = await this.getLinkedObligationsForRun(run);
            this.linkedObligations = linkedObligations;
            const resolved = this.resolvePayrollRunState(run, linkedObligations);
            this.renderStatutoryBadge(resolved.badge, resolved.badgeClass);
            await this.setStep(resolved.stepIndex);
            this.drawStatus();
            return;
          }
        }
      } catch (e) {
        console.error('[PayrollApp] Could not load specific run:', e);
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!isMockMode) {
          this.showBanner(e.message || `Failed to load payroll run #${idOrPeriod}`, 'red');
          return;
        }
      }
      this.showBanner(`Viewing historical snapshot for ${idOrPeriod}`, 'blue');
      this.showPage('run');
      await this.setStep(4);
    },

    /* ---------------- Stepper & Screen Navigation ---------------- */
    // A finalized or paid run is read-only on every step.
    isRunLocked() {
      const st = this.currentRun && this.currentRun.status;
      return ['finalized', 'processing', 'partially_paid', 'paid'].includes(st);
    },

    // Highest step index already completed according to the saved run status.
    completedThroughIndex() {
      const st = this.currentRun && this.currentRun.status;
      const map = { approved: 1, finalized: 2, processing: 3, partially_paid: 4, paid: 4 };
      return map[st] !== undefined ? map[st] : -1;
    },

    applyLockState() {
      const root = document.getElementById('a-finance-payroll');
      const locked = this.isRunLocked();
      if (root) root.classList.toggle('payroll-locked', locked);
      ['btnP2SaveDraft', 'btnP2Approve'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = locked;
      });
      // Step 1 of a finalized run is read-only: disable the period, account and FX fields and hide their actions.
      ['p1Month', 'p1PayDate', 'p1Start', 'p1End', 'p1FxRateInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = locked;
      });
      ['btnP1ApplyFx', 'btnP1ResetFx', 'btnToggleFxOverride'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = locked;
      });
    },

    drawStepper() {
      const container = document.getElementById('payrollStepper');
      if (!container) return;
      const doneThrough = this.completedThroughIndex();

      const stepNames = FLOW.map((k, i) => `${i + 1}. ${STEP_META[k] ? STEP_META[k].label : 'Step'}`);
      const compact = `
        <div class="payroll-step-compact">
          <strong>Step ${this.stepIndex + 1} of ${FLOW.length}</strong>
          <select id="payrollStepSelect" aria-label="Go to step" onchange="PayrollApp.setStep(Number(this.value))">
            ${stepNames.map((n, i) => `<option value="${i}" ${i === this.stepIndex ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          </select>
        </div>`;
      container.innerHTML = compact + FLOW.map((stepKey, idx) => {
        const meta = STEP_META[stepKey] || { label: 'Step' };
        const isActive = idx === this.stepIndex;
        const isDone = idx < this.stepIndex || idx <= doneThrough;
        const cls = isActive ? 'active' : (isDone ? 'done' : '');
        return `
          <button type="button" class="payroll-step-pill step ${cls}" onclick="PayrollApp.setStep(${idx})">
            <span class="payroll-step-num stepn">${idx + 1}</span>
            <span>${meta.label}</span>
          </button>
        `;
      }).join('');
    },

    async setStep(idx) {
      if (idx < 0) idx = 0;
      if (idx > 5) idx = 5;
      if (window.Router) Router.setParams([(this.currentRun && this.currentRun.id) || 'current', idx + 1], ['a-finance-payroll-runs', 'a-finance-payroll']);

      // Lifecycle Gate: Finalize when entering Screen 3 (Processing)
      if (idx === 2 && this.currentRun && this.currentRun.status === 'approved') {
        try {
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.finalizePayrollRun === 'function') {
            await FinanceApi.finalizePayrollRun(this.currentRun.id);
            this.currentRun = await FinanceApi.getPayrollRun(this.currentRun.id);
          }
        } catch (err) {
          this.showBanner(err.message || 'Finalization failed. Statutory snapshot could not be generated.', 'red');
          return;
        }
      }

      this.stepIndex = idx;

      // Toggle Screen Views
      for (let s = 1; s <= 6; s++) {
        const screenEl = document.getElementById(`payrollScreen${s}`);
        if (screenEl) {
          if (s === idx + 1) {
            screenEl.classList.remove('payroll-hidden');
          } else {
            screenEl.classList.add('payroll-hidden');
          }
        }
      }

      // Draw active screen content
      if (idx === 0) this.drawScreen1();
      else if (idx === 1) this.drawScreen2();
      else if (idx === 2) this.drawScreen3();
      else if (idx === 3) this.drawScreen4();
      else if (idx === 4) this.drawScreen5();
      else if (idx === 5) this.drawScreen6();

      this.drawStepper();
      this.drawPeriodLabel();
      this.drawStatus();
      this.applyLockState();

      const stepKey = FLOW[idx];
      const hint = STEP_META[stepKey] ? STEP_META[stepKey].hint : '';
      const hintEl = document.getElementById('payrollStepHint');
      if (hintEl) hintEl.textContent = hint;

      // Lock banner
      const lockNote = document.getElementById('payrollLockNote');
      const lockText = document.getElementById('payrollLockText');
      if (lockNote && lockText) {
        // The blue "Finalized snapshot" strip and the status pill already say this (mock): keep the note hidden
        lockText.textContent = 'This run is finalized. Compensation and additions are read-only.';
        lockNote.classList.add('payroll-hidden');
      }
    },

    goBack() {
      if (this.stepIndex > 0) {
        this.setStep(this.stepIndex - 1);
      }
    },

    goNext() {
      if (this.stepIndex < 5) {
        this.setStep(this.stepIndex + 1);
      }
    },

    /* ==================== SCREEN 1: INITIATION ==================== */
    drawScreen1() {
      const mInput = document.getElementById('p1Month');
      if (mInput) mInput.value = this.month;
      const pdInput = document.getElementById('p1PayDate');
      if (pdInput) pdInput.value = this.payDate;
      const sInput = document.getElementById('p1Start');
      if (sInput) sInput.value = this.start;
      const eInput = document.getElementById('p1End');
      if (eInput) eInput.value = this.end;

      const extSelect = document.getElementById('p1ExtAccount');
      const intSelect = document.getElementById('p1IntAccount');
      if (extSelect) {
        extSelect.innerHTML = this.fundingOptionHtml(this.selectedExternalAccountId, this.fundingSummary.external);
        extSelect.disabled = true;
      }
      if (intSelect) {
        intSelect.innerHTML = this.fundingOptionHtml(this.selectedInternalAccountId, this.fundingSummary.internal);
        intSelect.disabled = true;
      }
      const fundingNotice = document.getElementById('p1FundingNotice');
      if (fundingNotice) {
        const unset = !this.selectedExternalAccountId || !this.selectedInternalAccountId;
        fundingNotice.hidden = !unset;
        fundingNotice.textContent = unset ? 'Funding accounts are not set. You can prepare this run. Payment is blocked until they are set in Payroll settings.' : '';
      }

      this.drawFxRate();

      const p = this.currentPreview;
      const t = this.rollup();
      const hcEl = document.getElementById('p1Headcount');
      const extEl = document.getElementById('p1ExtEst');
      const intEl = document.getElementById('p1IntEst');
      const netEl = document.getElementById('p1NetEst');

      if (hcEl) hcEl.textContent = (p && p.headcount) || this.rows.length;
      if (extEl) extEl.textContent = this.money((p && p.final_ext_total) || t.external);
      if (intEl) intEl.textContent = this.money((p && p.final_int_total) || t.internal);
      if (netEl) netEl.textContent = this.money((p && p.total_net) || t.net);

      const hcSub = document.getElementById('p1HeadcountSub');
      if (hcSub) {
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const m = /^(\d{4})-(\d{2})/.exec(String(this.month || ''));
        hcSub.textContent = `active in ${m ? MONTHS[+m[2] - 1] : this.month}`;
      }

      const warnEl = document.getElementById('p1MissingBankWarn');
      const warnCountEl = document.getElementById('p1MissingBankCount');
      if (warnEl) {
        const missing = this.missingBankCount();
        if (missing > 0) {
          warnEl.hidden = false;
          warnEl.style.display = 'flex';
          if (warnCountEl) {
            warnCountEl.textContent = `${missing} employee${missing > 1 ? 's have' : ' has'}`;
          }
        } else {
          warnEl.hidden = true;
          warnEl.style.display = 'none';
        }
      }
    },

    onScreen1PeriodChange() {
      const m = document.getElementById('p1Month');
      if (m && m.value && m.value !== this.month) {
        // month changed on screen 1: move start, end and pay date with it
        this.setPeriod(m.value);
        ['p1PayDate', 'p1Start', 'p1End'].forEach((id, i) => {
          const el = document.getElementById(id);
          if (el) el.value = [this.payDate, this.start, this.end][i];
        });
        this.drawPeriodLabel();
        return;
      }
      const pd = document.getElementById('p1PayDate');
      if (pd && pd.value) this.payDate = pd.value;
      const s = document.getElementById('p1Start');
      if (s && s.value) this.start = s.value;
      const e = document.getElementById('p1End');
      if (e && e.value) this.end = e.value;
      this.drawPeriodLabel();
    },

    async applyScreen1Fx() {
      const input = document.getElementById('p1FxRateInput') || document.getElementById('payrollFxRateInput');
      const val = input ? parseFloat(input.value) : null;
      if (val && val > 0) {
        this.fxRateValue = val;
        this.addAudit(`Applied manual FX rate: ${val.toFixed(4)} USD/EGP.`);
      } else {
        this.fxRateValue = null;
        this.addAudit('Reset FX rate to resolver.');
      }
      await this.fetchPreview();
      this.drawScreen1();
      this.drawFxRate();
      if (this.fxResolved) this.showBanner(`FX conversion rate updated: ${this.resolvedFxRate.toFixed(4)} USD/EGP.`, 'blue');
    },

    async resetScreen1Fx() {
      this.fxRateValue = null;
      await this.fetchPreview();
      this.drawScreen1();
      this.drawFxRate();
      this.showBanner('FX rate reset to default resolver.', 'blue');
    },

    async proceedFromScreen1() {
      this.onScreen1PeriodChange();
      await this.fetchPreview();
      this.setStep(1);
    },

    getInitials(name) {
      if (!name) return '??';
      const parts = name.trim().split(/\s+/);
      if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    /* ==================== SCREEN 2: APPROVE & ADJUSTMENTS ==================== */
    // Blocking readiness issues from the preview/run (missing compensation plan, insured base, tax settings...)
    blockingIssues() {
      const src = (this.currentRun && this.currentRun.status && this.currentRun.exceptions) || (this.currentPreview && this.currentPreview.exceptions) || [];
      return src.filter(e => e.severity === 'blocking' && !e.is_resolved);
    },

    // A saved draft keeps the issue list it was created with. True when today's data passes the live
    // check but the saved run still carries old blocking issues.
    savedRunIsStale() {
      const run = this.currentRun;
      if (!run || !run.id || run.status !== 'draft') return false;
      const live = (this.currentPreview && this.currentPreview.exceptions) || [];
      const liveBlocking = live.filter(e => e.severity === 'blocking' && !e.is_resolved).length;
      return liveBlocking === 0 && this.blockingIssues().length > 0;
    },

    drawReadiness() {
      const panel = document.getElementById('p2ReadinessPanel');
      if (!panel) return;
      const issues = this.blockingIssues();
      const stale = this.savedRunIsStale();
      if (!issues.length) { panel.hidden = true; panel.innerHTML = ''; return; }
      const fixLabel = (code) => ({
        MISSING_COMP_PLAN: 'Set compensation plan',
        MISSING_INSURED_BASE: 'Open social insurance',
        INSURED_BASE_EXCEEDS_SALARY: 'Open social insurance',
        MISSING_TAX_SETTINGS: 'Open payroll settings',
      }[code] || 'Open employee');
      panel.innerHTML = `
        <div class="payroll-readiness-head">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <strong>${issues.length} blocking issue${issues.length === 1 ? '' : 's'} must be fixed before this run can be submitted</strong>
          <button type="button" class="btn btn-sm btn-outline" data-action="payroll-recheck"><i class="fa-solid fa-rotate"></i> Re-check</button>
        </div>
        ${stale ? `<p class="payroll-readiness-note"><i class="fa-solid fa-circle-info"></i> Your data now passes the live check, but saved run #${escapeHtml(this.currentRun.id)} still carries the issues found when it was created. Press Re-check to refresh it from your current data.</p>` : ''}
        <ul class="payroll-readiness-list">
          ${issues.map(e => `<li>
            <span><strong>${escapeHtml(e.employee_name || (e.employee_id ? 'Employee #' + e.employee_id : 'Payroll settings'))}</strong>
              — ${escapeHtml(e.title || e.code)}. ${escapeHtml(e.description || e.details || e.message || '')}</span>
            <button type="button" class="btn btn-sm btn-fill" data-action="payroll-fix-issue" data-code="${escapeHtml(e.code || '')}" data-employee-id="${escapeHtml(e.employee_id || '')}">${fixLabel(e.code)}</button>
          </li>`).join('')}
        </ul>`;
      panel.hidden = false;
    },

    // Opens the screen where an issue can be fixed.
    fixIssue(code, employeeId) {
      if (code === 'MISSING_COMP_PLAN' && employeeId && typeof openCompPlanModal === 'function') {
        openCompPlanModal(employeeId);
      } else if ((code === 'MISSING_INSURED_BASE' || code === 'INSURED_BASE_EXCEEDS_SALARY') && employeeId && typeof viewProfile === 'function') {
        viewProfile(employeeId, 'social');
      } else if (code === 'MISSING_TAX_SETTINGS') {
        this.showPage('settings');
      } else if (employeeId && typeof viewProfile === 'function') {
        viewProfile(employeeId);
      }
    },

    // Reload the preview after the data was corrected elsewhere.
    async recheckReadiness() {
      const run = this.currentRun;
      if (run && run.id && run.status === 'draft' && typeof FinanceApi !== 'undefined' && typeof FinanceApi.refreshPayrollRun === 'function') {
        try {
          await FinanceApi.refreshPayrollRun(run.id);
          this.currentRun = await FinanceApi.getPayrollRun(run.id);
        } catch (e) {
          this.showBanner(`Could not re-check run #${run.id}: ${e.message || e}`, 'red');
          return;
        }
      }
      await this.fetchPreview();
      this.drawScreen2();
      if (this.savedRunIsStale()) {
        this.showBanner(`The data now passes the live check, but saved run #${this.currentRun.id} still holds the old issues.`, 'red');
      } else {
        this.showBanner(this.blockingIssues().length ? 'Some blocking issues remain.' : 'No blocking issues. You can submit this run.', this.blockingIssues().length ? 'red' : 'green');
      }
    },

    drawScreen2() {
      this.drawReadiness();
      this.drawStats();
      this.drawTable();
      const p2ApproveBtn = document.getElementById('btnP2Approve');
      if (p2ApproveBtn) {
        const status = (this.currentRun && this.currentRun.status) || 'draft';
        const awaitingApproval = status === 'submitted';
        const pastApproval = ['approved', 'finalized', 'processing', 'partially_paid', 'paid'].includes(status);
        const allowed = awaitingApproval ? this.canPermission('finance.payroll.approve') : this.canPermission('finance.payroll.prepare');
        p2ApproveBtn.innerHTML = awaitingApproval
          ? 'Approve <i class="fa-solid fa-check"></i>'
          : 'Submit for approval';
        p2ApproveBtn.style.display = allowed && !pastApproval ? '' : 'none';
        const blockers = awaitingApproval ? 0 : this.blockingIssues().length;
        p2ApproveBtn.disabled = blockers > 0;
        const selfRow = document.getElementById('p2SelfApproveRow');
        if (selfRow) {
          selfRow.hidden = !(awaitingApproval && this.canSelfApprove());
          if (selfRow.hidden) { const box = document.getElementById('p2SelfApprove'); if (box) box.checked = false; }
        }
        const hint = document.getElementById('p2ApprovalHint');
        if (hint) {
          hint.textContent = pastApproval
            ? 'This run has been approved. Nothing more to approve here.'
            : awaitingApproval
            ? (allowed ? 'Step 2 of 2: approve this run. Approval by someone other than the submitter is expected.' : 'Submitted. Waiting for an approver.')
            : (blockers > 0 ? `Fix the ${blockers} blocking issue${blockers === 1 ? '' : 's'} above to submit. You can still save a draft.`
              : (allowed ? 'Step 1 of 2: submit this run for approval.' : 'You can review this run but not submit it.'));
        }
      }
    },

    drawStats() {
      const grid = document.getElementById('payrollStatsGrid');
      if (!grid) return;
      const t = this.rollup();
      const p = this.currentPreview;

      // Totals are summed from the same row values the table shows, never from a separate preview figure.
      const totalBase = t.baseExt + t.baseInt;
      const totalAdditions = t.bonus;
      const totalGross = totalBase + totalAdditions;

      grid.innerHTML = `
        <div class="stat payroll-card stat-card">
          <div class="lbl label">Headcount</div>
          <div class="val value">${this.rows.length}</div>
          <div class="hint sub">Active recipients</div>
        </div>
        <div class="stat payroll-card stat-card">
          <div class="lbl label">Base Compensation</div>
          <div class="val value">${this.money(totalBase)}</div>
          <div class="hint sub">Fixed salary pool</div>
        </div>
        <div class="stat payroll-card stat-card">
          <div class="lbl label">Bonus / Commission</div>
          <div class="val value">${this.money(totalAdditions)}</div>
          <div class="hint sub">Dynamic additions</div>
        </div>
        <div class="stat payroll-card stat-card">
          <div class="lbl label">Total Compensation (gross)</div>
          <div class="val value accent val-accent" style="color:var(--accent-text);">${this.money(totalGross)}</div>
          <div class="hint sub">Before deductions</div>
        </div>
      `;
    },

    drawTable() {
      const tbody = document.getElementById('payrollTableBody');
      if (!tbody) return;

      const searchInput = document.getElementById('payrollSearchInput');
      const bonusFilter = document.getElementById('payrollBonusFilter');
      const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const bFilter = bonusFilter ? bonusFilter.value : 'all';

      let filtered = [...this.rows];
      if (q) {
        filtered = filtered.filter(r => r.name.toLowerCase().includes(q) || String(r.id).includes(q));
      }
      if (bFilter !== 'all') {
        if (bFilter === 'none') {
          filtered = filtered.filter(r => !r.bonuses || r.bonuses.length === 0);
        } else {
          filtered = filtered.filter(r => (r.bonuses || []).some(b => b.type === bFilter));
        }
      }

      let rowsHtml = '';
      let totExt = 0, totInt = 0, totBonus = 0, totTotal = 0;

      filtered.forEach(r => {
        const c = this.computeRow(r);
        totExt += r.baseExt;
        totInt += r.baseInt;
        totBonus += c.bonusTotal;
        totTotal += (r.baseExt + r.baseInt + c.bonusTotal);

        const inits = this.getInitials(r.name);
        // Bonus amounts (left aligned, one line each) and their reasons (coloured tags on the same lines)
        const reasonTone = (type) => /sales/i.test(type || '') ? 'sales' : /support/i.test(type || '') ? 'support' : 'bonus';
        const bonusAmounts = (r.bonuses || []).map((b, bIdx) => {
          const src = String(b.source || 'int').toLowerCase().startsWith('ext') ? 'ext' : 'int';
          const srcLabel = src === 'ext' ? 'External (USD transfer)' : 'Internal (EGP cash)';
          return `<div class="pv-bonus-line">
            <span class="pv-src-dot pv-src-dot--${src}" title="${srcLabel}" aria-label="${srcLabel}"></span>
            <span class="pv-bonus-amount">$${Number(b.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <button type="button" class="pv-bonus-x" title="Remove this bonus" aria-label="Remove ${escapeHtml(b.type || 'bonus')}" onclick="PayrollApp.deleteBonus(${r.id}, ${bIdx}, ${b.id ? `'${b.id}'` : 'null'})">&times;</button>
          </div>`;
        }).join('');
        const bonusReasons = (r.bonuses || []).map((b) => `<div class="pv-bonus-line"><span class="pv-reason-tag pv-reason-tag--${reasonTone(b.type)}">${escapeHtml(b.type || 'Bonus')}</span></div>`).join('');

        rowsHtml += `
          <tr>
            <td class="payroll-emp-cell" data-label="Employee" style="padding:8px 16px; text-align:left;">
              <span class="col-id sr-only">${r.id}</span>
              <div class="tname" style="display:flex; align-items:center; gap:10px;">
                <span class="avatar">${inits}</span>
                <span>
                  <a class="payroll-emp-link" href="${Router.hrefFor('a-employee-detail', 'admin').replace(/\/?$/, '')}/${encodeURIComponent(r.id)}" data-action="open-employee-profile" data-employee-id="${escapeHtml(r.id)}" style="display:block; font-weight:600; color:var(--ink-strong); text-decoration:none;">${escapeHtml(r.name)}</a>
                  <span class="pv-emp-sub" style="font-size:12px; color:var(--ink-muted);">${escapeHtml(r.role || r.dept || 'Employee')}</span>
                </span>
              </div>
            </td>
            <td class="num payroll-num" data-label="External base, USD" style="padding:8px 12px; text-align:right; font-variant-numeric:tabular-nums;">${this.money(r.baseExt)}</td>
            <td class="num payroll-num" data-label="Internal base, USD" style="padding:8px 12px; text-align:right; font-variant-numeric:tabular-nums;">${this.money(r.baseInt)}</td>
            <td class="payroll-bonus-col" data-label="Bonus or commission" style="padding:8px 12px; text-align:left;">
              ${bonusAmounts || '<span class="muted" style="color:var(--ink-muted); font-size:13px;">None</span>'}
            </td>
            <td class="payroll-reason-col" data-label="Reason" style="padding:8px 12px; text-align:left;">${bonusReasons}</td>
            <td class="num payroll-num strong" data-label="Total pay, gross" style="padding:8px 16px; text-align:right; font-weight:700; color:var(--ink-strong); font-variant-numeric:tabular-nums;">${this.money(r.baseExt + r.baseInt + c.bonusTotal)}</td>
            <td class="col-actions" style="width:40px; text-align:center; padding:8px 8px;">
              <button type="button" class="plus" id="btnPlus_${r.id}" onclick="PayrollApp.toggleInlineBonus(${r.id}, this)" title="Add bonus / commission">+</button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = rowsHtml;

      const fExt = document.getElementById('fBaseExt');
      const fInt = document.getElementById('fBaseInt');
      const fBon = document.getElementById('fBonus');
      const fNet = document.getElementById('fNet');
      const fLbl = document.getElementById('fTotalsLabel');
      if (fLbl) fLbl.textContent = `Totals \u00b7 ${filtered.length} ${filtered.length === 1 ? 'employee' : 'employees'}`;
      if (fExt) fExt.textContent = this.money(totExt);
      if (fInt) fInt.textContent = this.money(totInt);
      if (fBon) fBon.textContent = this.money(totBonus);
      if (fNet) fNet.textContent = this.money(totTotal);
    },

    toggleInlineBonus(empId, btn) {
      const tr = (btn && btn.closest('tr')) || document.getElementById(`row_emp_${empId}`);
      if (!tr) return;
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('expand')) {
        next.remove();
        return;
      }
      // Close other open expand rows
      const tbody = tr.closest('tbody');
      if (tbody) {
        tbody.querySelectorAll('tr.expand').forEach(r => r.remove());
      }

      const row = this.rows.find(r => r.id === empId);
      const bonuses = (row && row.bonuses) || [];
      const existingHtml = bonuses.length > 0
        ? `<div class="existing"><b>Existing additions</b>${bonuses.map((b, idx) => `
            <span class="tag">${b.type || 'Bonus'} · ${this.money(b.amount)} · ${b.source === 'external' ? 'EXT' : 'INT'}
              <i class="fa-solid fa-xmark" style="cursor:pointer; margin-left:4px; opacity:0.7;" onclick="PayrollApp.deleteBonus(${empId}, ${idx}, ${b.id || 'null'})" title="Remove"></i>
            </span>`).join('')}</div>`
        : `<div class="existing"><b>Add a variable component for this employee</b></div>`;

      const expandTr = document.createElement('tr');
      expandTr.className = 'expand';
      expandTr.id = `expandRow_${empId}`;
      expandTr.innerHTML = `
        <td colspan="7">
          <div class="expandbox">
            ${existingHtml}
            <div class="inlineform">
              <div class="field">
                <label>Type</label>
                <select id="inlineBonusType_${empId}">
                  <option value="BONUS">Bonus</option>
                  <option value="COMMISSION">Sales Commission</option>
                  <option value="SUPPORT_COMMISSION">Support Commission</option>
                </select>
              </div>
              <div class="field">
                <label>Amount (USD)</label>
                <input type="number" step="0.01" min="0" placeholder="0.00" id="inlineBonusAmount_${empId}">
              </div>
              <div class="field">
                <label>Payment source</label>
                <span class="toggle" id="inlineBonusSourceToggle_${empId}">
                  <button type="button" class="selected" data-source="INT" onclick="PayrollApp.toggleInlineSource(this)">Internal</button>
                  <button type="button" data-source="EXT" onclick="PayrollApp.toggleInlineSource(this)">External</button>
                </span>
              </div>
              <button type="button" class="btn btn-fill sm" id="btnSubmitInlineBonus_${empId}" onclick="PayrollApp.submitInlineBonus(${empId})">Submit</button>
              <button type="button" class="btn sm" onclick="PayrollApp.closeInlineBonus(this)">Close</button>
            </div>
          </div>
        </td>
      `;
      tr.after(expandTr);
    },

    toggleInlineSource(btn) {
      const toggle = btn.parentElement;
      if (!toggle) return;
      toggle.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    },

    closeInlineBonus(el) {
      const expandTr = (el && el.closest) ? el.closest('tr.expand') : document.querySelector('tr.expand');
      if (expandTr) expandTr.remove();
    },

    async submitInlineBonus(empId) {
      const typeSel = document.getElementById(`inlineBonusType_${empId}`);
      const amtInput = document.getElementById(`inlineBonusAmount_${empId}`);
      const toggle = document.getElementById(`inlineBonusSourceToggle_${empId}`);
      if (!amtInput) return;

      const amt = parseFloat(amtInput.value);
      if (!amt || amt <= 0) {
        FinanceForm.setFieldError(amtInput, 'Enter a bonus amount greater than zero.');
        return;
      }
      const bTypeVal = typeSel ? typeSel.value : 'BONUS';
      const selectedSourceBtn = toggle ? toggle.querySelector('button.selected') : null;
      const bSource = (selectedSourceBtn && selectedSourceBtn.getAttribute('data-source')) || 'INT';

      const typeLabelMap = {
        'BONUS': 'Bonus',
        'COMMISSION': 'Sales Commission',
        'SUPPORT_COMMISSION': 'Support Commission'
      };
      const bTypeLabel = typeLabelMap[bTypeVal] || 'Bonus';

      // Persist to backend preview adjustment if preview is active
      let createdAdjId = null;
      if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.addPreviewAdjustment === 'function' && this.currentPreview && this.currentPreview.preview_id) {
        try {
          const adj = await FinanceApi.addPreviewAdjustment(this.currentPreview.preview_id, {
            employee_id: empId,
            type: bTypeVal,
            amount: amt,
            payment_source: bSource,
            description: bTypeLabel
          });
          if (adj && adj.id) createdAdjId = adj.id;
        } catch (err) {
          console.warn('[PayrollApp] Could not persist preview adjustment:', err);
        }
      }

      const row = this.rows.find(r => r.id === empId);
      if (row) {
        if (!row.bonuses) row.bonuses = [];
        row.bonuses.push({
          id: createdAdjId,
          type: bTypeLabel,
          amount: amt,
          source: bSource.toLowerCase() === 'ext' ? 'external' : 'internal',
          description: bTypeLabel
        });
      }

      this.addAudit(`Added ${bTypeLabel} of $${amt} for employee #${empId}.`);
      await this.fetchPreview();
      this.drawScreen2();
      this.showBanner('Bonus / Commission addition saved.', 'blue');
    },

    // Backward-compatibility shims
    openBonusModal(empId) {
      const targetId = empId || (this.rows && this.rows[0] && this.rows[0].id);
      if (targetId) {
        const btn = document.getElementById(`btnPlus_${targetId}`);
        this.toggleInlineBonus(targetId, btn);
      }
    },

    closeBonusModal() {
      this.closeInlineBonus();
    },

    async saveBonus() {
      const targetId = this.rows && this.rows[0] && this.rows[0].id;
      if (targetId) await this.submitInlineBonus(targetId);
    },

    async deleteBonus(empId, bonusIdx, adjId) {
      if (this.isRunLocked()) return; // a finalized or paid run is read-only
      if (adjId && typeof FinanceApi !== 'undefined' && typeof FinanceApi.deletePreviewAdjustment === 'function' && this.currentPreview && this.currentPreview.preview_id) {
        try {
          await FinanceApi.deletePreviewAdjustment(this.currentPreview.preview_id, adjId);
        } catch (err) {
          console.warn('[PayrollApp] Error deleting preview adjustment:', err);
        }
      }
      const row = this.rows.find(r => r.id === empId);
      if (row && row.bonuses && row.bonuses[bonusIdx]) {
        row.bonuses.splice(bonusIdx, 1);
        this.addAudit(`Deleted bonus item for employee #${empId}.`);
      }
      await this.fetchPreview();
      this.drawScreen2();
    },

    async saveDraftRun() {
      try {
        if (!this.requireFxRate()) return;
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.createPayrollRun === 'function') {
          const run = await FinanceApi.createPayrollRun({
            period_label: this.month,
            period_start: this.start,
            period_end: this.end,
            payment_date: this.payDate,
            fx_rate_source: this.fxRateValue ? 'manual' : (this.fxRateSource || 'first_of_month'),
            fx_rate_value: this.fxRateValue ? Number(this.fxRateValue) : this.resolvedFxRate,
            submit_for_approval: false
          });
          this.currentRun = run;
        }
        this.addAudit('Payroll run persisted as Draft.');
        this.showBanner('Payroll run saved as Draft.', 'blue');
        this.drawStatus();
      } catch (err) {
        console.error('Error saving draft:', err);
        this.showBanner(err.message || 'Failed to save draft.', 'red');
      }
    },

    canPermission(key) {
      return typeof SessionInfo !== 'undefined' && typeof SessionInfo.hasPermission === 'function' ? SessionInfo.hasPermission(key) : true;
    },

    // Self-approval is offered only to a user who may both prepare and approve.
    canSelfApprove() {
      return this.canPermission('finance.payroll.prepare') && this.canPermission('finance.payroll.approve');
    },

    // The single button on screen 2 moves through two visible steps: submit, then approve.
    submitAndApproveRun() {
      const status = this.currentRun && this.currentRun.status;
      return status === 'submitted' ? this.approveRun() : this.submitRun();
    },

    // Step 1 of 2: create the run when needed and submit it for approval. Nothing is approved here.
    async submitRun() {
      try {
        if (!this.currentRun) {
          if (!this.requireFxRate()) return;
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.createPayrollRun === 'function') {
            this.currentRun = await FinanceApi.createPayrollRun({
              period_label: this.month,
              period_start: this.start,
              period_end: this.end,
              payment_date: this.payDate,
              fx_rate_source: this.fxRateValue ? 'manual' : (this.fxRateSource || 'first_of_month'),
              fx_rate_value: this.fxRateValue ? Number(this.fxRateValue) : this.resolvedFxRate,
              submit_for_approval: true
            });
          }
        }

        if (this.currentRun && this.currentRun.status === 'draft') {
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.submitPayrollRun === 'function') {
            await FinanceApi.submitPayrollRun(this.currentRun.id);
            this.currentRun.status = 'submitted';
          }
        }

        this.addAudit('Payroll run submitted for approval.');
        this.showBanner('Payroll run submitted for approval.', 'blue');
        this.drawScreen2();
        this.drawStatus();
      } catch (err) {
        console.error('Error submitting run:', err);
        this.showBanner(err.message || 'Submission failed.', 'red');
      }
    },

    // Step 2 of 2: approve. Self-approval is sent only when the user explicitly ticks the box.
    async approveRun() {
      try {
        const box = document.getElementById('p2SelfApprove');
        const allowSelf = !!(box && box.checked && this.canSelfApprove());
        if (this.currentRun && this.currentRun.status === 'submitted'
            && typeof FinanceApi !== 'undefined' && typeof FinanceApi.approvePayrollRun === 'function') {
          await FinanceApi.approvePayrollRun(this.currentRun.id, allowSelf);
          this.currentRun.status = 'approved';
        }
        this.addAudit(allowSelf ? 'Payroll run approved (self-approval confirmed).' : 'Payroll run approved.');
        this.showBanner('Payroll run approved. Advancing to statutory processing.', 'blue');
        this.setStep(2);
      } catch (err) {
        console.error('Error approving run:', err);
        this.showBanner(err.message || 'Approval failed.', 'red');
      }
    },

    // Downloads the run CSV (one row per employee). Real mode uses the authenticated export endpoint.
    async exportRunCsv() {
      try {
        const isMock = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!isMock) {
          if (!this.currentRun || !this.currentRun.id) {
            this.showBanner('Save and submit the run before exporting it.', 'red');
            return;
          }
          await FinanceApi.exportPayrollRun(this.currentRun.id);
          return;
        }
        const pay = this.paymentValues();
        const q = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
        const lines = [['Employee ID', 'Name', 'External (USD)', 'Internal (USD)', 'Total Disbursement'].map(q).join(',')];
        this.rows.forEach(r => {
          const v = pay.get(Number(r.id)) || { ext: 0, int: 0, net: 0 };
          lines.push([r.id, r.name, v.ext.toFixed(2), v.int.toFixed(2), v.net.toFixed(2)].map(q).join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll_run_${(this.currentRun && this.currentRun.id) || this.month}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        this.showBanner(err.message || 'Export failed.', 'red');
      }
    },

    /* ==================== SCREEN 3: STATUTORY SNAPSHOTS ==================== */
    drawScreen3() {
      const tbody = document.getElementById('payrollProcessingTableBody');
      if (!tbody) return;

      const lines = (this.currentRun && this.currentRun.lines) || (this.currentPreview && this.currentPreview.lines) || [];
      const rate = this.resolvedFxRate || 50.0;

      let rowsHtml = '';
      let totInsuredBase = 0, totEmpSi = 0, totEmprSi = 0, totSi = 0, totTax = 0, totNetEgp = 0, totNetUsd = 0;

      if (lines.length > 0) {
        // Group and deduplicate lines by employee_id (employees may have multiple split payment lines)
        const empMap = new Map();
        lines.forEach(l => {
          const eid = l.employee_id;
          if (!empMap.has(eid)) {
            empMap.set(eid, { ...l });
          } else {
            const existing = empMap.get(eid);
            existing.net_pay = Number(existing.net_pay || 0) + Number(l.net_pay || l.amount || 0);
            existing.amount = existing.net_pay;
            if (l.final_internal_net_egp && !existing.final_internal_net_egp) {
              existing.final_internal_net_egp = l.final_internal_net_egp;
            }
            if (l.employee_social_insurance_egp && !existing.employee_social_insurance_egp) {
              existing.employee_social_insurance_egp = l.employee_social_insurance_egp;
            }
            if (l.employer_social_insurance_egp && !existing.employer_social_insurance_egp) {
              existing.employer_social_insurance_egp = l.employer_social_insurance_egp;
            }
            if (l.total_social_insurance_egp && !existing.total_social_insurance_egp) {
              existing.total_social_insurance_egp = l.total_social_insurance_egp;
            }
            if (l.employee_tax_egp && !existing.employee_tax_egp) {
              existing.employee_tax_egp = l.employee_tax_egp;
            }
            if (l.tax_method_snapshot && !existing.tax_method_snapshot) {
              existing.tax_method_snapshot = l.tax_method_snapshot;
              existing.tax_rate_snapshot = l.tax_rate_snapshot;
            }
            if (l.insured_base_egp_snapshot && !existing.insured_base_egp_snapshot) {
              existing.insured_base_egp_snapshot = l.insured_base_egp_snapshot;
            }
            if (l.configured_internal_salary_usd_snapshot !== undefined && existing.configured_internal_salary_usd_snapshot === undefined) {
              existing.configured_internal_salary_usd_snapshot = l.configured_internal_salary_usd_snapshot;
            }
            if (l.salary_basis_snapshot && !existing.salary_basis_snapshot) {
              existing.salary_basis_snapshot = l.salary_basis_snapshot;
            }
          }
        });
        const employeeEntries = Array.from(empMap.values());

        employeeEntries.forEach(l => {
          const insBase = Number(l.insured_base_egp_snapshot || 0);
          const empSi = Number(l.employee_social_insurance_egp || 0);
          const emprSi = Number(l.employer_social_insurance_egp || 0);
          const tSi = Number(l.total_social_insurance_egp || (empSi + emprSi));
          const tax = Number(l.employee_tax_egp || 0);
          const flatLabel = l.tax_method_snapshot === 'flat' && l.tax_rate_snapshot
            ? ` <span class="badge-pill pill-warning payroll-flat-tax-label">Flat ${Math.round(Number(l.tax_rate_snapshot) * 10000) / 100}%</span>`
            : '';
          const netEgp = Number(l.final_internal_net_egp || 0);
          const netUsd = Number(l.net_pay || l.amount || (netEgp / rate));

          totInsuredBase += insBase;
          totEmpSi += empSi;
          totEmprSi += emprSi;
          totSi += tSi;
          totTax += tax;
          totNetEgp += netEgp;
          totNetUsd += netUsd;

          const empName = l.employee_name || `Employee #${l.employee_id}`;
          const inits = this.getInitials(empName);

          rowsHtml += `
            <tr>
              <td class="payroll-name-th" data-label="Employee" style="padding:9px 16px;">
                <span class="col-id sr-only">${l.employee_id}</span>
                <span style="display:flex; align-items:center; gap:10px;">
                  <span class="avatar">${inits}</span>
                  <span style="display:block;">
                    <strong style="color:var(--ink-strong); font-weight:600;">${escapeHtml(empName)}</strong>
                    <span class="pv-emp-sub" style="display:block; font-size:12px; color:var(--ink-muted);">${escapeHtml(l.role || l.dept || 'Employee')}</span>
                  </span>
                </span>
              </td>
              <td class="num payroll-num" data-label="Insured base, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${insBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Employee SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${empSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Employer SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${emprSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Total SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${tSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Income tax, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${flatLabel}</td>
              <td class="num payroll-num strong accent" data-label="Internal net payment" style="padding:9px 16px; text-align:right; font-weight:700; color:var(--ink-strong); font-variant-numeric:tabular-nums;">${this.money(netUsd)}</td>
            </tr>
          `;
        });
      } else {
        // Fallback calculation using current rows and active rate
        this.rows.forEach(r => {
          const cfgUsd = r.baseInt;
          const insuredEgp = Math.round(cfgUsd * rate);
          const empSi = Math.round(insuredEgp * (this.employeeInsuranceRate || 0.11) * 100) / 100;
          const emprSi = Math.round(insuredEgp * (this.employerInsuranceRate || 0.18) * 100) / 100;
          const tSi = empSi + emprSi;
          const tax = 0.00;
          const netEgp = Math.max(0, insuredEgp - empSi);
          const netUsd = Math.round((netEgp / rate) * 100) / 100;

          totInsuredBase += insuredEgp;
          totEmpSi += empSi;
          totEmprSi += emprSi;
          totSi += tSi;
          totTax += tax;
          totNetEgp += netEgp;
          totNetUsd += netUsd;

          const inits = this.getInitials(r.name);

          rowsHtml += `
            <tr>
              <td class="payroll-name-th" data-label="Employee" style="padding:9px 16px;">
                <span class="col-id sr-only">${r.id}</span>
                <span style="display:flex; align-items:center; gap:10px;">
                  <span class="avatar">${inits}</span>
                  <span style="display:block;">
                    <strong style="color:var(--ink-strong); font-weight:600;">${escapeHtml(r.name)}</strong>
                    <span class="pv-emp-sub" style="display:block; font-size:12px; color:var(--ink-muted);">${escapeHtml(r.role || r.dept || 'Employee')}</span>
                  </span>
                </span>
              </td>
              <td class="num payroll-num" data-label="Insured base, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${insuredEgp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Employee SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${empSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Employer SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${emprSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Total SI, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${tSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num" data-label="Income tax, EGP" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${tax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="num payroll-num strong accent" data-label="Internal net payment" style="padding:9px 16px; text-align:right; font-weight:700; color:var(--ink-strong); font-variant-numeric:tabular-nums;">${this.money(netUsd)}</td>
            </tr>
          `;
        });
      }

      tbody.innerHTML = rowsHtml;

      const p3Emp = document.getElementById('p3TotEmpSi');
      const p3Empr = document.getElementById('p3TotEmprSi');
      const p3Si = document.getElementById('p3TotSi');
      const p3Tax = document.getElementById('p3TotTax');
      const p3Egp = document.getElementById('p3TotNetEgp');
      const p3Usd = document.getElementById('p3TotNetUsd');
      const p3Ins = document.getElementById('p3TotInsuredBase');
      const p3Lbl = document.getElementById('p3TotalsLabel');

      const count = (lines.length > 0) ? new Set(lines.map(l => l.employee_id)).size : this.rows.length;
      if (p3Lbl) p3Lbl.textContent = `Totals \u00b7 ${count} ${count === 1 ? 'employee' : 'employees'}`;
      if (p3Ins) p3Ins.textContent = totInsuredBase.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p3Emp) p3Emp.textContent = totEmpSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p3Empr) p3Empr.textContent = totEmprSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p3Si) p3Si.textContent = totSi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p3Tax) p3Tax.textContent = totTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (p3Egp) p3Egp.textContent = totNetEgp.toFixed(2) + ' EGP';
      if (p3Usd) p3Usd.textContent = this.money(totNetUsd);
    },


    /* ==================== SCREEN 4: PAYMENT PREVIEW ==================== */
    // Per-employee external/internal payment amounts, shared by screens 4 and 5 and the journal
    // so every total on those screens is the sum of the rows displayed.
    paymentValues() {
      const runLines = (this.currentRun && this.currentRun.lines) || [];
      const previewRecipients = (this.currentPreview && this.currentPreview.recipients) || [];
      const recipMap = new Map();
      previewRecipients.forEach(rp => recipMap.set(Number(rp.employee_id), rp));
      const lineMap = new Map();
      runLines.forEach(l => {
        const eid = Number(l.employee_id);
        if (!lineMap.has(eid)) lineMap.set(eid, { ext: 0, int: 0 });
        const entry = lineMap.get(eid);
        if (l.compensation_type === 'external_usd') {
          entry.ext += Number(l.net_pay || l.amount || 0);
        } else {
          entry.int += Number(l.final_internal_payment_usd !== undefined && l.final_internal_payment_usd !== null ? l.final_internal_payment_usd : (l.net_pay || l.amount || 0));
        }
      });
      const byId = new Map();
      this.rows.forEach(r => {
        const c = this.computeRow(r);
        let ext = c.external;
        let int = c.internal;
        if (lineMap.has(Number(r.id))) {
          const lEntry = lineMap.get(Number(r.id));
          ext = lEntry.ext;
          int = Math.round(lEntry.int);
        } else if (recipMap.has(Number(r.id))) {
          const rpRow = recipMap.get(Number(r.id));
          if (rpRow.final_ext_amount !== undefined) ext = Number(rpRow.final_ext_amount);
          if (rpRow.final_int_amount !== undefined) int = Math.round(Number(rpRow.final_int_amount));
        }
        byId.set(Number(r.id), { ext, int, net: ext + int });
      });
      return byId;
    },

    paymentTotals() {
      let ext = 0, int = 0;
      this.paymentValues().forEach(v => { ext += v.ext; int += v.int; });
      return { ext, int, net: ext + int };
    },

    drawScreen4() {
      const tbody = document.getElementById('payrollPaymentPreviewTableBody');
      if (!tbody) return;

      const pay = this.paymentValues();
      const { ext: extBank, int: intCash, net: netTotal } = this.paymentTotals();

      const bExt = document.getElementById('p4ExtBankTotal');
      const bInt = document.getElementById('p4IntCashTotal');
      const bNet = document.getElementById('p4TotalNet');
      const bHc = document.getElementById('p4Headcount');
      const bMissing = document.getElementById('p4MissingBankCount');

      if (bExt) bExt.textContent = this.money(extBank);
      if (bInt) bInt.textContent = this.money(intCash);
      if (bNet) bNet.textContent = this.money(netTotal);
      if (bHc) bHc.textContent = this.rows.length;

      // Identify missing bank exceptions from real run/preview data
      const runExceptions = (this.currentRun && this.currentRun.exceptions) || (this.currentPreview && this.currentPreview.exceptions) || [];
      const missingBankEmpIds = new Set(
        runExceptions
          .filter(e => e.code === 'MISSING_BANK_DETAILS')
          .map(e => Number(e.employee_id))
      );

      let missingBankCount = 0;
      let rowsHtml = '';
      this.rows.forEach(r => {
        const { ext: extVal, int: intVal, net: netVal } = pay.get(Number(r.id));

        const hasExternal = extVal > 0 || r.baseExt > 0;
        const isMissingBank = hasExternal && (
          missingBankEmpIds.has(Number(r.id)) ||
          r.has_missing_bank ||
          (!r.bank_name && !r.bank_account_masked && !r.bank_account_id)
        );

        if (isMissingBank) {
          missingBankCount++;
        }

        let bankBadgeHtml = '';
        const empBankHref = `${Router.hrefFor('a-employee-detail', 'admin')}/${encodeURIComponent(r.id)}/bank`;
        if (isMissingBank) {
          bankBadgeHtml = `
            <a class="pv-pill pv-pill--open payroll-missing-bank-link" href="${empBankHref}" data-action="open-employee-bank" data-employee-id="${escapeHtml(r.id)}" style="display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; text-decoration:none; background:var(--warning-soft); color:var(--warning-text, var(--warning));">
              Missing bank details
            </a>
            <div class="pv-emp-sub" style="font-size:12px; color:var(--ink-muted); margin-top:2px;">Pay outside HRFlow and record it here</div>
          `;
        } else if (hasExternal) {
          const bankName = r.bank_name || 'Bank';
          const maskedIban = r.bank_account_masked || (r.bank_account_id ? '•••• ' + String(r.bank_account_id).slice(-4) : '•••• on file');
          const swift = r.swift || r.swift_code || '';
          bankBadgeHtml = `
            <span style="color:var(--ink-strong); font-weight:500;">${escapeHtml(bankName)} · ${escapeHtml(maskedIban)}</span>
            ${swift ? `<div class="pv-emp-sub" style="font-size:12px; color:var(--ink-muted); margin-top:2px;">SWIFT ${escapeHtml(swift)}</div>` : ''}
          `;
        } else {
          bankBadgeHtml = `<span style="color:var(--ink-muted); font-size:12.5px;">None (Internal only)</span>`;
        }

        const inits = this.getInitials(r.name);
        const empProfileHref = `${Router.hrefFor('a-employee-detail', 'admin').replace(/\/?$/, '')}/${encodeURIComponent(r.id)}`;

        rowsHtml += `
          <tr class="${isMissingBank ? 'warnrow' : ''}" style="${isMissingBank ? 'background: color-mix(in srgb, var(--warning-soft) 40%, transparent);' : ''}">
            <td class="col-id payroll-id-th sr-only" style="display:none;" data-label="ID">${r.id}</td>
            <td class="payroll-name-th" data-label="Employee" style="padding:9px 16px;">
              <span style="display:flex; align-items:center; gap:10px;">
                <span class="avatar">${inits}</span>
                <a class="payroll-emp-link" href="${empProfileHref}" data-action="open-employee-profile" data-employee-id="${escapeHtml(r.id)}" style="color:var(--ink-strong); font-weight:600; text-decoration:none;"><strong>${escapeHtml(r.name)}</strong></a>
              </span>
            </td>
            <td data-label="Employee bank account" style="padding:9px 12px;">${bankBadgeHtml}</td>
            <td class="num payroll-num" data-label="External, USD" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${this.money(extVal)}</td>
            <td class="num payroll-num" data-label="Internal, USD" style="padding:9px 12px; text-align:right; font-variant-numeric:tabular-nums;">${this.money(intVal)}</td>
            <td class="num payroll-num strong accent" data-label="Net pay" style="padding:9px 16px; text-align:right; font-weight:700; color:var(--ink-strong); font-variant-numeric:tabular-nums;">${this.money(netVal)}</td>
          </tr>
        `;
      });
      tbody.innerHTML = rowsHtml;

      const rCard = document.getElementById('p4RecipientsCard');
      const rVal = document.getElementById('p4RecipientsVal');
      const rSub = document.getElementById('p4RecipientsSub');
      if (rVal) {
        if (missingBankCount > 0) {
          if (rCard) {
            rCard.classList.add('pv-stat-tile--flagged');
            rCard.style.borderColor = 'color-mix(in srgb, var(--warning) 40%, transparent)';
          }
          rVal.style.color = 'var(--warning-text, var(--warning))';
          rVal.innerHTML = `<span id="p4MissingBankCount">${missingBankCount}</span> of <span id="p4Headcount">${this.rows.length}</span> flagged`;
          if (rSub) rSub.textContent = 'missing bank details · payment can still be recorded';
        } else {
          if (rCard) {
            rCard.classList.remove('pv-stat-tile--flagged');
            rCard.style.borderColor = '';
          }
          rVal.style.color = 'var(--ink-strong)';
          rVal.innerHTML = `<span id="p4MissingBankCount" style="display:none;">0</span><span id="p4Headcount">${this.rows.length}</span> recipients`;
          if (rSub) rSub.textContent = 'all recipients ready';
        }
      }

      const p4Lbl = document.getElementById('p4TotalsLabel');
      if (p4Lbl) p4Lbl.textContent = `Totals \u00b7 ${this.rows.length} ${this.rows.length === 1 ? 'recipient' : 'recipients'}`;

      const fExt = document.getElementById('p4TotExt');
      const fInt = document.getElementById('p4TotInt');
      const fNet = document.getElementById('p4TotNet');
      if (fExt) fExt.textContent = this.money(extBank);
      if (fInt) fInt.textContent = this.money(intCash);
      if (fNet) fNet.textContent = this.money(netTotal);
    },

    /* ==================== SCREEN 5: PAYMENT CONFIRMATION ==================== */
    drawScreen5() {
      const extEl = document.getElementById('accExternal');
      const intEl = document.getElementById('accInternal');
      const t = this.rollup();
      const p = this.currentPreview;

      const extBankObj = this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId));
      const intBankObj = this.banks.find(b => String(b.id) === String(this.selectedInternalAccountId));
      const extBankName = extBankObj ? this.fundingAccountLabel(extBankObj) : '—';
      const intBankName = intBankObj ? this.fundingAccountLabel(intBankObj) : '—';

      const { ext: extTotal, int: intTotal } = this.paymentTotals();

      // Count recipients per rail
      let extRecipients = 0;
      let intRecipients = 0;
      (this.rows || []).forEach(r => {
        const c = this.computeRow(r);
        if (c.external > 0 || r.baseExt > 0) extRecipients++;
        if (c.internal > 0 || r.baseInt > 0) intRecipients++;
      });

      // Populate Screen 5 Informational Rail Cards
      const p5ExtTot = document.getElementById('p5ExtTotal');
      const p5ExtAcc = document.getElementById('p5ExtAccount');
      const p5ExtRec = document.getElementById('p5ExtRecipients');
      const p5ExtRecCount = document.getElementById('p5ExtRecipientsCount');
      const p5ExtDate = document.getElementById('p5ExtPayDate');

      const p5IntTot = document.getElementById('p5IntTotal');
      const p5IntAcc = document.getElementById('p5IntAccount');
      const p5IntRec = document.getElementById('p5IntRecipients');
      const p5IntRecCount = document.getElementById('p5IntRecipientsCount');
      const p5IntDate = document.getElementById('p5IntPayDate');

      if (p5ExtTot) p5ExtTot.textContent = this.money(extTotal);
      if (p5ExtAcc) p5ExtAcc.textContent = extBankName;
      if (p5ExtRec) p5ExtRec.textContent = 'External salaries';
      if (p5ExtRecCount) p5ExtRecCount.textContent = `${extRecipients} employee${extRecipients === 1 ? '' : 's'}`;
      if (p5ExtDate) p5ExtDate.textContent = fmtDateShort(this.payDate);

      if (p5IntTot) p5IntTot.textContent = this.money(intTotal);
      if (p5IntAcc) p5IntAcc.textContent = intBankName;
      if (p5IntRec) p5IntRec.textContent = 'Internal salaries';
      if (p5IntRecCount) p5IntRecCount.textContent = `${intRecipients} employee${intRecipients === 1 ? '' : 's'}`;
      if (p5IntDate) p5IntDate.textContent = fmtDateShort(this.payDate);

      if (extEl) extEl.textContent = `${this.money(extTotal)} (${extBankName})`;
      if (intEl) intEl.textContent = `${this.money(intTotal)} (${intBankName})`;

      // Render persisted run exceptions instead of static text
      const excStrip = document.getElementById('payrollExceptionList');
      const excWrap = document.getElementById('p5ExceptionsWrap');
      if (excStrip) {
        const runExceptions = (this.currentRun && Array.isArray(this.currentRun.exceptions) && this.currentRun.exceptions.length > 0)
          ? this.currentRun.exceptions
          : ((this.currentPreview && this.currentPreview.exceptions) || []);
        if (runExceptions.length > 0) {
          if (excWrap) excWrap.style.display = 'flex';
          const missingBankExc = runExceptions.filter(exc => exc.code === 'MISSING_BANK_DETAILS');
          const otherExc = runExceptions.filter(exc => exc.code !== 'MISSING_BANK_DETAILS');
          const alertHtml = (isWarn, label, text) => `
              <div class="alertbox"${isWarn ? '' : ' style="background:var(--danger-soft); color:var(--danger);"'}>
                <i class="fa-solid ${isWarn ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}"></i>
                <span><strong>${label}:</strong> ${escapeHtml(text)}</span>
              </div>`;
          let missingHtml = '';
          if (missingBankExc.length > 0) {
            const missingNames = missingBankExc.map(exc => {
              const row = (this.rows || []).find(r => String(r.id) === String(exc.employee_id));
              return row ? row.name : `Employee #${exc.employee_id}`;
            });
            const nameStr = missingNames.length > 0 ? missingNames.join(', ') : `${missingBankExc.length} employee${missingBankExc.length === 1 ? '' : 's'}`;
            missingHtml = alertHtml(true, 'Warning', `${nameStr} has no employee bank account on file (bank details missing for ${missingBankExc.length} employee${missingBankExc.length === 1 ? '' : 's'}). Flagged only; this does not block recording the payment. Payment can still be recorded.`);
          }
          excStrip.innerHTML = missingHtml + otherExc.map(exc => {
            const isWarn = exc.severity === 'warning';
            return alertHtml(isWarn, isWarn ? 'Warning' : 'Blocking exception', exc.details || exc.message || 'Exception reported for this run.');
          }).join('');
        } else {
          if (excWrap) excWrap.style.display = 'none';
          excStrip.innerHTML = '';
        }
      }

      const resCard = document.getElementById('p5DisburseResultsCard');
      const jCard = document.getElementById('payrollJournalCard');
      const btnDisburse = document.getElementById('btnP5ConfirmDisburse');

      const isDisbursed = this.currentRun && (this.currentRun.status === 'paid' || this.currentRun.status === 'partially_paid');

      if (isDisbursed) {
        if (resCard) resCard.classList.remove('payroll-hidden');
        if (jCard) jCard.classList.remove('payroll-hidden');
        if (btnDisburse) {
          this.showRecordedAsPaid(btnDisburse);
        }
        this.drawDisburseResults();
        this.drawJournalRows();
      } else {
        if (resCard) resCard.classList.add('payroll-hidden');
        if (jCard) jCard.classList.add('payroll-hidden');
        if (btnDisburse) {
          btnDisburse.disabled = false;
          btnDisburse.textContent = 'Confirm and record as paid';
        }
        this.applyConfirmState();
      }
    },

    missingBankCount() {
      const excs = (this.currentRun && this.currentRun.exceptions) || (this.currentPreview && this.currentPreview.exceptions) || [];
      return new Set(excs.filter(e => e.code === 'MISSING_BANK_DETAILS').map(e => Number(e.employee_id))).size;
    },

    async confirmDisbursement() {
      const run = this.currentRun;
      if (!run || !['finalized', 'processing', 'partially_paid'].includes(run.status)) {
        this.showBanner('Payroll must be approved and finalized before payment can be recorded.', 'red');
        return;
      }
      const totals = this.paymentTotals();
      const recipients = this.rows.length;
      const missing = this.missingBankCount();

      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const mMatch = /^(\d{4})-(\d{2})/.exec(String(this.month || ''));
      const monthTitle = mMatch ? `${MONTHS[+mMatch[2] - 1]} ${mMatch[1]}` : this.month;

      const extBankName = (this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId)) || {}).name || 'Voyance Operating USD';
      const intBankName = (this.banks.find(b => String(b.id) === String(this.selectedInternalAccountId)) || {}).name || 'CIB EGP Operating';
      const paidOn = (run && (run.paid_at || run.payment_date)) || this.payDate;

      const confirmed = await FinanceCommand.confirmAction({
        title: `Record ${monthTitle} as paid?`,
        subtitle: 'Records the payment in HRFlow. No money is sent.',
        tone: 'violet',
        iconSvg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5"></path></svg>',
        tiles: [
          { label: 'Total net pay', value: this.money(totals.net) },
          { label: 'Recipients', value: `${recipients} ${recipients === 1 ? 'employee' : 'employees'}` },
          { label: 'Missing bank details', value: `${missing} ${missing === 1 ? 'employee' : 'employees'}`, tone: missing > 0 ? 'amber' : 'neutral' },
        ],
        consequence: `Internal salaries ${this.money(totals.int)} from ${intBankName} and external salaries ${this.money(totals.ext)} from ${extBankName}, dated ${fmtDateShort(paidOn)}. Missing bank details do not block this.`,
        actionLabel: 'Confirm and record as paid',
        actionClass: 'btn btn-fill',
        severity: 'warning',
      });
      if (!confirmed.confirmed) return;

      const unlock = FinanceCommand.lockSubmitButton('btnP5ConfirmDisburse');
      if (unlock === null) return;
      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.disbursePayrollRun === 'function') {
          await FinanceApi.disbursePayrollRun(run.id);
          await FinanceApi.postPayrollJournal(run.id);
          this.currentRun = await FinanceApi.getPayrollRun(run.id);
        } else if (this.currentRun) {
          this.currentRun.status = 'paid';
        }

        this.journalPosted = true;
        this.addAudit('Payroll run recorded as paid and general ledger entry posted.');
        this.showBanner('Payroll recorded as paid and journal posted.', 'green');
        this.drawScreen5();
        this.drawStatus();
      } catch (err) {
        console.error('Error confirming disbursement:', err);
        this.showBanner(err.message || 'Recording payment failed.', 'red');
      } finally {
        unlock();
        this.applyConfirmState();
      }
    },

    // A paid run shows a disabled button that states the date, not an active-looking primary.
    showRecordedAsPaid(btn) {
      const paidOn = (this.currentRun && (this.currentRun.paid_at || this.currentRun.payment_date)) || this.payDate;
      btn.disabled = true;
      btn.textContent = `Recorded as paid on ${fmtDateShort(paidOn)}`;
    },

    // Disable the confirm button, with an explanation, until the run is finalized.
    applyConfirmState() {
      const btn = document.getElementById('btnP5ConfirmDisburse');
      const hint = document.getElementById('p5ConfirmHint');
      if (!btn) return;
      const status = this.currentRun && this.currentRun.status;
      const paid = status === 'paid';
      const ready = ['finalized', 'processing', 'partially_paid'].includes(status);
      // "Next: Statutory payments" joins the footer once the payment is recorded
      const nextBtn = document.getElementById('btnP5ProceedStatutory');
      if (nextBtn) nextBtn.hidden = !(paid || status === 'partially_paid');
      if (paid || status === 'partially_paid') this.showRecordedAsPaid(btn);
      else btn.disabled = !ready;
      const unsetLegs = ready && !paid ? this.unsetFundingLegs() : [];
      if (unsetLegs.length) btn.disabled = true;
      this.drawFundingBlock(unsetLegs);
      if (hint) {
        hint.hidden = false;
        hint.textContent = unsetLegs.length
          ? 'Payment is blocked until the funding accounts are set.'
          : (ready || paid ? 'Records the payment in HRFlow. No money is sent from here.' : 'Payment can be recorded once the run is approved and finalized.');
      }
    },

    // One row per employee: External, Internal and Total paid side by side. The values come from
    // paymentValues(), the same source as the two rail cards and step 4, so the totals row equals the
    // card amounts and External + Internal = Total paid on every row.
    drawDisburseResults() {
      const tbody = document.getElementById('payrollDisburseResultsTableBody');
      if (!tbody) return;

      const pay = this.paymentValues();
      const lines = (this.currentRun && this.currentRun.lines) || [];
      const exceptions = (this.currentRun && this.currentRun.exceptions) || (this.currentPreview && this.currentPreview.exceptions) || [];
      const missingIds = new Set(exceptions.filter(e => e.code === 'MISSING_BANK_DETAILS').map(e => Number(e.employee_id)));
      let totExt = 0, totInt = 0, totNet = 0;

      tbody.innerHTML = (this.rows || []).map(r => {
        const v = pay.get(Number(r.id)) || { ext: 0, int: 0, net: 0 };
        totExt += v.ext; totInt += v.int; totNet += v.net;

        const hasExternal = v.ext > 0 || r.baseExt > 0;
        const missingBank = hasExternal && (missingIds.has(Number(r.id)) || r.has_missing_bank
          || (!r.bank_name && !r.bank_account_masked && !r.bank_account_id));
        let bankHtml;
        if (missingBank) {
          bankHtml = '<span class="payroll-bank-missing">Missing</span>';
        } else if (hasExternal) {
          bankHtml = r.bank_name ? `${escapeHtml(r.bank_name)} ${escapeHtml(r.bank_account_masked || '')}` : 'On file';
        } else {
          bankHtml = '<span class="muted">Not needed (internal only)</span>';
        }

        const empLines = lines.filter(l => Number(l.employee_id) === Number(r.id));
        const flagged = empLines.find(l => l.payment_status === 'flagged' || l.missing_bank || l.failure_reason);
        const isWarn = !!flagged || (empLines.length === 0 && missingBank);
        const reason = (flagged && flagged.failure_reason) || (isWarn ? 'Bank details are missing; settle manually or by cash.' : '');
        const statusText = isWarn ? 'Flagged' : 'Paid';
        const badgeClass = isWarn ? 'pill-warning' : 'pill-success';

        return `
          <tr class="${isWarn ? 'warnrow' : ''}">
            <td class="tname"><span class="avatar">${this.getInitials(r.name)}</span>${escapeHtml(r.name)}</td>
            <td>${bankHtml}</td>
            <td class="num payroll-num payroll-col-ext">${this.money(v.ext)}</td>
            <td class="num payroll-num payroll-col-int">${this.money(v.int)}</td>
            <td class="num payroll-num" style="font-weight:700;">${this.money(v.net)}</td>
            <td><span class="${badgeClass} badge-pill"${reason ? ` title="${escapeHtml(reason)}"` : ''}>${statusText}</span></td>
          </tr>
        `;
      }).join('');

      const setTot = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = this.money(val); };
      setTot('p5TotExt', totExt);
      setTot('p5TotInt', totInt);
      setTot('p5TotNet', totNet);
    },

    drawJournalRows() {
      const rowsEl = document.getElementById('payrollJournalRows');
      if (!rowsEl) return;
      const t = this.rollup();
      const p = this.currentPreview;
      const { ext: extTotal, int: intTotal, net: netTotal } = this.paymentTotals();

      const extBankName = (this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId)) || {}).name || 'External funding account';
      const intBankName = (this.banks.find(b => String(b.id) === String(this.selectedInternalAccountId)) || {}).name || 'Internal funding account';

      rowsEl.innerHTML = `
        <div class="jr"><span>6100 - Payroll employee disbursements</span><span>${this.money(netTotal)}</span><span>—</span></div>
        <div class="jr"><span>${extBankName}</span><span>—</span><span>${this.money(extTotal)}</span></div>
        <div class="jr"><span>${intBankName}</span><span>—</span><span>${this.money(intTotal)}</span></div>
      `;
    },

    toggleJournalDetails() {
      const el = document.getElementById('payrollJournalDetails');
      const chev = document.getElementById('payrollJournalChevron');
      if (!el) return;
      const isHidden = el.classList.contains('payroll-hidden');
      if (isHidden) {
        el.classList.remove('payroll-hidden');
        if (chev) chev.className = 'fa-solid fa-chevron-up';
      } else {
        el.classList.add('payroll-hidden');
        if (chev) chev.className = 'fa-solid fa-chevron-down';
      }
    },

    /* ==================== SCREEN 6: STATUTORY RECONCILIATION ==================== */
    async drawScreen6() {
      // Permission evaluation
      const canWrite = typeof SessionInfo !== 'undefined' ? SessionInfo.hasPermission('finance.statutory.write') : true;

      // Extract Snapshot Totals
      const rate = this.resolvedFxRate || 50.0;
      let siEst = 0, taxEst = 0;

      if (this.currentRun) {
        siEst = Number(this.currentRun.total_social_insurance_egp || 0);
        taxEst = Number(this.currentRun.total_employee_tax_egp || 0);
        if (siEst === 0 && this.currentRun.lines) {
          siEst = this.currentRun.lines.reduce((sum, l) => sum + Number(l.total_social_insurance_egp || 0), 0);
          taxEst = this.currentRun.lines.reduce((sum, l) => sum + Number(l.employee_tax_egp || 0), 0);
        }
      }
      if (siEst === 0) {
        const t = this.rollup();
        siEst = Math.round(t.deductions * rate * 1.5 * 100) / 100;
      }

      const siEstEl = document.getElementById('p6SocialInsEstimate');
      const taxEstEl = document.getElementById('p6TaxEstimate');
      if (siEstEl) {
        siEstEl.setAttribute('data-est', String(siEst));
        siEstEl.textContent = `${siEst.toFixed(2)} EGP ($${(siEst / rate).toFixed(2)})`;
      }
      if (taxEstEl) {
        taxEstEl.setAttribute('data-est', String(taxEst));
        taxEstEl.textContent = `${taxEst.toFixed(2)} EGP ($${(taxEst / rate).toFixed(2)})`;
      }

      const siInput = document.getElementById('p6SocialInsActual');
      const taxInput = document.getElementById('p6TaxActual');
      if (siInput && !siInput.value) siInput.value = siEst.toFixed(2);
      if (taxInput && !taxInput.value) taxInput.value = taxEst.toFixed(2);

      this.calcScreen6Variance('si');
      this.calcScreen6Variance('tax');

      const siAccountSelect = document.getElementById('p6SiDebitAccount');
      const taxAccountSelect = document.getElementById('p6TaxDebitAccount');
      const siDateInput = document.getElementById('p6SiPaymentDate');
      const taxDateInput = document.getElementById('p6TaxPaymentDate');

      // Statutory payments follow the funding account set in Payroll settings: shown read-only, no other choice
      const bankOptionsHtml = this.fundingOptionHtml(this.selectedExternalAccountId, this.fundingSummary.external);
      if (siAccountSelect) { siAccountSelect.innerHTML = bankOptionsHtml; siAccountSelect.disabled = true; }
      if (taxAccountSelect) { taxAccountSelect.innerHTML = bankOptionsHtml; taxAccountSelect.disabled = true; }
      this.applyStatutoryFundingState();

      const defaultPayDate = this.payDate || new Date().toISOString().slice(0, 10);
      if (siDateInput && !siDateInput.value) siDateInput.value = defaultPayDate;
      if (taxDateInput && !taxDateInput.value) taxDateInput.value = defaultPayDate;

      // Load linked statutory obligations from database
      await this.loadLinkedStatutoryObligations();

      // Disable buttons if not authorized
      const btnRecordSi = document.getElementById('btnP6RecordSocialIns');
      const btnRecordTax = document.getElementById('btnP6RecordTax');
      if (!canWrite) {
        if (btnRecordSi) btnRecordSi.disabled = true;
        if (btnRecordTax) btnRecordTax.disabled = true;
      }
    },

    calcScreen6Variance(type) {
      const rate = this.resolvedFxRate || 50.0;
      if (type === 'si') {
        const estText = document.getElementById('p6SocialInsEstimate');
        const input = document.getElementById('p6SocialInsActual');
        const varEl = document.getElementById('p6SocialInsVariance');
        if (!input || !varEl) return;
        const est = estText ? (parseFloat(estText.getAttribute('data-est')) || parseFloat(estText.textContent) || 0) : 0;
        const actual = parseFloat(input.value) || 0;
        const diff = Math.round((actual - est) * 100) / 100;
        const sign = diff > 0 ? '+' : '';
        varEl.textContent = `${sign}${diff.toFixed(2)} EGP`;
        varEl.style.color = diff !== 0 ? (diff > 0 ? 'var(--warning-text, var(--warning))' : 'var(--success)') : 'var(--ink-muted)';
      } else if (type === 'tax') {
        const estText = document.getElementById('p6TaxEstimate');
        const input = document.getElementById('p6TaxActual');
        const varEl = document.getElementById('p6TaxVariance');
        if (!input || !varEl) return;
        const est = estText ? (parseFloat(estText.getAttribute('data-est')) || parseFloat(estText.textContent) || 0) : 0;
        const actual = parseFloat(input.value) || 0;
        const diff = Math.round((actual - est) * 100) / 100;
        const sign = diff > 0 ? '+' : '';
        varEl.textContent = `${sign}${diff.toFixed(2)} EGP`;
        varEl.style.color = diff !== 0 ? (diff > 0 ? 'var(--warning-text, var(--warning))' : 'var(--success)') : 'var(--ink-muted)';
      }
    },

    async loadLinkedStatutoryObligations() {
      const tbody = document.getElementById('payrollStatutoryRecordsTableBody');
      if (!tbody) return;

      const typeLabel = (t) => {
        if (!t) return '—';
        if (t.includes('social_insurance')) return 'Social insurance';
        if (t.includes('tax')) return 'Salary income tax';
        return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      };

      const statusBadge = (st) => {
        const s = (st || 'accrued').toLowerCase();
        if (s === 'remitted') return '<span class="stage-badge settled">Remitted</span>';
        if (s === 'accrued') return '<span class="stage-badge recorded">Recorded, unpaid</span>';
        return '<span class="stage-badge unrecorded">Not recorded</span>';
      };

      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.listStatutoryObligations === 'function') {
          const list = await FinanceApi.listStatutoryObligations({ period: this.month });
          const runTag = `payroll_run_id:${this.currentRun ? this.currentRun.id : ''}`;
          const linked = (list || []).filter(o => (o.notes && o.notes.includes(runTag)) || o.period === this.month);

          if (linked.length > 0) {
            tbody.innerHTML = linked.map(o => `
              <tr>
                <td style="padding: 11px 16px; font-weight: 600; color: var(--ink-strong);">${typeLabel(o.obligation_type)}</td>
                <td style="padding: 11px 12px;">${escapeHtml(o.period || '')}</td>
                <td class="num payroll-num" style="padding: 11px 12px; text-align: right; font-weight: 600; color: var(--ink-strong);">${o.currency || 'EGP'} ${Number(o.amount_accrued).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="num payroll-num" style="padding: 11px 12px; text-align: right; color: var(--ink-muted);">${o.currency || 'EGP'} ${Number(o.amount_remitted || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style="padding: 11px 12px;">${statusBadge(o.status)}</td>
                <td style="padding: 11px 16px; color: var(--ink-muted);">${escapeHtml(o.notes || '—')}</td>
              </tr>
            `).join('');

            // Update badge & settle buttons
            const siObl = linked.find(o => o.obligation_type.includes('social_insurance'));
            const taxObl = linked.find(o => o.obligation_type.includes('income_tax'));

            const siBadge = document.getElementById('p6SiStatusBadge');
            const taxBadge = document.getElementById('p6TaxStatusBadge');
            const btnRecordSi = document.getElementById('btnP6RecordSocialIns');
            const btnRecordTax = document.getElementById('btnP6RecordTax');
            const btnSettleSi = document.getElementById('btnP6SettleSocialIns');
            const btnSettleTax = document.getElementById('btnP6SettleTax');
            const siPayStage = document.getElementById('p6SiPayStage');
            const taxPayStage = document.getElementById('p6TaxPayStage');

            if (siObl) {
              if (siBadge) {
                const isRemitted = siObl.status === 'remitted';
                siBadge.textContent = isRemitted ? 'Remitted' : 'Recorded, unpaid';
                siBadge.className = `stage-badge ${isRemitted ? 'settled' : 'recorded'}`;
              }
              if (siPayStage) siPayStage.classList.remove('locked');
              if (btnSettleSi) {
                btnSettleSi.disabled = siObl.status === 'remitted';
                btnSettleSi.setAttribute('data-obl-id', siObl.id);
                btnSettleSi.style.display = '';
              }
              if (btnRecordSi) btnRecordSi.style.display = 'none';
            } else {
              if (siBadge) {
                siBadge.textContent = 'Not recorded';
                siBadge.className = 'stage-badge unrecorded';
              }
              if (siPayStage) siPayStage.classList.add('locked');
              if (btnSettleSi) {
                btnSettleSi.disabled = true;
                btnSettleSi.style.display = 'none';
              }
              if (btnRecordSi) btnRecordSi.style.display = '';
            }

            if (taxObl) {
              if (taxBadge) {
                const isRemitted = taxObl.status === 'remitted';
                taxBadge.textContent = isRemitted ? 'Remitted' : 'Recorded, unpaid';
                taxBadge.className = `stage-badge ${isRemitted ? 'settled' : 'recorded'}`;
              }
              if (taxPayStage) taxPayStage.classList.remove('locked');
              if (btnSettleTax) {
                btnSettleTax.disabled = taxObl.status === 'remitted';
                btnSettleTax.setAttribute('data-obl-id', taxObl.id);
                btnSettleTax.style.display = '';
              }
              if (btnRecordTax) btnRecordTax.style.display = 'none';
            } else {
              if (taxBadge) {
                taxBadge.textContent = 'Not recorded';
                taxBadge.className = 'stage-badge unrecorded';
              }
              if (taxPayStage) taxPayStage.classList.add('locked');
              if (btnSettleTax) {
                btnSettleTax.disabled = true;
                btnSettleTax.style.display = 'none';
              }
              if (btnRecordTax) btnRecordTax.style.display = '';
            }

            const resolved = this.resolvePayrollRunState(this.currentRun, linked);
            this.renderStatutoryBadge(resolved.badge, resolved.badgeClass);
            this.applyStatutoryFundingState();
            return;
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load statutory obligations:', err);
      }

      if (this.currentRun && (this.currentRun.status === 'paid' || this.currentRun.status === 'partially_paid')) {
        this.renderStatutoryBadge('Statutory not recorded', 'b-gray');
      }
      const siBadge = document.getElementById('p6SiStatusBadge');
      const taxBadge = document.getElementById('p6TaxStatusBadge');
      const siPayStage = document.getElementById('p6SiPayStage');
      const taxPayStage = document.getElementById('p6TaxPayStage');
      const btnRecordSi = document.getElementById('btnP6RecordSocialIns');
      const btnRecordTax = document.getElementById('btnP6RecordTax');
      const btnSettleSi = document.getElementById('btnP6SettleSocialIns');
      const btnSettleTax = document.getElementById('btnP6SettleTax');
      if (siBadge) { siBadge.textContent = 'Not recorded'; siBadge.className = 'stage-badge unrecorded'; }
      if (taxBadge) { taxBadge.textContent = 'Not recorded'; taxBadge.className = 'stage-badge unrecorded'; }
      if (siPayStage) siPayStage.classList.add('locked');
      if (taxPayStage) taxPayStage.classList.add('locked');
      if (btnRecordSi) btnRecordSi.style.display = '';
      if (btnRecordTax) btnRecordTax.style.display = '';
      if (btnSettleSi) { btnSettleSi.disabled = true; btnSettleSi.style.display = 'none'; }
      if (btnSettleTax) { btnSettleTax.disabled = true; btnSettleTax.style.display = 'none'; }
      tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center; padding:16px;">No statutory obligations recorded yet for this payroll run.</td></tr>';
    },

    async recordStatutoryObligation(type) {
      if (typeof SessionInfo !== 'undefined' && !SessionInfo.hasPermission('finance.statutory.write')) {
        this.showBanner('Permission denied: finance.statutory.write required.', 'red');
        return;
      }

      const runId = (this.currentRun && this.currentRun.id) || 1;
      const isSi = type === 'si';
      const input = document.getElementById(isSi ? 'p6SocialInsActual' : 'p6TaxActual');
      const amt = input ? parseFloat(input.value) : 0;

      if (!amt || amt <= 0) {
        FinanceForm.setFieldError(input, 'Enter an actual amount greater than zero.');
        return;
      }

      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.createStatutoryObligation === 'function') {
          const obl = await FinanceApi.createStatutoryObligation({
            obligation_type: isSi ? 'social_insurance_employee' : 'income_tax',
            period: this.month,
            amount_accrued: amt,
            currency: 'EGP',
            due_date: `${this.month}-15`,
            notes: `payroll_run_id:${runId} | source:payroll_snapshot | actual_true_up`
          });
          this.showBanner(`Statutory obligation #${obl.id} recorded in accrued status.`, 'blue');
          this.addAudit(`Recorded ${isSi ? 'Social Insurance' : 'Tax'} statutory obligation #${obl.id} of ${amt} EGP.`);
          await this.loadLinkedStatutoryObligations();
        }
      } catch (err) {
        console.error('Error recording statutory obligation:', err);
        this.showBanner(err.message || 'Failed to record statutory obligation.', 'red');
      }
    },

    // Settling a statutory payment needs the funding account from Payroll settings; without it the buttons stay off.
    applyStatutoryFundingState() {
      if (this.selectedExternalAccountId) return;
      ['btnP6SettleSocialIns', 'btnP6SettleTax'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = true; btn.title = 'Set the funding account in Payroll settings first.'; }
      });
    },

    async settleStatutory(type) {
      const isSi = type === 'si';
      const btn = document.getElementById(isSi ? 'btnP6SettleSocialIns' : 'btnP6SettleTax');
      const oblId = btn ? btn.getAttribute('data-obl-id') : null;
      if (!oblId) return;

      const dateInput = document.getElementById(isSi ? 'p6SiPaymentDate' : 'p6TaxPaymentDate');

      if (!this.selectedExternalAccountId) {
        this.showBanner('Statutory payments cannot be recorded until the funding account is set in Payroll settings.', 'red');
        return;
      }
      const bankAccountId = Number(this.selectedExternalAccountId);
      const paymentDate = (dateInput && dateInput.value) ? dateInput.value : new Date().toISOString().slice(0, 10);

      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.settleStatutoryObligation === 'function') {
          const obl = await FinanceApi.getStatutoryObligation(oblId);
          await FinanceApi.settleStatutoryObligation(oblId, {
            amount: obl.amount_accrued,
            payment_date: paymentDate,
            bank_account_id: bankAccountId
          });
          this.showBanner(`Statutory obligation #${oblId} settled and remitted.`, 'green');
          this.addAudit(`Settled statutory obligation #${oblId}.`);
          await this.loadLinkedStatutoryObligations();
        }
      } catch (err) {
        console.error('Error settling statutory obligation:', err);
        this.showBanner(err.message || 'Failed to remit payment.', 'red');
      }
    },

    /* ==================== COMMON HELPERS ==================== */
    async fetchPreview() {
      try {
        let preview = null;
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.previewPayrollRun === 'function') {
          preview = await FinanceApi.previewPayrollRun({
            period_label: this.month,
            period_start: this.start,
            period_end: this.end,
            payment_date: this.payDate,
            fx_rate_source: this.fxRateValue ? 'manual' : (this.fxRateSource || 'first_of_month'),
            fx_rate_value: this.fxRateValue ? Number(this.fxRateValue) : null
          });
        }

        if (preview) {
          this.currentPreview = preview;
          if (preview.fx_rate_value !== undefined && preview.fx_rate_value !== null) {
            this.fxResolved = true;
            this.resolvedFxRate = Number(preview.fx_rate_value);
            this.resolvedFxSource = preview.fx_rate_source || (this.fxRateValue ? 'manual' : 'fallback');
          }

          if (Array.isArray(preview.recipients) && preview.recipients.length > 0) {
            const map = {};
            preview.recipients.forEach(r => { map[r.employee_id] = r; });
            (this.rows || []).forEach(r => {
              const recip = map[r.id];
              if (recip) {
                r.deductions = Number(recip.int_deductions_total !== undefined ? recip.int_deductions_total : 0);
                r.deductions_total = r.deductions;
                r.deductions_label = recip.deductions_label || (r.deductions > 0 ? 'Social Insurance (Internal Estimate)' : null);
              }
            });
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not fetch payroll preview:', err);
        // No silent default rate: say what is missing and block saving until a rate is typed in
        this.fxResolved = false;
        this.showBanner(err && err.message ? err.message : 'Could not calculate the payroll preview.', 'red');
      }
    },

    // Saving a run needs a real rate: the typed one, or one a preview resolved. Never the 50.0000 display default.
    requireFxRate() {
      if ((this.fxRateValue && Number(this.fxRateValue) > 0) || this.fxResolved) return true;
      this.showBanner('No USD-EGP rate available for this period. Enter the rate manually.', 'red');
      return false;
    },

    // Dated social insurance rates: newest first, with the "Effective from" month defaulting to this month
    async loadRateHistory() {
      const body = document.getElementById('payrollRatesHistoryBody');
      const wrap = document.getElementById('payrollRatesHistoryWrap');
      const fromEl = document.getElementById('payrollRatesEffectiveFrom');
      if (fromEl && !fromEl.value) fromEl.value = new Date().toISOString().slice(0, 7);
      if (!body || typeof FinanceApi === 'undefined' || typeof FinanceApi.getPayrollRateSettings !== 'function') return;
      try {
        const rows = await FinanceApi.getPayrollRateSettings();
        const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;
        const inForceFrom = new Date().toISOString().slice(0, 7) + '-01';
        const current = (rows || []).find(r => r.effective_from <= inForceFrom);
        body.innerHTML = (rows || []).map(r => `<tr${current && r.id === current.id ? ' class="is-current"' : ''}><td data-label="From">${escapeHtml(String(r.effective_from).slice(0, 7))}${current && r.id === current.id ? ' (current)' : ''}</td><td class="num" data-label="Employee">${pct(r.employee_rate)}</td><td class="num" data-label="Employer">${pct(r.employer_rate)}</td></tr>`).join('');
        if (wrap) wrap.hidden = !(rows && rows.length);
      } catch (err) {
        console.warn('[PayrollApp] Could not load SI rate history:', err);
      }
    },

    async loadSettingsFromDb() {
      try {
        if (typeof FinanceApi !== 'undefined' && FinanceApi.getPayrollSettings) {
          const settings = await FinanceApi.getPayrollSettings();
          if (settings) {
            if (settings.employee_rate !== undefined) this.employeeInsuranceRate = Number(settings.employee_rate);
            if (settings.employer_rate !== undefined) this.employerInsuranceRate = Number(settings.employer_rate);
            this.applyFundingFromSettings(settings);
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load payroll settings:', err);
      }
    },

    // Funding account option text per the mocks: "Name · •••• 1234" (currency appended only when the name lacks it)
    fundingAccountLabel(b) {
      const numStr = String(b.number || '').trim();
      let masked = '';
      if (numStr) {
        masked = (typeof FinanceFormat !== 'undefined' && typeof FinanceFormat.formatMaskedAccountNumber === 'function')
          ? FinanceFormat.formatMaskedAccountNumber(numStr)
          : (numStr.length > 4 ? `•••• ${numStr.slice(-4)}` : numStr);
      }
      const cur = String(b.currency || '');
      const name = cur && !String(b.name || '').toUpperCase().includes(cur.toUpperCase()) ? `${b.name} ${cur}` : String(b.name || '');
      return masked ? `${name} · ${masked}` : name;
    },

    drawFxRate() {
      const rateEl = document.getElementById('payrollFxRateBadge');
      const srcEl = document.getElementById('payrollFxRateSourceBadge');
      const inputEl = document.getElementById('payrollFxRateInput');
      const p1Input = document.getElementById('p1FxRateInput');

      const rateNum = Number(this.resolvedFxRate || 50.0);
      const isManual = this.fxRateValue !== null && this.fxRateValue !== undefined && Number(this.fxRateValue) > 0;
      const isMissing = !isManual && !this.fxResolved;

      if (rateEl) rateEl.textContent = isMissing ? '—' : rateNum.toFixed(4);
      if (srcEl) {
        if (isManual) {
          srcEl.textContent = 'manual override';
        } else if (isMissing) {
          srcEl.textContent = 'rate needed: enter it manually';
        } else {
          srcEl.textContent = 'from transfer history';
        }
      }
      if (inputEl && document.activeElement !== inputEl) inputEl.value = isManual ? this.fxRateValue : '';
      if (p1Input && document.activeElement !== p1Input) p1Input.value = isManual ? this.fxRateValue : '';
    },

    toggleFxOverride() {
      const form = document.getElementById('payrollFxOverrideForm');
      if (!form) return;
      const isHidden = form.style.display === 'none' || !form.style.display;
      form.style.display = isHidden ? 'inline-flex' : 'none';
      if (isHidden) {
        const input = document.getElementById('payrollFxRateInput');
        if (input) {
          input.value = this.fxRateValue || this.resolvedFxRate || '';
          input.focus();
        }
      }
    },

    async applyFxOverride() {
      const input = document.getElementById('payrollFxRateInput');
      const val = input ? parseFloat(input.value) : null;
      if (val && val > 0) {
        this.fxRateValue = val;
        this.addAudit(`Applied manual FX rate override: ${val.toFixed(4)} USD/EGP.`);
      } else {
        this.fxRateValue = null;
        this.addAudit('Cleared manual FX rate override.');
      }
      const form = document.getElementById('payrollFxOverrideForm');
      if (form) form.style.display = 'none';

      await this.fetchPreview();
      this.redraw();
    },

    async resetFxOverride() {
      this.fxRateValue = null;
      this.addAudit('Reset FX rate override to default resolver.');
      const form = document.getElementById('payrollFxOverrideForm');
      if (form) form.style.display = 'none';

      await this.fetchPreview();
      this.redraw();
    },

    // Run page chrome lives in the top bar (mock Pay-Run-*): 'Payroll runs / September 2026', status pill.
    syncRunChrome(page) {
      const onRun = page === 'run';
      const statusBadge = document.getElementById('payrollStatusBadge');
      if (statusBadge) statusBadge.hidden = !onRun;
      const topRevert = document.getElementById('payrollTopRevertBtn');
      if (topRevert && !onRun) topRevert.hidden = true;
      const fxEl = document.getElementById('payrollFxStrip');
      if (fxEl) fxEl.hidden = true;
      const areaEl = document.getElementById('adminAreaName');
      if (areaEl && onRun) areaEl.hidden = true;

      const titleEl = document.getElementById('adminPageTitle');
      if (!titleEl) return;
      if (onRun) {
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const m = /^(\d{4})-(\d{2})/.exec(String(this.month || ''));
        const monthLabel = m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : this.month;
        titleEl.innerHTML = `<a href="#" onclick="PayrollApp.showPage('list'); return false;" class="topbar-crumb">Payroll runs</a> <span class="topbar-crumb-sep">/</span> <span class="topbar-crumb-cur">${monthLabel}</span>`;
      } else if (page === 'list') {
        titleEl.textContent = 'Payroll runs';
      } else if (page === 'settings') {
        titleEl.textContent = 'Payroll settings';
      }
    },

    drawPeriodLabel() {
      if (this.currentPage === 'run') this.syncRunChrome('run');
      const lbl = document.getElementById('payrollPeriodLabel');
      const sub = document.getElementById('payrollPeriodSubtitle');
      if (lbl) lbl.textContent = this.month;
      if (sub) {
        const extAcc = (this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId)) || {}).name || 'Operating Account';
        sub.textContent = `Period ${this.start} to ${this.end} · Funding: ${extAcc}`;
      }
    },

    drawStatus() {
      const badge = document.getElementById('payrollStatusBadge');
      if (!badge) return;
      const key = this.currentStatusKey();
      // Finalized runs read "Approved" until the payment step, then "Finalized · not paid yet" (mock Pay-Run-*)
      const finalizedLabel = this.stepIndex >= 4 ? 'Finalized · not paid yet' : 'Approved';
      const statusMap = {
        draft: ['Draft', 'b-gray'],
        submitted: ['Submitted', 'b-blue'],
        approved: ['Approved', 'b-blue'],
        finalized: [finalizedLabel, 'b-blue'],
        processing: ['Processing', 'b-orange'],
        partially_paid: ['Partially paid', 'b-orange'],
        paid: ['Salaries paid', 'b-green']
      };
      const info = statusMap[key] || ['Draft', 'b-gray'];
      badge.textContent = info[0];
      badge.className = `p-badge ${info[1]} topbar-run-status`;
      // "Revert to draft" sits in the top bar while the run is approved (before the payment step)
      const revertBtn = document.getElementById('payrollTopRevertBtn');
      if (revertBtn) revertBtn.hidden = badge.hidden || info[0] !== 'Approved';
    },

    drawFundingAccounts() {
      const selExt = document.getElementById('payrollTargetExternalAccount');
      const selInt = document.getElementById('payrollTargetInternalAccount');
      const formatOpt = (b, selectedId) => {
        const isSel = String(b.id) === String(selectedId) ? 'selected' : '';
        return `<option value="${b.id}" ${isSel}>${this.fundingAccountLabel(b)}</option>`;
      };
      const placeholder = '<option value="" selected disabled>Not set</option>';
      const canSet = this.canSetFundingAccounts();
      if (selExt) {
        selExt.innerHTML = (this.selectedExternalAccountId ? '' : placeholder) + this.banks.map(b => formatOpt(b, this.selectedExternalAccountId)).join('');
        selExt.disabled = !canSet;
      }
      if (selInt) {
        selInt.innerHTML = (this.selectedInternalAccountId ? '' : placeholder) + this.banks.map(b => formatOpt(b, this.selectedInternalAccountId)).join('');
        selInt.disabled = !canSet;
      }
      const note = document.getElementById('payrollFundingNote');
      if (note) {
        const unset = !this.selectedExternalAccountId || !this.selectedInternalAccountId;
        note.textContent = unset
          ? 'Not set. Payment stays blocked until both accounts are set.'
          : (canSet ? 'Runs use these accounts. Changing them applies to runs that are not finalized yet.' : 'Only a Financial-Admin can change these accounts.');
      }
    },

    async setFundingAccount(type, id) {
      if (!id || typeof FinanceApi === 'undefined' || typeof FinanceApi.updatePayrollSettings !== 'function') return;
      try {
        const saved = await FinanceApi.updatePayrollSettings(type === 'internal'
          ? { internal_funding_account_id: Number(id) }
          : { external_funding_account_id: Number(id) });
        this.applyFundingFromSettings(saved);
        this.showBanner('Funding account saved in Payroll settings.', 'green');
      } catch (err) {
        this.showBanner(err.message || 'Could not save the funding account.', 'red');
      }
      this.drawFundingAccounts();
      this.drawPeriodLabel();
    },

    // Pay step: when Payroll Settings has no account for a leg that carries net pay, payment stops here.
    unsetFundingLegs() {
      const run = this.currentRun || {};
      let ext = 0, int = 0;
      try {
        this.paymentValues().forEach(v => { ext += v.ext; int += v.int; });
      } catch (_) { ext = 1; int = 1; }
      const legs = [];
      if (ext > 0 && !(run.external_funding_account_id || this.selectedExternalAccountId)) legs.push('external');
      if (int > 0 && !(run.internal_funding_account_id || this.selectedInternalAccountId)) legs.push('internal');
      return legs;
    },

    drawFundingBlock(unset) {
      const box = document.getElementById('p5FundingBlock');
      if (!box) return;
      box.hidden = !unset.length;
      if (!unset.length) { box.innerHTML = ''; return; }
      const names = unset.join(' and ');
      if (!this.canSetFundingAccounts()) {
        box.textContent = `Payment is blocked: the ${names} funding account${unset.length > 1 ? 's are' : ' is'} not set. Ask a Financial-Admin to set the funding accounts in Payroll settings.`;
        return;
      }
      const opts = (id) => (this.banks || []).map(b => `<option value="${b.id}" ${String(b.id) === String(id) ? 'selected' : ''}>${this.fundingAccountLabel(b)}</option>`).join('');
      const pick = (leg, id) => `<label>${leg === 'external' ? 'External salaries' : 'Internal salaries'}<select id="p5Fund${leg === 'external' ? 'Ext' : 'Int'}">${id ? '' : '<option value="" selected disabled>Choose an account</option>'}${opts(id)}</select></label>`;
      box.innerHTML = `<strong>Payment is blocked: funding accounts are not set.</strong>
        <div class="pv-subhint">Saving sets them as the default in Payroll settings for every run.</div>
        ${pick('external', this.selectedExternalAccountId)}${pick('internal', this.selectedInternalAccountId)}
        <button type="button" class="btn btn-fill" id="p5SaveFundingBtn" onclick="PayrollApp.saveFundingFromPayStep()">Save as default</button>`;
    },

    async saveFundingFromPayStep() {
      const ext = document.getElementById('p5FundExt');
      const int = document.getElementById('p5FundInt');
      const payload = {};
      if (ext && ext.value) payload.external_funding_account_id = Number(ext.value);
      if (int && int.value) payload.internal_funding_account_id = Number(int.value);
      if (!Object.keys(payload).length) { this.showBanner('Choose the funding accounts first.', 'red'); return; }
      try {
        const saved = await FinanceApi.updatePayrollSettings(payload);
        this.applyFundingFromSettings(saved);
        this.showBanner('Funding accounts saved in Payroll settings.', 'green');
      } catch (err) {
        this.showBanner(err.message || 'Could not save the funding accounts.', 'red');
      }
      this.applyConfirmState();
    },

    async saveSettings() {
      const monthInput = document.getElementById('payrollSetMonth');
      if (monthInput && monthInput.value) this.month = monthInput.value;
      const payDateInput = document.getElementById('payrollSetPayDate');
      if (payDateInput && payDateInput.value) this.payDate = payDateInput.value;
      const startInput = document.getElementById('payrollSetStart');
      if (startInput && startInput.value) this.start = startInput.value;
      const endInput = document.getElementById('payrollSetEnd');
      if (endInput && endInput.value) this.end = endInput.value;

      const setFxInput = document.getElementById('payrollSetFxRate');
      if (setFxInput) {
        const val = parseFloat(setFxInput.value);
        this.fxRateValue = (val && val > 0) ? val : null;
      }

      // Save Social Insurance rates if present
      const empRateEl = document.getElementById('payrollEmployeeInsuranceRate');
      const emprRateEl = document.getElementById('payrollEmployerInsuranceRate');
      if (empRateEl && emprRateEl && typeof FinanceApi !== 'undefined' && typeof FinanceApi.savePayrollRateSettings === 'function') {
        const empRate = Math.round(parseFloat(empRateEl.value) * 100) / 10000;
        const emprRate = Math.round(parseFloat(emprRateEl.value) * 100) / 10000;
        const fromEl = document.getElementById('payrollRatesEffectiveFrom');
        const fromMonth = (fromEl && fromEl.value) ? fromEl.value : new Date().toISOString().slice(0, 7);
        const loaded = this._ratesLoaded || {};
        // Only save a dated rate when it differs from what is in force, so an unrelated Save adds no row
        const changed = loaded.emp === undefined || Math.abs(empRate - loaded.emp) > 1e-9 || Math.abs(emprRate - loaded.empr) > 1e-9 || fromMonth !== loaded.month;
        if (!isNaN(empRate) && !isNaN(emprRate) && changed) {
          try {
            await FinanceApi.savePayrollRateSettings({ effective_from: `${fromMonth}-01`, employee_rate: empRate, employer_rate: emprRate });
            this.employeeInsuranceRate = empRate;
            this.employerInsuranceRate = emprRate;
            await this.loadRateHistory();
          } catch (err) {
            this.showBanner(err.message || 'Could not save the social insurance rates.', 'red');
          }
        }
      }

      // Save Tax Settings / Tax_limit_P if present
      const taxLimitPEl = document.getElementById('payrollTaxLimitP');
      const taxEffectiveFromEl = document.getElementById('payrollTaxEffectiveFrom');
      if (taxLimitPEl && typeof FinanceApi !== 'undefined' && typeof FinanceApi.createTaxSettings === 'function') {
        const pVal = parseFloat(taxLimitPEl.value);
        const fromMonth = (taxEffectiveFromEl && taxEffectiveFromEl.value) ? `${taxEffectiveFromEl.value}-01` : `${this.month}-01`;
        if (!isNaN(pVal) && pVal >= 0) {
          try {
            let brackets = (this.currentTaxSettings && this.currentTaxSettings.brackets) || [];
            if (!brackets || brackets.length === 0) {
              if (typeof FinanceApi.getTaxSettingsTemplate === 'function') {
                const tmpl = await FinanceApi.getTaxSettingsTemplate();
                if (tmpl && tmpl.brackets) brackets = tmpl.brackets;
              }
            }
            const savedTax = await FinanceApi.createTaxSettings({
              effective_from: fromMonth,
              tax_limit_p_egp: pVal,
              brackets: brackets
            });
            this.currentTaxSettings = savedTax;
          } catch (err) {
            console.warn('[PayrollApp] Could not update Tax settings:', err);
          }
        }
      }

      await this.fetchPreview();
      this.drawPeriodLabel();
      this.addAudit('Payroll settings updated.');
      this.showPage('list');
      this.showBanner('Payroll settings saved.', 'blue');
    },

    redraw() {
      this.drawFxRate();
      this.drawStepper();
      this.drawStatus();
      this.drawPeriodLabel();
      if (this.stepIndex === 0) this.drawScreen1();
      else if (this.stepIndex === 1) this.drawScreen2();
      else if (this.stepIndex === 2) this.drawScreen3();
      else if (this.stepIndex === 3) this.drawScreen4();
      else if (this.stepIndex === 4) this.drawScreen5();
      else if (this.stepIndex === 5) this.drawScreen6();
    },

    showPage(page) {
      const pageList = document.getElementById('payrollViewList');
      const pageRun = document.getElementById('payrollViewRun');
      const pageSettings = document.getElementById('payrollViewSettings');
      const navList = document.getElementById('payrollNavList');
      const navSettings = document.getElementById('payrollNavSettings');

      if (!pageList || !pageRun || !pageSettings) return;

      if (window.Router && page !== 'run') Router.setParams([], ['a-finance-payroll-runs', 'a-finance-payroll']);
      pageList.classList.toggle('payroll-hidden', page !== 'list');
      pageRun.classList.toggle('payroll-hidden', page !== 'run');
      pageSettings.classList.toggle('payroll-hidden', page !== 'settings');

      if (navList) navList.classList.toggle('active', page === 'list' || page === 'run');
      if (navSettings) navSettings.classList.toggle('active', page === 'settings');
      if (window.AdminNav && typeof window.AdminNav.syncFromPage === 'function') {
        window.AdminNav.syncFromPage(page === 'settings' ? 'a-finance-payroll-settings' : 'a-finance-payroll-runs');
      }

      this.currentPage = page;
      this.syncRunChrome(page);
      if (page === 'list') {
        this.drawRunsList();
      } else if (page === 'run') {
        this.redraw();
      } else if (page === 'settings') {
        this.drawFundingAccounts();
        this.loadBankAccountsFromDb().then(() => this.loadSettingsFromDb()).then(() => this.drawFundingAccounts());
        const setFxInput = document.getElementById('payrollSetFxRate');
        if (setFxInput) setFxInput.value = this.fxRateValue || '';
        const monthBadge = document.getElementById('payrollSettingsMonthBadge');
        if (monthBadge) {
          monthBadge.textContent = this.formatMonthName(this.month) || 'Current cycle';
        }

        // Populate Social Insurance rates
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getPayrollSettings === 'function') {
          FinanceApi.getPayrollSettings().then(st => {
            if (st) {
              const empEl = document.getElementById('payrollEmployeeInsuranceRate');
              const emprEl = document.getElementById('payrollEmployerInsuranceRate');
              if (empEl && st.employee_rate !== undefined) empEl.value = (st.employee_rate * 100).toFixed(2);
              if (emprEl && st.employer_rate !== undefined) emprEl.value = (st.employer_rate * 100).toFixed(2);
              this._ratesLoaded = {
                emp: Number(st.employee_rate), empr: Number(st.employer_rate), month: new Date().toISOString().slice(0, 7)
              };
            }
          }).catch(e => console.warn('[PayrollApp] Could not load SI settings:', e));
          this.loadRateHistory();
        }

        // Populate Income Tax Settings & Tax_limit_P
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getEffectiveTaxSettings === 'function') {
          const pStart = (this.start && this.start.length >= 7) ? `${this.start.slice(0, 7)}-01` : `${this.month}-01`;
          FinanceApi.getEffectiveTaxSettings(pStart).then(ts => {
            if (ts) {
              this.currentTaxSettings = ts;
              const pEl = document.getElementById('payrollTaxLimitP');
              const fromEl = document.getElementById('payrollTaxEffectiveFrom');
              if (pEl && ts.tax_limit_p_egp !== undefined) pEl.value = Number(ts.tax_limit_p_egp);
              if (fromEl && ts.effective_from) fromEl.value = ts.effective_from.slice(0, 7);
            }
          }).catch(async (e) => {
            console.warn('[PayrollApp] Could not load effective tax settings, attempting template:', e);
            if (typeof FinanceApi.getTaxSettingsTemplate === 'function') {
              try {
                const tmpl = await FinanceApi.getTaxSettingsTemplate();
                if (tmpl) {
                  this.currentTaxSettings = tmpl;
                  const pEl = document.getElementById('payrollTaxLimitP');
                  if (pEl && tmpl.tax_limit_p_egp !== undefined) pEl.value = Number(tmpl.tax_limit_p_egp);
                }
              } catch (_) {}
            }
          });
        }
      }
    },

    showBanner(msg, color = 'blue') {
      const banner = document.getElementById('payrollActionBanner');
      if (!banner) return;
      clearTimeout(this._bannerTimer);
      banner.style.display = 'block';
      banner.textContent = msg;
      banner.className = `payroll-action-banner p-banner-${color}`;
      banner.setAttribute('role', color === 'red' ? 'alert' : 'status');
      if (color === 'red') {
        // Errors stay until dismissed
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'payroll-banner-close';
        close.setAttribute('aria-label', 'Dismiss message');
        close.textContent = '×';
        close.addEventListener('click', () => { banner.style.display = 'none'; });
        banner.appendChild(close);
      } else {
        this._bannerTimer = setTimeout(() => {
          if (banner) banner.style.display = 'none';
        }, 5000);
      }
    },

    formatMonthName(ym) {
      const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
      const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : String(ym || '');
    },

    openRevertModal() {
      const reason = document.getElementById('payrollRevertReason');
      if (reason) reason.value = '';
      const title = document.getElementById('payrollRevertTitle');
      if (title) {
        const m = (this.currentRun && (this.currentRun.month || this.currentRun.period_month)) || this.month || '';
        const formatted = this.formatMonthName(m);
        title.textContent = formatted ? `Revert ${formatted} to draft?` : 'Revert run to draft?';
      }
      openModal('payrollRevertModal');
      if (reason) setTimeout(() => reason.focus(), 50);
    },

    closeRevertModal() {
      closeModal('payrollRevertModal');
    },

    confirmRevert() {
      const reasonEl = document.getElementById('payrollRevertReason');
      const reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) {
        FinanceForm.setFieldError(reasonEl, 'A reason is required to revert to draft.');
        return;
      }
      if (this.currentRun) {
        this.currentRun.status = 'draft';
      }
      this.closeRevertModal();
      this.setStep(1);
      this.addAudit(`Run reverted to draft: ${reason}`);
      this.showBanner('Payroll run reverted to draft.', 'blue');
    }
  };

  // Expose globally
  window.PayrollApp = PayrollApp;

  // Compatibility stubs
  window.loadFinancePayroll = async function (page = 'list') {
    await PayrollApp.init();
    if (page) PayrollApp.showPage(page);
  };
  window.openRunPayrollWizardModal = async function () {
    await PayrollApp.init();
    PayrollApp.openRun('current');
  };
  window.initPayrollTableDeferred = async function () {
    await PayrollApp.init();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const section = document.getElementById('a-finance-payroll');
      if (section) {
        if (section.classList.contains('active')) {
          PayrollApp.init();
        }
        const observer = new MutationObserver(() => {
          if (section.classList.contains('active')) {
            PayrollApp.init();
          }
        });
        observer.observe(section, { attributes: true, attributeFilter: ['class', 'style'] });
      }
    });
  }
})();
