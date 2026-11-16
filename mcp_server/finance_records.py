"""Read-only finance record tools (FM-2): transfers, bills, cheques, reference lists and import batches.

Same rules as finance_tools.py: output keys are whitelisted, amounts stay in their own currency, every list has a
mandatory date range or a limit, a hard cap of 200 rows and a cursor. Vendor tax ids, contacts, signers and anything
that could identify an account never leave this module."""
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from finance_tools import (BOOKS, MAX_FINANCE_ROWS, _account_by_name, _all_accounts, _book, _clean, _date_range, _limit,
                           _money, _offset)
from hrflow_client import HRFlowClient, HRFlowError

MAX_SCAN_PAGES = 30          # bills are read 100 at a time; past this the caller must narrow the question
KINDS = ("vendors", "categories", "payment_types", "accounts")
BATCH_KINDS = ("bills", "cheques", "invoices", "transfers", "bank_fees")


def _paged(client: HRFlowClient, path: str, params: Dict[str, Any], limit: int, offset: int) -> Tuple[List[Dict[str, Any]], bool]:
    """One page of a REST list plus whether more exist (a one-row peek when the page came back full)."""
    rows = client.get(path, params={**_clean(params), "limit": limit, "offset": offset})
    more = False
    if len(rows) == limit:
        more = bool(client.get(path, params={**_clean(params), "limit": 1, "offset": offset + limit}))
    return rows, more


def _page_result(rows: List[Any], offset: int, limit: int, more: bool) -> Dict[str, Any]:
    return {"returned": len(rows), "truncated": more, "next_cursor": str(offset + limit) if more else None}


def _scan_all(client: HRFlowClient, path: str, params: Dict[str, Any], page: int, what: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for _ in range(MAX_SCAN_PAGES):
        rows = client.get(path, params={**_clean(params), "limit": page, "offset": len(out)})
        out.extend(rows)
        if len(rows) < page:
            return out
    raise HRFlowError(f"Too many {what} to read in one call. Narrow the question (vendor, status, number prefix or account).")


def _vendor_id(client: HRFlowClient, name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    rows = client.get("/api/finance/vendors", params={"search": name, "limit": 100})
    found = [v for v in rows if (v.get("name") or "").strip().lower() == name.strip().lower()]
    if len(found) != 1:
        raise HRFlowError(f"No single vendor is named '{name}'. Use finance_list_reference_data(kind='vendors') for exact names.")
    return found[0]["id"]


def finance_list_transfers(client: HRFlowClient, date_from: str, date_to: str, account: Optional[str] = None,
                           limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
    _date_range(date_from, date_to)
    _limit(limit)
    offset = _offset(cursor)
    account_id = _account_by_name(client, account)["id"] if account else None
    rows, more = _paged(client, "/api/finance/transfers",
                        {"date_from": date_from, "date_to": date_to, "account_id": account_id}, limit, offset)
    view = [{"id": t.get("id"), "date": t.get("date"), "from_account": t.get("from_account_name"),
             "to_account": t.get("to_account_name"), "from_amount": _money(t.get("from_amount")),
             "from_currency": t.get("from_currency"), "to_amount": _money(t.get("to_amount")),
             "to_currency": t.get("to_currency"), "fx_rate": t.get("fx_rate"), "fee": _money(t.get("fee")),
             "transfer_type": t.get("transfer_type"), "settlement_status": t.get("settlement_status"),
             "exchange_reference": t.get("exchange_reference"), "outflow_transaction_id": t.get("outflow_transaction_id"),
             "inflow_transaction_id": t.get("inflow_transaction_id")} for t in rows]
    return {"date_from": date_from, "date_to": date_to, "transfers": view, **_page_result(view, offset, limit, more),
            "note": "Voided transfers are left out. Each transfer shows both legs in their own currencies; nothing is converted."}


def finance_list_bills(client: HRFlowClient, date_from: str, date_to: str, vendor: Optional[str] = None,
                       status: Optional[str] = None, number_prefix: Optional[str] = None,
                       paid_from_account: Optional[str] = None, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
    """Bills whose issue date falls in the range."""
    _date_range(date_from, date_to)
    _limit(limit)
    offset = _offset(cursor)
    bills = _scan_all(client, "/api/finance/bills", {"vendor_id": _vendor_id(client, vendor), "status": status,
                                                      "search": number_prefix}, 100, "bills")
    prefix = (number_prefix or "").strip().lower()
    account = (paid_from_account or "").strip().lower()
    keep = [b for b in bills
            if b.get("issue_date") and date_from <= b["issue_date"] <= date_to
            and (not prefix or (b.get("bill_number") or "").lower().startswith(prefix))
            and (not account or (b.get("paid_from_account_name") or "").strip().lower() == account)]
    keep.sort(key=lambda b: (b["issue_date"], b["id"]))
    page = keep[offset:offset + limit]
    more = offset + limit < len(keep)
    view = [{"id": b.get("id"), "number": b.get("bill_number"), "vendor": b.get("vendor_name"), "issue_date": b.get("issue_date"),
             "due_date": b.get("due_date"), "status": b.get("status"), "total": _money(b.get("total")),
             "amount_paid": _money(b.get("amount_paid")), "remaining_balance": _money(b.get("remaining_balance")),
             "currency": b.get("currency"), "category": b.get("category_name"), "book": b.get("book"),
             "paid_from_account": b.get("paid_from_account_name"), "book_source": b.get("book_source"),
             "capture_source": b.get("capture_source"), "import_batch_id": b.get("import_batch_id")} for b in page]
    return {"date_from": date_from, "date_to": date_to, "matching_rows": len(keep), "bills": view,
            **_page_result(view, offset, limit, more),
            "note": "paid_from_account is the paying account, or the vendor's last account when book_source is 'inferred'."}


def finance_list_cheques(client: HRFlowClient, date_from: str, date_to: str, status: Optional[str] = None,
                         account: Optional[str] = None, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
    """Cheques whose issue date falls in the range."""
    _date_range(date_from, date_to)
    _limit(limit)
    offset = _offset(cursor)
    account_id = _account_by_name(client, account)["id"] if account else None
    found: List[Dict[str, Any]] = []
    for year in range(int(date_from[:4]), int(date_to[:4]) + 1):
        found.extend(_scan_all(client, "/api/finance/cheques",
                               {"fiscal_year": year, "status": status, "account_id": account_id}, 200, "cheques"))
    keep = sorted((c for c in found if date_from <= (c.get("issue_date") or "") <= date_to),
                  key=lambda c: (c["issue_date"], c["id"]))
    page = keep[offset:offset + limit]
    more = offset + limit < len(keep)
    view = [{"id": c.get("id"), "number": c.get("cheque_number"), "issue_date": c.get("issue_date"),
             "clear_date": c.get("clear_date"), "amount": _money(c.get("amount")), "currency": c.get("currency"),
             "status": c.get("status"), "account": c.get("account_name"), "payee": c.get("payee"),
             "purpose": c.get("purpose_type"), "linked_bill_id": c.get("linked_bill_id"),
             "import_batch_id": c.get("import_batch_id")} for c in page]
    return {"date_from": date_from, "date_to": date_to, "matching_rows": len(keep), "cheques": view,
            **_page_result(view, offset, limit, more)}


def finance_list_reference_data(client: HRFlowClient, kind: str) -> Dict[str, Any]:
    if kind not in KINDS:
        raise HRFlowError(f"kind must be one of {list(KINDS)}.")
    if kind == "vendors":
        rows = _scan_all(client, "/api/finance/vendors", {}, 100, "vendors")
        items = [{"name": v.get("name"), "active": bool(v.get("is_active")), "default_category": v.get("default_category_name")} for v in rows]
    elif kind == "categories":
        items = [{"name": c.get("name"), "kind": c.get("kind"), "active": bool(c.get("is_active"))}
                 for c in client.get("/api/finance/categories")]
    elif kind == "payment_types":
        items = [{"name": p.get("name"), "code": p.get("code"), "active": bool(p.get("is_active"))}
                 for p in client.get("/api/finance/payment-types")]
    else:
        items = [{"name": a.get("account_name"), "currency": a.get("currency"), "book": a.get("book_code"),
                  "type": a.get("account_type"), "active": bool(a.get("is_active"))} for a in _all_accounts(client)]
    items.sort(key=lambda i: (i["name"] or "").lower())
    return {"kind": kind, "count": len(items), "items": items, "note": "Exact names, as HRFlow matches them (case-insensitive)."}


def finance_list_import_batches(client: HRFlowClient, kind: Optional[str] = None, date_from: Optional[str] = None,
                                date_to: Optional[str] = None, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
    if kind is not None and kind not in BATCH_KINDS:
        raise HRFlowError(f"kind must be one of {list(BATCH_KINDS)}.")
    if date_from or date_to:
        _date_range(date_from, date_to)
    _limit(limit)
    offset = _offset(cursor)
    rows, more = _paged(client, "/api/finance/imports/batches", {"kind": kind, "date_from": date_from, "date_to": date_to}, limit, offset)
    view = [{k: b.get(k) for k in ("id", "kind", "created_at", "manifest_name", "archive_name", "rows_total", "rows_created", "rows_failed")}
            for b in rows]
    return {"batches": view, **_page_result(view, offset, limit, more),
            "note": "Newest first. Failed rows are counted but were never created, so they have no record."}


def finance_get_import_batch_rows(client: HRFlowClient, batch_id: int, limit: int = 50, cursor: Optional[str] = None) -> Dict[str, Any]:
    _limit(limit)
    offset = _offset(cursor)
    body = client.get(f"/api/finance/imports/batches/{int(batch_id)}/rows", params={"limit": limit, "offset": offset})
    more = offset + limit < body["matching_rows"]
    rows = [{k: r.get(k) for k in ("row_ref", "created", "id", "label")} for r in body["rows"]]
    b = body["batch"]
    return {"batch": {k: b.get(k) for k in ("id", "kind", "created_at", "manifest_name", "rows_total", "rows_created", "rows_failed")},
            "matching_rows": body["matching_rows"], "rows": rows, **_page_result(rows, offset, limit, more),
            "note": "Rows are the records the run created, with the manifest's row_ref. Failed rows are not stored."}
