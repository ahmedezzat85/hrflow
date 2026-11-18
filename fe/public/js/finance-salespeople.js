// ==========================================
// Sales commissions: Finance Settings > Salespeople, and the salesperson picker on the customer form
// ==========================================
let _currentSalespersonStatusFilter = "all";

async function loadFinanceSalespeople() {
  const bar = document.getElementById("financeSalespeopleLoadingBar");
  if (bar) bar.style.display = "block";
  try {
    FinanceState.salespeople = await FinanceApi.getSalespeople();
    renderFinanceSalespeople(FinanceState.salespeople);
  } catch (err) {
    console.error("Failed to load salespeople:", err);
    toast("Failed to load salespeople: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceSalespeople(filter) {
  _currentSalespersonStatusFilter = filter;
  renderFinanceSalespeople(FinanceState.salespeople || []);
}

function renderFinanceSalespeople(all) {
  const tbody = document.getElementById("financeSalespeopleTableBody");
  const empty = document.getElementById("financeSalespeopleEmpty");
  if (!tbody) return;
  const list = all || [];
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("spPillCountAll", list.length);
  setText("spPillCountActive", list.filter((s) => s.is_active).length);
  setText("spPillCountInactive", list.filter((s) => !s.is_active).length);
  document.querySelectorAll("#financeSalespersonStatusPills .fv-pill").forEach((p) => {
    p.classList.toggle("fv-pill--zero", !Number((p.querySelector(".fv-pill__count") || {}).textContent || 0));
    const on = p.dataset.filter === _currentSalespersonStatusFilter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on ? "true" : "false");
  });

  let items = list;
  if (_currentSalespersonStatusFilter === "active") items = items.filter((s) => s.is_active);
  else if (_currentSalespersonStatusFilter === "inactive") items = items.filter((s) => !s.is_active);

  if (!items.length) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const esc = FinanceUI.esc;
  const dash = '<span class="fv-muted">—</span>';
  tbody.innerHTML = items.map((s) => `
    <tr data-salesperson-id="${s.id}">
      <td data-label="Salesperson"><strong class="fv-strong-ink">${esc(s.name)}</strong></td>
      <td data-label="Email">${s.email ? esc(s.email) : dash}</td>
      <td data-label="Employee">${s.employee_name ? esc(s.employee_name) : dash}</td>
      <td data-label="Customers" class="fv-num">${s.customer_count || 0}</td>
      <td data-label="Status">${FinanceUI.statusPill(s.is_active ? "active" : "inactive", s.is_active ? "Active" : "Inactive", "", "status-badge-wrap")}</td>
      <td class="col-actions">${FinanceUI.rowActions({
        primary: { label: "Edit", kind: "outline", className: "btn-salesperson-edit", onclick: `openEditFinanceSalespersonModal(${s.id})`, attrs: 'title="Edit Salesperson"' },
        icons: [{ icon: s.is_active ? "fa-power-off" : "fa-check", label: s.is_active ? "Deactivate Salesperson" : "Reactivate Salesperson", className: s.is_active ? "fv-icon-btn--danger btn-salesperson-toggle" : "btn-salesperson-toggle", onclick: `toggleFinanceSalespersonActive(${s.id}, ${s.is_active})` }],
      })}</td>
    </tr>`).join("");
}

async function _fillSalespersonEmployeeOptions(selectedId) {
  const sel = document.getElementById("fSalespersonEmployee");
  if (!sel) return;
  let employees = [];
  try {
    if (typeof Api !== "undefined" && typeof Api.getEmployees === "function") employees = (await Api.getEmployees()) || [];
  } catch (_) { employees = []; }  // no HR access: the link stays optional
  const esc = FinanceUI.esc;
  sel.innerHTML = '<option value="">Not an employee</option>' + employees
    .map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
  sel.value = selectedId && employees.some((e) => Number(e.id) === Number(selectedId)) ? String(selectedId) : "";
}

async function openAddFinanceSalespersonModal() {
  FinanceForm.clearErrors("financeSalespersonModal");
  document.getElementById("financeSalespersonModalTitle").textContent = "Add Salesperson";
  document.getElementById("fSalespersonId").value = "";
  document.getElementById("fSalespersonName").value = "";
  document.getElementById("fSalespersonEmail").value = "";
  document.getElementById("fSalespersonNotes").value = "";
  await _fillSalespersonEmployeeOptions("");
  openModal("financeSalespersonModal");
}

async function openEditFinanceSalespersonModal(id) {
  FinanceForm.clearErrors("financeSalespersonModal");
  const s = (FinanceState.salespeople || []).find((x) => x.id === Number(id));
  if (!s) return;
  document.getElementById("financeSalespersonModalTitle").textContent = "Edit Salesperson";
  document.getElementById("fSalespersonId").value = s.id;
  document.getElementById("fSalespersonName").value = s.name;
  document.getElementById("fSalespersonEmail").value = s.email || "";
  document.getElementById("fSalespersonNotes").value = s.notes || "";
  await _fillSalespersonEmployeeOptions(s.employee_id);
  openModal("financeSalespersonModal");
}

async function saveFinanceSalesperson() {
  const idVal = document.getElementById("fSalespersonId").value;
  const ok = FinanceForm.validateRequiredFields("financeSalespersonModal", [{ id: "fSalespersonName", label: "Name" }]);
  if (!ok) return;
  const emp = document.getElementById("fSalespersonEmployee").value;
  const payload = {
    name: document.getElementById("fSalespersonName").value.trim(),
    email: document.getElementById("fSalespersonEmail").value.trim() || null,
    employee_id: emp ? parseInt(emp, 10) : null,
    notes: document.getElementById("fSalespersonNotes").value.trim() || null,
  };
  const btn = document.getElementById("financeSalespersonSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (idVal) {
      await FinanceApi.updateSalesperson(Number(idVal), payload);
      toast("Salesperson updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createSalesperson(payload);
      toast("Salesperson created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financeSalespersonModal");
    await loadFinanceSalespeople();
  } catch (err) {
    toast(err.message || "Failed to save salesperson", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleFinanceSalespersonActive(id, currentActive) {
  const s = (FinanceState.salespeople || []).find((x) => x.id === Number(id));
  const result = await FinanceCommand.confirmAction({
    title: `${currentActive ? "Deactivate" : "Reactivate"} Salesperson`,
    summary: s ? `<strong>${FinanceUI.esc(s.name)}</strong>` : `Salesperson #${id}`,
    consequence: currentActive
      ? "A deactivated salesperson cannot be chosen for more customers. Customers already linked keep earning commission, and past commissions are kept."
      : "Reactivating makes this salesperson selectable on customers again.",
    actionLabel: currentActive ? "Deactivate Salesperson" : "Reactivate Salesperson",
    actionClass: currentActive ? "btn btn-danger" : "btn btn-fill",
    requireReason: false,
    severity: currentActive ? "warning" : "info",
  });
  if (!result.confirmed) return;
  try {
    await FinanceApi.updateSalesperson(Number(id), { is_active: !currentActive });
    toast(currentActive ? "Salesperson deactivated" : "Salesperson reactivated", "fa-solid fa-circle-check");
    await loadFinanceSalespeople();
  } catch (err) {
    toast(err.message || "Failed to update salesperson", "fa-solid fa-triangle-exclamation");
  }
}

// Customer form: fill the salesperson picker (active ones, plus the customer's current one even if inactive)
async function fillCustomerSalespersonOptions(selectedId) {
  const sel = document.getElementById("fCustomerSalesperson");
  if (!sel) return;
  let list = [];
  try { list = (await FinanceApi.getSalespeople()) || []; } catch (_) { list = []; }
  const esc = FinanceUI.esc;
  const usable = list.filter((s) => s.is_active || Number(s.id) === Number(selectedId));
  sel.innerHTML = '<option value="">No salesperson</option>' + usable
    .map((s) => `<option value="${s.id}">${esc(s.name)}${s.is_active ? "" : " (inactive)"}</option>`).join("");
  sel.value = selectedId && usable.some((s) => Number(s.id) === Number(selectedId)) ? String(selectedId) : "";
}

window.loadFinanceSalespeople = loadFinanceSalespeople;
window.filterFinanceSalespeople = filterFinanceSalespeople;
window.openAddFinanceSalespersonModal = openAddFinanceSalespersonModal;
window.openEditFinanceSalespersonModal = openEditFinanceSalespersonModal;
window.saveFinanceSalesperson = saveFinanceSalesperson;
window.toggleFinanceSalespersonActive = toggleFinanceSalespersonActive;
window.fillCustomerSalespersonOptions = fillCustomerSalespersonOptions;
