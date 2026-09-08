"""
be/repositories/sheets/bank.py
Sheets-backed implementation of BankRepository.
"""
from datetime import datetime
from typing import Dict, Any, Union, Tuple, Optional

import sheets_client


def _mask_iban(iban: str) -> str:
    iban = str(iban)
    if len(iban) <= 4:
        return iban
    return "*" * (len(iban) - 4) + iban[-4:]


def _normalize_bank_record(r: dict) -> dict:
    out = dict(r)
    for f in ("id", "employee_id", "bank_name", "iban", "swift_code", "updated_by", "updated_at"):
        out[f] = str(out.get(f, "") or "")
    return out


class SheetsBankRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def get_by_employee_id(self, employee_id: Union[int, str], reveal: bool = False) -> Dict[str, Any]:
        records = self.client.get_all_records("EmployeeBankAccounts")
        record = next((r for r in records if str(r.get("employee_id")) == str(employee_id)), None)
        if not record:
            return {"has_details": False}

        record = _normalize_bank_record(record)
        return {
            "has_details": True,
            "bank_name": record["bank_name"],
            "iban": record["iban"] if reveal else _mask_iban(record["iban"]),
            "swift_code": record["swift_code"],
            "updated_by": record["updated_by"],
            "updated_at": record["updated_at"],
        }

    def upsert(
        self,
        employee_id: Union[int, str],
        bank_name: str,
        iban: str,
        swift_code: str,
        actor_email: str,
    ) -> Tuple[str, Optional[int]]:
        employees = self.client.get_all_records("Employees")
        if not any(str(e.get("id")) == str(employee_id) for e in employees):
            raise ValueError("Employee not found")

        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        records = self.client.get_all_records("EmployeeBankAccounts")
        existing = next((r for r in records if str(r.get("employee_id")) == str(employee_id)), None)

        updates = {
            "bank_name": bank_name.strip(),
            "iban": iban.strip(),
            "swift_code": (swift_code or "").strip(),
            "updated_by": actor_email,
            "updated_at": now,
        }

        if existing:
            self.client.update_row_by_match("EmployeeBankAccounts", "employee_id", employee_id, updates)
            return "update", int(existing["id"]) if str(existing.get("id", "")).isdigit() else None
        else:
            new_id = self.client.next_id("EmployeeBankAccounts")
            self.client.append_row("EmployeeBankAccounts", {
                "id": new_id,
                "employee_id": int(employee_id) if str(employee_id).isdigit() else employee_id,
                **updates,
            })
            return "create", new_id
