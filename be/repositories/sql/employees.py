"""
be/repositories/sql/employees.py
SQLAlchemy-backed implementation of EmployeeRepository.
"""
from typing import Optional, List, Dict, Any, Union
from datetime import datetime

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import EmployeeDB, EmployeeNoteDB, EmployeeDocumentDB
from finance.current_pay import current_pay, current_pay_map, zero_pay
from services.employee_derived import next_raise_map, vacation_days_used_map


PERSONAL_FIELDS = ("legal_name", "phone", "address_line_1", "address_line_2", "id_type", "id_number")


def _personal_to_dict(emp: EmployeeDB) -> dict:
    return {
        "legal_name": emp.legal_name or "",
        "phone": emp.phone or "",
        "address_line_1": emp.address_line_1 or "",
        "address_line_2": emp.address_line_2 or "",
        "id_type": emp.id_type or "",
        "id_number": emp.id_number or "",
    }


def _employee_to_dict(
    emp: EmployeeDB,
    include_personal: bool = False,
    pay: Optional[Dict[str, float]] = None,
    vac_used: int = 0,
    next_raise: str = "",
) -> dict:
    """Profile dict. Personal details (D-036) are only included when explicitly requested.

    The salary fields are derived from the compensation plan (D-046); `pay` is that employee's current pay.
    `vac_used` and `next_raise` are derived too (services/employee_derived.py).
    """
    if not emp:
        return {}
    pay = pay or zero_pay()
    data = {
        "id": emp.id,
        "name": emp.name or "",
        "email": emp.email or "",
        "dept": emp.dept or "",
        "job_role": emp.job_role or "",
        "salary": pay["total"],
        "internal_salary_usd": pay["internal"],
        "external_salary_usd": pay["external"],
        "join_date": emp.join_date or "",
        "status": emp.status or "Active",
        "vac_total": emp.vac_total if emp.vac_total is not None else 21,
        "vac_used": vac_used,
        "next_raise": next_raise,
        "employment_state": emp.employment_state or "Full-Time",
        "invoice_id": emp.invoice_id or "",
    }
    if include_personal:
        data.update(_personal_to_dict(emp))
    return data


def _note_to_dict(n: EmployeeNoteDB) -> dict:
    return {
        "id": n.id,
        "employee_id": n.employee_id,
        "date": n.date or "",
        "category": n.category or "General",
        "note": n.note or "",
        "created_by": n.created_by or "",
    }


def _doc_to_dict(d: EmployeeDocumentDB) -> dict:
    return {
        "id": str(d.id),
        "employee_id": str(d.employee_id),
        "name": d.name or "",
        "file_type": d.file_type or "",
        "drive_file_id": d.drive_file_id or "",
        "uploaded_by": d.uploaded_by or "",
        "uploaded_at": d.uploaded_at or "",
    }


class SqlEmployeeRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def get_by_id(self, employee_id: Union[int, str], include_personal: bool = False) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return None
            return _employee_to_dict(
                emp, include_personal, current_pay(db, emp.id),
                vacation_days_used_map(db, [emp.id]).get(emp.id, 0), next_raise_map(db, [emp.id]).get(emp.id, ""),
            )

    def get_personal(self, employee_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        """Personal details with the full ID number; the router masks it. None if the employee is missing."""
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            return _personal_to_dict(emp) if emp else None

    def update_personal(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return False
            for k, v in updates.items():
                if k in PERSONAL_FIELDS:
                    setattr(emp, k, v)
            db.commit()
            return True

    def list_all(self, scoped_employee_id: Optional[Union[int, str]] = None, include_personal: bool = False) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(EmployeeDB)
            if scoped_employee_id is not None:
                query = query.filter(EmployeeDB.id == int(scoped_employee_id))
            employees = query.order_by(EmployeeDB.id).all()
            ids = [e.id for e in employees]
            pay_map = current_pay_map(db, ids)
            used_map = vacation_days_used_map(db, ids)
            raise_map = next_raise_map(db, ids)
            return [
                _employee_to_dict(e, include_personal, pay_map.get(e.id), used_map.get(e.id, 0), raise_map.get(e.id, ""))
                for e in employees
            ]

    def create(self, data: Dict[str, Any]) -> int:
        # Data layer only. Pay is never written here: the Pay plan owns it (D-036, D-046), so any salary keys in
        # `data` are ignored and no plan rows are created.
        with self._get_session() as db:
            emp_kwargs = {
                "name": data.get("name"),
                "email": data.get("email"),
                "dept": data.get("dept", ""),
                "job_role": data.get("job_role", ""),
                "join_date": data.get("join_date", ""),
                "status": data.get("status", "Active"),
                "vac_total": data.get("vac_total", 21),
                "employment_state": data.get("employment_state", "Full-Time"),
                "invoice_id": data.get("invoice_id") or "",
                "address_line_1": data.get("address_line_1") or "",
                "address_line_2": data.get("address_line_2") or "",
                "legal_name": data.get("legal_name") or None,
                "phone": data.get("phone") or None,
                "id_type": data.get("id_type") or None,
                "id_number": data.get("id_number") or None,
            }
            if data.get("id") is not None and str(data.get("id")).isdigit():
                emp_kwargs["id"] = int(data["id"])

            emp = EmployeeDB(**emp_kwargs)
            db.add(emp)
            db.flush()

            from core.access_service import AccessService
            access_service = AccessService(db)
            access_service.on_employee_create(
                employee_id=emp.id,
                email=data.get("email"),
                name=data.get("name", ""),
            )

            db.commit()
            return emp.id

    def update(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return False

            updates_dict = dict(updates)
            # Pay is changed only through the Pay plan (D-036); salary keys are never applied here.
            for pay_key in ("internal_salary_usd", "external_salary_usd", "salary"):
                updates_dict.pop(pay_key, None)

            for k, v in updates_dict.items():
                if hasattr(emp, k):
                    setattr(emp, k, v)
            db.flush()

            if "email" in updates_dict:
                from core.access_service import AccessService
                AccessService(db).sync_user_email_for_employee(emp.id, updates_dict["email"])

            db.commit()
            return True

    def delete(self, employee_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return False
            from core.access_service import AccessService
            AccessService(db).remove_user_for_employee(emp.id)
            db.delete(emp)
            db.commit()
            return True

    def get_notes(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            notes = (
                db.query(EmployeeNoteDB)
                .filter(EmployeeNoteDB.employee_id == int(employee_id))
                .order_by(EmployeeNoteDB.date.desc(), EmployeeNoteDB.id.desc())
                .all()
            )
            return [_note_to_dict(n) for n in notes]

    def create_note(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        with self._get_session() as db:
            note = EmployeeNoteDB(
                employee_id=int(employee_id),
                date=data.get("date"),
                category=data.get("category", "General"),
                note=data.get("note", ""),
                created_by=data.get("created_by", ""),
            )
            db.add(note)
            db.commit()
            return note.id

    def delete_note(self, note_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            note = db.query(EmployeeNoteDB).filter(EmployeeNoteDB.id == int(note_id)).first()
            if not note:
                return False
            db.delete(note)
            db.commit()
            return True

    def get_documents(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            docs = (
                db.query(EmployeeDocumentDB)
                .filter(EmployeeDocumentDB.employee_id == int(employee_id))
                .order_by(EmployeeDocumentDB.uploaded_at.desc(), EmployeeDocumentDB.id.desc())
                .all()
            )
            return [_doc_to_dict(d) for d in docs]

    def get_document_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            doc = db.query(EmployeeDocumentDB).filter(EmployeeDocumentDB.id == int(doc_id)).first()
            return _doc_to_dict(doc) if doc else None

    def create_document(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        with self._get_session() as db:
            doc = EmployeeDocumentDB(
                employee_id=int(employee_id),
                name=str(data.get("name")),
                file_type=data.get("file_type"),
                drive_file_id=data.get("drive_file_id"),
                uploaded_by=data.get("uploaded_by", ""),
                uploaded_at=data.get("uploaded_at", ""),
            )
            db.add(doc)
            db.commit()
            return doc.id

    def delete_document(self, doc_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            doc = db.query(EmployeeDocumentDB).filter(EmployeeDocumentDB.id == int(doc_id)).first()
            if not doc:
                return False
            db.delete(doc)
            db.commit()
            return True
