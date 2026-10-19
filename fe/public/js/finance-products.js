// ==========================================
// Product catalog (X3, D-030): Finance Settings > Products
// ==========================================
let _currentProductStatusFilter = "all";
const _PRODUCT_TYPE_LABELS = {
  saas_subscription: "SaaS subscription",
  license: "Licence",
  implementation_service: "Implementation service",
  support: "Support",
  other: "Other",
};

async function loadFinanceProducts() {
  const bar = document.getElementById("financeProductsLoadingBar");
  if (bar) bar.style.display = "block";
  try {
    FinanceState.products = await FinanceApi.getProducts();
    renderFinanceProducts(FinanceState.products);
  } catch (err) {
    console.error("Failed to load products:", err);
    toast("Failed to load products: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceProducts(filter) {
  _currentProductStatusFilter = filter;
  renderFinanceProducts(FinanceState.products || []);
}

function renderFinanceProducts(all) {
  const tbody = document.getElementById("financeProductsTableBody");
  const empty = document.getElementById("financeProductsEmpty");
  if (!tbody) return;
  const list = all || [];
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("prodPillCountAll", list.length);
  setText("prodPillCountActive", list.filter((p) => p.is_active).length);
  setText("prodPillCountInactive", list.filter((p) => !p.is_active).length);
  document.querySelectorAll("#financeProductStatusPills .fv-pill").forEach((p) => {
    p.classList.toggle("fv-pill--zero", !Number((p.querySelector(".fv-pill__count") || {}).textContent || 0));
    const on = p.dataset.filter === _currentProductStatusFilter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on ? "true" : "false");
  });

  let items = list;
  if (_currentProductStatusFilter === "active") items = items.filter((p) => p.is_active);
  else if (_currentProductStatusFilter === "inactive") items = items.filter((p) => !p.is_active);

  if (!items.length) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const esc = FinanceUI.esc;
  tbody.innerHTML = items.map((p) => `
    <tr data-product-id="${p.id}">
      <td data-label="Product"><strong class="fv-strong-ink">${esc(p.name)}</strong></td>
      <td data-label="Code"><span class="fv-muted">${esc(p.code)}</span></td>
      <td data-label="Type">${esc(_PRODUCT_TYPE_LABELS[p.product_type] || p.product_type)}</td>
      <td data-label="Default price" class="fv-num">${p.default_price == null ? '<span class="fv-muted">—</span>' : FinanceUI.moneyHtml(p.default_price, p.default_currency)}</td>
      <td data-label="Receives into">${p.default_receiving_account_name ? esc(p.default_receiving_account_name) : '<span class="fv-muted">—</span>'}</td>
      <td data-label="Status">${FinanceUI.statusPill(p.is_active ? "active" : "inactive", p.is_active ? "Active" : "Inactive", "", "status-badge-wrap")}</td>
      <td class="col-actions">${FinanceUI.rowActions({
        primary: { label: "Edit", kind: "outline", className: "btn-product-edit", onclick: `openEditFinanceProductModal(${p.id})`, attrs: 'title="Edit Product"' },
        icons: [{ icon: p.is_active ? "fa-power-off" : "fa-check", label: p.is_active ? "Deactivate Product" : "Reactivate Product", className: p.is_active ? "fv-icon-btn--danger btn-product-toggle" : "btn-product-toggle", onclick: `toggleFinanceProductActive(${p.id}, ${p.is_active})` }],
      })}</td>
    </tr>`).join("");
}

async function _fillProductAccountOptions(selectedId) {
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    try { FinanceState.accounts = await FinanceApi.getAccounts(); } catch (_) { FinanceState.accounts = []; }
  }
  const cur = document.getElementById("fFinanceProductCurrency").value;
  const sel = document.getElementById("fFinanceProductAccount");
  const accs = (FinanceState.accounts || []).filter((a) => a.is_active && a.currency === cur);
  sel.innerHTML = '<option value="">None</option>' + accs.map((a) => `<option value="${a.id}">${FinanceUI.esc(a.account_name)} (${FinanceUI.esc(a.currency)})</option>`).join("");
  sel.value = selectedId && accs.some((a) => a.id === Number(selectedId)) ? String(selectedId) : "";
}

function onFinanceProductCurrencyChanged() {
  _fillProductAccountOptions("");
}

async function openAddFinanceProductModal() {
  FinanceForm.clearErrors("financeProductModal");
  document.getElementById("financeProductModalTitle").textContent = "Add Product";
  document.getElementById("fFinanceProductId").value = "";
  document.getElementById("fFinanceProductName").value = "";
  document.getElementById("fFinanceProductCode").value = "";
  document.getElementById("fFinanceProductType").value = "saas_subscription";
  document.getElementById("fFinanceProductCurrency").value = "USD";
  document.getElementById("fFinanceProductPrice").value = "";
  await _fillProductAccountOptions("");
  openModal("financeProductModal");
}

async function openEditFinanceProductModal(id) {
  FinanceForm.clearErrors("financeProductModal");
  const p = (FinanceState.products || []).find((x) => x.id === Number(id));
  if (!p) return;
  document.getElementById("financeProductModalTitle").textContent = "Edit Product";
  document.getElementById("fFinanceProductId").value = p.id;
  document.getElementById("fFinanceProductName").value = p.name;
  document.getElementById("fFinanceProductCode").value = p.code;
  document.getElementById("fFinanceProductType").value = p.product_type;
  document.getElementById("fFinanceProductCurrency").value = p.default_currency;
  document.getElementById("fFinanceProductPrice").value = p.default_price == null ? "" : p.default_price;
  await _fillProductAccountOptions(p.default_receiving_account_id);
  openModal("financeProductModal");
}

async function saveFinanceProduct() {
  const idVal = document.getElementById("fFinanceProductId").value;
  const ok = FinanceForm.validateRequiredFields("financeProductModal", [
    { id: "fFinanceProductName", label: "Product name" },
    { id: "fFinanceProductCode", label: "Product code" },
  ]);
  if (!ok) return;
  const priceRaw = document.getElementById("fFinanceProductPrice").value;
  const acc = document.getElementById("fFinanceProductAccount").value;
  const payload = {
    name: document.getElementById("fFinanceProductName").value.trim(),
    code: document.getElementById("fFinanceProductCode").value.trim().toUpperCase(),
    product_type: document.getElementById("fFinanceProductType").value,
    default_currency: document.getElementById("fFinanceProductCurrency").value,
    default_price: priceRaw === "" ? null : parseFloat(priceRaw),
    default_receiving_account_id: acc ? parseInt(acc, 10) : null,
  };
  const btn = document.getElementById("financeProductSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (idVal) {
      await FinanceApi.updateProduct(Number(idVal), payload);
      toast("Product updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createProduct({ ...payload, is_active: true });
      toast("Product created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financeProductModal");
    await loadFinanceProducts();
  } catch (err) {
    toast(err.message || "Failed to save product", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleFinanceProductActive(id, currentActive) {
  const p = (FinanceState.products || []).find((x) => x.id === Number(id));
  const result = await FinanceCommand.confirmAction({
    title: `${currentActive ? "Deactivate" : "Reactivate"} Product`,
    summary: p ? `<strong>${FinanceUI.esc(p.name)}</strong> (${FinanceUI.esc(p.code)})` : `Product #${id}`,
    consequence: currentActive
      ? "A deactivated product is hidden from new invoice lines. Past invoices keep their product."
      : "Reactivating makes this product available on new invoice lines again.",
    actionLabel: currentActive ? "Deactivate Product" : "Reactivate Product",
    actionClass: currentActive ? "btn btn-danger" : "btn btn-fill",
    requireReason: false,
    severity: currentActive ? "warning" : "info",
  });
  if (!result.confirmed) return;
  try {
    await FinanceApi.updateProduct(Number(id), { is_active: !currentActive });
    toast(currentActive ? "Product deactivated" : "Product reactivated", "fa-solid fa-circle-check");
    await loadFinanceProducts();
  } catch (err) {
    toast(err.message || "Failed to update product", "fa-solid fa-triangle-exclamation");
  }
}

window.loadFinanceProducts = loadFinanceProducts;
window.filterFinanceProducts = filterFinanceProducts;
window.openAddFinanceProductModal = openAddFinanceProductModal;
window.openEditFinanceProductModal = openEditFinanceProductModal;
window.onFinanceProductCurrencyChanged = onFinanceProductCurrencyChanged;
window.saveFinanceProduct = saveFinanceProduct;
window.toggleFinanceProductActive = toggleFinanceProductActive;
