"""
be/finance/schemas.py
Pydantic request and response schemas for Finance domain resources.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ==========================================
# Bank Account Schemas
# ==========================================
class BankAccountBase(BaseModel):
    account_name: str = Field(..., min_length=2, max_length=100, description="Friendly name for the account")
    bank_name: Optional[str] = Field(None, max_length=100, description="Financial institution name (optional for cash accounts)")
    currency: str = Field("USD", min_length=3, max_length=10, description="ISO Currency code")
    opening_balance: float = Field(0.0, ge=0.0, description="Starting cash balance")
    opening_balance_date: Optional[str] = Field(None, description="Opening balance date YYYY-MM-DD")
    account_type: str = Field("bank", description="Account type: bank or cash")
    country: Optional[str] = Field("Egypt", description="Country location, e.g. Egypt, US")


class BankAccountCreate(BankAccountBase):
    account_number: str = Field(..., min_length=4, max_length=50, description="Full bank account number")


class BankAccountUpdate(BaseModel):
    account_name: Optional[str] = Field(None, min_length=2, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=100)
    account_number: Optional[str] = Field(None, min_length=4, max_length=50)
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    opening_balance: Optional[float] = Field(None, ge=0.0)
    opening_balance_date: Optional[str] = None
    account_type: Optional[str] = Field(None, description="Account type: bank or cash")
    country: Optional[str] = Field(None, description="Country location")
    is_active: Optional[bool] = None


class BankAccountResponse(BankAccountBase):
    id: int
    account_number: str = Field(..., description="Masked or revealed account number")
    current_balance: float
    is_active: bool
    created_at: Optional[datetime] = None

    # Story 5.1 Balance Separation & Workspace Health
    book_balance: float = 0.0
    bank_balance: Optional[float] = None
    available_balance: float = 0.0
    reconciled_balance: Optional[float] = None
    unreconciled_count: int = 0
    last_reconciled_date: Optional[str] = None
    last_import_date: Optional[str] = None
    has_postings: bool = False
    balance_definitions: Optional[Dict[str, str]] = None
    balance_as_of: Optional[str] = None

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
    entry_type: Optional[str] = Field("standard", description="Guided entry type: standard, money_in, money_out, bank_fee, adjustment")
    counterparty: Optional[str] = Field(None, description="Counterparty name (payer, vendor, client)")
    tax_amount: Optional[float] = Field(0.0, description="Included tax portion")
    base_amount: Optional[float] = Field(None, description="Converted amount in base/account currency")
    reason: Optional[str] = Field(None, description="Explanation or mandatory reason for adjustments")
    reference: Optional[str] = Field("", max_length=255, description="Reference, e.g. invoice # or note")
    description: Optional[str] = Field("", max_length=255, description="Description / memo")
    fx_rate: Optional[float] = Field(None, description="Applied daily exchange rate if applicable")
    source: str = Field("manual", max_length=50, description="Source")
    cheque_number: Optional[str] = None
    linked_invoice_id: Optional[int] = None
    linked_bill_id: Optional[int] = None
    linked_transfer_id: Optional[int] = None
    linked_cheque_id: Optional[int] = None
    destination_cash_account_id: Optional[int] = None


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


class LedgerTransactionUpdate(BaseModel):
    date: Optional[str] = Field(None, description="Transaction date (YYYY-MM-DD)")
    amount: Optional[float] = Field(None, gt=0.0, description="Transaction amount")
    direction: Optional[str] = Field(None, description="Transaction direction: in or out")
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    category_id: Optional[int] = Field(None, description="FK to TransactionCategory")
    payment_type_id: Optional[int] = Field(None, description="FK to PaymentType")
    entry_type: Optional[str] = None
    counterparty: Optional[str] = None
    tax_amount: Optional[float] = None
    base_amount: Optional[float] = None
    reason: Optional[str] = None
    reference: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=255)
    cheque_number: Optional[str] = Field(None, max_length=50)
    destination_cash_account_id: Optional[int] = None
    fx_rate: Optional[float] = None


class TransactionPreviewRequest(BaseModel):
    account_id: int
    entry_type: str = Field("money_out", description="money_in, money_out, bank_fee, adjustment")
    direction: str = Field("out", description="in or out")
    amount: float = Field(..., gt=0.0)
    currency: str = Field("USD")
    fx_rate: Optional[float] = None
    category_id: Optional[int] = None
    counterparty: Optional[str] = None
    reason: Optional[str] = None


class TransactionPreviewResponse(BaseModel):
    account_id: int
    account_name: str
    account_currency: str
    entry_type: str
    direction: str
    transaction_amount: float
    transaction_currency: str
    fx_rate: Optional[float] = None
    converted_amount: float
    current_book_balance: float
    projected_book_balance: float
    plain_description: str
    journal_preview: List[dict]



class PettySummaryItem(BaseModel):
    category_id: int
    category_name: str
    count: int
    total_in: float
    total_out: float
    net_amount: float


class PettySummaryResponse(BaseModel):
    account_id: int
    account_name: str
    currency: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    total_in: float
    total_out: float
    net_amount: float
    by_category: List[PettySummaryItem] = []
    transactions: List[LedgerTransactionResponse] = []


# ==========================================
# Customer Schemas
# ==========================================
class CustomerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Customer or company display name")
    legal_name: Optional[str] = Field(None, max_length=255, description="Registered legal name")
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    billing_address: Optional[str] = None
    country: Optional[str] = Field("Egypt", max_length=100)
    default_currency: Optional[str] = Field("USD", max_length=10)
    payment_terms_days: Optional[int] = Field(30, ge=0)
    owner: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    legal_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    billing_address: Optional[str] = None
    country: Optional[str] = Field(None, max_length=100)
    default_currency: Optional[str] = Field(None, max_length=10)
    payment_terms_days: Optional[int] = Field(None, ge=0)
    owner: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerResponse(CustomerBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerDuplicateCheckRequest(BaseModel):
    name: Optional[str] = None
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    contact_email: Optional[str] = None
    exclude_id: Optional[int] = None


class CustomerDuplicateCandidate(BaseModel):
    id: int
    name: str
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    contact_email: Optional[str] = None
    matched_field: str
    is_active: bool


class Customer360Summary(BaseModel):
    customer: CustomerResponse
    total_invoiced: float = 0.0
    total_paid: float = 0.0
    outstanding_balance: float = 0.0
    overdue_balance: float = 0.0
    open_invoices_count: int = 0
    overdue_invoices_count: int = 0
    average_days_to_pay: Optional[float] = None
    invoices: List[dict] = []
    timeline: List[dict] = []


# ==========================================
# Vendor Schemas
# ==========================================
# Vendor Schemas
# ==========================================
class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Vendor or supplier name")
    legal_name: Optional[str] = Field(None, max_length=255)
    contact_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    remit_address: Optional[str] = None
    country: Optional[str] = Field("Egypt", max_length=100)
    payment_terms_days: Optional[int] = Field(30, ge=0, le=365)
    default_currency: Optional[str] = Field("USD", max_length=10)
    category: Optional[str] = Field("General", max_length=100)
    default_department: Optional[str] = Field(None, max_length=100)
    tax_treatment: Optional[str] = Field("standard", max_length=50)
    withholding_tax_rate: Optional[float] = Field(0.0, ge=0.0, le=100.0)
    onboarding_status: Optional[str] = Field("active", max_length=50)
    notes: Optional[str] = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    legal_name: Optional[str] = Field(None, max_length=255)
    contact_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    tax_id: Optional[str] = Field(None, max_length=100)
    remit_address: Optional[str] = None
    country: Optional[str] = Field(None, max_length=100)
    payment_terms_days: Optional[int] = Field(None, ge=0, le=365)
    default_currency: Optional[str] = Field(None, max_length=10)
    category: Optional[str] = Field(None, max_length=100)
    default_department: Optional[str] = Field(None, max_length=100)
    tax_treatment: Optional[str] = Field(None, max_length=50)
    withholding_tax_rate: Optional[float] = Field(None, ge=0.0, le=100.0)
    onboarding_status: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class VendorResponse(VendorBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# Vendor Payment Instruction Schemas
# ==========================================
class VendorPaymentInstructionBase(BaseModel):
    payment_method: str = Field("bank_transfer", description="bank_transfer | ach | wire | check | cash | other")
    bank_name: Optional[str] = Field(None, max_length=150)
    account_holder_name: Optional[str] = Field(None, max_length=255)
    account_number: str = Field(..., min_length=4, max_length=100)
    routing_number: Optional[str] = Field(None, max_length=50)
    swift_code: Optional[str] = Field(None, max_length=50)
    iban: Optional[str] = Field(None, max_length=100)
    effective_date: Optional[str] = None
    notes: Optional[str] = None


class VendorPaymentInstructionCreate(VendorPaymentInstructionBase):
    pass


class VendorPaymentInstructionUpdate(BaseModel):
    payment_method: Optional[str] = None
    bank_name: Optional[str] = None
    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None
    routing_number: Optional[str] = None
    swift_code: Optional[str] = None
    iban: Optional[str] = None
    effective_date: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class VendorPaymentInstructionResponse(BaseModel):
    id: int
    vendor_id: int
    payment_method: str
    bank_name: Optional[str] = None
    account_holder_name: Optional[str] = None
    account_number: str
    routing_number: Optional[str] = None
    swift_code: Optional[str] = None
    iban: Optional[str] = None
    verification_status: str
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None
    is_active: bool
    effective_date: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class VendorPaymentInstructionVerifyRequest(BaseModel):
    decision: str = Field("verified", description="verified | rejected")
    comment: Optional[str] = None


# ==========================================
# Vendor Duplicate & 360 Profile Schemas
# ==========================================
class VendorDuplicateCheckRequest(BaseModel):
    name: Optional[str] = None
    tax_id: Optional[str] = None
    contact_email: Optional[str] = None
    exclude_id: Optional[int] = None


class VendorDuplicateCandidate(BaseModel):
    id: int
    name: str
    tax_id: Optional[str] = None
    contact_email: Optional[str] = None
    matched_field: str
    matching_value: str


class VendorSpendMetric(BaseModel):
    total_spend: float = 0.0
    open_bills_count: int = 0
    open_bills_total: float = 0.0
    last_payment_date: Optional[str] = None
    last_payment_amount: Optional[float] = None
    active_subscriptions_count: int = 0


class Vendor360Response(BaseModel):
    vendor: VendorResponse
    payment_instructions: List[VendorPaymentInstructionResponse] = []
    metrics: VendorSpendMetric
    recent_bills: List[dict] = []


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
    expected_bank_account_id: Optional[int] = Field(None, description="Expected destination bank or cash account")
    revenue_channel: Optional[str] = Field(None, description="Revenue channel: local_egp|overseas_usd|cash|intercompany_transfer_us|other")
    notes: Optional[str] = None


class SalesInvoiceCreate(SalesInvoiceBase):
    lines: List[SalesInvoiceLineCreate] = Field(default_factory=list)


class SalesInvoiceUpdate(BaseModel):
    customer_id: Optional[int] = None
    invoice_number: Optional[str] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    expected_bank_account_id: Optional[int] = None
    revenue_channel: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[List[SalesInvoiceLineCreate]] = None


class SalesInvoiceResponse(SalesInvoiceBase):
    id: int
    subtotal: float
    tax_amount: float
    total: float
    amount_paid: float = 0.0
    balance: float = 0.0
    is_overdue: bool = False
    days_overdue: int = 0
    payment_status: str = "unpaid"  # unpaid | partially_paid | paid
    next_action: Optional[str] = None
    created_at: Optional[datetime] = None
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    expected_bank_account_name: Optional[str] = None
    has_bank_discrepancy: bool = False
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
    status: str = Field("unpaid", description="inbox|needs_coding|needs_approval|ready_to_pay|scheduled|paid|exceptions|void|unpaid")
    currency: str = Field("USD", min_length=3, max_length=10)
    notes: Optional[str] = None
    capture_source: Optional[str] = Field("manual", max_length=20)
    extraction_confidence: Optional[float] = None
    missing_fields: Optional[str] = None
    department: Optional[str] = Field(None, max_length=100)
    legal_entity: Optional[str] = Field("Voyance Health Inc", max_length=100)
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    file_fingerprint: Optional[str] = None
    is_reviewed: Optional[bool] = True
    is_duplicate_override: Optional[bool] = False
    duplicate_override_reason: Optional[str] = None
    created_by: Optional[str] = None
    requires_approval: Optional[bool] = False
    approval_status: Optional[str] = None  # pending | approved | rejected
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_comment: Optional[str] = None
    scheduled_payment_date: Optional[str] = None
    amount_paid: float = 0.0


class BillCreate(BillBase):
    lines: List[BillLineCreate] = Field(default_factory=list)


class BillUpdate(BaseModel):
    vendor_id: Optional[int] = None
    bill_number: Optional[str] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=100)
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=10)
    notes: Optional[str] = None
    capture_source: Optional[str] = None
    extraction_confidence: Optional[float] = None
    missing_fields: Optional[str] = None
    department: Optional[str] = None
    legal_entity: Optional[str] = None
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None
    file_fingerprint: Optional[str] = None
    is_reviewed: Optional[bool] = None
    is_duplicate_override: Optional[bool] = None
    duplicate_override_reason: Optional[str] = None
    created_by: Optional[str] = None
    requires_approval: Optional[bool] = None
    approval_status: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_comment: Optional[str] = None
    scheduled_payment_date: Optional[str] = None
    amount_paid: Optional[float] = None
    lines: Optional[List[BillLineCreate]] = None


class BillResponse(BillBase):
    id: int
    subtotal: float
    tax_amount: float
    total: float
    remaining_balance: float = 0.0
    created_at: Optional[datetime] = None
    vendor_name: Optional[str] = None
    lines: List[BillLineResponse] = []

    class Config:
        from_attributes = True


class BillApprovalRequest(BaseModel):
    decision: str = Field(..., description="approve | reject")
    comment: Optional[str] = Field(None, max_length=500, description="Optional comment, required on rejection")
    approver_limit: Optional[float] = Field(None, description="Optional maximum approval authority for the approver")


class BillScheduleRequest(BaseModel):
    scheduled_payment_date: str = Field(..., description="Scheduled payment date (YYYY-MM-DD)")
    payment_method: Optional[str] = Field("bank_transfer")
    bank_account_id: Optional[int] = None
    notes: Optional[str] = None


class PaymentReversalRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500, description="Reason for reversing payment")


class BillDuplicateCheckRequest(BaseModel):
    vendor_id: Optional[int] = None
    bill_number: Optional[str] = None
    issue_date: Optional[str] = None
    total: Optional[float] = None
    file_fingerprint: Optional[str] = None
    exclude_id: Optional[int] = None


class BillDuplicateCandidate(BaseModel):
    id: int
    bill_number: str
    vendor_id: int
    vendor_name: Optional[str] = None
    issue_date: str
    total: float
    status: str
    matched_field: str
    matching_value: str


class BillDuplicateCheckResponse(BaseModel):
    candidates: List[BillDuplicateCandidate] = []


class BillQueueCountsResponse(BaseModel):
    inbox: int = 0
    needs_coding: int = 0
    needs_approval: int = 0
    ready_to_pay: int = 0
    scheduled: int = 0
    paid: int = 0
    exceptions: int = 0
    all: int = 0


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
    account_discrepancy: bool = False
    expected_bank_account_id: Optional[int] = None
    expected_bank_account_name: Optional[str] = None
    is_reversed: bool = False
    reversed_at: Optional[datetime] = None
    reversed_by: Optional[str] = None
    reversal_reason: Optional[str] = None

    class Config:
        from_attributes = True


# ==========================================
# Account Transfer Schemas (Phase 3)
# ==========================================
class AccountTransferBase(BaseModel):
    date: str = Field(..., description="Transfer date (YYYY-MM-DD)")
    from_amount: float = Field(..., gt=0.0, description="Amount debited from source account")
    from_currency: str = Field("USD", min_length=3, max_length=10)
    to_amount: Optional[float] = Field(None, gt=0.0, description="Amount credited to target account")
    to_currency: Optional[str] = Field(None, min_length=3, max_length=10)
    fx_rate: Optional[float] = Field(None, gt=0.0, description="Exchange rate if currencies differ")
    transfer_type: str = Field("internal", description="same_bank_fx | internal | external_linked")
    exchange_reference: Optional[str] = Field(None, max_length=100, description="Exchange/transaction reference")
    confirmed_leg: str = Field("both", description="both | from_only | to_only")
    note: Optional[str] = Field("", description="Transfer notes or memo")


class AccountTransferCreate(AccountTransferBase):
    from_account_id: Optional[int] = Field(None, description="Source bank account ID")
    to_account_id: Optional[int] = Field(None, description="Destination bank account ID")


class AccountTransferResponse(AccountTransferBase):
    id: int
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    from_account_name: Optional[str] = None
    to_account_name: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None
    outflow_transaction_id: Optional[int] = None
    inflow_transaction_id: Optional[int] = None

    class Config:
        from_attributes = True


# ==========================================
# Cheque Schemas (Phase 5)
# ==========================================
class ChequeBase(BaseModel):
    cheque_number: str = Field(..., min_length=1, max_length=50, description="Cheque serial number")
    issue_date: str = Field(..., description="Issue date (YYYY-MM-DD)")
    amount: float = Field(..., gt=0.0, description="Cheque face amount")
    currency: str = Field("USD", min_length=3, max_length=10, description="Currency")
    payee: str = Field(..., min_length=1, max_length=255, description="Payee / Beneficiary")
    purpose_type: str = Field("other", description="vendor_payment | cash_withdrawal | other")
    destination_cash_account_id: Optional[int] = Field(None, description="Required for cash_withdrawal")
    linked_bill_id: Optional[int] = Field(None, description="Optional vendor bill to pay")
    notes: Optional[str] = Field("", description="Memo or internal notes")


class ChequeCreate(ChequeBase):
    account_id: int = Field(..., description="Bank account from which cheque is drawn")
    fiscal_year: Optional[int] = Field(None, description="Fiscal year (defaults to issue year)")


class ChequeStatusUpdate(BaseModel):
    status: str = Field(..., description="cleared | bounced | voided")
    clear_date: Optional[str] = Field(None, description="Date cleared (YYYY-MM-DD)")


class ChequeResponse(ChequeBase):
    id: int
    account_id: int
    account_name: Optional[str] = None
    destination_cash_account_name: Optional[str] = None
    status: str
    clear_date: Optional[str] = None
    fiscal_year: int
    linked_transaction_id: Optional[int] = None
    linked_cash_transaction_id: Optional[int] = None
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None

    class Config:
        from_attributes = True


# ==========================================
# Subscription & Attachment Schemas (Phase 6)
# ==========================================
class FinanceAttachmentResponse(BaseModel):
    id: int
    subscription_charge_id: Optional[int] = None
    statement_import_id: Optional[int] = None
    ledger_transaction_id: Optional[int] = None
    file_name: str
    file_size: int = 0
    mime_type: str = "application/octet-stream"
    storage_ref: str
    uploaded_at: Optional[datetime] = None
    uploaded_by: Optional[str] = None

    class Config:
        from_attributes = True


class SubscriptionBase(BaseModel):
    vendor_id: int = Field(..., description="ID of the vendor providing the service")
    name: str = Field(..., min_length=1, max_length=255, description="Service name / subscription")
    amount: float = Field(..., ge=0.0, description="Base recurring amount or estimated usage")
    currency: str = Field("USD", min_length=3, max_length=10, description="Currency")
    billing_cycle: str = Field("monthly", description="monthly | quarterly | yearly")
    next_renewal_date: str = Field(..., description="Next renewal / billing date (YYYY-MM-DD)")
    contract_start_date: Optional[str] = Field(None, description="Contract start date (YYYY-MM-DD)")
    contract_end_date: Optional[str] = Field(None, description="Contract end date (YYYY-MM-DD)")
    notice_period_days: Optional[int] = Field(30, ge=0, description="Notice period for renewal/cancellation in days")
    owner: Optional[str] = Field(None, max_length=255, description="Owner / DRI for this tool or contract")
    department: Optional[str] = Field(None, max_length=100, description="Department (Engineering, Operations, etc.)")
    payment_method: Optional[str] = Field("card", description="Payment method: card | bank_transfer | other")
    payment_account_id: Optional[int] = Field(None, description="Linked bank/card account for charges")
    seats_count: Optional[int] = Field(None, ge=0, description="Allocated user seats / licenses count")
    auto_generate_bill: bool = Field(False, description="Whether to auto-generate vendor bills on renewal")
    is_active: bool = Field(True, description="Whether subscription is currently active")


class SubscriptionCreate(SubscriptionBase):
    pass


class SubscriptionUpdate(BaseModel):
    vendor_id: Optional[int] = None
    name: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    billing_cycle: Optional[str] = None
    next_renewal_date: Optional[str] = None
    contract_start_date: Optional[str] = None
    contract_end_date: Optional[str] = None
    notice_period_days: Optional[int] = None
    owner: Optional[str] = None
    department: Optional[str] = None
    payment_method: Optional[str] = None
    payment_account_id: Optional[int] = None
    seats_count: Optional[int] = None
    auto_generate_bill: Optional[bool] = None
    is_active: Optional[bool] = None


class SubscriptionResponse(SubscriptionBase):
    id: int
    vendor_name: Optional[str] = None
    monthly_equivalent_amount: float = 0.0
    notice_deadline_date: Optional[str] = None
    is_renewal_imminent: bool = False
    created_at: Optional[datetime] = None
    charges_count: int = 0
    last_charge_date: Optional[str] = None
    last_charge_amount: Optional[float] = None

    class Config:
        from_attributes = True


class SubscriptionChargeBase(BaseModel):
    subscription_id: int = Field(..., description="ID of subscription being charged")
    billing_date: str = Field(..., description="Date of charge (YYYY-MM-DD)")
    amount: float = Field(..., gt=0.0, description="Actual amount charged")
    currency: str = Field("USD", min_length=3, max_length=10, description="Currency")
    create_bill: bool = Field(False, description="Whether to also create a matched vendor bill")
    variance_reason: Optional[str] = Field(None, description="Explanation if charged amount differs from base expected rate")
    note: Optional[str] = Field("", description="Usage notes or invoice memo")


class SubscriptionChargeCreate(SubscriptionChargeBase):
    bank_account_id: Optional[int] = Field(None, description="Optional bank account to record payment outflow")


class SubscriptionChargeResponse(SubscriptionChargeBase):
    id: int
    subscription_name: Optional[str] = None
    vendor_name: Optional[str] = None
    linked_transaction_id: Optional[int] = None
    linked_bill_id: Optional[int] = None
    variance_amount: float = 0.0
    variance_reason: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None
    attachments: List[FinanceAttachmentResponse] = []

    class Config:
        from_attributes = True


# ==========================================
# Bank Statement Import & Reconciliation Schemas (Phase 7)
# ==========================================
class CSVColumnMapping(BaseModel):
    date_col: Optional[str] = None
    description_col: Optional[str] = None
    debit_col: Optional[str] = None
    credit_col: Optional[str] = None
    amount_col: Optional[str] = None
    reference_col: Optional[str] = None


class StatementImportBase(BaseModel):
    account_id: int = Field(..., description="Target bank account ID")
    period_month: str = Field(..., description="Statement period month (YYYY-MM)")
    file_type: str = Field("csv", description="csv | pdf")


class StatementImportCreate(StatementImportBase):
    pass


class StatementImportResponse(StatementImportBase):
    id: int
    account_name: Optional[str] = None
    status: str
    uploaded_file_ref: str
    total_lines_count: int = 0
    matched_lines_count: int = 0
    reconciled_at: Optional[datetime] = None
    reconciled_by: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[str] = None
    attachments: List[FinanceAttachmentResponse] = []

    class Config:
        from_attributes = True


class SuggestedMatch(BaseModel):
    transaction_id: Optional[int] = None
    cheque_id: Optional[int] = None
    match_type: str = "probable_transaction"  # exact_transaction | probable_transaction | cheque
    score: float = 0.0
    date: str
    amount: float
    direction: str
    description: str
    reference: Optional[str] = ""
    reason: str = ""


class StatementLineBase(BaseModel):
    import_id: int
    raw_date: str
    raw_amount: float
    direction: str
    raw_description: str
    raw_reference: Optional[str] = ""
    status: str = "unmatched"
    notes: Optional[str] = ""


class StatementLineResponse(StatementLineBase):
    id: int
    matched_transaction_id: Optional[int] = None
    matched_cheque_id: Optional[int] = None
    created_at: Optional[datetime] = None
    suggested_matches: List[SuggestedMatch] = []

    class Config:
        from_attributes = True


class StatementLineResolveRequest(BaseModel):
    action: str = Field(..., description="match | create | ignore")
    matched_transaction_id: Optional[int] = Field(None, description="Existing ledger transaction ID to link")
    matched_cheque_id: Optional[int] = Field(None, description="Existing cheque ID to link & auto-clear")
    # Fields required when action == 'create'
    category_id: Optional[int] = Field(None, description="Category ID when auto-creating transaction")
    payment_type_id: Optional[int] = Field(None, description="Payment Type ID when auto-creating transaction")
    description: Optional[str] = Field(None, description="Custom description for created transaction")
    reference: Optional[str] = Field(None, description="Reference for created transaction")
    notes: Optional[str] = Field(None, description="Resolution notes")


# ==========================================
# Entity Detail & Activity Timeline (Story 1.3)
# ==========================================
class TimelineEvent(BaseModel):
    id: str
    timestamp: str
    event: str
    plain_text: str
    actor: str = ""
    state_transition: Optional[Dict[str, Optional[str]]] = None
    before_after: Optional[Dict[str, Any]] = None
    linked_record: Optional[Dict[str, Any]] = None
    notes: Optional[str] = ""


class EntitySummaryAttribute(BaseModel):
    label: str
    value: str


class EntitySummary(BaseModel):
    reference: str
    counterparty: Optional[str] = ""
    amount: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = ""
    sensitive_masked: bool = False
    attributes: List[EntitySummaryAttribute] = []


class RelatedRecordItem(BaseModel):
    entity_type: str
    entity_id: int
    title: str
    badge: Optional[str] = ""
    amount: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None


class EntityActivityResponse(BaseModel):
    entity_type: str
    entity_id: int
    title: str
    status: str
    summary: EntitySummary
    related_records: List[RelatedRecordItem] = []
    attachments: List[FinanceAttachmentResponse] = []
    timeline: List[TimelineEvent] = []


# ==========================================
# Needs-Attention Queue Schemas (Story 2.2)
# ==========================================
class AttentionItem(BaseModel):
    id: str = Field(..., description="Unique item identifier, e.g. rec-inv-12")
    deduplication_key: str = Field(..., description="Deterministic key e.g. invoice:12:overdue")
    type: str = Field(..., description="overdue_receivable | bill_due | pending_approval | unreconciled_statement | negative_cash | bounced_cheque")
    severity: str = Field(..., description="urgent | warning | info")
    severity_label: str = Field(..., description="User-friendly text label: Urgent | Warning | Info")
    title: str = Field(..., description="Short title describing the exception")
    description: str = Field(..., description="Human-readable explanation of required action")
    counterparty: Optional[str] = Field(None, description="Customer name, vendor name, or institution")
    amount: Optional[float] = Field(None, description="Outstanding or impacted monetary amount")
    currency: Optional[str] = Field(None, description="Currency code, e.g. USD, EGP")
    due_date: Optional[str] = Field(None, description="Due date YYYY-MM-DD or relevant event date")
    due_state: str = Field(..., description="overdue | due_today | due_soon | immediate | pending_review | needs_reconciliation | bounced")
    due_state_label: str = Field(..., description="Accessible text, e.g. 'Overdue by 12 days', 'Due today', 'Action Required'")
    owner: Optional[str] = Field(None, description="Assignee or responsible contact")
    target_route: str = Field(..., description="UI navigation route e.g. a-finance-invoices")
    target_id: Optional[int] = Field(None, description="ID of primary record")
    target_filter: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Filter parameters for deep linking")
    permission: str = Field(..., description="Required RBAC permission to view this item")
    priority_score: int = Field(0, description="Computed priority score for deterministic sorting")
    can_resolve: bool = Field(True, description="Whether operator can open/resolve this item")
    can_mark_reviewed: bool = Field(True, description="Whether operator can mark as reviewed")
    is_reviewed: bool = Field(False, description="Whether item has been marked reviewed")
    created_at: Optional[str] = Field(None, description="Timestamp when entity was created")


class AttentionQueueResponse(BaseModel):
    total_count: int
    urgent_count: int
    warning_count: int
    info_count: int
    total_amount_by_currency: Dict[str, float]
    items: List[AttentionItem]
    generated_at: str


class AttentionReviewRequest(BaseModel):
    status: str = Field("reviewed", pattern="^(reviewed|resolved|dismissed)$")
    notes: Optional[str] = Field("", max_length=500)


# ==========================================
# Cash Position & Forecast Schemas (Story 2.3)
# ==========================================
class CashPositionAccount(BaseModel):
    account_id: int
    account_name: str
    bank_name: Optional[str] = None
    account_type: str = "bank"
    currency: str = "USD"
    book_balance: float = Field(0.0, description="Book balance per financial ledger")
    available_balance: float = Field(0.0, description="Available balance factoring uncleared cheques/pending legs")
    reconciled_balance: Optional[float] = Field(None, description="Matched balance per reconciled bank statements")
    uncleared_cheques_amount: float = Field(0.0, description="Total issued uncleared cheques")
    pending_transfers_amount: float = Field(0.0, description="Pending outgoing transfers")
    is_active: bool = True


class HorizonProjection(BaseModel):
    period_label: str
    days: int
    confirmed_inflows: float = 0.0
    expected_inflows: float = 0.0
    total_inflows: float = 0.0
    confirmed_outflows: float = 0.0
    expected_outflows: float = 0.0
    total_outflows: float = 0.0
    net_cash_flow: float = 0.0
    projected_ending_cash: float = 0.0
    confidence: str = Field("high", description="high | medium | low")


class ForecastObligationItem(BaseModel):
    id: str
    entity_type: str = Field(..., description="invoice | bill | subscription | payroll | transfer")
    entity_id: int
    reference: str
    counterparty: str
    type: str = Field(..., description="inflow | outflow")
    amount: float
    currency: str
    due_date: str
    status: str = Field("confirmed", description="confirmed | expected")
    certainty: str = Field("contractual", description="contractual | estimated | overdue")
    target_route: str
    notes: Optional[str] = ""


class CashForecastResponse(BaseModel):
    as_of_date: str
    currency: str
    accounts: List[CashPositionAccount]
    current_cash_by_currency: Dict[str, float]
    total_current_cash: float
    horizons: Dict[str, HorizonProjection]
    material_obligations: List[ForecastObligationItem]
    assumptions: List[str]
    fx_warnings: List[str]
    generated_at: str



