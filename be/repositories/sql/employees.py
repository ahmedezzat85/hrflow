"""
be/repositories/sql/employees.py
SQLAlchemy-backed implementation of EmployeeRepository.
"""
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import EmployeeDB, UserDB, EmployeeNoteDB, EmployeeDocumentDB


def _employee_to_dict(emp: EmployeeDB) -> dict:
    if not emp:
        return {}
    return {
        "id": emp.id,
        "name": emp.name or "",
        "email": emp.email or "",
        "role": emp.role or "employee",
        "dept": emp.dept or "",
        "job_role": emp.job_role or "",
        "salary": emp.salary if emp.salary is not None else 0.0,
        "internal_salary_usd": emp.internal_salary_usd if emp.internal_salary_usd is not None else 0.0,
        "external_salary_usd": emp.external_salary_usd if emp.external_salary_usd is not None else 0.0,
        "join_date": emp.join_date or "",
        "status": emp.status or "Active",
        "vac_total": emp.vac_total if emp.vac_total is not None else 21,
        "vac_used": emp.vac_used if emp.vac_used is not None else 0,
        "next_raise": emp.next_raise or "",
        "employment_state": emp.employment_state or "Full-Time",
        "invoice_id": emp.invoice_id or "",
        "address_line_1": emp.address_line_1 or "",
        "address_line_2": emp.address_line_2 or "",
    }


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
        "view_url": d.view_url or "",
        "download_url": d.download_url or "",
        "uploaded_by": d.uploaded_by or "",
        "uploaded_at": d.uploaded_at or "",
    }


class SqlEmployeeRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def get_by_id(self, employee_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            return _employee_to_dict(emp) if emp else None

    def list_all(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(EmployeeDB)
            if scoped_employee_id is not None:
                query = query.filter(EmployeeDB.id == int(scoped_employee_id))
            employees = query.order_by(EmployeeDB.id).all()
            return [_employee_to_dict(e) for e in employees]

    def create(self, data: Dict[str, Any]) -> int:
        internal_salary = float(data.get("internal_salary_usd") or 0)
        external_salary = float(data.get("external_salary_usd") or 0)
        legacy_total_salary = internal_salary + external_salary

        with self._get_session() as db:
            emp_kwargs = {
                "name": data.get("name"),
                "email": data.get("email"),
                "role": data.get("role", "employee"),
                "dept": data.get("dept", ""),
                "job_role": data.get("job_role", ""),
                "salary": legacy_total_salary,
                "internal_salary_usd": internal_salary,
                "external_salary_usd": external_salary,
                "join_date": data.get("join_date", ""),
                "status": data.get("status", "Active"),
                "vac_total": data.get("vac_total", 21),
                "vac_used": int(data.get("vac_used", 0)),
                "next_raise": data.get("next_raise", ""),
                "employment_state": data.get("employment_state", "Full-Time"),
                "invoice_id": data.get("invoice_id") or "",
                "address_line_1": data.get("address_line_1") or "",
                "address_line_2": data.get("address_line_2") or "",
            }
            if data.get("id") is not None and str(data.get("id")).isdigit():
                emp_kwargs["id"] = int(data["id"])

            emp = EmployeeDB(**emp_kwargs)
            db.add(emp)
            db.flush()

            user = UserDB(
                email=data.get("email"),
                role=data.get("role", "employee"),
                employee_id=emp.id,
            )
            db.add(user)
            db.commit()
            return emp.id

    def update(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return False

            updates_dict = dict(updates)
            if "internal_salary_usd" in updates_dict or "external_salary_usd" in updates_dict:
                current_internal = emp.internal_salary_usd or 0.0
                current_external = emp.external_salary_usd or 0.0
                new_internal = float(updates_dict.get("internal_salary_usd", current_internal))
                new_external = float(updates_dict.get("external_salary_usd", current_external))
                updates_dict["salary"] = new_internal + new_external

            for k, v in updates_dict.items():
                if hasattr(emp, k):
                    setattr(emp, k, v)
            db.commit()
            return True

    def delete(self, employee_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                return False
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
                view_url=data.get("view_url", ""),
                download_url=data.get("download_url", ""),
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
