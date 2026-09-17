"""
be/tests/test_finance_bill_attachments.py
Integration and unit tests for FUX-407: Bill document storage, attachment streaming,
detachment, and repository view filtering.
"""
import io
import pytest


def test_bill_attachment_lifecycle(app_client, admin_cookies, employee_cookies):
    # 1. Create vendor and bill
    vend_resp = app_client.post(
        "/api/finance/vendors",
        json={"name": "Attachment Test Vendor", "category": "Legal & Professional"},
        cookies=admin_cookies,
    )
    assert vend_resp.status_code == 201
    vendor_id = vend_resp.json()["id"]

    bill_resp = app_client.post(
        "/api/finance/bills",
        json={
            "vendor_id": vendor_id,
            "bill_number": "BILL-ATT-001",
            "category": "Legal & Professional",
            "issue_date": "2026-09-10",
            "due_date": "2026-10-10",
            "status": "needs_coding",
            "currency": "USD",
            "lines": [{"description": "Retainer", "quantity": 1.0, "unit_price": 1200.0, "line_total": 1200.0}],
        },
        cookies=admin_cookies,
    )
    assert bill_resp.status_code == 201
    bill_id = bill_resp.json()["id"]

    # 2. Initially bill has no attachment
    assert bill_resp.json()["attachment_url"] is None
    assert bill_resp.json()["attachment_name"] is None
    assert bill_resp.json()["file_fingerprint"] is None

    # Get attachment should return 404
    no_att_resp = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert no_att_resp.status_code == 404

    # 3. RBAC Check: Unauthorized / read-only role attempting upload/delete
    file_bytes = b"%PDF-1.4 sample bill attachment binary content"
    files = {"file": ("vendor_invoice.pdf", io.BytesIO(file_bytes), "application/pdf")}

    # Unauthenticated upload -> 401
    unauth_resp = app_client.post(f"/api/finance/bills/{bill_id}/attachment", files=files)
    assert unauth_resp.status_code == 401

    # Employee without finance.bill.write -> 403
    files["file"] = ("vendor_invoice.pdf", io.BytesIO(file_bytes), "application/pdf")
    forbidden_resp = app_client.post(f"/api/finance/bills/{bill_id}/attachment", files=files, cookies=employee_cookies)
    assert forbidden_resp.status_code == 403

    # 4. Admin uploads attachment -> 200
    files["file"] = ("vendor_invoice.pdf", io.BytesIO(file_bytes), "application/pdf")
    upload_resp = app_client.post(f"/api/finance/bills/{bill_id}/attachment", files=files, cookies=admin_cookies)
    assert upload_resp.status_code == 200
    updated_bill = upload_resp.json()
    assert updated_bill["attachment_name"] == "vendor_invoice.pdf"
    assert updated_bill["attachment_url"] is not None
    assert updated_bill["file_fingerprint"] is not None

    # 5. Stream/download attachment -> 200 with matching bytes
    download_resp = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert download_resp.status_code == 200
    assert download_resp.content == file_bytes
    assert "vendor_invoice.pdf" in download_resp.headers.get("content-disposition", "")

    # 6. Repository filter check: has_attachment
    # Filter with has_attachment=true
    with_att_resp = app_client.get("/api/finance/bills?has_attachment=true", cookies=admin_cookies)
    assert with_att_resp.status_code == 200
    bills_with = with_att_resp.json()
    assert any(b["id"] == bill_id for b in bills_with)
    assert all(b["attachment_name"] is not None for b in bills_with)

    # Filter with has_attachment=false
    no_att_list_resp = app_client.get("/api/finance/bills?has_attachment=false", cookies=admin_cookies)
    assert no_att_list_resp.status_code == 200
    bills_without = no_att_list_resp.json()
    assert not any(b["id"] == bill_id for b in bills_without)
    assert all(b["attachment_name"] is None for b in bills_without)

    # 7. Check Entity Activity Timeline & Drawer Attachments
    act_resp = app_client.get(f"/api/finance/activity/bill/{bill_id}", cookies=admin_cookies)
    assert act_resp.status_code == 200
    act_data = act_resp.json()
    assert len(act_data["attachments"]) == 1
    assert act_data["attachments"][0]["file_name"] == "vendor_invoice.pdf"
    assert act_data["attachments"][0]["storage_ref"] == f"/api/finance/bills/{bill_id}/attachment"

    # 8. Delete attachment
    del_resp = app_client.delete(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert del_resp.status_code == 200
    deleted_bill = del_resp.json()
    assert deleted_bill["attachment_name"] is None
    assert deleted_bill["attachment_url"] is None
    assert deleted_bill["file_fingerprint"] is None

    # Get attachment after delete -> 404
    after_del_resp = app_client.get(f"/api/finance/bills/{bill_id}/attachment", cookies=admin_cookies)
    assert after_del_resp.status_code == 404
