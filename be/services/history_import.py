"""
services/history_import.py
Historical leave and work-from-home items found in old emails and scans (docs/mcp-server-plan.md, D-051).

Claude reads the documents outside HRFlow and sends typed items. They are validated here (the server computes the
days, finds duplicates and overlaps), staged in `import_items`, and only a signed-in reviewer accepting an item
creates the vacation_history and requests rows, in the same shape as the back-dated admin path of
POST /api/vacations/request. Nothing in this module approves, edits or deletes a live record.
"""
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models_db import (
    AuditLogDB, EmployeeDB, HolidayDB, HistoryImportBatchDB, HistoryImportItemDB, RequestDB, VacationHistoryDB,
)
from services.leave_days import count_leave_days, holiday_dates

LEAVE_TYPES = ("Annual Leave", "Sick Leave", "Work From Home", "Unpaid Leave")
DECISIONS = ("Approved", "Rejected")
SOURCE_KINDS = ("email", "scan", "manual")
CONFIDENCE = ("high", "medium", "low")
MAX_ITEMS_PER_BATCH = 100
EVIDENCE_RETENTION_DAYS = 90

_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class HistoryImportError(Exception):
    """Base class so routers can map service failures to HTTP statuses."""


class NotFound(HistoryImportError):
    pass


class Blocked(HistoryImportError):
    def __init__(self, reasons: List[str]):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


class ValidationFailed(HistoryImportError):
    def __init__(self, report: List[Dict[str, Any]]):
        super().__init__("Some items are not valid.")
        self.report = report


def _parse_day(value: str, label: str) -> date:
    if not _ISO_DAY.match(value or ""):
        raise ValueError(f"{label} must be a date as YYYY-MM-DD.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} is not a real date.")


def _live_overlaps(db: Session, employee_id: int, start: str, end: str) -> List[VacationHistoryDB]:
    return (
        db.query(VacationHistoryDB)
        .filter(VacationHistoryDB.employee_id == employee_id, VacationHistoryDB.status != "Rejected",
                VacationHistoryDB.start_date <= end, VacationHistoryDB.end_date >= start)
        .all()
    )


def _staged_overlaps(db: Session, employee_id: int, start: str, end: str, exclude_id: Optional[int]) -> List[HistoryImportItemDB]:
    query = db.query(HistoryImportItemDB).filter(
        HistoryImportItemDB.employee_id == employee_id, HistoryImportItemDB.status == "staged",
        HistoryImportItemDB.decision != "Rejected", HistoryImportItemDB.start_date <= end, HistoryImportItemDB.end_date >= start)
    if exclude_id is not None:
        query = query.filter(HistoryImportItemDB.id != exclude_id)
    return query.all()


def check_item(db: Session, data: Dict[str, Any], exclude_item_id: Optional[int] = None,
               earlier_in_request: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Validates one item against the live data. Returns {"days", "errors", "warnings"}. Errors block staging and
    accepting; warnings (a conflicting staged item from another source) leave the decision to the reviewer."""
    errors: List[str] = []
    warnings: List[str] = []
    days = 0

    employee = db.get(EmployeeDB, data["employee_id"])
    if employee is None:
        errors.append("Employee not found.")
    elif employee.archived_at is not None:
        errors.append("Employee is archived.")

    start_day = end_day = None
    try:
        start_day = _parse_day(data["start_date"], "Start date")
        end_day = _parse_day(data.get("end_date") or data["start_date"], "End date")
        if end_day < start_day:
            raise ValueError("End date cannot be earlier than start date.")
        if data.get("decided_on"):
            _parse_day(data["decided_on"], "Decided on")
    except ValueError as exc:
        errors.append(str(exc))
        start_day = end_day = None

    if start_day and end_day:
        start_s, end_s = start_day.isoformat(), end_day.isoformat()
        holidays = holiday_dates(
            {"start_date": h.start_date, "end_date": h.end_date}
            for h in db.query(HolidayDB).filter(HolidayDB.start_date <= end_s, HolidayDB.end_date >= start_s).all()
        )
        days = count_leave_days(start_day, end_day, holidays)
        if days == 0:
            errors.append("The dates contain no working days (weekends and official holidays are excluded).")

        if employee is not None and data["decision"] != "Rejected":
            for live in _live_overlaps(db, employee.id, start_s, end_s):
                errors.append(f"Overlaps an existing record: {live.type} {live.start_date} to {live.end_date} ({live.status}).")
            for other in _staged_overlaps(db, employee.id, start_s, end_s, exclude_item_id):
                same = (other.leave_type, other.start_date, other.end_date) == (data["leave_type"], start_s, end_s)
                if same:
                    errors.append(f"Already staged (item {other.id}, {other.source_ref}).")
                else:
                    warnings.append(f"Conflicts with staged item {other.id}: {other.leave_type} {other.start_date} to "
                                    f"{other.end_date} from {other.source_ref}.")
            for earlier in earlier_in_request or []:
                if earlier["employee_id"] != employee.id or earlier["decision"] == "Rejected":
                    continue
                e_start, e_end = earlier["start_date"], earlier.get("end_date") or earlier["start_date"]
                if e_start <= end_s and e_end >= start_s:
                    if (earlier["leave_type"], e_start, e_end) == (data["leave_type"], start_s, end_s):
                        errors.append("Repeated in this request.")
                    else:
                        warnings.append(f"Conflicts with another item in this request: {earlier['leave_type']} {e_start} to {e_end}.")

    return {"days": days, "errors": errors, "warnings": warnings}


def validate_items(db: Session, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    report = []
    earlier: List[Dict[str, Any]] = []
    for index, data in enumerate(items):
        result = check_item(db, data, earlier_in_request=earlier)
        report.append({"index": index, "ok": not result["errors"], **result})
        earlier.append(data)
    return report


def _audit(db: Session, action: str, actor: str, target_type: str, target_id: Any, details: str) -> None:
    db.add(AuditLogDB(timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), actor_email=actor, action=action,
                      target_type=target_type, target_id=str(target_id), details=details))


def stage_batch(db: Session, user: Dict[str, Any], label: str, items: List[Dict[str, Any]],
                idempotency_key: Optional[str]) -> tuple:
    """Stages a batch. Returns (batch, created). The same idempotency key from the same user returns the batch that
    key made. Any invalid item stops everything: nothing is staged."""
    if not items or len(items) > MAX_ITEMS_PER_BATCH:
        raise ValidationFailed([{"index": None, "ok": False, "days": 0, "warnings": [],
                                 "errors": [f"Send between 1 and {MAX_ITEMS_PER_BATCH} items."]}])
    if idempotency_key:
        existing = db.query(HistoryImportBatchDB).filter(HistoryImportBatchDB.created_by_user_id == user["user_id"],
                                                  HistoryImportBatchDB.idempotency_key == idempotency_key).first()
        if existing is not None:
            return existing, False

    report = validate_items(db, items)
    if any(not r["ok"] for r in report):
        raise ValidationFailed(report)

    batch = HistoryImportBatchDB(label=label, created_by_user_id=user["user_id"], token_id=user.get("api_token_id"),
                          idempotency_key=idempotency_key or None)
    db.add(batch)
    for data, result in zip(items, report):
        end = data.get("end_date") or data["start_date"]
        batch.items.append(HistoryImportItemDB(
            employee_id=data["employee_id"], leave_type=data["leave_type"], start_date=data["start_date"], end_date=end,
            days=result["days"], decision=data["decision"], decided_by=data.get("decided_by", ""),
            decided_on=data.get("decided_on", ""), source_kind=data["source_kind"], source_ref=data["source_ref"],
            source_sha256=data.get("source_sha256", ""), evidence_excerpt=data.get("evidence_excerpt", ""),
            confidence=data["confidence"], notes=data.get("notes", ""), status="staged"))
    db.flush()
    _audit(db, "history_import.stage", user["email"], "import_batch", batch.id,
           f"items={len(items)}; label={label[:80]}; token_id={user.get('api_token_id')}")
    db.commit()
    return batch, True


def _get_item(db: Session, item_id: int) -> HistoryImportItemDB:
    item = db.get(HistoryImportItemDB, item_id)
    if item is None:
        raise NotFound("Item not found.")
    return item


def _item_data(item: HistoryImportItemDB) -> Dict[str, Any]:
    return {"employee_id": item.employee_id, "leave_type": item.leave_type, "start_date": item.start_date,
            "end_date": item.end_date, "decision": item.decision, "decided_on": item.decided_on or ""}


def serialize_item(db: Session, item: HistoryImportItemDB) -> Dict[str, Any]:
    out = {c: getattr(item, c) for c in (
        "id", "batch_id", "employee_id", "leave_type", "start_date", "end_date", "days", "decision", "decided_by",
        "decided_on", "source_kind", "source_ref", "source_sha256", "evidence_excerpt", "confidence", "notes", "status",
        "reviewed_by", "reject_reason", "result_vacation_id")}
    out["reviewed_at"] = item.reviewed_at.isoformat() if item.reviewed_at else None
    employee = db.get(EmployeeDB, item.employee_id)
    out["employee_name"] = employee.name if employee else ""
    out["blocked_by"] = []
    out["warnings"] = []
    if item.status == "staged":
        result = check_item(db, _item_data(item), exclude_item_id=item.id)
        out["blocked_by"], out["warnings"] = result["errors"], result["warnings"]
    return out


def serialize_batch(db: Session, batch: HistoryImportBatchDB, with_items: bool = True) -> Dict[str, Any]:
    counts = {"staged": 0, "accepted": 0, "rejected": 0}
    for item in batch.items:
        counts[item.status] = counts.get(item.status, 0) + 1
    out = {"id": batch.id, "label": batch.label, "created_at": batch.created_at.isoformat(), "counts": counts,
           "item_count": len(batch.items)}
    if with_items:
        out["items"] = [serialize_item(db, i) for i in batch.items]
    return out


def update_item(db: Session, item_id: int, patch: Dict[str, Any], reviewer: str) -> HistoryImportItemDB:
    item = _get_item(db, item_id)
    if item.status != "staged":
        raise Blocked(["Only staged items can be edited."])
    data = {**_item_data(item), **{k: v for k, v in patch.items() if v is not None}}
    result = check_item(db, data, exclude_item_id=item.id)
    if result["errors"]:
        raise Blocked(result["errors"])
    item.leave_type, item.start_date = data["leave_type"], data["start_date"]
    item.end_date = data.get("end_date") or data["start_date"]
    item.decision, item.days = data["decision"], result["days"]
    _audit(db, "history_import.edit", reviewer, "import_item", item.id, f"{item.leave_type} {item.start_date} to {item.end_date}")
    db.commit()
    return item


def accept_item(db: Session, item_id: int, reviewer: str) -> HistoryImportItemDB:
    """Creates the vacation_history and requests rows for a staged item, in one transaction."""
    item = _get_item(db, item_id)
    if item.status != "staged":
        raise Blocked(["Only staged items can be accepted."])
    result = check_item(db, _item_data(item), exclude_item_id=item.id)
    if result["errors"]:
        raise Blocked(result["errors"])
    employee = db.get(EmployeeDB, item.employee_id)
    now = datetime.utcnow()

    vacation = VacationHistoryDB(employee_id=item.employee_id, type=item.leave_type, start_date=item.start_date,
                                 end_date=item.end_date, days=result["days"], status=item.decision, submitted_by=reviewer)
    db.add(vacation)
    db.flush()
    db.add(RequestDB(
        employee_id=item.employee_id, employee_name=employee.name, type="Vacation",
        details=f"{item.leave_type}: {item.start_date} to {item.end_date}",
        date=item.decided_on or now.strftime("%Y-%m-%d"), status=item.decision, reviewed_by=reviewer,
        reviewed_at=now.strftime("%Y-%m-%d %H:%M"), submitted_by=reviewer))
    item.days = result["days"]
    item.status, item.reviewed_by, item.reviewed_at, item.result_vacation_id = "accepted", reviewer, now, vacation.id
    _audit(db, "history_import.accept", reviewer, "import_item", item.id,
           f"batch={item.batch_id}; vacation_id={vacation.id}; source={item.source_kind}:{item.source_ref[:120]}")
    db.commit()
    return item


def reject_item(db: Session, item_id: int, reviewer: str, reason: str) -> HistoryImportItemDB:
    item = _get_item(db, item_id)
    if item.status != "staged":
        raise Blocked(["Only staged items can be rejected."])
    item.status, item.reviewed_by, item.reviewed_at, item.reject_reason = "rejected", reviewer, datetime.utcnow(), reason[:255]
    _audit(db, "history_import.reject", reviewer, "import_item", item.id, f"batch={item.batch_id}; reason={reason[:120]}")
    db.commit()
    return item


def purge_expired_evidence(db: Session) -> int:
    """Erases evidence excerpts EVIDENCE_RETENTION_DAYS after review. There is no scheduler yet, so listing batches
    runs this."""
    cutoff = datetime.utcnow() - timedelta(days=EVIDENCE_RETENTION_DAYS)
    count = (
        db.query(HistoryImportItemDB)
        .filter(HistoryImportItemDB.status != "staged", HistoryImportItemDB.reviewed_at < cutoff, HistoryImportItemDB.evidence_excerpt.isnot(None),
                HistoryImportItemDB.evidence_excerpt != "")
        .update({HistoryImportItemDB.evidence_excerpt: None}, synchronize_session=False)
    )
    db.commit()
    return count
