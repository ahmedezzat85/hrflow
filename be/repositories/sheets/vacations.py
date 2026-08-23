"""
be/repositories/sheets/vacations.py
Sheets-backed implementation of VacationRepository.
"""
from typing import Optional, List, Dict, Any, Union

import sheets_client


class SheetsVacationRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def get_history(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        history = self.client.get_all_records("VacationHistory")
        if scoped_employee_id is not None:
            history = [h for h in history if str(h.get("employee_id")) == str(scoped_employee_id)]
        return history

    def create_vacation_request(
        self,
        vacation_data: Dict[str, Any],
        request_data: Dict[str, Any],
    ) -> int:
        vac_id = self.client.next_id("VacationHistory")
        self.client.append_row("VacationHistory", {
            "id": vac_id,
            "employee_id": vacation_data.get("employee_id"),
            "type": vacation_data.get("type"),
            "start_date": vacation_data.get("start_date"),
            "end_date": vacation_data.get("end_date"),
            "days": vacation_data.get("days"),
            "status": vacation_data.get("status", "Pending"),
            "submitted_by": vacation_data.get("submitted_by", ""),
        })

        req_id = self.client.next_id("Requests")
        self.client.append_row("Requests", {
            "id": req_id,
            "employee_id": request_data.get("employee_id"),
            "employee_name": request_data.get("employee_name", ""),
            "type": "Vacation",
            "details": request_data.get("details", ""),
            "date": request_data.get("date"),
            "status": request_data.get("status", "Pending"),
            "reviewed_by": request_data.get("reviewed_by", ""),
            "reviewed_at": request_data.get("reviewed_at", ""),
            "submitted_by": request_data.get("submitted_by", ""),
        })

        return vac_id
