"""
main.py
HRFlow backend - FastAPI REST API backed entirely by a Google Sheet.
Authentication is "Sign in with Google" ONLY - no passwords anywhere.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload --host 0.0.0.0 --port 5000

Interactive API docs auto-generated at:
    http://localhost:5000/docs   (Swagger UI)
    http://localhost:5000/redoc  (ReDoc)
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
    InsuranceClaimCreate, InsuranceClaimAction, RaiseApply,
)

app = FastAPI(title="HRFlow API", version="2.0.0",
              description="HR Management System backend - Google Sheets database, Sign in with Google authentication only.")

origins = ["*"] if Config.ALLOWED_ORIGINS == "*" else Config.ALLOWED_ORIGINS.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# AUTH - Sign in with Google only
# =========================================================
@app.post("/api/auth/google", response_model=LoginResponse, tags=["Auth"])
def api_google_login(payload: GoogleLoginRequest):
    """
    Frontend sends the Google ID token (`credential`) obtained from the
    Google Sign-In button. We verify it, enforce the Workspace domain
    restriction, and - if the email matches a row in the Users tab -
    issue our own short-lived session token.
    """
    result = login_with_google(payload.credential)
    if not result:
        raise HTTPException(
            status_code=403,
            detail="This Google account is not registered in HRFlow. Ask your HR admin to add you as an employee first.",
        )
    return result


@app.post("/api/auth/login", response_model=LoginResponse, tags=["Auth"])
def api_password_login(payload: PasswordLoginRequest):
    """
    DUMMY / TEST-ONLY login path (email + a single shared test password).
    Exists purely so the app is usable before Google OAuth is fully
    configured, or for quick local demos. See auth.py TEST_PASSWORD.
    Not intended for production use - prefer /api/auth/google.
    """
    result = login_with_password(payload.email, payload.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return result


# =========================================================
# EMPLOYEES  (Admin: full CRUD, Employee: read-only self)
# =========================================================
@app.get("/api/employees", tags=["Employees"])
def get_employees(current_user: dict = Depends(get_current_user)):
    client = get_client()
    employees = client.get_all_records("Employees")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        employees = [e for e in employees if str(e["id"]) == my_id]
    return employees


@app.post("/api/employees", status_code=201, tags=["Employees"])
def create_employee(payload: EmployeeCreate, current_user: dict = Depends(require_admin)):
    """
    Admin adds a new employee. Since login is Google-only, there is no
    password to set here - the employee simply signs in with their
    existing Google Workspace account once this record (and the mirrored
    Users row) exists.
    """
    client = get_client()
    new_id = client.next_id("Employees")

    employee_row = {
        "id": new_id,
        "name": payload.name,
        "email": payload.email,
        "role": "employee",
        "dept": payload.dept,
        "job_role": payload.job_role,
        "salary": payload.salary,
        "join_date": payload.join_date,
        "status": payload.status,
        "vac_total": payload.vac_total,
        "vac_used": 0,
        "next_raise": payload.next_raise,
    }
    client.append_row("Employees", employee_row)

    # Mirror into Users tab so their Google account maps to this employee
    client.append_row("Users", {
        "email": payload.email,
        "role": "employee",
        "employee_id": new_id,
    })
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


# =========================================================
# REQUESTS  (Vacation / WFH / Medical Insurance pending workflow)
# =========================================================
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
    client = get_client()
    new_id = client.next_id("Requests")
    row = {
        "id": new_id,
        "employee_id": current_user["employee_id"],
        "employee_name": payload.employee_name,
        "type": payload.type,
        "details": payload.details,
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "status": "Pending",
        "reviewed_by": "",
        "reviewed_at": "",
    }
    client.append_row("Requests", row)
    return {"message": "Request submitted", "id": new_id}


@app.post("/api/requests/{req_id}/action", tags=["Requests"])
def action_request(req_id: int, payload: RequestAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("Requests", "id", req_id, {
        "status": payload.status,
        "reviewed_by": current_user["email"],
        "reviewed_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
    })
    if not ok:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"message": f"Request {payload.status.lower()}"}


# =========================================================
# VACATIONS
# =========================================================
@app.get("/api/vacations/history", tags=["Vacations"])
def get_vacation_history(current_user: dict = Depends(get_current_user)):
    client = get_client()
    history = client.get_all_records("VacationHistory")
    if current_user["role"] != "admin":
        my_id = str(current_user["employee_id"])
        history = [h for h in history if str(h["employee_id"]) == my_id]
    return history


@app.post("/api/vacations/request", status_code=201, tags=["Vacations"])
def request_vacation(payload: VacationRequestCreate, current_user: dict = Depends(get_current_user)):
    """Employee submits a leave request - creates both a VacationHistory row
    and a mirrored Requests row (status=Pending) for admin approval."""
    client = get_client()
    emp_id = current_user["employee_id"]
    end_date = payload.end_date or payload.start_date

    vac_id = client.next_id("VacationHistory")
    client.append_row("VacationHistory", {
        "id": vac_id,
        "employee_id": emp_id,
        "type": payload.leave_type,
        "start_date": payload.start_date,
        "end_date": end_date,
        "days": payload.days,
        "status": "Pending",
    })

    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id,
        "employee_id": emp_id,
        "employee_name": payload.employee_name,
        "type": "Vacation",
        "details": f"{payload.leave_type}: {payload.start_date} to {end_date}",
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "status": "Pending",
        "reviewed_by": "",
        "reviewed_at": "",
    })
    return {"message": "Vacation request submitted", "id": vac_id}


# =========================================================
# MEDICAL INSURANCE CLAIMS
# =========================================================
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
    client = get_client()
    emp_id = current_user["employee_id"]
    claim_id = client.next_id("InsuranceClaims")
    client.append_row("InsuranceClaims", {
        "id": claim_id,
        "employee_id": emp_id,
        "employee_name": payload.employee_name,
        "claim_type": payload.claim_type,
        "provider": payload.provider,
        "amount": payload.amount,
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "status": "Pending",
    })

    req_id = client.next_id("Requests")
    client.append_row("Requests", {
        "id": req_id,
        "employee_id": emp_id,
        "employee_name": payload.employee_name,
        "type": "Medical Insurance",
        "details": f"{payload.claim_type} claim - EGP {payload.amount}",
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "status": "Pending",
        "reviewed_by": "",
        "reviewed_at": "",
    })
    return {"message": "Claim submitted", "id": claim_id}


@app.post("/api/insurance/claims/{claim_id}/action", tags=["Insurance"])
def action_insurance_claim(claim_id: int, payload: InsuranceClaimAction, current_user: dict = Depends(require_admin)):
    client = get_client()
    ok = client.update_row_by_match("InsuranceClaims", "id", claim_id, {"status": payload.status})
    if not ok:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {"message": f"Claim {payload.status.lower()}"}


# =========================================================
# SALARY & RAISES
# =========================================================
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
    """Admin applies a raise to one employee: percentage, flat amount, or a direct new salary."""
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
    else:  # "new"
        new_salary = round(payload.value, 2)

    if new_salary <= 0:
        raise HTTPException(status_code=400, detail="Resulting salary must be positive")

    pct_change = round((new_salary - current_salary) / current_salary * 100, 2)
    effective_date = payload.effective_date or datetime.utcnow().strftime("%Y-%m-%d")

    history_id = client.next_id("SalaryHistory")
    client.append_row("SalaryHistory", {
        "id": history_id,
        "employee_id": emp["id"],
        "date": effective_date,
        "previous_salary": current_salary,
        "new_salary": new_salary,
        "pct_change": f"{'+' if pct_change >= 0 else ''}{pct_change}%",
        "reason": payload.reason,
        "applied_by": current_user["email"],
    })

    next_raise_date = (datetime.strptime(effective_date, "%Y-%m-%d") + timedelta(days=365)).strftime("%Y-%m-%d")
    client.update_row_by_match("Employees", "id", emp["id"], {
        "salary": new_salary,
        "next_raise": next_raise_date,
    })

    return {
        "message": "Raise applied",
        "previous_salary": current_salary,
        "new_salary": new_salary,
        "pct_change": pct_change,
    }


# =========================================================
# HEALTH CHECK
# =========================================================
@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
