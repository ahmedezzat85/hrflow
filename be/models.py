"""
models.py
Pydantic request/response models for the HRFlow API.
"""
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, Literal, List, Union

from services.employee_personal import normalize_id, normalize_phone

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
    employee_id: Optional[int] = None
    name: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    portal: str = "employee"
    roles: List[str] = Field(default_factory=list)


class EmployeeCreate(BaseModel):
    """
    Pay is not part of creating an employee (D-035): set it afterwards through the Pay plan
    (PUT /api/finance/employees/{id}/compensation-plan). An employee with no plan is valid ("Not set").

    invoice_id (docs/analysis/invoice-autopay-plan.md) is only required at payment-doc generation time, so it
    stays optional here. It must be a two-digit numeric string ("01"-"99") when set, since it is embedded
    directly into the six-digit document number (YY + invoice_id + MM).
    """
    name: str
    email: EmailStr
    dept: str = ""
    job_role: str = ""
    join_date: str = ""
    status: str = "Active"
    vac_total: int = 21
    next_raise: str = ""
    employment_state: EmploymentState = "Full-Time"
    invoice_id: Optional[str] = None
    # Personal details (D-035). Legal name, phone and address line 1 are required for a new employee;
    # the ID is optional. They are stored through the personal-details path, not the profile one.
    legal_name: str
    phone: str
    address_line_1: str
    address_line_2: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None

    @field_validator("name", "legal_name", "address_line_1")
    @classmethod
    def _required_text(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("This field is required")
        return v

    @field_validator("phone")
    @classmethod
    def _phone_valid(cls, v):
        normalized = normalize_phone(v)
        if not normalized:
            raise ValueError("Phone is required")
        return normalized

    @model_validator(mode="after")
    def _id_pair_valid(self):
        self.id_type, self.id_number = normalize_id(self.id_type, self.id_number)
        return self


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    dept: Optional[str] = None
    job_role: Optional[str] = None
    join_date: Optional[str] = None
    status: Optional[str] = None
    vac_total: Optional[int] = None
    vac_used: Optional[int] = None
    next_raise: Optional[str] = None
    employment_state: Optional[EmploymentState] = None
    invoice_id: Optional[str] = None


class EmployeePersonalUpdate(BaseModel):
    """
    Partial update of the personal details (D-035). Only the fields sent change. legal_name, phone and
    address_line_1 cannot be blanked. Sending id_type/id_number both empty clears the ID.
    """
    legal_name: Optional[str] = None
    phone: Optional[str] = None
    address_line_1: Optional[str] = None
    address_line_2: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None

    @field_validator("legal_name", "address_line_1")
    @classmethod
    def _not_blank(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("This field cannot be empty")
        return v

    @field_validator("address_line_2")
    @classmethod
    def _strip_optional(cls, v):
        return None if v is None else v.strip()

    @field_validator("phone")
    @classmethod
    def _phone_valid(cls, v):
        if v is None:
            return v
        normalized = normalize_phone(v)
        if not normalized:
            raise ValueError("Phone cannot be empty")
        return normalized

    @model_validator(mode="after")
    def _id_pair_valid(self):
        if "id_type" in self.model_fields_set or "id_number" in self.model_fields_set:
            self.id_type, self.id_number = normalize_id(self.id_type, self.id_number)
        return self


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
    Redesigned raise model (see docs/analysis/salary-raise-redesign-plan.md):
    every raise always supplies both new absolute USD values directly - no
    percentage/flat-amount modes and no internal/external/both target
    selector anymore. 0 is a valid explicit value for either component (an
    employee who is 100% one component still states the other as 0), but
    both fields must always be present.
    """
    employee_id: int
    new_internal_salary_usd: float
    new_external_salary_usd: float
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


class SalaryPaymentDocGenerateRequest(BaseModel):
    """
    Request body for bulk/per-employee external-salary payment document generation
    (docs/analysis/invoice-autopay-plan.md). payment_year/payment_month
    identify the period being invoiced (not the generation date, which is
    always "now"). skip_existing defaults to True so a repeated click never
    silently overwrites a previously generated document for the same
    employee + period - the caller gets back the existing record instead.
    """
    payment_year: int
    payment_month: int = Field(ge=1, le=12)
    skip_existing: bool = True

# Backward compatibility alias
InvoiceGenerateRequest = SalaryPaymentDocGenerateRequest


class EmployeeBankAccountUpsert(BaseModel):
    """
    Create or update an employee's personal external bank account details.
    bank_name and iban are required; swift_code is optional.
    Stored in employee_bank_accounts table, separate from the
    core Employees table so sensitive financial data is logically isolated.
    """
    bank_name: str
    iban: str
    swift_code: Optional[str] = None

# Backward compatibility alias
BankAccountUpsert = EmployeeBankAccountUpsert


class SheetsExportRequest(BaseModel):
    """Request payload for exporting HR data to Google Sheets."""
    year: Optional[int] = None
    month: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    worksheet_title: Optional[str] = None


class EmployeeSocialInsuranceUpsert(BaseModel):
    """
    Configure an employee's social insurance coverage flag and insured base.
    """
    insured_flag: bool = False
    insured_base: Optional[float] = None
    currency: str = "EGP"
    effective_start_date: str
    notes: Optional[str] = ""


class EmployeeSocialInsuranceResponse(BaseModel):
    id: int
    employee_id: int
    insured_flag: bool
    insured_base: Optional[float] = None
    currency: str = "EGP"
    effective_start_date: str
    effective_end_date: Optional[str] = None
    notes: str = ""
    created_by: Optional[str] = None
    created_at: Optional[Union[str, datetime]] = None
    updated_at: Optional[Union[str, datetime]] = None

    class Config:
        from_attributes = True


