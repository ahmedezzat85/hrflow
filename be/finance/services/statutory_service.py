"""
be/finance/services/statutory_service.py
Service layer for Statutory Obligations (FUX-410).
Enforces controlled types, estimate-then-confirm workflows, FUX-408 status integrity guards,
and coordinates with SettlementService for atomic remittance and ledger entries.
"""
from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from finance.models import StatutoryObligationDB
from finance.repositories.statutory_repository import StatutoryObligationsRepository
from finance.services.settlement_service import SettlementService, StatutoryPaymentError

VALID_OBLIGATION_TYPES = {
    "sales_tax",
    "withholding_tax",
    "income_tax",
    "social_insurance_employee",
    "social_insurance_employer",
    "health_insurance",
    "other_statutory",
}


class StatutoryObligationsService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = StatutoryObligationsRepository(db)
        self.settlement_svc = SettlementService(db)

    def _to_response(self, obl: StatutoryObligationDB) -> Dict[str, Any]:
        remaining = max(0.0, round(obl.amount_accrued - (obl.amount_remitted or 0.0), 2))
        return {
            "id": obl.id,
            "obligation_type": obl.obligation_type,
            "period": obl.period,
            "amount_estimated": obl.amount_estimated,
            "amount_accrued": obl.amount_accrued,
            "amount_remitted": obl.amount_remitted or 0.0,
            "remaining_balance": remaining,
            "variance_amount": obl.variance_amount or 0.0,
            "variance_note": obl.variance_note,
            "currency": obl.currency,
            "status": obl.status,
            "due_date": obl.due_date,
            "source_type": obl.source_type,
            "source_id": obl.source_id,
            "notes": obl.notes or "",
            "created_at": obl.created_at,
            "updated_at": obl.updated_at,
        }

    def list_obligations(
        self,
        obligation_type: Optional[str] = None,
        status_filter: Optional[str] = None,
        period: Optional[str] = None,
        source_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        obligations = self.repo.list_obligations(
            obligation_type=obligation_type,
            status=status_filter,
            period=period,
            source_type=source_type,
            limit=limit,
            offset=offset,
        )
        return [self._to_response(o) for o in obligations]

    def get_obligation(self, obligation_id: int) -> Dict[str, Any]:
        obl = self.repo.get_by_id(obligation_id)
        if not obl:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Statutory obligation #{obligation_id} not found",
            )
        return self._to_response(obl)

    def create_obligation(self, data: dict) -> Dict[str, Any]:
        """
        Record a statutory obligation manually or from direct calculation.
        Creates obligation directly in 'accrued' status (bypassing estimate).
        """
        obl_type = data.get("obligation_type")
        if obl_type not in VALID_OBLIGATION_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid obligation_type '{obl_type}'. Must be one of: {sorted(list(VALID_OBLIGATION_TYPES))}",
            )

        amount_accrued = float(data.get("amount_accrued", 0.0))
        if amount_accrued <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Accrued amount must be greater than 0",
            )

        create_payload = {
            "obligation_type": obl_type,
            "period": data.get("period"),
            "amount_estimated": None,
            "amount_accrued": amount_accrued,
            "amount_remitted": 0.0,
            "variance_amount": 0.0,
            "variance_note": None,
            "currency": data.get("currency") or "EGP",
            "status": "accrued",
            "due_date": data.get("due_date"),
            "source_type": data.get("source_type", "manual"),
            "source_id": data.get("source_id"),
            "notes": data.get("notes", ""),
        }
        obl = self.repo.create_obligation(create_payload)
        return self._to_response(obl)

    def generate_vat_estimate(self, period: str) -> Dict[str, Any]:
        """
        D-023: user-triggered "Generate VAT estimate" for one month. Creates or updates the single
        sales_tax obligation (estimated, EGP) for the period from the VAT on EGP invoices issued
        that month (sent, partially paid or paid; drafts and void excluded). There is no scheduler.
        An obligation the user has already confirmed against the portal is never overwritten.
        """
        from finance.models import SalesInvoiceDB

        invoices = (
            self.db.query(SalesInvoiceDB)
            .filter(
                SalesInvoiceDB.currency == "EGP",
                SalesInvoiceDB.status.in_(["sent", "partially_paid", "paid"]),
                SalesInvoiceDB.issue_date >= f"{period}-01",
                SalesInvoiceDB.issue_date <= f"{period}-31",
            )
            .all()
        )
        estimate = round(sum(float(i.tax_amount or 0.0) for i in invoices), 2)
        note = f"VAT estimate from {len(invoices)} EGP invoice(s) issued in {period}"

        existing = (
            self.db.query(StatutoryObligationDB)
            .filter(
                StatutoryObligationDB.obligation_type == "sales_tax",
                StatutoryObligationDB.period == period,
                StatutoryObligationDB.source_type == "invoice_tax_line",
            )
            .first()
        )
        if existing:
            if existing.status != "estimated":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "obligation_confirmed",
                        "message": f"The {period} sales tax obligation is already {existing.status}; its estimate can no longer be regenerated.",
                    },
                )
            existing.amount_estimated = estimate
            existing.amount_accrued = estimate
            existing.notes = note
            self.db.commit()
            self.db.refresh(existing)
            return self._to_response(existing)

        obl = self.repo.create_obligation({
            "obligation_type": "sales_tax",
            "period": period,
            "amount_estimated": estimate,
            "amount_accrued": estimate,
            "status": "estimated",
            "currency": "EGP",
            "source_type": "invoice_tax_line",
            "notes": note,
        })
        return self._to_response(obl)

    def confirm_or_adjust(self, obligation_id: int, data: dict) -> Dict[str, Any]:
        """
        Explicit confirm/adjust action moving an obligation from 'estimated' to 'accrued'.
        """
        amount_accrued = data.get("amount_accrued")
        if amount_accrued is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="amount_accrued is required for confirmation/adjustment",
            )

        try:
            obl = self.repo.confirm_or_adjust(
                obligation_id=obligation_id,
                amount_accrued=float(amount_accrued),
                variance_note=data.get("variance_note"),
            )
            return self._to_response(obl)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    def settle_obligation(self, obligation_id: int, data: dict, user_email: Optional[str] = None) -> Dict[str, Any]:
        """
        Remit a statutory obligation via SettlementService.
        """
        try:
            obl, payment, ledger_tx = self.settlement_svc.settle_statutory_obligation(
                obligation_id=obligation_id,
                amount=float(data["amount"]),
                payment_date=data["payment_date"],
                bank_account_id=int(data["bank_account_id"]),
                payment_type_id=data.get("payment_type_id"),
                reference=data.get("reference", ""),
                method=data.get("method"),
                created_by=user_email,
            )
            resp = self._to_response(obl)
            resp["payment_id"] = payment.id
            resp["transaction_id"] = ledger_tx.id
            return resp
        except StatutoryPaymentError as e:
            self.db.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.detail())
        except ValueError as e:
            self.db.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    def update_obligation(self, obligation_id: int, data: dict) -> Dict[str, Any]:
        """
        Update metadata fields with status integrity guard (FUX-408).
        Directly setting status to accrued, partially_remitted, or remitted is strictly forbidden.
        """
        if "status" in data and data["status"] is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Direct status manipulation is forbidden. Status transitions occur only via confirm/adjust or settlement actions.",
            )

        if "amount_accrued" in data and data["amount_accrued"] is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Accrued amount cannot be modified directly via update. Use the confirm/adjust endpoint.",
            )

        obl = self.repo.update_metadata(
            obligation_id=obligation_id,
            due_date=data.get("due_date"),
            notes=data.get("notes"),
        )
        return self._to_response(obl)
