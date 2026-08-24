"""
be/repositories/sql/auth.py
SQLAlchemy-backed implementation of UserRepository.
"""
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import UserDB


def _user_to_dict(u: UserDB) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "role": u.role,
        "employee_id": u.employee_id,
    }


class SqlUserRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def find_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            user = (
                db.query(UserDB)
                .filter(UserDB.email.ilike(email.strip()))
                .first()
            )
            return _user_to_dict(user) if user else None
