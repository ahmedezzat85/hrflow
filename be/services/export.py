"""
be/services/export.py
Domain data extraction and formatting for CSV and Google Sheets exports.
Allows Admins and HR Admins to export operational HR data.
"""
import io
import csv
from datetime import datetime
from typing import Optional, List, Tuple, Dict, Any

from db import get_db_context
from models_db import (
    EmployeeDB,
    EmployeeBankAccountDB,
    InsuranceClaimDB,
    InsuranceCategoryDB,
    SalaryHistoryDB,
    VacationHistoryDB,
    InvoiceDB,
)
from finance.models import (
    LedgerTransactionDB,
    FinanceBankAccountDB,
    SalesInvoiceDB,
    BillDB,
    FinanceChequeDB,
    AccountTransferDB,
    SubscriptionDB,
)
from logging_config import get_logger

logger = get_logger("services.export")


def format_csv(headers: List[str], rows: List[List[Any]]) -> bytes:
    """Encodes headers and row data into a UTF-8 with BOM (utf-8-sig) CSV byte buffer."""
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(headers)
    for row in rows:
        # Normalize None to empty string and format floats cleanly
        clean_row = []
        for cell in row:
            if cell is None:
                clean_row.append("")
            elif isinstance(cell, float):
                clean_row.append(f"{cell:.2f}" if cell % 1 != 0 else f"{cell:.0f}")
            else:
                clean_row.append(str(cell))
        writer.writerow(clean_row)

    return output.getvalue().encode("utf-8-sig")


def get_employees_export_data() -> Tuple[List[str], List[List[Any]]]:
    """Extracts all employee records with compensation, leave balances, and banking information."""
    headers = [
        "Employee ID",
        "Full Name",
        "Email",
        "Role",
        "Department",
        "Job Role",
        "Employment State",
        "Status",
        "Join Date",
        "Next Raise Date",
        "Internal Salary USD",
        "External Salary USD",
        "Total Salary USD",
        "Vacation Total Days",
        "Vacation Used Days",
        "Vacation Remaining Days",
        "Invoice ID",
        "Address Line 1",
        "Address Line 2",
        "Bank Name",
        "IBAN",
        "Swift Code",
    ]

    rows = []
    with get_db_context() as db:
        employees = db.query(EmployeeDB).order_by(EmployeeDB.id.asc()).all()
        for emp in employees:
            bank = emp.bank_account
            vac_total = int(emp.vac_total or 0)
            vac_used = int(emp.vac_used or 0)
            vac_rem = max(vac_total - vac_used, 0)
            internal_sal = float(emp.internal_salary_usd or 0.0)
            external_sal = float(emp.external_salary_usd or 0.0)
            total_sal = float(emp.salary or (internal_sal + external_sal))

            row = [
                emp.id,
                emp.name or "",
                emp.email or "",
                emp.role or "employee",
                emp.dept or "",
                emp.job_role or "",
                emp.employment_state or "Full-Time",
                emp.status or "Active",
                emp.join_date or "",
                emp.next_raise or "",
                internal_sal,
                external_sal,
                total_sal,
                vac_total,
                vac_used,
                vac_rem,
                emp.invoice_id or "",
                emp.address_line_1 or "",
                emp.address_line_2 or "",
                bank.bank_name if bank else "",
                bank.iban if bank else "",
                bank.swift_code if bank else "",
            ]
            rows.append(row)

    logger.info("Generated employees export data: %d rows", len(rows))
    return headers, rows


def get_insurance_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts medical insurance claims with period and status filtering."""
    headers = [
        "Claim ID",
        "Employee ID",
        "Employee Name",
        "Category",
        "Healthcare Provider",
        "Amount USD",
        "Service Date",
        "Status",
        "Submitted By",
        "Document URL",
    ]

    rows = []
    with get_db_context() as db:
        query = db.query(InsuranceClaimDB)

        if year:
            query = query.filter(InsuranceClaimDB.date.like(f"{year}-%"))
        if start_date:
            query = query.filter(InsuranceClaimDB.date >= start_date)
        if end_date:
            query = query.filter(InsuranceClaimDB.date <= end_date)
        if status and status.lower() != "all":
            query = query.filter(InsuranceClaimDB.status == status)

        claims = query.order_by(InsuranceClaimDB.date.desc(), InsuranceClaimDB.id.desc()).all()
        for claim in claims:
            emp_name = claim.employee_name
            if not emp_name and claim.employee:
                emp_name = claim.employee.name

            row = [
                claim.id,
                claim.employee_id,
                emp_name or "",
                claim.category or "",
                claim.provider or "",
                float(claim.amount or 0.0),
                claim.date or "",
                claim.status or "Pending",
                claim.submitted_by or "",
                claim.document_url or "",
            ]
            rows.append(row)

    logger.info("Generated insurance export data: %d rows (year=%s)", len(rows), year)
    return headers, rows


def get_salary_history_export_data() -> Tuple[List[str], List[List[Any]]]:
    """Extracts compensation raise and adjustment history."""
    headers = [
        "History ID",
        "Employee ID",
        "Employee Name",
        "Effective Date",
        "Previous Salary USD",
        "New Salary USD",
        "Salary Delta USD",
        "Pct Change",
        "Previous Internal USD",
        "New Internal USD",
        "Previous External USD",
        "New External USD",
        "Reason / Note",
        "Applied By",
    ]

    rows = []
    with get_db_context() as db:
        records = (
            db.query(SalaryHistoryDB, EmployeeDB.name)
            .outerjoin(EmployeeDB, SalaryHistoryDB.employee_id == EmployeeDB.id)
            .order_by(SalaryHistoryDB.date.desc(), SalaryHistoryDB.id.desc())
            .all()
        )
        for hist, emp_name in records:
            prev_total = float(hist.previous_salary or 0.0)
            new_total = float(hist.new_salary or 0.0)
            delta = new_total - prev_total

            row = [
                hist.id,
                hist.employee_id,
                emp_name or "",
                hist.date or "",
                prev_total,
                new_total,
                delta,
                hist.pct_change or "",
                float(hist.previous_internal_usd or 0.0),
                float(hist.new_internal_usd or 0.0),
                float(hist.previous_external_usd or 0.0),
                float(hist.new_external_usd or 0.0),
                hist.reason or "",
                hist.applied_by or "",
            ]
            rows.append(row)

    logger.info("Generated salary history export data: %d rows", len(rows))
    return headers, rows


def get_vacations_export_data(year: Optional[int] = None) -> Tuple[List[str], List[List[Any]]]:
    """Extracts leave requests and vacation history."""
    headers = [
        "Request ID",
        "Employee ID",
        "Employee Name",
        "Leave Type",
        "Start Date",
        "End Date",
        "Days Count",
        "Status",
        "Submitted By",
    ]

    rows = []
    with get_db_context() as db:
        query = (
            db.query(VacationHistoryDB, EmployeeDB.name)
            .outerjoin(EmployeeDB, VacationHistoryDB.employee_id == EmployeeDB.id)
        )
        if year:
            query = query.filter(VacationHistoryDB.start_date.like(f"{year}-%"))

        records = query.order_by(VacationHistoryDB.start_date.desc(), VacationHistoryDB.id.desc()).all()
        for vac, emp_name in records:
            row = [
                vac.id,
                vac.employee_id,
                emp_name or "",
                vac.type or "Vacation",
                vac.start_date or "",
                vac.end_date or "",
                int(vac.days or 0),
                vac.status or "Approved",
                vac.submitted_by or "",
            ]
            rows.append(row)

    logger.info("Generated vacations export data: %d rows", len(rows))
    return headers, rows


def get_invoices_export_data(
    year: Optional[int] = None,
    month: Optional[int] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts external contractor invoice generation history."""
    headers = [
        "Invoice ID",
        "Invoice Number",
        "Employee ID",
        "Employee Name",
        "Payment Period",
        "Invoice Date",
        "Amount USD",
        "Currency",
        "Status",
        "Document Name",
        "Drive URL",
        "Generated By",
        "Created At",
    ]

    rows = []
    with get_db_context() as db:
        query = db.query(InvoiceDB)
        if year:
            query = query.filter(InvoiceDB.payment_year == year)
        if month:
            query = query.filter(InvoiceDB.payment_month == month)

        invoices = query.order_by(InvoiceDB.payment_year.desc(), InvoiceDB.payment_month.desc(), InvoiceDB.id.desc()).all()
        for inv in invoices:
            period = f"{inv.payment_year}-{inv.payment_month:02d}" if inv.payment_year and inv.payment_month else ""
            created_str = inv.created_at.strftime("%Y-%m-%d %H:%M:%S") if inv.created_at else ""

            row = [
                inv.id,
                inv.invoice_number or "",
                inv.employee_id,
                inv.employee_name or "",
                period,
                inv.invoice_date or "",
                float(inv.amount_usd or 0.0),
                inv.currency or "USD",
                inv.status or "generated",
                inv.document_name or "",
                inv.drive_web_url or "",
                inv.generated_by or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated invoices export data: %d rows", len(rows))
    return headers, rows


def get_finance_ledger_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts continuous general ledger transactions."""
    headers = [
        "Transaction ID",
        "Date",
        "Account Name",
        "Account Type",
        "Currency",
        "Category",
        "Payment Type",
        "Description",
        "Direction",
        "Amount",
        "Running Balance",
        "Reference",
        "Counterparty",
        "Cheque Number",
        "Source",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        query = db.query(LedgerTransactionDB)
        if year:
            query = query.filter(LedgerTransactionDB.date.like(f"{year}-%"))
        if start_date:
            query = query.filter(LedgerTransactionDB.date >= start_date)
        if end_date:
            query = query.filter(LedgerTransactionDB.date <= end_date)

        txs = query.order_by(LedgerTransactionDB.date.asc(), LedgerTransactionDB.id.asc()).all()
        for tx in txs:
            acc_name = tx.account.account_name if tx.account else f"Account #{tx.account_id}"
            acc_type = tx.account.account_type if tx.account else "bank"
            cat_name = tx.category.name if tx.category else ""
            pt_name = tx.payment_type.name if tx.payment_type else ""
            created_str = tx.created_at.strftime("%Y-%m-%d %H:%M:%S") if tx.created_at else ""

            row = [
                tx.id,
                tx.date or "",
                acc_name,
                acc_type.upper(),
                tx.currency or "USD",
                cat_name,
                pt_name,
                tx.description or "",
                tx.direction or "",
                float(tx.amount or 0.0),
                float(tx.running_balance or 0.0),
                tx.reference or "",
                tx.counterparty or "",
                tx.cheque_number or "",
                tx.source or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_ledger export data: %d rows", len(rows))
    return headers, rows


def get_finance_accounts_export_data() -> Tuple[List[str], List[List[Any]]]:
    """Extracts company bank and cash accounts."""
    headers = [
        "Account ID",
        "Account Name",
        "Account Type",
        "Bank Name",
        "Account Number",
        "Currency",
        "Country",
        "Opening Balance",
        "Opening Balance Date",
        "Current Balance",
        "Status",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        accs = db.query(FinanceBankAccountDB).order_by(FinanceBankAccountDB.id.asc()).all()
        for a in accs:
            created_str = a.created_at.strftime("%Y-%m-%d %H:%M:%S") if a.created_at else ""
            row = [
                a.id,
                a.account_name or "",
                (a.account_type or "bank").upper(),
                a.bank_name or "",
                a.account_number or "",
                a.currency or "USD",
                a.country or "",
                float(a.opening_balance or 0.0),
                a.opening_balance_date or "",
                float(a.current_balance or 0.0),
                "Active" if a.is_active else "Inactive",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_accounts export data: %d rows", len(rows))
    return headers, rows


def get_finance_invoices_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts customer sales invoices."""
    headers = [
        "Invoice ID",
        "Invoice Number",
        "Customer Name",
        "Issue Date",
        "Due Date",
        "Status",
        "Currency",
        "Subtotal",
        "Tax Amount",
        "Total",
        "Amount Paid",
        "Balance Due",
        "Revenue Channel",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        query = db.query(SalesInvoiceDB)
        if year:
            query = query.filter(SalesInvoiceDB.issue_date.like(f"{year}-%"))
        if start_date:
            query = query.filter(SalesInvoiceDB.issue_date >= start_date)
        if end_date:
            query = query.filter(SalesInvoiceDB.issue_date <= end_date)
        if status:
            query = query.filter(SalesInvoiceDB.status == status.lower())

        invoices = query.order_by(SalesInvoiceDB.issue_date.desc(), SalesInvoiceDB.id.desc()).all()
        for inv in invoices:
            cust_name = inv.customer.name if inv.customer else ""
            created_str = inv.created_at.strftime("%Y-%m-%d %H:%M:%S") if inv.created_at else ""
            balance = float((inv.total or 0.0) - (inv.amount_paid or 0.0))

            row = [
                inv.id,
                inv.invoice_number or "",
                cust_name,
                inv.issue_date or "",
                inv.due_date or "",
                (inv.status or "draft").upper(),
                inv.currency or "USD",
                float(inv.subtotal or 0.0),
                float(inv.tax_amount or 0.0),
                float(inv.total or 0.0),
                float(inv.amount_paid or 0.0),
                balance,
                inv.revenue_channel or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_invoices export data: %d rows", len(rows))
    return headers, rows


def get_finance_bills_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts vendor bills and accounts payable."""
    headers = [
        "Bill ID",
        "Bill Number",
        "Vendor Name",
        "Issue Date",
        "Due Date",
        "Status",
        "Currency",
        "Subtotal",
        "Tax Amount",
        "Total",
        "Amount Paid",
        "Balance Due",
        "Payment Method",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        query = db.query(BillDB)
        if year:
            query = query.filter(BillDB.issue_date.like(f"{year}-%"))
        if start_date:
            query = query.filter(BillDB.issue_date >= start_date)
        if end_date:
            query = query.filter(BillDB.issue_date <= end_date)
        if status:
            query = query.filter(BillDB.status == status.lower())

        bills = query.order_by(BillDB.issue_date.desc(), BillDB.id.desc()).all()
        for b in bills:
            vendor_name = b.vendor.name if b.vendor else ""
            created_str = b.created_at.strftime("%Y-%m-%d %H:%M:%S") if b.created_at else ""
            balance = float((b.total or 0.0) - (b.amount_paid or 0.0))

            row = [
                b.id,
                b.bill_number or "",
                vendor_name,
                b.issue_date or "",
                b.due_date or "",
                (b.status or "draft").upper(),
                b.currency or "USD",
                float(b.subtotal or 0.0),
                float(b.tax_amount or 0.0),
                float(b.total or 0.0),
                float(b.amount_paid or 0.0),
                balance,
                b.payment_method or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_bills export data: %d rows", len(rows))
    return headers, rows


def get_finance_cheques_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    status: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts cheque register records."""
    headers = [
        "Cheque ID",
        "Cheque Number",
        "Bank Account",
        "Payee",
        "Issue Date",
        "Clear Date",
        "Amount",
        "Currency",
        "Status",
        "Purpose Type",
        "Signer",
        "Notes",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        query = db.query(FinanceChequeDB)
        if year:
            query = query.filter(FinanceChequeDB.issue_date.like(f"{year}-%"))
        if start_date:
            query = query.filter(FinanceChequeDB.issue_date >= start_date)
        if end_date:
            query = query.filter(FinanceChequeDB.issue_date <= end_date)
        if status:
            query = query.filter(FinanceChequeDB.status == status.lower())

        cheques = query.order_by(FinanceChequeDB.issue_date.desc(), FinanceChequeDB.id.desc()).all()
        for c in cheques:
            acc_name = c.account.account_name if c.account else ""
            created_str = c.created_at.strftime("%Y-%m-%d %H:%M:%S") if c.created_at else ""

            row = [
                c.id,
                c.cheque_number or "",
                acc_name,
                c.payee or "",
                c.issue_date or "",
                c.clear_date or "",
                float(c.amount or 0.0),
                c.currency or "USD",
                (c.status or "issued").upper(),
                c.purpose_type or "",
                c.signer_name or "",
                c.notes or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_cheques export data: %d rows", len(rows))
    return headers, rows


def get_finance_transfers_export_data(
    year: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Tuple[List[str], List[List[Any]]]:
    """Extracts inter-account transfers."""
    headers = [
        "Transfer ID",
        "Date",
        "From Account",
        "From Amount",
        "From Currency",
        "To Account",
        "To Amount",
        "To Currency",
        "Exchange Rate",
        "Fee",
        "Transfer Type",
        "Reference",
        "Settlement Status",
        "Note",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        query = db.query(AccountTransferDB)
        if year:
            query = query.filter(AccountTransferDB.date.like(f"{year}-%"))
        if start_date:
            query = query.filter(AccountTransferDB.date >= start_date)
        if end_date:
            query = query.filter(AccountTransferDB.date <= end_date)

        transfers = query.order_by(AccountTransferDB.date.desc(), AccountTransferDB.id.desc()).all()
        for t in transfers:
            from_acc = t.from_account.account_name if t.from_account else ""
            to_acc = t.to_account.account_name if t.to_account else ""
            created_str = t.created_at.strftime("%Y-%m-%d %H:%M:%S") if t.created_at else ""

            row = [
                t.id,
                t.date or "",
                from_acc,
                float(t.from_amount or 0.0),
                t.from_currency or "USD",
                to_acc,
                float(t.to_amount or 0.0),
                t.to_currency or "USD",
                float(t.fx_rate) if t.fx_rate else 1.0,
                float(t.fee or 0.0),
                t.transfer_type or "internal",
                t.exchange_reference or "",
                (t.settlement_status or "settled").upper(),
                t.note or "",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_transfers export data: %d rows", len(rows))
    return headers, rows


def get_finance_subscriptions_export_data() -> Tuple[List[str], List[List[Any]]]:
    """Extracts software subscriptions and SaaS tools."""
    headers = [
        "Subscription ID",
        "Tool / Name",
        "Vendor",
        "Amount",
        "Currency",
        "Billing Cycle",
        "Monthly Equivalent",
        "Department",
        "Owner",
        "Payment Method",
        "Payment Account",
        "Next Renewal Date",
        "Status",
        "Created At",
    ]
    rows = []
    with get_db_context() as db:
        subs = db.query(SubscriptionDB).order_by(SubscriptionDB.id.asc()).all()
        for s in subs:
            vendor_name = s.vendor.name if s.vendor else ""
            acc_name = s.payment_account.account_name if s.payment_account else ""
            created_str = s.created_at.strftime("%Y-%m-%d %H:%M:%S") if s.created_at else ""

            row = [
                s.id,
                s.name or "",
                vendor_name,
                float(s.amount or 0.0),
                s.currency or "USD",
                s.billing_cycle or "monthly",
                float(s.monthly_equivalent_amount or s.amount or 0.0),
                s.department or "",
                s.owner or "",
                s.payment_method or "",
                acc_name,
                s.next_renewal_date or "",
                "Active" if s.is_active else "Inactive",
                created_str,
            ]
            rows.append(row)

    logger.info("Generated finance_subscriptions export data: %d rows", len(rows))
    return headers, rows


DATASET_EXTRACTORS = {
    "employees": get_employees_export_data,
    "insurance": get_insurance_export_data,
    "salary": get_salary_history_export_data,
    "vacations": get_vacations_export_data,
    "invoices": get_invoices_export_data,
    "finance_ledger": get_finance_ledger_export_data,
    "finance_accounts": get_finance_accounts_export_data,
    "finance_invoices": get_finance_invoices_export_data,
    "finance_bills": get_finance_bills_export_data,
    "finance_cheques": get_finance_cheques_export_data,
    "finance_transfers": get_finance_transfers_export_data,
    "finance_subscriptions": get_finance_subscriptions_export_data,
}


def export_to_google_sheets(worksheet_title: str, headers: List[str], rows: List[List[Any]]) -> dict:
    """Delegates writing dataset headers and rows to Google Sheets via sheets_client."""
    import sheets_client
    client = sheets_client.get_client()
    return client.export_to_worksheet(title=worksheet_title, headers=headers, rows=rows)

