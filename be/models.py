"""
models.py
Pydantic request/response models for the HRFlow API.
FastAPI uses these for automatic validation, and auto-generates
interactive docs (Swagger UI at /docs) from them.
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, Literal

EmploymentState = Literal["Full-Time", "Part-Time", "Freelance", "Occasional"]


class GoogleLoginRequest(BaseModel):
    credential: str


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    role: str
    employee_id: Optional[int] = None
    name: Optional[str] = None


class EmployeeCreate(BaseModel):
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
    raise sets BOTH components to their new absolute values directly;
    the increase amount and percentage (over the combined total) are
    always derived automatically, never supplied by the caller. See
    docs/analysis/salary-advanced-plan.md (Phase 1, revised) for the
    full design rationale.

    Both fields are required with no default - 0 is a valid explicit
    value, but each must be stated so a raise can never accidentally
    zero out a component the admin forgot to include.
    """
    employee_id: int
    new_internal_usd: float
    new_external_usd: float
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"
