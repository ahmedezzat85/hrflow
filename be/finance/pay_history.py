"""
be/finance/pay_history.py
Pay-change history with amounts derived from the compensation plan (D-048).

`salary_history` stores only the event: employee, date, reason and who applied it. The amounts are never stored a
second time: for a change dated D, the new pay is the plan in force on D and the previous pay is the plan in force on
the day before, so a corrected plan row is reflected in the history automatically and the two can never disagree.
"""
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List

from sqlalchemy.orm import Session

from finance.current_pay import current_pay_map, zero_pay


def _day_before(day: str) -> str:
    try:
        return (date.fromisoformat(str(day)[:10]) - timedelta(days=1)).isoformat()
    except ValueError:
        return str(day)


def pct_text(previous_total: float, new_total: float) -> str:
    pct = round((new_total - previous_total) / previous_total * 100, 2) if previous_total > 0 else 0.0
    return f"{'+' if pct >= 0 else ''}{pct}%"


def history_view(db: Session, rows: Iterable[Any]) -> List[Dict[str, Any]]:
    """One dict per history row (same order), with previous/new internal and external pay, totals and percentage."""
    rows = list(rows)
    needed: Dict[str, set] = {}
    for h in rows:
        day = str(h.date or "")
        needed.setdefault(day, set()).add(h.employee_id)
        needed.setdefault(_day_before(day), set()).add(h.employee_id)
    pay_on = {day: current_pay_map(db, ids, as_of=day) for day, ids in needed.items() if day}
    out = []
    for h in rows:
        day = str(h.date or "")
        before = pay_on.get(_day_before(day), {}).get(h.employee_id) or zero_pay()
        after = pay_on.get(day, {}).get(h.employee_id) or zero_pay()
        out.append({
            "id": h.id,
            "employee_id": h.employee_id,
            "date": day,
            "reason": h.reason or "",
            "applied_by": h.applied_by or "",
            "previous_internal_usd": before["internal"],
            "previous_external_usd": before["external"],
            "new_internal_usd": after["internal"],
            "new_external_usd": after["external"],
            "previous_salary": before["total"],
            "new_salary": after["total"],
            "new_total_usd": after["total"],
            "pct_change": pct_text(before["total"], after["total"]),
        })
    return out
