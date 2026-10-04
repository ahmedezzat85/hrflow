/**
 * fe/public/js/finance-payroll.js
 * In-Page Payroll Module Controller for HRFlow (Six-Screen Journey)
 * Sourced and synced directly with real database employees and bank accounts
 */

(function () {
  const seedEmployees = [
    { id: 301, name: 'Youssef Adel', baseExt: 1800, baseInt: 4300, deductions: 473.00, deductions_total: 473.00, bonuses: [], exception: null },
    { id: 302, name: 'Salma Ibrahim', baseExt: 0, baseInt: 4450, deductions: 489.50, deductions_total: 489.50, bonuses: [{ type: 'Support Commission', amount: 360, source: 'internal' }], exception: null },
    { id: 303, name: 'Karim Nabil', baseExt: 2500, baseInt: 4500, deductions: 495.00, deductions_total: 495.00, bonuses: [{ type: 'Bonus', amount: 600, source: 'external' }], exception: null },
    { id: 304, name: 'Mariam Essam', baseExt: 1200, baseInt: 4550, deductions: 500.50, deductions_total: 500.50, bonuses: [{ type: 'Sales Commission', amount: 1050, source: 'internal' }, { type: 'Bonus', amount: 200, source: 'external' }], exception: null },
    { id: 305, name: 'Omar Farouk', baseExt: 0, baseInt: 4200, deductions: 462.00, deductions_total: 462.00, bonuses: [{ type: 'Support Commission', amount: 430, source: 'internal' }], exception: null },
    { id: 306, name: 'Nadine Samir', baseExt: 2000, baseInt: 3100, deductions: 341.00, deductions_total: 341.00, bonuses: [], exception: null },
    { id: 307, name: 'Hassan Tarek', baseExt: 0, baseInt: 5200, deductions: 572.00, deductions_total: 572.00, bonuses: [{ type: 'Bonus', amount: 750, source: 'internal' }], exception: null },
    { id: 308, name: 'Lina Kamal', baseExt: 1600, baseInt: 3900, deductions: 429.00, deductions_total: 429.00, bonuses: [], exception: null }
  ];

  const seedBanks = [
    { id: 1, name: 'Primary Treasury Operating Account', type: 'internal', currency: 'USD', number: '****4021', isDefault: true },
    { id: 2, name: 'Global Payments Partner Account', type: 'external', currency: 'USD', number: '****7788', isDefault: true }
  ];

  const FLOW = ['initiation', 'approve', 'processing', 'preview', 'confirmation', 'statutory'];
  const STEP_META = {
    initiation: { label: '1. Initiation', hint: 'Step 1 of 6 — Confirm payroll schedule, target funding accounts, and currency exchange rate.' },
    approve: { label: '2. Approve', hint: 'Step 2 of 6 — Review base compensation and dynamic bonus/commission additions. Submit & approve run.' },
    processing: { label: '3. Processing', hint: 'Step 3 of 6 — Review frozen backend statutory snapshots. Idempotently finalized upon entry.' },
    preview: { label: '4. Payment Preview', hint: 'Step 4 of 6 — Preview the payment breakdown by salary type before recording payment.' },
    confirmation: { label: '5. Confirm Disbursal', hint: 'Step 5 of 6 — Disburse funds and auto-post general ledger journal entries.' },
    statutory: { label: '6. Statutory Payments', hint: 'Step 6 of 6 — Reconcile portal liabilities and record/settle statutory obligations.' }
  };
  const DONE_HINT = 'Cycle complete — payroll is Paid and statutory obligations are reconciled.';

  const PayrollApp = {
    rows: (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) ? JSON.parse(JSON.stringify(seedEmployees)) : [],
    banks: (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) ? JSON.parse(JSON.stringify(seedBanks)) : [],
    serverRuns: [],
    runsLoadError: null,
    selectedExternalAccountId: 2,
    selectedInternalAccountId: 1,
    month: '2026-09',
    payDate: '2026-09-30',
    start: '2026-09-01',
    end: '2026-09-30',
    fxRateValue: null,
    fxRateSource: null,
    resolvedFxRate: 50.0,
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

          let savedCfg = {};
          try {
            const rawSaved = localStorage.getItem('hrflow_payroll_funding_accounts');
            if (rawSaved) savedCfg = JSON.parse(rawSaved);
          } catch (_) {}

          if (savedCfg.externalId && this.banks.some(b => String(b.id) === String(savedCfg.externalId))) {
            this.selectedExternalAccountId = savedCfg.externalId;
          } else {
            const firstUsd = this.banks.find(b => (b.currency || '').toUpperCase() === 'USD') || this.banks[0];
            this.selectedExternalAccountId = firstUsd ? firstUsd.id : null;
          }

          if (savedCfg.internalId && this.banks.some(b => String(b.id) === String(savedCfg.internalId))) {
            this.selectedInternalAccountId = savedCfg.internalId;
          } else {
            const firstInt = this.banks.find(b => b.name.toLowerCase().includes('cash') || (b.currency || '').toUpperCase() === 'EGP') || this.banks[1] || this.banks[0];
            this.selectedInternalAccountId = firstInt ? firstInt.id : null;
          }
        } else if (!isMockMode) {
          this.banks = [];
          this.showBanner('Failed to load company funding accounts from server.', 'red');
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load bank accounts from database:', err);
        const isMockMode = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        if (!isMockMode) {
          this.banks = [];
          this.showBanner('Failed to load company funding accounts from server.', 'red');
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

    persistFundingAccounts() {
      try {
        localStorage.setItem('hrflow_payroll_funding_accounts', JSON.stringify({
          externalId: this.selectedExternalAccountId,
          internalId: this.selectedInternalAccountId
        }));
      } catch (_) {}
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
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:24px;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(this.runsLoadError)}</td></tr>`;
        if (countEl) countEl.textContent = '0 runs';
        return;
      }

      const currentStatus = this.currentStatusKey();
      const statusMap = {
        draft: ['DRAFT', 'b-gray'],
        submitted: ['SUBMITTED', 'b-blue'],
        approved: ['APPROVED', 'b-blue'],
        finalized: ['FINALIZED', 'b-blue'],
        processing: ['PROCESSING', 'b-orange'],
        partially_paid: ['PARTIALLY PAID', 'b-orange'],
        paid: ['PAID', 'b-green']
      };
      const t = this.rollup();

      // A saved run for the current month is shown with its saved status and total;
      // the local draft row appears only when no run has been saved yet.
      const savedCurrent = (this.serverRuns || []).some(r => r.period_label === this.month);
      let rowsHtml = savedCurrent ? '' : `
        <tr class="clickable" onclick="PayrollApp.openRun('current')">
          <td data-label="Period"><strong>${this.month}</strong></td>
          <td data-label="Date range">${this.start} &rarr; ${this.end}</td>
          <td data-label="Status"><span class="p-badge ${statusMap[currentStatus] ? statusMap[currentStatus][1] : 'b-gray'}">${statusMap[currentStatus] ? statusMap[currentStatus][0] : 'DRAFT'}</span></td>
          <td data-label="Total Disbursement" class="payroll-num">${this.money(t.net)}</td>
          <td data-label="Employees">${this.rows.length}</td>
          <td data-label="Last updated">${this.audit[0] ? this.audit[0].when : '—'}</td>
        </tr>
      `;

      const pastRuns = this.serverRuns || [];
      pastRuns.forEach(r => {
        const sKey = (r.status || 'draft').toLowerCase();
        const sBadge = statusMap[sKey] || ['DRAFT', 'b-gray'];
        const netVal = r.total_net !== undefined ? r.total_net : (r.net || 0);
        const hc = r.headcount !== undefined ? r.headcount : (r.employees || (r.lines ? r.lines.length : 0));
        const upd = r.paid_at || r.updated_at || r.created_at || '—';
        const displayUpd = upd.length > 16 ? upd.slice(0, 16).replace('T', ' ') : upd;
        let statBadgeHtml = '';
        if (sKey === 'paid' || sKey === 'partially_paid') {
          const obls = (this.allObligations || []).filter(o =>
            (r.id !== undefined && r.id !== null && (o.source_id === r.id || String(o.source_id) === String(r.id))) ||
            (o.notes && o.notes.includes('payroll_run_id:' + r.id)) ||
            (r.period_label && o.period === r.period_label)
          );
          const resolved = this.resolvePayrollRunState(r, obls);
          if (resolved && resolved.badge) {
            statBadgeHtml = ` <span class="p-badge ${resolved.badgeClass}" style="margin-left:4px; font-size:0.72rem;">${resolved.badge}</span>`;
          }
        }

        rowsHtml += `
          <tr class="clickable" onclick="PayrollApp.openRun('${r.id || r.period_label}')">
            <td data-label="Period"><strong>${escapeHtml(r.period_label)}</strong></td>
            <td data-label="Date range">${r.period_start || (r.period_label + '-01')} &rarr; ${r.period_end || (r.period_label + '-30')}</td>
            <td data-label="Status"><span class="p-badge ${sBadge[1]}">${sBadge[0]}</span>${statBadgeHtml}</td>
            <td data-label="Total Disbursement" class="payroll-num">${this.money(netVal)}</td>
            <td data-label="Employees">${hc}</td>
            <td data-label="Last updated">${displayUpd}</td>
          </tr>
        `;
      });

      tbody.innerHTML = rowsHtml;
      if (countEl) countEl.textContent = `${(savedCurrent ? 0 : 1) + pastRuns.length} runs total`;
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
          return { stepIndex: 4, screen: 5, badge: 'Not Recorded', badgeClass: 'b-gray' };
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
    },

    drawStepper() {
      const container = document.getElementById('payrollStepper');
      if (!container) return;
      const doneThrough = this.completedThroughIndex();

      const stepNames = FLOW.map((k, i) => (STEP_META[k] ? STEP_META[k].label : `${i + 1}. Step`));
      const compact = `
        <div class="payroll-step-compact">
          <strong>Step ${this.stepIndex + 1} of ${FLOW.length}</strong>
          <select id="payrollStepSelect" aria-label="Go to step" onchange="PayrollApp.setStep(Number(this.value))">
            ${stepNames.map((n, i) => `<option value="${i}" ${i === this.stepIndex ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          </select>
        </div>`;
      container.innerHTML = compact + FLOW.map((stepKey, idx) => {
        const meta = STEP_META[stepKey] || { label: `${idx + 1}. Step` };
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
            this.showBanner('Payroll run finalized and locked. Backend snapshots populated.', 'blue');
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
        if (idx >= 2 || this.isRunLocked()) {
          lockNote.classList.remove('payroll-hidden');
          lockText.textContent = 'This payroll cycle has been finalized. Base compensation and dynamic additions are locked against edits.';
        } else {
          lockNote.classList.add('payroll-hidden');
        }
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
        extSelect.innerHTML = (this.banks || []).map(b => `<option value="${b.id}" ${String(b.id) === String(this.selectedExternalAccountId) ? 'selected' : ''}>${b.name} (${b.currency} ${b.number})</option>`).join('');
      }
      if (intSelect) {
        intSelect.innerHTML = (this.banks || []).map(b => `<option value="${b.id}" ${String(b.id) === String(this.selectedInternalAccountId) ? 'selected' : ''}>${b.name} (${b.currency} ${b.number})</option>`).join('');
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

    onScreen1AccountChange() {
      const ext = document.getElementById('p1ExtAccount');
      const intAcc = document.getElementById('p1IntAccount');
      if (ext) this.selectedExternalAccountId = ext.value;
      if (intAcc) this.selectedInternalAccountId = intAcc.value;
      this.persistFundingAccounts();
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
      this.showBanner(`FX conversion rate updated: ${this.resolvedFxRate.toFixed(4)} USD/EGP.`, 'blue');
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
      this.onScreen1AccountChange();
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
    drawScreen2() {
      this.drawStats();
      this.drawTable();
      const p2ApproveBtn = document.getElementById('btnP2Approve');
      if (p2ApproveBtn) {
        const status = (this.currentRun && this.currentRun.status) || 'draft';
        const awaitingApproval = status === 'submitted';
        const allowed = awaitingApproval ? this.canPermission('finance.payroll.approve') : this.canPermission('finance.payroll.prepare');
        p2ApproveBtn.innerHTML = awaitingApproval
          ? 'Approve <i class="fa-solid fa-check"></i>'
          : 'Submit for approval <i class="fa-solid fa-paper-plane"></i>';
        p2ApproveBtn.style.display = allowed ? '' : 'none';
        const selfRow = document.getElementById('p2SelfApproveRow');
        if (selfRow) {
          selfRow.hidden = !(awaitingApproval && this.canSelfApprove());
          if (selfRow.hidden) { const box = document.getElementById('p2SelfApprove'); if (box) box.checked = false; }
        }
        const hint = document.getElementById('p2ApprovalHint');
        if (hint) {
          hint.textContent = awaitingApproval
            ? (allowed ? 'Step 2 of 2: approve this run. Approval by someone other than the submitter is expected.' : 'Submitted. Waiting for an approver.')
            : (allowed ? 'Step 1 of 2: submit this run for approval.' : 'You can review this run but not submit it.');
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
        const bonusBadges = (r.bonuses || []).map((b, bIdx) => `
          <span class="chip p-bonus-pill" style="display:inline-flex; align-items:center; gap:4px;">
            <span>${b.type || 'Bonus'} $${Number(b.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${(b.source || 'int').toUpperCase()}</span>
            <button type="button" onclick="PayrollApp.deleteBonus(${r.id}, ${bIdx}, ${b.id ? `'${b.id}'` : 'null'})" style="border:none; background:transparent; color:#ef4444; cursor:pointer; padding:0 2px; font-weight:800; font-size:12px; line-height:1;" title="Remove">&times;</button>
          </span>
        `).join('');

        rowsHtml += `
          <tr>
            <td class="col-id payroll-id-th" data-label="ID">${r.id}</td>
            <td class="payroll-name-th">
              <div class="tname">
                <span class="avatar">${inits}</span>
                <a class="payroll-emp-link" href="${Router.hrefFor('a-employee-detail', 'admin').replace(/\/?$/, '')}/${encodeURIComponent(r.id)}" data-action="open-employee-profile" data-employee-id="${escapeHtml(r.id)}"><strong>${escapeHtml(r.name)}</strong></a>
              </div>
            </td>
            <td class="num payroll-num" data-label="Base Ext">${this.money(r.baseExt)}</td>
            <td class="num payroll-num" data-label="Base Int">${this.money(r.baseInt)}</td>
            <td class="num payroll-num" data-label="Bonus / Commission">
              ${bonusBadges || '<span class="muted" style="color:var(--text3); font-weight:600;">—</span>'}
            </td>
            <td class="num payroll-num strong" data-label="Total comp (gross)">${this.money(r.baseExt + r.baseInt + c.bonusTotal)}</td>
            <td class="col-actions" style="text-align:center;">
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
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.createPayrollRun === 'function') {
          const run = await FinanceApi.createPayrollRun({
            period_label: this.month,
            period_start: this.start,
            period_end: this.end,
            payment_date: this.payDate,
            bank_account_id: Number(this.selectedExternalAccountId || 1),
            external_funding_account_id: Number(this.selectedExternalAccountId || 1),
            internal_funding_account_id: Number(this.selectedInternalAccountId || 2),
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
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.createPayrollRun === 'function') {
            this.currentRun = await FinanceApi.createPayrollRun({
              period_label: this.month,
              period_start: this.start,
              period_end: this.end,
              payment_date: this.payDate,
              bank_account_id: Number(this.selectedExternalAccountId || 1),
              external_funding_account_id: Number(this.selectedExternalAccountId || 1),
              internal_funding_account_id: Number(this.selectedInternalAccountId || 2),
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
      let totEmpSi = 0, totEmprSi = 0, totSi = 0, totTax = 0, totNetEgp = 0, totNetUsd = 0;

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
          const empSi = Number(l.employee_social_insurance_egp || 0);
          const emprSi = Number(l.employer_social_insurance_egp || 0);
          const tSi = Number(l.total_social_insurance_egp || (empSi + emprSi));
          const tax = Number(l.employee_tax_egp || 0);
          const netEgp = Number(l.final_internal_net_egp || 0);
          const netUsd = Number(l.net_pay || l.amount || (netEgp / rate));

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
              <td class="col-id payroll-id-th">${l.employee_id}</td>
              <td class="payroll-name-th">
                <div class="tname">
                  <span class="avatar">${inits}</span>
                  <strong>${empName}</strong>
                </div>
              </td>
              <td class="num payroll-num">${Number(l.insured_base_egp_snapshot || 0).toFixed(2)}</td>
              <td class="num payroll-num">${empSi.toFixed(2)}</td>
              <td class="num payroll-num">${emprSi.toFixed(2)}</td>
              <td class="num payroll-num" style="font-weight:700;">${tSi.toFixed(2)}</td>
              <td class="num payroll-num" style="font-weight:700;">${tax.toFixed(2)}</td>
              <td class="num payroll-num strong accent" style="font-weight:800; color:var(--accent-text);">${this.money(netUsd)}</td>
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

          totEmpSi += empSi;
          totEmprSi += emprSi;
          totSi += tSi;
          totTax += tax;
          totNetEgp += netEgp;
          totNetUsd += netUsd;

          const inits = this.getInitials(r.name);

          rowsHtml += `
            <tr>
              <td class="col-id payroll-id-th">${r.id}</td>
              <td class="payroll-name-th">
                <div class="tname">
                  <span class="avatar">${inits}</span>
                  <strong>${r.name}</strong>
                </div>
              </td>
              <td class="num payroll-num">${insuredEgp.toFixed(2)}</td>
              <td class="num payroll-num">${empSi.toFixed(2)}</td>
              <td class="num payroll-num">${emprSi.toFixed(2)}</td>
              <td class="num payroll-num" style="font-weight:700;">${tSi.toFixed(2)}</td>
              <td class="num payroll-num" style="font-weight:700;">${tax.toFixed(2)}</td>
              <td class="num payroll-num strong accent" style="font-weight:800; color:var(--accent-text);">${this.money(netUsd)}</td>
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

      if (p3Emp) p3Emp.textContent = totEmpSi.toFixed(2) + ' EGP';
      if (p3Empr) p3Empr.textContent = totEmprSi.toFixed(2) + ' EGP';
      if (p3Si) p3Si.textContent = totSi.toFixed(2) + ' EGP';
      if (p3Tax) p3Tax.textContent = totTax.toFixed(2) + ' EGP';
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
        if (isMissingBank) {
          bankBadgeHtml = `<a class="pill-danger badge-pill p-badge b-amber payroll-missing-bank-link" style="font-size:0.75rem;" href="${Router.hrefFor('a-employee-detail', 'admin')}/${encodeURIComponent(r.id)}/bank" data-action="open-employee-bank" data-employee-id="${escapeHtml(r.id)}" title="Open this employee's bank section"><i class="fa-solid fa-triangle-exclamation"></i> Missing bank details</a>`;
        } else if (hasExternal) {
          const bankDisplay = (r.bank_name ? `${escapeHtml(r.bank_name)} ${escapeHtml(r.bank_account_masked || '')}` : 'Bank details on file');
          bankBadgeHtml = `<span class="p-badge b-gray badge-pill" style="font-size:0.75rem;"><i class="fa-solid fa-building-columns"></i> ${bankDisplay}</span>`;
        } else {
          bankBadgeHtml = `<span class="p-badge b-gray badge-pill" style="font-size:0.75rem;"><i class="fa-solid fa-building-columns"></i> None (Internal only)</span>`;
        }

        const inits = this.getInitials(r.name);

        rowsHtml += `
          <tr class="${isMissingBank ? 'warnrow' : ''}">
            <td class="col-id payroll-id-th" data-label="ID">${r.id}</td>
            <td class="payroll-name-th">
              <div class="tname">
                <span class="avatar">${inits}</span>
                <a class="payroll-emp-link" href="${Router.hrefFor('a-employee-detail', 'admin').replace(/\/?$/, '')}/${encodeURIComponent(r.id)}" data-action="open-employee-profile" data-employee-id="${escapeHtml(r.id)}"><strong>${escapeHtml(r.name)}</strong></a>
              </div>
            </td>
            <td data-label="Bank / Routing">${bankBadgeHtml}</td>
            <td class="num payroll-num" data-label="External (USD)">${this.money(extVal)}</td>
            <td class="num payroll-num" data-label="Internal (USD)">${this.money(intVal)}</td>
            <td class="num payroll-num strong accent" data-label="Total Disbursement" style="font-weight:800; color:var(--accent-text);">${this.money(netVal)}</td>
          </tr>
        `;
      });
      tbody.innerHTML = rowsHtml;

      if (bMissing) {
        bMissing.textContent = missingBankCount;
        bMissing.style.color = missingBankCount > 0 ? 'var(--warning, #e07d10)' : 'var(--text2, #7a8ea8)';
      }

      const recSub = document.getElementById('p4RecipientsSub');
      if (recSub) {
        recSub.textContent = missingBankCount > 0 ? `${missingBankCount} missing bank details` : 'All recipients ready';
        if (missingBankCount > 0) recSub.style.color = 'var(--warning, #e07d10)';
      }

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

      const extBankName = (this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId)) || {}).name || 'Operating Bank Wire Account';
      const intBankName = (this.banks.find(b => String(b.id) === String(this.selectedInternalAccountId)) || {}).name || 'Treasury Cash Vault';

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
      if (p5ExtDate) p5ExtDate.textContent = this.payDate;

      if (p5IntTot) p5IntTot.textContent = this.money(intTotal);
      if (p5IntAcc) p5IntAcc.textContent = intBankName;
      if (p5IntRec) p5IntRec.textContent = 'Internal salaries';
      if (p5IntRecCount) p5IntRecCount.textContent = `${intRecipients} employee${intRecipients === 1 ? '' : 's'}`;
      if (p5IntDate) p5IntDate.textContent = this.payDate;

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
          const missingHtml = missingBankExc.length
            ? alertHtml(true, 'Warning', `bank details missing for ${missingBankExc.length} employee${missingBankExc.length === 1 ? '' : 's'}. Payment can still be recorded.`)
            : '';
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
          btnDisburse.disabled = true;
          btnDisburse.innerHTML = '<i class="fa-solid fa-check"></i> Recorded as paid';
        }
        this.drawDisburseResults();
        this.drawJournalRows();
      } else {
        if (resCard) resCard.classList.add('payroll-hidden');
        if (jCard) jCard.classList.add('payroll-hidden');
        if (btnDisburse) {
          btnDisburse.disabled = false;
          btnDisburse.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Confirm and record as paid';
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
      const confirmed = await FinanceCommand.confirmAction({
        title: 'Record payroll as paid',
        consequence: `Record ${this.money(totals.net)} as paid to ${recipients} employee${recipients === 1 ? '' : 's'} for ${this.month}. `
          + `${missing} ${missing === 1 ? 'employee has' : 'employees have'} missing bank details. `
          + 'This posts the payroll journal and cannot be undone from here.',
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

    // Disable the confirm button, with an explanation, until the run is finalized.
    applyConfirmState() {
      const btn = document.getElementById('btnP5ConfirmDisburse');
      const hint = document.getElementById('p5ConfirmHint');
      if (!btn) return;
      const status = this.currentRun && this.currentRun.status;
      const paid = status === 'paid';
      const ready = ['finalized', 'processing', 'partially_paid'].includes(status);
      if (!paid) btn.disabled = !ready;
      if (hint) {
        hint.hidden = ready || paid;
        hint.textContent = ready || paid ? '' : 'Payment can be recorded once the run is approved and finalized.';
      }
    },

    drawDisburseResults() {
      const tbody = document.getElementById('payrollDisburseResultsTableBody');
      if (!tbody) return;

      const lines = (this.currentRun && this.currentRun.lines) || [];
      if (lines.length > 0) {
        tbody.innerHTML = lines.map(l => {
          const empName = l.employee_name || `Employee #${l.employee_id}`;
          const inits = this.getInitials(empName);
          const isWarn = l.payment_status === 'flagged' || l.missing_bank || (l.failure_reason && l.failure_reason.includes('bank'));
          const badgeClass = isWarn ? 'pill-warning' : 'pill-success';
          const badgeText = isWarn ? 'Flagged — no bank' : (l.payment_status ? l.payment_status.charAt(0).toUpperCase() + l.payment_status.slice(1) : 'Paid');
          const paidAt = l.paid_at ? l.paid_at.slice(0, 16).replace('T', ' ') : this.nowStamp();
          const notes = l.failure_reason || (isWarn ? 'Manual or cash settlement pending; bank details missing.' : 'Settled via configured funding accounts.');

          return `
            <tr class="${isWarn ? 'warnrow' : ''}">
              <td class="tname"><span class="avatar">${inits}</span>${empName}</td>
              <td class="num payroll-num" style="font-weight:700;">${this.money(l.net_pay || l.amount)}</td>
              <td><span class="${badgeClass} badge-pill">${badgeText}</span></td>
              <td>${paidAt}</td>
              <td class="muted">${notes}</td>
            </tr>
          `;
        }).join('');
      } else {
        tbody.innerHTML = (this.rows || []).map(r => {
          const c = this.computeRow(r);
          const inits = this.getInitials(r.name);
          const isWarn = r.missingBank || !r.hasBank;
          const badgeClass = isWarn ? 'pill-warning' : 'pill-success';
          const badgeText = isWarn ? 'Flagged — no bank' : 'Paid';
          const notes = isWarn ? 'Manual or cash settlement pending; bank details missing.' : 'Settled via configured funding accounts.';

          return `
            <tr class="${isWarn ? 'warnrow' : ''}">
              <td class="tname"><span class="avatar">${inits}</span>${r.name}</td>
              <td class="num payroll-num" style="font-weight:700;">${this.money(c.net)}</td>
              <td><span class="${badgeClass} badge-pill">${badgeText}</span></td>
              <td>${this.nowStamp()}</td>
              <td class="muted">${notes}</td>
            </tr>
          `;
        }).join('');
      }
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

      const bankOptionsHtml = (this.banks || []).map(b => `<option value="${b.id}" ${String(b.id) === String(this.selectedExternalAccountId) ? 'selected' : ''}>${b.name} (${b.currency} ${b.number})</option>`).join('');
      if (siAccountSelect) siAccountSelect.innerHTML = bankOptionsHtml;
      if (taxAccountSelect) taxAccountSelect.innerHTML = bankOptionsHtml;

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
        varEl.style.color = diff !== 0 ? (diff > 0 ? '#b91c1c' : '#15803d') : '#64748b';
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
        varEl.style.color = diff !== 0 ? (diff > 0 ? '#b91c1c' : '#15803d') : '#64748b';
      }
    },

    async loadLinkedStatutoryObligations() {
      const tbody = document.getElementById('payrollStatutoryRecordsTableBody');
      if (!tbody) return;

      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.listStatutoryObligations === 'function') {
          const list = await FinanceApi.listStatutoryObligations({ period: this.month });
          const runTag = `payroll_run_id:${this.currentRun ? this.currentRun.id : ''}`;
          const linked = (list || []).filter(o => (o.notes && o.notes.includes(runTag)) || o.period === this.month);

          if (linked.length > 0) {
            tbody.innerHTML = linked.map(o => `
              <tr>
                <td><strong>#${o.id}</strong></td>
                <td>${o.obligation_type}</td>
                <td>${o.period}</td>
                <td class="num payroll-num">${Number(o.amount_accrued).toFixed(2)} ${o.currency}</td>
                <td class="num payroll-num">${Number(o.amount_remitted || 0).toFixed(2)} ${o.currency}</td>
                <td><span class="pill-${o.status === 'remitted' ? 'success' : 'info'} badge-pill">${(o.status || 'accrued').toUpperCase()}</span></td>
                <td><span style="font-size:0.75rem; color:#64748b;">${o.notes || '—'}</span></td>
              </tr>
            `).join('');

            // Update badge & settle buttons
            const siObl = linked.find(o => o.obligation_type.includes('social_insurance'));
            const taxObl = linked.find(o => o.obligation_type.includes('income_tax'));

            const siBadge = document.getElementById('p6SiStatusBadge');
            const taxBadge = document.getElementById('p6TaxStatusBadge');
            const btnSettleSi = document.getElementById('btnP6SettleSocialIns');
            const btnSettleTax = document.getElementById('btnP6SettleTax');
            const siPayStage = document.getElementById('p6SiPayStage');
            const taxPayStage = document.getElementById('p6TaxPayStage');

            if (siObl) {
              if (siBadge) {
                const isRemitted = siObl.status === 'remitted';
                siBadge.textContent = isRemitted ? 'Remitted' : 'Recorded';
                siBadge.className = `stage-badge ${isRemitted ? 'settled' : 'recorded'}`;
              }
              if (siPayStage) siPayStage.classList.remove('locked');
              if (btnSettleSi) {
                btnSettleSi.disabled = siObl.status === 'remitted';
                btnSettleSi.setAttribute('data-obl-id', siObl.id);
              }
            } else {
              if (siBadge) {
                siBadge.textContent = 'Unrecorded';
                siBadge.className = 'stage-badge unrecorded';
              }
              if (siPayStage) siPayStage.classList.add('locked');
              if (btnSettleSi) btnSettleSi.disabled = true;
            }

            if (taxObl) {
              if (taxBadge) {
                const isRemitted = taxObl.status === 'remitted';
                taxBadge.textContent = isRemitted ? 'Remitted' : 'Recorded';
                taxBadge.className = `stage-badge ${isRemitted ? 'settled' : 'recorded'}`;
              }
              if (taxPayStage) taxPayStage.classList.remove('locked');
              if (btnSettleTax) {
                btnSettleTax.disabled = taxObl.status === 'remitted';
                btnSettleTax.setAttribute('data-obl-id', taxObl.id);
              }
            } else {
              if (taxBadge) {
                taxBadge.textContent = 'Unrecorded';
                taxBadge.className = 'stage-badge unrecorded';
              }
              if (taxPayStage) taxPayStage.classList.add('locked');
              if (btnSettleTax) btnSettleTax.disabled = true;
            }

            const resolved = this.resolvePayrollRunState(this.currentRun, linked);
            this.renderStatutoryBadge(resolved.badge, resolved.badgeClass);
            return;
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load statutory obligations:', err);
      }

      if (this.currentRun && (this.currentRun.status === 'paid' || this.currentRun.status === 'partially_paid')) {
        this.renderStatutoryBadge('Not Recorded', 'b-gray');
      }
      const siBadge = document.getElementById('p6SiStatusBadge');
      const taxBadge = document.getElementById('p6TaxStatusBadge');
      const siPayStage = document.getElementById('p6SiPayStage');
      const taxPayStage = document.getElementById('p6TaxPayStage');
      if (siBadge) { siBadge.textContent = 'Unrecorded'; siBadge.className = 'stage-badge unrecorded'; }
      if (taxBadge) { taxBadge.textContent = 'Unrecorded'; taxBadge.className = 'stage-badge unrecorded'; }
      if (siPayStage) siPayStage.classList.add('locked');
      if (taxPayStage) taxPayStage.classList.add('locked');
      tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:16px;">No statutory obligations recorded yet for this payroll run.</td></tr>';
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

    async settleStatutory(type) {
      const isSi = type === 'si';
      const btn = document.getElementById(isSi ? 'btnP6SettleSocialIns' : 'btnP6SettleTax');
      const oblId = btn ? btn.getAttribute('data-obl-id') : null;
      if (!oblId) return;

      const accountSelect = document.getElementById(isSi ? 'p6SiDebitAccount' : 'p6TaxDebitAccount');
      const dateInput = document.getElementById(isSi ? 'p6SiPaymentDate' : 'p6TaxPaymentDate');

      const bankAccountId = (accountSelect && accountSelect.value) ? Number(accountSelect.value) : Number(this.selectedExternalAccountId || 1);
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
            bank_account_id: this.selectedExternalAccountId || 1,
            external_funding_account_id: this.selectedExternalAccountId || 1,
            internal_funding_account_id: this.selectedInternalAccountId || 2,
            fx_rate_source: this.fxRateValue ? 'manual' : (this.fxRateSource || 'first_of_month'),
            fx_rate_value: this.fxRateValue ? Number(this.fxRateValue) : null
          });
        }

        if (preview) {
          this.currentPreview = preview;
          if (preview.fx_rate_value !== undefined && preview.fx_rate_value !== null) {
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
      }
    },

    async loadSettingsFromDb() {
      try {
        if (typeof FinanceApi !== 'undefined' && FinanceApi.getPayrollSettings) {
          const settings = await FinanceApi.getPayrollSettings();
          if (settings) {
            if (settings.employee_rate !== undefined) this.employeeInsuranceRate = Number(settings.employee_rate);
            if (settings.employer_rate !== undefined) this.employerInsuranceRate = Number(settings.employer_rate);
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load payroll settings:', err);
      }
    },

    drawFxRate() {
      const rateEl = document.getElementById('payrollFxRateBadge');
      const srcEl = document.getElementById('payrollFxRateSourceBadge');
      const inputEl = document.getElementById('payrollFxRateInput');
      const p1Input = document.getElementById('p1FxRateInput');

      const rateNum = Number(this.resolvedFxRate || 50.0);
      const isManual = this.fxRateValue !== null && this.fxRateValue !== undefined && Number(this.fxRateValue) > 0;
      const isFallback = !isManual && (this.resolvedFxSource === 'fallback' || rateNum === 50.0);

      if (rateEl) rateEl.textContent = rateNum.toFixed(4);
      if (srcEl) {
        if (isManual) {
          srcEl.textContent = 'Manual Override';
          srcEl.className = 'p-badge b-blue';
        } else if (isFallback) {
          srcEl.textContent = 'System Fallback (50.0)';
          srcEl.className = 'p-badge b-gray';
        } else {
          srcEl.textContent = 'Resolved from Transfer History';
          srcEl.className = 'p-badge b-green';
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

    drawPeriodLabel() {
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
      const statusMap = {
        draft: ['DRAFT', 'b-gray'],
        submitted: ['SUBMITTED', 'b-blue'],
        approved: ['APPROVED', 'b-blue'],
        finalized: ['FINALIZED', 'b-blue'],
        processing: ['PROCESSING', 'b-orange'],
        partially_paid: ['PARTIALLY PAID', 'b-orange'],
        paid: ['PAID', 'b-green']
      };
      const info = statusMap[key] || ['DRAFT', 'b-gray'];
      badge.textContent = info[0];
      badge.className = `p-badge ${info[1]}`;
    },

    drawFundingAccounts() {
      const selExt = document.getElementById('payrollTargetExternalAccount');
      const selInt = document.getElementById('payrollTargetInternalAccount');
      const formatOpt = (b, selectedId) => {
        let numStr = (b.number || '').trim();
        let masked = numStr;
        if (typeof FinanceFormat !== 'undefined' && typeof FinanceFormat.formatMaskedAccountNumber === 'function') {
          masked = FinanceFormat.formatMaskedAccountNumber(numStr);
        } else if (numStr.length > 4) {
          masked = `•••• ${numStr.slice(-4)}`;
        }
        const isSel = String(b.id) === String(selectedId) ? 'selected' : '';
        return `<option value="${b.id}" ${isSel}>${b.name} (${b.currency} ${masked})</option>`;
      };
      if (selExt) {
        selExt.innerHTML = this.banks.map(b => formatOpt(b, this.selectedExternalAccountId)).join('');
      }
      if (selInt) {
        selInt.innerHTML = this.banks.map(b => formatOpt(b, this.selectedInternalAccountId)).join('');
      }
    },

    setFundingAccount(type, id) {
      if (type === 'external') this.selectedExternalAccountId = id;
      else if (type === 'internal') this.selectedInternalAccountId = id;
      this.persistFundingAccounts();
      this.drawPeriodLabel();
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
      if (empRateEl && emprRateEl && typeof FinanceApi !== 'undefined' && typeof FinanceApi.updatePayrollSettings === 'function') {
        const empRate = parseFloat(empRateEl.value) / 100.0;
        const emprRate = parseFloat(emprRateEl.value) / 100.0;
        if (!isNaN(empRate) && !isNaN(emprRate)) {
          try {
            await FinanceApi.updatePayrollSettings({ employee_rate: empRate, employer_rate: emprRate });
            this.employeeInsuranceRate = empRate;
            this.employerInsuranceRate = emprRate;
          } catch (err) {
            console.warn('[PayrollApp] Could not update SI settings:', err);
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
      this.persistFundingAccounts();
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

      if (page === 'list') {
        this.drawRunsList();
      } else if (page === 'run') {
        this.redraw();
      } else if (page === 'settings') {
        this.loadBankAccountsFromDb();
        this.drawFundingAccounts();
        const setFxInput = document.getElementById('payrollSetFxRate');
        if (setFxInput) setFxInput.value = this.fxRateValue || '';

        // Populate Social Insurance rates
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getPayrollSettings === 'function') {
          FinanceApi.getPayrollSettings().then(st => {
            if (st) {
              const empEl = document.getElementById('payrollEmployeeInsuranceRate');
              const emprEl = document.getElementById('payrollEmployerInsuranceRate');
              if (empEl && st.employee_rate !== undefined) empEl.value = (st.employee_rate * 100).toFixed(2);
              if (emprEl && st.employer_rate !== undefined) emprEl.value = (st.employer_rate * 100).toFixed(2);
            }
          }).catch(e => console.warn('[PayrollApp] Could not load SI settings:', e));
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

    openRevertModal() {
      const reason = document.getElementById('payrollRevertReason');
      if (reason) reason.value = '';
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
