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
      suffix = options.showCurrencySuffix ? " USD" : "";
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

  escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    if (["inbox", "needs_coding", "needs_approval", "exceptions"].includes(rawStatus)) {
      return rawStatus;
    }
    if (rawStatus === "void" || rawStatus === "cancelled") return "void";
    if (rawStatus === "paid") return "paid";

    if (bill.due_date) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (bill.due_date < todayStr && rawStatus !== "scheduled") {
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
      inbox: { label: "Inbox", badgeClass: "badge-indigo", icon: "fa-solid fa-inbox" },
      needs_coding: { label: "Needs Coding", badgeClass: "badge-warning", icon: "fa-solid fa-tags" },
      needs_approval: { label: "Needs Approval", badgeClass: "badge-info", icon: "fa-solid fa-user-check" },
      ready_to_pay: { label: "Ready to Pay", badgeClass: "badge-primary", icon: "fa-solid fa-money-check-dollar" },
      scheduled: { label: "Scheduled", badgeClass: "badge-secondary", icon: "fa-solid fa-calendar-check" },
      unpaid: { label: "Unpaid", badgeClass: "badge-pending", icon: "fa-solid fa-clock" },
      partially_paid: { label: "Partially Paid", badgeClass: "badge-warning", icon: "fa-solid fa-circle-half-stroke" },
      paid: { label: "Paid", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      overdue: { label: "Overdue", badgeClass: "badge-rejected", icon: "fa-solid fa-circle-exclamation" },
      exceptions: { label: "Exception", badgeClass: "badge-danger", icon: "fa-solid fa-triangle-exclamation" },
      void: { label: "Void", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    transfer: {
      completed: { label: "Completed", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      pending: { label: "Pending", badgeClass: "badge-pending", icon: "fa-solid fa-clock" },
      cancelled: { label: "Cancelled", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
    },
    cheque: {
      draft: { label: "Draft", badgeClass: "badge-pending", icon: "fa-solid fa-file-pen" },
      issued: { label: "Issued", badgeClass: "badge-info", icon: "fa-solid fa-stamp" },
      outstanding: { label: "Outstanding", badgeClass: "badge-warning", icon: "fa-solid fa-hourglass-half" },
      cleared: { label: "Cleared", badgeClass: "badge-approved", icon: "fa-solid fa-circle-check" },
      bounced: { label: "Bounced", badgeClass: "badge-rejected", icon: "fa-solid fa-triangle-exclamation" },
      stopped: { label: "Stopped", badgeClass: "badge-danger", icon: "fa-solid fa-hand" },
      voided: { label: "Voided", badgeClass: "badge-grey", icon: "fa-solid fa-ban" },
      replaced: { label: "Replaced", badgeClass: "badge-secondary", icon: "fa-solid fa-arrows-rotate" },
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

  formatMaskedAccountNumber(raw, isCash = false) {
    if (!raw) return "—";
    const str = String(raw).trim();
    if (!str || str === "—" || str === "--") return "—";
    if (isCash) return str;
    if (str.length <= 4) return str;
    const last4 = str.slice(-4);
    return `•••• ${last4}`;
  },
};

// Global aliases for convenience
window.FinanceFormat = FinanceFormat;
window.formatMoney = FinanceFormat.formatMoney.bind(FinanceFormat);
window.renderMoneyHtml = FinanceFormat.renderMoneyHtml.bind(FinanceFormat);
window.formatFinanceDate = FinanceFormat.formatFinanceDate.bind(FinanceFormat);
window.formatStatusBadge = FinanceFormat.formatStatusBadge.bind(FinanceFormat);
window.formatMaskedAccountNumber = FinanceFormat.formatMaskedAccountNumber.bind(FinanceFormat);
window.getDerivedInvoiceStatus = FinanceFormat.getDerivedInvoiceStatus.bind(FinanceFormat);
window.getDerivedBillStatus = FinanceFormat.getDerivedBillStatus.bind(FinanceFormat);

// ==========================================
// Accessible Dialog and Form Foundation (Story 0.3)
// ==========================================
const FinanceForm = {
  showFieldError(inputOrId, message) {
    this.setFieldError(inputOrId, message);
  },

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

// ============================================================================
// FinanceTable — Shared list/table shell, pagination, sorting, density (Story 1.2)
// ============================================================================
const FinanceTable = {
  DENSITY_KEY: "hrflow_finance_table_density",
  VALID_DENSITIES: ["compact", "regular", "spacious"],

  getDensity() {
    try {
      const val = localStorage.getItem(this.DENSITY_KEY);
      if (this.VALID_DENSITIES.includes(val)) return val;
    } catch (e) {}
    return "regular";
  },

  setDensity(density) {
    if (!this.VALID_DENSITIES.includes(density)) density = "regular";
    try {
      localStorage.setItem(this.DENSITY_KEY, density);
    } catch (e) {}

    // Apply class to all tables/containers
    const tables = document.querySelectorAll(".responsive-card-table, .finance-table");
    tables.forEach((t) => {
      t.classList.remove("density-compact", "density-regular", "density-spacious");
      t.classList.add(`density-${density}`);
    });

    // Update density toggle buttons
    const btns = document.querySelectorAll(".density-btn");
    btns.forEach((btn) => {
      const isCurrent = btn.dataset.density === density;
      btn.classList.toggle("active", isCurrent);
      btn.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    });

    window.dispatchEvent(new CustomEvent("finance:density-changed", { detail: { density } }));
  },

  renderDensityControl(containerId) {
    const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!container) return;

    const current = this.getDensity();
    container.innerHTML = `
      <div class="density-toggle-group" role="group" aria-label="Table density">
        <button type="button" class="density-btn ${current === 'compact' ? 'active' : ''}" data-density="compact" aria-pressed="${current === 'compact'}" title="Compact view">
          <i class="fa-solid fa-align-justify"></i> Compact
        </button>
        <button type="button" class="density-btn ${current === 'regular' ? 'active' : ''}" data-density="regular" aria-pressed="${current === 'regular'}" title="Regular view">
          <i class="fa-solid fa-bars"></i> Regular
        </button>
        <button type="button" class="density-btn ${current === 'spacious' ? 'active' : ''}" data-density="spacious" aria-pressed="${current === 'spacious'}" title="Spacious view">
          <i class="fa-solid fa-grip-lines"></i> Spacious
        </button>
      </div>
    `;

    container.querySelectorAll(".density-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setDensity(btn.dataset.density);
      });
    });
  },

  initAllTablesDensity() {
    this.setDensity(this.getDensity());
  },

  // State caching per table ID
  getStateKey(tableId) {
    return `hrflow_table_state_${tableId}`;
  },

  getState(tableId) {
    try {
      const raw = sessionStorage.getItem(this.getStateKey(tableId));
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      page: 1,
      pageSize: 10,
      sortBy: null,
      sortDir: "asc",
      filters: {},
    };
  },

  saveState(tableId, state) {
    try {
      sessionStorage.setItem(this.getStateKey(tableId), JSON.stringify(state));
    } catch (e) {}
  },

  clearState(tableId) {
    try {
      sessionStorage.removeItem(this.getStateKey(tableId));
    } catch (e) {}
  },

  // Sorting
  sortItems(items, sortBy, sortDir = "asc") {
    if (!sortBy || !items || !items.length) return [...(items || [])];
    const dir = sortDir === "desc" ? -1 : 1;
    return [...items].sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA === undefined || valA === null) valA = "";
      if (valB === undefined || valB === null) valB = "";

      // Number comparison
      if (typeof valA === "number" && typeof valB === "number") {
        return (valA - valB) * dir;
      }
      // Date or string comparison
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return strA.localeCompare(strB) * dir;
    });
  },

  bindSortHeaders(tableOrId, onSortChange, currentSort = {}) {
    const table = typeof tableOrId === "string" ? document.getElementById(tableOrId) : tableOrId;
    if (!table) return;

    const headers = table.querySelectorAll("th[data-sort]");
    headers.forEach((th) => {
      const col = th.dataset.sort;
      th.setAttribute("role", "columnheader");
      th.setAttribute("tabindex", "0");

      const isActive = currentSort.sortBy === col;
      const dir = isActive ? currentSort.sortDir : "none";
      th.setAttribute("aria-sort", dir === "none" ? "none" : dir === "asc" ? "ascending" : "descending");

      let icon = th.querySelector(".sort-icon");
      if (!icon) {
        icon = document.createElement("i");
        icon.className = "sort-icon fa-solid fa-sort";
        th.appendChild(icon);
      }
      if (isActive) {
        icon.className = `sort-icon fa-solid fa-sort-${currentSort.sortDir === "desc" ? "down" : "up"}`;
      } else {
        icon.className = "sort-icon fa-solid fa-sort";
      }

      const handler = () => {
        let newDir = "asc";
        if (currentSort.sortBy === col) {
          newDir = currentSort.sortDir === "asc" ? "desc" : "asc";
        }
        if (typeof onSortChange === "function") {
          onSortChange(col, newDir);
        }
      };

      th.onclick = handler;
      th.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      };
    });
  },

  // Pagination helper
  paginate(items, page = 1, pageSize = 10) {
    const total = items ? items.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const curPage = Math.max(1, Math.min(page, totalPages));
    const offset = (curPage - 1) * pageSize;
    const pagedItems = (items || []).slice(offset, offset + pageSize);
    const startRecord = total === 0 ? 0 : offset + 1;
    const endRecord = Math.min(offset + pageSize, total);

    return {
      items: pagedItems,
      total,
      page: curPage,
      pageSize,
      totalPages,
      startRecord,
      endRecord,
    };
  },

  renderPagination(containerId, meta, onPageChange, onPageSizeChange) {
    const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!container) return;

    if (!meta || meta.total === 0) {
      container.innerHTML = "";
      container.style.display = "none";
      return;
    }
    container.style.display = "flex";

    const { page, totalPages, total, startRecord, endRecord, pageSize } = meta;

    container.className = "pagination-bar";
    container.innerHTML = `
      <div class="pagination-summary">
        Showing <strong>${startRecord}</strong>–<strong>${endRecord}</strong> of <strong>${total}</strong> records
      </div>
      <div class="pagination-controls">
        <label for="${container.id}_sizeSelect" class="sr-only" style="position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0;">Page Size</label>
        <select id="${container.id}_sizeSelect" class="pagination-size-select" aria-label="Records per page">
          <option value="10" ${pageSize === 10 ? "selected" : ""}>10 / page</option>
          <option value="25" ${pageSize === 25 ? "selected" : ""}>25 / page</option>
          <option value="50" ${pageSize === 50 ? "selected" : ""}>50 / page</option>
          <option value="100" ${pageSize === 100 ? "selected" : ""}>100 / page</option>
        </select>
        <button type="button" class="pagination-btn" data-page="1" ${page <= 1 ? "disabled" : ""} aria-label="First page" title="First page">
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button type="button" class="pagination-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page" title="Previous page">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <span style="font-size:0.85rem; font-weight:600; padding:0 6px;">Page ${page} of ${totalPages}</span>
        <button type="button" class="pagination-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Next page" title="Next page">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <button type="button" class="pagination-btn" data-page="${totalPages}" ${page >= totalPages ? "disabled" : ""} aria-label="Last page" title="Last page">
          <i class="fa-solid fa-angles-right"></i>
        </button>
      </div>
    `;

    const sizeSelect = container.querySelector(".pagination-size-select");
    if (sizeSelect && typeof onPageSizeChange === "function") {
      sizeSelect.onchange = (e) => {
        onPageSizeChange(parseInt(e.target.value, 10));
      };
    }

    container.querySelectorAll("button[data-page]").forEach((btn) => {
      btn.onclick = () => {
        const targetPage = parseInt(btn.dataset.page, 10);
        if (targetPage >= 1 && targetPage <= totalPages && typeof onPageChange === "function") {
          onPageChange(targetPage);
        }
      };
    });
  },

  // Filter chips
  renderFilterChips(containerId, filters = {}, onRemove, onClearAll) {
    const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    if (!container) return;

    const entries = Object.entries(filters).filter(([_, val]) => val !== undefined && val !== null && String(val).trim() !== "");
    if (!entries.length) {
      container.innerHTML = "";
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";
    container.className = "filter-chips-bar";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Active filters");

    const chipsHtml = entries
      .map(([key, val]) => {
        const formattedKey = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return `
        <span class="filter-chip" role="status">
          <span>${formattedKey}: <strong>${val}</strong></span>
          <button type="button" class="filter-chip-remove" data-filter-key="${key}" aria-label="Remove ${formattedKey} filter">&times;</button>
        </span>
      `;
      })
      .join("");

    container.innerHTML = `
      <span style="font-weight:600; color:var(--text2); display:inline-flex; align-items:center; gap:4px;">
        <i class="fa-solid fa-filter"></i> Filters:
      </span>
      ${chipsHtml}
      <button type="button" class="btn-clear-filters" id="${container.id}_clearAll" aria-label="Clear all filters">Clear all</button>
    `;

    container.querySelectorAll(".filter-chip-remove").forEach((btn) => {
      btn.onclick = () => {
        if (typeof onRemove === "function") {
          onRemove(btn.dataset.filterKey);
        }
      };
    });

    const clearBtn = container.querySelector(".btn-clear-filters");
    if (clearBtn && typeof onClearAll === "function") {
      clearBtn.onclick = () => {
        onClearAll();
      };
    }
  },
};
window.FinanceTable = FinanceTable;

// ============================================================================
// FinanceDrawer — Shared detail drawer, timeline, related records (Story 1.3)
// ============================================================================
const FinanceDrawer = {
  current: null,
  _historyPushed: false,
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Listen to close button
    const closeBtn = document.getElementById("financeDetailDrawerCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    // Backdrop click
    const overlay = document.getElementById("financeDetailDrawerOverlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close();
      });
    }

    // Keyboard Escape & focus trap
    document.addEventListener("keydown", (e) => {
      if (!this.isOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Tab") {
        this.trapFocus(e);
      }
    });

    // Tab switching inside drawer
    const tablist = document.getElementById("financeDrawerTablist");
    if (tablist) {
      initAccessibleTablist(tablist);
      tablist.querySelectorAll(".filter-tab[data-drawer-tab]").forEach((tab) => {
        tab.addEventListener("click", () => {
          this.switchTab(tab.dataset.drawerTab);
        });
      });
    }

    // Browser history / popstate integration
    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.financeDrawer) {
        const { entityType, entityId } = e.state.financeDrawer;
        this.open(entityType, entityId, null, false);
      } else if (this.isOpen()) {
        this.close(false);
      }
    });

    // Check initial URL hash for deep-linked drawer
    if (window.location.hash && window.location.hash.startsWith("#detail=")) {
      const match = window.location.hash.match(/#detail=([a-zA-Z_]+):(\d+)/);
      if (match) {
        setTimeout(() => this.open(match[1], parseInt(match[2], 10), null, false), 150);
      }
    }
  },

  isOpen() {
    const overlay = document.getElementById("financeDetailDrawerOverlay");
    return overlay && overlay.style.display !== "none";
  },

  trapFocus(e) {
    const drawer = document.getElementById("financeDetailDrawer");
    if (!drawer) return;
    const focusable = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  },

  switchTab(tabName) {
    const panels = {
      summary: document.getElementById("financeDrawerSummaryPanel"),
      timeline: document.getElementById("financeDrawerTimelinePanel"),
      related: document.getElementById("financeDrawerRelatedPanel"),
      attachments: document.getElementById("financeDrawerAttachmentsPanel"),
    };

    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) {
        const active = key === tabName;
        panel.style.display = active ? "block" : "none";
        panel.classList.toggle("active", active);
      }
    });

    const tabs = document.querySelectorAll("#financeDrawerTablist .filter-tab");
    tabs.forEach((tab) => {
      const isSelected = tab.dataset.drawerTab === tabName;
      tab.classList.toggle("active", isSelected);
      tab.setAttribute("aria-selected", isSelected ? "true" : "false");
      tab.setAttribute("tabindex", isSelected ? "0" : "-1");
    });
  },

  async open(entityType, entityId, triggerEl = null, pushHistory = true) {
    this.init();
    const overlay = document.getElementById("financeDetailDrawerOverlay");
    const drawer = document.getElementById("financeDetailDrawer");
    if (!overlay || !drawer) return;

    this.current = {
      entityType,
      entityId,
      triggerEl: triggerEl || document.activeElement,
    };

    overlay.style.display = "flex";
    document.body.classList.add("modal-open");

    // History push state
    if (pushHistory) {
      const hash = `#detail=${entityType}:${entityId}`;
      if (window.location.hash !== hash) {
        history.pushState({ financeDrawer: { entityType, entityId } }, "", window.location.pathname + window.location.search + hash);
        this._historyPushed = true;
      }
    }

    this.switchTab("summary");

    // Initial focus into drawer
    const closeBtn = document.getElementById("financeDetailDrawerCloseBtn");
    if (closeBtn) {
      setTimeout(() => closeBtn.focus(), 50);
    }

    await this.load(entityType, entityId);
  },

  async load(entityType, entityId) {
    const loading = document.getElementById("financeDrawerLoading");
    if (loading) loading.style.display = "block";

    try {
      const data = await FinanceApi.getEntityActivity(entityType, entityId);
      this.render(data);
    } catch (err) {
      console.error("Failed to load entity activity:", err);
      const titleEl = document.getElementById("financeDetailDrawerTitle");
      if (titleEl) titleEl.textContent = "Error loading record";
      const body = document.getElementById("financeDrawerSummaryPanel");
      if (body) {
        body.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation" style="color:var(--danger);"></i><p>Failed to load record detail: ${err.message || err}</p></div>`;
      }
    } finally {
      if (loading) loading.style.display = "none";
    }
  },

  render(data) {
    if (!data) return;

    // Header badge & title
    const badgeEl = document.getElementById("financeDetailDrawerBadge");
    if (badgeEl) badgeEl.textContent = (data.entity_type || "Record").replace(/_/g, " ").toUpperCase();

    const titleEl = document.getElementById("financeDetailDrawerTitle");
    if (titleEl) titleEl.textContent = data.title || "Detail";

    const statusEl = document.getElementById("financeDetailDrawerStatusBadge");
    if (statusEl) {
      statusEl.innerHTML = FinanceFormat.formatStatusBadge(data.entity_type, data.status);
    }

    const maskedEl = document.getElementById("financeDetailDrawerMaskedBadge");
    if (maskedEl) {
      maskedEl.style.display = data.summary?.sensitive_masked ? "inline-flex" : "none";
    }

    // 1. Summary Panel
    const amtEl = document.getElementById("financeDrawerAmountDisplay");
    if (amtEl) {
      amtEl.innerHTML = data.summary?.amount !== undefined && data.summary?.amount !== null
        ? FinanceFormat.renderMoneyHtml(data.summary.amount, data.summary.currency || "USD")
        : "—";
    }

    const cpEl = document.getElementById("financeDrawerCounterpartyDisplay");
    if (cpEl) cpEl.textContent = data.summary?.counterparty || "—";

    const attrsList = document.getElementById("financeDrawerAttributesList");
    if (attrsList) {
      const attrs = data.summary?.attributes || [];
      attrsList.innerHTML = attrs.map((a) => `
        <div class="drawer-attr-item">
          <div class="drawer-attr-label">${a.label}</div>
          <div class="drawer-attr-value">${a.value}</div>
        </div>
      `).join("");
    }

    const notesSec = document.getElementById("financeDrawerNotesSection");
    const notesDisp = document.getElementById("financeDrawerNotesDisplay");
    if (notesSec && notesDisp) {
      if (data.summary?.notes) {
        notesDisp.textContent = data.summary.notes;
        notesSec.style.display = "block";
      } else {
        notesSec.style.display = "none";
      }
    }

    // 2. Timeline Panel
    const timelineList = document.getElementById("financeDrawerTimelineList");
    if (timelineList) {
      const events = data.timeline || [];
      if (!events.length) {
        timelineList.innerHTML = getEmptyStateHtml("No activity events recorded yet.", "fa-solid fa-clock-rotate-left");
      } else {
        timelineList.innerHTML = events.map((evt) => {
          let transitionHtml = "";
          if (evt.state_transition && (evt.state_transition.from_state || evt.state_transition.to_state)) {
            transitionHtml = `
              <div class="timeline-transition">
                ${evt.state_transition.from_state ? `<span class="badge badge-grey">${evt.state_transition.from_state}</span> <i class="fa-solid fa-arrow-right" style="font-size:0.7rem; opacity:0.6;"></i>` : ""}
                <span class="badge badge-info">${evt.state_transition.to_state}</span>
              </div>
            `;
          }
          return `
            <div class="timeline-item">
              <span class="timeline-icon"></span>
              <div class="timeline-header">
                <span class="timeline-actor"><i class="fa-regular fa-user" style="opacity:0.6; margin-right:4px;"></i>${evt.actor || "System"}</span>
                <span class="timeline-time">${FinanceFormat.formatFinanceDate(evt.timestamp, true)}</span>
              </div>
              <div class="timeline-text">${evt.plain_text}</div>
              ${transitionHtml}
            </div>
          `;
        }).join("");
      }
    }

    // 3. Related Records Panel
    const relatedList = document.getElementById("financeDrawerRelatedList");
    if (relatedList) {
      const records = data.related_records || [];
      if (!records.length) {
        relatedList.innerHTML = getEmptyStateHtml("No linked financial records found.", "fa-solid fa-link");
      } else {
        relatedList.innerHTML = records.map((rec) => `
          <div class="related-record-card" role="button" tabindex="0" data-rel-type="${rec.entity_type}" data-rel-id="${rec.entity_id}" aria-label="Open related ${rec.title}">
            <div style="display:flex; flex-direction:column; gap:3px;">
              <div style="font-weight:700; font-size:0.92rem; color:var(--text);">${rec.title}</div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="badge badge-grey" style="font-size:0.72rem;">${rec.badge || rec.entity_type}</span>
                ${rec.date ? `<span style="font-size:0.78rem; color:var(--text3);">${FinanceFormat.formatFinanceDate(rec.date)}</span>` : ""}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              ${rec.amount !== null && rec.amount !== undefined ? `<div style="font-weight:700; font-size:0.95rem; font-variant-numeric:tabular-nums;">${FinanceFormat.renderMoneyHtml(rec.amount, rec.currency || "USD")}</div>` : ""}
              ${rec.entity_type === "payment" && !rec.is_reversed && this.current?.entityType === "bill" ? `<button class="btn btn-sm btn-danger btn-reverse-payment" onclick="event.stopPropagation(); confirmReverseBillPayment(${this.current.entityId}, ${rec.entity_id}, ${rec.amount})" style="font-size:0.75rem; padding: 2px 7px;" title="Reverse Payment"><i class="fa-solid fa-rotate-left"></i> Reverse</button>` : ""}
              <i class="fa-solid fa-chevron-right" style="font-size:0.8rem; color:var(--text3);"></i>
            </div>
          </div>
        `).join("");

        relatedList.querySelectorAll(".related-record-card").forEach((card) => {
          const handler = () => {
            const relType = card.dataset.relType;
            const relId = parseInt(card.dataset.relId, 10);
            this.open(relType, relId, card);
          };
          card.onclick = handler;
          card.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handler();
            }
          };
        });
      }
    }

    // 4. Attachments Panel
    const attachList = document.getElementById("financeDrawerAttachmentsList");
    if (attachList) {
      const attachments = data.attachments || [];
      if (!attachments.length) {
        attachList.innerHTML = getEmptyStateHtml("No documents attached to this record.", "fa-solid fa-paperclip");
      } else {
        attachList.innerHTML = attachments.map((att) => `
          <div class="related-record-card" style="cursor:default;">
            <div style="display:flex; align-items:center; gap:10px;">
              <i class="fa-solid fa-file-pdf" style="font-size:1.4rem; color:var(--danger, #ef4444);"></i>
              <div>
                <div style="font-weight:600; font-size:0.88rem; color:var(--text);">${att.file_name}</div>
                <div style="font-size:0.75rem; color:var(--text3);">${(att.file_size / 1024).toFixed(1)} KB • Uploaded ${att.uploaded_at ? FinanceFormat.formatFinanceDate(att.uploaded_at) : "recently"}</div>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline" onclick="showToast('Document preview loaded', 'info')">
              <i class="fa-solid fa-eye"></i> Preview
            </button>
          </div>
        `).join("");
      }
    }
  },

  close(updateHistory = true) {
    const overlay = document.getElementById("financeDetailDrawerOverlay");
    if (overlay) overlay.style.display = "none";
    document.body.classList.remove("modal-open");

    // Focus restoration to origin invoking element
    if (this.current && this.current.triggerEl && typeof this.current.triggerEl.focus === "function") {
      try {
        this.current.triggerEl.focus();
      } catch (_) {}
    }

    if (updateHistory && window.location.hash && window.location.hash.startsWith("#detail=")) {
      history.pushState(null, "", window.location.pathname + window.location.search);
    }

    this.current = null;
  }
};
window.FinanceDrawer = FinanceDrawer;
window.FinanceDetailDrawer = FinanceDrawer;

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => FinanceDrawer.init());
  } else {
    FinanceDrawer.init();
  }
}


