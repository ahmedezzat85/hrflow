"""
test_finance_mcp_records.py
FM-2 of the finance MCP tools, end to end on the FM-1 seeded dataset plus vendors, bills, a cheque and an import
batch: transfers, bills, cheques, reference data and import-batch tools, the new read-only batch routes, and that
nothing is written.
"""
import json
from datetime import datetime

import pytest

from db import get_db_context
from finance.models import BillDB, FinanceBankAccountDB, FinanceChequeDB, ImportBatchDB, VendorDB
from models_db import AuditLogDB
from test_finance_mcp_read import SECRET_NUMBER, _bearer, _digest, _mcp_client, _secret, seeded  # noqa: F401

import finance_records  # noqa: E402  (mcp_server is on sys.path via test_finance_mcp_read)
from hrflow_client import HRFlowError  # noqa: E402


@pytest.fixture
def records(app_client, seeded):  # noqa: F811
    with get_db_context() as db:
        acme = VendorDB(name="Acme Supplies", tax_id="TAX-SECRET-1", contact_email="acme@secret.test")
        beta = VendorDB(name="Beta Co")
        db.add_all([acme, beta])
        batch = ImportBatchDB(kind="bills", created_by="owner@x.test", manifest_name="bills_2023.xlsx", rows_total=3,
                              rows_created=2, rows_failed=1, created_at=datetime(2023, 8, 1, 10, 0))
        other = ImportBatchDB(kind="cheques", created_by="owner@x.test", manifest_name="cheques.xlsx", rows_total=1,
                              rows_created=1, rows_failed=0, created_at=datetime(2023, 9, 1, 10, 0))
        db.add_all([batch, other])
        db.flush()
        egp = db.query(FinanceBankAccountDB).filter_by(account_name="Cash Book EGP").one()
        b1 = BillDB(vendor_id=acme.id, bill_number="BILL-23-001", issue_date="2023-02-10", due_date="2023-03-10", status="approved",
                    currency="EGP", subtotal=100, tax_amount=0, total=100, capture_source="import", import_batch_id=batch.id)
        b2 = BillDB(vendor_id=beta.id, bill_number="BILL-23-002", issue_date="2023-05-10", due_date="2023-06-10", status="approved",
                    currency="EGP", subtotal=200, tax_amount=0, total=200, capture_source="manual")
        b3 = BillDB(vendor_id=acme.id, bill_number="BILL-22-900", issue_date="2022-12-10", due_date="2023-01-10", status="approved",
                    currency="EGP", subtotal=5, tax_amount=0, total=5)
        db.add_all([b1, b2, b3])
        db.flush()
        ch = FinanceChequeDB(cheque_number="000123", account_id=egp.id, issue_date="2023-04-04", amount=75, currency="EGP",
                             payee="Acme Supplies", fiscal_year=2023, status="cleared", signer_name="SECRET SIGNER",
                             import_batch_id=other.id)
        db.add(ch)
        db.flush()
        db.add_all([
            AuditLogDB(timestamp="2023-08-01 10:00:01", action="bill.created", target_type="bill", target_id=str(b1.id),
                       details=f"- -> approved; reason: imported from batch {batch.id} row R-001"),
            AuditLogDB(timestamp="2023-09-01 10:00:01", action="cheque.created", target_type="cheque", target_id=str(ch.id),
                       details=f"draft; imported from batch {other.id} row C-001"),
            # a different batch whose number merely starts with this batch's number must not be mixed in
            AuditLogDB(timestamp="2023-09-01 10:00:02", action="bill.created", target_type="bill", target_id=str(b2.id),
                       details=f"- -> approved; reason: imported from batch {other.id}0 row NOT-THIS-BATCH"),
        ])
        db.commit()
        return {"batch": batch.id, "other": other.id}


def test_new_routes_are_reachable_and_the_batch_rows_are_found(app_client, records):
    secret = _secret()
    for path in ("/api/finance/transfers", "/api/finance/bills", "/api/finance/cheques", "/api/finance/vendors",
                 "/api/finance/imports/batches", f"/api/finance/imports/batches/{records['batch']}/rows"):
        assert app_client.get(path, headers=_bearer(secret)).status_code == 200, path
    assert app_client.get("/api/finance/imports/batches/9999/rows", headers=_bearer(secret)).status_code == 404


def test_bills_transfers_cheques(app_client, records):
    client = _mcp_client(app_client, _secret())
    bills = finance_records.finance_list_bills(client, "2023-01-01", "2023-12-31")
    assert [b["number"] for b in bills["bills"]] == ["BILL-23-001", "BILL-23-002"]  # the 2022 bill is outside the range
    assert bills["bills"][0]["import_batch_id"] == records["batch"] and bills["bills"][0]["total"] == 100.0
    acme = finance_records.finance_list_bills(client, "2022-01-01", "2023-12-31", vendor="acme supplies", number_prefix="BILL-23")
    assert [b["number"] for b in acme["bills"]] == ["BILL-23-001"]
    cheques = finance_records.finance_list_cheques(client, "2023-01-01", "2023-12-31", account="cash book egp", status="cleared")
    assert [c["number"] for c in cheques["cheques"]] == ["000123"] and cheques["cheques"][0]["import_batch_id"] == records["other"]
    transfers = finance_records.finance_list_transfers(client, "2023-03-01", "2023-03-31", account="Cash Book USD")
    t = transfers["transfers"][0]
    assert (t["from_amount"], t["from_currency"], t["to_amount"], t["to_currency"], t["fx_rate"]) == (100.0, "USD", 4800.0, "EGP", 48.0)
    assert t["from_account"] == "Cash Book USD" and t["to_account"] == "Cash Book EGP"
    assert finance_records.finance_list_transfers(client, "2023-04-01", "2023-04-30")["transfers"] == []


def test_import_batches_and_their_rows(app_client, records):
    client = _mcp_client(app_client, _secret())
    listed = finance_records.finance_list_import_batches(client)
    assert [b["id"] for b in listed["batches"]][:2] == [records["other"], records["batch"]]  # newest first
    assert [b["kind"] for b in finance_records.finance_list_import_batches(client, kind="cheques")["batches"]] == ["cheques"]
    in_august = finance_records.finance_list_import_batches(client, date_from="2023-08-01", date_to="2023-08-31")
    assert [b["id"] for b in in_august["batches"]] == [records["batch"]]
    rows = finance_records.finance_get_import_batch_rows(client, records["batch"])
    assert rows["batch"]["rows_failed"] == 1 and rows["matching_rows"] == 1
    assert rows["rows"] == [{"row_ref": "R-001", "created": "bill", "id": rows["rows"][0]["id"], "label": "BILL-23-001"}]
    cheque_rows = finance_records.finance_get_import_batch_rows(client, records["other"])["rows"]
    assert [(r["row_ref"], r["label"]) for r in cheque_rows] == [("C-001", "000123")]
    with pytest.raises(HRFlowError):
        finance_records.finance_get_import_batch_rows(client, 9999)


def test_reference_data_has_exact_names(app_client, records):
    client = _mcp_client(app_client, _secret())
    vendors = finance_records.finance_list_reference_data(client, "vendors")
    assert {v["name"] for v in vendors["items"]} >= {"Acme Supplies", "Beta Co"}
    accounts = finance_records.finance_list_reference_data(client, "accounts")
    assert {"Cash Book EGP", "Cash Book USD", "Petty Cash", "Overseas Partial"} <= {a["name"] for a in accounts["items"]}
    assert finance_records.finance_list_reference_data(client, "categories")["count"] >= 1
    assert finance_records.finance_list_reference_data(client, "payment_types")["count"] >= 1


def test_no_private_field_in_any_fm2_response(app_client, records):
    client = _mcp_client(app_client, _secret())
    blob = json.dumps([
        finance_records.finance_list_transfers(client, "2023-01-01", "2023-12-31"),
        finance_records.finance_list_bills(client, "2022-01-01", "2023-12-31"),
        finance_records.finance_list_cheques(client, "2023-01-01", "2023-12-31"),
        finance_records.finance_list_reference_data(client, "vendors"),
        finance_records.finance_list_reference_data(client, "accounts"),
        finance_records.finance_list_import_batches(client),
        finance_records.finance_get_import_batch_rows(client, records["batch"]),
    ])
    for forbidden in (SECRET_NUMBER, "TAX-SECRET", "secret.test", "SECRET SIGNER", "owner@x.test", "account_number", "iban", "IBAN"):
        assert forbidden not in blob


def test_a_user_without_the_permissions_is_refused(app_client, records):
    secret = _secret(role_key="employee", email="plain2@hrflow.test")
    for path in ("/api/finance/bills", "/api/finance/vendors", "/api/finance/imports/batches"):
        assert app_client.get(path, headers=_bearer(secret)).status_code == 403, path


def test_every_fm2_tool_leaves_the_database_unchanged(app_client, records):
    client = _mcp_client(app_client, _secret())
    before = _digest()
    finance_records.finance_list_transfers(client, "2023-01-01", "2023-12-31")
    finance_records.finance_list_bills(client, "2022-01-01", "2023-12-31", vendor="Acme Supplies")
    finance_records.finance_list_cheques(client, "2023-01-01", "2023-12-31")
    for kind in finance_records.KINDS:
        finance_records.finance_list_reference_data(client, kind)
    finance_records.finance_list_import_batches(client)
    finance_records.finance_get_import_batch_rows(client, records["batch"])
    assert _digest() == before
