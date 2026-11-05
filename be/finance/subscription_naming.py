"""
be/finance/subscription_naming.py
One naming rule for the vendor bill that a subscription charge produces, shared by every route that creates one
(Log charge, Already paid settlement, bulk import), so live and imported subscription bills read the same.

    SUB-<subscription id>-<subscription name with spaces as underscores>-<yyyymmdd>

Bill numbers hold at most 50 characters, so a long name is cut (the id and the date are never cut).
"""
import re

BILL_NUMBER_MAX = 50


def _safe_name(name: str) -> str:
    text = re.sub(r"\s+", "_", (name or "").strip())
    text = re.sub(r"[^\w\-]", "", text)  # letters, digits, underscore, hyphen (any script)
    return re.sub(r"_+", "_", text).strip("_-")


def subscription_bill_number(subscription_id: int, name: str, billing_date: str) -> str:
    stamp = (billing_date or "").replace("-", "")
    head = f"SUB-{subscription_id}"
    tail = f"-{stamp}" if stamp else ""
    room = BILL_NUMBER_MAX - len(head) - len(tail) - 1  # one more for the hyphen before the name
    safe = _safe_name(name)[: max(room, 0)].rstrip("_-")
    return f"{head}-{safe}{tail}" if safe else f"{head}{tail}"
