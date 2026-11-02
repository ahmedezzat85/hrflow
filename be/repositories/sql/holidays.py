"""
be/repositories/sql/holidays.py
SQLAlchemy-backed implementation of HolidayRepository.
"""
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import HolidayDB


def _holiday_to_dict(h: HolidayDB) -> Dict[str, Any]:
    return {"id": h.id, "name": h.name, "start_date": h.start_date, "end_date": h.end_date}


class SqlHolidayRepository:
    def _get_session(self) -> Session:
        return get_db_context()

    def list_overlapping(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Holidays that touch any day of [start_date, end_date] (ISO strings compare in date order)."""
        with self._get_session() as db:
            rows = (
                db.query(HolidayDB)
                .filter(HolidayDB.start_date <= end_date, HolidayDB.end_date >= start_date)
                .order_by(HolidayDB.start_date, HolidayDB.id)
                .all()
            )
            return [_holiday_to_dict(h) for h in rows]

    def create(self, name: str, start_date: str, end_date: str, actor_email: str) -> int:
        with self._get_session() as db:
            row = HolidayDB(name=name, start_date=start_date, end_date=end_date, created_by=actor_email)
            db.add(row)
            db.commit()
            return row.id

    def update(self, holiday_id: int, name: str, start_date: str, end_date: str) -> bool:
        with self._get_session() as db:
            row: Optional[HolidayDB] = db.get(HolidayDB, holiday_id)
            if row is None:
                return False
            row.name, row.start_date, row.end_date = name, start_date, end_date
            db.commit()
            return True

    def delete(self, holiday_id: int) -> bool:
        with self._get_session() as db:
            row: Optional[HolidayDB] = db.get(HolidayDB, holiday_id)
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True
