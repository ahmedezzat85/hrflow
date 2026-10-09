"""
be/finance/bill_status.py
Single source of truth for the vendor-bill status model (D-016, Vendor Bill Workflow v2).

Status is never accepted from a client. It changes only through the actions in
BILL_TRANSITIONS, or through derive_payment_status() when payments change.
"""
from datetime import date, datetime
from typing import Dict, List, Optional

DRAFT = "draft"
PENDING_APPROVAL = "pending_approval"
REJECTED = "rejected"
APPROVED = "approved"
SCHEDULED = "scheduled"
PARTIALLY_PAID = "partially_paid"
PAID = "paid"
VOID = "void"

BILL_STATUSES = (DRAFT, PENDING_APPROVAL, REJECTED, APPROVED, SCHEDULED, PARTIALLY_PAID, PAID, VOID)
VALID_BILL_STATUSES = set(BILL_STATUSES)

# Statuses that count as money owed (AP aging, forecast, vendor open totals, attention).
OPEN_STATUSES = (APPROVED, SCHEDULED, PARTIALLY_PAID)

# Statuses that represent committed spend (accrual reports): owed or already paid.
SPEND_STATUSES = OPEN_STATUSES + (PAID,)

# action -> {from_status: to_status}. "pay" and "reverse_payment" resolve their
# target through derive_payment_status(); the value here is only the default.
BILL_TRANSITIONS: Dict[str, Dict[str, str]] = {
    "submit": {DRAFT: PENDING_APPROVAL, REJECTED: PENDING_APPROVAL},
    "withdraw": {PENDING_APPROVAL: DRAFT},
    "approve": {PENDING_APPROVAL: APPROVED},
    "reject": {PENDING_APPROVAL: REJECTED},
    "send_back": {APPROVED: PENDING_APPROVAL, SCHEDULED: PENDING_APPROVAL},
    "schedule": {APPROVED: SCHEDULED},
    "unschedule": {SCHEDULED: APPROVED},
    "pay": {APPROVED: PARTIALLY_PAID, SCHEDULED: PARTIALLY_PAID, PARTIALLY_PAID: PARTIALLY_PAID},
    "reverse_payment": {PAID: APPROVED, PARTIALLY_PAID: APPROVED},
    "void": {
        DRAFT: VOID,
        PENDING_APPROVAL: VOID,
        REJECTED: VOID,
        APPROVED: VOID,
        SCHEDULED: VOID,
    },
}


class InvalidBillTransition(Exception):
    """Raised when an action is not allowed from the bill's current status."""

    def __init__(self, action: str, current_status: str):
        self.action = action
        self.current_status = current_status
        self.allowed_actions = allowed_actions(current_status)
        super().__init__(f"Cannot {action.replace('_', ' ')} a bill in '{current_status}' status")

    def detail(self) -> dict:
        return {
            "code": "invalid_transition",
            "message": str(self),
            "action": self.action,
            "current_status": self.current_status,
            "allowed_actions": self.allowed_actions,
        }


def allowed_actions(current_status: str) -> List[str]:
    return [a for a, m in BILL_TRANSITIONS.items() if current_status in m]


def next_status(action: str, current_status: str) -> str:
    """Return the target status for an action, or raise InvalidBillTransition."""
    target = BILL_TRANSITIONS.get(action, {}).get(current_status)
    if target is None:
        raise InvalidBillTransition(action, current_status)
    return target


def is_overdue(status: str, due_date: Optional[str], today: Optional[date] = None) -> bool:
    """Overdue is a flag, not a status: open bill whose due date is before today."""
    if status not in OPEN_STATUSES or not due_date:
        return False
    today = today or datetime.utcnow().date()
    try:
        return datetime.strptime(str(due_date)[:10], "%Y-%m-%d").date() < today
    except ValueError:
        return False


def derive_payment_status(bill, active_cheque_linked: bool = False, amount_paid: Optional[float] = None) -> str:
    """
    Status of a payable bill from its recorded, unreversed payments.
    `amount_paid` may be passed when the relationship is not yet refreshed.
    Never overwrites draft / pending_approval / rejected / void.
    `active_cheque_linked` is a temporary B1 allowance: a posted cheque linked to the
    bill counts as full payment until cheques create payment records (B3).
    """
    current = bill.status
    if current in (DRAFT, PENDING_APPROVAL, REJECTED, VOID):
        return current
    if amount_paid is None:
        amount_paid = sum(float(p.amount or 0.0) for p in (bill.payments or []) if not getattr(p, "is_reversed", False))
    paid = round(float(amount_paid), 2)
    total = float(bill.total or 0.0)
    if paid > 0.001 or active_cheque_linked:
        if active_cheque_linked or paid >= total - 0.01:
            return PAID
        return PARTIALLY_PAID
    return SCHEDULED if bill.scheduled_payment_date else APPROVED
