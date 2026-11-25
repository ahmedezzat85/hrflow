"""
be/finance/period_lock.py
The closed-reconciliation-month lock, enforced for every ledger row (audit 2026-11, finding H-3).

A bank statement with status "closed" freezes its account's ledger for that month: no row may be added, removed,
or have its account, date, amount, direction or currency changed there until the statement is reopened. Only some
posting paths used to check this (LedgerRepository.assert_period_open), so the rule also runs as a before_flush hook
on every Session: whichever service writes the row, the flush that would write it is refused with PeriodClosedError.
Changes that do not move money (running_balance recalculation, links to bills or invoices, descriptions) are not
affected. Bulk Query.update()/delete() bypass the ORM and therefore this hook; nothing in the code uses them on the
ledger table.
"""
from typing import Iterable, Optional, Set, Tuple

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

# Columns whose change moves money into, out of, or within a month.
MONEY_FIELDS = ("account_id", "date", "amount", "direction", "currency")


class PeriodClosedError(ValueError):
    """A ledger posting was refused because its reconciliation month is closed. A ValueError, so the callers that
    already map ValueError to a 400 keep doing so; main.py maps an uncaught one to 400 as well."""


def closed_message(period: str) -> str:
    return (f"Cannot post or modify transactions in closed reconciliation period '{period}'. "
            "The period must be reopened first.")


def _month(date_value) -> Optional[str]:
    text = str(date_value or "")
    return text[:7] if len(text) >= 7 else None


def first_closed(session: Session, pairs: Iterable[Tuple[int, str]]) -> Optional[str]:
    """The first (account_id, YYYY-MM) of `pairs` whose statement is closed, as 'YYYY-MM', or None."""
    from finance.models import BankStatementImportDB

    wanted: Set[Tuple[int, str]] = {(a, m) for a, m in pairs if a is not None and m}
    if not wanted:
        return None
    accounts = {a for a, _ in wanted}
    months = {m for _, m in wanted}
    with session.no_autoflush:
        rows = session.execute(
            select(BankStatementImportDB.account_id, BankStatementImportDB.period_month).where(
                BankStatementImportDB.account_id.in_(accounts),
                BankStatementImportDB.period_month.in_(months),
                BankStatementImportDB.status == "closed",
            )
        ).all()
    hits = sorted(m for a, m in rows if (a, m) in wanted)
    return hits[0] if hits else None


def _old_value(state, field):
    hist = state.attrs[field].history
    if hist.deleted:
        return hist.deleted[0]
    return state.attrs[field].value


def _touched_months(session: Session) -> Set[Tuple[int, str]]:
    from finance.models import LedgerTransactionDB

    pairs: Set[Tuple[int, str]] = set()
    for obj in session.new:
        if isinstance(obj, LedgerTransactionDB):
            pairs.add((obj.account_id, _month(obj.date)))
    for obj in session.deleted:
        if isinstance(obj, LedgerTransactionDB):
            state = inspect(obj)
            pairs.add((_old_value(state, "account_id"), _month(_old_value(state, "date"))))
    for obj in session.dirty:
        if not isinstance(obj, LedgerTransactionDB) or obj in session.deleted:
            continue
        state = inspect(obj)
        if not any(state.attrs[f].history.has_changes() for f in MONEY_FIELDS):
            continue
        # Both where the row was and where it goes
        pairs.add((_old_value(state, "account_id"), _month(_old_value(state, "date"))))
        pairs.add((obj.account_id, _month(obj.date)))
    return pairs


@event.listens_for(Session, "before_flush")
def _refuse_postings_in_closed_months(session: Session, flush_context, instances) -> None:
    pairs = _touched_months(session)
    if not pairs:
        return
    period = first_closed(session, pairs)
    if period:
        raise PeriodClosedError(closed_message(period))
