"""
be/finance/cash_basis.py
Cash-basis classification of ledger rows for the P&L views (D-026).

Each ledger row counts toward revenue, toward spend, or toward neither:
  - Movements between the company's own accounts are neither: transfers, FX exchange, teller
    withdrawals and cash-withdrawal cheques (both legs).
  - Reversal entries (bill_payment_reversal, cheque_reversal, payment_reversal) reduce the side of the
    entry they reverse. They are never revenue or new spend.
  - Payroll and statutory payments are spend.
  - Everything else follows the existing rules: money in is revenue, money out is spend, except rows whose
    category says otherwise.
"""
from typing import Optional, Tuple

REVERSAL_SOURCES = frozenset({"bill_payment_reversal", "cheque_reversal", "payment_reversal", "revenue_receipt_reversal"})
FORCED_SPEND_SOURCES = frozenset({"payroll", "statutory_remittance"})

# Payment types that only move money between the company's own accounts
OWN_ACCOUNT_PAYMENT_TYPE_CODES = frozenset({"CASHWITHDRAW", "USDTOEGP", "INTTRANS"})
OWN_ACCOUNT_DESCRIPTION_PREFIXES = ("Teller cash withdrawal from", "Cash withdrawal funding via Cheque")

REVENUE = "revenue"
SPEND = "spend"


def is_own_account_movement(tx, category_kind: Optional[str] = None) -> bool:
    if tx.source == "transfer" or category_kind == "transfer":
        return True
    # out leg of a teller or cheque cash withdrawal carries the destination cash account
    if getattr(tx, "destination_cash_account_id", None) is not None:
        return True
    description = tx.description or ""
    if any(description.startswith(p) for p in OWN_ACCOUNT_DESCRIPTION_PREFIXES):
        return True
    pt = getattr(tx, "payment_type", None)
    if pt is not None and pt.code in OWN_ACCOUNT_PAYMENT_TYPE_CODES:
        return True
    if tx.source == "cheque_reversal":
        cheque = getattr(tx, "linked_cheque", None)
        if cheque is not None and getattr(cheque, "purpose_type", None) == "cash_withdrawal":
            return True
    return False


def classify(tx, category_kind: Optional[str] = None, has_category: Optional[bool] = None) -> Optional[Tuple[str, float]]:
    """Return (side, signed_amount) for a ledger row, or None when it counts toward neither side."""
    amount = float(tx.amount or 0.0)
    if is_own_account_movement(tx, category_kind):
        return None

    if tx.source in REVERSAL_SOURCES:
        # A reversal posted as money out reverses an inflow (revenue); money in reverses an outflow (spend)
        return (REVENUE, -amount) if tx.direction == "out" else (SPEND, -amount)

    if has_category is None:
        has_category = category_kind is not None

    if tx.direction == "in":
        counts = (
            category_kind == "revenue"
            or tx.linked_invoice_id
            or not has_category
            or category_kind != "cost"
        )
        return (REVENUE, amount) if counts else None

    counts = (
        tx.source in FORCED_SPEND_SOURCES
        or category_kind == "cost"
        or tx.linked_bill_id
        or tx.source in ("bill_payment", "subscription_charge", "cheque")
        or not has_category
        or category_kind != "revenue"
    )
    return (SPEND, amount) if counts else None

# --- Book views (D-028) ---------------------------------------------------------------------------------------
# Inter-book transfers are only visible inside a single-book view. They never count as operating spend, and only
# the Local view reads an inflow from Overseas as revenue.
TRANSFER_IN = "transfer_in"
TRANSFER_OUT = "transfer_out"


def _is_intercompany_receipt(tx) -> bool:
    if tx.source not in ("invoice_payment", "payment_reversal"):
        return False
    invoice = getattr(tx, "linked_invoice", None)
    customer = getattr(invoice, "customer", None) if invoice is not None else None
    return bool(getattr(customer, "is_intercompany", False))


def classify_view(tx, category_kind: Optional[str] = None, has_category: Optional[bool] = None, scope=None):
    """Return (side, signed_amount, label) for a ledger row in a book view, or None when it counts nowhere.

    With no scope (or a scope that neither restricts nor eliminates) this is exactly classify(); label is None.
    Sides are REVENUE, SPEND and, inside a single-book view only, TRANSFER_IN / TRANSFER_OUT.
    """
    from finance import books

    if scope is not None and scope.restricts and scope.inter_book(tx):
        amount = float(tx.amount or 0.0)
        local = scope.view == books.LOCAL
        if tx.direction == "in":
            if local:
                return (REVENUE, amount, books.INCOME_FROM_OVERSEAS)
            return (TRANSFER_IN, amount, books.RECEIVED_FROM_LOCAL)
        return (TRANSFER_OUT, amount, books.TRANSFERRED_TO_OVERSEAS if local else books.TRANSFERRED_TO_LOCAL)

    if scope is not None and _is_intercompany_receipt(tx):
        if scope.eliminates:
            return None
        if scope.view == books.LOCAL:
            base = classify(tx, category_kind, has_category)
            if base:
                return (base[0], base[1], books.INTERCOMPANY_INCOME)
            return None

    base = classify(tx, category_kind, has_category)
    return (base[0], base[1], None) if base else None
