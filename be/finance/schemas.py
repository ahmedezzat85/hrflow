"""
be/finance/schemas.py
Pydantic request and response schemas for Finance domain resources.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ==========================================
# Bank Account Schemas
# ==========================================
class BankAccountBase(BaseModel):
    account_name: str = Field(..., min_length=2, max_length=100, description="Friendly name for the account")
    bank_name: str = Field(..., min_length=2, max_length=100, description="Financial institution name")
    currency: str = Field("USD", min_length=3, max_length=10, description="ISO Currency code")
    opening_balance: float = Field(0.0, ge=0.0, description="Starting cash balance")


class BankAccountCreate(BankAccountBase):
    account_number: str = Field(..., min_length=4, max_length=50, description="Full bank account number")


class BankAccountUpdate(BaseModel):
    account_name: Optional[str] = Field(None, min_length=2, max_length=100)
    bank_name: Optional[str] = Field(None, min_length=2, max_length=100)
    account_number: Optional[str] = Field(None, min_length=4, max_length=50)
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    is_active: Optional[bool] = None


class BankAccountResponse(BankAccountBase):
    id: int
    account_number: str = Field(..., description="Masked account number")
    current_balance: float
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Customer Schemas
# ==========================================
class CustomerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Customer or company name")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerResponse(CustomerBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Vendor Schemas
# ==========================================
class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Vendor or supplier name")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field("General", max_length=100)
    notes: Optional[str] = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class VendorResponse(VendorBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Sales Invoice Line Schemas
# ==========================================
class SalesInvoiceLineBase(BaseModel):
    description: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(1.0, gt=0.0)
    unit_price: float = Field(0.0, ge=0.0)
    line_total: float = Field(0.0, ge=0.0)


class SalesInvoiceLineCreate(SalesInvoiceLineBase):
    pass


class SalesInvoiceLineResponse(SalesInvoiceLineBase):
    id: int
    invoice_id: int

    class Config:
        from_attributes = True


# ==========================================
# Sales Invoice Schemas
# ==========================================
class SalesInvoiceBase(BaseModel):
    customer_id: int = Field(..., description="ID of the customer")
    invoice_number: str = Field(..., min_length=1, max_length=50, description="Unique invoice reference number")
    issue_date: str = Field(..., description="Date issued (YYYY-MM-DD)")
    due_date: str = Field(..., description="Payment due date (YYYY-MM-DD)")
    status: str = Field("draft", description="draft|sent|paid|overdue|void")
    currency: str = Field("USD", min_length=3, max_length=10)
    notes: Optional[str] = None


class SalesInvoiceCreate(SalesInvoiceBase):
    lines: List[SalesInvoiceLineCreate] = Field(default_factory=list)


class SalesInvoiceUpdate(BaseModel):
    customer_id: Optional[int] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    notes: Optional[str] = None
    lines: Optional[List[SalesInvoiceLineCreate]] = None


class SalesInvoiceResponse(SalesInvoiceBase):
    id: int
    subtotal: float
    tax_amount: float
    total: float
    created_at: Optional[datetime] = None
    customer_name: Optional[str] = None
    lines: List[SalesInvoiceLineResponse] = []

    class Config:
        from_attributes = True


# ==========================================
# Payment Schemas (incoming for invoices)
# ==========================================
class PaymentBase(BaseModel):
    direction: str = Field(..., description="incoming|outgoing")
    amount: float = Field(..., gt=0.0)
    currency: str = Field("USD", min_length=3, max_length=10)
    payment_date: str = Field(..., description="Payment date (YYYY-MM-DD)")
    bank_account_id: int = Field(..., description="Bank account that received/sent payment")
    method: str = Field("bank_transfer", description="bank_transfer|cash|card|other")
    reference: Optional[str] = Field("", max_length=100)


class PaymentCreate(PaymentBase):
    related_invoice_id: Optional[int] = None
    related_bill_id: Optional[int] = None


class PaymentResponse(PaymentBase):
    id: int
    related_invoice_id: Optional[int] = None
    related_bill_id: Optional[int] = None
    created_at: Optional[datetime] = None
    bank_account_name: Optional[str] = None

    class Config:
        from_attributes = True

