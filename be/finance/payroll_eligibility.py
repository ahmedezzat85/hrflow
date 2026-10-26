"""
be/finance/payroll_eligibility.py
Historical payroll period eligibility (HP-1, D-045): the single place that decides who belongs in a payroll run.

A period is historical when its period_end is before the first day of the current month. For a historical period
the candidate set is every employee regardless of status, and an employee is included only if
  (1) at least one compensation component overlaps the period, and
  (2) join_date, when it parses to a date, is not after period_end (an empty or unparsable join_date never excludes).
Current and future periods keep the original rule (status Active only; a missing plan blocks).
"""
from datetime import date
from typing import Optional

REASON_NO_PLAN = "NO_PLAN_IN_PERIOD"
REASON_JOINED_AFTER = "JOINED_AFTER_PERIOD"


def _today() -> date:
    return date.today()


def parse_date(value) -> Optional[date]:
    """YYYY-MM-DD (a time suffix is ignored) or YYYY/MM/DD; anything else is None."""
    text = str(value or "").strip()[:10].replace("/", "-")
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def is_historical_period(period_end: str, today: Optional[date] = None) -> bool:
    end = parse_date(period_end)
    if end is None:
        return False
    today = today or _today()
    return end < today.replace(day=1)


def historical_skip_reason(has_plan_in_period: bool, join_date, period_end: str) -> Optional[str]:
    """None when the employee belongs in a historical run, else the reason code for the skipped list."""
    if not has_plan_in_period:
        return REASON_NO_PLAN
    joined, end = parse_date(join_date), parse_date(period_end)
    if joined is not None and end is not None and joined > end:
        return REASON_JOINED_AFTER
    return None
