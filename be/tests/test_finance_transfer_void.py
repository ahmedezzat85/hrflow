"""
be/tests/test_finance_transfer_void.py
Voiding a wrong account transfer (D-054): one action removes every ledger row of the transfer (outflow, inflow, fee),
recomputes both accounts' balances, keeps the record hidden by default, and refuses when it would lose something.
"""
import pytest
from fastapi import HTTPException

from finance.models import (
    AccountTransferDB,
    BankStatementImportDB,
    FinanceAttachmentDB,
    LedgerTransactionDB,
)
from finance.repositories.accounts_repository import AccountsRepository
from finance.schemas import AccountTransferCreate, TransferMatchRequest
from finance.services.payroll_service import PayrollService
from finance.services.transfers_service import TransfersService
from models_db import AuditLogDB
from test_finance_transfers import db_session, test_client  # noqa: F401  (fixtures)


def _accounts(db, usd_open=10000.0, egp_open=50000.0):
    repo = AccountsRepository(db)
    usd = repo.create({"account_name": "Void USD", "bank_name": "CIB", "account_number": "V-USD", "currency": "USD", "opening_balance": usd_open})
    egp = repo.create({"account_name": "Void EGP", "bank_name": "CIB", "account_number": "V-EGP", "currency": "EGP", "opening_balance": egp_open})
    usd2 = repo.create({"account_name": "Void USD 2", "bank_name": "CIB", "account_number": "V-USD2", "currency": "USD", "opening_balance": 100.0})
    return usd, egp, usd2


def _balance(db, account_id):
    db.expire_all()
    return AccountsRepository(db).get_by_id(account_id).current_balance


def _legs(db, transfer_id):
    return db.query(LedgerTransactionDB).filter(LedgerTransactionDB.linked_transfer_id == transfer_id).all()


def test_voiding_an_internal_transfer_removes_both_legs_with_one_action(db_session):
    usd, _, usd2 = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-05",
                                                  from_amount=2500.0, from_currency="USD", transfer_type="internal"))
    assert len(_legs(db_session, t.id)) == 2
    assert _balance(db_session, usd.id) == 7500.0 and _balance(db_session, usd2.id) == 2600.0

    voided = svc.void_transfer(t.id, "Entered the wrong amount", voided_by="finance.admin@example.com")

    assert voided.voided_at is not None and voided.void_reason == "Entered the wrong amount" and voided.settlement_status == "voided"
    assert _legs(db_session, t.id) == []
    assert _balance(db_session, usd.id) == 10000.0 and _balance(db_session, usd2.id) == 100.0   # both accounts back, one void
    assert db_session.query(AccountTransferDB).filter_by(id=t.id).count() == 1                     # the record is kept
    audit = db_session.query(AuditLogDB).filter_by(action="finance.transfer.voided", target_id=str(t.id)).one()
    assert "Entered the wrong amount" in audit.details


def test_a_fx_transfer_with_a_fee_loses_all_three_rows(db_session):
    usd, egp, _ = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=egp.id, date="2026-09-05", from_amount=1000.0,
                                                  from_currency="USD", fx_rate=48.5, fee=5.0, transfer_type="same_bank_fx"))
    assert len(_legs(db_session, t.id)) == 3
    svc.void_transfer(t.id, "Wrong rate typed")
    assert _legs(db_session, t.id) == []
    assert _balance(db_session, usd.id) == 10000.0 and _balance(db_session, egp.id) == 50000.0


def test_a_one_sided_external_transfer_voids_and_cannot_be_matched_afterwards(db_session):
    usd, _, usd2 = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, date="2026-09-05", from_amount=400.0, from_currency="USD",
                                                  transfer_type="external_linked", confirmed_leg="from_only", exchange_reference="EXT-1"))
    assert len(_legs(db_session, t.id)) == 1
    svc.void_transfer(t.id, "Never left the account")
    assert _balance(db_session, usd.id) == 10000.0
    with pytest.raises(HTTPException) as exc:
        svc.match_transfer(t.id, TransferMatchRequest(target_account_id=usd2.id))
    assert exc.value.status_code == 400 and "voided" in exc.value.detail


def test_voided_transfers_are_hidden_by_default_and_listed_on_request(db_session):
    usd, _, usd2 = _accounts(db_session)
    svc = TransfersService(db_session)
    keep = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-01", from_amount=10.0, from_currency="USD", transfer_type="internal"))
    gone = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-02", from_amount=20.0, from_currency="USD", transfer_type="internal"))
    svc.void_transfer(gone.id, "Duplicate entry")
    assert [x.id for x in svc.list_transfers()] == [keep.id]
    assert {x.id for x in svc.list_transfers(include_voided=True)} == {keep.id, gone.id}


def test_a_transfer_cannot_be_voided_twice(db_session):
    usd, _, usd2 = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-05", from_amount=50.0, from_currency="USD", transfer_type="internal"))
    svc.void_transfer(t.id, "First void")
    with pytest.raises(HTTPException) as exc:
        svc.void_transfer(t.id, "Second void")
    assert exc.value.status_code == 400 and "already voided" in exc.value.detail
    with pytest.raises(HTTPException) as missing:
        svc.void_transfer(99999, "No such transfer")
    assert missing.value.status_code == 404


def test_a_closed_reconciliation_month_or_an_attachment_blocks_the_void_and_changes_nothing(db_session):
    usd, _, usd2 = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-05", from_amount=300.0, from_currency="USD", transfer_type="internal"))

    db_session.add(FinanceAttachmentDB(ledger_transaction_id=_legs(db_session, t.id)[0].id, file_name="scan.pdf", storage_ref="x/scan.pdf"))
    db_session.commit()
    with pytest.raises(HTTPException) as att:
        svc.void_transfer(t.id, "Has a scan")
    assert att.value.status_code == 400 and "attached document" in att.value.detail

    db_session.query(FinanceAttachmentDB).delete()
    db_session.add(BankStatementImportDB(account_id=usd.id, period_month="2026-09", status="closed"))
    db_session.commit()
    with pytest.raises(HTTPException) as closed:
        svc.void_transfer(t.id, "Closed month")
    assert closed.value.status_code == 400 and "closed reconciliation period" in closed.value.detail

    assert len(_legs(db_session, t.id)) == 2 and _balance(db_session, usd.id) == 9700.0   # nothing was changed
    assert db_session.query(AccountTransferDB).filter_by(id=t.id).one().voided_at is None


def test_a_voided_transfer_no_longer_supplies_the_payroll_fx_rate(db_session):
    usd, egp, _ = _accounts(db_session)
    svc = TransfersService(db_session)
    t = svc.create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=egp.id, date="2026-08-20", from_amount=1000.0,
                                                  from_currency="USD", fx_rate=48.5, transfer_type="same_bank_fx"))
    payroll = PayrollService(db_session)
    assert payroll._resolve_fx_rate("first_of_month", None, "2026-09-01", "2026-09-30") == 48.5
    svc.void_transfer(t.id, "Wrong rate typed")
    with pytest.raises(HTTPException) as exc:
        payroll._resolve_fx_rate("first_of_month", None, "2026-09-01", "2026-09-30")
    assert exc.value.status_code == 400 and "No USD-EGP rate" in exc.value.detail


def test_void_endpoint_needs_a_reason(test_client, db_session):
    usd, _, usd2 = _accounts(db_session)
    t = TransfersService(db_session).create_transfer(AccountTransferCreate(from_account_id=usd.id, to_account_id=usd2.id, date="2026-09-05", from_amount=50.0, from_currency="USD", transfer_type="internal"))
    assert test_client.post(f"/api/finance/transfers/{t.id}/void", json={"reason": "no"}).status_code == 422
    ok = test_client.post(f"/api/finance/transfers/{t.id}/void", json={"reason": "Entered twice"})
    assert ok.status_code == 200 and ok.json()["voided_at"] is not None
    assert [x["id"] for x in test_client.get("/api/finance/transfers").json()] == []
    assert [x["id"] for x in test_client.get("/api/finance/transfers?include_voided=true").json()] == [t.id]
