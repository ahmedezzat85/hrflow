"""
be/repositories/sql/employee_bank_accounts.py
SQLAlchemy-backed implementation of EmployeeBankAccountRepository.
"""
from datetime import datetime
from typing import Dict, Any, Union, Tuple, Optional

from sqlalchemy.orm import Session

from db import get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB


def _mask_iban(iban: str) -> str:
    iban = str(iban)
    if len(iban) <= 4:
        return iban
    return "*" * (len(iban) - 4) + iban[-4:]


class SqlEmployeeBankAccountRepository:
    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    def _get_session(self) -> Session:
        return get_db_context()

    def get_by_employee_id(self, employee_id: Union[int, str], reveal: bool = False) -> Dict[str, Any]:
        with self._get_session() as db:
            bank = (
                db.query(EmployeeBankAccountDB)
                .filter(EmployeeBankAccountDB.employee_id == int(employee_id))
                .first()
            )
            if not bank:
                return {"has_details": False}

            return {
                "has_details": True,
                "bank_name": bank.bank_name or "",
                "iban": bank.iban if reveal else _mask_iban(bank.iban),
                "swift_code": bank.swift_code or "",
                "updated_by": bank.updated_by or "",
                "updated_at": bank.updated_at or "",
            }

    def upsert(
        self,
        employee_id: Union[int, str],
        bank_name: str,
        iban: str,
        swift_code: str,
        actor_email: str,
    ) -> Tuple[str, Optional[int]]:
        with self._get_session() as db:
            emp = db.query(EmployeeDB).filter(EmployeeDB.id == int(employee_id)).first()
            if not emp:
                raise ValueError("Employee not found")

            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
            bank = (
                db.query(EmployeeBankAccountDB)
                .filter(EmployeeBankAccountDB.employee_id == int(employee_id))
                .first()
            )

            if bank:
                bank.bank_name = bank_name.strip()
                bank.iban = iban.strip()
                bank.swift_code = (swift_code or "").strip()
                bank.updated_by = actor_email
                bank.updated_at = now
                action = "update"
                record_id = bank.id
            else:
                bank = EmployeeBankAccountDB(
                    employee_id=int(employee_id),
                    bank_name=bank_name.strip(),
                    iban=iban.strip(),
                    swift_code=(swift_code or "").strip(),
                    updated_by=actor_email,
                    updated_at=now,
                )
                db.add(bank)
                action = "create"
                db.flush()
                record_id = bank.id

            db.commit()
            return action, record_id


# Backward compatibility alias
SqlBankRepository = SqlEmployeeBankAccountRepository
