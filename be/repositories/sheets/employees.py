"""
be/repositories/sheets/employees.py
Sheets-backed implementation of EmployeeRepository.
"""
from typing import Optional, List, Dict, Any, Union

import sheets_client


def _normalize_document_record(d: dict) -> dict:
    normalized = dict(d)
    for field in ("id", "employee_id", "name", "file_type", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized


class SheetsEmployeeRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def get_by_id(self, employee_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        employees = self.client.get_all_records("Employees")
        return next((e for e in employees if str(e.get("id")) == str(employee_id)), None)

    def list_all(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        employees = self.client.get_all_records("Employees")
        if scoped_employee_id is not None:
            employees = [e for e in employees if str(e.get("id")) == str(scoped_employee_id)]
        return employees

    def create(self, data: Dict[str, Any]) -> int:
        new_id = self.client.next_id("Employees")
        internal_salary = float(data.get("internal_salary_usd") or 0)
        external_salary = float(data.get("external_salary_usd") or 0)
        legacy_total_salary = internal_salary + external_salary

        employee_row = {
            "id": new_id,
            "name": data.get("name"),
            "email": data.get("email"),
            "role": "employee",
            "dept": data.get("dept", ""),
            "job_role": data.get("job_role", ""),
            "salary": legacy_total_salary,
            "join_date": data.get("join_date", ""),
            "status": data.get("status", "Active"),
            "vac_total": data.get("vac_total", 21),
            "vac_used": 0,
            "next_raise": data.get("next_raise", ""),
            "employment_state": data.get("employment_state", "Full-Time"),
            "internal_salary_usd": internal_salary,
            "external_salary_usd": external_salary,
            "invoice_id": data.get("invoice_id") or "",
            "address_line_1": data.get("address_line_1") or "",
            "address_line_2": data.get("address_line_2") or "",
        }
        self.client.append_row("Employees", employee_row)
        self.client.append_row("Users", {
            "email": data.get("email"),
            "role": "employee",
            "employee_id": new_id,
        })
        return new_id

    def update(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        updates_dict = dict(updates)
        if "internal_salary_usd" in updates_dict or "external_salary_usd" in updates_dict:
            emp = self.get_by_id(employee_id)
            if not emp:
                return False
            current_internal = float(emp.get("internal_salary_usd") or 0)
            current_external = float(emp.get("external_salary_usd") or 0)
            new_internal = float(updates_dict.get("internal_salary_usd", current_internal))
            new_external = float(updates_dict.get("external_salary_usd", current_external))
            updates_dict["salary"] = new_internal + new_external

        return self.client.update_row_by_match("Employees", "id", employee_id, updates_dict)

    def delete(self, employee_id: Union[int, str]) -> bool:
        ok = self.client.delete_row_by_match("Employees", "id", employee_id)
        self.client.delete_row_by_match("Users", "employee_id", employee_id)
        return ok

    def get_notes(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        notes = self.client.get_all_records("EmployeeNotes")
        notes = [n for n in notes if str(n.get("employee_id")) == str(employee_id)]
        notes.sort(key=lambda n: str(n.get("date", "")), reverse=True)
        return notes

    def create_note(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        note_id = self.client.next_id("EmployeeNotes")
        self.client.append_row("EmployeeNotes", {
            "id": note_id,
            "employee_id": int(employee_id) if str(employee_id).isdigit() else employee_id,
            "date": data.get("date"),
            "category": data.get("category", "General"),
            "note": data.get("note", ""),
            "created_by": data.get("created_by", ""),
        })
        return note_id

    def delete_note(self, note_id: Union[int, str]) -> bool:
        return self.client.delete_row_by_match("EmployeeNotes", "id", note_id)

    def get_documents(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        docs = self.client.get_all_records("EmployeeDocuments")
        docs = [d for d in docs if str(d.get("employee_id")) == str(employee_id)]
        docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
        return [_normalize_document_record(d) for d in docs]

    def get_document_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        docs = self.client.get_all_records("EmployeeDocuments")
        return next((d for d in docs if str(d.get("id")) == str(doc_id)), None)

    def create_document(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        doc_id = self.client.next_id("EmployeeDocuments")
        self.client.append_row("EmployeeDocuments", {
            "id": doc_id,
            "employee_id": int(employee_id) if str(employee_id).isdigit() else employee_id,
            "name": str(data.get("name")),
            "file_type": data.get("file_type"),
            "drive_file_id": data.get("drive_file_id"),
            "view_url": data.get("view_url"),
            "download_url": data.get("download_url"),
            "uploaded_by": data.get("uploaded_by"),
            "uploaded_at": data.get("uploaded_at"),
        })
        return doc_id

    def delete_document(self, doc_id: Union[int, str]) -> bool:
        return self.client.delete_row_by_match("EmployeeDocuments", "id", doc_id)
