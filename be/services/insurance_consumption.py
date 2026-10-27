"""
be/services/insurance_consumption.py
Insurance limit consumption per employee and category (pure functions, no storage access).
Moved here from the removed Sheets repository (CLEAN-1); the SQL repository and the insurance router call it.
"""

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
