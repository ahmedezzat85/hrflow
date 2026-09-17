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

// Global window assignments
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.onExportDatasetChange = onExportDatasetChange;
window.onExportPeriodTypeChange = onExportPeriodTypeChange;
window.toggleExportFormatFields = toggleExportFormatFields;
window.executeExport = executeExport;
