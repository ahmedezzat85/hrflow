// ==========================================
// Revenue sources (Settings) and "Record revenue receipt" (X4, D-029)
// ==========================================
async function loadRevenueSources() {
  try {
    FinanceState.revenueSources = await FinanceApi.getRevenueSources();
    renderRevenueSources(FinanceState.revenueSources);
  } catch (err) {
    toast("Failed to load revenue sources: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  }
}

function renderRevenueSources(list) {
  const tbody = document.getElementById("financeRevenueSourcesTableBody");
  if (!tbody) return;
  const esc = FinanceUI.esc;
  tbody.innerHTML = (list || []).map((s) => `
    <tr data-source-id="${s.id}">
      <td data-label="Source"><strong class="fv-strong-ink">${esc(s.name)}</strong>${s.is_system ? ' <span class="fv-sub">System</span>' : ""}</td>
      <td data-label="Code"><span class="fv-muted">${esc(s.code)}</span></td>
      <td data-label="Status">${FinanceUI.statusPill(s.is_active ? "active" : "inactive", s.is_active ? "Active" : "Inactive", "", "status-badge-wrap")}</td>
      <td class="col-actions">${FinanceUI.rowActions({
        primary: { label: "Edit", kind: "outline", className: "btn-source-edit", onclick: `openEditRevenueSourceModal(${s.id})`, attrs: 'title="Edit Source"' },
        icons: s.is_system ? [{ slot: true }] : [{ icon: s.is_active ? "fa-power-off" : "fa-check", label: s.is_active ? "Deactivate Source" : "Reactivate Source", className: s.is_active ? "fv-icon-btn--danger btn-source-toggle" : "btn-source-toggle", onclick: `toggleRevenueSourceActive(${s.id}, ${s.is_active})` }],
      })}</td>
    </tr>`).join("");
}

function openAddRevenueSourceModal() {
  FinanceForm.clearErrors("revenueSourceModal");
  document.getElementById("revenueSourceModalTitle").textContent = "Add Revenue Source";
  document.getElementById("fRevenueSourceId").value = "";
  document.getElementById("fRevenueSourceName").value = "";
  document.getElementById("fRevenueSourceCode").value = "";
  document.getElementById("fRevenueSourceCode").disabled = false;
  openModal("revenueSourceModal");
}

function openEditRevenueSourceModal(id) {
  FinanceForm.clearErrors("revenueSourceModal");
  const s = (FinanceState.revenueSources || []).find((x) => x.id === Number(id));
  if (!s) return;
  document.getElementById("revenueSourceModalTitle").textContent = "Edit Revenue Source";
  document.getElementById("fRevenueSourceId").value = s.id;
  document.getElementById("fRevenueSourceName").value = s.name;
  document.getElementById("fRevenueSourceCode").value = s.code;
  document.getElementById("fRevenueSourceCode").disabled = true; // the code is the stable key
  openModal("revenueSourceModal");
}

async function saveRevenueSource() {
  const idVal = document.getElementById("fRevenueSourceId").value;
  const ok = FinanceForm.validateRequiredFields("revenueSourceModal", [
    { id: "fRevenueSourceName", label: "Source name" },
    { id: "fRevenueSourceCode", label: "Source code" },
  ]);
  if (!ok) return;
  const name = document.getElementById("fRevenueSourceName").value.trim();
  const btn = document.getElementById("revenueSourceSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (idVal) {
      await FinanceApi.updateRevenueSource(Number(idVal), { name });
      toast("Revenue source updated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createRevenueSource({ name, code: document.getElementById("fRevenueSourceCode").value.trim() });
      toast("Revenue source created", "fa-solid fa-circle-check");
    }
    closeModal("revenueSourceModal");
    await loadRevenueSources();
  } catch (err) {
    toast(err.message || "Failed to save revenue source", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleRevenueSourceActive(id, currentActive) {
  try {
    await FinanceApi.updateRevenueSource(Number(id), { is_active: !currentActive });
    toast(currentActive ? "Source deactivated" : "Source reactivated", "fa-solid fa-circle-check");
    await loadRevenueSources();
  } catch (err) {
    toast(err.message || "Failed to update source", "fa-solid fa-triangle-exclamation");
  }
}

// ---- Record revenue receipt
async function openRevenueReceiptModal() {
  FinanceForm.clearErrors("revenueReceiptModal");
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }
  const [sources, products] = await Promise.all([
    FinanceApi.getRevenueSources({ is_active: true }).catch(() => []),
    FinanceApi.getProducts({ is_active: true }).catch(() => []),
  ]);
  const accounts = (FinanceState.accounts || []).filter((a) => a.is_active);
  const esc = FinanceUI.esc;
  document.getElementById("fReceiptAccount").innerHTML = '<option value="">Select an account</option>' +
    accounts.map((a) => `<option value="${a.id}" data-currency="${esc(a.currency)}">${esc(a.account_name)} (${esc(a.currency)}${a.book_name ? ` · ${esc(a.book_name)}` : ""})</option>`).join("");
  document.getElementById("fReceiptSource").innerHTML = sources.filter((s) => s.code !== "invoice").map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  document.getElementById("fReceiptProduct").innerHTML = '<option value="">No product (untagged)</option>' + products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  document.getElementById("fReceiptDate").value = new Date().toISOString().split("T")[0];
  ["fReceiptAmount", "fReceiptPeriodStart", "fReceiptPeriodEnd", "fReceiptGross", "fReceiptFee", "fReceiptReference"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("fReceiptFile").value = "";
  document.getElementById("fReceiptCurrency").textContent = "";
  openModal("revenueReceiptModal");
}

function onReceiptAccountChanged() {
  const opt = document.getElementById("fReceiptAccount").selectedOptions[0];
  document.getElementById("fReceiptCurrency").textContent = opt && opt.dataset.currency ? `(${opt.dataset.currency})` : "";
}

async function saveRevenueReceipt() {
  const ok = FinanceForm.validateRequiredFields("revenueReceiptModal", [
    { id: "fReceiptAccount", label: "Account" },
    { id: "fReceiptDate", label: "Date" },
    { id: "fReceiptAmount", label: "Amount", check: (v) => parseFloat(v) > 0, message: "Please enter an amount greater than 0." },
    { id: "fReceiptSource", label: "Source" },
  ]);
  if (!ok) return;
  const opt = document.getElementById("fReceiptAccount").selectedOptions[0];
  const num = (id) => { const v = document.getElementById(id).value; return v === "" ? null : parseFloat(v); };
  const payload = {
    account_id: parseInt(document.getElementById("fReceiptAccount").value, 10),
    date: document.getElementById("fReceiptDate").value,
    amount: parseFloat(document.getElementById("fReceiptAmount").value),
    currency: opt.dataset.currency,
    revenue_source_id: parseInt(document.getElementById("fReceiptSource").value, 10),
    product_id: document.getElementById("fReceiptProduct").value ? parseInt(document.getElementById("fReceiptProduct").value, 10) : null,
    period_start: document.getElementById("fReceiptPeriodStart").value || null,
    period_end: document.getElementById("fReceiptPeriodEnd").value || null,
    memo_gross_amount: num("fReceiptGross"),
    memo_fee_amount: num("fReceiptFee"),
    reference: document.getElementById("fReceiptReference").value.trim(),
  };
  const btn = document.getElementById("revenueReceiptSaveBtn");
  if (btn) btn.disabled = true;
  try {
    const created = await FinanceApi.createRevenueReceipt(payload);
    const file = document.getElementById("fReceiptFile").files[0];
    let attachFailed = false;
    if (file) {
      try { await FinanceApi.uploadRevenueReceiptAttachment(created.id, file); } catch (_) { attachFailed = true; }
    }
    toast(attachFailed ? "Receipt recorded, but the attachment upload failed." : "Revenue receipt recorded.", attachFailed ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-check");
    closeModal("revenueReceiptModal");
    FinanceState.accounts = await FinanceApi.getAccounts();
    if (typeof renderFinanceAccounts === "function") renderFinanceAccounts(FinanceState.accounts);
  } catch (err) {
    toast(err.message || "Failed to record the receipt", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.loadRevenueSources = loadRevenueSources;
window.openAddRevenueSourceModal = openAddRevenueSourceModal;
window.openEditRevenueSourceModal = openEditRevenueSourceModal;
window.saveRevenueSource = saveRevenueSource;
window.toggleRevenueSourceActive = toggleRevenueSourceActive;
window.openRevenueReceiptModal = openRevenueReceiptModal;
window.onReceiptAccountChanged = onReceiptAccountChanged;
window.saveRevenueReceipt = saveRevenueReceipt;
