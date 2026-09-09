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
    bank_name: Optional[str] = Field(None, max_length=100, description="Financial institution name (optional for cash accounts)")
    currency: str = Field("USD", min_length=3, max_length=10, description="ISO Currency code")
    opening_balance: float = Field(0.0, ge=0.0, description="Starting cash balance")
    account_type: str = Field("bank", description="Account type: bank or cash")
    country: Optional[str] = Field("Egypt", description="Country location, e.g. Egypt, US")


class BankAccountCreate(BankAccountBase):
    account_number: str = Field(..., min_length=4, max_length=50, description="Full bank account number")


class BankAccountUpdate(BaseModel):
    account_name: Optional[str] = Field(None, min_length=2, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=100)
    account_number: Optional[str] = Field(None, min_length=4, max_length=50)
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    account_type: Optional[str] = Field(None, description="Account type: bank or cash")
    country: Optional[str] = Field(None, description="Country location")
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
# Category & Payment Type Schemas (Phase 0)
# ==========================================
class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Category name")
    kind: str = Field("other", description="Reporting kind: revenue | cost | transfer | other")
    is_active: bool = Field(True, description="Active status")
    sort_order: int = Field(0, description="Ordering priority")
    is_petty: bool = Field(False, description="Flag for compact recurring/petty view")


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    kind: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    is_petty: Optional[bool] = None


class CategoryResponse(CategoryBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PaymentTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Display name")
    code: str = Field(..., min_length=1, max_length=50, description="Stable machine key e.g. CHK, CASH")
    requires_cheque_number: bool = Field(False, description="Whether a cheque number is required")
    requires_bank_fee_flag: bool = Field(False, description="Whether this payment type flags bank fees")
    is_active: bool = Field(True, description="Active status")


class PaymentTypeCreate(PaymentTypeBase):
    pass


class PaymentTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    requires_cheque_number: Optional[bool] = None
    requires_bank_fee_flag: Optional[bool] = None
    is_active: Optional[bool] = None


class PaymentTypeResponse(PaymentTypeBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Ledger Transaction Schemas (Phase 1 Revision 2)
# ==========================================
class LedgerTransactionBase(BaseModel):
    date: str = Field(..., description="Transaction date (YYYY-MM-DD)")
    amount: float = Field(..., gt=0.0, description="Transaction amount")
    direction: str = Field(..., description="Transaction direction: in or out")
    currency: str = Field("USD", min_length=3, max_length=10, description="Currency code")
    category_id: Optional[int] = Field(None, description="FK to TransactionCategory")
    payment_type_id: Optional[int] = Field(None, description="FK to PaymentType")
    reference: Optional[str] = Field("", max_length=255, description="Reference, e.g. invoice # or note")
    description: Optional[str] = Field("", max_length=255, description="Description / memo")
    fx_rate: Optional[float] = Field(None, description="Applied daily exchange rate if applicable")
    source: str = Field("manual", max_length=50, description="Source")
    linked_invoice_id: Optional[int] = None
    linked_bill_id: Optional[int] = None


class LedgerTransactionCreate(LedgerTransactionBase):
    category: Optional[str] = None  # Backwards compatibility string fallback


class LedgerTransactionResponse(LedgerTransactionBase):
    id: int
    account_id: int
    running_balance: float
    category_name: Optional[str] = None
    payment_type_code: Optional[str] = None
    payment_type_name: Optional[str] = None
    fx_equivalent: Optional[float] = None
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None

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
# Bill Line Schemas (Accounts Payable)
# ==========================================
class BillLineBase(BaseModel):
    description: str = Field(..., min_length=1, max_length=255)
    quantity: float = Field(1.0, gt=0.0)
    unit_price: float = Field(0.0, ge=0.0)
    line_total: float = Field(0.0, ge=0.0)


class BillLineCreate(BillLineBase):
    pass


class BillLineResponse(BillLineBase):
    id: int
    bill_id: int

    class Config:
        from_attributes = True


# ==========================================
# Bill Schemas (Accounts Payable)
# ==========================================
class BillBase(BaseModel):
    vendor_id: int = Field(..., description="ID of the vendor")
    bill_number: str = Field(..., min_length=1, max_length=50, description="Unique bill reference number")
    category: Optional[str] = Field("Operating Expense", max_length=100)
    issue_date: str = Field(..., description="Date issued (YYYY-MM-DD)")
    due_date: str = Field(..., description="Payment due date (YYYY-MM-DD)")
    status: str = Field("unpaid", description="unpaid|paid|overdue|void")
    currency: str = Field("USD", min_length=3, max_length=10)
    notes: Optional[str] = None


class BillCreate(BillBase):
    lines: List[BillLineCreate] = Field(default_factory=list)


class BillUpdate(BaseModel):
    vendor_id: Optional[int] = None
    category: Optional[str] = Field(None, max_length=100)
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    notes: Optional[str] = None
    lines: Optional[List[BillLineCreate]] = None


class BillResponse(BillBase):
    id: int
    subtotal: float
    tax_amount: float
    total: float
    created_at: Optional[datetime] = None
    vendor_name: Optional[str] = None
    lines: List[BillLineResponse] = []

    class Config:
        from_attributes = True


# ==========================================
# Payment Schemas (incoming for invoices, outgoing for bills)
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
