"""
be/repositories/sql/documents.py
SQLAlchemy-backed implementation of CompanyDocumentRepository.
"""
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import CompanyDocumentDB


def _company_doc_to_dict(d: CompanyDocumentDB) -> dict:
    return {
        "id": str(d.id),
        "name": d.name or "",
        "file_type": d.file_type or "",
        "category": d.category or "General",
        "drive_file_id": d.drive_file_id or "",
        "view_url": d.view_url or "",
        "download_url": d.download_url or "",
        "uploaded_by": d.uploaded_by or "",
        "uploaded_at": d.uploaded_at or "",
    }


class SqlCompanyDocumentRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def list_all(self) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            docs = db.query(CompanyDocumentDB).order_by(CompanyDocumentDB.uploaded_at.desc(), CompanyDocumentDB.id.desc()).all()
            return [_company_doc_to_dict(d) for d in docs]

    def get_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            doc = db.query(CompanyDocumentDB).filter(CompanyDocumentDB.id == int(doc_id)).first()
            return _company_doc_to_dict(doc) if doc else None

    def create(self, data: Dict[str, Any]) -> int:
        with self._get_session() as db:
            doc = CompanyDocumentDB(
                name=str(data.get("name")),
                file_type=data.get("file_type"),
                category=data.get("category", "General"),
                drive_file_id=data.get("drive_file_id"),
                view_url=data.get("view_url", ""),
                download_url=data.get("download_url", ""),
                uploaded_by=data.get("uploaded_by", ""),
                uploaded_at=data.get("uploaded_at", ""),
            )
            db.add(doc)
            db.commit()
            return doc.id

    def delete(self, doc_id: Union[int, str]) -> bool:
        with self._get_session() as db:
            doc = db.query(CompanyDocumentDB).filter(CompanyDocumentDB.id == int(doc_id)).first()
            if not doc:
                return False
            db.delete(doc)
            db.commit()
            return True
