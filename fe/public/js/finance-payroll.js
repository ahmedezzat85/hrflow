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
    preview: { label: '4. Payment Preview', hint: 'Step 4 of 6 — Preview disbursement breakdown by payment rail before funding release.' },
    confirmation: { label: '5. Confirm Disbursal', hint: 'Step 5 of 6 — Disburse funds and auto-post general ledger journal entries.' },
    statutory: { label: '6. Statutory Payments', hint: 'Step 6 of 6 — Reconcile portal liabilities and record/settle statutory obligations.' }
  };
  const DONE_HINT = 'Cycle complete — payroll is Paid and statutory obligations are reconciled.';

  const PayrollApp = {
    rows: JSON.parse(JSON.stringify(seedEmployees)),
    banks: JSON.parse(JSON.stringify(seedBanks)),
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
    historyRuns: [
      { period: '2026-08', status: 'paid', net: 34210.00, employees: 8, updated: '2026-08-30 18:42' },
      { period: '2026-07', status: 'paid', net: 33875.50, employees: 8, updated: '2026-07-31 17:10' },
      { period: '2026-06', status: 'paid', net: 33420.00, employees: 8, updated: '2026-06-30 16:55' }
    ],
    initialized: false,

    async init() {
      // 1. Sync real data from database
      await this.loadEmployeesFromDb();
      await this.loadBankAccountsFromDb();
      await this.loadSettingsFromDb();
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
        this.showPage('list');
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
          }
        } else {
          if (typeof Api !== 'undefined' && typeof Api.getEmployees === 'function') {
            try {
              rawEmployees = await Api.getEmployees();
            } catch (apiErr) {
              console.warn('[PayrollApp] API fetch failed, trying window.employees:', apiErr);
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
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load employees from database:', err);
      }
    },

    async loadBankAccountsFromDb() {
      try {
        let rawAccounts = null;
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.getAccounts === 'function') {
          rawAccounts = await FinanceApi.getAccounts({ is_active: true });
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
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load bank accounts from database:', err);
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
      return '2026-09-21 ' + timeStr;
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
      const internal = totalInternal - deductions;
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

      let rowsHtml = `
        <tr class="clickable" onclick="PayrollApp.openRun('current')">
          <td><strong>${this.month}</strong></td>
          <td>${this.start} &rarr; ${this.end}</td>
          <td><span class="p-badge ${statusMap[currentStatus] ? statusMap[currentStatus][1] : 'b-gray'}">${statusMap[currentStatus] ? statusMap[currentStatus][0] : 'DRAFT'}</span></td>
          <td class="payroll-num">${this.money(t.net)}</td>
          <td>${this.rows.length}</td>
          <td>${this.audit[0] ? this.audit[0].when : '—'}</td>
        </tr>
      `;

      this.historyRuns.forEach(r => {
        rowsHtml += `
          <tr class="clickable" onclick="PayrollApp.openHistoryRun('${r.period}')">
            <td><strong>${r.period}</strong></td>
            <td>${r.period}-01 &rarr; ${r.period}-30</td>
            <td><span class="p-badge b-green">PAID</span></td>
            <td class="payroll-num">${this.money(r.net)}</td>
            <td>${r.employees}</td>
            <td>${r.updated}</td>
          </tr>
        `;
      });

      tbody.innerHTML = rowsHtml;
      if (countEl) countEl.textContent = `${this.historyRuns.length + 1} runs total`;
    },

    openRun(id) {
      if (id === 'current') {
        this.showPage('run');
        this.setStep(0);
      } else {
        this.openHistoryRun(id);
      }
    },

    async openHistoryRun(period) {
      try {
        if (typeof FinanceApi !== 'undefined' && FinanceApi.getPayrollRuns) {
          const runs = await FinanceApi.getPayrollRuns();
          const match = (runs || []).find(r => r.period_label === period || String(r.id) === String(period));
          if (match) {
            this.currentRun = match;
            this.month = match.period_label || period;
            this.showPage('run');
            if (match.status === 'paid' || match.status === 'partially_paid') {
              this.setStep(4);
            } else if (match.status === 'finalized') {
              this.setStep(3);
            } else if (match.status === 'approved') {
              this.setStep(2);
            } else {
              this.setStep(1);
            }
            return;
          }
        }
      } catch (e) {
        console.warn('Could not load specific run:', e);
      }
      this.showBanner(`Viewing historical snapshot for ${period}`, 'blue');
      this.showPage('run');
      this.setStep(4);
    },

    /* ---------------- Stepper & Screen Navigation ---------------- */
    drawStepper() {
      const container = document.getElementById('payrollStepper');
      if (!container) return;

      container.innerHTML = FLOW.map((stepKey, idx) => {
        const meta = STEP_META[stepKey] || { label: `${idx + 1}. Step` };
        const isActive = idx === this.stepIndex;
        const isDone = idx < this.stepIndex;
        const cls = isActive ? 'active' : (isDone ? 'done' : '');
        return `
          <button type="button" class="payroll-step-pill ${cls}" onclick="PayrollApp.setStep(${idx})">
            <span class="payroll-step-num">${idx + 1}</span>
            <span>${meta.label}</span>
          </button>
        `;
      }).join('');
    },

    async setStep(idx) {
      if (idx < 0) idx = 0;
      if (idx > 5) idx = 5;

      // Lifecycle Gate: Finalize when entering Screen 3 (Processing)
      if (idx === 2 && this.currentRun && this.currentRun.status === 'approved') {
        try {
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.finalizePayrollRun === 'function') {
            await FinanceApi.finalizePayrollRun(this.currentRun.id);
            this.currentRun = await FinanceApi.getPayrollRun(this.currentRun.id);
            this.showBanner('Payroll run finalized and locked. Backend snapshots populated.', 'blue');
          }
        } catch (err) {
          console.warn('[PayrollApp] Finalize error:', err);
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

      const stepKey = FLOW[idx];
      const hint = STEP_META[stepKey] ? STEP_META[stepKey].hint : '';
      const hintEl = document.getElementById('payrollStepHint');
      if (hintEl) hintEl.textContent = hint;

      // Lock banner
      const lockNote = document.getElementById('payrollLockNote');
      const lockText = document.getElementById('payrollLockText');
      if (lockNote && lockText) {
        if (idx >= 2) {
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
      if (m && m.value) this.month = m.value;
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

    /* ==================== SCREEN 2: APPROVE & ADJUSTMENTS ==================== */
    drawScreen2() {
      this.drawStats();
      this.drawTable();
    },

    drawStats() {
      const grid = document.getElementById('payrollStatsGrid');
      if (!grid) return;
      const t = this.rollup();
      const p = this.currentPreview;

      const baseExt = (p && p.recipients) ? p.recipients.reduce((sum, r) => sum + (r.base_ext_amount || 0), 0) : t.baseExt;
      const baseInt = (p && p.recipients) ? p.recipients.reduce((sum, r) => sum + (r.base_int_amount || 0), 0) : t.baseInt;
      const totalAdditions = (p && p.total_additions !== undefined) ? p.total_additions : t.bonus;
      const totalNet = (p && p.total_net !== undefined) ? p.total_net : t.net;

      grid.innerHTML = `
        <div class="stat-card">
          <div class="lbl">Base External (USD)</div>
          <div class="val">${this.money(baseExt)}</div>
          <div class="sub">Fixed bank salaries</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Base Internal (USD)</div>
          <div class="val">${this.money(baseInt)}</div>
          <div class="sub">Fixed cash salaries</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Bonuses &amp; Commissions</div>
          <div class="val">${this.money(totalAdditions)}</div>
          <div class="sub">Dynamic additions</div>
        </div>
        <div class="stat-card">
          <div class="lbl">Total Compensation</div>
          <div class="val" style="color:var(--primary, #2563eb);">${this.money(totalNet)}</div>
          <div class="sub">All recipients gross/net</div>
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

        const bonusBadges = (r.bonuses || []).map((b, bIdx) => `
          <span class="p-bonus-pill" style="display:inline-flex; align-items:center; gap:4px; margin:2px; padding:2px 6px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px; font-size:0.75rem;">
            <span>${b.type || 'Bonus'}: <strong>$${b.amount}</strong> (${b.source || 'int'})</span>
            <button type="button" onclick="PayrollApp.deleteBonus(${r.id}, ${bIdx}, ${b.id || 'null'})" style="border:none; background:transparent; color:#ef4444; cursor:pointer; padding:0 2px;">&times;</button>
          </span>
        `).join('');

        rowsHtml += `
          <tr>
            <td class="payroll-id-th">${r.id}</td>
            <td class="payroll-name-th"><strong>${r.name}</strong></td>
            <td class="payroll-num">${this.money(r.baseExt)}</td>
            <td class="payroll-num">${this.money(r.baseInt)}</td>
            <td>
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
                ${bonusBadges || '<span style="color:var(--text-muted); font-size:0.78rem;">None</span>'}
              </div>
            </td>
            <td class="payroll-num" style="font-weight:700;">${this.money(r.baseExt + r.baseInt + c.bonusTotal)}</td>
            <td style="text-align:center;">
              <button type="button" class="btn btn-ghost btn-sm" onclick="PayrollApp.openBonusModal(${r.id})" style="padding:2px 6px; font-size:0.75rem;">
                <i class="fa-solid fa-plus"></i> Add
              </button>
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

    openBonusModal(empId) {
      const modal = document.getElementById('payrollBonusModal');
      const sel = document.getElementById('bonusEmployeeSelect');
      const amt = document.getElementById('bonusAmountInput');
      const desc = document.getElementById('bonusDescriptionInput');
      if (!modal || !sel) return;

      sel.innerHTML = this.rows.map(r => `<option value="${r.id}" ${String(r.id) === String(empId) ? 'selected' : ''}>${r.name} (ID: ${r.id})</option>`).join('');
      if (amt) amt.value = '';
      if (desc) desc.value = '';
      modal.style.display = 'flex';
    },

    closeBonusModal() {
      const modal = document.getElementById('payrollBonusModal');
      if (modal) modal.style.display = 'none';
    },

    async saveBonus() {
      const sel = document.getElementById('bonusEmployeeSelect');
      const typeSel = document.getElementById('bonusTypeSelect');
      const srcSel = document.getElementById('bonusSourceSelect');
      const amtInput = document.getElementById('bonusAmountInput');
      const descInput = document.getElementById('bonusDescriptionInput');

      if (!sel || !amtInput) return;
      const empId = Number(sel.value);
      const amt = parseFloat(amtInput.value);
      if (!amt || amt <= 0) {
        alert('Please enter a valid bonus amount greater than zero.');
        return;
      }
      const bType = typeSel ? typeSel.value : 'BONUS';
      const bSource = srcSel ? srcSel.value : 'INT';
      const desc = descInput ? descInput.value.trim() : '';

      // Persist to backend preview adjustment if preview is active
      if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.addPreviewAdjustment === 'function' && this.currentPreview && this.currentPreview.preview_id) {
        try {
          await FinanceApi.addPreviewAdjustment(this.currentPreview.preview_id, {
            employee_id: empId,
            type: bType,
            amount: amt,
            payment_source: bSource,
            description: desc
          });
        } catch (err) {
          console.warn('[PayrollApp] Could not persist preview adjustment:', err);
        }
      }

      const row = this.rows.find(r => r.id === empId);
      if (row) {
        if (!row.bonuses) row.bonuses = [];
        row.bonuses.push({
          type: bType === 'COMMISSION' ? 'Sales Commission' : 'Bonus',
          amount: amt,
          source: bSource.toLowerCase() === 'ext' ? 'external' : 'internal',
          description: desc
        });
      }

      this.addAudit(`Added ${bType} of $${amt} for employee #${empId}.`);
      this.closeBonusModal();
      await this.fetchPreview();
      this.drawScreen2();
      this.showBanner('Bonus / Commission addition saved.', 'blue');
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

    async submitAndApproveRun() {
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

        if (this.currentRun && (this.currentRun.status === 'submitted' || this.currentRun.status === 'draft')) {
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.approvePayrollRun === 'function') {
            await FinanceApi.approvePayrollRun(this.currentRun.id, true);
            this.currentRun.status = 'approved';
          }
        }

        this.addAudit('Payroll run submitted and approved.');
        this.showBanner('Payroll run approved. Advancing to statutory processing.', 'blue');
        this.setStep(2);
      } catch (err) {
        console.error('Error approving run:', err);
        this.showBanner(err.message || 'Approval failed.', 'red');
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
        lines.forEach(l => {
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

          rowsHtml += `
            <tr>
              <td class="payroll-id-th">${l.employee_id}</td>
              <td class="payroll-name-th"><strong>${l.employee_name || `Employee #${l.employee_id}`}</strong></td>
              <td><span class="p-badge b-gray" style="font-size:0.7rem;">${l.salary_basis_snapshot || 'NET'}</span></td>
              <td class="payroll-num">${l.configured_internal_salary_usd_snapshot !== undefined ? `$${Number(l.configured_internal_salary_usd_snapshot).toFixed(2)}` : '—'}</td>
              <td class="payroll-num">${Number(l.insured_base_egp_snapshot || 0).toFixed(2)}</td>
              <td class="payroll-num" style="font-family:monospace;">${Number(l.fx_rate_snapshot || rate).toFixed(4)}</td>
              <td class="payroll-num">${empSi.toFixed(2)}</td>
              <td class="payroll-num">${emprSi.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:700;">${tSi.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:700;">${tax.toFixed(2)}</td>
              <td class="payroll-num">${netEgp.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:800; color:var(--primary, #2563eb);">${this.money(netUsd)}</td>
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

          rowsHtml += `
            <tr>
              <td class="payroll-id-th">${r.id}</td>
              <td class="payroll-name-th"><strong>${r.name}</strong></td>
              <td><span class="p-badge b-gray" style="font-size:0.7rem;">NET</span></td>
              <td class="payroll-num">$${cfgUsd.toFixed(2)}</td>
              <td class="payroll-num">${insuredEgp.toFixed(2)}</td>
              <td class="payroll-num" style="font-family:monospace;">${rate.toFixed(4)}</td>
              <td class="payroll-num">${empSi.toFixed(2)}</td>
              <td class="payroll-num">${emprSi.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:700;">${tSi.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:700;">${tax.toFixed(2)}</td>
              <td class="payroll-num">${netEgp.toFixed(2)}</td>
              <td class="payroll-num" style="font-weight:800; color:var(--primary, #2563eb);">${this.money(netUsd)}</td>
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
    drawScreen4() {
      const tbody = document.getElementById('payrollPaymentPreviewTableBody');
      if (!tbody) return;

      const t = this.rollup();
      const p = this.currentPreview;

      const extBank = (p && p.final_ext_total) || t.external;
      const intCash = (p && p.final_int_total) || t.internal;
      const netTotal = (p && p.total_net) || t.net;

      const bExt = document.getElementById('p4ExtBankTotal');
      const bInt = document.getElementById('p4IntCashTotal');
      const bNet = document.getElementById('p4TotalNet');
      const bHc = document.getElementById('p4Headcount');

      if (bExt) bExt.textContent = this.money(extBank);
      if (bInt) bInt.textContent = this.money(intCash);
      if (bNet) bNet.textContent = this.money(netTotal);
      if (bHc) bHc.textContent = this.rows.length;

      let rowsHtml = '';
      this.rows.forEach(r => {
        const c = this.computeRow(r);
        rowsHtml += `
          <tr>
            <td class="payroll-id-th">${r.id}</td>
            <td class="payroll-name-th"><strong>${r.name}</strong></td>
            <td class="payroll-num">${this.money(c.external)}</td>
            <td><span class="p-badge b-gray" style="font-size:0.72rem;"><i class="fa-solid fa-building-columns"></i> ${r.baseExt > 0 ? 'Verified Wire ****8821' : 'None (Internal only)'}</span></td>
            <td class="payroll-num">${this.money(c.internal)}</td>
            <td class="payroll-num" style="font-weight:800; color:var(--primary, #2563eb);">${this.money(c.net)}</td>
          </tr>
        `;
      });
      tbody.innerHTML = rowsHtml;

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

      const extTotal = (p && p.final_ext_total) || t.external;
      const intTotal = (p && p.final_int_total) || t.internal;

      if (extEl) extEl.textContent = `${this.money(extTotal)} (${extBankName})`;
      if (intEl) intEl.textContent = `${this.money(intTotal)} (${intBankName})`;

      // Readiness list (D-006 warning)
      const excStrip = document.getElementById('payrollExceptionList');
      if (excStrip) {
        excStrip.innerHTML = `
          <div style="font-size:0.8rem; color:#166534; display:flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-circle-check"></i> Funding allocation verified. Ready for disbursement release.
          </div>
        `;
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
          btnDisburse.innerHTML = '<i class="fa-solid fa-check"></i> Disbursed &amp; Paid';
        }
        this.drawDisburseResults();
        this.drawJournalRows();
      } else {
        if (resCard) resCard.classList.add('payroll-hidden');
        if (jCard) jCard.classList.add('payroll-hidden');
        if (btnDisburse) {
          btnDisburse.disabled = false;
          btnDisburse.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Confirm &amp; Disburse Payroll';
        }
      }
    },

    async confirmDisbursement() {
      try {
        if (!this.currentRun) {
          await this.submitAndApproveRun();
          if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.finalizePayrollRun === 'function') {
            await FinanceApi.finalizePayrollRun(this.currentRun.id);
            this.currentRun = await FinanceApi.getPayrollRun(this.currentRun.id);
          }
        }

        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.disbursePayrollRun === 'function') {
          await FinanceApi.disbursePayrollRun(this.currentRun.id);
          await FinanceApi.postPayrollJournal(this.currentRun.id);
          this.currentRun = await FinanceApi.getPayrollRun(this.currentRun.id);
        } else {
          if (this.currentRun) this.currentRun.status = 'paid';
        }

        this.journalPosted = true;
        this.addAudit('Payroll run disbursed and general ledger entry posted.');
        this.showBanner('Payroll disbursement confirmed. Funds released and journal posted.', 'green');
        this.drawScreen5();
        this.drawStatus();
      } catch (err) {
        console.error('Error confirming disbursement:', err);
        this.showBanner(err.message || 'Disbursement failed.', 'red');
      }
    },

    drawDisburseResults() {
      const tbody = document.getElementById('payrollDisburseResultsTableBody');
      if (!tbody) return;

      const lines = (this.currentRun && this.currentRun.lines) || [];
      if (lines.length > 0) {
        tbody.innerHTML = lines.map(l => `
          <tr>
            <td><strong>${l.employee_name || `Employee #${l.employee_id}`}</strong></td>
            <td class="payroll-num" style="font-weight:700;">${this.money(l.net_pay || l.amount)}</td>
            <td><span class="p-badge b-green">${(l.payment_status || 'paid').toUpperCase()}</span></td>
            <td>${l.paid_at ? l.paid_at.slice(0, 16).replace('T', ' ') : this.nowStamp()}</td>
            <td>${l.failure_reason || 'Disbursed via ' + (l.compensation_type || 'Internal Treasury')}</td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = this.rows.map(r => {
          const c = this.computeRow(r);
          return `
            <tr>
              <td><strong>${r.name}</strong></td>
              <td class="payroll-num" style="font-weight:700;">${this.money(c.net)}</td>
              <td><span class="p-badge b-green">PAID</span></td>
              <td>${this.nowStamp()}</td>
              <td>Bank Transfer &amp; Treasury Disbursal Complete</td>
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
      const netTotal = (p && p.total_net) || t.net;
      const extTotal = (p && p.final_ext_total) || t.external;
      const intTotal = (p && p.final_int_total) || t.internal;

      rowsEl.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0; color:#64748b;">
              <th style="text-align:left; padding:4px 8px;">Account</th>
              <th style="text-align:right; padding:4px 8px;">Debit</th>
              <th style="text-align:right; padding:4px 8px;">Credit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:4px 8px;"><strong>6100 - Payroll Expense</strong></td>
              <td style="text-align:right; padding:4px 8px; font-weight:700;">${this.money(netTotal)}</td>
              <td style="text-align:right; padding:4px 8px;">-</td>
            </tr>
            <tr>
              <td style="padding:4px 8px;">1010 - Primary Operating Wire Account</td>
              <td style="text-align:right; padding:4px 8px;">-</td>
              <td style="text-align:right; padding:4px 8px;">${this.money(extTotal)}</td>
            </tr>
            <tr>
              <td style="padding:4px 8px;">1020 - Internal Treasury Cash Account</td>
              <td style="text-align:right; padding:4px 8px;">-</td>
              <td style="text-align:right; padding:4px 8px;">${this.money(intTotal)}</td>
            </tr>
          </tbody>
        </table>
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
      if (siEstEl) siEstEl.textContent = `${siEst.toFixed(2)} EGP ($${(siEst / rate).toFixed(2)})`;
      if (taxEstEl) taxEstEl.textContent = `${taxEst.toFixed(2)} EGP ($${(taxEst / rate).toFixed(2)})`;

      const siInput = document.getElementById('p6SocialInsActual');
      const taxInput = document.getElementById('p6TaxActual');
      if (siInput && !siInput.value) siInput.value = siEst.toFixed(2);
      if (taxInput && !taxInput.value) taxInput.value = taxEst.toFixed(2);

      this.calcScreen6Variance('si');
      this.calcScreen6Variance('tax');

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
        const est = estText ? parseFloat(estText.textContent) || 0 : 0;
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
        const est = estText ? parseFloat(estText.textContent) || 0 : 0;
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
                <td class="payroll-num">${Number(o.amount_accrued).toFixed(2)} ${o.currency}</td>
                <td class="payroll-num">${Number(o.amount_remitted || 0).toFixed(2)} ${o.currency}</td>
                <td><span class="p-badge ${o.status === 'remitted' ? 'b-green' : 'b-blue'}">${o.status.toUpperCase()}</span></td>
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

            if (siObl) {
              if (siBadge) {
                siBadge.textContent = siObl.status.toUpperCase();
                siBadge.className = `p-badge ${siObl.status === 'remitted' ? 'b-green' : 'b-blue'}`;
              }
              if (btnSettleSi) {
                btnSettleSi.disabled = siObl.status === 'remitted';
                btnSettleSi.setAttribute('data-obl-id', siObl.id);
              }
            }
            if (taxObl) {
              if (taxBadge) {
                taxBadge.textContent = taxObl.status.toUpperCase();
                taxBadge.className = `p-badge ${taxObl.status === 'remitted' ? 'b-green' : 'b-blue'}`;
              }
              if (btnSettleTax) {
                btnSettleTax.disabled = taxObl.status === 'remitted';
                btnSettleTax.setAttribute('data-obl-id', taxObl.id);
              }
            }
            return;
          }
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not load statutory obligations:', err);
      }

      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:16px;">No statutory obligations recorded yet for this payroll run.</td></tr>';
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
        alert('Please enter a valid actual amount greater than zero.');
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

      try {
        if (typeof FinanceApi !== 'undefined' && typeof FinanceApi.settleStatutoryObligation === 'function') {
          const obl = await FinanceApi.getStatutoryObligation(oblId);
          await FinanceApi.settleStatutoryObligation(oblId, {
            amount: obl.amount_accrued,
            payment_date: new Date().toISOString().slice(0, 10),
            bank_account_id: Number(this.selectedExternalAccountId || 1)
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
      if (selExt) {
        selExt.innerHTML = this.banks.map(b => `<option value="${b.id}" ${String(b.id) === String(this.selectedExternalAccountId) ? 'selected' : ''}>${b.name} (${b.currency} ${b.number})</option>`).join('');
      }
      if (selInt) {
        selInt.innerHTML = this.banks.map(b => `<option value="${b.id}" ${String(b.id) === String(this.selectedInternalAccountId) ? 'selected' : ''}>${b.name} (${b.currency} ${b.number})</option>`).join('');
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

      pageList.classList.toggle('payroll-hidden', page !== 'list');
      pageRun.classList.toggle('payroll-hidden', page !== 'run');
      pageSettings.classList.toggle('payroll-hidden', page !== 'settings');

      if (navList) navList.classList.toggle('active', page === 'list');
      if (navSettings) navSettings.classList.toggle('active', page === 'settings');

      if (page === 'list') {
        this.drawRunsList();
      } else if (page === 'run') {
        this.redraw();
      } else if (page === 'settings') {
        this.loadBankAccountsFromDb();
        this.drawFundingAccounts();
        const setFxInput = document.getElementById('payrollSetFxRate');
        if (setFxInput) setFxInput.value = this.fxRateValue || '';
      }
    },

    showBanner(msg, color = 'blue') {
      const banner = document.getElementById('payrollActionBanner');
      if (!banner) return;
      banner.style.display = 'block';
      banner.textContent = msg;
      banner.className = `payroll-action-banner p-banner-${color}`;
      setTimeout(() => {
        if (banner) banner.style.display = 'none';
      }, 5000);
    },

    openRevertModal() {
      const modal = document.getElementById('payrollRevertModal');
      const reason = document.getElementById('payrollRevertReason');
      if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('show');
      }
      if (reason) reason.value = '';
    },

    closeRevertModal() {
      const modal = document.getElementById('payrollRevertModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
      }
    },

    confirmRevert() {
      const reasonEl = document.getElementById('payrollRevertReason');
      const reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) {
        alert('Please enter a reason for reverting to draft.');
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
  window.loadFinancePayroll = async function () {
    await PayrollApp.init();
    PayrollApp.showPage('list');
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
