"""
services/invoices.py
Business logic for automated external-salary "Consultant Fees" invoice
generation (docs/analysis/invoice-autopay-plan.md). Renders the approved
Word template with docxtpl, uploads the result to a global Google Drive
"Invoices" folder (organized by year/month, separate from per-employee
folders), and records one Invoices sheet row per attempt so that:

- A given employee can never be invoiced twice for the same payment
  period through normal generation actions (idempotency).
- Every generated invoice keeps a durable audit trail: the exact salary
  amount used, the Drive file location, who triggered it, and when.

Eligibility rule (all three required):
  1. external_salary_usd > 0 for the employee
  2. employee.invoice_id is present (two-digit numeric string, "01"-"99")
  3. employee.address_line_1 is present

Invoice number format: YYIIMM
  YY = last two digits of payment_year
  II = employee's two-digit invoice_id
  MM = two-digit payment_month
e.g. payment 2026-08, invoice_id "02" -> "260208".
"""
import io
from datetime import datetime, timezone
from typing import Optional

from docxtpl import DocxTemplate

import sheets_client
import drive_client
from config import Config
from logging_config import get_logger

logger = get_logger("invoices")

MONTH_NAMES = [
    "", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]


class InvoiceEligibilityError(Exception):
    """Raised when an employee does not qualify for invoice generation.
    The message is the exact skip reason surfaced to the caller."""


def format_invoice_number(payment_year: int, invoice_id: str, payment_month: int) -> str:
    yy = f"{payment_year % 100:02d}"
    ii = f"{int(invoice_id):02d}"
    mm = f"{payment_month:02d}"
    return f"{yy}{ii}{mm}"


def format_usd_amount(amount: float) -> str:
    return f"${amount:,.2f}"


def format_invoice_date(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%d/%m/%Y")


def _validate_invoice_id(raw) -> str:
    value = str(raw or "").strip()
    if not value.isdigit() or not (1 <= int(value) <= 99):
        raise InvoiceEligibilityError("invoice_id must be a numeric value between 01 and 99")
    return f"{int(value):02d}"


def check_eligibility(employee: dict) -> str:
    """Validates one employee against the three eligibility rules and
    returns the normalized two-digit invoice_id on success. Raises
    InvoiceEligibilityError with the exact skip reason on failure."""
    external_salary = float(employee.get("external_salary_usd") or 0)
    if external_salary <= 0:
        raise InvoiceEligibilityError("external salary is zero")
    if not str(employee.get("invoice_id") or "").strip():
        raise InvoiceEligibilityError("invoice_id is missing")
    invoice_id = _validate_invoice_id(employee.get("invoice_id"))
    if not str(employee.get("address_line_1") or "").strip():
        raise InvoiceEligibilityError("address_line_1 is missing")
    return invoice_id


def _sanitize_filename_part(value: str) -> str:
    import re
    cleaned = re.sub(r"[^A-Za-z0-9 _-]", "", value or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned or "Employee"


def build_document_name(invoice_number: str, employee_name: str) -> str:
    return f"Invoice_{_sanitize_filename_part(employee_name).upper()}_{invoice_number}.docx"


def find_existing_invoice(client, employee_id, payment_year: int, payment_month: int) -> Optional[dict]:
    invoices = client.get_all_records("Invoices")
    for inv in invoices:
        if (str(inv.get("employee_id")) == str(employee_id)
                and str(inv.get("payment_year")) == str(payment_year)
                and str(inv.get("payment_month")) == str(payment_month)
                and inv.get("status") == "generated"):
            return inv
    return None


def render_invoice_document(context: dict) -> bytes:
    """Renders the configured docxtpl template with the given context and
    returns the resulting .docx file as raw bytes."""
    if not Config.INVOICE_TEMPLATE_PATH:
        raise RuntimeError("INVOICE_TEMPLATE_PATH is not configured")
    doc = DocxTemplate(Config.INVOICE_TEMPLATE_PATH)
    doc.render(context)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def generate_invoice_for_employee(
    client,
    employee: dict,
    payment_year: int,
    payment_month: int,
    generated_by: str,
    skip_existing: bool = True,
) -> dict:
    """
    Generates (or returns the existing) invoice for a single employee and
    payment period. Returns a result dict with at least a "status" key:
    "generated", "already_exists", "skipped", or "failed".
    Never raises for expected business conditions (missing fields, an
    existing invoice, a Drive/render failure) - those are reported in the
    returned dict so a caller can process a full batch without a single
    employee's problem aborting the others.
    """
    employee_id = employee["id"]
    employee_name = employee.get("name", "")

    existing = find_existing_invoice(client, employee_id, payment_year, payment_month)
    if existing:
        if skip_existing:
            logger.info(
                "Invoice already exists for employee_id=%s, period=%s-%02d (invoice_number=%s) - skipping",
                employee_id, payment_year, payment_month, existing.get("invoice_number"),
            )
            return {
                "employee_id": employee_id,
                "employee_name": employee_name,
                "status": "already_exists",
                "invoice_number": existing.get("invoice_number"),
                "drive_web_url": existing.get("drive_web_url"),
            }

    try:
        invoice_id = check_eligibility(employee)
    except InvoiceEligibilityError as exc:
        logger.info("Skipping employee_id=%s: %s", employee_id, exc)
        return {
            "employee_id": employee_id,
            "employee_name": employee_name,
            "status": "skipped",
            "reason": str(exc),
        }

    invoice_number = format_invoice_number(payment_year, invoice_id, payment_month)
    amount_usd = float(employee["external_salary_usd"])
    invoice_date = format_invoice_date()
    current_month = MONTH_NAMES[payment_month]
    document_name = build_document_name(invoice_number, employee_name)

    context = {
        "invoice_number": invoice_number,
        "employee_full_name": employee_name,
        "address_line_1": employee.get("address_line_1", ""),
        "address_line_2": employee.get("address_line_2", ""),
        "invoice_date": invoice_date,
        "current_month": current_month,
        "amount": format_usd_amount(amount_usd),
    }

    try:
        file_bytes = render_invoice_document(context)
    except Exception:
        logger.exception("Failed to render invoice template for employee_id=%s", employee_id)
        _record_invoice(
            client, employee_id, employee_name, invoice_number, payment_year, payment_month,
            invoice_date, amount_usd, document_name, drive_file_id="", drive_web_url="",
            status="failed", failure_reason="template render failed", generated_by=generated_by,
        )
        return {
            "employee_id": employee_id, "employee_name": employee_name,
            "status": "failed", "reason": "template render failed",
        }

    try:
        drive = drive_client.get_drive_client()
        uploaded = drive.upload_invoice_file(
            payment_year, payment_month, document_name, file_bytes,
            employee_id=employee_id, employee_name=employee_name,
        )
    except Exception as exc:
        logger.exception("Failed to upload invoice to Drive for employee_id=%s", employee_id)
        _record_invoice(
            client, employee_id, employee_name, invoice_number, payment_year, payment_month,
            invoice_date, amount_usd, document_name, drive_file_id="", drive_web_url="",
            status="failed", failure_reason=f"drive upload failed: {exc}", generated_by=generated_by,
        )
        return {
            "employee_id": employee_id, "employee_name": employee_name,
            "status": "failed", "reason": "drive upload failed",
        }

    _record_invoice(
        client, employee_id, employee_name, invoice_number, payment_year, payment_month,
        invoice_date, amount_usd, document_name,
        drive_file_id=uploaded["file_id"], drive_web_url=uploaded.get("view_url", ""),
        status="generated", failure_reason="", generated_by=generated_by,
    )
    logger.info(
        "Generated invoice_number=%s for employee_id=%s, period=%s-%02d, drive_file_id=%s",
        invoice_number, employee_id, payment_year, payment_month, uploaded["file_id"],
    )
    return {
        "employee_id": employee_id,
        "employee_name": employee_name,
        "status": "generated",
        "invoice_number": invoice_number,
        "drive_web_url": uploaded.get("view_url", ""),
    }


def _record_invoice(
    client, employee_id, employee_name, invoice_number, payment_year, payment_month,
    invoice_date, amount_usd, document_name, drive_file_id, drive_web_url,
    status, failure_reason, generated_by,
):
    invoice_row_id = client.next_id("Invoices")
    client.append_row("Invoices", {
        "id": invoice_row_id,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "invoice_number": invoice_number,
        "payment_year": payment_year,
        "payment_month": payment_month,
        "invoice_date": invoice_date,
        "amount_usd": amount_usd,
        "currency": "USD",
        "document_name": document_name,
        "drive_file_id": drive_file_id,
        "drive_web_url": drive_web_url,
        "template_version": Config.INVOICE_TEMPLATE_VERSION,
        "status": status,
        "failure_reason": failure_reason,
        "generated_by": generated_by,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
    })


def generate_invoices_bulk(
    payment_year: int, payment_month: int, generated_by: str, skip_existing: bool = True,
) -> dict:
    client = sheets_client.get_client()
    employees = client.get_all_records("Employees")
    results = []
    for emp in employees:
        result = generate_invoice_for_employee(
            client, emp, payment_year, payment_month, generated_by, skip_existing,
        )
        results.append(result)

    summary = {
        "eligible": sum(1 for r in results if r["status"] in ("generated", "already_exists")),
        "generated": sum(1 for r in results if r["status"] == "generated"),
        "already_exists": sum(1 for r in results if r["status"] == "already_exists"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
    }
    return {
        "payment_year": payment_year,
        "payment_month": payment_month,
        "summary": summary,
        "results": results,
    }
