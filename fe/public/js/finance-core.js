/**
 * fe/public/js/finance.js
 * Controller for Finance module sections and employee payslip self-service.
 */

// Global toast wrapper for finance module actions
if (typeof window.showToast !== "function") {
  window.showToast = function (msg, type = "success") {
    if (typeof toast === "function") {
      const icon =
        type === "error"
          ? "fa-solid fa-triangle-exclamation"
          : type === "info"
          ? "fa-solid fa-circle-info"
          : "fa-solid fa-circle-check";
      toast(msg, icon);
    } else {
      console.log(`[Finance Toast ${type}] ${msg}`);
    }
  };
}

const FinanceState = {
  summary: null,
  invoices: [],
  customers: [],
  bills: [],
  vendors: [],
  payrollRuns: [],
  accounts: [],
  categories: [],
  paymentTypes: [],
  subscriptions: [],
  myPayslips: [],
};

// ==========================================
// Shared Money, Date, and Status Semantics (Story 0.2)
// ==========================================
const FinanceFormat = {
  formatMoney(amount, currency = "USD", options = {}) {
    const rawNum = Number(amount);
    const num = isNaN(rawNum) ? 0 : rawNum;
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const decimals = options.decimals !== undefined ? options.decimals : 2;
    const formattedAbs = absNum.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    const curr = (currency || "USD").toUpperCase().trim();
    const showSign = !!options.showSign;
    const accounting = !!options.accounting;

    let symbol = "";
    let suffix = "";
    let prefix = "";

    if (curr === "USD") {
      symbol = "$";
      suffix = " USD";
    } else if (curr === "EGP") {
      prefix = "EGP ";
    } else if (curr === "EUR") {
      symbol = "€";
      suffix = " EUR";
    } else if (curr === "GBP") {
      symbol = "£";
      suffix = " GBP";
    } else {
      prefix = `${curr} `;
    }

    let signStr = "";
    if (isNegative) {
      signStr = "-";
    } else if (showSign && num > 0) {
      signStr = "+";
    }

    if (accounting && isNegative) {
      return `(${prefix || symbol}${formattedAbs}${suffix})`;
    }

    if (prefix) {
      return `${signStr}${prefix}${formattedAbs}`;
    }

    return `${signStr}${symbol}${formattedAbs}${suffix}`;
  },

  renderMoneyHtml(amount, currency = "USD", options = {}) {
    const rawNum = Number(amount);
    const num = isNaN(rawNum) ? 0 : rawNum;
    const formatted = this.formatMoney(num, currency, options);
    const isNegative = num < 0;
    const isPositive = num > 0;
    const curr = (currency || "USD").toUpperCase().trim();

    let stateClass = "money-zero";
    let signWord = "";
    if (isNegative) {
      stateClass = "money-negative";
      signWord = "negative ";
    } else if (isPositive) {
      stateClass = "money-positive";
      if (options.showSign) signWord = "positive ";
    }

    const currencyWords = {
      USD: "US Dollars",
      EGP: "Egyptian Pounds",
      EUR: "Euros",
      GBP: "British Pounds",
    };
    const currName = currencyWords[curr] || curr;
    const decimals = options.decimals !== undefined ? options.decimals : 2;
    const accessibleLabel = `${signWord}${Math.abs(num).toFixed(decimals)} ${currName}`;

    return `<span class="money ${stateClass} ${options.extraClass || ""}" aria-label="${accessibleLabel}" role="text">${formatted}</span>`;
  },

  formatFinanceDate(dateVal, options = {}) {
    if (!dateVal) return "—";
    const str = String(dateVal).trim();
    if (!str || str === "--" || str === "—") return "—";

    const d = new Date(str);
    if (isNaN(d.getTime())) return str;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const datePart = `${year}-${month}-${day}`;

    const hasTime = str.includes("T") || (str.includes(" ") && str.includes(":"));
    if (options.includeTime || (hasTime && options.includeTime !== false)) {
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      let tz = "UTC";
      try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(d);
        const tzPart = parts.find((p) => p.type === "timeZoneName");
        if (tzPart && tzPart.value) tz = tzPart.value;
      } catch (_) {}

      return `${datePart} ${hours}:${minutes} (${tz})`;
    }

    return datePart;
  },

  getDerivedInvoiceStatus(inv) {
    if (!inv) return "draft";
    const rawStatus = (inv.status || "draft").toLowerCase().trim();
    if (rawStatus === "void" || rawStatus === "cancelled") return "void";
    if (rawStatus === "paid") return "paid";

    if (inv.due_date) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (inv.due_date < todayStr) {
        return "overdue";
      }
    }
    return rawStatus;
  },

  getDerivedBillStatus(bill) {
    if (!bill) return "unpaid";
    const rawStatus = (bill.status || "unpaid").toLowerCase().trim();
    if (rawStatus === "void" || rawStatus === "cancelled") return "void";
    if (rawStatus === "paid") return "paid";

    if (bill.due_date) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (bill.due_date < todayStr) {
        return "overdue";
      }
    }
    return rawStatus;
  },

  STATUS_MAP: {
    invoice: {
      draft: { label: "Draft", badgeClass: "badge-pending", icon: "fa-solid fa-file-pen" },
      sent: { label: "Sent", badgeClass: "badge-info", icon: "fa-solid fa-paper-plane" },
      partially_paid: { label: "Partially Paid", badgeClass: "badge-warning", icon: "fa-solid fa-circle-half-stroke" },
      paid: { label: "Paid", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      overdue: { label: "Overdue", badgeClass: "badge-rejected", icon: "fa-solid fa-circle-exclamation" },
      void: { label: "Void", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    bill: {
      unpaid: { label: "Unpaid", badgeClass: "badge-pending", icon: "fa-solid fa-clock" },
      partially_paid: { label: "Partially Paid", badgeClass: "badge-warning", icon: "fa-solid fa-circle-half-stroke" },
      paid: { label: "Paid", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      overdue: { label: "Overdue", badgeClass: "badge-rejected", icon: "fa-solid fa-circle-exclamation" },
      void: { label: "Void", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    transfer: {
      completed: { label: "Completed", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      pending: { label: "Pending", badgeClass: "badge-pending", icon: "fa-solid fa-clock" },
      cancelled: { label: "Cancelled", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    cheque: {
      issued: { label: "Issued", badgeClass: "badge-pending", icon: "fa-solid fa-clock" },
      cleared: { label: "Cleared", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      bounced: { label: "Bounced", badgeClass: "badge-rejected", icon: "fa-solid fa-triangle-exclamation" },
      voided: { label: "Voided", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    statement: {
      imported: { label: "Imported", badgeClass: "badge-info", icon: "fa-solid fa-file-import" },
      partially_reconciled: { label: "Partial", badgeClass: "badge-warning", icon: "fa-solid fa-circle-half-stroke" },
      reconciled: { label: "Reconciled", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
    },
    subscription: {
      active: { label: "Active", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      paused: { label: "Paused", badgeClass: "badge-warning", icon: "fa-solid fa-circle-pause" },
      cancelled: { label: "Cancelled", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
      inactive: { label: "Inactive", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    account: {
      active: { label: "Active", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      inactive: { label: "Inactive", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    customer: {
      active: { label: "Active", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      inactive: { label: "Inactive", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    vendor: {
      active: { label: "Active", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      inactive: { label: "Inactive", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    payroll: {
      draft: { label: "Draft", badgeClass: "badge-pending", icon: "fa-solid fa-file-pen" },
      approved: { label: "Approved", badgeClass: "badge-info", icon: "fa-solid fa-clipboard-check" },
      paid: { label: "Paid", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      cancelled: { label: "Cancelled", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
  },

  formatStatusBadge(entityType, status, options = {}) {
    const norm = (status || "").toLowerCase().trim();
    const entityMap = this.STATUS_MAP[entityType] || {};
    const item = entityMap[norm] || {
      label: (status || "Unknown").toUpperCase(),
      badgeClass: "badge-grey",
      icon: "fa-solid fa-circle-info",
    };
    const label = options.customLabel || item.label;
    return `<span class="badge ${item.badgeClass} status-badge-wrap" role="status" aria-label="Status: ${label}"><i class="${item.icon}" aria-hidden="true"></i> ${label}</span>`;
  },
};

// Global aliases for convenience
window.FinanceFormat = FinanceFormat;
window.formatMoney = FinanceFormat.formatMoney.bind(FinanceFormat);
window.renderMoneyHtml = FinanceFormat.renderMoneyHtml.bind(FinanceFormat);
window.formatFinanceDate = FinanceFormat.formatFinanceDate.bind(FinanceFormat);
window.formatStatusBadge = FinanceFormat.formatStatusBadge.bind(FinanceFormat);
window.getDerivedInvoiceStatus = FinanceFormat.getDerivedInvoiceStatus.bind(FinanceFormat);
window.getDerivedBillStatus = FinanceFormat.getDerivedBillStatus.bind(FinanceFormat);

// ==========================================
// Accessible Dialog and Form Foundation (Story 0.3)
// ==========================================
const FinanceForm = {
  setFieldError(inputOrId, message) {
    const input = typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId;
    if (!input) return;

    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");

    const fieldWrap = input.closest(".form-field") || input.parentElement;
    const errorId = (input.id || "field_" + Math.random().toString(36).substr(2, 6)) + "-error";

    let errEl = fieldWrap ? fieldWrap.querySelector(".field-error-msg") : document.getElementById(errorId);
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "field-error-msg";
      errEl.id = errorId;
      errEl.setAttribute("role", "alert");
      if (fieldWrap) {
        fieldWrap.appendChild(errEl);
      } else {
        input.insertAdjacentElement("afterend", errEl);
      }
    }
    errEl.innerHTML = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> <span>${message}</span>`;
    errEl.style.display = "flex";

    // Update aria-describedby without losing existing descriptions
    const current = input.getAttribute("aria-describedby") || "";
    const tokens = current.split(/\s+/).filter(Boolean);
    if (!tokens.includes(errorId)) {
      tokens.push(errorId);
      input.setAttribute("aria-describedby", tokens.join(" "));
    }
  },

  clearFieldError(inputOrId) {
    const input = typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId;
    if (!input) return;

    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");

    const errorId = input.id ? `${input.id}-error` : null;
    const fieldWrap = input.closest(".form-field") || input.parentElement;
    const errEl = fieldWrap ? fieldWrap.querySelector(".field-error-msg") : (errorId ? document.getElementById(errorId) : null);
    if (errEl) errEl.remove();

    if (errorId && input.hasAttribute("aria-describedby")) {
      const remaining = (input.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((tok) => tok && tok !== errorId);
      if (remaining.length > 0) {
        input.setAttribute("aria-describedby", remaining.join(" "));
      } else {
        input.removeAttribute("aria-describedby");
      }
    }
  },

  clearErrors(containerOrId) {
    const container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return;

    // Remove summary banners
    const summaries = container.querySelectorAll(".form-error-summary");
    summaries.forEach((s) => s.remove());

    // Remove is-invalid classes and aria-invalid
    container.querySelectorAll(".is-invalid").forEach((el) => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });

    // Remove field error messages
    container.querySelectorAll(".field-error-msg").forEach((el) => el.remove());

    // Clean up aria-describedby references
    container.querySelectorAll("[aria-describedby]").forEach((el) => {
      const remaining = (el.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((tok) => tok && !tok.endsWith("-error"));
      if (remaining.length > 0) {
        el.setAttribute("aria-describedby", remaining.join(" "));
      } else {
        el.removeAttribute("aria-describedby");
      }
    });
  },

  showErrorSummary(containerOrId, errors) {
    // errors: array of { fieldId: string, message: string }
    const container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
    if (!container || !errors || errors.length === 0) return;

    this.clearErrors(container);

    // Set inline field errors
    errors.forEach((err) => {
      if (err.fieldId) {
        this.setFieldError(err.fieldId, err.message);
      }
    });

    // Build accessible error summary banner
    const summary = document.createElement("div");
    summary.className = "form-error-summary";
    summary.setAttribute("role", "alert");
    summary.setAttribute("aria-live", "assertive");
    summary.setAttribute("tabindex", "-1");

    const count = errors.length;
    const titleText = count === 1 ? "There is 1 problem with your submission:" : `There are ${count} problems with your submission:`;

    let listHtml = '<ul class="form-error-summary-list">';
    errors.forEach((err) => {
      if (err.fieldId) {
        listHtml += `<li><a href="#${err.fieldId}" onclick="event.preventDefault(); const target = document.getElementById('${err.fieldId}'); if(target){ target.focus(); if(target.scrollIntoView) target.scrollIntoView({behavior:'smooth', block:'center'}); }">${err.message}</a></li>`;
      } else {
        listHtml += `<li>${err.message}</li>`;
      }
    });
    listHtml += "</ul>";

    summary.innerHTML = `
      <div class="form-error-summary-head">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <strong>${titleText}</strong>
      </div>
      ${listHtml}
    `;

    const targetBody = container.querySelector(".modal-body") || container;
    targetBody.insertAdjacentElement("afterbegin", summary);

    // Focus summary container so screen readers announce it immediately
    setTimeout(() => {
      if (typeof summary.focus === "function") summary.focus();
    }, 50);
  },

  validateRequiredFields(containerOrId, requiredRules) {
    const container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
    const errors = [];

    requiredRules.forEach((rule) => {
      const el = document.getElementById(rule.id);
      const val = el ? (el.value || "").trim() : "";
      const isValid = rule.check ? rule.check(val, el) : Boolean(val);
      if (!isValid) {
        errors.push({
          fieldId: rule.id,
          message: rule.message || `${rule.label || "This field"} is required.`,
        });
      }
    });

    if (errors.length > 0) {
      this.showErrorSummary(container, errors);
      return false;
    }

    this.clearErrors(container);
    return true;
  }
};

window.FinanceForm = FinanceForm;

function initAccessibleTablist(containerOrId) {
  const container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
  if (!container) return;

  if (!container.getAttribute("role")) container.setAttribute("role", "tablist");
  const tabs = Array.from(container.querySelectorAll(".filter-tab, [data-tab], button"));

  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");
    const isActive = tab.classList.contains("active");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");

    tab.addEventListener("keydown", (e) => {
      let targetIndex = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        targetIndex = (index + 1) % tabs.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        targetIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === "Home") {
        targetIndex = 0;
      } else if (e.key === "End") {
        targetIndex = tabs.length - 1;
      }

      if (targetIndex !== -1) {
        e.preventDefault();
        const targetTab = tabs[targetIndex];
        tabs.forEach((t) => {
          t.setAttribute("aria-selected", "false");
          t.setAttribute("tabindex", "-1");
        });
        targetTab.setAttribute("aria-selected", "true");
        targetTab.setAttribute("tabindex", "0");
        targetTab.focus();
        targetTab.click();
      }
    });
  });
}
window.initAccessibleTablist = initAccessibleTablist;


// ==========================================
// Accessible Tablist Initialization (Story 0.3)
// ==========================================
function setupFinanceAccessibility() {
  document.querySelectorAll('.filter-tabs, [role="tablist"]').forEach((tl) => {
    initAccessibleTablist(tl);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupFinanceAccessibility);
} else {
  setupFinanceAccessibility();
}
window.setupFinanceAccessibility = setupFinanceAccessibility;
// ==========================================
// Safe Financial Command Framework (Story 0.4)
// ==========================================
const FinanceCommand = {
  _resolveConfirm: null,
  _invokingElement: null,

  confirmAction(options = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("financeConfirmModal");
      if (!modal) {
        const ok = confirm(options.consequence || "Confirm this action?");
        let r = "";
        if (ok && options.requireReason) {
          r = prompt("Reason for this action:") || "";
        }
        return resolve({ confirmed: ok, reason: r });
      }

      this._invokingElement = document.activeElement;
      this._resolveConfirm = resolve;

      const titleEl = document.getElementById("financeConfirmTitle");
      if (titleEl) titleEl.textContent = options.title || "Confirm Action";

      const iconEl = document.getElementById("financeConfirmIcon");
      if (iconEl) {
        const iconClass = options.icon || (options.severity === "warning" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-exclamation");
        const iconColor = options.severity === "warning" ? "var(--warning, #f59e0b)" : "var(--danger, #ef4444)";
        iconEl.innerHTML = `<i class="${iconClass}"></i>`;
        iconEl.style.color = iconColor;
      }

      const summaryEl = document.getElementById("financeConfirmTargetSummary");
      if (summaryEl) {
        if (options.summary) {
          summaryEl.innerHTML = options.summary;
          summaryEl.style.display = "block";
        } else {
          summaryEl.style.display = "none";
        }
      }

      const descEl = document.getElementById("financeConfirmDescription");
      if (descEl) descEl.textContent = options.consequence || "Are you sure you want to proceed?";

      const reasonGroup = document.getElementById("financeConfirmReasonGroup");
      const reasonInput = document.getElementById("financeConfirmReason");
      if (reasonInput) {
        reasonInput.value = "";
        FinanceForm.clearFieldError(reasonInput);
      }
      if (reasonGroup) {
        reasonGroup.style.display = options.requireReason ? "flex" : "none";
      }

      const submitBtn = document.getElementById("financeConfirmSubmitBtn");
      if (submitBtn) {
        submitBtn.textContent = options.actionLabel || "Confirm";
        submitBtn.className = options.actionClass || "btn btn-danger";
      }

      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKeyDown);
          this.handleConfirmCancel();
        }
      };
      this._escapeHandler = onKeyDown;
      document.addEventListener("keydown", onKeyDown);

      openModal("financeConfirmModal");
      if (options.requireReason && reasonInput) {
        setTimeout(() => reasonInput.focus(), 50);
      } else if (submitBtn) {
        setTimeout(() => submitBtn.focus(), 50);
      }
    });
  },

  handleConfirmSubmit() {
    const modal = document.getElementById("financeConfirmModal");
    const reasonGroup = document.getElementById("financeConfirmReasonGroup");
    const reasonInput = document.getElementById("financeConfirmReason");
    const isReasonRequired = reasonGroup && reasonGroup.style.display !== "none";

    let reason = reasonInput ? reasonInput.value.trim() : "";
    if (isReasonRequired && !reason) {
      const errEl = document.getElementById("financeConfirmReason_error");
      if (errEl) {
        errEl.textContent = "A reason is required to execute this action.";
        errEl.style.display = "block";
      }
      FinanceForm.setFieldError("financeConfirmReason", "A reason is required to execute this action.");
      return;
    }

    if (this._escapeHandler) {
      document.removeEventListener("keydown", this._escapeHandler);
      this._escapeHandler = null;
    }

    closeModal("financeConfirmModal");
    if (this._invokingElement && typeof this._invokingElement.focus === "function") {
      this._invokingElement.focus();
    }
    if (this._resolveConfirm) {
      const resolver = this._resolveConfirm;
      this._resolveConfirm = null;
      resolver({ confirmed: true, reason });
    }
  },

  handleConfirmCancel() {
    if (this._escapeHandler) {
      document.removeEventListener("keydown", this._escapeHandler);
      this._escapeHandler = null;
    }

    const errEl = document.getElementById("financeConfirmReason_error");
    if (errEl) {
      errEl.textContent = "";
      errEl.style.display = "none";
    }

    closeModal("financeConfirmModal");
    if (this._invokingElement && typeof this._invokingElement.focus === "function") {
      this._invokingElement.focus();
    }
    if (this._resolveConfirm) {
      const resolver = this._resolveConfirm;
      this._resolveConfirm = null;
      resolver({ confirmed: false, reason: "" });
    }
  },

  generateIdempotencyKey() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "idemp-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
  },

  lockSubmitButton(buttonOrId) {
    const btn = typeof buttonOrId === "string" ? document.getElementById(buttonOrId) : buttonOrId;
    if (!btn) return () => {};
    if (btn.disabled) return null; // Already locked!

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

    return function unlock() {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = originalHtml;
    };
  },
};
window.FinanceCommand = FinanceCommand;
