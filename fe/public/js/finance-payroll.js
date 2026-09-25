/**
 * fe/public/js/finance-payroll.js
 * In-Page Payroll Module Controller for HRFlow
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

  const FLOW = ['draft', 'approved', 'processing', 'paid'];
  const STEP_META = {
    draft: { label: '1. Review & Draft', hint: 'Step 1 of 4 — Review payroll lines, add bonuses if needed, then click Next to save as draft.' },
    approved: { label: '2. Approve', hint: 'Step 2 of 4 — Draft saved and locked. Click Next to approve the run (blocked if any exception is blocking).' },
    processing: { label: '3. Processing', hint: 'Step 3 of 4 — Transfers submitted to the bank and awaiting confirmation. Click Next to simulate bank confirmation.' },
    paid: { label: '4. Paid', hint: 'Step 4 of 4 — Funds confirmed received. The GL journal has been posted automatically.' }
  };
  const DONE_HINT = 'Cycle complete — payroll is Paid and the GL journal has been posted automatically.';

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
        const isMock = typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
        
        if (isMock) {
          if (typeof window !== 'undefined' && Array.isArray(window.employees) && window.employees.length > 0) {
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
      return FLOW[this.stepIndex];
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
        approved: ['APPROVED', 'b-blue'],
        processing: ['PROCESSING', 'b-orange'],
        paid: ['PAID', 'b-green']
      };
      const t = this.rollup();

      let rowsHtml = `
        <tr class="clickable" onclick="PayrollApp.openRun('current')">
          <td><strong>${this.month}</strong></td>
          <td>${this.start} &rarr; ${this.end}</td>
          <td><span class="p-badge ${statusMap[currentStatus][1]}">${statusMap[currentStatus][0]}</span></td>
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
            <td>${r.employees || 8}</td>
            <td>${r.updated}</td>
          </tr>
        `;
      });

      tbody.innerHTML = rowsHtml;
      if (countEl) {
        countEl.textContent = `${this.historyRuns.length + 1} runs · current cycle is ${statusMap[currentStatus][0]}`;
      }
    },

    openRun(period) {
      this.showPage('run');
      this.redraw();
    },

    openHistoryRun(period) {
      this.showPage('run');
      this.showBanner(`Viewing historical closed run for ${period} (read-only reference).`, 'blue');
      this.redraw();
    },

    /* ---------------- Run detail view ---------------- */
    drawStepper() {
      const stepperEl = document.getElementById('payrollStepper');
      if (!stepperEl) return;

      stepperEl.innerHTML = FLOW.map((key, i) => {
        let cls = 'payroll-step-pill';
        if (i < this.stepIndex) cls += ' done';
        else if (i === this.stepIndex) cls += ' active';
        return `<div class="${cls}"><span class="payroll-step-num">${i + 1}</span>${STEP_META[key].label}</div>`;
      }).join('');
    },

    drawStats() {
      const statsGrid = document.getElementById('payrollStatsGrid');
      if (!statsGrid) return;

      const t = this.rollup();
      const cards = [
        ['Headcount', String(this.rows.length)],
        ['Total Net Payment', this.money(t.net)],
        ['Total Internal Payout', this.money(t.internal)],
        ['Total External Payout', this.money(t.external)],
        ['Total Bonus Amount', this.money(t.bonus)]
      ];

      statsGrid.innerHTML = cards.map(([k, v]) => `
        <div class="payroll-stat">
          <div class="label">${k}</div>
          <div class="value">${v}</div>
        </div>
      `).join('');
    },

    drawStatus() {
      const key = this.currentStatusKey();
      const statusMap = {
        draft: ['DRAFT', 'b-gray'],
        approved: ['APPROVED', 'b-blue'],
        processing: ['PROCESSING', 'b-orange'],
        paid: ['PAID', 'b-green']
      };

      const badge = document.getElementById('payrollStatusBadge');
      if (badge) {
        badge.textContent = statusMap[key][0];
        badge.className = `p-badge ${statusMap[key][1]}`;
      }

      const revertBtn = document.getElementById('payrollRevertBtn');
      if (revertBtn) {
        revertBtn.classList.toggle('payroll-hidden', key === 'draft');
      }

      const lockNote = document.getElementById('payrollLockNote');
      const lockText = document.getElementById('payrollLockText');
      if (lockNote && lockText) {
        if (key === 'draft') {
          lockNote.classList.add('payroll-hidden');
        } else {
          lockNote.classList.remove('payroll-hidden');
          const lockMsgs = {
            approved: 'This run is locked. Employee lines cannot be edited while Approved. Use "Revert to draft" if a correction is needed.',
            processing: 'This run is locked while transfers are processing at the bank. No edits are possible until Paid or reverted.',
            paid: 'This run is Paid and permanently locked. No further edits are possible — corrections require a new adjustment run.'
          };
          lockText.textContent = lockMsgs[key] || '';
        }
      }
    },

    drawFooterControls() {
      const key = this.currentStatusKey();
      const hasBlocking = this.exceptions().some(x => x.type === 'blocking');
      const atEnd = key === 'paid';

      const hintEl = document.getElementById('payrollStepHint');
      if (hintEl) {
        hintEl.textContent = atEnd ? DONE_HINT : STEP_META[key].hint;
      }

      const backBtn = document.getElementById('payrollBackBtn');
      if (backBtn) {
        backBtn.disabled = this.stepIndex === 0 || key === 'paid';
      }

      const nextBtn = document.getElementById('payrollNextBtn');
      if (nextBtn) {
        nextBtn.textContent = atEnd ? 'Cycle Complete' : (hasBlocking ? 'Resolve exceptions to continue' : 'Next');
        nextBtn.disabled = atEnd || (hasBlocking && (key === 'approved' || key === 'processing'));
      }
    },

    drawTable() {
      const tbody = document.getElementById('payrollTableBody');
      if (!tbody) return;

      const searchInput = document.getElementById('payrollSearchInput');
      const q = (searchInput ? searchInput.value : '').toLowerCase().trim();

      const bonusSelect = document.getElementById('payrollBonusFilter');
      const bonusFilter = bonusSelect ? bonusSelect.value : 'all';

      const stepKey = this.currentStatusKey();
      const locked = stepKey !== 'draft';

      const filteredRows = this.rows.filter(r => {
        const matchQ = !q || r.name.toLowerCase().includes(q) || String(r.id).includes(q);
        const types = (r.bonuses || []).map(b => b.type);
        const matchBonus = bonusFilter === 'all' || (bonusFilter === 'none' ? (!r.bonuses || r.bonuses.length === 0) : types.includes(bonusFilter));
        return matchQ && matchBonus;
      });

      let html = '';
      filteredRows.forEach(r => {
        const c = this.computeRow(r);
        const count = (r.bonuses || []).length;
        const chips = count > 0 ? `<span class="bonus-chip">${count} item${count > 1 ? 's' : ''}</span>` : '';
        const flagged = r.exception ? 'exception-row-flag' : '';

        html += `
          <tr class="${flagged}" style="${locked && !r.exception ? 'opacity:.88;' : ''}">
            <td class="payroll-id-col"><span class="payroll-emp-id">#${r.id}</span></td>
            <td class="payroll-name-col">
              <div class="payroll-emp-name" title="${r.name}">${r.name}</div>
              ${r.exception ? `<div style="margin-top:2px;"><span class="p-badge b-red">Payment failed</span></div>` : ''}
            </td>
            <td class="payroll-num">${this.money(r.baseExt)}</td>
            <td class="payroll-num">${this.money(r.baseInt)}</td>
            <td class="payroll-num payroll-bonus-col">
              <div class="bonus-cell">
                <span class="payroll-num">${this.money(c.bonusTotal)}</span>
                ${chips}
                <button class="add-bonus-btn" ${locked ? 'disabled title="Locked after draft step"' : `onclick="PayrollApp.toggleExpand(${r.id})" title="Add bonus / commission"`}>+</button>
              </div>
            </td>
            <td class="payroll-num">${this.money(c.totalInternal)}</td>
            <td class="payroll-num payroll-muted-col" title="${r.deductions_label || 'Social Insurance (Internal Estimate)'}">${this.money(c.deductions)}</td>
            <td class="payroll-num">${this.money(c.internal)}</td>
            <td class="payroll-num">${this.money(c.external)}</td>
            <td class="payroll-num" style="color:var(--primary, #2563eb); font-weight:800;">${this.money(c.net)}</td>
          </tr>
        `;

        if (this.expandedId === r.id && !locked) {
          html += `
            <tr class="expand-row">
              <td colspan="10">
                <div class="expand-inner">
                  <div class="existing-bonuses" id="chips-${r.id}">
                    ${(r.bonuses || []).map((b, idx) => `
                      <span class="bonus-tag">
                        ${b.type} · ${this.money(b.amount)} · ${b.source === 'internal' ? 'INT' : 'EXT'}
                        <span class="rm" onclick="PayrollApp.removeBonus(${r.id}, ${idx})">&times;</span>
                      </span>
                    `).join('') || '<span style="color:var(--text-muted); font-size:.82rem;">No additions added yet</span>'}
                  </div>
                  <div class="expand-form-row">
                    <div class="field">
                      <label>Type</label>
                      <select id="type-${r.id}">
                        <option value="Bonus">Bonus</option>
                        <option value="Sales Commission">Sales Commission</option>
                        <option value="Support Commission">Support Commission</option>
                      </select>
                    </div>
                    <div class="field">
                      <label>Amount (USD)</label>
                      <input id="amt-${r.id}" type="number" step="0.01" placeholder="0.00" />
                    </div>
                    <div class="field">
                      <label>Payment source</label>
                      <div class="src-toggle" id="src-${r.id}">
                        <button class="active" data-src="internal" onclick="PayrollApp.setSrc(${r.id}, 'internal')">Internal</button>
                        <button data-src="external" onclick="PayrollApp.setSrc(${r.id}, 'external')">External</button>
                      </div>
                    </div>
                    <div class="expand-btn-group">
                      <button class="btn btn-primary btn-sm btn-bonus-submit" onclick="PayrollApp.submitBonus(${r.id})">Submit</button>
                      <button class="btn btn-ghost btn-sm btn-bonus-close" onclick="PayrollApp.toggleExpand(${r.id})">Close</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }
      });

      tbody.innerHTML = html || `<tr><td colspan="10" style="text-align:center; padding:24px; color:var(--text-muted);">No employees match the current filters.</td></tr>`;

      // Update footers
      const t = this.rollup();
      const updateText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      updateText('fBaseExt', this.money(t.baseExt));
      updateText('fBaseInt', this.money(t.baseInt));
      updateText('fBonus', this.money(t.bonus));
      updateText('fTotalInt', this.money(t.totalInt));
      updateText('fDeductions', this.money(t.deductions));
      updateText('fInternal', this.money(t.internal));
      updateText('fExternal', this.money(t.external));
      updateText('fNet', this.money(t.net));
      updateText('accExternal', this.money(t.external));
      updateText('accInternal', this.money(t.internal));
    },

    drawExceptions() {
      const container = document.getElementById('payrollExceptionList');
      if (!container) return;

      const items = this.exceptions();
      if (!items.length) {
        container.innerHTML = `
          <div class="payroll-exception-alert clear">
            <i class="fa-solid fa-circle-check"></i>
            <span>Readiness: All clear (Ready for payment)</span>
          </div>
        `;
        return;
      }

      container.innerHTML = items.map(i => `
        <div class="payroll-exception-alert ${i.type}">
          <i class="fa-solid ${i.type === 'blocking' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'}"></i>
          <span>${i.type === 'blocking' ? 'Blocked' : 'Warning'}: ${i.name} — ${i.text}</span>
          ${i.retry ? `<button class="retry-btn" onclick="PayrollApp.retryPayment(${i.empId})" style="margin-left:6px;">Retry payment</button>` : ''}
        </div>
      `).join('');
    },

    drawJournal() {
      const key = this.currentStatusKey();
      const journalCard = document.getElementById('payrollJournalCard');
      if (!journalCard) return;

      // Only show Journal once run is PAID
      if (key !== 'paid' && !this.journalPosted) {
        journalCard.classList.add('payroll-hidden');
        return;
      }

      journalCard.classList.remove('payroll-hidden');

      const badge = document.getElementById('payrollJournalBadge');
      if (badge) {
        badge.textContent = 'Posted';
        badge.className = 'p-badge b-green';
      }

      const rowsContainer = document.getElementById('payrollJournalRows');
      if (!rowsContainer) return;

      const t = this.rollup();
      const rows = [
        ['Internal Payroll Expense', '6001', t.totalInt, 0],
        ['External Payroll Expense', '6003', t.external, 0],
        ['Deductions Payable', '2102', 0, t.deductions],
        ['Internal Net Salaries Payable', '2103', 0, t.internal],
        ['External Net Salaries Payable', '2105', 0, t.external],
      ];
      const debit = rows.reduce((s, r) => s + r[2], 0);
      const credit = rows.reduce((s, r) => s + r[3], 0);

      rowsContainer.innerHTML = rows.map(r => `
        <div class="journal-row">
          <div><strong>${r[0]}</strong></div>
          <div><code>${r[1]}</code></div>
          <div class="payroll-num">${r[2] ? this.money(r[2]) : '—'}</div>
          <div class="payroll-num">${r[3] ? this.money(r[3]) : '—'}</div>
        </div>
      `).join('') + `
        <div class="journal-row" style="background:var(--primary-soft, #e8f0ff); border-radius:6px; padding:6px 10px; margin-top:6px; font-weight:800;">
          <div><strong>Totals</strong></div>
          <div></div>
          <div class="payroll-num">${this.money(debit)}</div>
          <div class="payroll-num">${this.money(credit)}</div>
        </div>
      `;
    },

    toggleJournalDetails() {
      const details = document.getElementById('payrollJournalDetails');
      const chevron = document.getElementById('payrollJournalChevron');
      if (!details) return;
      const isHidden = details.classList.contains('payroll-hidden');
      details.classList.toggle('payroll-hidden', !isHidden);
      if (chevron) {
        chevron.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
      }
    },

    drawPeriodLabel() {
      const label = document.getElementById('payrollPeriodLabel');
      if (label) label.textContent = this.month;

      const sub = document.getElementById('payrollPeriodSubtitle');
      if (sub) {
        const extAcc = this.banks.find(b => String(b.id) === String(this.selectedExternalAccountId));
        const intAcc = this.banks.find(b => String(b.id) === String(this.selectedInternalAccountId));
        let fundingText = extAcc ? `External: ${extAcc.name} (${extAcc.currency || 'USD'})` : '';
        if (intAcc) {
          fundingText += (fundingText ? ' · ' : '') + `Internal: ${intAcc.name} (${intAcc.currency || 'USD'})`;
        }
        sub.textContent = `Period ${this.start} to ${this.end} · Funding: ${fundingText || 'Not configured'}`;
      }
    },

    redraw() {
      this.drawFxRate();
      this.drawStepper();
      this.drawStats();
      this.drawStatus();
      this.drawTable();
      this.drawExceptions();
      this.drawJournal();
      this.drawFooterControls();
      this.drawPeriodLabel();
      this.drawRunsList();
    },

    toggleExpand(id) {
      this.expandedId = this.expandedId === id ? null : id;
      this.drawTable();
    },

    setSrc(id, src) {
      const wrap = document.getElementById(`src-${id}`);
      if (!wrap) return;
      wrap.querySelectorAll('button').forEach(b => {
        b.classList.toggle('active', b.dataset.src === src);
      });
    },

    submitBonus(id) {
      const row = this.rows.find(r => r.id === id);
      if (!row) return;

      const typeEl = document.getElementById(`type-${id}`);
      const amtEl = document.getElementById(`amt-${id}`);
      const type = typeEl ? typeEl.value : 'Bonus';
      const amount = Number((amtEl ? amtEl.value : '') || 0);

      const srcBtn = document.querySelector(`#src-${id} button.active`);
      const source = srcBtn ? srcBtn.dataset.src : 'internal';

      if (!amount || amount <= 0) {
        alert('Enter a bonus amount greater than zero.');
        return;
      }

      if (!row.bonuses) row.bonuses = [];
      row.bonuses.push({ type, amount, source });
      this.addAudit(`Added ${type} of ${this.money(amount)} (${source}) for ${row.name}.`);

      this.drawTable();
      this.drawStats();
      this.drawJournal();
      this.drawExceptions();
    },

    removeBonus(id, idx) {
      const row = this.rows.find(r => r.id === id);
      if (!row || !row.bonuses) return;

      const removed = row.bonuses[idx];
      row.bonuses.splice(idx, 1);
      this.addAudit(`Removed ${removed.type} of ${this.money(removed.amount)} for ${row.name}.`);

      this.drawTable();
      this.drawStats();
      this.drawJournal();
      this.drawExceptions();
    },

    retryPayment(empId) {
      const row = this.rows.find(r => r.id === empId);
      if (!row) return;

      row.exception = null;
      this.addAudit(`Retried payment for ${row.name} — transfer resubmitted successfully.`);
      this.drawTable();
      this.drawExceptions();
      this.drawFooterControls();
      this.showBanner(`Payment retried for ${row.name}. Exception cleared.`, 'blue');
    },

    showBanner(text, tone) {
      const el = document.getElementById('payrollActionBanner');
      if (!el) return;

      const colors = {
        green: ['#dcfce7', '#166534', '#bbf7d0'],
        blue: ['#dbeafe', '#1d4ed8', '#bfdbfe'],
        orange: ['#fef3c7', '#92400e', '#fde68a']
      };
      const c = colors[tone] || colors.blue;
      el.style.display = 'block';
      el.style.background = c[0];
      el.style.color = c[1];
      el.style.border = `1px solid ${c[2]}`;
      el.textContent = text;
    },

    goNext() {
      const key = this.currentStatusKey();

      if (key === 'draft') {
        this.stepIndex = 1;
        this.addAudit('Draft saved and submitted for approval. Employee lines locked.');
        this.redraw();
        this.showBanner('Draft saved. The run is now locked and moved to Approved.', 'blue');
        return;
      }

      if (key === 'approved') {
        if (this.exceptions().some(x => x.type === 'blocking')) {
          alert('Approval blocked: resolve blocking exceptions (failed payments) before continuing.');
          return;
        }
        this.stepIndex = 2;
        // Simulate one payment failure on an employee to demonstrate the exception/retry path
        const target = this.rows[Math.min(4, this.rows.length - 1)];
        if (target) {
          target.exception = 'Bank transfer rejected: destination account details invalid.';
        }
        this.addAudit('Run approved. Transfers submitted to the bank for processing.');
        this.redraw();
        this.showBanner('Run approved and transfers submitted — status is now PROCESSING while the bank confirms.', 'orange');
        return;
      }

      if (key === 'processing') {
        if (this.exceptions().some(x => x.type === 'blocking')) {
          alert('Cannot mark as Paid: one or more payments failed. Retry or resolve the exception first.');
          return;
        }
        this.stepIndex = 3;
        this.journalPosted = true;
        this.addAudit('Bank confirmed all transfers. Payroll marked as Paid. GL journal posted automatically.');
        this.redraw();
        this.showBanner('Bank confirmed all transfers — payroll is now PAID and the GL journal was posted automatically.', 'green');
        return;
      }
    },

    goBack() {
      if (this.stepIndex === 0 || this.currentStatusKey() === 'paid') return;
      this.stepIndex -= 1;
      const banner = document.getElementById('payrollActionBanner');
      if (banner) banner.style.display = 'none';
      this.redraw();
    },

    /* ---------------- Revert to draft ---------------- */
    openRevertModal() {
      const modal = document.getElementById('payrollRevertModal');
      if (modal) modal.classList.add('show');
    },

    closeRevertModal() {
      const modal = document.getElementById('payrollRevertModal');
      if (modal) modal.classList.remove('show');
      const reasonEl = document.getElementById('payrollRevertReason');
      if (reasonEl) reasonEl.value = '';
    },

    confirmRevert() {
      const reasonEl = document.getElementById('payrollRevertReason');
      const reason = (reasonEl ? reasonEl.value : '').trim();
      if (!reason) {
        alert('A reason is required to revert this run to draft.');
        return;
      }

      const fromStatus = this.currentStatusKey();
      this.stepIndex = 0;
      this.journalPosted = false;
      this.rows.forEach(r => r.exception = null);
      this.addAudit(`Reverted from ${fromStatus.toUpperCase()} back to DRAFT. Reason: "${reason}"`);
      this.closeRevertModal();
      this.redraw();
      this.showBanner('Run reverted to Draft. Employee lines are unlocked again for correction.', 'orange');
    },

    /* ---------------- Settings view & Target Accounts Selection ---------------- */
    drawFundingAccounts() {
      const extSelect = document.getElementById('payrollTargetExternalAccount');
      const intSelect = document.getElementById('payrollTargetInternalAccount');
      if (!extSelect || !intSelect) return;

      const renderOptions = (selectedId) => {
        if (!this.banks || !this.banks.length) {
          return '<option value="">No bank accounts found</option>';
        }
        return this.banks.map(b => `
          <option value="${b.id}" ${String(b.id) === String(selectedId) ? 'selected' : ''}>
            ${b.name} (${b.currency}) ${b.number ? '— ' + b.number : ''}
          </option>
        `).join('');
      };

      extSelect.innerHTML = renderOptions(this.selectedExternalAccountId);
      intSelect.innerHTML = renderOptions(this.selectedInternalAccountId);
    },

    setFundingAccount(type, accountId) {
      if (type === 'external') {
        this.selectedExternalAccountId = accountId;
      } else if (type === 'internal') {
        this.selectedInternalAccountId = accountId;
      }
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

      const extSelect = document.getElementById('payrollTargetExternalAccount');
      if (extSelect && extSelect.value) this.selectedExternalAccountId = extSelect.value;

      const intSelect = document.getElementById('payrollTargetInternalAccount');
      if (intSelect && intSelect.value) this.selectedInternalAccountId = intSelect.value;

      const empRateInput = document.getElementById('payrollEmployeeInsuranceRate');
      const empyrRateInput = document.getElementById('payrollEmployerInsuranceRate');
      if (empRateInput && empyrRateInput && typeof FinanceApi !== 'undefined' && FinanceApi.updatePayrollSettings) {
        const empRate = Number(empRateInput.value) / 100.0;
        const empyrRate = Number(empyrRateInput.value) / 100.0;
        try {
          await FinanceApi.updatePayrollSettings({
            employee_rate: empRate,
            employer_rate: empyrRate
          });
        } catch (err) {
          console.warn('[PayrollApp] Could not save payroll rate settings:', err);
        }
      }

      const setFxInput = document.getElementById('payrollSetFxRate');
      if (setFxInput) {
        const val = parseFloat(setFxInput.value);
        this.fxRateValue = (val && val > 0) ? val : null;
      }

      await this.fetchPreview();

      this.persistFundingAccounts();
      this.drawPeriodLabel();
      this.addAudit('Payroll settings updated: funding accounts, schedule, statutory rates, or FX rate changed.');
      this.showPage('list');
      this.showBanner('Payroll settings saved.', 'blue');
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
              } else if (r.baseInt > 0) {
                r.deductions = Math.round(r.baseInt * (this.employeeInsuranceRate || 0.11) * 100) / 100;
                r.deductions_total = r.deductions;
                r.deductions_label = 'Social Insurance (Internal Estimate)';
              }
            });
          }
        } else {
          (this.rows || []).forEach(r => {
            if (r.baseInt > 0 && (r.deductions === undefined || r.deductions === 0)) {
              r.deductions = Math.round(r.baseInt * (this.employeeInsuranceRate || 0.11) * 100) / 100;
              r.deductions_total = r.deductions;
              r.deductions_label = 'Social Insurance (Internal Estimate)';
            }
          });
        }
      } catch (err) {
        console.warn('[PayrollApp] Could not fetch payroll preview:', err);
      }
    },

    drawFxRate() {
      const rateEl = document.getElementById('payrollFxRateBadge');
      const srcEl = document.getElementById('payrollFxRateSourceBadge');
      const inputEl = document.getElementById('payrollFxRateInput');
      const setFxInput = document.getElementById('payrollSetFxRate');

      const rateNum = Number(this.resolvedFxRate || 50.0);
      const isManual = this.fxRateValue !== null && this.fxRateValue !== undefined && Number(this.fxRateValue) > 0;
      const isFallback = !isManual && (this.resolvedFxSource === 'fallback' || rateNum === 50.0);

      if (rateEl) {
        rateEl.textContent = rateNum.toFixed(4);
      }
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
      if (inputEl && document.activeElement !== inputEl) {
        inputEl.value = isManual ? this.fxRateValue : '';
      }
      if (setFxInput && document.activeElement !== setFxInput) {
        setFxInput.value = isManual ? this.fxRateValue : '';
      }
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
        this.addAudit(`Cleared manual FX rate override. Reverted to resolved rate.`);
      }
      const form = document.getElementById('payrollFxOverrideForm');
      if (form) form.style.display = 'none';

      await this.fetchPreview();
      this.redraw();
    },

    async resetFxOverride() {
      this.fxRateValue = null;
      this.addAudit(`Reset FX rate override to default resolver.`);
      const form = document.getElementById('payrollFxOverrideForm');
      if (form) form.style.display = 'none';

      await this.fetchPreview();
      this.redraw();
    },

    /* ---------------- Navigation between views ---------------- */
    async showPage(page) {
      const pageList = document.getElementById('payrollViewList');
      const pageRun = document.getElementById('payrollViewRun');
      const pageSettings = document.getElementById('payrollViewSettings');
      const navList = document.getElementById('payrollNavList');
      const navSettings = document.getElementById('payrollNavSettings');

      if (pageList) pageList.classList.toggle('payroll-hidden', page !== 'list');
      if (pageRun) pageRun.classList.toggle('payroll-hidden', page !== 'run');
      if (pageSettings) pageSettings.classList.toggle('payroll-hidden', page !== 'settings');

      if (navList) navList.classList.toggle('active', page === 'list' || page === 'run');
      if (navSettings) navSettings.classList.toggle('active', page === 'settings');

      if (page === 'list') {
        this.drawRunsList();
      } else if (page === 'run') {
        await this.fetchPreview();
        this.redraw();
      } else if (page === 'settings') {
        await this.loadBankAccountsFromDb();
        this.drawFundingAccounts();
        const setFxInput = document.getElementById('payrollSetFxRate');
        if (setFxInput) setFxInput.value = this.fxRateValue || '';
        if (typeof FinanceApi !== 'undefined' && FinanceApi.getPayrollSettings) {
          try {
            const settings = await FinanceApi.getPayrollSettings();
            const empRateInput = document.getElementById('payrollEmployeeInsuranceRate');
            const empyrRateInput = document.getElementById('payrollEmployerInsuranceRate');
            if (empRateInput && settings.employee_rate !== undefined) {
              empRateInput.value = (Number(settings.employee_rate) * 100).toFixed(2);
            }
            if (empyrRateInput && settings.employer_rate !== undefined) {
              empyrRateInput.value = (Number(settings.employer_rate) * 100).toFixed(2);
            }
          } catch (err) {
            console.warn('[PayrollApp] Could not load payroll settings:', err);
          }
        }
      }
    }
  };

  // Expose globally
  window.PayrollApp = PayrollApp;

  // Compatibility stubs for existing router and legacy call sites
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
