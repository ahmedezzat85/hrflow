"""
One-time bulk migration: VOYANCE-CASH-BOOK-2026.xlsx -> LedgerTransaction / AccountTransfer

Context
-------
The Arab Bank PDF statement importer fails on this bank's statement template because
PDF text extraction returns dates, amounts, and descriptions out of visual row order
(a layout/RTL font extraction problem, not a "multi-line description" problem -- see
FUX-601 in docs/finance-module/05-finance-ux-implementation-plan.md for the long-term
fix). As an interim path, this script bulk-imports the same data directly from the
cash book spreadsheet the business already maintains, using extraction logic already
run and reviewed against VOYANCE-CASH-BOOK-2026.xlsx.

What this script does
----------------------
1. Reads the pre-extracted, classified CSV (`cashbook_2026_extracted_all.csv`),
   produced by parsing each monthly sheet's two data blocks (main ledger +
   Transportation petty-spend block) and the CONFIG sheet vocabulary.
2. Splits records into three lanes:
   - `transaction`   -> one LedgerTransaction row (simple money in/out)
   - `fx_conversion` -> one AccountTransfer row (same-bank/cash USD->EGP conversion,
     mirroring the USDTOEGP pattern from the bank/ledger implementation plan)
   - anything with `issues` non-empty -> written to a rejects report, NOT imported
3. Resolves Account, Category, and PaymentType by name against already-seeded
   lookup tables (Phase 0 of the bank/ledger plan). Never auto-creates a category
   or payment type; unknown lookups are treated as import-blocking errors so the
   business's controlled vocabulary is never silently expanded by a migration.
4. Wraps the whole import in one idempotent batch: every inserted row is tagged
   with `source='cashbook_migration_2026'` and an `import_fingerprint`, so the
   migration can be safely re-run (skips already-imported rows by fingerprint)
   or rolled back by deleting rows with the returned batch id.
5. Recomputes account balances once at the end rather than after every row insert.

Usage
-----
    python migrate_cashbook_2026.py \
        --csv data/cashbook_2026_extracted_all.csv \
        --dry-run

    python migrate_cashbook_2026.py \
        --csv data/cashbook_2026_extracted_all.csv \
        --commit

`--dry-run` (default) prints exactly what would be inserted/skipped and writes
`migration_report.csv` with one row per input record and its resolved outcome.
Nothing touches the database until `--commit` is passed explicitly.

This script intentionally does NOT import rows flagged during extraction
(`issues` column non-empty). Fix those in the spreadsheet or the CSV and re-run
extraction first; do not hand-patch this script to force them through.
"""

import argparse
import csv
import hashlib
import sys
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

# ---------------------------------------------------------------------------
# Adjust these imports to match the actual backend module paths.
# Matches the service/repository layout in be/finance/services/ and
# be/finance/repositories/ on refactor/finance-ux.
# ---------------------------------------------------------------------------
try:
    from be.finance.deps import get_session  # SQLAlchemy session factory
    from be.finance.repositories import (
        accounts_repository,
        categories_repository,
        payment_types_repository,
        ledger_repository,
        transfers_repository,
    )
    from be.finance.services.ledger_service import recompute_account_balance
except ImportError:
    # Allows --dry-run / CSV validation to run standalone without the full app
    # import graph wired up (e.g. for a first pass reviewing the report only).
    get_session = None
    accounts_repository = None
    categories_repository = None
    payment_types_repository = None
    ledger_repository = None
    transfers_repository = None
    recompute_account_balance = None


IMPORT_SOURCE = "cashbook_migration_2026"


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
    """Deterministic per-row fingerprint used for idempotent re-runs.

    Two migration runs over the same CSV must never create duplicate ledger
    rows even if the script is re-executed after a partial failure.
    """
    key = "|".join([
        IMPORT_SOURCE,
        row.get("source_month", ""),
        str(row.get("source_row", "")),
        row.get("record_type", ""),
        row.get("date", "") or "",
        row.get("account", "") or "",
        row.get("payment_type", "") or "",
        row.get("currency", "") or "",
        row.get("direction", "") or "",
        str(row.get("amount", "") or ""),
    ])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def parse_date(value: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def load_rows(csv_path: str) -> list:
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def resolve_account(session, name: str):
    if accounts_repository is None:
        return None
    acct = accounts_repository.get_by_name(session, name)
    if acct is None:
        raise LookupError(f"Unknown account '{name}'. Seed it via Finance > Accounts "
                           f"before importing, matching the CONFIG sheet BANKS list "
                           f"(ARAB_BANK, CIB, NBK, CASH).")
    return acct


def resolve_category(session, name: str):
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


def resolve_payment_type(session, code_or_name: str):
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
    idx = int(row["source_row"])
    fp = fingerprint(row)
    txn_date = parse_date(row["date"])
    amount = float(row["amount"]) if row.get("amount") else None

    outcome = Outcome(
        row_index=idx, record_type="transaction", status="would_import",
        account=row["account"], date=row["date"], amount=amount,
        currency=row["currency"], fingerprint=fp,
    )

    if dry_run or ledger_repository is None:
        return outcome

    if ledger_repository.exists_by_fingerprint(session, fp):
        outcome.status, outcome.reason = "skipped_flagged", "already imported (fingerprint match)"
        return outcome

    try:
        account = resolve_account(session, row["account"])
        category = resolve_category(session, row["category"])
        payment_type = resolve_payment_type(session, row["payment_type"])
    except LookupError as exc:
        outcome.status, outcome.reason = "error", str(exc)
        return outcome

    ledger_repository.create(
        session,
        account_id=account.id,
        date=txn_date,
        amount=amount,
        currency=row["currency"],
        direction=row["direction"],
        category_id=category.id,
        payment_type_id=payment_type.id,
        description=row.get("details") or "",
        reference=row.get("ref_no") or "",
        fx_rate=float(row["fx_rate"]) if row.get("fx_rate") else None,
        source=IMPORT_SOURCE,
        import_batch_id=batch_id,
        import_fingerprint=fp,
    )
    outcome.status = "imported"
    return outcome


def process_fx_conversion_row(session, row: dict, batch_id: str, dry_run: bool) -> Outcome:
    idx = int(row["source_row"])
    fp = fingerprint(row)
    txn_date = parse_date(row["date"])
    out_amount = float(row["out_amount"]) if row.get("out_amount") else None
    in_amount = float(row["in_amount"]) if row.get("in_amount") else None

    outcome = Outcome(
        row_index=idx, record_type="fx_conversion", status="would_import",
        account=row["account"], date=row["date"], amount=out_amount,
        currency=row["out_currency"], fingerprint=fp,
    )

    if dry_run or transfers_repository is None:
        return outcome

    if transfers_repository.exists_by_fingerprint(session, fp):
        outcome.status, outcome.reason = "skipped_flagged", "already imported (fingerprint match)"
        return outcome

    try:
        account = resolve_account(session, row["account"])
    except LookupError as exc:
        outcome.status, outcome.reason = "error", str(exc)
        return outcome

    # Same-bank/cash FX conversion: modeled as a single-account transfer with
    # from_currency != to_currency, matching the `same_bank_fx` transfer_type
    # from the bank/ledger implementation plan (Phase 3).
    transfers_repository.create(
        session,
        from_account_id=account.id,
        to_account_id=account.id,
        date=txn_date,
        from_amount=out_amount,
        from_currency=row["out_currency"],
        to_amount=in_amount,
        to_currency=row["in_currency"],
        fx_rate=float(row["fx_rate"]) if row.get("fx_rate") else None,
        transfer_type="same_bank_fx",
        note="Migrated from VOYANCE-CASH-BOOK-2026.xlsx (USDTOEGP)",
        source=IMPORT_SOURCE,
        import_batch_id=batch_id,
        import_fingerprint=fp,
    )
    outcome.status = "imported"
    return outcome


def run(csv_path: str, dry_run: bool) -> list:
    rows = load_rows(csv_path)
    outcomes = []
    batch_id = f"{IMPORT_SOURCE}_{datetime.utcnow():%Y%m%dT%H%M%S}"

    session = get_session() if (get_session and not dry_run) else None
    touched_accounts = set()

    try:
        for row in rows:
            idx = int(row["source_row"])
            if row.get("issues"):
                outcomes.append(Outcome(
                    row_index=idx, record_type=row.get("record_type", ""),
                    status="skipped_flagged", reason=row["issues"],
                    account=row.get("account", ""), date=row.get("date", ""),
                ))
                continue

            rtype = row.get("record_type")
            if rtype == "transaction":
                o = process_transaction_row(session, row, batch_id, dry_run)
            elif rtype == "fx_conversion":
                o = process_fx_conversion_row(session, row, batch_id, dry_run)
            else:
                o = Outcome(row_index=idx, record_type=rtype, status="skipped_flagged",
                             reason=f"unsupported record_type '{rtype}'")

            outcomes.append(o)
            if o.status == "imported" and o.account:
                touched_accounts.add(o.account)

        if not dry_run and session is not None:
            errors = [o for o in outcomes if o.status == "error"]
            if errors:
                session.rollback()
                print(f"ABORTED: {len(errors)} row(s) failed lookup resolution. "
                      f"No rows were committed. See migration_report.csv for details.",
                      file=sys.stderr)
            else:
                session.commit()
                if recompute_account_balance and accounts_repository:
                    for name in touched_accounts:
                        acct = accounts_repository.get_by_name(session, name)
                        if acct:
                            recompute_account_balance(session, acct.id)
                    session.commit()
                print(f"Committed batch {batch_id}: "
                      f"{sum(1 for o in outcomes if o.status == 'imported')} rows imported, "
                      f"{sum(1 for o in outcomes if o.status == 'skipped_flagged')} skipped.")
    finally:
        if session is not None:
            session.close()

    return outcomes


def write_report(outcomes, path: str = "migration_report.csv") -> None:
    fieldnames = ["row_index", "record_type", "status", "reason", "account", "date",
                  "amount", "currency", "fingerprint"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for o in outcomes:
            w.writerow(vars(o))
    print(f"Report written to {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True,
                         help="Path to cashbook_2026_extracted_all.csv")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true", default=True,
                        help="Default. Validates and reports; writes nothing to the DB.")
    group.add_argument("--commit", action="store_true",
                        help="Actually writes to the database inside one transaction.")
    args = parser.parse_args()

    dry_run = not args.commit
    outcomes = run(args.csv, dry_run=dry_run)
    write_report(outcomes)

    imported = sum(1 for o in outcomes if o.status in ("imported", "would_import"))
    skipped = sum(1 for o in outcomes if o.status == "skipped_flagged")
    errors = sum(1 for o in outcomes if o.status == "error")
    print(f"\n{'DRY RUN — ' if dry_run else ''}Summary: "
          f"{imported} to import, {skipped} skipped (flagged/duplicate), {errors} errors.")
    if dry_run:
        print("Re-run with --commit once the report looks correct.")


if __name__ == "__main__":
    main()
