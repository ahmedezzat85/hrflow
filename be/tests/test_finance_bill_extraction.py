"""
be/tests/test_finance_bill_extraction.py
Tests for FUX-413: Vendor Bill PDF extraction and text layer verification.
"""
import io
import pytest
from finance.services.bill_extractor import BillPdfExtractor


# Valid PDF with standard text layer
VALID_PDF_BYTES = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 200 >> stream
BT
/F1 12 Tf
72 700 Td
(Vendor: Acme Cloud Solutions) Tj
0 -20 Td
(Invoice Number: INV-2026-991) Tj
0 -20 Td
(Date: 2026-04-10) Tj
0 -20 Td
(Due Date: 2026-05-10) Tj
0 -20 Td
(Cloud Hosting Subscription 1 450.00 450.00) Tj
0 -20 Td
(Total: 450.00 USD) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000224 00000 n 
0000000293 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
546
%%EOF"""

# PDF with no text stream (simulating image-only / raster scanned document)
BLANK_PDF_BYTES = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer << /Size 4 /Root 1 0 R >>
startxref
190
%%EOF"""


def test_extractor_readable_pdf():
    """BillPdfExtractor extracts fields and confidence from text PDF."""
    res = BillPdfExtractor.parse_document(
        content=VALID_PDF_BYTES,
        filename="invoice_acme.pdf",
        known_vendors=[{"id": 101, "name": "Acme Cloud Solutions"}],
    )
    assert res.is_readable is True
    assert res.extraction_confidence >= 0.70
    assert res.vendor_id == 101
    assert res.vendor_name == "Acme Cloud Solutions"
    assert res.bill_number == "INV-2026-991"
    assert res.issue_date == "2026-04-10"
    assert res.due_date == "2026-05-10"
    assert res.total == 450.0
    assert res.currency == "USD"
    assert len(res.lines) >= 1
    assert res.lines[0].description == "Cloud Hosting Subscription"
    assert res.lines[0].line_total == 450.0
    # Category and department are never fabricated
    assert "category" in res.missing_fields
    assert "department" in res.missing_fields


def test_extractor_scanned_unreadable_pdf():
    """Scanned/blank PDF with no text layer flags is_readable=False with 0 confidence and empty fields."""
    res = BillPdfExtractor.parse_document(
        content=BLANK_PDF_BYTES,
        filename="scanned_receipt.pdf",
    )
    assert res.is_readable is False
    assert res.extraction_confidence == 0.0
    assert res.unreadable_reason is not None
    assert "manual entry required" in res.unreadable_reason.lower()
    assert res.bill_number is None
    assert res.vendor_name is None
    assert res.total is None
    assert len(res.lines) == 0
    assert "total" in res.missing_fields
    assert "bill_number" in res.missing_fields


def test_extractor_corrupt_pdf():
    """Corrupted bytes raise ValueError."""
    with pytest.raises(ValueError) as exc:
        BillPdfExtractor.parse_document(
            content=b"NOT_A_REAL_PDF_STREAM",
            filename="corrupt.pdf",
        )
    assert "corrupted" in str(exc.value).lower()


def test_api_extract_readable_document(app_client, admin_cookies):
    """POST /api/finance/bills/extract returns extracted fields for valid PDF."""
    files = {"file": ("invoice_acme.pdf", io.BytesIO(VALID_PDF_BYTES), "application/pdf")}
    resp = app_client.post(
        "/api/finance/bills/extract",
        files=files,
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_readable"] is True
    assert data["bill_number"] == "INV-2026-991"
    assert data["total"] == 450.0
    assert data["extraction_confidence"] >= 0.70


def test_api_extract_unreadable_scanned_document(app_client, admin_cookies):
    """POST /api/finance/bills/extract detects scanned/blank PDF and flags is_readable=False."""
    files = {"file": ("scanned_invoice.pdf", io.BytesIO(BLANK_PDF_BYTES), "application/pdf")}
    resp = app_client.post(
        "/api/finance/bills/extract",
        files=files,
        cookies=admin_cookies,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_readable"] is False
    assert "manual entry required" in data["unreadable_reason"].lower()
    assert data["extraction_confidence"] == 0.0


def test_api_extract_corrupted_document(app_client, admin_cookies):
    """POST /api/finance/bills/extract returns 400 when file is corrupted."""
    files = {"file": ("corrupt.pdf", io.BytesIO(b"gibberish_bytes"), "application/pdf")}
    resp = app_client.post(
        "/api/finance/bills/extract",
        files=files,
        cookies=admin_cookies,
    )
    assert resp.status_code == 400
    assert "corrupted" in resp.json()["detail"].lower()
