"""The tools Claude can call. Each one is a plain function over an HRFlowClient so it can be tested without a network.

What the tools may do is the security boundary of this server (docs/mcp-server-plan.md, sections 3 and 5): they read
minimal employee and leave data and they stage historical leave for a person to review in HRFlow. There is no tool that
approves, edits or deletes a live record, and none that returns salary, bank, tax, ID or document data."""
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from hrflow_client import HRFlowClient, HRFlowError

# Same list as be/services/history_import.py LEAVE_TYPES; a backend test would catch a drift in the accepted values.
LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Work From Home", "Unpaid Leave"]
MAX_FIND_RESULTS = 10
MAX_LEAVE_ROWS = 200

EMPLOYEE_KEYS = ("id", "name", "email", "status", "job_role")
LEAVE_KEYS = ("id", "type", "start_date", "end_date", "days", "status")
HOLIDAY_KEYS = ("name", "start_date", "end_date")
ITEM_KEYS = ("id", "employee_id", "employee_name", "leave_type", "start_date", "end_date", "days", "decision", "status",
             "confidence", "warnings", "blocked_by")


class HistoryItem(BaseModel):
    employee_id: int = Field(description="The id from find_employee. Never guess it from a name.")
    leave_type: Literal["Annual Leave", "Sick Leave", "Work From Home", "Unpaid Leave"]
    start_date: str = Field(description="First day, YYYY-MM-DD")
    end_date: Optional[str] = Field(default=None, description="Last day, YYYY-MM-DD; omit for one day")
    decision: Literal["Approved", "Rejected"] = Field(description="What the source says was decided")
    decided_by: str = Field(default="", max_length=255, description="Who decided, as written in the source")
    decided_on: str = Field(default="", max_length=10, description="Date of the decision, YYYY-MM-DD, if the source shows it")
    source_kind: Literal["email", "scan", "manual"]
    source_ref: str = Field(min_length=1, max_length=255, description="Where it came from: email subject and date, or the file name")
    source_sha256: str = Field(default="", description="SHA-256 of the source file, if known")
    evidence_excerpt: str = Field(default="", max_length=500, description="The short passage that shows the decision, for the reviewer")
    confidence: Literal["high", "medium", "low"] = Field(description="How sure you are you read it correctly; use low for handwriting or ambiguity")
    notes: str = Field(default="", max_length=1000)


def _pick(row: Dict[str, Any], keys) -> Dict[str, Any]:
    return {k: row.get(k) for k in keys}


def find_employee(client: HRFlowClient, query: str) -> List[Dict[str, Any]]:
    query = (query or "").strip().lower()
    if len(query) < 2:
        raise HRFlowError("Give at least 2 characters of the employee's name or email.")
    rows = client.get("/api/employees")
    found = [r for r in rows if query in (r.get("name") or "").lower() or query in (r.get("email") or "").lower()]
    return [_pick(r, EMPLOYEE_KEYS) for r in found[:MAX_FIND_RESULTS]]


def list_leave(client: HRFlowClient, employee_id: int, from_date: Optional[str] = None, to_date: Optional[str] = None,
               leave_type: Optional[str] = None) -> List[Dict[str, Any]]:
    if leave_type is not None and leave_type not in LEAVE_TYPES:
        raise HRFlowError(f"leave_type must be one of {LEAVE_TYPES}.")
    rows = client.get("/api/vacations/history", params={"employee_id": employee_id})
    out = []
    for r in rows:
        if leave_type and r.get("type") != leave_type:
            continue
        if from_date and (r.get("end_date") or "") < from_date:
            continue
        if to_date and (r.get("start_date") or "") > to_date:
            continue
        out.append(_pick(r, LEAVE_KEYS))
    return out[:MAX_LEAVE_ROWS]


def list_holidays(client: HRFlowClient, year: int) -> List[Dict[str, Any]]:
    if not 2000 <= year <= 2100:
        raise HRFlowError("year must be between 2000 and 2100.")
    return [_pick(h, HOLIDAY_KEYS) for h in client.get("/api/holidays", params={"year": year})]


def list_leave_types() -> List[str]:
    return list(LEAVE_TYPES)


def _batch_view(batch: Dict[str, Any]) -> Dict[str, Any]:
    return {"batch_id": batch["id"], "label": batch["label"], "counts": batch["counts"],
            "items": [_pick(i, ITEM_KEYS) for i in batch.get("items", [])]}


def validate_history_items(client: HRFlowClient, items: List[HistoryItem]) -> Dict[str, Any]:
    result = client.post("/api/history-import/validate", json={"items": [i.model_dump() for i in items]})
    return {"ok": result["ok"], "items": result["items"]}


def stage_history_items(client: HRFlowClient, batch_label: str, items: List[HistoryItem], idempotency_key: str) -> Dict[str, Any]:
    if len(idempotency_key) < 8:
        raise HRFlowError("idempotency_key must be at least 8 characters; reuse the same key to retry the same batch safely.")
    try:
        batch = client.post("/api/history-import/batches", json={"label": batch_label, "items": [i.model_dump() for i in items]},
                            headers={"Idempotency-Key": idempotency_key})
    except HRFlowError as exc:
        if exc.status == 422 and isinstance(exc.detail, dict):
            # Not staged: hand Claude the per-item report so it can fix the items and try again.
            return {"staged": False, "report": exc.detail.get("report", [])}
        raise
    return {"staged": True, **_batch_view(batch), "next_step": "A person must now accept each item on the Import review page in HRFlow."}


def get_import_batch(client: HRFlowClient, batch_id: int) -> Dict[str, Any]:
    return _batch_view(client.get(f"/api/history-import/batches/{batch_id}"))
