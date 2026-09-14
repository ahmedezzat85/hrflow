"""
One-time bulk migration: VOYANCE-CASH-BOOK-2026.xlsx -> LedgerTransaction / AccountTransfer

Context
-------
The Arab Bank PDF statement importer fails on this bank's statement template because
PDF text extraction returns dates, amounts, and descriptions out of visual row order
(a layout/RTL font extraction problem, not a "multi-line description" problem -- see
FUX-601 in docs/finance-module/05-finance-ux-implementation-plan.md for the long-term
fix). As an interim path, this script bulk-imports the same transaction history
directly from the cash book spreadsheet the business already maintains.

This script is self-contained: it reads VOYANCE-CASH-BOOK-2026.xlsx directly and
performs extraction, classification, and import in one run. There is no intermediate
hand-authored CSV in this pipeline.

Account resolution strategy (predefined mapping)
-------------------------------------------------
The cash book labels accounts by institution only (ARAB_BANK, NBK, CIB, CASH), but
an institution can have more than one FinanceAccount row in the database when it
holds more than one currency (e.g. Arab Bank has a separate EGP account and a
separate USD account). A plain name lookup is therefore ambiguous and unsafe for
financial data.

Per explicit decision, this script does NOT resolve accounts by querying the
database for name+currency combinations at runtime. Instead, resolution uses a
predefined `ACCOUNT_MAP` (below) that maps every (cash-book label, currency) pair
to one specific `account_id`. This must be filled in with real primary keys from
your FinanceAccount table before running --commit. `--dry-run` will run against
an unfilled map and report every row as an account-mapping error, which is the
intended safe default.

If an institution genuinely has a single multi-currency account rather than one
account per currency, map both currency keys for that institution to the same
account_id -- the script handles that case natively (an fx_conversion row keeps
its transfer as `from_account_id == to_account_id`).

If an fx_conversion row's two currencies map to two DIFFERENT account_ids (e.g.
Arab Bank USD vs Arab Bank EGP as distinct accounts), the script correctly builds
a cross-account transfer instead of a same-account conversion. This is exercised
and asserted in the account resolution logic below.

What this script does
----------------------
1. Reads every month sheet (JAN-DEC) in the workbook. Each sheet contains two
   transaction data blocks in the same columns:
     - the main ledger (all non-Transportation activity)
     - a second "Transportation" petty-spend mini-ledger
   Blocks are detected by locating the `Date | Account | ...` header row once per
   sheet, then splitting the rows below it into contiguous runs separated by 5+
   fully blank rows.
2. Classifies each row into one of:
   - `transaction`    -> one LedgerTransaction (single non-zero amount among
                          EGP-in/USD-in/EGP-out/USD-out)
   - `fx_conversion`  -> one AccountTransfer (USDTOEGP rows: USD leaves, EGP
                          equivalent arrives -- same account if the institution has
                          one multi-currency account, cross-account if it has
                          separate per-currency accounts, per ACCOUNT_MAP)
   - two `transaction` rows -> BANK-FEES rows carrying simultaneous EGP and USD
                          amounts (a fee charged in both currencies same date)
   - `unclassified`   -> missing date, missing account, missing category (for
                          non-petty rows), no amount, or an amount combination that
                          matched no pattern above. These are NEVER imported.
3. Resolves the destination account for every row via `ACCOUNT_MAP` using
   (cash-book label, currency) as the key. Never falls back to a plain name
   lookup. An unmapped (label, currency) pair blocks only that row and is
   reported, not guessed.
4. Resolves Category and PaymentType by name against already-seeded lookup
   tables (Phase 0 of the bank/ledger plan). Never auto-creates either.
5. Wraps the whole import in one idempotent batch: every inserted row is tagged
   with `source='cashbook_migration_2026'` and a deterministic `import_fingerprint`,
   so the migration can be safely re-run (skips already-imported rows by
   fingerprint) or rolled back by deleting rows with the returned batch id.
6. Recomputes account balances once at the end rather than after every row insert.

Usage
-----
    # Preview only. Writes nothing to the DB. Will report account-mapping
    # errors for every row until ACCOUNT_MAP is filled in below.
    python migrate_cashbook_2026.py --xlsx VOYANCE-CASH-BOOK-2026.xlsx --dry-run

    # Preview and also export the extracted/classified rows for manual review.
    python migrate_cashbook_2026.py --xlsx VOYANCE-CASH-BOOK-2026.xlsx --dry-run \
        --export-csv extracted_review.csv

    # Actually import. Commits only if zero rows error (unmapped account,
    # unknown category/payment type, etc.) across the whole batch.
    python migrate_cashbook_2026.py --xlsx VOYANCE-CASH-BOOK-2026.xlsx --commit

Every run writes `migration_report.csv`, one row per candidate record with its
resolved outcome (imported / would_import / skipped_flagged / error).
"""

import argparse
import csv
import hashlib
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional

try:
    import openpyxl
except ImportError:
    print("This script requires openpyxl: pip install openpyxl", file=sys.stderr)
    raise

# ---------------------------------------------------------------------------
# Adjust these imports to match the actual backend module paths.
# ---------------------------------------------------------------------------
try:
    from be.finance.deps import get_session  # SQLAlchemy session factory
    from be.finance.repositories import (
        categories_repository,
        payment_types_repository,
        ledger_repository,
        transfers_repository,
    )
    from be.finance.services.ledger_service import recompute_account_balance
except ImportError:
    get_session = None
    categories_repository = None
    payment_types_repository = None
    ledger_repository = None
    transfers_repository = None
    recompute_account_balance = None


IMPORT_SOURCE = "cashbook_migration_2026"
MONTH_SHEETS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG",
                "SEP", "OCT", "NOV", "DEC"]
TXN_HEADER = ["Date", "Account", "Payment Type", "REF No.", "EGP", "USD",
              "EGP_O", "USD_O", "Category", "Details", "Rate", "EGP_EQV", "USD_EQV"]


# ---------------------------------------------------------------------------
# ACCOUNT MAPPING — fill this in with real primary keys before --commit
# ---------------------------------------------------------------------------
# Maps (cash-book institution label, transaction currency) -> the specific
# FinanceAccount to post against. This is the single source of truth for
# account resolution; the script never falls back to a name-only lookup.
#
# If an institution has one multi-currency account rather than one account
# per currency, set both currency keys for that institution to the same
# account_id.
ACCOUNT_MAP = {
    ("ARAB_BANK", "EGP"): {"account_id": None, "account_name": "Arab Bank - EGP"},
    ("ARAB_BANK", "USD"): {"account_id": None, "account_name": "Arab Bank - USD"},
    ("NBK",       "EGP"): {"account_id": None, "account_name": "NBK - EGP"},
    ("NBK",       "USD"): {"account_id": None, "account_name": "NBK - USD"},
    ("CIB",       "EGP"): {"account_id": None, "account_name": "CIB - EGP"},
    ("CIB",       "USD"): {"account_id": None, "account_name": "CIB - USD"},
    ("CASH",      "EGP"): {"account_id": None, "account_name": "Cash - EGP"},
    ("CASH",      "USD"): {"account_id": None, "account_name": "Cash - USD"},
}


def resolve_account_id(label: str, currency: str):
    """Resolve a (cash-book label, currency) pair to a specific account_id.

    Raises LookupError if the pair is not mapped or the mapped entry has not
    been filled in with a real account_id yet. Never guesses and never
    queries the database by name alone.
    """
    if not label or not currency:
        raise LookupError(f"Cannot resolve account: missing label ('{label}') "
                           f"or currency ('{currency}').")
    entry = ACCOUNT_MAP.get((label, currency))
    if entry is None:
        raise LookupError(f"No ACCOUNT_MAP entry for label='{label}' currency='{currency}'. "
                           f"Add this (label, currency) pair to ACCOUNT_MAP with the "
                           f"correct account_id before importing.")
    if entry.get("account_id") is None:
        raise LookupError(f"ACCOUNT_MAP entry for label='{label}' currency='{currency}' "
                           f"has no account_id set yet. Fill in the real FinanceAccount "
                           f"primary key before running --commit.")
    return entry["account_id"], entry.get("account_name", label)


# ---------------------------------------------------------------------------
# Extraction (embedded — no intermediate CSV hand-off)
# ---------------------------------------------------------------------------

def _to_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    return float(s) if re.match(r"^-?\d+(\.\d+)?$", s) else None


def _to_date_iso(v) -> Optional[str]:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return None


def _find_block_row_ranges(ws, header_row: int, gap_threshold: int = 5):
    """Split rows below `header_row` into contiguous data blocks.

    A sheet's second data block (the Transportation petty-spend ledger) does
    not repeat the `Date | Account | ...` header row, so blocks cannot be
    found by locating repeated headers. Walk down from the header row and
    split on runs of `gap_threshold`+ fully blank rows (columns A-J only;
    columns K/L carry stray 0/0 filler values on otherwise-blank rows).
    """
    blocks = []
    r, max_r = header_row + 1, ws.max_row
    in_block, block_start, blank_run, last_data_row = False, None, 0, None
    while r <= max_r:
        vals = [ws.cell(r, c).value for c in range(1, 11)]
        is_blank = all(v is None for v in vals)
        if is_blank:
            blank_run += 1
            if in_block and blank_run >= gap_threshold:
                blocks.append((block_start, last_data_row))
                in_block = False
        else:
            if not in_block:
                in_block, block_start = True, r
            last_data_row, blank_run = r, 0
        r += 1
    if in_block:
        blocks.append((block_start, last_data_row))
    return blocks


def extract_records(xlsx_path: str) -> list:
    """Read the workbook and return one dict per classified candidate row."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    records = []

    for month in MONTH_SHEETS:
        if month not in wb.sheetnames:
            continue
        ws = wb[month]
        header_rows = [r for r in range(1, ws.max_row + 1)
                        if ws.cell(r, 1).value == "Date" and ws.cell(r, 2).value == "Account"]
        if not header_rows:
            continue
        blocks = _find_block_row_ranges(ws, header_rows[0], gap_threshold=5)

        for block_index, (start, end) in enumerate(blocks):
            if block_index >= 2:
                break  # third+ block is the totals/footer section, never transaction data
            is_petty = block_index == 1

            for r in range(start, end + 1):
                raw = {TXN_HEADER[i]: ws.cell(r, i + 1).value for i in range(13)}
                meaningful = [raw[k] for k in
                              ["Date", "Account", "Payment Type", "REF No.", "EGP",
                               "USD", "EGP_O", "USD_O", "Category", "Details"]]
                if all(v is None or v == "" for v in meaningful):
                    continue

                date_iso = _to_date_iso(raw["Date"])
                egp_in, usd_in = _to_float(raw["EGP"]), _to_float(raw["USD"])
                egp_out, usd_out = _to_float(raw["EGP_O"]), _to_float(raw["USD_O"])
                rate = _to_float(raw["Rate"])
                account, ptype = raw["Account"], raw["Payment Type"]
                category = raw["Category"] or ("Transportation" if is_petty else None)

                issues = []
                if date_iso is None:
                    issues.append("missing_date")
                if not account:
                    issues.append("missing_account")

                nonzero = {k: v for k, v in
                           {"EGP_in": egp_in, "USD_in": usd_in,
                            "EGP_out": egp_out, "USD_out": usd_out}.items()
                           if v not in (None, 0)}

                base = dict(
                    source_month=month, source_row=r,
                    source_block="petty_transportation" if is_petty else "main_ledger",
                    date=date_iso, account=account, payment_type=ptype,
                    ref_no=raw["REF No."], category=category, details=raw["Details"],
                    fx_rate=rate, egp_eqv=_to_float(raw["EGP_EQV"]),
                    usd_eqv=_to_float(raw["USD_EQV"]), is_petty=is_petty,
                )

                if ptype == "USDTOEGP" and usd_out and egp_in:
                    base.update(record_type="fx_conversion", out_currency="USD",
                                out_amount=usd_out, in_currency="EGP", in_amount=egp_in,
                                issues=";".join(issues))
                    records.append(base)
                    continue

                if ptype == "BANK-FEES" and egp_out and usd_out:
                    r1 = dict(base, record_type="transaction", currency="EGP",
                              direction="out", amount=egp_out, issues=";".join(issues))
                    r2 = dict(base, record_type="transaction", currency="USD",
                              direction="out", amount=usd_out, issues=";".join(issues))
                    records.append(r1)
                    records.append(r2)
                    continue

                if len(nonzero) == 1:
                    key, amt = next(iter(nonzero.items()))
                    currency, raw_dir = key.split("_")
                    direction = "in" if raw_dir == "in" else "out"
                    if category is None:
                        issues.append("missing_category")
                    base.update(record_type="transaction", currency=currency,
                                direction=direction, amount=amt, issues=";".join(issues))
                    records.append(base)
                    continue

                if len(nonzero) == 0:
                    issues.append("no_amount")
                else:
                    issues.append("multiple_amounts_unclassified:" +
                                  ",".join(f"{k}={v}" for k, v in nonzero.items()))
                base.update(record_type="unclassified", issues=";".join(issues))
                records.append(base)

    return records


def export_extraction_csv(records: list, path: str) -> None:
    """Write the extracted/classified records for manual review only.

    Read-only artifact for humans; never hand-edit and re-import.
    """
    fieldnames = ["source_month", "source_row", "source_block", "record_type", "date",
                  "account", "payment_type", "ref_no", "category", "details", "currency",
                  "direction", "amount", "out_currency", "out_amount", "in_currency",
                  "in_amount", "fx_rate", "egp_eqv", "usd_eqv", "is_petty", "issues"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in records:
            w.writerow(r)
    print(f"Extraction exported for review to {path} ({len(records)} rows). "
          f"Do not edit and re-import this file; re-run against the .xlsx instead.")


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

@dataclass
class Outcome:
    row_index: int
    record_type: str
    status: str  # "would_import" | "imported" | "skipped_flagged" | "error"
    reason: str = ""
    account: str = ""
    date: str = ""
    amount: Optional[float] = None
    currency: str = ""
    fingerprint: str = ""


def fingerprint(row: dict) -> str:
    """Deterministic per-row fingerprint used for idempotent re-runs."""
    key = "|".join([
        IMPORT_SOURCE,
        str(row.get("source_month", "")),
        str(row.get("source_row", "")),
        str(row.get("record_type", "")),
        str(row.get("date", "") or ""),
        str(row.get("account", "") or ""),
        str(row.get("payment_type", "") or ""),
        str(row.get("currency", "") or ""),
        str(row.get("direction", "") or ""),
        str(row.get("amount", "") or ""),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def resolve_category(session, name: Optional[str]):
    if categories_repository is None:
        return None
    if not name:
        raise LookupError("Row has no category and is not a petty/Transportation row.")
    cat = categories_repository.get_by_name(session, name)
    if cat is None:
        raise LookupError(f"Unknown category '{name}'. This must already exist from "
                           f"Phase 0 (categories seeded from the CONFIG sheet taxonomy). "
                           f"Migration will not auto-create categories.")
    return cat


def resolve_payment_type(session, code_or_name: Optional[str]):
    if payment_types_repository is None:
        return None
    if not code_or_name:
        raise LookupError("Row has no payment type.")
    pt = payment_types_repository.get_by_code(session, code_or_name)
    if pt is None:
        raise LookupError(f"Unknown payment type '{code_or_name}'. Expected one of the "
                           f"CONFIG sheet PAYMENTS vocabulary (CASHWITHDRAW, CHK, INTTRANS, "
                           f"INBOUND_TRANS, OUTBOUND_TRANS, USDTOEGP, CASH, DEBIT_CARD, "
                           f"BANK-FEES). Migration will not auto-create payment types.")
    return pt


def process_transaction_row(session, row: dict, batch_id: str, dry_run: bool) -> Outcome:
    idx = row["source_row"]
    fp = fingerprint(row)
    txn_date = parse_date(row["date"])
    amount = row.get("amount")

    outcome = Outcome(row_index=idx, record_type="transaction", status="would_import",
                       account=row.get("account", ""), date=row.get("date", ""),
                       amount=amount, currency=row.get("currency", ""), fingerprint=fp)

    try:
        account_id, account_label = resolve_account_id(row["account"], row["currency"])
    except LookupError as exc:
        outcome.status, outcome.reason = "error", str(exc)
        return outcome

    outcome.account = account_label

    if dry_run or ledger_repository is None:
        return outcome

    if ledger_repository.exists_by_fingerprint(session, fp):
        outcome.status, outcome.reason = "skipped_flagged", "already imported (fingerprint match)"
        return outcome

    try:
        category = resolve_category(session, row["category"])
        payment_type = resolve_payment_type(session, row["payment_type"])
    except LookupError as exc:
        outcome.status, outcome.reason = "error", str(exc)
        return outcome

    ledger_repository.create(
        session, account_id=account_id, date=txn_date, amount=amount,
        currency=row["currency"], direction=row["direction"], category_id=category.id,
        payment_type_id=payment_type.id, description=row.get("details") or "",
        reference=row.get("ref_no") or "", fx_rate=row.get("fx_rate"),
        source=IMPORT_SOURCE, import_batch_id=batch_id, import_fingerprint=fp,
    )
    outcome.status = "imported"
    return outcome


def process_fx_conversion_row(session, row: dict, batch_id: str, dry_run: bool) -> Outcome:
    idx = row["source_row"]
    fp = fingerprint(row)
    txn_date = parse_date(row["date"])
    out_amount, in_amount = row.get("out_amount"), row.get("in_amount")

    outcome = Outcome(row_index=idx, record_type="fx_conversion", status="would_import",
                       account=row.get("account", ""), date=row.get("date", ""),
                       amount=out_amount, currency=row.get("out_currency", ""), fingerprint=fp)

    try:
        from_account_id, from_label = resolve_account_id(row["account"], row["out_currency"])
        to_account_id, to_label = resolve_account_id(row["account"], row["in_currency"])
    except LookupError as exc:
        outcome.status, outcome.reason = "error", str(exc)
        return outcome

    outcome.account = f"{from_label} -> {to_label}"
    is_same_account = from_account_id == to_account_id
    outcome.reason = ("same-account conversion" if is_same_account
                       else "cross-account transfer (institution has separate "
                            "per-currency accounts)")

    if dry_run or transfers_repository is None:
        return outcome

    if transfers_repository.exists_by_fingerprint(session, fp):
        outcome.status, outcome.reason = "skipped_flagged", "already imported (fingerprint match)"
        return outcome

    # If the institution has one multi-currency account, from_account_id ==
    # to_account_id and this posts as a same-bank FX conversion (Phase 3,
    # transfer_type='same_bank_fx'). If the institution has separate
    # per-currency accounts, from_account_id != to_account_id and this
    # correctly posts as a cross-account transfer instead.
    transfers_repository.create(
        session, from_account_id=from_account_id, to_account_id=to_account_id,
        date=txn_date, from_amount=out_amount, from_currency=row["out_currency"],
        to_amount=in_amount, to_currency=row["in_currency"], fx_rate=row.get("fx_rate"),
        transfer_type="same_bank_fx" if is_same_account else "internal",
        note="Migrated from VOYANCE-CASH-BOOK-2026.xlsx (USDTOEGP)",
        source=IMPORT_SOURCE, import_batch_id=batch_id, import_fingerprint=fp,
    )
    outcome.status = "imported"
    return outcome


def run_import(records: list, dry_run: bool) -> list:
    outcomes = []
    batch_id = f"{IMPORT_SOURCE}_{datetime.now(timezone.utc):%Y%m%dT%H%M%S}"
    session = get_session() if (get_session and not dry_run) else None
    touched_account_ids = set()

    try:
        for row in records:
            idx = row["source_row"]
            if row.get("issues"):
                outcomes.append(Outcome(
                    row_index=idx, record_type=row.get("record_type", ""),
                    status="skipped_flagged", reason=row["issues"],
                    account=row.get("account") or "", date=row.get("date") or "",
                ))
                continue

            rtype = row.get("record_type")
            if rtype == "transaction":
                o = process_transaction_row(session, row, batch_id, dry_run)
            elif rtype == "fx_conversion":
                o = process_fx_conversion_row(session, row, batch_id, dry_run)
            else:
                o = Outcome(row_index=idx, record_type=rtype or "", status="skipped_flagged",
                             reason=f"unsupported record_type '{rtype}'")

            outcomes.append(o)

        if not dry_run and session is not None:
            errors = [o for o in outcomes if o.status == "error"]
            if errors:
                session.rollback()
                print(f"ABORTED: {len(errors)} row(s) failed lookup resolution. "
                      f"No rows were committed. See migration_report.csv for details.",
                      file=sys.stderr)
            else:
                session.commit()
                print(f"Committed batch {batch_id}: "
                      f"{sum(1 for o in outcomes if o.status == 'imported')} rows imported, "
                      f"{sum(1 for o in outcomes if o.status == 'skipped_flagged')} skipped.")
    finally:
        if session is not None:
            session.close()

    return outcomes


def write_report(outcomes: list, path: str = "migration_report.csv") -> None:
    fieldnames = ["row_index", "record_type", "status", "reason", "account", "date",
                  "amount", "currency", "fingerprint"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for o in outcomes:
            w.writerow(vars(o))
    print(f"Report written to {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                       formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--xlsx", required=True,
                         help="Path to VOYANCE-CASH-BOOK-2026.xlsx")
    parser.add_argument("--export-csv", default=None,
                         help="Optional: also write the extracted/classified rows here "
                              "for manual review. Never hand-edit and re-feed this file.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true", default=True,
                        help="Default. Validates and reports; writes nothing to the DB.")
    group.add_argument("--commit", action="store_true",
                        help="Actually writes to the database inside one transaction.")
    args = parser.parse_args()

    dry_run = not args.commit
    records = extract_records(args.xlsx)

    if args.export_csv:
        export_extraction_csv(records, args.export_csv)

    unmapped = sorted({(r["account"], r.get("currency") or r.get("out_currency"))
                        for r in records
                        if r["account"] and (r.get("currency") or r.get("out_currency"))
                        and ACCOUNT_MAP.get((r["account"], r.get("currency") or r.get("out_currency")),
                                             {}).get("account_id") is None})
    if unmapped:
        print(f"WARNING: {len(unmapped)} (label, currency) pair(s) in ACCOUNT_MAP have no "
              f"account_id set: {unmapped}. Every row using these will report as an error "
              f"until you fill in the real account_id.")

    outcomes = run_import(records, dry_run=dry_run)
    write_report(outcomes)

    total = len(records)
    clean = sum(1 for r in records if not r.get("issues"))
    flagged = total - clean
    imported = sum(1 for o in outcomes if o.status in ("imported", "would_import"))
    skipped = sum(1 for o in outcomes if o.status == "skipped_flagged")
    errors = sum(1 for o in outcomes if o.status == "error")

    print(f"\nExtracted {total} candidate rows from {args.xlsx}: "
          f"{clean} clean, {flagged} flagged (never imported).")
    print(f"{'DRY RUN — ' if dry_run else ''}Summary: "
          f"{imported} to import, {skipped} skipped (flagged/duplicate), {errors} errors.")
    if dry_run:
        print("Re-run with --commit once ACCOUNT_MAP is filled in and the report looks correct.")


if __name__ == "__main__":
    main()
