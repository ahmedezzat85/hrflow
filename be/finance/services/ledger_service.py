"""
be/finance/services/ledger_service.py
Business logic and validation for the transaction ledger (Phase 1 Revision 2).
"""
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.categories_repository import CategoriesRepository
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.schemas import (
    LedgerTransactionCreate,
    LedgerTransactionResponse,
    TransactionPreviewRequest,
    TransactionPreviewResponse,
)
from finance.models import LedgerTransactionDB


class LedgerService:
    def __init__(
        self,
        repo: LedgerRepository,
        accounts_repo: Optional[AccountsRepository] = None,
        categories_repo: Optional[CategoriesRepository] = None,
        payment_types_repo: Optional[PaymentTypesRepository] = None,
    ):
        self.repo = repo
        self.accounts_repo = accounts_repo
        self.categories_repo = categories_repo
        self.payment_types_repo = payment_types_repo

    @staticmethod
    def compute_equivalent_amount(amount: float, currency: str, fx_rate: Optional[float], target_currency: Optional[str] = None) -> Optional[float]:
        """
        Computes equivalent value using fx_rate if present.
        Derived on read, never stored redundantly.
        """
        if not fx_rate or fx_rate <= 0:
            return None
        curr = (currency or "").upper()
        target = (target_currency or "").upper() if target_currency else ("EGP" if curr == "USD" else "USD")

        if curr == "USD" and target == "EGP":
            return round(amount * fx_rate, 4)
        elif curr == "EGP" and target == "USD":
            return round(amount / fx_rate, 4)
        else:
            return round(amount * fx_rate, 4)

    def to_response(self, tx: LedgerTransactionDB, target_currency: Optional[str] = None) -> LedgerTransactionResponse:
        cat_name = tx.category.name if tx.category else None
        pt_code = tx.payment_type.code if tx.payment_type else None
        pt_name = tx.payment_type.name if tx.payment_type else None
        fx_eq = self.compute_equivalent_amount(tx.amount, tx.currency, tx.fx_rate, target_currency)

        return LedgerTransactionResponse(
            id=tx.id,
            account_id=tx.account_id,
            date=tx.date,
            amount=tx.amount,
            direction=tx.direction,
            currency=tx.currency,
            category_id=tx.category_id,
            payment_type_id=tx.payment_type_id,
            entry_type=getattr(tx, "entry_type", "standard") or "standard",
            counterparty=getattr(tx, "counterparty", None),
            tax_amount=float(getattr(tx, "tax_amount", 0.0) or 0.0),
            base_amount=getattr(tx, "base_amount", None),
            reason=getattr(tx, "reason", None),
            category_name=cat_name,
            payment_type_code=pt_code,
            payment_type_name=pt_name,
            reference=tx.reference or "",
            description=tx.description or "",
            cheque_number=tx.cheque_number,
            fx_rate=tx.fx_rate,
            fx_equivalent=fx_eq,
            source=tx.source,
            linked_invoice_id=tx.linked_invoice_id,
            linked_bill_id=tx.linked_bill_id,
            linked_transfer_id=tx.linked_transfer_id,
            linked_cheque_id=tx.linked_cheque_id,
            destination_cash_account_id=tx.destination_cash_account_id,
            running_balance=tx.running_balance,
            created_at=tx.created_at,
            created_by=tx.created_by,
        )

    def list_transactions(
        self,
        account_id: int,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        category_id: Optional[int] = None,
        payment_type_id: Optional[int] = None,
        direction: Optional[str] = None,
        is_petty: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[LedgerTransactionResponse]:
        if self.accounts_repo:
            account = self.accounts_repo.get_by_id(account_id)
            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Bank account with ID {account_id} not found",
                )

        txs = self.repo.list_by_account(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            category_id=category_id,
            payment_type_id=payment_type_id,
            direction=direction,
            is_petty=is_petty,
            limit=limit,
            offset=offset,
        )
        return [self.to_response(tx) for tx in txs]

    def get_transaction(self, tx_id: int) -> LedgerTransactionResponse:
        tx = self.repo.get_by_id(tx_id)
        if not tx:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transaction with ID {tx_id} not found",
            )
        return self.to_response(tx)

    def record_manual_transaction(
        self,
        account_id: int,
        payload: LedgerTransactionCreate,
        user_email: Optional[str] = None,
    ) -> LedgerTransactionResponse:
        account = None
        if self.accounts_repo:
            account = self.accounts_repo.get_by_id(account_id)
            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Bank account with ID {account_id} not found",
                )

        if payload.direction not in ("in", "out"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction direction must be 'in' or 'out'",
            )

        if payload.amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction amount must be strictly greater than 0",
            )

        # Currency mismatch validation: transaction currency vs account currency
        tx_curr = (payload.currency or "USD").upper()
        acct_curr = (account.currency if account else "USD").upper()
        if tx_curr != acct_curr:
            if not payload.fx_rate or payload.fx_rate <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Currency mismatch between transaction ({tx_curr}) and account ({acct_curr}). An exchange rate (fx_rate) is required.",
                )

        # Guided entry type validation
        entry_type = (payload.entry_type or "standard").lower()
        if entry_type == "bank_fee":
            payload.direction = "out"
        elif entry_type == "adjustment":
            if not payload.reason or not payload.reason.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A specific reason is required when recording an adjustment.",
                )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        data["source"] = "manual"

        # Auto-compute base_amount if foreign currency
        if tx_curr != acct_curr and payload.fx_rate:
            data["base_amount"] = self.compute_equivalent_amount(payload.amount, tx_curr, payload.fx_rate, acct_curr)

        # Resolve category string fallback if category_id not provided
        if not data.get("category_id") and payload.category and self.categories_repo:
            cat_match = self.categories_repo.get_by_name(payload.category)
            if cat_match:
                data["category_id"] = cat_match.id

        # Validate category_id exists if provided
        if data.get("category_id") and self.categories_repo:
            cat = self.categories_repo.get_by_id(data["category_id"])
            if not cat:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Category with ID {data['category_id']} not found",
                )

        # Validate payment_type_id exists if provided
        if data.get("payment_type_id") and self.payment_types_repo:
            pt = self.payment_types_repo.get_by_id(data["payment_type_id"])
            if not pt:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment type with ID {data['payment_type_id']} not found",
                )

        try:
            tx = self.repo.create_transaction(account_id, data, created_by=user_email)
            return self.to_response(tx)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

    def preview_transaction(
        self,
        account_id: int,
        payload: TransactionPreviewRequest,
    ) -> TransactionPreviewResponse:
        if not self.accounts_repo:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Accounts repo unavailable")
        account = self.accounts_repo.get_by_id(account_id)
        if not account:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bank account with ID {account_id} not found")

        tx_curr = (payload.currency or account.currency or "USD").upper()
        acct_curr = (account.currency or "USD").upper()
        fx_rate = payload.fx_rate

        if tx_curr != acct_curr:
            if not fx_rate or fx_rate <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Currency mismatch between transaction ({tx_curr}) and account ({acct_curr}). An exchange rate (fx_rate) is required.",
                )
            converted = self.compute_equivalent_amount(payload.amount, tx_curr, fx_rate, acct_curr) or payload.amount
        else:
            converted = payload.amount

        cur_bal = float(account.current_balance or 0.0)
        direction = "out" if payload.entry_type == "bank_fee" else payload.direction.lower()
        if direction == "in":
            proj_bal = round(cur_bal + converted, 2)
            effect_word = "increase"
        else:
            proj_bal = round(cur_bal - converted, 2)
            effect_word = "decrease"

        sym = "$" if tx_curr == "USD" else ("E£" if tx_curr == "EGP" else tx_curr)
        acct_sym = "$" if acct_curr == "USD" else ("E£" if acct_curr == "EGP" else acct_curr)

        plain = f"This will {effect_word} the Book Balance of {account.account_name} by {sym}{payload.amount:,.2f} {tx_curr}."
        if tx_curr != acct_curr:
            plain += f" (Converted @ {fx_rate}: {acct_sym}{converted:,.2f} {acct_curr})."
        plain += f" Projected Book Balance: {acct_sym}{proj_bal:,.2f} {acct_curr}."

        # Journal preview lines
        journal = []
        acct_label = f"Cash / Bank: {account.account_name}"
        if direction == "in":
            journal.append({"type": "debit", "account": acct_label, "amount": converted, "currency": acct_curr})
            offset_label = "Revenue / Accounts Receivable" if payload.entry_type == "money_in" else "Retained Earnings (Adjustment)"
            journal.append({"type": "credit", "account": offset_label, "amount": converted, "currency": acct_curr})
        else:
            if payload.entry_type == "bank_fee":
                offset_label = "Bank & Financing Fees Expense"
            elif payload.entry_type == "adjustment":
                offset_label = "Retained Earnings / Variance Adjustment"
            else:
                offset_label = "Expense / Accounts Payable"
            journal.append({"type": "debit", "account": offset_label, "amount": converted, "currency": acct_curr})
            journal.append({"type": "credit", "account": acct_label, "amount": converted, "currency": acct_curr})

        return TransactionPreviewResponse(
            account_id=account.id,
            account_name=account.account_name,
            account_currency=acct_curr,
            entry_type=payload.entry_type,
            direction=direction,
            transaction_amount=payload.amount,
            transaction_currency=tx_curr,
            fx_rate=fx_rate,
            converted_amount=converted,
            current_book_balance=cur_bal,
            projected_book_balance=proj_bal,
            plain_description=plain,
            journal_preview=journal,
        )

    def update_manual_transaction(
        self,
        tx_id: int,
        payload: "LedgerTransactionUpdate",
    ) -> LedgerTransactionResponse:
        tx = self.repo.get_by_id(tx_id)
        if not tx:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transaction with ID {tx_id} not found",
            )

        if tx.source != "manual":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only manual transactions can be edited directly. Transaction source is '{tx.source}'.",
            )

        data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)

        if "direction" in data and data["direction"] not in ("in", "out"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction direction must be 'in' or 'out'",
            )

        if "amount" in data and (data["amount"] is None or data["amount"] <= 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transaction amount must be strictly greater than 0",
            )

        if data.get("category_id") and self.categories_repo:
            cat = self.categories_repo.get_by_id(data["category_id"])
            if not cat:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Category with ID {data['category_id']} not found",
                )

        if data.get("payment_type_id") and self.payment_types_repo:
            pt = self.payment_types_repo.get_by_id(data["payment_type_id"])
            if not pt:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment type with ID {data['payment_type_id']} not found",
                )

        try:
            updated = self.repo.update_transaction(tx_id, data)
            return self.to_response(updated)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

    def delete_manual_transaction(self, tx_id: int, reason: Optional[str] = None) -> dict:
        tx = self.repo.get_by_id(tx_id)
        if not tx:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Transaction with ID {tx_id} not found",
            )

        if tx.source != "manual":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only manual transactions can be deleted. Transaction source is '{tx.source}'.",
            )

        if getattr(tx, "linked_invoice_id", None) or getattr(tx, "linked_bill_id", None) or getattr(tx, "linked_transfer_id", None) or getattr(tx, "linked_cheque_id", None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete transaction {tx_id}: it is linked to a posted financial document.",
            )

        try:
            self.repo.delete_transaction(tx_id)
            return {"message": "Transaction deleted successfully", "id": tx_id, "reason": reason or ""}
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

    def get_petty_summary(
        self,
        account_id: int,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> "PettySummaryResponse":
        if self.accounts_repo:
            account = self.accounts_repo.get_by_id(account_id)
            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Bank account with ID {account_id} not found",
                )

        from finance.schemas import PettySummaryResponse, PettySummaryItem
        try:
            summary = self.repo.get_petty_summary(account_id, date_from, date_to)
            tx_responses = [self.to_response(t) for t in summary["transactions"]]
            items = [PettySummaryItem(**item) for item in summary["by_category"]]
            return PettySummaryResponse(
                account_id=summary["account_id"],
                account_name=summary["account_name"],
                currency=summary["currency"],
                date_from=summary["date_from"],
                date_to=summary["date_to"],
                total_in=summary["total_in"],
                total_out=summary["total_out"],
                net_amount=summary["net_amount"],
                by_category=items,
                transactions=tx_responses,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
