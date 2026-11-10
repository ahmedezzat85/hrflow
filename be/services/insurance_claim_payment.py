"""
be/services/insurance_claim_payment.py
Paying an approved insurance claim from a company account, and undoing it (D-053, proposed).

HR owns the claim and its payment state; Finance owns the ledger. This module reaches Finance only through the explicit
interface `finance.services.claim_payment_service.ClaimPaymentPosting` (plain values in, a ledger row id out) and imports no
Finance model. The claim row is locked while it is paid, the ledger row and the claim update are one database transaction, and
a failure anywhere rolls both back.

Company accounts only: the money leaves a company account; no employee bank account is ever read or written.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from finance.services.claim_payment_service import ClaimLedgerError, ClaimPaymentPosting
from models_db import InsuranceClaimDB

# Only claims dated on or after this day can be paid through HRFlow. Older claims are left alone, not flagged. One place.
CLAIM_PAYMENT_START_DATE = "2026-01-01"
# PROPOSED DEFAULT (Q-025, owner to confirm): the claim has no currency or approved-amount field, so a claim is in EGP (as its request
# text and consumption already assume) and the amount paid is the claim amount. Paying from an account in another currency is refused.
CLAIM_CURRENCY = "EGP"

UNPAID, PAID, REVERSED = "unpaid", "paid", "reversed"


class InsuranceClaimPaymentError(Exception):
    """A claim payment or reversal refused. `code` is machine-readable; `status_code` is the HTTP status the API uses."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}


def _wrap(exc: ClaimLedgerError) -> InsuranceClaimPaymentError:
    return InsuranceClaimPaymentError(exc.code, exc.message, exc.status_code)


def is_payable_date(claim_date: str) -> bool:
    return (claim_date or "")[:10] >= CLAIM_PAYMENT_START_DATE


def _locked_claim(db: Session, claim_id: int) -> InsuranceClaimDB:
    claim = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == int(claim_id)).with_for_update().first()
    if claim is None:
        raise InsuranceClaimPaymentError("claim_not_found", "Claim not found", 404)
    return claim


def pay_claim(
    db: Session,
    claim_id: int,
    *,
    account_id: int,
    payment_date: Optional[str] = None,
    payment_type_id: int,
    reference: str = "",
    user_id: Optional[int] = None,
    user_email: Optional[str] = None,
) -> dict:
    """Posts the claim's payment to the ledger and marks the claim paid. All or nothing."""
    try:
        claim = _locked_claim(db, claim_id)
        if (claim.status or "") != "Approved":
            raise InsuranceClaimPaymentError("claim_not_approved", "Only an approved claim can be paid.", 409)
        if (claim.payment_status or UNPAID) == PAID:
            raise InsuranceClaimPaymentError("claim_already_paid", "This claim is already paid.", 409)
        if not is_payable_date(claim.date):
            raise InsuranceClaimPaymentError(
                "claim_not_eligible",
                f"Claims dated before {CLAIM_PAYMENT_START_DATE} are not paid through HRFlow.",
                409,
            )

        when = (payment_date or datetime.utcnow().strftime("%Y-%m-%d"))[:10]
        try:
            ledger_id = ClaimPaymentPosting(db).post_payment(
                account_id=account_id,
                date=when,
                amount=float(claim.amount or 0.0),
                currency=CLAIM_CURRENCY,
                payment_type_id=payment_type_id,
                employee_id=claim.employee_id,
                employee_name=claim.employee_name or "",
                claim_id=claim.id,
                claim_category=claim.category or "",
                reference=reference,
                user_email=user_email,
            )
        except ClaimLedgerError as exc:
            raise _wrap(exc)

        claim.payment_status = PAID
        claim.paid_at = datetime.utcnow()
        claim.paid_by_user_id = user_id
        claim.ledger_transaction_id = ledger_id
        claim.payment_reversal_transaction_id = None  # a re-payment starts clean; the earlier pair stays in the ledger
        db.commit()
        return _state(claim)
    except Exception:
        db.rollback()
        raise


def reverse_claim_payment(
    db: Session,
    claim_id: int,
    *,
    reason: str,
    reversal_date: Optional[str] = None,
    user_email: Optional[str] = None,
) -> dict:
    """Adds a reversing ledger row (original kept) and marks the claim reversed, so it can be paid again. All or nothing."""
    try:
        claim = _locked_claim(db, claim_id)
        if (claim.payment_status or UNPAID) != PAID or not claim.ledger_transaction_id:
            raise InsuranceClaimPaymentError("claim_not_paid", "Only a paid claim can have its payment reversed.", 409)
        when = (reversal_date or datetime.utcnow().strftime("%Y-%m-%d"))[:10]
        try:
            reversal_id = ClaimPaymentPosting(db).reverse_payment(
                ledger_transaction_id=claim.ledger_transaction_id, date=when, reason=reason, user_email=user_email
            )
        except ClaimLedgerError as exc:
            raise _wrap(exc)
        claim.payment_status = REVERSED
        claim.payment_reversal_transaction_id = reversal_id
        db.commit()
        return _state(claim)
    except Exception:
        db.rollback()
        raise


def _state(claim: InsuranceClaimDB) -> dict:
    return {
        "id": claim.id,
        "payment_status": claim.payment_status,
        "paid_at": claim.paid_at.isoformat() if claim.paid_at else None,
        "ledger_transaction_id": claim.ledger_transaction_id,
        "payment_reversal_transaction_id": claim.payment_reversal_transaction_id,
    }
