"""
be/finance/invoice_status.py
Single source of truth for the sales-invoice status model (D-022, Finance Review Round 2, slice F1).

Status is never accepted from a client. It changes only through the actions in INVOICE_TRANSITIONS,
or through derive_payment_status() when receipts change. Overdue is a flag, not a status.
"""
from datetime import date, datetime
from typing import Dict, List, Optional

DRAFT = "draft"
SENT = "sent"
PARTIALLY_PAID = "partially_paid"
PAID = "paid"
VOID = "void"

INVOICE_STATUSES = (DRAFT, SENT, PARTIALLY_PAID, PAID, VOID)
VALID_INVOICE_STATUSES = set(INVOICE_STATUSES)

# Statuses that count as money owed by the customer.
OPEN_STATUSES = (SENT, PARTIALLY_PAID)

# List-only filters (never stored, never returned as `status`).
LIST_FILTERS = VALID_INVOICE_STATUSES | {"open", "overdue", "awaiting_payment", "all"}

# Fields that cannot change once the invoice has left Draft (void and reissue to correct).
# VAT and withholding rate join this tuple when slices F2/F3 add them.
LOCKED_FIELDS = ("customer_id", "currency", "invoice_number", "issue_date", "vat_rate", "lines")

INVOICE_SERVER_OWNED_FIELDS = ("status", "void_reason", "voided_by", "voided_at")

INVOICE_TRANSITIONS: Dict[str, Dict[str, str]] = {
    "send": {DRAFT: SENT},
    "receive": {SENT: PARTIALLY_PAID, PARTIALLY_PAID: PARTIALLY_PAID},
    "reverse_receipt": {PAID: PARTIALLY_PAID, PARTIALLY_PAID: PARTIALLY_PAID},
    "void": {DRAFT: VOID, SENT: VOID},
}


# Default VAT rate (percent) for a new invoice (D-023): 14 for EGP invoices, 0 for other currencies.
DEFAULT_EGP_VAT_RATE = 14.0


def default_vat_rate(currency: Optional[str]) -> float:
    return DEFAULT_EGP_VAT_RATE if (currency or "").upper() == "EGP" else 0.0


def compute_totals(subtotal: float, vat_rate: Optional[float]):
    """(subtotal, tax_amount, total): VAT is on the net subtotal; revenue reports use the net subtotal."""
    subtotal = round(float(subtotal or 0.0), 4)
    tax = round(subtotal * float(vat_rate or 0.0) / 100.0, 2)
    return subtotal, tax, round(subtotal + tax, 4)


def allowed_actions(status: str) -> List[str]:
    actions = [a for a, m in INVOICE_TRANSITIONS.items() if status in m]
    if status in (DRAFT, SENT, PARTIALLY_PAID):
        actions.append("update")
    return actions


class InvalidInvoiceTransition(Exception):
    """Raised when an action is not allowed from the invoice's current status."""

    def __init__(self, action: str, current_status: str):
        self.action = action
        self.current_status = current_status
        self.allowed_actions = allowed_actions(current_status)
        super().__init__(f"Cannot {action.replace('_', ' ')} an invoice in '{current_status}' status")

    def detail(self) -> dict:
        return {
            "code": "invalid_transition",
            "message": str(self),
            "current_status": self.current_status,
            "allowed_actions": self.allowed_actions,
        }


class ReceiptError(ValueError):
    """A receipt refused by a D-022 rule. `code` is the machine-readable reason."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}


def next_status(action: str, current: str) -> str:
    target = INVOICE_TRANSITIONS.get(action, {}).get(current)
    if target is None:
        raise InvalidInvoiceTransition(action, current)
    return target


def derive_payment_status(total: float, received: float) -> str:
    """Status of an issued invoice from unreversed receipts: sent / partially_paid / paid."""
    total = float(total or 0.0)
    received = round(float(received or 0.0), 2)
    if total > 0 and received >= round(total, 2) - 0.001:
        return PAID
    if received > 0.001:
        return PARTIALLY_PAID
    return SENT


def is_overdue(status: str, due_date: Optional[str], today: Optional[date] = None) -> bool:
    if status not in OPEN_STATUSES or not due_date:
        return False
    today = today or datetime.utcnow().date()
    try:
        return datetime.strptime(str(due_date)[:10], "%Y-%m-%d").date() < today
    except ValueError:
        return False


# Incoming payment type codes allowed per receiving account kind.
RECEIPT_TYPE_CODES_BY_ACCOUNT_TYPE = {"cash": frozenset({"CASH"}), "bank": frozenset({"INBOUND_TRANS"})}
DEFAULT_RECEIPT_TYPE_CODE_BY_ACCOUNT_TYPE = {"cash": "CASH", "bank": "INBOUND_TRANS"}
METHOD_BY_RECEIPT_TYPE_CODE = {"CASH": "cash", "INBOUND_TRANS": "bank_transfer"}
