"""
be/finance/repositories/payment_types_repository.py
SQLAlchemy-backed repository for Payment Types (Phase 0).
"""
from typing import List, Optional
from sqlalchemy.orm import Session

from finance.models import PaymentTypeDB


class PaymentTypesRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_all(
        self,
        is_active: Optional[bool] = None,
    ) -> List[PaymentTypeDB]:
        query = self.db.query(PaymentTypeDB)
        if is_active is not None:
            query = query.filter(PaymentTypeDB.is_active == is_active)
        return query.order_by(PaymentTypeDB.id.asc()).all()

    def get_by_id(self, pt_id: int) -> Optional[PaymentTypeDB]:
        return self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == pt_id).first()

    def get_by_code(self, code: str) -> Optional[PaymentTypeDB]:
        return self.db.query(PaymentTypeDB).filter(
            PaymentTypeDB.code == code.strip().upper()
        ).first()

    def create(self, data: dict) -> PaymentTypeDB:
        pt = PaymentTypeDB(
            name=data["name"].strip(),
            code=data["code"].strip().upper(),
            requires_cheque_number=bool(data.get("requires_cheque_number", False)),
            requires_bank_fee_flag=bool(data.get("requires_bank_fee_flag", False)),
            is_active=bool(data.get("is_active", True)),
        )
        self.db.add(pt)
        self.db.commit()
        self.db.refresh(pt)
        return pt

    def update(self, pt_id: int, data: dict) -> Optional[PaymentTypeDB]:
        pt = self.get_by_id(pt_id)
        if not pt:
            return None

        if "name" in data and data["name"] is not None:
            pt.name = data["name"].strip()
        if "requires_cheque_number" in data and data["requires_cheque_number"] is not None:
            pt.requires_cheque_number = bool(data["requires_cheque_number"])
        if "requires_bank_fee_flag" in data and data["requires_bank_fee_flag"] is not None:
            pt.requires_bank_fee_flag = bool(data["requires_bank_fee_flag"])
        if "is_active" in data and data["is_active"] is not None:
            pt.is_active = bool(data["is_active"])

        self.db.commit()
        self.db.refresh(pt)
        return pt

    def deactivate(self, pt_id: int) -> Optional[PaymentTypeDB]:
        return self.update(pt_id, {"is_active": False})
