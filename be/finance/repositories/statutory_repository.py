"""
be/finance/repositories/statutory_repository.py
Repository for statutory obligations persistence (FUX-410).
Handles queries, creations, metadata updates, and explicit confirm/adjust transitions.
"""
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from finance.models import StatutoryObligationDB


class StatutoryObligationsRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, obligation_id: int) -> Optional[StatutoryObligationDB]:
        """Fetch single obligation by ID."""
        return self.db.query(StatutoryObligationDB).filter(StatutoryObligationDB.id == obligation_id).first()

    def list_obligations(
        self,
        obligation_type: Optional[str] = None,
        status: Optional[str] = None,
        period: Optional[str] = None,
        source_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[StatutoryObligationDB]:
        """List obligations with filtering and pagination."""
        query = self.db.query(StatutoryObligationDB)

        if obligation_type and obligation_type != "all":
            query = query.filter(StatutoryObligationDB.obligation_type == obligation_type)
        if status and status != "all":
            query = query.filter(StatutoryObligationDB.status == status)
        if period:
            query = query.filter(StatutoryObligationDB.period == period)
        if source_type:
            query = query.filter(StatutoryObligationDB.source_type == source_type)

        return query.order_by(desc(StatutoryObligationDB.id)).offset(offset).limit(limit).all()

    def create_obligation(self, data: dict) -> StatutoryObligationDB:
        """
        Create a new statutory obligation.
        For manual or tax line obligations, default status is 'accrued'.
        """
        amount_accrued = float(data["amount_accrued"])
        amount_estimated = float(data["amount_estimated"]) if data.get("amount_estimated") is not None else None
        status = data.get("status")
        if not status:
            status = "estimated" if amount_estimated is not None and data.get("source_type") == "payroll_run" else "accrued"

        variance_amount = 0.0
        if amount_estimated is not None and status == "accrued":
            variance_amount = round(amount_accrued - amount_estimated, 2)

        obligation = StatutoryObligationDB(
            obligation_type=data["obligation_type"],
            period=data["period"],
            amount_estimated=amount_estimated,
            amount_accrued=amount_accrued,
            amount_remitted=float(data.get("amount_remitted", 0.0)),
            variance_amount=variance_amount,
            variance_note=data.get("variance_note"),
            currency=data.get("currency", "USD"),
            status=status,
            due_date=data.get("due_date"),
            source_type=data.get("source_type", "manual"),
            source_id=data.get("source_id"),
            notes=data.get("notes", ""),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.db.add(obligation)
        self.db.commit()
        self.db.refresh(obligation)
        return obligation

    def confirm_or_adjust(
        self, obligation_id: int, amount_accrued: float, variance_note: Optional[str] = None
    ) -> StatutoryObligationDB:
        """
        Explicit confirm/adjust action for an estimated obligation.
        Transitions status from 'estimated' to 'accrued', records variance vs original estimate,
        and saves explanation note. If unchanged, variance is explicitly 0.0.
        """
        obligation = self.get_by_id(obligation_id)
        if not obligation:
            raise ValueError(f"Statutory obligation #{obligation_id} not found")

        if obligation.status != "estimated":
            raise ValueError(
                f"Only obligations in 'estimated' status can be confirmed or adjusted. Current status: '{obligation.status}'"
            )

        new_accrued = float(amount_accrued)
        if new_accrued < 0:
            raise ValueError("Accrued amount cannot be negative")

        est = obligation.amount_estimated if obligation.amount_estimated is not None else obligation.amount_accrued
        variance = round(new_accrued - est, 2)

        obligation.amount_accrued = new_accrued
        obligation.variance_amount = variance
        obligation.variance_note = variance_note if variance_note is not None else obligation.variance_note
        obligation.status = "accrued"
        obligation.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(obligation)
        return obligation

    def update_metadata(
        self, obligation_id: int, due_date: Optional[str] = None, notes: Optional[str] = None
    ) -> StatutoryObligationDB:
        """Update harmless metadata fields (due_date, notes) without modifying status or financial figures."""
        obligation = self.get_by_id(obligation_id)
        if not obligation:
            raise ValueError(f"Statutory obligation #{obligation_id} not found")

        if due_date is not None:
            obligation.due_date = due_date
        if notes is not None:
            obligation.notes = notes
        obligation.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(obligation)
        return obligation
