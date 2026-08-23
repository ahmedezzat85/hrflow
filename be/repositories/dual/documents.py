"""
be/repositories/dual/documents.py
DualWriteCompanyDocumentRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import CompanyDocumentRepository
from repositories.sheets.documents import SheetsCompanyDocumentRepository
from repositories.sql.documents import SqlCompanyDocumentRepository

logger = get_logger("dual_write")


class DualWriteCompanyDocumentRepository:
    def __init__(self, primary: Optional[CompanyDocumentRepository] = None, shadow: Optional[CompanyDocumentRepository] = None):
        self.primary = primary or SheetsCompanyDocumentRepository()
        self.shadow = shadow or SqlCompanyDocumentRepository()

    def list_all(self) -> List[Dict[str, Any]]:
        return self.primary.list_all()

    def get_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_by_id(doc_id)

    def create(self, data: Dict[str, Any]) -> int:
        doc_id = self.primary.create(data)
        try:
            self.shadow.create(data)
        except Exception:
            logger.exception("Dual-write shadow create company document failed for %s", data.get("name"))
        return doc_id

    def delete(self, doc_id: Union[int, str]) -> bool:
        ok = self.primary.delete(doc_id)
        if ok:
            try:
                self.shadow.delete(doc_id)
            except Exception:
                logger.exception("Dual-write shadow delete company document failed for doc_id=%s", doc_id)
        return ok
