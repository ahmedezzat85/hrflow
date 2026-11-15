"""
be/finance/services/payroll_statutory_sync.py
Opens the statutory obligations a payroll run creates (salary income tax, social insurance) as 'estimated'.

A finalized run owes the government these amounts, so they must show in Finance > Spend > Statutory without
anyone re-typing them. The run's EGP totals are only HRFlow's estimate: the user confirms the portal figure
(estimated -> accrued) and then pays from whichever account they choose. Idempotent: a run that already has an
obligation of a type (linked by source, or tagged `payroll_run_id:{id}` by the older manual Step 6 flow) gets no second one.
"""
from datetime import datetime
from typing import List

from sqlalchemy import or_
from sqlalchemy.orm import Session

from finance.models import PayrollRunDB, StatutoryObligationDB

# (obligation_type, PayrollRunDB total column, note label)
RUN_OBLIGATIONS = (
    ("income_tax", "total_employee_tax_egp", "Salary Income Tax Withheld"),
    ("social_insurance_employee", "total_social_insurance_egp", "Social Insurance"),
)
SYNCED_RUN_STATUSES = ("finalized", "partially_paid", "paid")


def _due_date(period_label: str) -> str:
    """The 15th of the month after the payroll month (the portal deadline used on the Step 6 screen)."""
    year, month = (int(p) for p in period_label.split("-")[:2])
    year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return f"{year:04d}-{month:02d}-15"


def _already_open(db: Session, run_id: int, obligation_type: str) -> bool:
    return (
        db.query(StatutoryObligationDB.id)
        .filter(
            StatutoryObligationDB.obligation_type == obligation_type,
            or_(
                (StatutoryObligationDB.source_type == "payroll_run") & (StatutoryObligationDB.source_id == run_id),
                StatutoryObligationDB.notes.like(f"%payroll_run_id:{run_id} %"),
                StatutoryObligationDB.notes.like(f"%payroll_run_id:{run_id}"),
            ),
        )
        .first()
        is not None
    )


def ensure_run_obligations(db: Session, run: PayrollRunDB) -> List[StatutoryObligationDB]:
    """Adds the missing estimated obligations for one run. Does not commit; returns the rows it added."""
    created: List[StatutoryObligationDB] = []
    for obligation_type, column, label in RUN_OBLIGATIONS:
        amount = round(float(getattr(run, column) or 0.0), 2)
        if amount <= 0 or _already_open(db, run.id, obligation_type):
            continue
        row = StatutoryObligationDB(
            obligation_type=obligation_type,
            period=run.period_label,
            amount_estimated=amount,
            amount_accrued=amount,
            amount_remitted=0.0,
            variance_amount=0.0,
            currency="EGP",
            status="estimated",
            due_date=_due_date(run.period_label),
            source_type="payroll_run",
            source_id=run.id,
            notes=f"Payroll {run.period_label} - {label}",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(row)
        created.append(row)
    if created:
        db.flush()
    return created


def backfill_finalized_runs(db: Session) -> int:
    """Covers runs finalized before obligations were opened at finalize. Commits only when it added something."""
    runs = db.query(PayrollRunDB).filter(PayrollRunDB.status.in_(SYNCED_RUN_STATUSES)).all()
    added = sum(len(ensure_run_obligations(db, run)) for run in runs)
    if added:
        db.commit()
    return added
