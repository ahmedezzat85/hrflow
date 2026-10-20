"""
be/finance/import_report.py
Report model for the bulk / historical import (plan 25, section 6): one result per manifest row plus
file-level messages. Used by the dry run and the commit alike.
"""
from typing import List, Optional

from pydantic import BaseModel, Field

# Row statuses. `ok` and `warning` rows are created on commit; `error` and `duplicate` rows never are.
ROW_OK = "ok"
ROW_WARNING = "warning"
ROW_ERROR = "error"
ROW_DUPLICATE = "duplicate"

# Finding levels produced by checks; the row status is derived from them
LEVEL_ERROR = "error"
LEVEL_WARNING = "warning"
LEVEL_DUPLICATE = "duplicate"


class Finding(BaseModel):
    level: str
    code: str
    message: str


class ImportRowResult(BaseModel):
    row_number: int = Field(..., description="1-based position among the manifest's data rows")
    line: int = Field(..., description="Row number in the spreadsheet or text file (header is line 1)")
    row_ref: str = ""
    source_file: Optional[str] = None
    status: str
    findings: List[Finding] = Field(default_factory=list)
    created_id: Optional[int] = Field(None, description="Id of the Draft created by the commit")
    duplicate_of: Optional[int] = None


class ImportReport(BaseModel):
    kind: str
    dry_run: bool
    committed: bool = False
    manifest_name: Optional[str] = None
    archive_name: Optional[str] = None
    batch_id: Optional[int] = None
    rows_total: int = 0
    rows_ok: int = 0
    rows_warning: int = 0
    rows_error: int = 0
    rows_duplicate: int = 0
    rows_created: int = 0
    rows_failed: int = 0
    file_errors: List[str] = Field(default_factory=list)
    file_warnings: List[str] = Field(default_factory=list)
    unreferenced_files: List[str] = Field(default_factory=list)
    rows: List[ImportRowResult] = Field(default_factory=list)


class ImportLimitsResponse(BaseModel):
    kinds: List[str] = Field(..., description="Kinds the caller may import")
    max_documents_per_run: int
    max_request_bytes: int
    max_file_bytes: int
    allowed_extensions: List[str]
    low_confidence_threshold: float
