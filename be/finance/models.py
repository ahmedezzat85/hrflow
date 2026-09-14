"""
be/finance/models.py
SQLAlchemy ORM models for the Finance domain.
Follows Phase 3 specifications and 00-architecture-blueprint.md conventions.
Targeting both SQLite (dev) and PostgreSQL (staging/prod).
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from db import Base


class CustomerDB(Base):
    __tablename__ = "finance_customers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    legal_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    tax_id = Column(String(100), nullable=True)
    billing_address = Column(Text, nullable=True)
    country = Column(String(100), default="Egypt", nullable=True)
    default_currency = Column(String(10), default="USD", nullable=True)
    payment_terms_days = Column(Integer, default=30, nullable=True)
    owner = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    invoices = relationship("SalesInvoiceDB", back_populates="customer")


class VendorDB(Base):
    __tablename__ = "finance_vendors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    legal_name = Column(String(255), nullable=True)
    contact_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    tax_id = Column(String(100), nullable=True)
    remit_address = Column(Text, nullable=True)
    country = Column(String(100), default="Egypt", nullable=True)
    payment_terms_days = Column(Integer, default=30, nullable=True)
    default_currency = Column(String(10), default="USD", nullable=True)
    category = Column(String(100), default="General")
    default_department = Column(String(100), nullable=True)
    tax_treatment = Column(String(50), default="standard", nullable=True)
    withholding_tax_rate = Column(Float, default=0.0, nullable=True)
    onboarding_status = Column(String(50), default="active", nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    bills = relationship("BillDB", back_populates="vendor")
    subscriptions = relationship("SubscriptionDB", back_populates="vendor")
    payment_instructions = relationship("VendorPaymentInstructionDB", back_populates="vendor", cascade="all, delete-orphan")


class VendorPaymentInstructionDB(Base):
    __tablename__ = "finance_vendor_payment_instructions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    payment_method = Column(String(50), default="bank_transfer", nullable=False)  # bank_transfer, ach, wire, check, cash, other
    bank_name = Column(String(150), nullable=True)
    account_holder_name = Column(String(255), nullable=True)
    account_number = Column(String(100), nullable=False)
    routing_number = Column(String(50), nullable=True)
    swift_code = Column(String(50), nullable=True)
    iban = Column(String(100), nullable=True)
    verification_status = Column(String(30), default="unverified", nullable=False, index=True)  # unverified, verified, rejected
    verified_by = Column(String(255), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    effective_date = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    vendor = relationship("VendorDB", back_populates="payment_instructions")


class SalesInvoiceDB(Base):
    __tablename__ = "finance_sales_invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("finance_customers.id", ondelete="RESTRICT"), nullable=False, index=True)
    invoice_number = Column(String(50), unique=True, nullable=False, index=True)
    issue_date = Column(String(20), nullable=False)
    due_date = Column(String(20), nullable=False)
    status = Column(String(30), default="draft", nullable=False, index=True)  # draft/sent/paid/overdue/void
    currency = Column(String(10), default="USD", nullable=False)
    subtotal = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    expected_bank_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    revenue_channel = Column(String(50), nullable=True, index=True)  # local_egp | overseas_usd | cash | intercompany_transfer_us | other
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("CustomerDB", back_populates="invoices")
    expected_bank_account = relationship("FinanceBankAccountDB", foreign_keys=[expected_bank_account_id])
    lines = relationship("SalesInvoiceLineDB", back_populates="invoice", cascade="all, delete-orphan")
    payments = relationship("PaymentDB", back_populates="sales_invoice", foreign_keys="PaymentDB.related_invoice_id")


class SalesInvoiceLineDB(Base):
    __tablename__ = "finance_sales_invoice_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    line_total = Column(Float, default=0.0)

    invoice = relationship("SalesInvoiceDB", back_populates="lines")


class BillDB(Base):
    __tablename__ = "finance_bills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="RESTRICT"), nullable=False, index=True)
    bill_number = Column(String(50), nullable=False, index=True)
    category = Column(String(100), default="Operating Expense")
    issue_date = Column(String(20), nullable=False)
    due_date = Column(String(20), nullable=False)
    status = Column(String(30), default="unpaid", nullable=False, index=True)  # inbox | needs_coding | needs_approval | ready_to_pay | scheduled | paid | exceptions | void
    currency = Column(String(10), default="USD", nullable=False)
    subtotal = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    capture_source = Column(String(20), default="manual", nullable=False)  # manual | upload | ocr
    extraction_confidence = Column(Float, nullable=True)
    missing_fields = Column(Text, nullable=True)
    department = Column(String(100), nullable=True)
    legal_entity = Column(String(100), default="Voyance Health Inc", nullable=True)
    attachment_url = Column(String(500), nullable=True)
    attachment_name = Column(String(255), nullable=True)
    file_fingerprint = Column(String(128), nullable=True, index=True)
    is_reviewed = Column(Boolean, default=True, nullable=False)
    is_duplicate_override = Column(Boolean, default=False, nullable=False)
    duplicate_override_reason = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=True)
    requires_approval = Column(Boolean, default=False, nullable=False)
    approval_status = Column(String(20), nullable=True)  # pending | approved | rejected
    approved_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_comment = Column(Text, nullable=True)
    scheduled_payment_date = Column(String(20), nullable=True)
    amount_paid = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("VendorDB", back_populates="bills")
    lines = relationship("BillLineDB", back_populates="bill", cascade="all, delete-orphan")
    payments = relationship("PaymentDB", back_populates="bill", foreign_keys="PaymentDB.related_bill_id")


class BillLineDB(Base):
    __tablename__ = "finance_bill_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    line_total = Column(Float, default=0.0)

    bill = relationship("BillDB", back_populates="lines")


class TransactionCategoryDB(Base):
    __tablename__ = "finance_transaction_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    kind = Column(String(20), default="other", nullable=False)  # revenue | cost | transfer | other
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_petty = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("LedgerTransactionDB", back_populates="category")


class PaymentTypeDB(Base):
    __tablename__ = "finance_payment_types"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    code = Column(String(50), unique=True, nullable=False, index=True)
    requires_cheque_number = Column(Boolean, default=False, nullable=False)
    requires_bank_fee_flag = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("LedgerTransactionDB", back_populates="payment_type")


class FinanceBankAccountDB(Base):
    __tablename__ = "finance_bank_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_name = Column(String(100), nullable=False)
    bank_name = Column(String(100), nullable=True)  # Nullable for cash accounts
    account_number = Column(String(100), nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    opening_balance = Column(Float, default=0.0)
    opening_balance_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    current_balance = Column(Float, default=0.0)
    account_type = Column(String(20), default="bank", nullable=False)  # bank | cash
    country = Column(String(100), default="Egypt", nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    payments = relationship("PaymentDB", back_populates="bank_account")
    ledger_transactions = relationship(
        "LedgerTransactionDB",
        back_populates="account",
        cascade="all, delete-orphan",
        order_by="LedgerTransactionDB.date.asc(), LedgerTransactionDB.id.asc()",
        foreign_keys="[LedgerTransactionDB.account_id]",
    )
    cheques = relationship(
        "FinanceChequeDB",
        back_populates="account",
        foreign_keys="[FinanceChequeDB.account_id]",
    )


# Alias for clean domain referencing
BankAccountDB = FinanceBankAccountDB


class LedgerTransactionDB(Base):
    __tablename__ = "finance_ledger_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    amount = Column(Float, nullable=False)
    direction = Column(String(20), nullable=False)  # in / out
    currency = Column(String(10), default="USD", nullable=False)
    category_id = Column(Integer, ForeignKey("finance_transaction_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    payment_type_id = Column(Integer, ForeignKey("finance_payment_types.id", ondelete="SET NULL"), nullable=True, index=True)
    reference = Column(String(255), default="", nullable=False)
    description = Column(String(255), default="", nullable=False)
    entry_type = Column(String(30), default="standard", nullable=False, index=True)  # standard | money_in | money_out | bank_fee | adjustment
    counterparty = Column(String(255), nullable=True)
    tax_amount = Column(Float, default=0.0)
    base_amount = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)
    cheque_number = Column(String(50), nullable=True, index=True)
    fx_rate = Column(Float, nullable=True)
    source = Column(String(50), nullable=False, index=True)
    # sources: manual | invoice_payment | bill_payment | transfer | cheque | subscription_charge | statement_import
    linked_invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_transfer_id = Column(Integer, ForeignKey("finance_account_transfers.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_cheque_id = Column(Integer, ForeignKey("finance_cheques.id", ondelete="SET NULL", use_alter=True), nullable=True, index=True)
    destination_cash_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True)
    running_balance = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    account = relationship("FinanceBankAccountDB", foreign_keys=[account_id], back_populates="ledger_transactions")
    category = relationship("TransactionCategoryDB", back_populates="transactions")
    payment_type = relationship("PaymentTypeDB", back_populates="transactions")
    linked_invoice = relationship("SalesInvoiceDB")
    linked_bill = relationship("BillDB")
    linked_transfer = relationship("AccountTransferDB", back_populates="ledger_transactions")
    linked_cheque = relationship("FinanceChequeDB", foreign_keys=[linked_cheque_id], back_populates="ledger_transactions")
    destination_cash_account = relationship("FinanceBankAccountDB", foreign_keys=[destination_cash_account_id])


# Alias for clean domain referencing
FinanceLedgerTransactionDB = LedgerTransactionDB


class FinanceChequeDB(Base):
    __tablename__ = "finance_cheques"

    id = Column(Integer, primary_key=True, autoincrement=True)
    cheque_number = Column(String(50), nullable=False)
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    issue_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    payee = Column(String(255), nullable=False, index=True)
    purpose_type = Column(String(50), default="other", nullable=False, index=True)  # vendor_payment | cash_withdrawal | other
    destination_cash_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(30), default="issued", nullable=False, index=True)  # draft | issued | outstanding | cleared | bounced | stopped | voided | replaced
    posting_policy = Column(String(30), default="at_issue", nullable=False)  # at_issue | at_clearing
    signer_name = Column(String(255), nullable=True)
    authorized_by = Column(String(255), nullable=True)
    attachment_url = Column(String(500), nullable=True)
    exception_reason = Column(Text, nullable=True)
    exception_evidence = Column(String(255), nullable=True)
    replacement_cheque_id = Column(Integer, ForeignKey("finance_cheques.id", ondelete="SET NULL", use_alter=True), nullable=True)
    replaced_cheque_id = Column(Integer, ForeignKey("finance_cheques.id", ondelete="SET NULL", use_alter=True), nullable=True)
    clear_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    fiscal_year = Column(Integer, nullable=False, index=True)
    linked_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="SET NULL", use_alter=True), nullable=True)
    linked_cash_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="SET NULL", use_alter=True), nullable=True)
    notes = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("account_id", "cheque_number", name="uq_cheque_account_number"),
    )

    account = relationship("FinanceBankAccountDB", foreign_keys=[account_id], back_populates="cheques")
    destination_cash_account = relationship("FinanceBankAccountDB", foreign_keys=[destination_cash_account_id])
    linked_bill = relationship("BillDB")
    linked_transaction = relationship("LedgerTransactionDB", foreign_keys=[linked_transaction_id], post_update=True)
    linked_cash_transaction = relationship("LedgerTransactionDB", foreign_keys=[linked_cash_transaction_id], post_update=True)
    ledger_transactions = relationship("LedgerTransactionDB", foreign_keys="[LedgerTransactionDB.linked_cheque_id]", back_populates="linked_cheque")
    replacement_cheque = relationship("FinanceChequeDB", foreign_keys=[replacement_cheque_id], remote_side=[id], post_update=True)
    replaced_cheque = relationship("FinanceChequeDB", foreign_keys=[replaced_cheque_id], remote_side=[id], post_update=True)


# Alias for clean domain referencing
ChequeDB = FinanceChequeDB


class PaymentDB(Base):
    __tablename__ = "finance_payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    direction = Column(String(20), nullable=False)  # incoming / outgoing
    related_invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    related_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    payment_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    bank_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    method = Column(String(50), default="bank_transfer")  # bank_transfer/cash/card/other
    reference = Column(String(100), default="")
    is_reversed = Column(Boolean, default=False, nullable=False)
    reversed_at = Column(DateTime, nullable=True)
    reversed_by = Column(String(255), nullable=True)
    reversal_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sales_invoice = relationship("SalesInvoiceDB", back_populates="payments", foreign_keys=[related_invoice_id])
    bill = relationship("BillDB", back_populates="payments", foreign_keys=[related_bill_id])
    bank_account = relationship("FinanceBankAccountDB", back_populates="payments")


class SubscriptionDB(Base):
    __tablename__ = "finance_subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    billing_cycle = Column(String(20), default="monthly")  # monthly/quarterly/yearly
    next_renewal_date = Column(String(20), nullable=False)
    contract_start_date = Column(String(20), nullable=True)
    contract_end_date = Column(String(20), nullable=True)
    notice_period_days = Column(Integer, default=30, nullable=False)
    owner = Column(String(255), nullable=True)
    department = Column(String(100), nullable=True)
    payment_method = Column(String(50), default="card", nullable=True)
    payment_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True)
    seats_count = Column(Integer, nullable=True)
    monthly_equivalent_amount = Column(Float, nullable=True)
    auto_generate_bill = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("VendorDB", back_populates="subscriptions")
    payment_account = relationship("FinanceBankAccountDB")
    charges = relationship("SubscriptionChargeDB", back_populates="subscription", cascade="all, delete-orphan")


class SubscriptionChargeDB(Base):
    __tablename__ = "finance_subscription_charges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subscription_id = Column(Integer, ForeignKey("finance_subscriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    billing_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    linked_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    variance_amount = Column(Float, default=0.0, nullable=False)
    variance_reason = Column(String(255), nullable=True)
    note = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    subscription = relationship("SubscriptionDB", back_populates="charges")
    linked_transaction = relationship("LedgerTransactionDB")
    linked_bill = relationship("BillDB")
    attachments = relationship("FinanceAttachmentDB", back_populates="subscription_charge", cascade="all, delete-orphan")


class BankStatementImportDB(Base):
    __tablename__ = "finance_statement_imports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    period_month = Column(String(10), nullable=False, index=True)  # YYYY-MM
    file_type = Column(String(10), default="csv", nullable=False)  # csv | pdf
    status = Column(String(20), default="needs_review", nullable=False, index=True)  # parsing | needs_review | reconciled
    uploaded_file_ref = Column(String(500), default="", nullable=False)
    file_fingerprint = Column(String(64), nullable=True, index=True)
    opening_balance = Column(Float, nullable=True)
    closing_balance = Column(Float, nullable=True)
    encoding = Column(String(20), default="utf-8", nullable=True)
    date_format = Column(String(30), default="auto", nullable=True)
    decimal_separator = Column(String(5), default=".", nullable=True)
    review_state = Column(String(30), default="needs_review", nullable=True)  # needs_review | resumable | validated
    total_lines_count = Column(Integer, default=0, nullable=False)
    matched_lines_count = Column(Integer, default=0, nullable=False)
    reconciled_at = Column(DateTime, nullable=True)
    reconciled_by = Column(String(255), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(String(255), nullable=True)
    closing_notes = Column(Text, nullable=True)
    reopened_at = Column(DateTime, nullable=True)
    reopened_by = Column(String(255), nullable=True)
    reopen_reason = Column(Text, nullable=True)
    is_exception_override = Column(Boolean, default=False, nullable=False)
    exception_override_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    account = relationship("FinanceBankAccountDB")
    lines = relationship("StatementLineDB", back_populates="statement_import", cascade="all, delete-orphan")
    attachments = relationship("FinanceAttachmentDB", back_populates="statement_import", cascade="all, delete-orphan")


class StatementLineDB(Base):
    __tablename__ = "finance_statement_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    import_id = Column(Integer, ForeignKey("finance_statement_imports.id", ondelete="CASCADE"), nullable=False, index=True)
    row_index = Column(Integer, nullable=True)
    line_fingerprint = Column(String(64), nullable=True, index=True)
    raw_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    raw_amount = Column(Float, nullable=False)
    direction = Column(String(10), default="out", nullable=False)  # in | out
    raw_description = Column(String(500), default="", nullable=False)
    raw_reference = Column(String(100), default="", nullable=True)
    matched_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    matched_cheque_id = Column(Integer, ForeignKey("finance_cheques.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(20), default="unmatched", nullable=False, index=True)  # unmatched | matched | created | ignored | split
    notes = Column(Text, default="", nullable=False)
    applied_rule_id = Column(Integer, ForeignKey("finance_reconciliation_rules.id", ondelete="SET NULL"), nullable=True, index=True)
    is_auto_applied = Column(Boolean, default=False, nullable=False)
    parent_line_id = Column(Integer, ForeignKey("finance_statement_lines.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    statement_import = relationship("BankStatementImportDB", back_populates="lines")
    matched_transaction = relationship("LedgerTransactionDB")
    matched_cheque = relationship("FinanceChequeDB")
    parent_line = relationship("StatementLineDB", remote_side=[id], back_populates="child_lines")
    child_lines = relationship("StatementLineDB", back_populates="parent_line", cascade="all, delete-orphan")
    applied_rule = relationship("ReconciliationRuleDB", back_populates="statement_lines")


class StatementMappingTemplateDB(Base):
    __tablename__ = "finance_statement_mapping_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_name = Column(String(100), nullable=False, unique=True, index=True)
    bank_name = Column(String(100), nullable=True)
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True)
    date_col = Column(String(100), nullable=True)
    description_col = Column(String(100), nullable=True)
    debit_col = Column(String(100), nullable=True)
    credit_col = Column(String(100), nullable=True)
    amount_col = Column(String(100), nullable=True)
    reference_col = Column(String(100), nullable=True)
    date_format = Column(String(30), default="auto", nullable=True)
    decimal_separator = Column(String(5), default=".", nullable=True)
    encoding = Column(String(20), default="utf-8", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReconciliationRuleDB(Base):
    __tablename__ = "finance_reconciliation_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(255), default="", nullable=False)
    priority = Column(Integer, default=10, nullable=False, index=True)  # 1 = highest priority
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    mode = Column(String(20), default="suggestion", nullable=False)  # suggestion | auto_apply
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # Conditions
    description_pattern = Column(String(255), nullable=True)
    direction = Column(String(10), nullable=True)  # in | out
    min_amount = Column(Float, nullable=True)
    max_amount = Column(Float, nullable=True)
    counterparty = Column(String(255), nullable=True)
    
    # Action
    action = Column(String(30), default="suggest_category", nullable=False)  # suggest_category | auto_create | auto_ignore
    target_category = Column(String(100), nullable=True)
    target_vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="SET NULL"), nullable=True)
    payment_method = Column(String(50), default="bank_transfer", nullable=True)
    audit_reason = Column(String(255), nullable=True)

    # Governance & Metrics
    creator = Column(String(255), nullable=True)
    approved_by = Column(String(255), nullable=True)
    is_approved = Column(Boolean, default=False, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    times_applied = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("FinanceBankAccountDB")
    target_vendor = relationship("VendorDB")
    statement_lines = relationship("StatementLineDB", back_populates="applied_rule")


# Aliases for statement models
FinanceBankStatementImportDB = BankStatementImportDB
FinanceStatementLineDB = StatementLineDB
FinanceStatementMappingTemplateDB = StatementMappingTemplateDB
FinanceReconciliationRuleDB = ReconciliationRuleDB


class FinanceAttachmentDB(Base):
    __tablename__ = "finance_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    subscription_charge_id = Column(Integer, ForeignKey("finance_subscription_charges.id", ondelete="CASCADE"), nullable=True, index=True)
    statement_import_id = Column(Integer, ForeignKey("finance_statement_imports.id", ondelete="CASCADE"), nullable=True, index=True)
    ledger_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="CASCADE"), nullable=True, index=True)
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, default=0, nullable=False)
    mime_type = Column(String(100), default="application/octet-stream", nullable=False)
    storage_ref = Column(String(500), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(String(255), nullable=True)

    subscription_charge = relationship("SubscriptionChargeDB", back_populates="attachments")
    statement_import = relationship("BankStatementImportDB", back_populates="attachments")
    ledger_transaction = relationship("LedgerTransactionDB")



class PayrollRunDB(Base):
    __tablename__ = "finance_payroll_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    period_label = Column(String(20), nullable=False, index=True)  # e.g. "2026-09"
    period_start = Column(String(20), nullable=False)
    period_end = Column(String(20), nullable=False)
    status = Column(String(30), default="draft", nullable=False, index=True)  # draft/approved/finalized/paid/partially_paid/cancelled
    total_gross = Column(Float, default=0.0)
    total_tax = Column(Float, default=0.0)
    total_deductions = Column(Float, default=0.0)
    total_net = Column(Float, default=0.0)
    total_employer_cost = Column(Float, default=0.0)
    headcount = Column(Integer, default=0)
    currency = Column(String(10), default="USD")
    bank_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String(255), nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    finalized_by = Column(String(255), nullable=True)
    paid_at = Column(DateTime, nullable=True)
    paid_by = Column(String(255), nullable=True)
    journal_transaction_id = Column(Integer, ForeignKey("finance_ledger_transactions.id", ondelete="SET NULL"), nullable=True)
    liabilities_summary_json = Column(Text, default="{}")
    exceptions_json = Column(Text, default="[]")
    variance_summary_json = Column(Text, default="{}")

    lines = relationship("PayrollLineDB", back_populates="payroll_run", cascade="all, delete-orphan")
    bank_account = relationship("FinanceBankAccountDB")
    journal_transaction = relationship("LedgerTransactionDB", foreign_keys=[journal_transaction_id])


class PayrollLineDB(Base):
    __tablename__ = "finance_payroll_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payroll_run_id = Column(Integer, ForeignKey("finance_payroll_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True)
    employee_name = Column(String(255), nullable=True)
    department = Column(String(100), nullable=True)
    base_salary = Column(Float, default=0.0)
    allowances_total = Column(Float, default=0.0)
    deductions_total = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    net_pay = Column(Float, default=0.0)
    employer_cost_extra = Column(Float, default=0.0)
    bank_name = Column(String(100), nullable=True)
    bank_account_masked = Column(String(50), nullable=True)
    payment_status = Column(String(30), default="pending")  # pending / paid / failed
    failure_reason = Column(Text, nullable=True)
    snapshot_notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    paid_at = Column(DateTime, nullable=True)

    payroll_run = relationship("PayrollRunDB", back_populates="lines")
    employee = relationship("EmployeeDB")


class AccountTransferDB(Base):
    __tablename__ = "finance_account_transfers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    to_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    from_amount = Column(Float, nullable=False)
    from_currency = Column(String(10), default="USD", nullable=False)
    to_amount = Column(Float, nullable=False)
    to_currency = Column(String(10), default="USD", nullable=False)
    fx_rate = Column(Float, nullable=True)
    transfer_type = Column(String(30), default="internal", nullable=False, index=True)  # same_bank_fx | internal | external_linked
    exchange_reference = Column(String(100), nullable=True, index=True)
    confirmed_leg = Column(String(20), default="both", nullable=False)  # both | from_only | to_only
    settlement_status = Column(String(30), default="settled", nullable=False, index=True)  # settled | in_transit | awaiting_match
    fee = Column(Float, default=0.0, nullable=True)
    expected_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    note = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    from_account = relationship("FinanceBankAccountDB", foreign_keys=[from_account_id])
    to_account = relationship("FinanceBankAccountDB", foreign_keys=[to_account_id])
    ledger_transactions = relationship("LedgerTransactionDB", back_populates="linked_transfer")


# Alias for clean domain referencing
FinanceAccountTransferDB = AccountTransferDB


class FinanceAttentionReviewDB(Base):
    __tablename__ = "finance_attention_reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    deduplication_key = Column(String(150), unique=True, nullable=False, index=True)
    item_type = Column(String(50), nullable=False, index=True)
    status = Column(String(30), default="reviewed", nullable=False, index=True)  # reviewed | resolved | dismissed
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    notes = Column(Text, default="", nullable=False)


# Alias for clean domain referencing
AttentionReviewDB = FinanceAttentionReviewDB


class FinanceSavedReportViewDB(Base):
    __tablename__ = "finance_saved_report_views"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_key = Column(String(100), nullable=False, index=True)
    view_name = Column(String(200), nullable=False)
    filters_json = Column(Text, nullable=False, default="{}")
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)


SavedReportViewDB = FinanceSavedReportViewDB


class FinanceExportAuditDB(Base):
    __tablename__ = "finance_export_audits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_key = Column(String(100), nullable=False, index=True)
    export_format = Column(String(20), nullable=False)  # xlsx | csv | pdf
    user_email = Column(String(255), nullable=True)
    row_count = Column(Integer, default=0, nullable=False)
    file_name = Column(String(255), nullable=False)
    filters_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


ExportAuditDB = FinanceExportAuditDB


class FinanceReportScheduleDB(Base):
    __tablename__ = "finance_report_schedules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_key = Column(String(100), nullable=False, index=True)
    report_title = Column(String(200), nullable=False)
    frequency = Column(String(50), nullable=False)  # daily | weekly | monthly
    recipients_json = Column(Text, nullable=False, default="[]")
    export_format = Column(String(20), default="xlsx", nullable=False)
    filters_json = Column(Text, default="{}", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


ReportScheduleDB = FinanceReportScheduleDB



