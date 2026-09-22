"""
be/tests/test_finance_statutory_obligations.py
Verification suite for FUX-410 Statutory Obligations Tracker.
Covers:
  - Auto-generation of estimated obligations from finalized payroll runs
  - Explicit confirm / adjust accrued amounts with variance tracking
  - Manual obligation creation (direct accrued state)
  - SettlementService atomic remittance, ledger transaction linking, bank balance adjustment
  - FUX-408 status integrity guard preventing arbitrary status mutations
  - Overpayment prevention
  - Needs-Attention queue visibility
"""
import pytest
from datetime import datetime
from db import get_db_context
from finance.models import (
    FinanceBankAccountDB,
    StatutoryObligationDB,
    LedgerTransactionDB,
    PaymentDB,
    PayrollRunDB,
    PayrollLineDB,
)
from finance.services.attention_service import AttentionQueueService


def _get_or_create_bank_account() -> int:
    with get_db_context() as db:
        acc = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.is_active == True).first()
        if acc:
            return acc.id
        new_acc = FinanceBankAccountDB(
            account_name="Statutory Test Bank",
            account_number="STAT-BANK-9999",
            currency="USD",
            opening_balance=100000.0,
            current_balance=100000.0,
            account_type="bank",
            is_active=True,
        )
        db.add(new_acc)
        db.commit()
        return new_acc.id


def test_payroll_finalization_does_not_auto_generate_statutory_obligations(app_client, admin_cookies):
    """A finalized payroll run does not auto-generate statutory obligations under net payment runner."""
    period_label = f"2026-T{int(datetime.utcnow().timestamp()) % 10000}"
    with get_db_context() as db:
        run = PayrollRunDB(
            period_label=period_label,
            period_start="2026-09-01",
            period_end="2026-09-30",
            status="approved",
            currency="USD",
            total_net=15000.0,
            created_at=datetime.utcnow(),
            approved_at=datetime.utcnow(),
            approved_by="admin@hrflow.test",
        )
        db.add(run)
        db.commit()
        run_id = run.id

    # Finalize run via API
    fin_resp = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)
    assert fin_resp.status_code == 200

    # Verify NO estimated statutory obligations are created from payroll run
    stat_resp = app_client.get(f"/api/finance/statutory-obligations?period={period_label}", cookies=admin_cookies)
    assert stat_resp.status_code == 200
    obligations = stat_resp.json()
    assert len(obligations) == 0


def test_confirm_or_adjust_statutory_obligation(app_client, admin_cookies):
    """Estimated obligations can be confirmed as-is (variance=0) or adjusted with variance notes."""
    with get_db_context() as db:
        obl_db = StatutoryObligationDB(
            obligation_type="social_insurance_employee",
            period="2026-07",
            amount_estimated=1000.0,
            amount_accrued=1000.0,
            amount_remitted=0.0,
            variance_amount=0.0,
            variance_note=None,
            currency="USD",
            status="estimated",
            due_date="2026-08-15",
            source_type="payroll_run",
            source_id=999,
            notes="Test estimated obligation",
            created_at=datetime.utcnow(),
        )
        db.add(obl_db)
        db.commit()
        obl_id = obl_db.id

    # 1. Adjust accrued amount away from estimate
    adjust_resp = app_client.post(
        f"/api/finance/statutory-obligations/{obl_id}/confirm",
        json={
            "amount_accrued": 1045.50,
            "variance_note": "Gov portal calculation + $45.50 processing fee",
        },
        cookies=admin_cookies,
    )
    assert adjust_resp.status_code == 200
    data = adjust_resp.json()
    assert data["status"] == "accrued"
    assert data["amount_accrued"] == 1045.50
    assert data["variance_amount"] == 45.50
    assert data["variance_note"] == "Gov portal calculation + $45.50 processing fee"

    # 2. Confirm without adjustment (as-is) on another estimated obligation
    with get_db_context() as db:
        obl_db2 = StatutoryObligationDB(
            obligation_type="income_tax",
            period="2026-07",
            amount_estimated=2000.0,
            amount_accrued=2000.0,
            amount_remitted=0.0,
            variance_amount=0.0,
            variance_note=None,
            currency="USD",
            status="estimated",
            due_date="2026-08-15",
            source_type="payroll_run",
            source_id=999,
            notes="Test estimated obligation 2",
            created_at=datetime.utcnow(),
        )
        db.add(obl_db2)
        db.commit()
        obl_id2 = obl_db2.id

    confirm_resp = app_client.post(
        f"/api/finance/statutory-obligations/{obl_id2}/confirm",
        json={"amount_accrued": 2000.0},
        cookies=admin_cookies,
    )
    assert confirm_resp.status_code == 200
    data2 = confirm_resp.json()
    assert data2["status"] == "accrued"
    assert data2["amount_accrued"] == 2000.0
    assert data2["variance_amount"] == 0.0


def test_manual_statutory_obligation_creation(app_client, admin_cookies):
    """Manual obligations (like Sales Tax/VAT) skip the estimate step and start directly as accrued."""
    payload = {
        "obligation_type": "sales_tax",
        "period": "2026-08",
        "amount_accrued": 3500.0,
        "due_date": "2026-09-20",
        "currency": "USD",
        "notes": "August VAT filing",
    }
    resp = app_client.post("/api/finance/statutory-obligations", json=payload, cookies=admin_cookies)
    assert resp.status_code == 201
    created = resp.json()
    assert created["obligation_type"] == "sales_tax"
    assert created["status"] == "accrued"
    assert created["amount_estimated"] is None
    assert created["amount_accrued"] == 3500.0
    assert created["amount_remitted"] == 0.0
    assert created["remaining_balance"] == 3500.0
    assert created["variance_amount"] == 0.0

    # Reject invalid obligation type
    bad_payload = payload.copy()
    bad_payload["obligation_type"] = "invalid_tax_type"
    bad_resp = app_client.post("/api/finance/statutory-obligations", json=bad_payload, cookies=admin_cookies)
    assert bad_resp.status_code in (400, 422)


def test_settle_statutory_obligation(app_client, admin_cookies):
    """Settling creates linked payment and ledger transactions, adjusts bank balance, and handles partial payments."""
    bank_id = _get_or_create_bank_account()
    with get_db_context() as db:
        bank_acc = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_id).first()
        initial_balance = bank_acc.current_balance

    # Create accrued obligation
    obl_resp = app_client.post(
        "/api/finance/statutory-obligations",
        json={
            "obligation_type": "withholding_tax",
            "period": "2026-09",
            "amount_accrued": 1000.0,
            "due_date": "2026-10-10",
            "currency": "USD",
            "notes": "WHT Remittance Test",
        },
        cookies=admin_cookies,
    )
    assert obl_resp.status_code == 201
    obl_id = obl_resp.json()["id"]

    # 1. Partial settlement ($400 of $1000)
    settle1_resp = app_client.post(
        f"/api/finance/statutory-obligations/{obl_id}/settle",
        json={
            "amount": 400.0,
            "payment_date": "2026-09-16",
            "bank_account_id": bank_id,
            "currency": "USD",
            "reference": "WHT-PARTIAL-01",
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    assert settle1_resp.status_code == 200
    res1 = settle1_resp.json()
    assert res1["status"] == "partially_remitted"
    assert res1["amount_remitted"] == 400.0
    assert res1["remaining_balance"] == 600.0

    # Check bank balance deducted
    with get_db_context() as db:
        bank_acc = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == bank_id).first()
        assert round(bank_acc.current_balance, 2) == round(initial_balance - 400.0, 2)

    # 2. Overpayment attempt ($700 when remaining is $600)
    overpay_resp = app_client.post(
        f"/api/finance/statutory-obligations/{obl_id}/settle",
        json={
            "amount": 700.0,
            "payment_date": "2026-09-16",
            "bank_account_id": bank_id,
            "currency": "USD",
        },
        cookies=admin_cookies,
    )
    assert overpay_resp.status_code == 400
    assert "exceeds remaining balance" in overpay_resp.json()["detail"]

    # 3. Complete settlement (remaining $600)
    settle2_resp = app_client.post(
        f"/api/finance/statutory-obligations/{obl_id}/settle",
        json={
            "amount": 600.0,
            "payment_date": "2026-09-17",
            "bank_account_id": bank_id,
            "currency": "USD",
            "reference": "WHT-FINAL-01",
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    assert settle2_resp.status_code == 200
    res2 = settle2_resp.json()
    assert res2["status"] == "remitted"
    assert res2["amount_remitted"] == 1000.0
    assert res2["remaining_balance"] == 0.0

    # Verify ledger transactions created
    with get_db_context() as db:
        ledger_txs = (
            db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.linked_statutory_obligation_id == obl_id)
            .all()
        )
        assert len(ledger_txs) == 2
        assert all(tx.source == "statutory_remittance" for tx in ledger_txs)
        assert all(tx.direction == "out" for tx in ledger_txs)


def test_status_integrity_guard(app_client, admin_cookies):
    """FUX-408 status integrity guard: direct status manipulation via patch/update is rejected."""
    with get_db_context() as db:
        obl = StatutoryObligationDB(
            obligation_type="health_insurance",
            period="2026-09",
            amount_estimated=500.0,
            amount_accrued=500.0,
            amount_remitted=0.0,
            variance_amount=0.0,
            currency="USD",
            status="estimated",
            source_type="payroll_run",
            created_at=datetime.utcnow(),
        )
        db.add(obl)
        db.commit()
        obl_id = obl.id

    # 1. Attempt to set status directly to 'remitted'
    patch_resp = app_client.patch(
        f"/api/finance/statutory-obligations/{obl_id}",
        json={"status": "remitted"},
        cookies=admin_cookies,
    )
    assert patch_resp.status_code == 400
    assert "Direct status manipulation is forbidden" in patch_resp.json()["detail"]

    # 2. Attempt to directly alter amount_accrued via patch
    patch_resp2 = app_client.patch(
        f"/api/finance/statutory-obligations/{obl_id}",
        json={"amount_accrued": 900.0},
        cookies=admin_cookies,
    )
    assert patch_resp2.status_code == 400

    # 3. Allowed metadata update (due_date and notes)
    valid_patch = app_client.patch(
        f"/api/finance/statutory-obligations/{obl_id}",
        json={"due_date": "2026-10-31", "notes": "Updated filing deadline"},
        cookies=admin_cookies,
    )
    assert valid_patch.status_code == 200
    assert valid_patch.json()["due_date"] == "2026-10-31"
    assert valid_patch.json()["notes"] == "Updated filing deadline"
    assert valid_patch.json()["status"] == "estimated"  # status unmodified


def test_needs_attention_queue_surfaces_statutory_obligations(app_client, admin_cookies):
    """Needs-Attention queue aggregates estimated and open accrued statutory obligations."""
    with get_db_context() as db:
        obl = StatutoryObligationDB(
            obligation_type="sales_tax",
            period="2026-08",
            amount_accrued=8000.0,
            amount_remitted=0.0,
            currency="USD",
            status="accrued",
            due_date="2026-09-01",  # Past due
            source_type="manual",
            created_at=datetime.utcnow(),
        )
        db.add(obl)
        db.commit()
        obl_id = obl.id

        att_svc = AttentionQueueService(db)
        queue = att_svc.get_attention_queue(
            current_user={"id": 1, "email": "admin@hrflow.test", "role": "admin"},
            user_permissions={"*"},
            item_type="all",
            severity="all",
        )

    item_ids = [item.id for item in queue.items]
    assert f"statutory-{obl_id}" in item_ids
    stat_item = next(i for i in queue.items if i.id == f"statutory-{obl_id}")
    assert stat_item.type == "statutory_obligation"
    assert stat_item.target_route == "a-finance-statutory"
