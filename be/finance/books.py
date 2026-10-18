"""
be/finance/books.py
Company books and report views (D-028).

Every company account belongs to one book: Local (the default, holds every pre-existing account) or Overseas.
Reports take an optional `book` view:
  - omitted      : legacy behaviour, every account (identical to today's numbers)
  - consolidated : every account; inter-book transfers and intercompany receipts are eliminated
  - local        : Local accounts only
  - overseas     : Overseas accounts only
A transfer whose two accounts sit in different books is an inter-book transfer. Inside a single book view it is
neither operating revenue nor operating spend, except that inflow to Local from Overseas is shown as revenue
"Income from overseas entity" (D-028). Everything else about classification stays in finance.cash_basis.
"""
from typing import Dict, Iterable, Optional, Set

from fastapi import HTTPException
from sqlalchemy.orm import Session

from finance.models import FinanceBankAccountDB, FinanceBookDB

LOCAL = "local"
OVERSEAS = "overseas"
CONSOLIDATED = "consolidated"
VALID_VIEWS = (LOCAL, OVERSEAS, CONSOLIDATED)

INCOME_FROM_OVERSEAS = "Income from overseas entity"
TRANSFERRED_TO_OVERSEAS = "Transferred to overseas entity"
TRANSFERRED_TO_LOCAL = "Transferred to local entity"
RECEIVED_FROM_LOCAL = "Received from local entity"
INTERCOMPANY_INCOME = "Income from overseas entity"


def ensure_books(db: Session) -> Dict[str, FinanceBookDB]:
    """Idempotently create the two books; returns them by code."""
    existing = {b.code: b for b in db.query(FinanceBookDB).all()}
    changed = False
    if LOCAL not in existing:
        existing[LOCAL] = FinanceBookDB(code=LOCAL, name="Local", is_default=True)
        db.add(existing[LOCAL])
        changed = True
    if OVERSEAS not in existing:
        existing[OVERSEAS] = FinanceBookDB(code=OVERSEAS, name="Overseas", is_default=False)
        db.add(existing[OVERSEAS])
        changed = True
    if changed:
        db.commit()
    return existing


def default_book_id(db: Session) -> int:
    books = ensure_books(db)
    default = next((b for b in books.values() if b.is_default), books[LOCAL])
    return default.id


def validate_view(book: Optional[str]) -> Optional[str]:
    if book is None or book == "":
        return None
    v = str(book).strip().lower()
    if v not in VALID_VIEWS:
        raise HTTPException(status_code=400, detail=f"Invalid book '{book}'. Must be one of: {', '.join(VALID_VIEWS)}")
    return v


class BookScope:
    """The accounts a report looks at, plus helpers to classify rows that cross books."""

    def __init__(self, view: Optional[str], book_by_account: Dict[int, str], default_code: str = LOCAL):
        self.view = view
        self.book_by_account = book_by_account
        self.default_code = default_code

    @property
    def restricts(self) -> bool:
        return self.view in (LOCAL, OVERSEAS)

    @property
    def eliminates(self) -> bool:
        """Consolidated view: inter-book and intercompany movements are eliminated."""
        return self.view == CONSOLIDATED

    @property
    def account_ids(self) -> Optional[Set[int]]:
        if not self.restricts:
            return None
        return {aid for aid, code in self.book_by_account.items() if code == self.view}

    def book_of(self, account_id: Optional[int]) -> str:
        if account_id is None:
            return self.default_code
        return self.book_by_account.get(account_id, self.default_code)

    def owns_account(self, account_id: Optional[int]) -> bool:
        if not self.restricts:
            return True
        return self.book_of(account_id) == self.view

    def owns_unattributed(self) -> bool:
        """Items with no account (e.g. a bill nobody has paid yet) belong to the default book."""
        return (not self.restricts) or self.view == self.default_code

    def filter(self, query, column, include_null: bool = False):
        """Restrict a query to accounts of this view; no-op when the view does not restrict."""
        ids = self.account_ids
        if ids is None:
            return query
        from sqlalchemy import or_
        cond = column.in_(ids) if ids else column == -1
        if include_null and self.owns_unattributed():
            cond = or_(cond, column.is_(None))
        return query.filter(cond)

    # ---- inter-book classification
    def counter_account_id(self, tx) -> Optional[int]:
        """The other account of a transfer leg, or None when the row is not a transfer leg."""
        transfer = getattr(tx, "linked_transfer", None)
        if transfer is None:
            return None
        if tx.direction == "out":
            return transfer.to_account_id
        return transfer.from_account_id

    def inter_book(self, tx) -> bool:
        """True when tx is one leg of a transfer between accounts of different books."""
        counter = self.counter_account_id(tx)
        if counter is None:
            return False
        return self.book_of(tx.account_id) != self.book_of(counter)


def resolve(db: Session, book: Optional[str]) -> BookScope:
    view = validate_view(book)
    books = ensure_books(db)
    code_by_id = {b.id: b.code for b in books.values()}
    rows = db.query(FinanceBankAccountDB.id, FinanceBankAccountDB.book_id).all()
    default_code = next((b.code for b in books.values() if b.is_default), LOCAL)
    return BookScope(view, {aid: code_by_id.get(bid, default_code) for aid, bid in rows}, default_code)


# ---- helpers for items that carry no account of their own ------------------------------------------------------
def invoice_in_scope(scope: BookScope, inv) -> bool:
    """An invoice belongs to the book of its expected receiving account; with none, to the default book."""
    if not scope.restricts:
        return True
    if inv.expected_bank_account_id:
        return scope.owns_account(inv.expected_bank_account_id)
    return scope.owns_unattributed()


def bill_account_map(db: Session) -> Dict[int, int]:
    """bill id -> account of its first outgoing payment."""
    from finance.models import PaymentDB
    rows = (
        db.query(PaymentDB.related_bill_id, PaymentDB.bank_account_id)
        .filter(PaymentDB.related_bill_id.isnot(None), PaymentDB.direction == "outgoing")
        .order_by(PaymentDB.id.asc())
        .all()
    )
    out: Dict[int, int] = {}
    for bill_id, acc_id in rows:
        out.setdefault(bill_id, acc_id)
    return out


def filter_bills(db: Session, scope: BookScope, bills: list) -> list:
    """A bill belongs to the book of the account that paid it; an unpaid bill belongs to the default book."""
    if not scope.restricts:
        return bills
    amap = bill_account_map(db)
    return [b for b in bills if (scope.owns_account(amap[b.id]) if b.id in amap else scope.owns_unattributed())]

