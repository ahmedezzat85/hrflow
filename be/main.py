"""
main.py
HRFlow backend - FastAPI REST API backed entirely by a Google Sheet.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from config import Config
from sheets_client import get_client
from auth import login_with_google, login_with_password, get_current_user, require_admin
from models import (
    GoogleLoginRequest, PasswordLoginRequest, LoginResponse, EmployeeCreate, EmployeeUpdate,
    RequestCreate, RequestAction, VacationRequestCreate,
    InsuranceCategoryCreate, InsuranceCategoryUpdate,
    InsuranceClaimCreate, InsuranceClaimAction, RaiseApply, EmployeeNoteCreate,
)

app = FastAPI(title="HRFlow API", version="2.3.0",
              description="HR Management System backend - Google Sheets database, Sign in with Google authentication only.")

origins = ["*"] if Config.ALLOWED_ORIGINS == "*" else Config.ALLOWED_ORIGINS.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_target_employee(client, current_user, employee_id, fallback_name):
    """
    Shared helper for admin-on-behalf-of-employee creation across
    requests/vacations/claims. Returns (emp_id, employee_name, submitted_by_admin).
    Non-admins may never pass employee_id; if they try, this raises 403.
    Admin-provided employee_id is resolved against the real Employees sheet
    so the employee's name is never trusted from client input.
    """
    if employee_id is not None:
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only HR admins can submit this on behalf of another employee")
        employees = client.get_all_records("Employees")
        target = next((e for e in employees if str(e["id"]) == str(employee_id)), None)
        if not target:
            raise HTTPException(status_code=404, detail="Employee not found")
        return target["id"], target["name"], True
    return current_user["employee_id"], fallback_name, False


@app.post("/api/auth/google", response_model=LoginResponse, tags=["Auth"])
def api_google_login(payload: GoogleLoginRequest):
    result = login_with_google(payload.credential)
    if not result:
        raise HTTPException(
            status_code=403,
            detail="This Google account is not registered in HRFlow. Ask your HR admin to add you as an employee first.",
        )
    return result


@app.post("/api/auth/login", response_model=LoginResponse, tags=["Auth"])
def api_password_login(payload: PasswordLoginRequest):
    result = login_with_password(payload.email, payload.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return result


@app.get("/api/employees", tags=["Employees"])
def get_employees(current_user: dict = Depends(get_current_user)):
    client = get_client()
    employees = client.get_all_records("Employees")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    return employees


@app.get("/api/employees/{emp_id}", tags=["Employees"])
def get_employee(emp_id: int, current_user: dict = Depends(get_current_user)):
    client = get_client()
    if current_user["role"] != "admin" and str(current_user["employee_id"]) != str(emp_id):
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(emp_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@app.post("/api/employees", status_code=201, tags=["Employees"])
def create_employee(payload: EmployeeCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    new_id = client.next_id("Employees")
    employee_row = {
        "id": new_id, "name": payload.name, "email": payload.email, "role": "employee",
        "dept": payload.dept, "job_role": payload.job_role, "salary": payload.salary,
        "join_date": payload.join_date, "status": payload.status, "vac_total": payload.vac_total,
        "vac_used": 0, "next_raise": payload.next_raise,
    }
    client.append_row("Employees", employee_row)
    client.append_row("Users", {"email": payload.email, "role": "employee", "employee_id": new_id})
    return {"message": "Employee created. They can now sign in with their Google Workspace account.", "id": new_id}


@app.put("/api/employees/{emp_id}", tags=["Employees"])
def update_employee(emp_id: int, payload: EmployeeUpdate, current_user: dict = Depends(require_admin)):
    client = get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("Employees", "id", emp_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee updated"}


@app.delete("/api/employees/{emp_id}", tags=["Employees"])
def delete_employee(emp_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("Employees", "id", emp_id)
    client.delete_row_by_match("Users", "employee_id", emp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee deleted"}


@app.get("/api/employees/{emp_id}/notes", tags=["Employees"])
def get_employee_notes(emp_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    notes = client.get_all_records("EmployeeNotes")
    notes = [n for n in notes if str(n["employee_id"]) == str(emp_id)]
    notes.sort(key=lambda n: str(n.get("date", "")), reverse=True)
    return notes


@app.post("/api/employees/{emp_id}/notes", status_code=201, tags=["Employees"])
def create_employee_note(emp_id: int, payload: EmployeeNoteCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    employees = client.get_all_records("Employees")
    if not any(str(e["id"]) == str(emp_id) for e in employees):
        raise HTTPException(status_code=404, detail="Employee not found")
    note_id = client.next_id("EmployeeNotes")
    client.append_row("EmployeeNotes", {
        "id": note_id,
        "employee_id": emp_id,
        "date": payload.date or datetime.utcnow().strftime("%Y-%m-%d"),
        "category": payload.category,
        "note": payload.note,
        "created_by": current_user["email"],
    })
    return {"message": "Note added", "id": note_id}


@app.delete("/api/employees/notes/{note_id}", tags=["Employees"])
def delete_employee_note(note_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("EmployeeNotes", "id", note_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


@app.get("/api/requests", tags=["Requests"])
def get_requests(type: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    reqs = client.get_all_records("Requests")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        reqs = [r for r in reqs if str(r["employee_id"]) == my_id]
    if type and type != "all":
        reqs = [r for r in reqs if r["type"] == type]
    return reqs


@app.post("/api/requests", status_code=201, tags=["Requests"])
def create_request(payload: RequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a general request (currently used for Work From Home).
    HR Admins may submit on behalf of another employee via `employee_id`,
    optionally backdating it via `record_date` and/or directly setting
    `status` (e.g. to log an already-approved historical WFH day).
    """
    client = get_client()
    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    new_id = client.next_id("Requests")
    row = {
        "id": new_id, "employee_id": emp_id, "employee_name": employee_name,
        "type": payload.type, "details": payload.details, "date": record_date,
        "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    }
    client.append_row("Requests", row)
    return {"message": "Request submitted", "id": new_id}


@app.post("/api/requests/{req_id}/action", tags=["Requests"])
def action_request(req_id: int, payload: RequestAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("Requests", "id", req_id, {
        "status": payload.status, "reviewed_by": current_user["email"],
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
    })
    if not ok:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"message": f"Request {payload.status.lower()}"}


@app.get("/api/vacations/history", tags=["Vacations"])
def get_vacation_history(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    history = client.get_all_records("VacationHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    elif employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


@app.post("/api/vacations/request", status_code=201, tags=["Vacations"])
def request_vacation(payload: VacationRequestCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a Vacation/leave request. HR Admins may submit on behalf of
    another employee via `employee_id`, optionally backdating the
    submission record via `record_date` and/or directly setting `status`
    (e.g. to log a historical approved leave from a previous year).
    """
    client = get_client()
    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    end_date = payload.end_date or payload.start_date
    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    vac_id = client.next_id("VacationHistory")
    client.append_row("VacationHistory", {
        "id": vac_id, "employee_id": emp_id, "type": payload.leave_type,
        "start_date": payload.start_date, "end_date": end_date, "days": payload.days, "status": status,
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Vacation",
        "details": f"{payload.leave_type}: {payload.start_date} to {end_date}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Vacation request submitted", "id": vac_id}


APPROACHING_THRESHOLD_PCT = 80


def _compute_consumption(employees, categories, claims):
    approved_claims = [c for c in claims if c.get("status") == "Approved"]
    results = []
    for emp in employees:
        emp_id = emp["id"]
        emp_claims = [c for c in approved_claims if str(c.get("employee_id")) == str(emp_id)]
        cat_results = []
        total_limit = 0.0
        total_consumed = 0.0
        for cat in categories:
            limit = float(cat.get("annual_limit") or 0)
            consumed = sum(float(c.get("amount") or 0) for c in emp_claims if c.get("category") == cat["name"])
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
            "employee_id": emp_id, "employee_name": emp["name"], "categories": cat_results,
            "total_limit": total_limit, "total_consumed": total_consumed,
            "total_remaining": max(total_limit - total_consumed, 0),
            "total_pct_used": total_pct, "total_status": total_status,
        })
    return results


@app.get("/api/insurance/categories", tags=["Insurance"])
def get_insurance_categories(current_user: dict = Depends(get_current_user)):
    client = get_client()
    return client.get_all_records("InsuranceCategories")


@app.post("/api/insurance/categories", status_code=201, tags=["Insurance"])
def create_insurance_category(payload: InsuranceCategoryCreate, current_user: dict = Depends(require_admin)):
    client = get_client()
    categories = client.get_all_records("InsuranceCategories")
    if any(c["name"].strip().lower() == payload.name.strip().lower() for c in categories):
        raise HTTPException(status_code=400, detail="A category with this name already exists")
    new_id = client.next_id("InsuranceCategories")
    client.append_row("InsuranceCategories", {"id": new_id, "name": payload.name, "annual_limit": payload.annual_limit})
    return {"message": "Category created", "id": new_id}


@app.put("/api/insurance/categories/{cat_id}", tags=["Insurance"])
def update_insurance_category(cat_id: int, payload: InsuranceCategoryUpdate, current_user: dict = Depends(require_admin)):
    client = get_client()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    ok = client.update_row_by_match("InsuranceCategories", "id", cat_id, updates)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category updated"}


@app.delete("/api/insurance/categories/{cat_id}", tags=["Insurance"])
def delete_insurance_category(cat_id: int, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.delete_row_by_match("InsuranceCategories", "id", cat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category deleted"}


@app.get("/api/insurance/consumption", tags=["Insurance"])
def get_insurance_consumption(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    employees = client.get_all_records("Employees")
    categories = client.get_all_records("InsuranceCategories")
    claims = client.get_all_records("InsuranceClaims")

    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    elif employee_id is not None:
        employees = [e for e in employees if str(e["id"]) == str(employee_id)]

    return _compute_consumption(employees, categories, claims)


@app.get("/api/insurance/claims", tags=["Insurance"])
def get_insurance_claims(current_user: dict = Depends(get_current_user)):
    client = get_client()
    claims = client.get_all_records("InsuranceClaims")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        claims = [c for c in claims if str(c["employee_id"]) == my_id]
    return claims


@app.post("/api/insurance/claims", status_code=201, tags=["Insurance"])
def submit_insurance_claim(payload: InsuranceClaimCreate, current_user: dict = Depends(get_current_user)):
    """
    Submits a medical insurance claim. HR Admins may submit on behalf of
    another employee via `employee_id` (resolved server-side), optionally
    backdating the claim via `record_date` and/or directly setting
    `status` for historical record-keeping.
    """
    client = get_client()
    categories = client.get_all_records("InsuranceCategories")
    if not any(c["name"] == payload.category for c in categories):
        raise HTTPException(status_code=400, detail="Unknown insurance category")

    if payload.document_url and len(payload.document_url) > 3_000_000:
        raise HTTPException(status_code=400, detail="Supporting document is too large")

    emp_id, employee_name, submitted_by_admin = _resolve_target_employee(
        client, current_user, payload.employee_id, payload.employee_name
    )

    record_date = payload.record_date or datetime.utcnow().strftime("%Y-%m-%d")
    status = payload.status if (submitted_by_admin and payload.status) else "Pending"
    reviewed = status != "Pending"

    claim_id = client.next_id("InsuranceClaims")
    client.append_row("InsuranceClaims", {
        "id": claim_id, "employee_id": emp_id, "employee_name": employee_name,
        "category": payload.category, "provider": payload.provider, "amount": payload.amount,
        "date": record_date, "status": status,
        "document_url": payload.document_url or "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })

    detail_suffix = " (submitted by HR admin)" if submitted_by_admin else ""
    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id, "employee_id": emp_id, "employee_name": employee_name, "type": "Medical Insurance",
        "details": f"{payload.category} claim - EGP {payload.amount}{detail_suffix}",
        "date": record_date, "status": status,
        "reviewed_by": current_user["email"] if reviewed else "",
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M") if reviewed else "",
        "submitted_by": current_user["email"] if submitted_by_admin else "",
    })
    return {"message": "Claim submitted", "id": claim_id}


@app.post("/api/insurance/claims/{claim_id}/action", tags=["Insurance"])
def action_insurance_claim(claim_id: int, payload: InsuranceClaimAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("InsuranceClaims", "id", claim_id, {"status": payload.status})
    if not ok:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {"message": f"Claim {payload.status.lower()}"}


@app.get("/api/salary/history", tags=["Salary"])
def get_salary_history(employee_id: Optional[int] = Query(None), current_user: dict = Depends(get_current_user)):
    client = get_client()
    history = client.get_all_records("SalaryHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    if employee_id is not None:
        history = [h for h in history if str(h["employee_id"]) == str(employee_id)]
    return history


@app.post("/api/salary/raise", status_code=201, tags=["Salary"])
def apply_raise(payload: RaiseApply, current_user: dict = Depends(require_admin)):
    """
    Admin applies a raise to one employee: percentage, flat amount, or a
    direct new salary. `effective_date` may be backdated to create a
    historical salary record for a previous year; in that case the
    employee's current salary/next_raise on the Employees sheet are left
    untouched (only a SalaryHistory row is added), so a backdated entry
    never clobbers a more recent real salary.
    """
    client = get_client()
    employees = client.get_all_records("Employees")
    emp = next((e for e in employees if str(e["id"]) == str(payload.employee_id)), None)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_salary = float(emp["salary"])
    if payload.mode == "pct":
        new_salary = round(current_salary * (1 + payload.value / 100), 2)
    elif payload.mode == "amount":
        new_salary = round(current_salary + payload.value, 2)
    else:
        new_salary = round(payload.value, 2)

    if new_salary <= 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_salary - current_salary) / current_salary * 100, 2)
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id, "employee_id": emp["id"], "date": effective_date,
        "previous_salary": current_salary, "new_salary": new_salary,
        "pct_change": f"{'+' if pct_change >= 0 else ''}{pct_change}%",
        "reason": payload.reason, "applied_by": current_user["email"],
    })

    is_backdated = False
    try:
        is_backdated = datetime.strptime(effective_date, "%Y-%m-%d") < (datetime.utcnow() - timedelta(days=1))
    except ValueError:
        pass

    if not is_backdated:
        next_raise_date = (datetime.strptime(effective_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
        client.update_row_by_match("Employees", "id", emp["id"], {
            "salary": new_salary,
            "next_raise": next_raise_date,
        })

    return {"message": "Raise applied", "previous_salary": current_salary, "new_salary": new_salary, "pct_change": pct_change}


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
