"""
services/leave_days.py
Working-day count for a leave request. The server is the only source of the
`days` stored on a vacation record; the client value is never trusted.
"""
from datetime import date, timedelta

# date.weekday(): Monday=0 ... Friday=4, Saturday=5, Sunday=6
WEEKEND_WEEKDAYS = frozenset({4, 5})  # Friday and Saturday


def count_leave_days(start: date, end: date) -> int:
    """Days in [start, end] inclusive that are not weekend days."""
    if end < start:
        raise ValueError("End date cannot be earlier than start date.")
    return sum(
        1
        for offset in range((end - start).days + 1)
        if (start + timedelta(days=offset)).weekday() not in WEEKEND_WEEKDAYS
    )
