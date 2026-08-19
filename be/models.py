"""
models.py
Pydantic request/response models for the HRFlow API.
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, Literal

# Allowed values for an employee's employment state (single source of truth
# shared by EmployeeCreate / EmployeeUpdate).
EmploymentState = Literal["Full-Time", "Part-Time", "Freelance", "Occasional"]


class GoogleLoginRequest(BaseModel):
    credential: str


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    """
    Note: this no longer carries a `token` field. The session token is set
    directly as an HttpOnly cookie by the /api/auth/google endpoint and is
    never exposed to JavaScript in the response body (see docs/analysis/
    security-analysis-plan.md, Phase 1 - SEC-01 / SEC-04).
    """
    role: str
    employee_id: Optional[int] = None
    name: Optional[str] = None


class EmployeeCreate(BaseModel):
    """
    Salary is modeled as two USD-denominated components (see docs/analysis/
    salary-advanced-plan.md, Phase 1):
    - internal_salary_usd: paid within Egypt.
    - external_salary_usd: paid directly from the USA.
    Both are required (no defaults) - 0 is a valid explicit value for an
    employee who is 100% one or the other, but the field must be present.
    There is no flat `salary` field on create anymore; any legacy total
    shown elsewhere in the app is derived server-side as the sum of the
    two components.
    """
    name: str
    email: EmailStr
    dept: str = ""
    job_role: str = ""
    internal_salary_usd: float
    external_salary_usd: float
    join_date: str = ""
    status: str = "Active"
    vac_total: int = 21
    next_raise: str = ""
    employment_state: EmploymentState = "Full-Time"


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    dept: Optional[str] = None
    job_role: Optional[str] = None
    internal_salary_usd: Optional[float] = None
    external_salary_usd: Optional[float] = None
    join_date: Optional[str] = None
    status: Optional[str] = None
    vac_total: Optional[int] = None
    vac_used: Optional[int] = None
    next_raise: Optional[str] = None
    employment_state: Optional[EmploymentState] = None


class RequestCreate(BaseModel):
    employee_name: str
    type: Literal["Vacation", "Work From Home", "Medical Insurance"]
    details: str = ""
    employee_id: Optional[int] = None
    record_date: Optional[str] = None
    status: Optional[Literal["Approved", "Rejected", "Pending"]] = None


class RequestAction(BaseModel):
    status: Literal["Approved", "Rejected"]


class VacationRequestCreate(BaseModel):
    employee_name: str
    leave_type: str = "Annual Leave"
    start_date: str
    end_date: Optional[str] = None
    days: int = 1
    employee_id: Optional[int] = None
    record_date: Optional[str] = None
    status: Optional[Literal["Approved", "Rejected", "Pending"]] = None


class InsuranceCategoryCreate(BaseModel):
    name: str
    annual_limit: float


class InsuranceCategoryUpdate(BaseModel):
    name: Optional[str] = None
    annual_limit: Optional[float] = None


class InsuranceClaimCreate(BaseModel):
    employee_name: str
    category: str
    provider: str = ""
    amount: float
    document_url: Optional[str] = ""
    employee_id: Optional[int] = None
    record_date: Optional[str] = None
    status: Optional[Literal["Approved", "Rejected", "Pending"]] = None


class InsuranceClaimAction(BaseModel):
    status: Literal["Approved", "Rejected"]


class RaiseApply(BaseModel):
    """
    A raise can change one component or both in a single call (see
    docs/analysis/salary-advanced-plan.md - "RaiseApply model changes").

    Validation (enforced in the endpoint, not just here, since the
    "required when" logic is conditional on other fields):
    - target in ("internal", "external"): `value` is required;
      internal_value/external_value must be omitted.
    - target == "both" and mode in ("pct", "amount"): `value` is required
      (applied independently to each component); internal_value/
      external_value must be omitted.
    - target == "both" and mode == "new": both internal_value and
      external_value are required explicitly (0 is valid, must be
      present); `value` must be omitted. The resulting total is always
      derived as internal_value + external_value, never supplied directly.
    """
    employee_id: int
    mode: Literal["pct", "amount", "new"]
    target: Literal["internal", "external", "both"] = "both"
    value: Optional[float] = None
    internal_value: Optional[float] = None
    external_value: Optional[float] = None
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"


class EmployeeNoteCreate(BaseModel):
    date: Optional[str] = None
    category: str = "General"
    note: str


class EmployeeDocumentCreate(BaseModel):
    name: str
    file_type: Literal["pdf", "image"]
    data_url: str


class CompanyDocumentCreate(BaseModel):
    """
    A general company-wide document/policy visible to all employees
    (Document Hub). Stored in a shared "Company Documents" Drive
    sub-folder, not tied to any specific employee. Admins may add/delete;
    all employees may view/download.
    """
    name: str
    file_type: Literal["pdf", "image"]
    data_url: str
    category: str = "General"
