"""
be/repositories/sql/salary_payment_docs.py
SQLAlchemy-backed implementation of SalaryPaymentDocRepository.
"""
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import SalaryPaymentDocDB


def _doc_to_dict(i: SalaryPaymentDocDB) -> dict:
    return {
        "id": i.id,
        "employee_id": i.employee_id,
        "employee_name": i.employee_name or "",
        "invoice_number": i.invoice_number or "",
        "payment_year": i.payment_year,
        "payment_month": i.payment_month,
        "invoice_date": i.invoice_date or "",
        "amount_usd": i.amount_usd if i.amount_usd is not None else 0.0,
        "currency": i.currency or "USD",
        "document_name": i.document_name or "",
        "drive_file_id": i.drive_file_id or "",
        "drive_web_url": i.drive_web_url or "",
        "template_version": i.template_version or "v1",
        "status": i.status or "generated",
        "failure_reason": i.failure_reason or "",
        "generated_by": i.generated_by or "",
        "created_at": i.created_at or "",
    }


class SqlSalaryPaymentDocRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def list_all(
        self,
        employee_id: Optional[Union[int, str]] = None,
        payment_year: Optional[int] = None,
        payment_month: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(SalaryPaymentDocDB)
            if employee_id is not None:
                query = query.filter(SalaryPaymentDocDB.employee_id == int(employee_id))
            if payment_year is not None:
                query = query.filter(SalaryPaymentDocDB.payment_year == int(payment_year))
            if payment_month is not None:
                query = query.filter(SalaryPaymentDocDB.payment_month == int(payment_month))
            if status is not None:
                query = query.filter(SalaryPaymentDocDB.status == status)
            docs = query.order_by(SalaryPaymentDocDB.id.desc()).all()
            return [_doc_to_dict(i) for i in docs]

    def get_by_id(self, invoice_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            doc = db.query(SalaryPaymentDocDB).filter(SalaryPaymentDocDB.id == int(invoice_id)).first()
            return _doc_to_dict(doc) if doc else None

    def find_existing(
        self,
        employee_id: Union[int, str],
        payment_year: int,
        payment_month: int,
    ) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            doc = (
                db.query(SalaryPaymentDocDB)
                .filter(
                    SalaryPaymentDocDB.employee_id == int(employee_id),
                    SalaryPaymentDocDB.payment_year == int(payment_year),
                    SalaryPaymentDocDB.payment_month == int(payment_month),
                    SalaryPaymentDocDB.status == "generated",
                )
                .first()
            )
            return _doc_to_dict(doc) if doc else None

    def create(self, data: Dict[str, Any]) -> int:
        with self._get_session() as db:
            doc = SalaryPaymentDocDB(
                employee_id=int(data.get("employee_id")),
                employee_name=data.get("employee_name", ""),
                invoice_number=str(data.get("invoice_number", "")),
                payment_year=int(data.get("payment_year")),
                payment_month=int(data.get("payment_month")),
                invoice_date=data.get("invoice_date", ""),
                amount_usd=float(data.get("amount_usd", 0.0)),
                currency=data.get("currency", "USD"),
                document_name=data.get("document_name", ""),
                drive_file_id=data.get("drive_file_id", ""),
                drive_web_url=data.get("drive_web_url", ""),
                template_version=data.get("template_version", "v1"),
                status=data.get("status", "generated"),
                failure_reason=data.get("failure_reason", ""),
                generated_by=data.get("generated_by", ""),
                created_at=data.get("created_at", ""),
            )
            db.add(doc)
            db.commit()
            return doc.id

    def update(self, invoice_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        with self._get_session() as db:
            doc = db.query(SalaryPaymentDocDB).filter(SalaryPaymentDocDB.id == int(invoice_id)).first()
            if not doc:
                return False
            for field, val in updates.items():
                if field == "id":
                    continue
                if hasattr(doc, field):
                    if field in ("employee_id", "payment_year", "payment_month") and val is not None:
                        setattr(doc, field, int(val))
                    elif field == "amount_usd" and val is not None:
                        setattr(doc, field, float(val))
                    else:
                        setattr(doc, field, val)
            db.commit()
            return True


# Backward compatibility aliases
SqlInvoiceRepository = SqlSalaryPaymentDocRepository
_invoice_to_dict = _doc_to_dict
