// Import review: historical leave and work from home that Claude found in old emails and scans (D-051).
// Items are staged on the server; nothing counts as leave until a person accepts it here.
const HistoryImportState = { batches: [], batchId: null, items: [], filter: 'staged', editingId: null };

function canReviewHistoryImport() {
  return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.history_import.review');
}

function historyConfidencePill(c) {
  const tone = c === 'high' ? 'success' : c === 'medium' ? 'info' : 'warning';
  return `<span class="badge-pill pill-${tone}">${escapeHtml(sentenceCase(c))} confidence</span>`;
}

function historyCheckCell(item) {
  if (item.status === 'accepted') return '<span class="badge-pill pill-success">Accepted</span>';
  if (item.status === 'rejected') {
    return `<span class="badge-pill pill-neutral">Rejected</span>${item.reject_reason ? `<div class="hv-stat-sub">${escapeHtml(item.reject_reason)}</div>` : ''}`;
  }
  const lines = [];
  item.blocked_by.forEach(t => lines.push(`<div class="hv-stat-sub hi-blocked">${escapeHtml(t)}</div>`));
  item.warnings.forEach(t => lines.push(`<div class="hv-stat-sub hi-warning">${escapeHtml(t)}</div>`));
  const head = item.blocked_by.length
    ? '<span class="badge-pill pill-danger">Blocked</span>'
    : item.warnings.length ? '<span class="badge-pill pill-warning">Conflict</span>' : historyConfidencePill(item.confidence);
  return head + lines.join('');
}

function historyIsClear(item) {
  return item.status === 'staged' && item.confidence === 'high' && !item.blocked_by.length && !item.warnings.length;
}

function fillHistoryBatchSelect() {
  const el = document.getElementById('hiBatchSelect');
  if (!el) return;
  el.innerHTML = HistoryImportState.batches.map(b =>
    `<option value="${b.id}"${b.id === HistoryImportState.batchId ? ' selected' : ''}>${escapeHtml(b.label)} (${b.counts.staged} waiting)</option>`
  ).join('');
}

function renderHistoryItems() {
  const body = document.getElementById('hiItemsBody');
  if (!body) return;
  const canReview = canReviewHistoryImport();
  const items = HistoryImportState.items.filter(i => HistoryImportState.filter === 'all' || i.status === 'staged');
  const safeBtn = document.getElementById('hiAcceptSafeBtn');
  if (safeBtn) {
    const n = HistoryImportState.items.filter(historyIsClear).length;
    safeBtn.hidden = !canReview;
    safeBtn.disabled = n === 0;
    safeBtn.textContent = n ? `Accept ${n} clear ${n === 1 ? 'item' : 'items'}` : 'Accept clear items';
  }
  if (!items.length) {
    body.innerHTML = renderEmptyTableRow(7, HistoryImportState.batches.length ? 'Nothing is waiting for review in this batch.' : 'No imported items yet.', 'fa-solid fa-inbox');
    return;
  }
  body.innerHTML = items.map(i => {
    const staged = i.status === 'staged';
    const actions = staged && canReview
      ? `<td class="col-actions hv-right">
          <button type="button" class="btn btn-sm btn-fill btn-hi-accept" data-id="${i.id}" onclick="acceptHistoryItem(${i.id})"${i.blocked_by.length ? ' disabled' : ''}>Accept</button>
          <button type="button" class="btn btn-sm btn-hi-edit" data-id="${i.id}" onclick="openHistoryItemModal(${i.id})">Edit</button>
          <button type="button" class="btn btn-sm btn-hi-reject" data-id="${i.id}" onclick="rejectHistoryItem(${i.id})">Reject</button>
        </td>`
      : '<td></td>';
    const dates = i.start_date === i.end_date ? fmtDateShort(i.start_date) : `${fmtDateShort(i.start_date)} – ${fmtDateShort(i.end_date)}`;
    return `<tr data-item-id="${i.id}">
      <td data-label="Employee" class="tname">${escapeHtml(i.employee_name)}</td>
      <td data-label="Leave">${escapeHtml(i.leave_type)}</td>
      <td data-label="Dates">${escapeHtml(dates)}<div class="hv-stat-sub">${i.days} ${i.days === 1 ? 'day' : 'days'}</div></td>
      <td data-label="Decision">${escapeHtml(i.decision)}${i.decided_by ? `<div class="hv-stat-sub">by ${escapeHtml(i.decided_by)}</div>` : ''}</td>
      <td data-label="Source">${escapeHtml(sentenceCase(i.source_kind))}: ${escapeHtml(i.source_ref)}${i.evidence_excerpt ? `<div class="hv-stat-sub">“${escapeHtml(i.evidence_excerpt)}”</div>` : ''}</td>
      <td data-label="Check">${historyCheckCell(i)}</td>
      ${actions}
    </tr>`;
  }).join('');
}

async function loadHistoryBatch(id) {
  HistoryImportState.batchId = id;
  if (id == null) {
    HistoryImportState.items = [];
    return renderHistoryItems();
  }
  try {
    HistoryImportState.items = (await Api.getHistoryImportBatch(id)).items;
  } catch (err) {
    HistoryImportState.items = [];
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
  renderHistoryItems();
}

async function renderHistoryImport() {
  const canSee = typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.history_import.read');
  if (!canSee) return;
  try {
    HistoryImportState.batches = await Api.getHistoryImportBatches();
  } catch (err) {
    HistoryImportState.batches = [];
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
  const stillThere = HistoryImportState.batches.some(b => b.id === HistoryImportState.batchId);
  const firstWaiting = HistoryImportState.batches.find(b => b.counts.staged > 0) || HistoryImportState.batches[0];
  HistoryImportState.batchId = stillThere ? HistoryImportState.batchId : (firstWaiting ? firstWaiting.id : null);
  fillHistoryBatchSelect();
  await loadHistoryBatch(HistoryImportState.batchId);
}

async function onHistoryBatchChange(value) {
  await loadHistoryBatch(Number(value));
  fillHistoryBatchSelect();
}

function onHistoryFilterChange(value) {
  HistoryImportState.filter = value;
  renderHistoryItems();
}

// A 409 carries the reasons the server refused; show them all.
function historyErrorText(err) {
  const reasons = err && err.detail && err.detail.reasons;
  return reasons && reasons.length ? reasons.join(' ') : err.message;
}

async function refreshHistoryAfterChange() {
  try {
    HistoryImportState.batches = await Api.getHistoryImportBatches();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
  fillHistoryBatchSelect();
  await loadHistoryBatch(HistoryImportState.batchId);
}

async function acceptHistoryItem(id) {
  try {
    await Api.acceptHistoryImportItem(id);
    toast('Leave recorded.', 'fa-solid fa-circle-check');
  } catch (err) {
    toast(historyErrorText(err), 'fa-solid fa-triangle-exclamation');
  }
  await refreshHistoryAfterChange();
}

async function rejectHistoryItem(id) {
  const item = HistoryImportState.items.find(i => i.id === id);
  const result = await FinanceCommand.confirmAction({
    title: 'Reject item',
    consequence: `Reject ${item ? item.leave_type : 'this item'} for ${item ? item.employee_name : 'this employee'}? No leave is recorded.`,
    actionLabel: 'Reject item',
    requireReason: true,
  });
  if (!result.confirmed) return;
  try {
    await Api.rejectHistoryImportItem(id, result.reason || '');
    toast('Item rejected.', 'fa-solid fa-ban');
  } catch (err) {
    toast(historyErrorText(err), 'fa-solid fa-triangle-exclamation');
  }
  await refreshHistoryAfterChange();
}

async function acceptSafeHistoryItems() {
  const clear = HistoryImportState.items.filter(historyIsClear);
  if (!clear.length) return;
  const result = await FinanceCommand.confirmAction({
    title: 'Accept clear items',
    consequence: `Record ${clear.length} ${clear.length === 1 ? 'leave' : 'leaves'} marked high confidence with no conflicts? The server checks each one again.`,
    actionLabel: `Accept ${clear.length}`,
    actionClass: 'btn btn-fill',
    severity: 'warning',
  });
  if (!result.confirmed) return;
  let done = 0;
  const failed = [];
  for (const item of clear) {
    try { await Api.acceptHistoryImportItem(item.id); done += 1; } catch (err) { failed.push(historyErrorText(err)); }
  }
  toast(failed.length ? `${done} accepted, ${failed.length} refused: ${failed[0]}` : `${done} accepted.`,
    failed.length ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-check');
  await refreshHistoryAfterChange();
}

function openHistoryItemModal(id) {
  const item = HistoryImportState.items.find(i => i.id === id);
  if (!item) return;
  HistoryImportState.editingId = id;
  document.getElementById('hiEditSubtitle').textContent = `${item.employee_name}: ${item.source_ref}`;
  document.getElementById('hiType').value = item.leave_type;
  document.getElementById('hiDecision').value = item.decision;
  document.getElementById('hiStart').value = item.start_date;
  document.getElementById('hiEnd').value = item.end_date;
  FinanceForm.clearErrors('historyItemModal');
  openModal('historyItemModal');
}

async function saveHistoryItemEdit(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('hiEditSaveBtn');
  if (!FinanceForm.validateRequiredFields('historyItemModal', [{ id: 'hiStart', message: 'Select the first day.' }])) return;
  const payload = {
    leave_type: document.getElementById('hiType').value,
    decision: document.getElementById('hiDecision').value,
    start_date: document.getElementById('hiStart').value,
    end_date: document.getElementById('hiEnd').value || null,
  };
  setButtonLoading(btn, true, 'Saving…');
  try {
    await Api.editHistoryImportItem(HistoryImportState.editingId, payload);
    closeModal('historyItemModal');
    toast('Item updated.', 'fa-solid fa-circle-check');
    await refreshHistoryAfterChange();
  } catch (err) {
    toast(historyErrorText(err), 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}
