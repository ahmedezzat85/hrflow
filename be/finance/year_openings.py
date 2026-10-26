"""
be/finance/year_openings.py
Fiscal-year opening balances (BI-1, D-043): the single place that decides which opening a balance starts from.

An entered opening is the balance at the start of January 1 of a fiscal year (calendar year), before any
transaction dated that day. For a date D in year Y the base is the latest entered opening with fiscal_year <= Y;
an account with no entered rows uses the legacy base (the account's opening_balance and every movement since
the beginning), so such accounts behave exactly as before.

Three functions are used everywhere (ledger recalculation, compute_balance, reports):
  balance_as_of(D)        base amount + movements from the base start through D (inclusive)
  balance_at_start_of(D)  the entered opening if D is January 1 of a year with a row, else balance_as_of(D - 1 day)
  year_opening_info(Y)    opening, source, previous closing and variance for fiscal year Y
Dates are YYYY-MM-DD strings, like the ledger.
"""
from datetime import date, timedelta
from typing import Dict, Iterable, Optional, Tuple

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from finance.models import FinanceAccountYearOpeningDB, LedgerTransactionDB

SOURCE_ENTERED = "entered"
SOURCE_CARRIED_FORWARD = "carried_forward"
SOURCE_ACCOUNT_OPENING = "account_opening"

# Rows are kept as {account_id: {fiscal_year: opening_balance}}.
Openings = Dict[int, float]


def _today() -> date:
    return date.today()


def load_openings(db: Session, account_ids: Optional[Iterable[int]] = None) -> Dict[int, Openings]:
    """One query for all requested accounts (all accounts when account_ids is None)."""
    query = db.query(
        FinanceAccountYearOpeningDB.account_id,
        FinanceAccountYearOpeningDB.fiscal_year,
        FinanceAccountYearOpeningDB.opening_balance,
    )
    if account_ids is not None:
        ids = list(account_ids)
        if not ids:
            return {}
        query = query.filter(FinanceAccountYearOpeningDB.account_id.in_(ids))
    result: Dict[int, Openings] = {}
    for account_id, year, amount in query.all():
        result.setdefault(account_id, {})[int(year)] = float(amount or 0.0)
    return result


def load_account_openings(db: Session, account_id: int) -> Openings:
    return load_openings(db, [account_id]).get(account_id, {})


def base_year_for(openings: Openings, year: int) -> Optional[int]:
    """Latest entered year <= year, or None when the legacy base applies."""
    eligible = [y for y in openings if y <= year]
    return max(eligible) if eligible else None


def base_for(account, openings: Openings, year: int) -> Tuple[Optional[int], float]:
    """(base_year, base_amount) for a date in `year`. base_year is None for the legacy base."""
    by = base_year_for(openings, year)
    if by is None:
        return None, float(account.opening_balance or 0.0)
    return by, float(openings[by])


def _signed_sum(db: Session, account_id: int, start: Optional[str], end: Optional[str]) -> float:
    signed = case((LedgerTransactionDB.direction == "in", LedgerTransactionDB.amount), else_=-LedgerTransactionDB.amount)
    query = db.query(func.coalesce(func.sum(signed), 0.0)).filter(LedgerTransactionDB.account_id == account_id)
    if start:
        query = query.filter(LedgerTransactionDB.date >= start)
    if end:
        query = query.filter(LedgerTransactionDB.date <= end)
    return float(query.scalar() or 0.0)


def balance_as_of(db: Session, account, as_of: str, openings: Optional[Openings] = None) -> float:
    """Base amount + movements with base_start <= date <= as_of. No lower bound for the legacy base."""
    if openings is None:
        openings = load_account_openings(db, account.id)
    by, amount = base_for(account, openings, int(as_of[:4]))
    start = f"{by:04d}-01-01" if by is not None else None
    return round(amount + _signed_sum(db, account.id, start, as_of), 4)


def balance_at_start_of(db: Session, account, on: str, openings: Optional[Openings] = None) -> float:
    """Opening of the day `on`, before that day's transactions."""
    if openings is None:
        openings = load_account_openings(db, account.id)
    if on[5:] == "01-01" and int(on[:4]) in openings:
        return round(float(openings[int(on[:4])]), 4)
    previous = (date.fromisoformat(on) - timedelta(days=1)).isoformat()
    return balance_as_of(db, account, previous, openings)


def year_opening_info(db: Session, account, year: int, openings: Optional[Openings] = None) -> dict:
    """{opening, source, previous_closing, variance} for fiscal year `year`."""
    if openings is None:
        openings = load_account_openings(db, account.id)
    previous_closing = balance_as_of(db, account, f"{year - 1:04d}-12-31", openings)
    if year in openings:
        opening = round(float(openings[year]), 4)
        return {
            "opening": opening,
            "source": SOURCE_ENTERED,
            "previous_closing": previous_closing,
            "variance": round(opening - previous_closing, 4),
        }
    source = SOURCE_CARRIED_FORWARD if base_year_for(openings, year) is not None else SOURCE_ACCOUNT_OPENING
    return {"opening": previous_closing, "source": source, "previous_closing": previous_closing, "variance": None}


def current_year_for_balance(db: Session, account_id: int) -> int:
    """Year whose base governs current_balance: max(year of the last transaction, current calendar year)."""
    last = db.query(func.max(LedgerTransactionDB.date)).filter(LedgerTransactionDB.account_id == account_id).scalar()
    return max(int(last[:4]) if last else 0, _today().year)


def current_balance(db: Session, account, openings: Optional[Openings] = None) -> float:
    """Balance including every ledger movement, using the base of current_year_for_balance (D-043)."""
    if openings is None:
        openings = load_account_openings(db, account.id)
    by, amount = base_for(account, openings, current_year_for_balance(db, account.id))
    start = f"{by:04d}-01-01" if by is not None else None
    return round(amount + _signed_sum(db, account.id, start, None), 4)
