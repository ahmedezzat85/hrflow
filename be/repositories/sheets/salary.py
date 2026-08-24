"""
be/repositories/sheets/salary.py
Sheets-backed implementation of SalaryRepository.
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Union

import sheets_client


class SheetsSalaryRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def get_history(self, employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        history = self.client.get_all_records("SalaryHistory")
        if employee_id is not None:
            history = [h for h in history if str(h.get("employee_id")) == str(employee_id)]
        return history

    def apply_raise(
        self,
        employee_id: Union[int, str],
        new_internal: float,
        new_external: float,
        effective_date: Optional[str],
        reason: str,
        actor_email: str,
    ) -> Dict[str, Any]:
        employees = self.client.get_all_records("Employees")
        emp = next((e for e in employees if str(e.get("id")) == str(employee_id)), None)
        if not emp:
            raise ValueError("Employee not found")

        current_internal = float(emp.get("internal_salary_usd") or 0)
        current_external = float(emp.get("external_salary_usd") or 0)
        current_total = current_internal + current_external

        new_internal = round(new_internal, 2)
        new_external = round(new_external, 2)
        new_total = round(new_internal + new_external, 2)

        if new_internal < 0 or new_external < 0 or new_total <= 0:
            raise ValueError("Resulting salary must be non-negative and total must be positive")

        internal_delta_amount = round(new_internal - current_internal, 2)
        internal_delta_pct = round(internal_delta_amount / current_internal * 100, 2) if current_internal > 0 else 0.0
        external_delta_amount = round(new_external - current_external, 2)
        external_delta_pct = round(external_delta_amount / current_external * 100, 2) if current_external > 0 else 0.0
        total_delta_amount = round(new_total - current_total, 2)
        total_delta_pct = round(total_delta_amount / current_total * 100, 2) if current_total > 0 else 0.0

        eff_date = effective_date or datetime.utcnow().strftime("%Y-%m-%d")

        history_id = self.client.next_id("SalaryHistory")
        self.client.append_row("SalaryHistory", {
            "id": history_id,
            "employee_id": emp["id"],
            "date": eff_date,
            "previous_salary": current_total,
            "new_salary": new_total,
            "pct_change": f"{'+' if total_delta_pct >= 0 else ''}{total_delta_pct}%",
            "reason": reason,
            "applied_by": actor_email,
            "previous_internal_usd": current_internal,
            "previous_external_usd": current_external,
            "new_internal_usd": new_internal,
            "new_external_usd": new_external,
        })

        is_backdated = effective_date is not None and eff_date < datetime.utcnow().strftime("%Y-%m-%d")
        if not is_backdated:
            next_raise_date = (datetime.strptime(eff_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
            self.client.update_row_by_match("Employees", "id", emp["id"], {
                "internal_salary_usd": new_internal,
                "external_salary_usd": new_external,
                "salary": new_total,
                "next_raise": next_raise_date,
            })

        return {
            "message": "Raise applied",
            "previous_salary": current_total,
            "new_salary": new_total,
            "pct_change": total_delta_pct,
            "previous_internal_salary_usd": current_internal,
            "new_internal_salary_usd": new_internal,
            "previous_external_salary_usd": current_external,
            "new_external_salary_usd": new_external,
            "internal_delta_amount": internal_delta_amount,
            "internal_delta_pct": internal_delta_pct,
            "external_delta_amount": external_delta_amount,
            "external_delta_pct": external_delta_pct,
            "total_delta_amount": total_delta_amount,
            "total_delta_pct": total_delta_pct,
            "employee": emp,
        }
