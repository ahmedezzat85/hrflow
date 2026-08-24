"""
be/repositories/sql/insurance.py
SQLAlchemy-backed implementation of InsuranceRepository.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import InsuranceCategoryDB, InsuranceClaimDB, RequestDB, EmployeeDB
from repositories.sheets.insurance import compute_consumption


def _category_to_dict(c: InsuranceCategoryDB) -> dict:
    return {
        "id": c.id,
        "name": c.name or "",
        "annual_limit": c.annual_limit if c.annual_limit is not None else 0.0,
    }


def _claim_to_dict(c: InsuranceClaimDB) -> dict:
    return {
        "id": c.id,
        "employee_id": c.employee_id,
        "employee_name": c.employee_name or "",
        "category": c.category or "",
        "provider": c.provider or "",
        "amount": c.amount if c.amount is not None else 0.0,
        "date": c.date or "",
        "status": c.status or "Pending",
        "document_url": c.document_url or "",
        "submitted_by": c.submitted_by or "",
    }


class SqlInsuranceRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def list_categories(self) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            cats = db.query(InsuranceCategoryDB).order_by(InsuranceCategoryDB.id).all()
            return [_category_to_dict(c) for c in cats]

    def get_category_by_id(self, cat_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            cat = db.query(InsuranceCategoryDB).filter(InsuranceCategoryDB.id == int(cat_id)).first()
            return _category_to_dict(cat) if cat else None

    def get_category_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        name_clean = name.strip().lower()
        with self._get_session() as db:
            cats = db.query(InsuranceCategoryDB).all()
            for c in cats:
                if (c.name or "").strip().lower() == name_clean:
                    return _category_to_dict(c)
            return None

    def create_category(self, name: str, annual_limit: float) -> int:
        if self.get_category_by_name(name):
            raise ValueError("A category with this name already exists")
        with self._get_session() as db:
            cat = InsuranceCategoryDB(
                name=name.strip(),
                annual_limit=float(annual_limit),
            )
            db.add(cat)
            db.commit()
            return cat.id

    def update_category(self, cat_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        with self._get_session() as db:
            cat = db.query(InsuranceCategoryDB).filter(InsuranceCategoryDB.id == int(cat_id)).first()
            if not cat:
                return False
            for k, v in updates.items():
                if hasattr(cat, k):
                    setattr(cat, k, v)
            db.commit()
            return True

    def delete_category(self, cat_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            cat = db.query(InsuranceCategoryDB).filter(InsuranceCategoryDB.id == int(cat_id)).first()
            if not cat:
                return False
            db.delete(cat)
            db.commit()
            return True

    def list_claims(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(InsuranceClaimDB)
            if scoped_employee_id is not None:
                query = query.filter(InsuranceClaimDB.employee_id == int(scoped_employee_id))
            claims = query.order_by(InsuranceClaimDB.id).all()
            return [_claim_to_dict(c) for c in claims]

    def get_claim_by_id(self, claim_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            claim = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == int(claim_id)).first()
            return _claim_to_dict(claim) if claim else None

    def create_claim(
        self,
        claim_data: Dict[str, Any],
        request_data: Optional[Dict[str, Any]] = None,
    ) -> int:
        with self._get_session() as db:
            claim = InsuranceClaimDB(
                employee_id=int(claim_data.get("employee_id")),
                employee_name=claim_data.get("employee_name", ""),
                category=claim_data.get("category"),
                provider=claim_data.get("provider", ""),
                amount=float(claim_data.get("amount", 0.0)),
                date=claim_data.get("date"),
                status=claim_data.get("status", "Pending"),
                document_url=claim_data.get("document_url") or "",
                submitted_by=claim_data.get("submitted_by", ""),
            )
            db.add(claim)

            if request_data:
                req = RequestDB(
                    employee_id=int(request_data.get("employee_id")),
                    employee_name=request_data.get("employee_name", ""),
                    type="Medical Insurance",
                    details=request_data.get("details", ""),
                    date=request_data.get("date"),
                    status=request_data.get("status", "Pending"),
                    reviewed_by=request_data.get("reviewed_by", ""),
                    reviewed_at=request_data.get("reviewed_at", ""),
                    submitted_by=request_data.get("submitted_by", ""),
                )
                db.add(req)

            db.commit()
            return claim.id

    def action_claim(self, claim_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        with self._get_session() as db:
            claim = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == int(claim_id)).first()
            if not claim:
                return False

            claim.status = status

            # Synchronize linked Request record
            emp_reqs = (
                db.query(RequestDB)
                .filter(RequestDB.employee_id == claim.employee_id, RequestDB.type == "Medical Insurance")
                .all()
            )
            matched_req = next(
                (r for r in emp_reqs if r.status != status and str(r.date) == str(claim.date)),
                None
            )
            if not matched_req:
                pending_reqs = [r for r in emp_reqs if r.status == "Pending"]
                if len(pending_reqs) == 1:
                    matched_req = pending_reqs[0]

            if matched_req:
                matched_req.status = status
                matched_req.reviewed_by = reviewer_email
                matched_req.reviewed_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M")

            db.commit()
            return True

    def get_consumption(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            emp_query = db.query(EmployeeDB)
            if scoped_employee_id is not None:
                emp_query = emp_query.filter(EmployeeDB.id == int(scoped_employee_id))
            employees = [{"id": e.id, "name": e.name} for e in emp_query.all()]

            categories = [_category_to_dict(c) for c in db.query(InsuranceCategoryDB).all()]
            claims = [_claim_to_dict(c) for c in db.query(InsuranceClaimDB).all()]

            return compute_consumption(employees, categories, claims)
