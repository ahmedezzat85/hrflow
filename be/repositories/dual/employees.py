"""
be/repositories/dual/employees.py
DualWriteEmployeeRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import EmployeeRepository
from repositories.sheets.employees import SheetsEmployeeRepository
from repositories.sql.employees import SqlEmployeeRepository

logger = get_logger("dual_write")


class DualWriteEmployeeRepository:
    def __init__(self, primary: Optional[EmployeeRepository] = None, shadow: Optional[EmployeeRepository] = None):
        self.primary = primary or SqlEmployeeRepository()
        self.shadow = shadow or SheetsEmployeeRepository()

    def get_by_id(self, employee_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_by_id(employee_id)

    def list_all(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        return self.primary.list_all(scoped_employee_id=scoped_employee_id)

    def create(self, data: Dict[str, Any]) -> int:
        result_id = self.primary.create(data)
        try:
            shadow_data = dict(data)
            shadow_data["id"] = result_id
            self.shadow.create(shadow_data)
        except Exception:
            logger.exception("Dual-write shadow create failed for employee %s", data.get("email"))
        return result_id

    def update(self, employee_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        ok = self.primary.update(employee_id, updates)
        if ok:
            try:
                self.shadow.update(employee_id, updates)
            except Exception:
                logger.exception("Dual-write shadow update failed for employee_id=%s", employee_id)
        return ok

    def delete(self, employee_id: Union[int, str]) -> bool:
        ok = self.primary.delete(employee_id)
        if ok:
            try:
                self.shadow.delete(employee_id)
            except Exception:
                logger.exception("Dual-write shadow delete failed for employee_id=%s", employee_id)
        return ok

    def get_notes(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        return self.primary.get_notes(employee_id)

    def create_note(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        note_id = self.primary.create_note(employee_id, data)
        try:
            self.shadow.create_note(employee_id, data)
        except Exception:
            logger.exception("Dual-write shadow create_note failed for employee_id=%s", employee_id)
        return note_id

    def delete_note(self, note_id: Union[int, str]) -> bool:
        ok = self.primary.delete_note(note_id)
        if ok:
            try:
                self.shadow.delete_note(note_id)
            except Exception:
                logger.exception("Dual-write shadow delete_note failed for note_id=%s", note_id)
        return ok

    def get_documents(self, employee_id: Union[int, str]) -> List[Dict[str, Any]]:
        return self.primary.get_documents(employee_id)

    def get_document_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_document_by_id(doc_id)

    def create_document(self, employee_id: Union[int, str], data: Dict[str, Any]) -> int:
        doc_id = self.primary.create_document(employee_id, data)
        try:
            self.shadow.create_document(employee_id, data)
        except Exception:
            logger.exception("Dual-write shadow create_document failed for employee_id=%s", employee_id)
        return doc_id

    def delete_document(self, doc_id: Union[int, str]) -> bool:
        ok = self.primary.delete_document(doc_id)
        if ok:
            try:
                self.shadow.delete_document(doc_id)
            except Exception:
                logger.exception("Dual-write shadow delete_document failed for doc_id=%s", doc_id)
        return ok
