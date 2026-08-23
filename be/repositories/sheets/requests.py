"""
be/repositories/sheets/requests.py
Sheets-backed implementation of RequestRepository.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

import sheets_client


class SheetsRequestRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def list_requests(
        self,
        type_filter: Optional[str] = None,
        scoped_employee_id: Optional[Union[int, str]] = None,
    ) -> List[Dict[str, Any]]:
        reqs = self.client.get_all_records("Requests")
        if scoped_employee_id is not None:
            reqs = [r for r in reqs if str(r.get("employee_id")) == str(scoped_employee_id)]
        if type_filter and type_filter != "all":
            reqs = [r for r in reqs if r.get("type") == type_filter]
        return reqs

    def get_by_id(self, req_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        reqs = self.client.get_all_records("Requests")
        return next((r for r in reqs if str(r.get("id")) == str(req_id)), None)

    def create(self, data: Dict[str, Any]) -> int:
        new_id = self.client.next_id("Requests")
        self.client.append_row("Requests", {
            "id": new_id,
            "employee_id": data.get("employee_id"),
            "employee_name": data.get("employee_name", ""),
            "type": data.get("type"),
            "details": data.get("details", ""),
            "date": data.get("date"),
            "status": data.get("status", "Pending"),
            "reviewed_by": data.get("reviewed_by", ""),
            "reviewed_at": data.get("reviewed_at", ""),
            "submitted_by": data.get("submitted_by", ""),
        })
        return new_id

    def action_request(self, req_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        reqs = self.client.get_all_records("Requests")
        req = next((r for r in reqs if str(r.get("id")) == str(req_id)), None)
        if not req:
            return False

        ok = self.client.update_row_by_match("Requests", "id", req_id, {
            "status": status,
            "reviewed_by": reviewer_email,
            "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
        })
        if not ok:
            return False

        emp_id = req.get("employee_id")
        req_type = req.get("type")
        req_date = req.get("date")

        if req_type == "Medical Insurance":
            claims = self.client.get_all_records("InsuranceClaims")
            emp_claims = [c for c in claims if str(c.get("employee_id")) == str(emp_id)]
            matched_claim = next(
                (c for c in emp_claims if str(c.get("date")) == str(req_date) and c.get("status") != status),
                None
            )
            if not matched_claim:
                pending_claims = [c for c in emp_claims if c.get("status") == "Pending"]
                if len(pending_claims) == 1:
                    matched_claim = pending_claims[0]
            if matched_claim:
                self.client.update_row_by_match("InsuranceClaims", "id", matched_claim["id"], {"status": status})

        elif req_type == "Vacation":
            vols = self.client.get_all_records("VacationHistory")
            emp_vacs = [v for v in vols if str(v.get("employee_id")) == str(emp_id)]
            matched_vac = next(
                (v for v in emp_vacs if v.get("status") != status and str(v.get("start_date")) in str(req.get("details"))),
                None
            )
            if not matched_vac:
                pending_vacs = [v for v in emp_vacs if v.get("status") == "Pending"]
                if len(pending_vacs) == 1:
                    matched_vac = pending_vacs[0]
            if matched_vac:
                self.client.update_row_by_match("VacationHistory", "id", matched_vac["id"], {"status": status})

        return True
