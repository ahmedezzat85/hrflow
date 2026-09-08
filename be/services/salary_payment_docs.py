"""
services/salary_payment_docs.py
Business logic for automated external-salary "Consultant Fees" payment receipt
document generation (docs/analysis/invoice-autopay-plan.md). Renders the approved
Word template with docxtpl, uploads the result to a global Google Drive
"Invoices" folder (organized by year/month, separate from per-employee
folders), and records one salary_payment_docs row per attempt so that:

- A given employee can never have duplicate documents generated for the same payment
  period through normal generation actions (idempotency).
- Every generated document keeps a durable audit trail: the exact salary
  amount used, the Drive file location, who triggered it, and when.

Eligibility rule (all three required):
  1. external_salary_usd > 0 for the employee
  2. employee.invoice_id is present (two-digit numeric string, "01"-"99")
  3. employee.address_line_1 is present

Document number format: YYIIMM
  YY = last two digits of payment_year
  II = employee's two-digit invoice_id
  MM = two-digit payment_month
e.g. payment 2026-08, invoice_id "02" -> "260208".
"""
import io
import os
import re
from datetime import datetime, timezone
from typing import Optional, Tuple

from docxtpl import DocxTemplate

import drive_client
from config import Config
from logging_config import get_logger

logger = get_logger("salary_payment_docs")

MONTH_NAMES = [
    "", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]


class SalaryPaymentDocEligibilityError(Exception):
    """Raised when an employee does not qualify for document generation.
    The message is the exact skip reason surfaced to the caller."""


InvoiceEligibilityError = SalaryPaymentDocEligibilityError


def format_salary_payment_doc_number(payment_year: int, invoice_id: str, payment_month: int) -> str:
    yy = f"{payment_year % 100:02d}"
    ii = f"{int(invoice_id):02d}"
    mm = f"{payment_month:02d}"
    return f"{yy}{ii}{mm}"


format_invoice_number = format_salary_payment_doc_number


def format_usd_amount(amount: float) -> str:
    return f"${amount:,.2f}"


def format_document_date(dt: datetime) -> str:
    return dt.strftime("%d/%m/%Y")


format_invoice_date = format_document_date


def format_due_date(dt: datetime) -> str:
    day = dt.day
    month_name = MONTH_NAMES[dt.month]
    year = dt.year
    return f"{day} {month_name} {year}"


def format_consultant_description(payment_year: int, payment_month: int) -> str:
    month_name = MONTH_NAMES[payment_month]
    return f"CONSULTANT FEES FOR {month_name} {payment_year}"


def build_document_name(invoice_number: str, employee_name: str) -> str:
    clean_name = employee_name.strip().replace(" ", "_").upper()
    clean_name = re.sub(r"[^A-Z0-9_]", "", clean_name)
    return f"Invoice_{clean_name}_{invoice_number}.docx"


def check_eligibility(employee: dict) -> str:
    ext_salary = employee.get("external_salary_usd")
    if ext_salary is None or ext_salary == "":
        raise SalaryPaymentDocEligibilityError("external salary is zero or missing")
    try:
        val = float(ext_salary)
        if val <= 0:
            raise SalaryPaymentDocEligibilityError("external salary is zero or negative")
    except (TypeError, ValueError):
        raise SalaryPaymentDocEligibilityError("external salary is zero or missing")

    raw_inv_id = employee.get("invoice_id")
    if raw_inv_id is None or str(raw_inv_id).strip() == "":
        raise SalaryPaymentDocEligibilityError("invoice_id is missing")
    try:
        n = int(str(raw_inv_id).strip())
        if n < 1 or n > 99:
            raise SalaryPaymentDocEligibilityError(f"invoice_id must be between 01 and 99 (got {raw_inv_id})")
    except ValueError:
        raise SalaryPaymentDocEligibilityError(f"invoice_id must be numeric (got {raw_inv_id})")

    addr1 = employee.get("address_line_1")
    if not addr1 or not str(addr1).strip():
        raise SalaryPaymentDocEligibilityError("address_line_1 is missing")

    return f"{n:02d}"


def build_template_context(employee: dict, payment_year: int, payment_month: int, now: Optional[datetime] = None) -> dict:
    if now is None:
        now = datetime.now(timezone.utc)
    raw_inv_id = str(employee.get("invoice_id", "")).strip()
    doc_number = format_salary_payment_doc_number(payment_year, raw_inv_id, payment_month)
    amount_num = float(employee.get("external_salary_usd", 0.0))

    addr1 = (employee.get("address_line_1") or "").strip()
    addr2 = (employee.get("address_line_2") or "").strip()
    address_display = f"{addr1}\n{addr2}" if addr2 else addr1

    return {
        "invoice_number": doc_number,
        "invoice_date": format_document_date(now),
        "due_date": format_due_date(now),
        "employee_name": (employee.get("name") or "").strip(),
        "employee_address": address_display,
        "consultant_description": format_consultant_description(payment_year, payment_month),
        "amount": format_usd_amount(amount_num),
        "total_amount": format_usd_amount(amount_num),
    }


def render_invoice_document(context: dict) -> bytes:
    template_path = Config.INVOICE_TEMPLATE_PATH
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Invoice template not found at {template_path}")
    doc = DocxTemplate(template_path)
    doc.render(context)
    bio = io.BytesIO()
    doc.save(bio)
    return bio.getvalue()


render_template_to_bytes = render_invoice_document
render_salary_payment_doc = render_invoice_document


def find_existing_salary_payment_doc(
    repo_or_client,
    employee_id: int,
    payment_year: int,
    payment_month: int,
) -> Optional[dict]:
    if hasattr(repo_or_client, "find_existing"):
        return repo_or_client.find_existing(employee_id, payment_year, payment_month)
    # Legacy fallback if sheet client
    rows = repo_or_client.get_all_records("Invoices")
    for r in rows:
        try:
            if (
                int(r.get("employee_id")) == int(employee_id)
                and int(r.get("payment_year")) == int(payment_year)
                and int(r.get("payment_month")) == int(payment_month)
                and str(r.get("status", "")).lower() == "generated"
            ):
                return r
        except (TypeError, ValueError):
            continue
    return None


find_existing_invoice = find_existing_salary_payment_doc


def generate_salary_payment_doc_for_employee(
    repo_or_client,
    employee: dict,
    payment_year: int,
    payment_month: int,
    generated_by: str,
    skip_existing: bool = True,
) -> dict:
    employee_id = int(employee["id"])
    employee_name = employee.get("name", "")

    try:
        check_eligibility(employee)
    except SalaryPaymentDocEligibilityError as exc:
        logger.info("Skipping employee_id=%s (%s): %s", employee_id, employee_name, exc)
        return {
            "employee_id": employee_id,
            "employee_name": employee_name,
            "status": "skipped",
            "reason": str(exc),
        }

    existing = find_existing_salary_payment_doc(repo_or_client, employee_id, payment_year, payment_month)
    if existing:
        if skip_existing:
            logger.info("Already exists for employee_id=%s, period=%s-%02d; skipping", employee_id, payment_year, payment_month)
            return {
                "employee_id": employee_id,
                "employee_name": employee_name,
                "status": "already_exists",
                "invoice_number": existing.get("invoice_number"),
                "drive_web_url": existing.get("drive_web_url", ""),
            }

    now = datetime.now(timezone.utc)
    raw_inv_id = str(employee.get("invoice_id", "")).strip()
    invoice_number = format_salary_payment_doc_number(payment_year, raw_inv_id, payment_month)
    amount_usd = float(employee.get("external_salary_usd", 0.0))
    invoice_date = format_document_date(now)
    document_name = build_document_name(invoice_number, employee_name)

    context = build_template_context(employee, payment_year, payment_month, now=now)
    try:
        import services.salary_payment_docs as spd_mod
        render_fn = getattr(spd_mod, "render_invoice_document", render_invoice_document)
        file_bytes = render_fn(context)
    except Exception as exc:
        logger.exception("Template render failed for employee_id=%s", employee_id)
        _record_salary_payment_doc(
            repo_or_client, employee_id, employee_name, invoice_number, payment_year, payment_month,
            invoice_date, amount_usd, document_name, drive_file_id="", drive_web_url="",
            status="failed", failure_reason="template render failed", generated_by=generated_by,
        )
        return {
            "employee_id": employee_id, "employee_name": employee_name,
            "status": "failed", "reason": "template render failed",
        }

    pdf_bytes = None
    try:
        from services.pdf_converter import convert_docx_to_pdf_bytes
        pdf_bytes = convert_docx_to_pdf_bytes(file_bytes)
    except Exception:
        logger.exception("PDF conversion post-generation step failed for employee_id=%s; continuing with .docx only", employee_id)

    try:
        drive = drive_client.get_drive_client()
        uploaded = drive.upload_invoice_file(
            payment_year, payment_month, document_name, file_bytes,
            employee_id=employee_id, employee_name=employee_name,
            pdf_bytes=pdf_bytes,
        )
    except Exception as exc:
        logger.exception("Failed to upload document to Drive for employee_id=%s", employee_id)
        _record_salary_payment_doc(
            repo_or_client, employee_id, employee_name, invoice_number, payment_year, payment_month,
            invoice_date, amount_usd, document_name, drive_file_id="", drive_web_url="",
            status="failed", failure_reason=f"drive upload failed: {exc}", generated_by=generated_by,
        )
        return {
            "employee_id": employee_id, "employee_name": employee_name,
            "status": "failed", "reason": "drive upload failed",
        }

    _record_salary_payment_doc(
        repo_or_client, employee_id, employee_name, invoice_number, payment_year, payment_month,
        invoice_date, amount_usd, document_name,
        drive_file_id=uploaded["file_id"], drive_web_url=uploaded.get("view_url", ""),
        status="generated", failure_reason="", generated_by=generated_by,
    )
    logger.info(
        "Generated document_number=%s for employee_id=%s, period=%s-%02d, drive_file_id=%s",
        invoice_number, employee_id, payment_year, payment_month, uploaded["file_id"],
    )
    return {
        "employee_id": employee_id,
        "employee_name": employee_name,
        "status": "generated",
        "invoice_number": invoice_number,
        "drive_web_url": uploaded.get("view_url", ""),
    }


generate_invoice_for_employee = generate_salary_payment_doc_for_employee


def _record_salary_payment_doc(
    repo_or_client, employee_id, employee_name, invoice_number, payment_year, payment_month,
    invoice_date, amount_usd, document_name, drive_file_id, drive_web_url,
    status, failure_reason, generated_by,
):
    row_data = {
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
    }
    existing = find_existing_salary_payment_doc(repo_or_client, employee_id, payment_year, payment_month)
    if existing and existing.get("id") is not None:
        inv_id = existing["id"]
        if hasattr(repo_or_client, "update"):
            repo_or_client.update(inv_id, row_data)
            return inv_id
        elif hasattr(repo_or_client, "update_row_by_match"):
            repo_or_client.update_row_by_match("Invoices", "id", inv_id, row_data)
            return inv_id

    if hasattr(repo_or_client, "create"):
        return repo_or_client.create(row_data)
    elif hasattr(repo_or_client, "next_id"):
        invoice_row_id = repo_or_client.next_id("Invoices")
        repo_or_client.append_row("Invoices", {"id": invoice_row_id, **row_data})
        return invoice_row_id
    else:
        from repositories.deps import get_salary_payment_doc_repo
        repo = get_salary_payment_doc_repo()
        return repo.create(row_data)


_record_invoice = _record_salary_payment_doc


def generate_salary_payment_docs_bulk(
    payment_year: int,
    payment_month: int,
    generated_by: str,
    skip_existing: bool = True,
    invoice_repo=None,
    employee_repo=None,
) -> dict:
    if employee_repo is not None and hasattr(employee_repo, "list_all"):
        employees = employee_repo.list_all()
    else:
        from repositories.deps import get_employee_repo
        emp_repo = get_employee_repo()
        employees = emp_repo.list_all()

    if invoice_repo is None:
        from repositories.deps import get_salary_payment_doc_repo
        repo_or_client = get_salary_payment_doc_repo()
    else:
        repo_or_client = invoice_repo

    results = []
    for emp in employees:
        result = generate_salary_payment_doc_for_employee(
            repo_or_client, emp, payment_year, payment_month, generated_by, skip_existing,
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


generate_invoices_bulk = generate_salary_payment_docs_bulk


def get_salary_payment_doc_pdf_bytes(doc: dict) -> Tuple[bytes, str]:
    """
    Retrieves the PDF bytes and file name for a salary payment document.
    1. If a .pdf file exists in storage for this doc, downloads and returns it.
    2. If only .docx exists, converts it to .pdf on the fly.
    Returns (pdf_bytes, pdf_filename).
    """
    drive_file_id = str(doc.get("drive_file_id") or "")
    doc_name = str(doc.get("document_name") or f"Invoice_{doc.get('invoice_number', 'doc')}.docx")
    pdf_filename = (doc_name[:-5] if doc_name.lower().endswith(".docx") else doc_name) + ".pdf"

    storage_client = drive_client.get_drive_client()

    # 1. Check if storage client is LocalStorageClient and has the .pdf file
    if hasattr(storage_client, "_resolve_secure_path") and drive_file_id:
        pdf_rel_path = (drive_file_id[:-5] if drive_file_id.lower().endswith(".docx") else drive_file_id) + ".pdf"
        try:
            full_pdf_path = storage_client._resolve_secure_path(pdf_rel_path)
            if os.path.isfile(full_pdf_path):
                with open(full_pdf_path, "rb") as f:
                    return f.read(), pdf_filename
        except Exception:
            pass

    # 2. Try to download file from storage and convert
    from services.pdf_converter import convert_docx_to_pdf_bytes
    if drive_file_id:
        try:
            raw_bytes, mime_type, filename = storage_client.download_file(drive_file_id)
            if mime_type == "application/pdf" or filename.lower().endswith(".pdf"):
                return raw_bytes, pdf_filename
            pdf_bytes = convert_docx_to_pdf_bytes(raw_bytes)
            if pdf_bytes:
                return pdf_bytes, pdf_filename
        except Exception as exc:
            logger.warning("Could not download/convert document file %s: %s", drive_file_id, exc)

    raise ValueError(f"PDF version of document {doc.get('invoice_number')} could not be found or converted.")


get_invoice_pdf_bytes = get_salary_payment_doc_pdf_bytes
