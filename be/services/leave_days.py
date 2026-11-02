"""
services/leave_days.py
Working-day count for a leave request. The server is the only source of the
`days` stored on a vacation record; the client value is never trusted.
"""
from datetime import date, timedelta
from typing import Any, Dict, Iterable, Optional, Set

# date.weekday(): Monday=0 ... Friday=4, Saturday=5, Sunday=6
WEEKEND_WEEKDAYS = frozenset({4, 5})  # Friday and Saturday


def holiday_dates(holidays: Iterable[Dict[str, Any]]) -> Set[date]:
    """Every day covered by the holiday rows ({"start_date", "end_date"} ISO strings)."""
    days: Set[date] = set()
    for h in holidays:
        day, last = date.fromisoformat(h["start_date"]), date.fromisoformat(h["end_date"])
        while day <= last:
            days.add(day)
            day += timedelta(days=1)
    return days


def count_leave_days(start: date, end: date, holidays: Optional[Set[date]] = None) -> int:
    """Days in [start, end] inclusive that are neither weekend days nor official holidays."""
    if end < start:
        raise ValueError("End date cannot be earlier than start date.")
    off = holidays or set()
    return sum(
        1
        for offset in range((end - start).days + 1)
        if (start + timedelta(days=offset)).weekday() not in WEEKEND_WEEKDAYS
        and (start + timedelta(days=offset)) not in off
    )
