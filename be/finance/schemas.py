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
    reference: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=255)
    cheque_number: Optional[str] = Field(None, max_length=50)
    destination_cash_account_id: Optional[int] = None
    fx_rate: Optional[float] = None


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
    expected_bank_account_id: Optional[int] = Field(None, description="Expected destination bank or cash account")
    revenue_channel: Optional[str] = Field(None, description="Revenue channel: local_egp|overseas_usd|cash|intercompany_transfer_us|other")
    notes: Optional[str] = None


class SalesInvoiceCreate(SalesInvoiceBase):
    lines: List[SalesInvoiceLineCreate] = Field(default_factory=list)


class SalesInvoiceUpdate(BaseModel):
    customer_id: Optional[int] = None
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
    created_at: Optional[datetime] = None
    customer_name: Optional[str] = None
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
    account_discrepancy: bool = False
    expected_bank_account_id: Optional[int] = None
    expected_bank_account_name: Optional[str] = None

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
    auto_generate_bill: bool = Field(True, description="Whether to auto-generate vendor bills")
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
    auto_generate_bill: Optional[bool] = None
    is_active: Optional[bool] = None


class SubscriptionResponse(SubscriptionBase):
    id: int
    vendor_name: Optional[str] = None
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
    note: Optional[str] = Field("", description="Usage notes or invoice memo")


class SubscriptionChargeCreate(SubscriptionChargeBase):
    bank_account_id: Optional[int] = Field(None, description="Optional bank account to record payment outflow")


class SubscriptionChargeResponse(SubscriptionChargeBase):
    id: int
    subscription_name: Optional[str] = None
    vendor_name: Optional[str] = None
    linked_transaction_id: Optional[int] = None
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


