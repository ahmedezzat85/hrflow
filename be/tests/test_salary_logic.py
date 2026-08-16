"""
test_salary_logic.py
Unit tests for pure calculation/formatting logic in be/main.py that don't
require the FastAPI app or a Sheets/Drive connection. See
docs/analysis/security-analysis-plan.md, Phase 5.
"""
from main import _compute_consumption, _safe_content_disposition_filename, _detect_file_signature
import base64


def test_compute_consumption_ok_status_below_threshold():
    employees = [{"id": 1, "name": "Alice"}]
    categories = [{"id": 1, "name": "Dental", "annual_limit": 10000}]
    claims = [{"employee_id": 1, "category": "Dental", "amount": 2000, "status": "Approved"}]
    result = _compute_consumption(employees, categories, claims)
    assert result[0]["total_status"] == "ok"
    assert result[0]["total_pct_used"] == 20.0
    assert result[0]["total_remaining"] == 8000.0


def test_compute_consumption_approaching_threshold():
    employees = [{"id": 1, "name": "Alice"}]
    categories = [{"id": 1, "name": "Dental", "annual_limit": 10000}]
    claims = [{"employee_id": 1, "category": "Dental", "amount": 8500, "status": "Approved"}]
    result = _compute_consumption(employees, categories, claims)
    assert result[0]["total_status"] == "approaching"
    assert result[0]["total_pct_used"] == 85.0


def test_compute_consumption_limit_reached():
    employees = [{"id": 1, "name": "Alice"}]
    categories = [{"id": 1, "name": "Dental", "annual_limit": 10000}]
    claims = [{"employee_id": 1, "category": "Dental", "amount": 10000, "status": "Approved"}]
    result = _compute_consumption(employees, categories, claims)
    assert result[0]["total_status"] == "limit_reached"
    assert result[0]["total_remaining"] == 0.0


def test_compute_consumption_ignores_pending_and_rejected_claims():
    employees = [{"id": 1, "name": "Alice"}]
    categories = [{"id": 1, "name": "Dental", "annual_limit": 10000}]
    claims = [
        {"employee_id": 1, "category": "Dental", "amount": 9999, "status": "Pending"},
        {"employee_id": 1, "category": "Dental", "amount": 9999, "status": "Rejected"},
    ]
    result = _compute_consumption(employees, categories, claims)
    assert result[0]["total_consumed"] == 0.0
    assert result[0]["total_status"] == "ok"


def test_compute_consumption_separates_claims_by_employee():
    employees = [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]
    categories = [{"id": 1, "name": "Dental", "annual_limit": 10000}]
    claims = [
        {"employee_id": 1, "category": "Dental", "amount": 1000, "status": "Approved"},
        {"employee_id": 2, "category": "Dental", "amount": 9000, "status": "Approved"},
    ]
    result = _compute_consumption(employees, categories, claims)
    by_name = {r["employee_name"]: r for r in result}
    assert by_name["Alice"]["total_consumed"] == 1000.0
    assert by_name["Bob"]["total_consumed"] == 9000.0


def test_content_disposition_filename_strips_injection_characters():
    malicious = 'evil"; filename="hacked.exe'
    safe = _safe_content_disposition_filename(malicious)
    assert '"' not in safe
    assert ";" not in safe


def test_content_disposition_filename_strips_crlf():
    malicious = "report.pdf\r\nSet-Cookie: evil=1"
    safe = _safe_content_disposition_filename(malicious)
    assert "\r" not in safe and "\n" not in safe


def test_content_disposition_filename_falls_back_to_document():
    assert _safe_content_disposition_filename('\r\n"\\') == "document"


def test_content_disposition_filename_preserves_normal_names():
    safe = _safe_content_disposition_filename("Q3 Report.pdf")
    assert "Report.pdf" in safe


def _data_url(raw_bytes):
    return "data:application/octet-stream;base64," + base64.b64encode(raw_bytes).decode()


def test_detect_file_signature_recognizes_pdf():
    assert _detect_file_signature(_data_url(b"%PDF-1.4\nrest of file")) == "pdf"


def test_detect_file_signature_recognizes_jpeg():
    assert _detect_file_signature(_data_url(b"\xff\xd8\xff\xe0" + b"\x00" * 20)) == "image"


def test_detect_file_signature_recognizes_png():
    assert _detect_file_signature(_data_url(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)) == "image"


def test_detect_file_signature_rejects_disguised_html():
    malicious = b"<html><body><script>alert(document.cookie)</script></body></html>"
    assert _detect_file_signature(_data_url(malicious)) == "unknown"


def test_detect_file_signature_rejects_garbage():
    assert _detect_file_signature(_data_url(b"not a real file at all")) == "unknown"
