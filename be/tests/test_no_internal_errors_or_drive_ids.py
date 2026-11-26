"""
be/tests/test_no_internal_errors_or_drive_ids.py
Internal error text never reaches the browser and Drive IDs never reach the logs (audit 2026-11, M-7 and M-8).
"""
import base64
import io
import logging

import logging_config

SECRET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456"
GOOGLE_ERROR = (f"<HttpError 404 when requesting https://www.googleapis.com/drive/v3/files/{SECRET_ID}?alt=media "
                f"returned \"File not found: {SECRET_ID}.\">")


def _pdf():
    return "data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4\ntest content").decode()


def _capture_logs():
    """Collects what the app's handlers would write, through the same redacting formatter."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging_config._RedactingFormatter("%(message)s"))
    logging.getLogger("hrflow").addHandler(handler)
    return stream, handler


def test_a_drive_failure_answers_without_the_google_error_or_the_file_id(app_client, admin_cookies, fake_drive_client):
    up = app_client.post("/api/employees/2/documents", json={"name": "Contract", "file_type": "pdf", "data_url": _pdf()},
                         cookies=admin_cookies)
    assert up.status_code == 201, up.text
    doc_id = up.json()["id"]

    def broken_download(file_id):
        raise RuntimeError(GOOGLE_ERROR)

    fake_drive_client.download_file = broken_download
    stream, handler = _capture_logs()
    try:
        res = app_client.get(f"/api/employees/documents/{doc_id}/stream", cookies=admin_cookies)
    finally:
        logging.getLogger("hrflow").removeHandler(handler)

    assert res.status_code == 502
    assert SECRET_ID not in res.text and "HttpError" not in res.text and "googleapis" not in res.text
    logged = stream.getvalue()
    assert "Failed to stream document" in logged          # the failure is still logged, with its traceback
    assert SECRET_ID not in logged and "fake-drive-file-" not in logged


def test_uploads_and_deletes_log_a_fingerprint_not_the_drive_id(app_client, admin_cookies):
    stream, handler = _capture_logs()
    try:
        up = app_client.post("/api/company-documents", json={"name": "Handbook", "file_type": "pdf", "category": "Policy",
                                                     "data_url": _pdf()}, cookies=admin_cookies)
        assert up.status_code == 201, up.text
        assert app_client.delete(f"/api/company-documents/{up.json()['id']}", cookies=admin_cookies).status_code == 200
    finally:
        logging.getLogger("hrflow").removeHandler(handler)
    logged = stream.getvalue()
    assert "fake-drive-company-file-" not in logged
    assert "ref:" in logged


def test_redact_ref_is_stable_and_hides_the_value():
    a, b = logging_config.redact_ref(SECRET_ID), logging_config.redact_ref(SECRET_ID)
    assert a == b and a.startswith("ref:") and SECRET_ID not in a
    assert logging_config.redact_ref(None) == "-"


def test_the_formatter_scrubs_drive_ids_from_google_error_text():
    record = logging.LogRecord("hrflow.x", logging.ERROR, __file__, 1, "Drive said: %s", (GOOGLE_ERROR,), None)
    out = logging_config._RedactingFormatter("%(message)s").format(record)
    assert SECRET_ID not in out and out.count("<redacted>") == 2
