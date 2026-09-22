/**
 * fe/public/js/payroll-table.js
 * Controller for the Grouped & Editable Payroll Table:
 * - 15 seed employees across 3 account groups
 * - Inline editing for Bonus, Sales Commission, Support Commission
 * - INT / EXT source toggle with live row muting
 * - Per-account totals row pinned to bottom of each group
 * - Live Net Pay formula recomputation
 * - Keyboard navigation (Tab, Shift+Tab, Enter, Escape)
 * - Cycle lock enforcement
 */

const PayrollTableController = {
  activeMonth: '2026-09',
  dataByMonth: {},
  editedCells: new Set(),
  activeEditCell: null,

  filters: {
    department: 'all',
    source: 'all',
    search: ''
  },

  seedEmployees: [
    // Operations Group (5)
    { id: 'EMP004', name: 'Elena Rostova', department: 'Operations', account: 'Operations', source: 'INT', baseSalary: 11500, overtime: 400, bonus: 500, salesComm: 0, supportComm: 250, deductions: 1200 },
    { id: 'EMP006', name: 'Tariq Mansour', department: 'Operations', account: 'Operations', source: 'INT', baseSalary: 6500, overtime: 250, bonus: 200, salesComm: 0, supportComm: 150, deductions: 650 },
    { id: 'EMP007', name: 'Nour El-Din', department: 'Operations', account: 'Operations', source: 'EXT', baseSalary: 5800, overtime: 300, bonus: 100, salesComm: 0, supportComm: 0, deductions: 500 },
    { id: 'EMP008', name: 'Layla Hassan', department: 'Operations', account: 'Operations', source: 'INT', baseSalary: 7200, overtime: 150, bonus: 350, salesComm: 0, supportComm: 100, deductions: 750 },
    { id: 'EMP009', name: 'Omar Fathy', department: 'Operations', account: 'Operations', source: 'EXT', baseSalary: 5400, overtime: 200, bonus: 150, salesComm: 0, supportComm: 0, deductions: 480 },

    // Engineering Group (5)
    { id: 'EMP001', name: 'Sarah Connor', department: 'Engineering', account: 'Engineering', source: 'INT', baseSalary: 12500, overtime: 0, bonus: 1000, salesComm: 0, supportComm: 0, deductions: 1500 },
    { id: 'EMP003', name: 'Alex Rivera', department: 'Engineering', account: 'Engineering', source: 'INT', baseSalary: 8200, overtime: 350, bonus: 400, salesComm: 0, supportComm: 300, deductions: 800 },
    { id: 'EMP005', name: 'Marcus Vance', department: 'Engineering', account: 'Engineering', source: 'EXT', baseSalary: 9000, overtime: 0, bonus: 600, salesComm: 0, supportComm: 0, deductions: 900 },
    { id: 'EMP010', name: 'Karim Adel', department: 'Engineering', account: 'Engineering', source: 'INT', baseSalary: 9500, overtime: 200, bonus: 500, salesComm: 0, supportComm: 0, deductions: 950 },
    { id: 'EMP011', name: 'Yasmine Zaki', department: 'Engineering', account: 'Engineering', source: 'INT', baseSalary: 10200, overtime: 150, bonus: 700, salesComm: 0, supportComm: 0, deductions: 1050 },

    // Sales & Marketing Group (5)
    { id: 'EMP002', name: 'John Doe', department: 'Marketing', account: 'Sales & Marketing', source: 'INT', baseSalary: 9800, overtime: 0, bonus: 450, salesComm: 800, supportComm: 0, deductions: 950 },
    { id: 'EMP012', name: 'Hany Ramzy', department: 'Sales', account: 'Sales & Marketing', source: 'INT', baseSalary: 8500, overtime: 0, bonus: 1200, salesComm: 2800, supportComm: 0, deductions: 1100 },
    { id: 'EMP013', name: 'Dalia Selim', department: 'Sales', account: 'Sales & Marketing', source: 'INT', baseSalary: 6000, overtime: 100, bonus: 300, salesComm: 1100, supportComm: 200, deductions: 600 },
    { id: 'EMP014', name: 'Sherif Nabil', department: 'Support', account: 'Sales & Marketing', source: 'EXT', baseSalary: 5200, overtime: 400, bonus: 250, salesComm: 0, supportComm: 950, deductions: 450 },
    { id: 'EMP015', name: 'Mona Kamel', department: 'Support', account: 'Sales & Marketing', source: 'INT', baseSalary: 6800, overtime: 200, bonus: 400, salesComm: 300, supportComm: 750, deductions: 700 },
  ],

  init(month = '2026-09') {
    this.activeMonth = month;
    this.loadData(month);
    this.render();

    // Listen to cycle changes (e.g. locked status)
    document.addEventListener('payroll:cycle-changed', (e) => {
      this.render();
    });
  },

  computeNetPay(row) {
    const base = Number(row.baseSalary || 0);
    const ot = Number(row.overtime || 0);
    const bonus = Number(row.bonus || 0);
    const sales = Number(row.salesComm || 0);
    const support = Number(row.supportComm || 0);
    const ded = Number(row.deductions || 0);
    return Math.round((base + ot + bonus + sales + support - ded) * 100) / 100;
  },

  loadData(month, forceReset = false) {
    if (!forceReset && this.dataByMonth[month]) {
      return;
    }
    // Clone seed data and compute initial netPay in-memory
    const cloned = this.seedEmployees.map((emp) => {
      const row = { ...emp };
      row.netPay = this.computeNetPay(row);
      return row;
    });
    this.dataByMonth[month] = cloned;
  },

  saveData(month) {
    // In-memory state only — this.dataByMonth[month] is already updated
  },

  getCurrentRows() {
    if (!this.dataByMonth[this.activeMonth]) {
      this.loadData(this.activeMonth);
    }
    return this.dataByMonth[this.activeMonth];
  },

  setMonth(month) {
    this.activeMonth = month;
    this.loadData(month);
    this.editedCells.clear();
    this.render();
  },

  setFilter(type, value) {
    this.filters[type] = value;
    this.render();
  },

  getFilteredRows() {
    const rows = this.getCurrentRows();
    return rows.filter((row) => {
      // Dept filter
      if (this.filters.department !== 'all') {
        if (row.department.toLowerCase() !== this.filters.department.toLowerCase() &&
            row.account.toLowerCase() !== this.filters.department.toLowerCase()) {
          return false;
        }
      }
      // Source filter
      if (this.filters.source !== 'all') {
        if (row.source.toUpperCase() !== this.filters.source.toUpperCase()) {
          return false;
        }
      }
      // Search filter
      if (this.filters.search) {
        const q = this.filters.search.toLowerCase().trim();
        const matchName = row.name.toLowerCase().includes(q);
        const matchId = row.id.toLowerCase().includes(q);
        const matchDept = row.department.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchDept) return false;
      }
      return true;
    });
  },

  getGroupedRows() {
    const filtered = this.getFilteredRows();
    const groups = {};
    const accountOrder = ['Operations', 'Engineering', 'Sales & Marketing'];

    accountOrder.forEach((acc) => {
      groups[acc] = [];
    });

    filtered.forEach((row) => {
      const acc = row.account || 'General';
      if (!groups[acc]) groups[acc] = [];
      groups[acc].push(row);
    });

    return groups;
  },

  computeTotals(rows) {
    const totals = {
      baseSalary: 0,
      overtime: 0,
      bonus: 0,
      salesComm: 0,
      supportComm: 0,
      deductions: 0,
      netPay: 0,
      count: (rows || []).length
    };
    (rows || []).forEach((r) => {
      totals.baseSalary += Number(r.baseSalary || 0);
      totals.overtime += Number(r.overtime || 0);
      totals.bonus += Number(r.bonus || 0);
      totals.salesComm += Number(r.salesComm || 0);
      totals.supportComm += Number(r.supportComm || 0);
      totals.deductions += Number(r.deductions || 0);
      totals.netPay += Number(r.netPay || 0);
    });
    return totals;
  },

  formatMoney(num) {
    return '$' + Number(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  render() {
    const container = document.getElementById('payrollTableContainer');
    if (!container) return;

    const canEdit = typeof PayrollCycleManager !== 'undefined' ? PayrollCycleManager.canEdit() : true;
    const grouped = this.getGroupedRows();
    const allFiltered = this.getFilteredRows();
    const grandTotals = this.computeTotals(allFiltered);

    let html = `
      <div class="payroll-table-wrapper" style="overflow-x:auto; border-radius:12px; border:1px solid var(--border-color, #E2E8F0); background:var(--surface, #ffffff); box-shadow:var(--shadow-sm);">
        <table class="payroll-worksheet-table" id="payrollWorksheetTable" style="width:100%; border-collapse:collapse; font-size:0.85rem;">
          <thead>
            <tr style="background:var(--bg-secondary, #F8FAFC); border-bottom:2px solid var(--border-color, #CBD5E1); color:var(--text-muted, #64748B); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.04em;">
              <th style="padding:12px 14px; text-align:left; min-width:200px;">Employee</th>
              <th style="padding:12px 14px; text-align:right; min-width:110px;">Base Salary</th>
              <th style="padding:12px 14px; text-align:right; min-width:90px;">Overtime</th>
              <th style="padding:12px 14px; text-align:right; min-width:100px; color:var(--primary, #2563EB);">Bonus ✎</th>
              <th style="padding:12px 14px; text-align:right; min-width:110px; color:var(--primary, #2563EB);">Sales Comm. ✎</th>
              <th style="padding:12px 14px; text-align:right; min-width:110px; color:var(--primary, #2563EB);">Supp. Comm. ✎</th>
              <th style="padding:12px 14px; text-align:center; min-width:90px;">Source</th>
              <th style="padding:12px 14px; text-align:right; min-width:100px; color:var(--danger, #EF4444);">Deductions</th>
              <th style="padding:12px 14px; text-align:right; min-width:120px; font-weight:700;">Net Pay</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (allFiltered.length === 0) {
      html += `
        <tr>
          <td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">
            <i class="fa-solid fa-filter" style="font-size:1.8rem; margin-bottom:8px; opacity:0.5;"></i>
            <p style="margin:0;">No payroll lines match the selected filters.</p>
          </td>
        </tr>
      `;
    } else {
      Object.keys(grouped).forEach((groupName) => {
        const rows = grouped[groupName];
        if (rows.length === 0) return;

        const groupTotals = this.computeTotals(rows);

        // Group Header
        html += `
          <tr class="payroll-group-header-row" style="background:var(--bg-secondary, #F1F5F9); border-top:2px solid var(--border-color, #CBD5E1); border-bottom:1px solid var(--border-color, #E2E8F0);">
            <td colspan="9" style="padding:10px 14px; font-weight:700; color:var(--text-primary, #0F172A); font-size:0.85rem;">
              <i class="fa-solid fa-layer-group" style="color:var(--primary, #2563EB); margin-right:8px;"></i>
              Account Group: <strong>${groupName}</strong>
              <span class="badge" style="margin-left:8px; background:var(--surface, #fff); border:1px solid var(--border-color, #CBD5E1); color:var(--text-muted, #475569); font-size:0.75rem; font-weight:600;">
                ${rows.length} ${rows.length === 1 ? 'employee' : 'employees'}
              </span>
            </td>
          </tr>
        `;

        // Employee Rows
        rows.forEach((r) => {
          const isExt = r.source === 'EXT';
          const rowClass = isExt ? 'payroll-row payroll-row-ext' : 'payroll-row';
          const rowStyle = isExt
            ? 'border-bottom:1px solid var(--border-color, #E2E8F0); opacity:0.85; background:var(--bg-subtle, rgba(241,245,249,0.5));'
            : 'border-bottom:1px solid var(--border-color, #E2E8F0);';

          const bonusKey = `${r.id}_bonus`;
          const salesKey = `${r.id}_salesComm`;
          const suppKey = `${r.id}_supportComm`;
          const sourceKey = `${r.id}_source`;

          const bonusEdited = this.editedCells.has(bonusKey) ? 'payroll-cell-edited' : '';
          const salesEdited = this.editedCells.has(salesKey) ? 'payroll-cell-edited' : '';
          const suppEdited = this.editedCells.has(suppKey) ? 'payroll-cell-edited' : '';

          html += `
            <tr class="${rowClass}" id="payrollRow_${r.id}" style="${rowStyle}">
              <td style="padding:10px 14px;">
                <div style="font-weight:600; color:var(--text-primary);">${r.name}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">
                  <span>${r.id}</span> · <span>${r.department}</span>
                </div>
              </td>
              <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;">
                ${this.formatMoney(r.baseSalary)}
              </td>
              <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--text-muted);">
                ${this.formatMoney(r.overtime)}
              </td>

              <!-- Editable Bonus -->
              <td class="payroll-editable-cell ${bonusEdited}"
                  data-emp-id="${r.id}"
                  data-field="bonus"
                  tabindex="${canEdit ? '0' : '-1'}"
                  style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; cursor:${canEdit ? 'pointer' : 'default'}; position:relative;"
                  title="${canEdit ? 'Click or Tab to edit bonus' : 'Locked'}">
                <span class="payroll-cell-display" id="cellDisplay_${r.id}_bonus">${this.formatMoney(r.bonus)}</span>
              </td>

              <!-- Editable Sales Commission -->
              <td class="payroll-editable-cell ${salesEdited}"
                  data-emp-id="${r.id}"
                  data-field="salesComm"
                  tabindex="${canEdit ? '0' : '-1'}"
                  style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; cursor:${canEdit ? 'pointer' : 'default'}; position:relative;"
                  title="${canEdit ? 'Click or Tab to edit sales commission' : 'Locked'}">
                <span class="payroll-cell-display" id="cellDisplay_${r.id}_salesComm">${this.formatMoney(r.salesComm)}</span>
              </td>

              <!-- Editable Support Commission -->
              <td class="payroll-editable-cell ${suppEdited}"
                  data-emp-id="${r.id}"
                  data-field="supportComm"
                  tabindex="${canEdit ? '0' : '-1'}"
                  style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; cursor:${canEdit ? 'pointer' : 'default'}; position:relative;"
                  title="${canEdit ? 'Click or Tab to edit support commission' : 'Locked'}">
                <span class="payroll-cell-display" id="cellDisplay_${r.id}_supportComm">${this.formatMoney(r.supportComm)}</span>
              </td>

              <!-- Editable Source Selector -->
              <td style="padding:10px 14px; text-align:center;">
                ${canEdit ? `
                  <button type="button"
                          class="source-chip source-chip--${r.source.toLowerCase()}"
                          id="btnSourceToggle_${r.id}"
                          data-emp-id="${r.id}"
                          onclick="PayrollTableController.toggleRowSource('${r.id}')"
                          title="Click to toggle Internal/External source"
                          style="border-radius:20px; padding:3px 10px; font-size:0.75rem; font-weight:700; cursor:pointer; border:1.5px solid; transition:all 0.15s ease; ${r.source === 'INT' ? 'border-color:#0D9488; color:#0D9488; background:rgba(13,148,136,0.08);' : 'border-color:#2563EB; color:#2563EB; background:rgba(37,99,235,0.08);'}">
                    ${r.source}
                  </button>
                ` : `
                  <span class="badge" style="${r.source === 'INT' ? 'background:#E6FFFA; color:#0D9488; border:1px solid #99F6E4;' : 'background:#EFF6FF; color:#2563EB; border:1px solid #BFDBFE;'} font-size:0.75rem; font-weight:700;">
                    ${r.source}
                  </span>
                `}
              </td>

              <!-- Deductions -->
              <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--danger, #EF4444);">
                -${this.formatMoney(r.deductions)}
              </td>

              <!-- Net Pay (Live computed) -->
              <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; font-weight:700; color:var(--text-primary);" id="netPayDisplay_${r.id}">
                ${this.formatMoney(r.netPay)}
              </td>
            </tr>
          `;
        });

        // Group Totals Row
        html += `
          <tr class="payroll-group-totals-row" id="groupTotals_${groupName.replace(/\s+/g, '_')}" style="background:var(--bg-secondary, #F8FAFC); border-bottom:2px solid var(--border-color, #CBD5E1); font-weight:700;">
            <td style="padding:10px 14px; text-align:left; color:var(--text-muted); font-size:0.8rem; text-transform:uppercase;">
              <i class="fa-solid fa-calculator" style="margin-right:6px;"></i> TOTAL (${groupName})
            </td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;" class="gt-base">${this.formatMoney(groupTotals.baseSalary)}</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;" class="gt-ot">${this.formatMoney(groupTotals.overtime)}</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;" class="gt-bonus">${this.formatMoney(groupTotals.bonus)}</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;" class="gt-sales">${this.formatMoney(groupTotals.salesComm)}</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums;" class="gt-supp">${this.formatMoney(groupTotals.supportComm)}</td>
            <td style="padding:10px 14px; text-align:center; color:var(--text-muted); font-size:0.75rem;">—</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--danger, #EF4444);" class="gt-ded">-${this.formatMoney(groupTotals.deductions)}</td>
            <td style="padding:10px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--primary, #2563EB); font-size:0.92rem;" class="gt-net">${this.formatMoney(groupTotals.netPay)}</td>
          </tr>
        `;
      });

      // Overall Grand Total Row
      html += `
        <tr class="payroll-grand-totals-row" style="background:var(--surface, #ffffff); border-top:3px double var(--border-color, #94A3B8); font-weight:800; font-size:0.9rem;">
          <td style="padding:12px 14px; text-align:left; color:var(--text-primary); text-transform:uppercase;">
            <i class="fa-solid fa-coins" style="color:var(--primary, #2563EB); margin-right:6px;"></i> GRAND TOTAL
          </td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums;" id="grandTotalBase">${this.formatMoney(grandTotals.baseSalary)}</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums;" id="grandTotalOT">${this.formatMoney(grandTotals.overtime)}</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums;" id="grandTotalBonus">${this.formatMoney(grandTotals.bonus)}</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums;" id="grandTotalSales">${this.formatMoney(grandTotals.salesComm)}</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums;" id="grandTotalSupp">${this.formatMoney(grandTotals.supportComm)}</td>
          <td style="padding:12px 14px; text-align:center; font-size:0.75rem; color:var(--text-muted);">${grandTotals.count} staff</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--danger, #EF4444);" id="grandTotalDed">-${this.formatMoney(grandTotals.deductions)}</td>
          <td style="padding:12px 14px; text-align:right; font-variant-numeric:tabular-nums; color:var(--primary, #2563EB); font-size:1.02rem;" id="grandTotalNet">${this.formatMoney(grandTotals.netPay)}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
    this.attachCellListeners();
  },

  attachCellListeners() {
    const canEdit = typeof PayrollCycleManager !== 'undefined' ? PayrollCycleManager.canEdit() : true;
    if (!canEdit) return;

    const cells = document.querySelectorAll('.payroll-editable-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        if (this.activeEditCell === cell) return;
        this.startEditCell(cell);
      });

      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (this.activeEditCell !== cell) {
            this.startEditCell(cell);
          }
        } else if (e.key === 'Tab') {
          // Normal tab flow handled by focus
        }
      });
    });
  },

  startEditCell(cell) {
    if (this.activeEditCell && this.activeEditCell !== cell) {
      this.commitCell(this.activeEditCell);
    }
    if (cell.querySelector('input')) return;

    const empId = cell.getAttribute('data-emp-id');
    const field = cell.getAttribute('data-field');
    const rows = this.getCurrentRows();
    const row = rows.find((r) => r.id === empId);
    if (!row) return;

    const currentVal = row[field] !== undefined ? row[field] : 0;
    this.activeEditCell = cell;

    cell.innerHTML = `
      <input type="number"
             step="any"
             min="0"
             class="payroll-inline-input"
             id="inlineInput_${empId}_${field}"
             value="${currentVal}"
             style="width:100%; max-width:95px; padding:4px 6px; font-size:0.85rem; text-align:right; border:2px solid var(--primary, #2563EB); border-radius:6px; background:var(--surface, #ffffff); color:var(--text-primary); outline:none; font-variant-numeric:tabular-nums; box-shadow:0 0 0 3px rgba(37,99,235,0.2);" />
    `;

    const input = cell.querySelector('input');
    if (!input) return;

    input.focus();
    input.select();

    input.addEventListener('click', (e) => e.stopPropagation());

    let isCommitted = false;
    const doCommit = () => {
      if (isCommitted) return;
      isCommitted = true;
      this.commitCell(cell);
    };

    input.addEventListener('blur', () => {
      doCommit();
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        doCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        isCommitted = true;
        this.cancelEditCell(cell, currentVal);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        doCommit();
        this.focusNextEditableCell(cell, e.shiftKey);
      }
    });
  },

  commitCell(cell) {
    if (!cell || !cell.querySelector('input')) return;

    const input = cell.querySelector('input');
    const empId = cell.getAttribute('data-emp-id');
    const field = cell.getAttribute('data-field');
    const rows = this.getCurrentRows();
    const row = rows.find((r) => r.id === empId);
    if (!row) return;

    const rawVal = parseFloat(input.value);
    const newVal = isNaN(rawVal) || rawVal < 0 ? 0 : Math.round(rawVal * 100) / 100;
    const oldVal = row[field];

    row[field] = newVal;
    row.netPay = this.computeNetPay(row);
    this.saveData(this.activeMonth);

    if (newVal !== oldVal) {
      this.editedCells.add(`${empId}_${field}`);
      cell.classList.add('payroll-cell-edited');
    }

    cell.innerHTML = `<span class="payroll-cell-display" id="cellDisplay_${empId}_${field}">${this.formatMoney(newVal)}</span>`;
    cell.setAttribute('tabindex', '0');

    // Update net pay display
    const netEl = document.getElementById(`netPayDisplay_${empId}`);
    if (netEl) netEl.textContent = this.formatMoney(row.netPay);

    this.activeEditCell = null;
    this.updateTotalsInDOM();
  },

  cancelEditCell(cell, originalVal) {
    if (!cell) return;
    const empId = cell.getAttribute('data-emp-id');
    const field = cell.getAttribute('data-field');
    cell.innerHTML = `<span class="payroll-cell-display" id="cellDisplay_${empId}_${field}">${this.formatMoney(originalVal)}</span>`;
    cell.setAttribute('tabindex', '0');
    cell.focus();
    this.activeEditCell = null;
  },

  focusNextEditableCell(currentCell, reverse = false) {
    const cells = Array.from(document.querySelectorAll('.payroll-editable-cell'));
    const idx = cells.indexOf(currentCell);
    if (idx === -1) return;

    const targetIdx = reverse ? idx - 1 : idx + 1;
    if (targetIdx >= 0 && targetIdx < cells.length) {
      cells[targetIdx].focus();
      this.startEditCell(cells[targetIdx]);
    }
  },

  toggleRowSource(empId) {
    const canEdit = typeof PayrollCycleManager !== 'undefined' ? PayrollCycleManager.canEdit() : true;
    if (!canEdit) return;

    const rows = this.getCurrentRows();
    const row = rows.find((r) => r.id === empId);
    if (!row) return;

    row.source = row.source === 'INT' ? 'EXT' : 'INT';
    this.editedCells.add(`${empId}_source`);
    this.saveData(this.activeMonth);

    // Re-render table cleanly
    this.render();
  },

  updateTotalsInDOM() {
    const grouped = this.getGroupedRows();
    const allFiltered = this.getFilteredRows();
    const grandTotals = this.computeTotals(allFiltered);

    Object.keys(grouped).forEach((groupName) => {
      const rows = grouped[groupName];
      const gt = this.computeTotals(rows);
      const rowId = `groupTotals_${groupName.replace(/\s+/g, '_')}`;
      const groupRow = document.getElementById(rowId);
      if (!groupRow) return;

      const baseEl = groupRow.querySelector('.gt-base');
      const otEl = groupRow.querySelector('.gt-ot');
      const bonusEl = groupRow.querySelector('.gt-bonus');
      const salesEl = groupRow.querySelector('.gt-sales');
      const suppEl = groupRow.querySelector('.gt-supp');
      const dedEl = groupRow.querySelector('.gt-ded');
      const netEl = groupRow.querySelector('.gt-net');

      if (baseEl) baseEl.textContent = this.formatMoney(gt.baseSalary);
      if (otEl) otEl.textContent = this.formatMoney(gt.overtime);
      if (bonusEl) bonusEl.textContent = this.formatMoney(gt.bonus);
      if (salesEl) salesEl.textContent = this.formatMoney(gt.salesComm);
      if (suppEl) suppEl.textContent = this.formatMoney(gt.supportComm);
      if (dedEl) dedEl.textContent = '-' + this.formatMoney(gt.deductions);
      if (netEl) netEl.textContent = this.formatMoney(gt.netPay);
    });

    const gBase = document.getElementById('grandTotalBase');
    const gOT = document.getElementById('grandTotalOT');
    const gBonus = document.getElementById('grandTotalBonus');
    const gSales = document.getElementById('grandTotalSales');
    const gSupp = document.getElementById('grandTotalSupp');
    const gDed = document.getElementById('grandTotalDed');
    const gNet = document.getElementById('grandTotalNet');

    if (gBase) gBase.textContent = this.formatMoney(grandTotals.baseSalary);
    if (gOT) gOT.textContent = this.formatMoney(grandTotals.overtime);
    if (gBonus) gBonus.textContent = this.formatMoney(grandTotals.bonus);
    if (gSales) gSales.textContent = this.formatMoney(grandTotals.salesComm);
    if (gSupp) gSupp.textContent = this.formatMoney(grandTotals.supportComm);
    if (gDed) gDed.textContent = '-' + this.formatMoney(grandTotals.deductions);
    if (gNet) gNet.textContent = this.formatMoney(grandTotals.netPay);
  }
};

window.PayrollTableController = PayrollTableController;
