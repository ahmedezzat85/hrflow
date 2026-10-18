/**
 * fe/api/finance/products-api.js
 * Finance API - Product catalog domain client and mock handlers (X3, D-030).
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});

  if (!FinanceMockState.products) {
    FinanceMockState.products = [
      { id: 1, name: "HRFlow Cloud (SaaS)", code: "SAAS-CLOUD", product_type: "saas_subscription", default_currency: "USD", default_price: 1200.0, default_receiving_account_id: 1, default_receiving_account_name: "Voyance Operating USD", is_active: true },
      { id: 2, name: "Implementation Services", code: "IMPL-SVC", product_type: "implementation_service", default_currency: "EGP", default_price: null, default_receiving_account_id: null, default_receiving_account_name: null, is_active: true },
      { id: 3, name: "Legacy On-prem Licence", code: "LIC-LEGACY", product_type: "license", default_currency: "USD", default_price: 5000.0, default_receiving_account_id: null, default_receiving_account_name: null, is_active: false },
    ];
  }

  const PRODUCT_TYPES = ["saas_subscription", "license", "implementation_service", "support", "other"];
  root.FINANCE_PRODUCT_TYPES = PRODUCT_TYPES;

  const _validateProduct = (payload, currentId) => {
    const list = FinanceMockState.products;
    if (payload.product_type && !PRODUCT_TYPES.includes(payload.product_type)) throw new Error("Invalid product_type.");
    if (payload.code) {
      const code = String(payload.code).trim().toUpperCase();
      if (list.some((p) => p.code === code && p.id !== currentId)) throw new Error(`Product code '${code}' already exists`);
    }
    if (payload.default_receiving_account_id) {
      const acc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.default_receiving_account_id, 10));
      if (!acc) throw new Error("Receiving account not found");
      const cur = String(payload.default_currency || "").toUpperCase();
      if (cur && acc.currency !== cur) throw new Error(`The default receiving account is in ${acc.currency}, but the product currency is ${cur}.`);
    }
  };

  const _accName = (id) => {
    const acc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(id, 10));
    return acc ? acc.account_name : null;
  };

  const FinanceProductsApi = {
    async getProducts(params) {
      if (_isMock()) {
        let list = [...FinanceMockState.products];
        if (params && params.is_active !== undefined && params.is_active !== "") {
          const want = params.is_active === true || params.is_active === "true";
          list = list.filter((p) => p.is_active === want);
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
      }
      let url = "/api/finance/products";
      if (params) {
        const qs = new URLSearchParams(params).toString();
        if (qs) url += `?${qs}`;
      }
      return apiRequest("GET", url);
    },
    async createProduct(payload) {
      if (_isMock()) {
        _validateProduct(payload, null);
        const p = {
          id: Math.max(0, ...FinanceMockState.products.map((x) => x.id)) + 1,
          name: String(payload.name).trim(),
          code: String(payload.code).trim().toUpperCase(),
          product_type: payload.product_type || "other",
          default_currency: (payload.default_currency || "USD").toUpperCase(),
          default_price: payload.default_price == null ? null : Number(payload.default_price),
          default_receiving_account_id: payload.default_receiving_account_id || null,
          default_receiving_account_name: _accName(payload.default_receiving_account_id),
          is_active: payload.is_active !== false,
        };
        FinanceMockState.products.push(p);
        return p;
      }
      return apiRequest("POST", "/api/finance/products", payload);
    },
    async updateProduct(id, payload) {
      if (_isMock()) {
        const p = FinanceMockState.products.find((x) => x.id === parseInt(id, 10));
        if (!p) throw new Error("Product not found");
        _validateProduct({ ...payload, default_currency: payload.default_currency || p.default_currency, default_receiving_account_id: "default_receiving_account_id" in payload ? payload.default_receiving_account_id : p.default_receiving_account_id }, p.id);
        Object.assign(p, payload);
        if (payload.code) p.code = String(payload.code).trim().toUpperCase();
        p.default_receiving_account_name = _accName(p.default_receiving_account_id);
        return p;
      }
      return apiRequest("PATCH", `/api/finance/products/${id}`, payload);
    },
  };

  root.FinanceProductsApi = FinanceProductsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceProductsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceProductsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
