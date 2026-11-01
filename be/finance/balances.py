"""
be/finance/balances.py
The account balance rule, in one place, and the check that the stored copies still follow it.

An account's balance is computed from its ledger (chronological by date then id) starting at the account's
opening_balance; when fiscal-year openings are entered (BI-1, D-043) the running balance restarts at each entered
opening. Two copies of the result are stored for speed:
  finance_ledger_transactions.running_balance   the balance after each row
  finance_bank_accounts.current_balance         the balance after the last row (and any later entered opening)
Only LedgerRepository.recalculate_account_running_balances writes them (tests/test_balance_write_path.py enforces it),
and it gets the values from compute_balances below. find_drift compares the stored copies with a fresh computation.
"""
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import asc
from sqlalchemy.orm import Session

from finance import year_openings
from finance.models import FinanceBankAccountDB, LedgerTransactionDB

TOLERANCE = 0.00005  # both copies are rounded to 4 decimals


def compute_balances(db: Session, account: FinanceBankAccountDB) -> Tuple[List[Tuple[LedgerTransactionDB, float]], float]:
    """([(transaction, running balance after it)], current balance) for the account. Reads only."""
    txs = (
        db.query(LedgerTransactionDB)
        .filter(LedgerTransactionDB.account_id == account.id)
        .order_by(asc(LedgerTransactionDB.date), asc(LedgerTransactionDB.id))
        .all()
    )
    openings = year_openings.load_account_openings(db, account.id)
    running = float(account.opening_balance or 0.0)
    base_year = None  # None = legacy base (the account's opening_balance)
    rows: List[Tuple[LedgerTransactionDB, float]] = []
    for tx in txs:
        tx_base = year_openings.base_year_for(openings, int(tx.date[:4]))
        if tx_base != base_year:
            base_year = tx_base
            running = float(openings[base_year])
        amount = float(tx.amount)
        running += amount if tx.direction == "in" else -amount
        rows.append((tx, round(running, 4)))

    final_base = year_openings.base_year_for(openings, year_openings.current_year_for_balance(db, account.id))
    if final_base != base_year:
        running = float(openings[final_base])  # an entered opening later than the last transaction
    return rows, round(running, 4)


def find_drift(db: Session, account_ids: Optional[Sequence[int]] = None) -> List[Dict]:
    """Accounts whose stored current_balance, or any stored running_balance, differs from the computed value."""
    query = db.query(FinanceBankAccountDB)
    if account_ids is not None:
        query = query.filter(FinanceBankAccountDB.id.in_(list(account_ids)))
    drift: List[Dict] = []
    for account in query.order_by(FinanceBankAccountDB.id).all():
        rows, expected = compute_balances(db, account)
        stored = round(float(account.current_balance or 0.0), 4)
        bad_rows = [
            {"transaction_id": tx.id, "stored": round(float(tx.running_balance or 0.0), 4), "computed": running}
            for tx, running in rows
            if abs(round(float(tx.running_balance or 0.0), 4) - running) > TOLERANCE
        ]
        if abs(stored - expected) > TOLERANCE or bad_rows:
            drift.append({
                "account_id": account.id,
                "account_name": account.account_name,
                "current_balance": {"stored": stored, "computed": expected},
                "running_balance_rows": len(bad_rows),
                "first_bad_rows": bad_rows[:3],
            })
    return drift
