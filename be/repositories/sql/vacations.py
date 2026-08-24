"""
be/repositories/sql/vacations.py
SQLAlchemy-backed implementation of VacationRepository.
"""
from typing import Optional, List, Dict, Any, Union

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import VacationHistoryDB, RequestDB


def _vacation_to_dict(v: VacationHistoryDB) -> dict:
    return {
        "id": v.id,
        "employee_id": v.employee_id,
        "type": v.type or "",
        "start_date": v.start_date or "",
        "end_date": v.end_date or "",
        "days": v.days if v.days is not None else 1,
        "status": v.status or "Pending",
        "submitted_by": v.submitted_by or "",
    }


class SqlVacationRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def get_history(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            query = db.query(VacationHistoryDB)
            if scoped_employee_id is not None:
                query = query.filter(VacationHistoryDB.employee_id == int(scoped_employee_id))
            history = query.order_by(VacationHistoryDB.id).all()
            return [_vacation_to_dict(v) for v in history]

    def create_vacation_request(
        self,
        vacation_data: Dict[str, Any],
        request_data: Dict[str, Any],
    ) -> int:
        with self._get_session() as db:
            vac = VacationHistoryDB(
                employee_id=int(vacation_data.get("employee_id")),
                type=vacation_data.get("type"),
                start_date=vacation_data.get("start_date"),
                end_date=vacation_data.get("end_date"),
                days=int(vacation_data.get("days", 1)),
                status=vacation_data.get("status", "Pending"),
                submitted_by=vacation_data.get("submitted_by", ""),
            )
            db.add(vac)

            req = RequestDB(
                employee_id=int(request_data.get("employee_id")),
                employee_name=request_data.get("employee_name", ""),
                type="Vacation",
                details=request_data.get("details", ""),
                date=request_data.get("date"),
                status=request_data.get("status", "Pending"),
                reviewed_by=request_data.get("reviewed_by", ""),
                reviewed_at=request_data.get("reviewed_at", ""),
                submitted_by=request_data.get("submitted_by", ""),
            )
            db.add(req)

            db.commit()
            return vac.id
