"""
be/analytics/schemas.py
Pydantic schemas for the Employee Pay Analytics endpoint.
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class EmployeeSummary(BaseModel):
    id: int
    name: str
    department: str


class PeriodSummary(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    group_by: str = "month"
    currency: str = "USD"


class PaymentsTotals(BaseModel):
    base_external: float
    base_internal: float
    commission: float
    bonus: float
    total: float
    cycles: int
    buckets_with_commission: int


class PaymentSeriesBucket(BaseModel):
    bucket: str
    label: str
    base_external: float
    base_internal: float
    commission: float
    bonus: float
    total: float
    payment_status: str
    paid_at: Optional[str] = None


class PaymentsSummary(BaseModel):
    totals: PaymentsTotals
    series: List[PaymentSeriesBucket]


class PlanCurrent(BaseModel):
    internal: float
    external: float
    total: float
    effective_date: Optional[str] = None


class PlanChange(BaseModel):
    date: str
    previous_total: float
    new_total: float
    new_internal: float
    new_external: float
    pct_change: str
    reason: str


class PlanSummary(BaseModel):
    current: PlanCurrent
    changes: List[PlanChange]


class EmployeePayViewResponse(BaseModel):
    employee: EmployeeSummary
    period: PeriodSummary
    currencies_available: Optional[List[str]] = Field(default=None, description="Available currencies for non-cancelled runs (only when caller can view payments)")
    payments: Optional[PaymentsSummary] = Field(default=None, description="Payments breakdown (requires finance.report.read)")
    plan: Optional[PlanSummary] = Field(default=None, description="Compensation plan and raise history (requires hr.salary.read)")
    generated_at: str
