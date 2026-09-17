"""
be/finance/seed_data.py
Idempotent seeding helper for default finance lookup data:
- Standard transaction categories
- Standard payment types (with FUX-409 naming)
Can be invoked by init_db, Alembic migrations, test setup, or startup scripts.
"""
from datetime import datetime
from sqlalchemy.orm import Session
from finance.models import PaymentTypeDB, TransactionCategoryDB


SEED_CATEGORIES = [
    ("Revenue", "revenue", False, 1),
    ("Salaries", "cost", False, 2),
    ("Medical Insurance", "cost", False, 3),
    ("Kitchen Supplies", "cost", True, 4),
    ("Legal & Accountant", "cost", False, 5),
    ("Internet", "cost", False, 6),
    ("Landline", "cost", False, 7),
    ("Events", "cost", False, 8),
    ("Transportation", "cost", True, 9),
    ("Robot/R&D Equipment", "cost", False, 10),
    ("Taxes", "cost", False, 11),
    ("Social Insurance", "cost", False, 12),
    ("Rent", "cost", False, 13),
    ("Computers", "cost", False, 14),
    ("Bank Fees", "cost", False, 15),
    ("Electricity", "cost", False, 16),
    ("Infrastructure", "cost", False, 17),
    ("SaaS", "cost", False, 18),
    ("Facilities & Maintenance", "cost", False, 19),
    ("Operating Expense", "cost", False, 20),
    ("Other", "other", False, 99),
]

SEED_PAYMENT_TYPES = [
    ("Cash Payment", "CASH", False, False),
    ("ATM Withdrawal", "CASHWITHDRAW", False, False),
    ("Check Payment", "CHK", True, False),
    ("Internal Transfer", "INTTRANS", False, False),
    ("Incoming Transfer", "INBOUND_TRANS", False, False),
    ("Outgoing Transfer", "OUTBOUND_TRANS", False, False),
    ("Currency Exchange", "USDTOEGP", False, False),
    ("Debit Card Payment", "DEBIT_CARD", False, False),
    ("Bank Fee", "BANK_FEES", False, True),
    ("Other", "OTHER", False, False),
]


def seed_finance_lookups(db: Session) -> dict:
    """Idempotently ensures default categories and payment types exist and have standard names."""
    cat_count = 0
    pt_count = 0

    # 1. Seed categories
    for name, kind, is_petty, sort_order in SEED_CATEGORIES:
        existing = db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == name).first()
        if not existing:
            cat = TransactionCategoryDB(
                name=name,
                kind=kind,
                is_petty=is_petty,
                sort_order=sort_order,
                is_active=True,
                created_at=datetime.utcnow(),
            )
            db.add(cat)
            cat_count += 1

    # 2. Seed / normalize payment types
    for name, code, req_chk, req_fee in SEED_PAYMENT_TYPES:
        existing = db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first()
        if not existing:
            pt = PaymentTypeDB(
                name=name,
                code=code,
                requires_cheque_number=req_chk,
                requires_bank_fee_flag=req_fee,
                is_active=True,
                created_at=datetime.utcnow(),
            )
            db.add(pt)
            pt_count += 1
        else:
            # Update name to standard terminology if changed
            if existing.name != name:
                existing.name = name

    db.commit()
    return {"categories_created": cat_count, "payment_types_created": pt_count}
