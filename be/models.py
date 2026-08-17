"""
models.py
Pydantic request/response models for the HRFlow API.
FastAPI uses these for automatic validation, and auto-generates
interactive docs (Swagger UI at /docs) from them.
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, Literal

# Allowed values for an employee's employment state (single source of truth
# shared by EmployeeCreate / EmployeeUpdate).
EmploymentState = Literal["Full-Time", "Part-Time", "Freelance", "Occasional"]


class GoogleLoginRequest(BaseModel):
    credential: str  # the ID token JWT string from the Google Sign-In button


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str  # dummy/test-only login - see auth.py TEST_PASSWORD


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
    Salary is modeled as two USD-denominated components rather than a
    single flat figure - see docs/analysis/salary-advanced-plan.md
    (Phase 1). Both are REQUIRED with no default: 0 is a valid explicit
    value (e.g. an employee who is 100% Internal has
    external_salary_usd=0), but the field must always be supplied by the
    caller rather than silently defaulting - this avoids accidentally
    creating an employee with an unintended 0/0 split.
    """
    name: str
    email: EmailStr  # must be the employee's Google Workspace email
    dept: str = ""
    job_role: str = ""
    internal_salary_usd: float  # required, no default - 0 is valid
    external_salary_usd: float  # required, no default - 0 is valid
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
    status: Optional[Literal["Pending", "Approved", "Rejected"]] = None


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
    status: Optional[Literal["Pending", "Approved", "Rejected"]] = None


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
    employee_id: Optional[int] = None
    document_url: Optional[str] = None
    record_date: Optional[str] = None
    status: Optional[Literal["Pending", "Approved", "Rejected"]] = None


class InsuranceClaimAction(BaseModel):
    status: Literal["Approved", "Rejected"]


class EmployeeNoteCreate(BaseModel):
    category: str
    note: str
    date: Optional[str] = None


class EmployeeDocumentCreate(BaseModel):
    name: str
    file_type: Literal["pdf", "image"]
    data_url: str


class CompanyDocumentCreate(BaseModel):
    name: str
    file_type: Literal["pdf", "image"]
    category: str = ""
    data_url: str


class RaiseApply(BaseModel):
    """
    Salary is composed of two USD components - internal (transferred
    inside Egypt) and external (transferred directly from the USA). A
    raise may target one component, or both. See
    docs/analysis/salary-advanced-plan.md (Phase 1) for the full design
    rationale, including why `value` and `internal_value`/`external_value`
    are separate fields rather than one.

    Field usage by (target, mode):
      - target in ("internal", "external"): `value` is required;
        internal_value/external_value must be omitted.
      - target == "both", mode in ("pct", "amount"): `value` is required
        (applied independently to each component); internal_value/
        external_value must be omitted.
      - target == "both", mode == "new": internal_value AND external_value
        are both required explicitly (0 is valid); `value` must be
        omitted. The resulting total is always derived as
        internal_value + external_value - it is never supplied directly.

    All of the above is enforced in the endpoint (be/routers/salary.py),
    not here, since the validity of one field depends on the values of
    others.
    """
    employee_id: int
    mode: Literal["pct", "amount", "new"]
    target: Literal["internal", "external", "both"] = "both"
    value: Optional[float] = None
    internal_value: Optional[float] = None
    external_value: Optional[float] = None
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"
