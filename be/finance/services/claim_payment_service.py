"""
be/finance/services/claim_payment_service.py
The Finance side of paying an insurance claim (D-053, proposed). This is the one door HR uses: HR passes plain values in and
gets a ledger row id back, and never touches Finance models or tables.

Posting goes through LedgerService.record_manual_transaction, the validation path of a manual transaction (account exists,
amount above zero, currency equals the account currency, category and payment type exist, employee payee exists, closed
reconciliation period refused), under the source `insurance_claim`. Nothing is committed here: the caller commits the ledger
row together with its own claim update, so the two succeed or fail as one.

A reversal never deletes. It adds an opposite row (source `insurance_claim_reversal`, reason required) and keeps the original.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from finance import bill_payment_rules as payment_rules
from finance.models import FinanceBankAccountDB, LedgerTransactionDB, PaymentTypeDB
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.categories_repository import CategoriesRepository
from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.schemas import LedgerTransactionCreate
from finance.services.ledger_service import LedgerService

CLAIM_SOURCE = "insurance_claim"
CLAIM_REVERSAL_SOURCE = "insurance_claim_reversal"
CLAIM_CATEGORY_NAME = "Medical Insurance"  # resolved by name, never by id

# PROPOSED DEFAULT (Q-025, owner to confirm): a claim is paid with the same payment types a vendor bill may use from that account
# type (D-018), except Cheque, which needs a cheque number and the cheque lifecycle that a claim payment does not have.
CLAIM_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE = {
    account_type: frozenset(codes) - {payment_rules.CHEQUE}
    for account_type, codes in payment_rules.BILL_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.items()
}


class ClaimLedgerError(Exception):
    """A claim payment or reversal Finance refused. `code` is machine-readable; `status_code` is the HTTP status the API uses."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message}


def _from_http(exc: HTTPException) -> ClaimLedgerError:
    detail = exc.detail
    if isinstance(detail, dict):
        return ClaimLedgerError(str(detail.get("code") or "ledger_refused"), str(detail.get("message") or detail), exc.status_code)
    code = "period_closed" if "closed reconciliation period" in str(detail) else "ledger_refused"  # the ledger raises it as plain text
    return ClaimLedgerError(code, str(detail), exc.status_code)


class ClaimPaymentPosting:
    def __init__(self, db: Session):
        self.db = db
        self.ledger_repo = LedgerRepository(db)
        self.ledger = LedgerService(self.ledger_repo, AccountsRepository(db), CategoriesRepository(db), PaymentTypesRepository(db))

    def post_payment(
        self,
        *,
        account_id: int,
        date: str,
        amount: float,
        currency: str,
        payment_type_id: int,
        employee_id: int,
        employee_name: str,
        claim_id: int,
        claim_category: str,
        reference: str = "",
        user_email: Optional[str] = None,
    ) -> int:
        """Posts the money-out row for a claim and returns its ledger id. Raises ClaimLedgerError; commits nothing."""
        category = CategoriesRepository(self.db).get_by_name(CLAIM_CATEGORY_NAME)
        if category is None:
            raise ClaimLedgerError(
                "category_missing",
                f"The finance category '{CLAIM_CATEGORY_NAME}' does not exist. Create it before paying insurance claims.",
                409,
            )

        account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first()
        if account is None:
            raise ClaimLedgerError("account_not_found", f"Bank account with ID {account_id} not found", 404)
        if account.is_active is False:
            raise ClaimLedgerError("account_inactive", f"Account '{account.account_name}' is not active.", 400)

        payment_type = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == payment_type_id).first()
        if payment_type is None:
            raise ClaimLedgerError("payment_type_not_found", f"Payment type with ID {payment_type_id} not found", 400)
        account_type = (account.account_type or "bank").lower()
        allowed = CLAIM_PAYMENT_TYPE_CODES_BY_ACCOUNT_TYPE.get(account_type, frozenset())
        if payment_type.code not in allowed:
            raise ClaimLedgerError(
                "payment_type_not_allowed",
                f"'{payment_type.name}' cannot pay an insurance claim from a {account_type} account. "
                f"Allowed codes: {', '.join(sorted(allowed)) or 'none'}.",
                400,
            )

        payload = LedgerTransactionCreate(
            date=date,
            amount=amount,
            direction="out",
            currency=currency,
            category_id=category.id,
            payment_type_id=payment_type_id,
            entry_type="standard",
            payee_type="employee",
            payee_id=employee_id,
            payee_name=employee_name,
            counterparty=employee_name,
            reference=(reference or "").strip() or f"CLAIM-{claim_id}",
            description=f"Insurance claim #{claim_id} ({claim_category}) - {employee_name}"[:255],
        )
        try:
            row = self.ledger.record_manual_transaction(account_id, payload, user_email=user_email, source=CLAIM_SOURCE, commit=False)
        except HTTPException as exc:
            raise _from_http(exc)
        except ValueError as exc:  # e.g. closed reconciliation period
            raise ClaimLedgerError("period_closed", str(exc), 400)
        return row.id

    def reverse_payment(self, *, ledger_transaction_id: int, date: str, reason: str, user_email: Optional[str] = None) -> int:
        """Adds the opposite row for a posted claim payment and returns its id. The original stays. Commits nothing."""
        reason = (reason or "").strip()
        if not reason:
            raise ClaimLedgerError("reason_required", "A reason is required to reverse a claim payment.", 400)
        original = self.ledger_repo.get_by_id(ledger_transaction_id)
        if original is None or original.source != CLAIM_SOURCE:
            raise ClaimLedgerError("not_a_claim_payment", f"Ledger entry {ledger_transaction_id} is not an insurance claim payment.", 400)
        marker = f"REV-TX-{original.id}"
        already = (
            self.db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.source == CLAIM_REVERSAL_SOURCE, LedgerTransactionDB.reference == marker)
            .first()
        )
        if already is not None:
            raise ClaimLedgerError("already_reversed", "This claim payment has already been reversed.", 409)
        data = {
            "date": date,
            "amount": original.amount,
            "direction": "in" if original.direction == "out" else "out",
            "currency": original.currency,
            "category_id": original.category_id,
            "payment_type_id": original.payment_type_id,
            "reference": marker,
            "description": f"Reversal of insurance claim payment #{original.id}: {reason}"[:255],
            "entry_type": "standard",
            "payee_type": original.payee_type or "none",
            "payee_id": original.payee_id,
            "payee_name": original.payee_name,
            "counterparty": original.counterparty,
            "reason": reason,
            "source": CLAIM_REVERSAL_SOURCE,
        }
        try:
            row = self.ledger_repo.create_transaction(original.account_id, data, created_by=user_email, commit=False)
        except ValueError as exc:  # closed reconciliation period
            raise ClaimLedgerError("period_closed", str(exc), 400)
        return row.id
