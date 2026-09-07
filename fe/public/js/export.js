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
  if (dataset === 'insurance' || dataset === 'invoices') {
    if (periodSection) periodSection.style.display = 'block';
  } else {
    if (periodSection) periodSection.style.display = 'none';
  }

  // Auto-generate suggested worksheet title
  if (worksheetInput) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const capitalized = dataset.charAt(0).toUpperCase() + dataset.slice(1);
    worksheetInput.placeholder = `${capitalized}_Export_${dateStr}`;
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
      toast(`Exported ${res.exported_rows} rows to Google Sheets worksheet "${res.worksheet_title}"!`, 'fa-solid fa-circle-check');
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
