"""
be/repositories/sheets/documents.py
Sheets-backed implementation of CompanyDocumentRepository.
"""
from typing import Optional, List, Dict, Any, Union

import sheets_client


def _normalize_company_document_record(d: dict) -> dict:
    normalized = dict(d)
    for field in ("id", "name", "file_type", "category", "drive_file_id",
                  "view_url", "download_url", "uploaded_by", "uploaded_at"):
        if field in normalized and normalized[field] is not None:
            normalized[field] = str(normalized[field])
        elif field in normalized:
            normalized[field] = ""
    return normalized


class SheetsCompanyDocumentRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def list_all(self) -> List[Dict[str, Any]]:
        docs = self.client.get_all_records("CompanyDocuments")
        docs.sort(key=lambda d: str(d.get("uploaded_at", "")), reverse=True)
        return [_normalize_company_document_record(d) for d in docs]

    def get_by_id(self, doc_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        docs = self.client.get_all_records("CompanyDocuments")
        return next((d for d in docs if str(d.get("id")) == str(doc_id)), None)

    def create(self, data: Dict[str, Any]) -> int:
        doc_id = self.client.next_id("CompanyDocuments")
        self.client.append_row("CompanyDocuments", {
            "id": doc_id,
            "name": str(data.get("name")),
            "file_type": data.get("file_type"),
            "category": data.get("category"),
            "drive_file_id": data.get("drive_file_id"),
            "view_url": data.get("view_url"),
            "download_url": data.get("download_url"),
            "uploaded_by": data.get("uploaded_by"),
            "uploaded_at": data.get("uploaded_at"),
        })
        return doc_id

    def delete(self, doc_id: Union[int, str]) -> bool:
        return self.client.delete_row_by_match("CompanyDocuments", "id", doc_id)
