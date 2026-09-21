/**
 * fe/public/js/payroll-cycle.js
 * State machine and event coordinator for Payroll Cycles:
 * DRAFT -> REVIEW -> APPROVED -> PAID
 */

const PayrollCycleManager = {
  currentMonth: '2026-09',
  cycles: {},
  subscribers: [],

  init(defaultMonth = '2026-09') {
    this.currentMonth = defaultMonth;
    this.loadState(this.currentMonth);
    this.updateCycleBarUI();
  },

  getCurrentMonth() {
    return this.currentMonth;
  },

  setMonth(month) {
    if (!month) return;
    this.currentMonth = month;
    this.loadState(month);
    this.emitChange();
    this.updateCycleBarUI();
  },

  getCurrentCycle() {
    if (!this.cycles[this.currentMonth]) {
      this.loadState(this.currentMonth);
    }
    return this.cycles[this.currentMonth];
  },

  getStatus() {
    const cycle = this.getCurrentCycle();
    return (cycle && cycle.status) || 'DRAFT';
  },

  canEdit() {
    const status = this.getStatus();
    return status === 'DRAFT' || status === 'REVIEW';
  },

  loadState(month) {
    const storageKey = `hrflow_payroll_cycle_${month}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        this.cycles[month] = JSON.parse(stored);
        return;
      }
    } catch (_) {}

    // Default state if not persisted
    this.cycles[month] = {
      id: month,
      month: month,
      status: 'DRAFT',
      lockedAt: null,
      updatedAt: new Date().toISOString()
    };
  },

  saveState(month) {
    const cycle = this.cycles[month];
    if (!cycle) return;
    try {
      localStorage.setItem(`hrflow_payroll_cycle_${month}`, JSON.stringify(cycle));
    } catch (_) {}
  },

  resetCycle(month = this.currentMonth) {
    this.cycles[month] = {
      id: month,
      month: month,
      status: 'DRAFT',
      lockedAt: null,
      updatedAt: new Date().toISOString()
    };
    try {
      localStorage.removeItem(`hrflow_payroll_cycle_${month}`);
      localStorage.removeItem(`hrflow_payroll_rows_${month}`);
    } catch (_) {}
    this.emitChange();
    this.updateCycleBarUI();
  },

  checkAdminPermission() {
    let role = '';
    if (typeof SessionInfo !== 'undefined' && typeof SessionInfo.getRole === 'function') {
      role = SessionInfo.getRole();
    } else if (typeof currentPortal !== 'undefined' && currentPortal === 'admin') {
      role = 'admin';
    } else if (typeof Api !== 'undefined' && typeof Api.getCurrentUser === 'function') {
      role = Api.getCurrentUser()?.role || '';
    }
    return role === 'admin' || role === 'system_admin';
  },

  async submitForReview() {
    if (this.getStatus() !== 'DRAFT') return false;

    let confirmed = true;
    if (typeof FinanceConfirm !== 'undefined' && typeof FinanceConfirm.confirmAction === 'function') {
      const res = await FinanceConfirm.confirmAction({
        title: 'Submit Payroll for Review',
        consequence: `Are you sure you want to submit the payroll cycle for ${this.currentMonth} for review? Reviewers will verify calculations and line items.`,
        actionLabel: 'Submit for Review',
        actionClass: 'btn btn-primary',
        severity: 'info'
      });
      confirmed = res && res.confirmed;
    }

    if (!confirmed) return false;

    const cycle = this.getCurrentCycle();
    cycle.status = 'REVIEW';
    cycle.updatedAt = new Date().toISOString();
    this.saveState(this.currentMonth);
    this.emitChange();
    this.updateCycleBarUI();
    if (typeof showToast === 'function') {
      showToast(`Payroll for ${this.currentMonth} submitted for review.`, 'success');
    }
    return true;
  },

  async approve() {
    if (this.getStatus() !== 'REVIEW') return false;

    if (!this.checkAdminPermission()) {
      if (typeof showToast === 'function') {
        showToast('Admin permissions required to approve payroll.', 'error');
      }
      return false;
    }

    let confirmed = true;
    if (typeof FinanceConfirm !== 'undefined' && typeof FinanceConfirm.confirmAction === 'function') {
      const res = await FinanceConfirm.confirmAction({
        title: 'Approve Payroll Cycle',
        consequence: `Approving payroll for ${this.currentMonth} will lock all inline edits and finalize payout figures. Do you wish to proceed?`,
        actionLabel: 'Approve Payroll',
        actionClass: 'btn btn-success',
        severity: 'warning'
      });
      confirmed = res && res.confirmed;
    }

    if (!confirmed) return false;

    const cycle = this.getCurrentCycle();
    cycle.status = 'APPROVED';
    cycle.lockedAt = new Date().toISOString();
    cycle.updatedAt = new Date().toISOString();
    this.saveState(this.currentMonth);
    this.emitChange();
    this.updateCycleBarUI();
    if (typeof showToast === 'function') {
      showToast(`Payroll cycle ${this.currentMonth} approved and locked.`, 'success');
    }
    return true;
  },

  async markAsPaid() {
    if (this.getStatus() !== 'APPROVED') return false;

    if (!this.checkAdminPermission()) {
      if (typeof showToast === 'function') {
        showToast('Admin permissions required to mark payroll as paid.', 'error');
      }
      return false;
    }

    let confirmed = true;
    if (typeof FinanceConfirm !== 'undefined' && typeof FinanceConfirm.confirmAction === 'function') {
      const res = await FinanceConfirm.confirmAction({
        title: 'Mark Payroll as Paid',
        consequence: `Confirm that all salary disbursements for ${this.currentMonth} have been executed through bank and cash accounts?`,
        actionLabel: 'Mark as Paid',
        actionClass: 'btn btn-primary',
        severity: 'info'
      });
      confirmed = res && res.confirmed;
    }

    if (!confirmed) return false;

    const cycle = this.getCurrentCycle();
    cycle.status = 'PAID';
    cycle.updatedAt = new Date().toISOString();
    this.saveState(this.currentMonth);
    this.emitChange();
    this.updateCycleBarUI();
    if (typeof showToast === 'function') {
      showToast(`Payroll for ${this.currentMonth} marked as paid.`, 'success');
    }
    return true;
  },

  async reopenDraft() {
    let confirmed = true;
    if (typeof FinanceConfirm !== 'undefined' && typeof FinanceConfirm.confirmAction === 'function') {
      const res = await FinanceConfirm.confirmAction({
        title: 'Reopen Payroll Draft',
        consequence: `Reopening the payroll draft for ${this.currentMonth} will unlock cells and allow adjustments. Proceed?`,
        actionLabel: 'Reopen Draft',
        actionClass: 'btn btn-warning',
        severity: 'warning'
      });
      confirmed = res && res.confirmed;
    }

    if (!confirmed) return false;

    const cycle = this.getCurrentCycle();
    cycle.status = 'DRAFT';
    cycle.lockedAt = null;
    cycle.updatedAt = new Date().toISOString();
    this.saveState(this.currentMonth);
    this.emitChange();
    this.updateCycleBarUI();
    if (typeof showToast === 'function') {
      showToast(`Payroll for ${this.currentMonth} reopened as draft.`, 'info');
    }
    return true;
  },

  subscribe(fn) {
    if (typeof fn === 'function') {
      this.subscribers.push(fn);
    }
  },

  emitChange() {
    const cycle = this.getCurrentCycle();
    const event = new CustomEvent('payroll:cycle-changed', {
      detail: { month: this.currentMonth, status: cycle.status, cycle }
    });
    document.dispatchEvent(event);

    this.subscribers.forEach((fn) => {
      try {
        fn(cycle);
      } catch (e) {
        console.error('Payroll cycle subscriber error:', e);
      }
    });
  },

  updateCycleBarUI() {
    const status = this.getStatus();
    const steps = ['DRAFT', 'REVIEW', 'APPROVED', 'PAID'];
    const currentIndex = steps.indexOf(status);

    steps.forEach((step, idx) => {
      const stepEl = document.getElementById(`payrollStep_${step.toLowerCase()}`);
      if (!stepEl) return;

      stepEl.classList.remove('active', 'completed', 'pending');
      if (idx < currentIndex) {
        stepEl.classList.add('completed');
      } else if (idx === currentIndex) {
        stepEl.classList.add('active');
      } else {
        stepEl.classList.add('pending');
      }
    });

    const statusBadgeEl = document.getElementById('payrollCycleCurrentBadge');
    if (statusBadgeEl) {
      statusBadgeEl.textContent = status;
      statusBadgeEl.className = `badge payroll-status-badge payroll-status-${status.toLowerCase()}`;
    }

    const lockBanner = document.getElementById('payrollTableLockBanner');
    if (lockBanner) {
      if (!this.canEdit()) {
        lockBanner.style.display = 'flex';
        const lockText = document.getElementById('payrollLockBannerText');
        if (lockText) {
          lockText.textContent = status === 'PAID'
            ? `Cycle ${this.currentMonth} is PAID. Table is locked.`
            : `Cycle ${this.currentMonth} is APPROVED. Table is locked for editing.`;
        }
      } else {
        lockBanner.style.display = 'none';
      }
    }

    // Action button visibility
    const btnSubmit = document.getElementById('btnPayrollSubmitReview');
    const btnApprove = document.getElementById('btnPayrollApprove');
    const btnPaid = document.getElementById('btnPayrollMarkPaid');
    const btnReopen = document.getElementById('btnPayrollReopenDraft');

    if (btnSubmit) btnSubmit.style.display = status === 'DRAFT' ? 'inline-flex' : 'none';
    if (btnApprove) btnApprove.style.display = status === 'REVIEW' ? 'inline-flex' : 'none';
    if (btnPaid) btnPaid.style.display = status === 'APPROVED' ? 'inline-flex' : 'none';
    if (btnReopen) btnReopen.style.display = status !== 'DRAFT' ? 'inline-flex' : 'none';
  }
};

window.PayrollCycleManager = PayrollCycleManager;
