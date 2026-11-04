// Official holidays: the admin page manages them, the employee page lists them,
// and the leave preview in vacations.js skips them (the server recomputes the days).
const HolidaysState = { year: new Date().getFullYear(), editingId: null };
window.holidayDateSet = window.holidayDateSet || new Set();

function canWriteHolidays() {
  return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.vacation.write');
}

function holidayDayCount(h) {
  return Math.round((new Date(h.end_date) - new Date(h.start_date)) / 86400000) + 1;
}

function holidayDatesText(h) {
  return h.start_date === h.end_date
    ? fmtDateShort(h.start_date)
    : `${fmtDateShort(h.start_date)} – ${fmtDateShort(h.end_date)}`;
}

function fillHolidayYearSelects() {
  const now = new Date().getFullYear();
  const options = [now - 1, now, now + 1, now + 2]
    .map(y => `<option value="${y}"${y === HolidaysState.year ? ' selected' : ''}>${y}</option>`).join('');
  ['adminHolidayYear', 'empHolidayYear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = options;
  });
}

async function renderHolidays() {
  fillHolidayYearSelects();
  const adminBody = document.getElementById('adminHolidaysBody');
  const empBody = document.getElementById('empHolidaysBody');
  if (!adminBody && !empBody) return;
  let list = [];
  try {
    list = await Api.getHolidays(HolidaysState.year);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
  const canWrite = canWriteHolidays();
  const addBtn = document.getElementById('btnAddHoliday');
  if (addBtn) addBtn.hidden = !canWrite;

  const row = (h, actions) => {
    const days = holidayDayCount(h);
    return `<tr>
      <td data-label="Holiday" class="tname">${escapeHtml(h.name)}</td>
      <td data-label="Dates">${escapeHtml(holidayDatesText(h))}</td>
      <td data-label="Days" class="hv-right">${days} ${days === 1 ? 'day' : 'days'}</td>
      ${actions}
    </tr>`;
  };
  if (adminBody) {
    adminBody.innerHTML = list.length
      ? list.map(h => row(h, canWrite
        ? `<td class="col-actions hv-right">
            <button type="button" class="btn btn-sm btn-edit-holiday" data-id="${h.id}" onclick="openHolidayModal(${h.id})">Edit</button>
            <button type="button" class="btn btn-sm btn-delete-holiday" data-id="${h.id}" onclick="deleteHoliday(${h.id})">Delete</button>
          </td>`
        : '<td></td>')).join('')
      : renderEmptyTableRow(4, `No official holidays added for ${HolidaysState.year}.`, 'fa-solid fa-flag');
  }
  if (empBody) {
    empBody.innerHTML = list.length
      ? list.map(h => row(h, '')).join('')
      : renderEmptyTableRow(3, `No official holidays for ${HolidaysState.year}.`, 'fa-solid fa-flag');
  }
  window._holidayList = list;
}

function onHolidayYearChange(value) {
  HolidaysState.year = Number(value) || new Date().getFullYear();
  renderHolidays();
}

// Days the leave preview should skip: this year and next.
async function ensureHolidayDates(onReady) {
  const now = new Date().getFullYear();
  const set = new Set();
  try {
    for (const year of [now, now + 1]) {
      (await Api.getHolidays(year)).forEach(h => {
        for (let d = new Date(h.start_date); d <= new Date(h.end_date); d.setUTCDate(d.getUTCDate() + 1)) {
          set.add(d.toISOString().slice(0, 10));
        }
      });
    }
    window.holidayDateSet = set;
  } catch (err) {
    // The preview is advisory; the server still excludes holidays.
  }
  if (typeof onReady === 'function') onReady();
}

function openHolidayModal(id = null) {
  const h = id == null ? null : (window._holidayList || []).find(x => x.id === id);
  HolidaysState.editingId = h ? h.id : null;
  document.getElementById('holidayModalTitle').textContent = h ? 'Edit holiday' : 'Add holiday';
  document.getElementById('holName').value = h ? h.name : '';
  document.getElementById('holStart').value = h ? h.start_date : '';
  document.getElementById('holEnd').value = h && h.end_date !== h.start_date ? h.end_date : '';
  FinanceForm.clearErrors('holidayModal');
  openModal('holidayModal');
}

async function saveHoliday(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('holidaySaveBtn');
  if (!FinanceForm.validateRequiredFields('holidayModal', [
    { id: 'holName', message: 'Enter the holiday name.' },
    { id: 'holStart', message: 'Select the first day.' },
  ])) return;
  const payload = {
    name: document.getElementById('holName').value.trim(),
    start_date: document.getElementById('holStart').value,
    end_date: document.getElementById('holEnd').value || null,
  };
  setButtonLoading(btn, true, 'Saving…');
  try {
    if (HolidaysState.editingId == null) await Api.createHoliday(payload);
    else await Api.updateHoliday(HolidaysState.editingId, payload);
    closeModal('holidayModal');
    toast('Holiday saved.', 'fa-solid fa-circle-check');
    await renderHolidays();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function deleteHoliday(id) {
  const h = (window._holidayList || []).find(x => x.id === id);
  const ok = await FinanceCommand.confirmAction({
    title: 'Delete holiday',
    consequence: `Delete ${h ? h.name : 'this holiday'}? New leave requests will count these days again. Existing requests keep their days.`,
    actionLabel: 'Delete holiday',
  });
  if (!ok.confirmed) return;
  try {
    await Api.deleteHoliday(id);
    toast('Holiday deleted.', 'fa-solid fa-trash');
    await renderHolidays();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
}
