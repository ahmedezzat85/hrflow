"""
models.py
Pydantic request/response models for the HRFlow API.
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, Literal


class GoogleLoginRequest(BaseModel):
    credential: str


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str
    employee_id: Optional[int] = None
    name: Optional[str] = None


class EmployeeCreate(BaseModel):
    name: str
    email: EmailStr
    dept: str = ""
    job_role: str = ""
    salary: float = 0
    join_date: str = ""
    status: str = "Active"
    vac_total: int = 21
    next_raise: str = ""


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    dept: Optional[str] = None
    job_role: Optional[str] = None
    salary: Optional[float] = None
    join_date: Optional[str] = None
    status: Optional[str] = None
    vac_total: Optional[int] = None
    vac_used: Optional[int] = None
    next_raise: Optional[str] = None


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
    employee_id: int
    mode: Literal["pct", "amount", "new"]
    value: float
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"


class EmployeeNoteCreate(BaseModel):
    date: Optional[str] = None
    category: str = "General"
    note: str
