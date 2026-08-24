"""
be/repositories/sql/requests.py
SQLAlchemy-backed implementation of RequestRepository.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import RequestDB, InsuranceClaimDB, VacationHistoryDB


def _request_to_dict(r: RequestDB) -> dict:
    return {
        "id": r.id,
        "employee_id": r.employee_id,
        "employee_name": r.employee_name or "",
        "type": r.type or "",
        "details": r.details or "",
        "date": r.date or "",
        "status": r.status or "Pending",
        "reviewed_by": r.reviewed_by or "",
        "reviewed_at": r.reviewed_at or "",
        "submitted_by": r.submitted_by or "",
    }


class SqlRequestRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def list_requests(
        self,
        type_filter: Optional[str] = None,
        scoped_employee_id: Optional[Union[int, str]] = None,
    ) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(RequestDB)
            if scoped_employee_id is not None:
                query = query.filter(RequestDB.employee_id == int(scoped_employee_id))
            if type_filter and type_filter != "all":
                query = query.filter(RequestDB.type == type_filter)
            reqs = query.order_by(RequestDB.id).all()
            return [_request_to_dict(r) for r in reqs]

    def get_by_id(self, req_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            req = db.query(RequestDB).filter(RequestDB.id == int(req_id)).first()
            return _request_to_dict(req) if req else None

    def create(self, data: Dict[str, Any]) -> int:
        with self._get_session() as db:
            req = RequestDB(
                employee_id=int(data.get("employee_id")),
                employee_name=data.get("employee_name", ""),
                type=data.get("type"),
                details=data.get("details", ""),
                date=data.get("date"),
                status=data.get("status", "Pending"),
                reviewed_by=data.get("reviewed_by", ""),
                reviewed_at=data.get("reviewed_at", ""),
                submitted_by=data.get("submitted_by", ""),
            )
            db.add(req)
            db.commit()
            return req.id

    def action_request(self, req_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        with self._get_session() as db:
            req = db.query(RequestDB).filter(RequestDB.id == int(req_id)).first()
            if not req:
                return False

            req.status = status
            req.reviewed_by = reviewer_email
            req.reviewed_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M")

            emp_id = req.employee_id
            req_type = req.type
            req_date = req.date

            if req_type == "Medical Insurance":
                claims = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.employee_id == emp_id).all()
                matched_claim = next(
                    (c for c in claims if str(c.date) == str(req_date) and c.status != status),
                    None
                )
                if not matched_claim:
                    pending_claims = [c for c in claims if c.status == "Pending"]
                    if len(pending_claims) == 1:
                        matched_claim = pending_claims[0]
                if matched_claim:
                    matched_claim.status = status

            elif req_type == "Vacation":
                vacs = db.query(VacationHistoryDB).filter(VacationHistoryDB.employee_id == emp_id).all()
                matched_vac = next(
                    (v for v in vacs if v.status != status and str(v.start_date) in str(req.details)),
                    None
                )
                if not matched_vac:
                    pending_vacs = [v for v in vacs if v.status == "Pending"]
                    if len(pending_vacs) == 1:
                        matched_vac = pending_vacs[0]
                if matched_vac:
                    matched_vac.status = status

            db.commit()
            return True
