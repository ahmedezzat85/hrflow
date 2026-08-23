"""
be/repositories/sheets/insurance.py
Sheets-backed implementation of InsuranceRepository.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any, Union

import sheets_client

APPROACHING_THRESHOLD_PCT = 80


def _clean_amount(val) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    cleaned = str(val).replace("EGP", "").replace("$", "").replace(",", "").strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return 0.0


def _normalize_claim_record(c: dict) -> dict:
    if not isinstance(c, dict):
        return c
    normalized = dict(c)
    category = normalized.get("category") or normalized.get("Category") or ""
    provider = normalized.get("provider") or normalized.get("Provider") or ""
    amount = _clean_amount(normalized.get("amount") if normalized.get("amount") is not None else normalized.get("Amount"))
    date = normalized.get("date") or normalized.get("Date") or ""
    status = normalized.get("status") or normalized.get("Status") or "Pending"
    emp_id = (
        normalized.get("employee_id")
        if normalized.get("employee_id") is not None
        else normalized.get("Employee_Id") or normalized.get("Employee ID") or normalized.get("employeeId")
    )
    emp_name = normalized.get("employee_name") or normalized.get("Employee_Name") or normalized.get("Employee Name") or ""
    doc_url = normalized.get("document_url") or normalized.get("Document_Url") or normalized.get("Document URL") or ""
    claim_id = normalized.get("id") or normalized.get("ID") or normalized.get("Id")

    return {
        "id": int(claim_id) if claim_id is not None and str(claim_id).isdigit() else (claim_id or 0),
        "employee_id": int(emp_id) if emp_id is not None and str(emp_id).isdigit() else emp_id,
        "employee_name": str(emp_name or ""),
        "category": str(category or "").strip(),
        "provider": str(provider or "").strip(),
        "amount": amount,
        "date": str(date or ""),
        "status": str(status or "Pending").strip(),
        "document_url": str(doc_url or ""),
        "submitted_by": str(normalized.get("submitted_by") or normalized.get("Submitted_By") or ""),
    }


def _normalize_category_record(cat: dict) -> dict:
    if not isinstance(cat, dict):
        return cat
    cat_id = cat.get("id") or cat.get("ID") or cat.get("Id")
    name = cat.get("name") or cat.get("Name") or cat.get("category") or cat.get("Category") or ""
    limit = _clean_amount(
        cat.get("annual_limit")
        if cat.get("annual_limit") is not None
        else cat.get("Annual_Limit") or cat.get("Annual Limit") or cat.get("limit") or cat.get("Limit") or 0
    )
    return {
        "id": int(cat_id) if cat_id is not None and str(cat_id).isdigit() else (cat_id or 0),
        "name": str(name or "").strip(),
        "annual_limit": limit,
    }


def compute_consumption(employees, categories, claims):
    categories = [_normalize_category_record(c) for c in categories]
    claims = [_normalize_claim_record(c) for c in claims]
    approved_claims = [c for c in claims if str(c.get("status", "")).strip().lower() == "approved"]
    results = []
    for emp in employees:
        emp_id = emp["id"]
        emp_name = str(emp.get("name") or "").strip().lower()
        emp_claims = [
            c for c in approved_claims
            if (c.get("employee_id") is not None and str(c.get("employee_id")).strip() == str(emp_id).strip())
            or (emp_name and str(c.get("employee_name") or "").strip().lower() == emp_name)
        ]
        cat_results = []
        total_limit = 0.0
        total_consumed = 0.0
        for cat in categories:
            limit = _clean_amount(cat.get("annual_limit") or 0)
            cat_name_clean = str(cat.get("name") or "").strip().lower()
            consumed = sum(
                _clean_amount(c.get("amount") or 0)
                for c in emp_claims
                if cat_name_clean and str(c.get("category") or "").strip().lower() == cat_name_clean
            )
            remaining = max(limit - consumed, 0)
            pct_used = round((consumed / limit) * 100, 1) if limit > 0 else 0
            if limit > 0 and consumed >= limit:
                status = "limit_reached"
            elif limit > 0 and pct_used >= APPROACHING_THRESHOLD_PCT:
                status = "approaching"
            else:
                status = "ok"
            cat_results.append({
                "category_id": cat["id"], "category": cat["name"], "limit": limit, "consumed": consumed,
                "remaining": remaining, "pct_used": pct_used, "status": status,
            })
            total_limit += limit
            total_consumed += consumed
        total_pct = round((total_consumed / total_limit) * 100, 1) if total_limit > 0 else 0
        if total_limit > 0 and total_consumed >= total_limit:
            total_status = "limit_reached"
        elif total_limit > 0 and total_pct >= APPROACHING_THRESHOLD_PCT:
            total_status = "approaching"
        else:
            total_status = "ok"
        results.append({
            "employee_id": emp_id, "employee_name": emp.get("name", ""), "categories": cat_results,
            "total_limit": total_limit, "total_consumed": total_consumed,
            "total_remaining": max(total_limit - total_consumed, 0),
            "total_pct_used": total_pct, "total_status": total_status,
        })
    return results


class SheetsInsuranceRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def list_categories(self) -> List[Dict[str, Any]]:
        categories = self.client.get_all_records("InsuranceCategories")
        return [_normalize_category_record(c) for c in categories]

    def get_category_by_id(self, cat_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        categories = self.client.get_all_records("InsuranceCategories")
        record = next((c for c in categories if str(c.get("id")) == str(cat_id)), None)
        return _normalize_category_record(record) if record else None

    def get_category_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        name_clean = name.strip().lower()
        categories = self.client.get_all_records("InsuranceCategories")
        record = next((c for c in categories if str(c.get("name", "")).strip().lower() == name_clean), None)
        return _normalize_category_record(record) if record else None

    def create_category(self, name: str, annual_limit: float) -> int:
        if self.get_category_by_name(name):
            raise ValueError("A category with this name already exists")
        new_id = self.client.next_id("InsuranceCategories")
        self.client.append_row("InsuranceCategories", {
            "id": new_id,
            "name": name,
            "annual_limit": annual_limit,
        })
        return new_id

    def update_category(self, cat_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        return self.client.update_row_by_match("InsuranceCategories", "id", cat_id, updates)

    def delete_category(self, cat_id: Union[int, str]) -> bool:
        return self.client.delete_row_by_match("InsuranceCategories", "id", cat_id)

    def list_claims(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        claims = self.client.get_all_records("InsuranceClaims")
        claims = [_normalize_claim_record(c) for c in claims]
        if scoped_employee_id is not None:
            claims = [c for c in claims if str(c.get("employee_id")) == str(scoped_employee_id)]
        return claims

    def get_claim_by_id(self, claim_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        claims = self.client.get_all_records("InsuranceClaims")
        claim = next((c for c in claims if str(c.get("id")) == str(claim_id)), None)
        return _normalize_claim_record(claim) if claim else None

    def create_claim(
        self,
        claim_data: Dict[str, Any],
        request_data: Optional[Dict[str, Any]] = None,
    ) -> int:
        claim_id = self.client.next_id("InsuranceClaims")
        self.client.append_row("InsuranceClaims", {
            "id": claim_id,
            "employee_id": claim_data.get("employee_id"),
            "employee_name": claim_data.get("employee_name", ""),
            "category": claim_data.get("category"),
            "provider": claim_data.get("provider", ""),
            "amount": claim_data.get("amount", 0.0),
            "date": claim_data.get("date"),
            "status": claim_data.get("status", "Pending"),
            "document_url": claim_data.get("document_url") or "",
            "submitted_by": claim_data.get("submitted_by", ""),
        })

        if request_data:
            req_id = self.client.next_id("Requests")
            self.client.append_row("Requests", {
                "id": req_id,
                "employee_id": request_data.get("employee_id"),
                "employee_name": request_data.get("employee_name", ""),
                "type": "Medical Insurance",
                "details": request_data.get("details", ""),
                "date": request_data.get("date"),
                "status": request_data.get("status", "Pending"),
                "reviewed_by": request_data.get("reviewed_by", ""),
                "reviewed_at": request_data.get("reviewed_at", ""),
                "submitted_by": request_data.get("submitted_by", ""),
            })

        return claim_id

    def action_claim(self, claim_id: Union[int, str], status: str, reviewer_email: str) -> bool:
        claims = self.client.get_all_records("InsuranceClaims")
        claim = next((c for c in claims if str(c.get("id")) == str(claim_id)), None)
        if not claim:
            return False

        ok = self.client.update_row_by_match("InsuranceClaims", "id", claim_id, {"status": status})
        if not ok:
            return False

        reqs = self.client.get_all_records("Requests")
        emp_reqs = [
            r for r in reqs
            if str(r.get("employee_id")) == str(claim.get("employee_id")) and r.get("type") == "Medical Insurance"
        ]
        matched_req = next(
            (r for r in emp_reqs if r.get("status") != status and str(r.get("date")) == str(claim.get("date"))),
            None
        )
        if not matched_req:
            pending_reqs = [r for r in emp_reqs if r.get("status") == "Pending"]
            if len(pending_reqs) == 1:
                matched_req = pending_reqs[0]
        if matched_req:
            self.client.update_row_by_match("Requests", "id", matched_req["id"], {
                "status": status,
                "reviewed_by": reviewer_email,
                "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
            })

        return True

    def get_consumption(self, scoped_employee_id: Optional[Union[int, str]] = None) -> List[Dict[str, Any]]:
        employees = self.client.get_all_records("Employees")
        categories = self.client.get_all_records("InsuranceCategories")
        claims = self.client.get_all_records("InsuranceClaims")

        if scoped_employee_id is not None:
            employees = [e for e in employees if str(e.get("id")) == str(scoped_employee_id)]

        return compute_consumption(employees, categories, claims)
