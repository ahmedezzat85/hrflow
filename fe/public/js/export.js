/**
 * fe/public/js/export.js
 * Comprehensive data export controller for HRFlow.
 * Supports exporting to local CSV (Excel-compatible with UTF-8 BOM)
 * and direct export to Google Sheets worksheets.
 */

let currentExportStatus = null;

async function checkExportStatus() {
  try {
    const res = await Api.getExportStatus();
    currentExportStatus = res;
    const badge = document.getElementById('exportSheetsStatusBadge');
    if (badge) {
      if (res.google_sheets_available) {
        badge.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> Google Sheets Connected`;
        badge.style.color = 'var(--success)';
      } else {
        badge.innerHTML = `<i class="fa-solid fa-circle-info" style="color:var(--warning)"></i> Sheets: ${res.reason || 'Not configured'}`;
        badge.style.color = 'var(--warning)';
      }
    }
  } catch (err) {
    console.warn('Could not fetch export status:', err);
  }
}

function openExportModal(defaultDataset = 'employees') {
  const modal = document.getElementById('exportModal');
  if (!modal) return;

  const datasetSelect = document.getElementById('exportDatasetSelect');
  if (datasetSelect) {
    datasetSelect.value = defaultDataset;
  }

  // Pre-fill current year for filters
  const currentYear = new Date().getFullYear();
  const yearInput = document.getElementById('exportYearFilter');
  if (yearInput) {
    yearInput.value = currentYear;
  }

  // Reset format to CSV
  const csvRadio = document.getElementById('exportFormatCsv');
  if (csvRadio) {
    csvRadio.checked = true;
  }
  toggleExportFormatFields('csv');

  onExportDatasetChange();
  checkExportStatus();

  openModal('exportModal');
}

function closeExportModal() {
  closeModal('exportModal');
}

function onExportDatasetChange() {
  const dataset = document.getElementById('exportDatasetSelect')?.value || 'employees';
  const periodSection = document.getElementById('exportPeriodSection');
  const worksheetInput = document.getElementById('exportWorksheetTitle');

  // Show/hide period filtering based on dataset
  const dateFilterable = [
    'insurance', 'invoices', 'vacations',
    'finance_ledger', 'finance_invoices', 'finance_bills',
    'finance_cheques', 'finance_transfers'
  ];
  if (dateFilterable.includes(dataset)) {
    if (periodSection) periodSection.style.display = 'block';
  } else {
    if (periodSection) periodSection.style.display = 'none';
  }

  // Auto-generate suggested worksheet title
  if (worksheetInput) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const formattedName = dataset.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
    worksheetInput.placeholder = `${formattedName}_Export_${dateStr}`;
    worksheetInput.value = '';
  }
}

function onExportPeriodTypeChange() {
  const periodType = document.getElementById('exportPeriodType')?.value || 'all';
  const yearGroup = document.getElementById('exportYearGroup');
  const rangeGroup = document.getElementById('exportRangeGroup');

  if (yearGroup) yearGroup.style.display = periodType === 'year' ? 'block' : 'none';
  if (rangeGroup) rangeGroup.style.display = periodType === 'range' ? 'block' : 'none';
}

function toggleExportFormatFields(format) {
  const sheetsGroup = document.getElementById('exportSheetsGroup');
  if (sheetsGroup) {
    sheetsGroup.style.display = format === 'sheets' ? 'block' : 'none';
  }
}

function _downloadMockExportCsv(dataset) {
  let headers = [];
  let rows = [];

  if (dataset === 'finance_ledger') {
    headers = ['Transaction ID', 'Date', 'Type', 'Account', 'Category', 'Description', 'Debit USD', 'Credit USD', 'Balance After USD', 'Currency', 'Exchange Rate', 'Related Party', 'Status', 'Reference'];
    rows = [
      ['1', '2026-09-01', 'income', 'Arab Bank USD', 'Client Invoicing', 'Hospital DICOM Cloud subscription', '0.00', '15000.00', '15000.00', 'USD', '1.00', 'Metro General Hospital', 'POSTED', 'INV-2026-001'],
      ['2', '2026-09-03', 'expense', 'Arab Bank USD', 'SaaS & Cloud Hosting', 'AWS monthly infrastructure', '3200.00', '0.00', '11800.00', 'USD', '1.00', 'Amazon Web Services', 'POSTED', 'BILL-2026-042']
    ];
  } else if (dataset === 'finance_accounts') {
    headers = ['Account ID', 'Account Name', 'Account Type', 'Bank Name', 'Currency', 'Current Balance', 'Account Number Masked', 'IBAN', 'Swift Code', 'Status', 'Last Reconciled At'];
    rows = [
      ['3', 'Arab Bank USD', 'bank', 'Arab Bank', 'USD', '245000.00', '****1234', 'EG1234567890123456789012345', 'ARABEGCAXXX', 'ACTIVE', '2026-09-10'],
      ['4', 'Arab Bank EGP', 'bank', 'Arab Bank', 'EGP', '1850000.00', '****5678', 'EG9876543210987654321098765', 'ARABEGCAXXX', 'ACTIVE', '2026-09-10']
    ];
  } else if (dataset === 'finance_invoices') {
    headers = ['Invoice ID', 'Invoice Number', 'Customer Name', 'Issue Date', 'Due Date', 'Currency', 'Subtotal', 'Tax / VAT', 'Total Amount', 'Paid Amount', 'Remaining Due', 'Status'];
    rows = [
      ['1', 'INV-2026-001', 'Metro General Hospital', '2026-09-01', '2026-09-30', 'USD', '15000.00', '0.00', '15000.00', '15000.00', '0.00', 'PAID']
    ];
  } else if (dataset === 'finance_bills') {
    headers = ['Bill ID', 'Bill Number', 'Vendor Name', 'Issue Date', 'Due Date', 'Currency', 'Total Amount', 'Paid Amount', 'Remaining Due', 'Category', 'Status'];
    rows = [
      ['1', 'BILL-2026-042', 'Amazon Web Services', '2026-09-03', '2026-09-17', 'USD', '3200.00', '3200.00', '0.00', 'SaaS & Cloud', 'PAID']
    ];
  } else if (dataset === 'finance_cheques') {
    headers = ['Cheque ID', 'Cheque Number', 'Type', 'Bank Name', 'Issuer / Beneficiary', 'Due Date', 'Amount', 'Currency', 'Status', 'Custody Location'];
    rows = [
      ['1', 'CHQ-882190', 'INWARD', 'CIB Egypt', 'Delta Medical Center', '2026-10-15', '45000.00', 'EGP', 'IN_VAULT', 'Cairo Safe Box A']
    ];
  } else if (dataset === 'finance_transfers') {
    headers = ['Transfer ID', 'Date', 'From Account', 'From Amount', 'From Currency', 'To Account', 'To Amount', 'To Currency', 'FX Rate', 'Transfer Fee', 'Transfer Type', 'Exchange Reference', 'Settlement Status'];
    rows = [
      ['1', '2026-09-05', 'Arab Bank USD', '10000.00', 'USD', 'Arab Bank EGP', '485000.00', 'EGP', '48.50', '25.00', 'FX_CONVERSION', 'FX-ARB-9921', 'SETTLED']
    ];
  } else if (dataset === 'finance_subscriptions') {
    headers = ['Subscription ID', 'Tool / Name', 'Vendor', 'Amount', 'Currency', 'Billing Cycle', 'Monthly Equivalent', 'Department', 'Owner', 'Payment Method', 'Payment Account', 'Next Renewal Date', 'Status'];
    rows = [
      ['1', 'AWS Cloud Infrastructure', 'Amazon Web Services', '3200.00', 'USD', 'monthly', '3200.00', 'Engineering', 'DevOps Team', 'Corporate Card', 'Arab Bank USD', '2026-10-01', 'Active'],
      ['2', 'Google Workspace', 'Google LLC', '450.00', 'USD', 'monthly', '450.00', 'IT', 'Admin', 'Direct Debit', 'Arab Bank USD', '2026-10-05', 'Active']
    ];
  } else {
    headers = ['ID', 'Name', 'Description', 'Created Date'];
    rows = [['1', 'Sample HR Record', 'Exported via HRFlow Mock Mode', '2026-09-14']];
  }

  const csvLines = [headers.join(',')];
  rows.forEach(r => csvLines.push(r.map(cell => `"${cell}"`).join(',')));
  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hrflow_${dataset}_mock_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function executeExport() {
  const btn = document.getElementById('executeExportBtn');
  const dataset = document.getElementById('exportDatasetSelect')?.value || 'employees';
  const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'csv';

  const params = {};
  const periodSection = document.getElementById('exportPeriodSection');
  if (periodSection && periodSection.style.display !== 'none') {
    const periodType = document.getElementById('exportPeriodType')?.value || 'all';
    if (periodType === 'year') {
      const y = document.getElementById('exportYearFilter')?.value;
      if (y) params.year = parseInt(y, 10);
    } else if (periodType === 'range') {
      const start = document.getElementById('exportStartDateFilter')?.value;
      const end = document.getElementById('exportEndDateFilter')?.value;
      if (start) params.start_date = start;
      if (end) params.end_date = end;
    }
  }

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Exporting...`;
  }

  // Check for mock mode fallback
  if (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) {
    if (format === 'csv') {
      _downloadMockExportCsv(dataset);
      toast(`Exported ${dataset} (Mock) to CSV successfully!`, 'fa-solid fa-circle-check');
      closeExportModal();
    } else {
      toast(`Mock Google Sheets export for "${dataset}" simulated successfully!`, 'fa-solid fa-circle-check');
      closeExportModal();
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
    return;
  }

  try {
    if (format === 'csv') {
      await Api.downloadExportCsv(dataset, params);
      toast(`Exported ${dataset} to CSV successfully!`, 'fa-solid fa-circle-check');
      closeExportModal();
    } else {
      const titleInput = document.getElementById('exportWorksheetTitle');
      let worksheetTitle = titleInput ? titleInput.value.trim() : '';
      if (!worksheetTitle && titleInput && titleInput.placeholder) {
        worksheetTitle = titleInput.placeholder;
      }
      const body = {
        worksheet_title: worksheetTitle,
        ...params,
      };
      const res = await Api.exportToGoogleSheets(dataset, body);
      toast(`Exported ${res.rows_count || res.exported_rows || 0} rows to Google Sheets worksheet "${res.worksheet_title}"!`, 'fa-solid fa-circle-check');
      closeExportModal();
    }
  } catch (err) {
    toast(err.message || 'Export failed', 'fa-solid fa-triangle-exclamation');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

// ==========================================
// Payroll Specific Exports (Excel / PDF)
// ==========================================

function exportToExcel(payrollRows, filename = 'payroll_worksheet') {
  const rows = payrollRows || (typeof PayrollTableController !== 'undefined' ? PayrollTableController.getCurrentRows() : []);
  const month = typeof PayrollCycleManager !== 'undefined' ? PayrollCycleManager.getCurrentMonth() : 'current';
  const fname = `${filename}_${month}.csv`;

  // Headers
  const csvLines = [
    ['Account Group', 'Employee ID', 'Name', 'Department', 'Base Salary', 'Overtime', 'Bonus', 'Sales Comm.', 'Support Comm.', 'Source', 'Deductions', 'Net Pay'].map(c => `"${c}"`).join(',')
  ];

  // Group by account
  const groups = {};
  rows.forEach((r) => {
    const acc = r.account || 'General';
    if (!groups[acc]) groups[acc] = [];
    groups[acc].push(r);
  });

  let grandBase = 0, grandOT = 0, grandBonus = 0, grandSales = 0, grandSupp = 0, grandDed = 0, grandNet = 0;

  Object.keys(groups).forEach((groupName) => {
    const groupRows = groups[groupName];
    let gBase = 0, gOT = 0, gBonus = 0, gSales = 0, gSupp = 0, gDed = 0, gNet = 0;

    csvLines.push(`"-- Account Group: ${groupName} --",,,,,,,,,,,`);

    groupRows.forEach((r) => {
      const base = Number(r.baseSalary || 0);
      const ot = Number(r.overtime || 0);
      const bonus = Number(r.bonus || 0);
      const sales = Number(r.salesComm || 0);
      const supp = Number(r.supportComm || 0);
      const ded = Number(r.deductions || 0);
      const net = Number(r.netPay || 0);

      gBase += base; gOT += ot; gBonus += bonus; gSales += sales; gSupp += supp; gDed += ded; gNet += net;

      csvLines.push([
        `"${groupName}"`,
        `"${r.id}"`,
        `"${r.name}"`,
        `"${r.department}"`,
        base.toFixed(2),
        ot.toFixed(2),
        bonus.toFixed(2),
        sales.toFixed(2),
        supp.toFixed(2),
        `"${r.source}"`,
        ded.toFixed(2),
        net.toFixed(2)
      ].join(','));
    });

    // Group Total Row
    csvLines.push([
      `"TOTAL (${groupName})"`,
      '""', '""', '""',
      gBase.toFixed(2),
      gOT.toFixed(2),
      gBonus.toFixed(2),
      gSales.toFixed(2),
      gSupp.toFixed(2),
      '""',
      gDed.toFixed(2),
      gNet.toFixed(2)
    ].join(','));

    csvLines.push(''); // blank row between groups

    grandBase += gBase; grandOT += gOT; grandBonus += gBonus;
    grandSales += gSales; grandSupp += gSupp; grandDed += gDed; grandNet += gNet;
  });

  // Grand Total Row
  csvLines.push([
    '"GRAND TOTAL"',
    '""', '""', '""',
    grandBase.toFixed(2),
    grandOT.toFixed(2),
    grandBonus.toFixed(2),
    grandSales.toFixed(2),
    grandSupp.toFixed(2),
    '""',
    grandDed.toFixed(2),
    grandNet.toFixed(2)
  ].join(','));

  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (typeof showToast === 'function') {
    showToast(`Payroll worksheet exported to ${fname}`, 'success');
  }
}

function exportToPDF(payrollRows, title = 'Payroll Worksheet') {
  const rows = payrollRows || (typeof PayrollTableController !== 'undefined' ? PayrollTableController.getCurrentRows() : []);
  const month = typeof PayrollCycleManager !== 'undefined' ? PayrollCycleManager.getCurrentMonth() : 'current';

  const groups = {};
  rows.forEach((r) => {
    const acc = r.account || 'General';
    if (!groups[acc]) groups[acc] = [];
    groups[acc].push(r);
  });

  let sectionsHtml = '';
  Object.keys(groups).forEach((groupName) => {
    const groupRows = groups[groupName];
    let gBase = 0, gOT = 0, gBonus = 0, gSales = 0, gSupp = 0, gDed = 0, gNet = 0;

    let rowsHtml = '';
    groupRows.forEach((r) => {
      const base = Number(r.baseSalary || 0);
      const ot = Number(r.overtime || 0);
      const bonus = Number(r.bonus || 0);
      const sales = Number(r.salesComm || 0);
      const supp = Number(r.supportComm || 0);
      const ded = Number(r.deductions || 0);
      const net = Number(r.netPay || 0);

      gBase += base; gOT += ot; gBonus += bonus; gSales += sales; gSupp += supp; gDed += ded; gNet += net;

      rowsHtml += `
        <tr>
          <td><strong>${r.name}</strong><br><small style="color:#666;">${r.id} · ${r.department}</small></td>
          <td style="text-align:right;">$${base.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right;">$${ot.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right;">$${bonus.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right;">$${sales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right;">$${supp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:center;"><span style="padding:2px 6px; border:1px solid #999; border-radius:4px; font-size:11px;">${r.source}</span></td>
          <td style="text-align:right; color:#c00;">-$${ded.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right; font-weight:bold;">$${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    });

    sectionsHtml += `
      <div class="account-group-page" style="page-break-after:always; margin-bottom:30px;">
        <h3 style="margin-top:20px; border-bottom:2px solid #2563EB; padding-bottom:6px; color:#1E293B;">
          Account Group: ${groupName} <span style="font-size:13px; font-weight:normal; color:#64748B;">(${groupRows.length} staff)</span>
        </h3>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:10px;">
          <thead>
            <tr style="background:#F1F5F9; text-align:left; border-bottom:1px solid #CBD5E1;">
              <th style="padding:8px;">Employee</th>
              <th style="padding:8px; text-align:right;">Base</th>
              <th style="padding:8px; text-align:right;">OT</th>
              <th style="padding:8px; text-align:right;">Bonus</th>
              <th style="padding:8px; text-align:right;">Sales Comm</th>
              <th style="padding:8px; text-align:right;">Supp Comm</th>
              <th style="padding:8px; text-align:center;">Source</th>
              <th style="padding:8px; text-align:right;">Deductions</th>
              <th style="padding:8px; text-align:right;">Net Pay</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr style="background:#F8FAFC; font-weight:bold; border-top:2px solid #94A3B8;">
              <td style="padding:8px;">TOTAL (${groupName})</td>
              <td style="padding:8px; text-align:right;">$${gBase.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:right;">$${gOT.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:right;">$${gBonus.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:right;">$${gSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:right;">$${gSupp.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:center;">—</td>
              <td style="padding:8px; text-align:right; color:#c00;">-$${gDed.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px; text-align:right; color:#2563EB;">$${gNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  });

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>HRFlow Payroll - ${month}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; color: #0F172A; }
          table, th, td { border-bottom: 1px solid #E2E8F0; }
          th, td { padding: 8px 6px; }
          @media print {
            .account-group-page { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #0F172A; padding-bottom:12px;">
          <div>
            <h1 style="margin:0; font-size:22px; color:#2563EB;">HRFlow — Payroll Worksheet</h1>
            <p style="margin:4px 0 0 0; color:#64748B; font-size:14px;">Cycle Period: <strong>${month}</strong></p>
          </div>
          <div style="text-align:right; font-size:12px; color:#64748B;">
            Voyance Health HRFlow<br>Generated: ${new Date().toLocaleDateString()}
          </div>
        </div>
        ${sectionsHtml}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      try {
        printWindow.print();
      } catch (_) {}
    }, 250);
  }

  if (typeof showToast === 'function') {
    showToast(`Payroll print preview generated for ${month}`, 'info');
  }
}

function togglePayrollExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('payrollExportMenuContent');
  if (!menu) return;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function closePayrollExportMenu() {
  const menu = document.getElementById('payrollExportMenuContent');
  if (menu) menu.style.display = 'none';
}

function triggerPayrollExcelExport() {
  exportToExcel();
}

function triggerPayrollPdfExport() {
  exportToPDF();
}

// Close export menu on window click
if (typeof window !== 'undefined') {
  window.addEventListener('click', (e) => {
    if (!e.target.closest('#payrollExportDropdown')) {
      closePayrollExportMenu();
    }
  });
}

// Global window assignments
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.onExportDatasetChange = onExportDatasetChange;
window.onExportPeriodTypeChange = onExportPeriodTypeChange;
window.toggleExportFormatFields = toggleExportFormatFields;
window.executeExport = executeExport;
window.exportToExcel = exportToExcel;
window.exportToPDF = exportToPDF;
window.togglePayrollExportMenu = togglePayrollExportMenu;
window.closePayrollExportMenu = closePayrollExportMenu;
window.triggerPayrollExcelExport = triggerPayrollExcelExport;
window.triggerPayrollPdfExport = triggerPayrollPdfExport;

