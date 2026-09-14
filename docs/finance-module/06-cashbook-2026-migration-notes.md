# Cash Book 2026 Bulk Migration Notes

Related: `docs/finance-module/03-bank-accounts-ledger-implementation-plan.md`,
`docs/finance-module/05-finance-ux-implementation-plan.md` (FUX-601, PDF import wizard)

## Why this exists

The Arab Bank statement PDF (`ARABBANK_STATEMENT_01_JAN_2026.pdf`) failed to import
through the statement importer. Inspection of the extracted PDF text showed the
failure is not the suspected "multi-line details column" problem — it is a more
fundamental PDF text-extraction ordering issue:

- The bank's bilingual (Arabic/English), right-to-left statement template extracts
  header labels and data values in a flattened, non-row-aligned order. Dates,
  amounts, and reference numbers land in disconnected chunks rather than one
  coherent line per transaction.
- A meaningful portion of the Arabic-language content extracts as unrenderable
  replacement characters, consistent with a subsetted font lacking a usable
  ToUnicode CMap.
- The statement itself also only contains one transaction line for the period
  covered, so this specific file was never going to bulk-populate a ledger even
  with a perfect parser.

The durable fix (layout/coordinate-aware table extraction, with an OCR fallback for
unrenderable Arabic text) is scoped as **FUX-601** in the finance UX implementation
plan. As an interim, higher-value path, this migration imports the same real
transaction history directly from `VOYANCE-CASH-BOOK-2026.xlsx`, the cash book the
business already maintains in parallel with its bank accounts.

## Design: self-contained, no intermediate CSV

An earlier version of this migration was split into two steps: a one-off extraction
pass that wrote a CSV, and a separate import script that read that CSV. That design
was abandoned. Producing the intermediate CSV required transcribing roughly 400 rows
of real financial data (dates, account names, EGP/USD amounts) across tool calls,
which is an unacceptable source of silent transcription error for financial records
— a single mistyped amount or date would corrupt the migration input with no
visible signal.

`migrate_cashbook_2026.py` now reads `VOYANCE-CASH-BOOK-2026.xlsx` directly and
performs extraction, classification, and import in a single run. There is no
hand-authored data file anywhere in this pipeline. The script optionally supports
`--export-csv <path>` to write out the extracted/classified rows for human review,
but that export is a read-only artifact: it must never be edited and fed back into
the importer. Any correction belongs in the source spreadsheet, followed by a full
re-run of the script against the corrected `.xlsx`.

## Source structure discovered

`VOYANCE-CASH-BOOK-2026.xlsx` contains:

- **CONFIG** sheet: controlled vocabulary for `BANKS` (ARAB_BANK, CIB, NBK, CASH)
  and `PAYMENTS` (CASHWITHDRAW, CHK, INTTRANS, INBOUND_TRANS, CASH, Debit Card,
  USDTOEGP, OUTBOUND_TRANS, BANK-FEES) — matches the Phase 0 seed list in the
  bank/ledger implementation plan.
- One sheet per month (JAN–DEC), each containing:
  - A `SPENT` summary block (category rollups, not imported — these are derived
    totals, recomputed by report queries once transactions are imported).
  - `USD BALANCE SUMMARY` / `EGP BALANCE SUMMARY` blocks (opening/closing balances
    per account/currency — useful for validating post-import balances, not
    imported as transactions themselves).
  - A `Date | Account | Payment Type | REF No. | EGP | USD | EGP_O | USD_O |
    Category | Details | Rate | EGP_EQV | USD_EQV` transaction table, structured
    as **two separate data blocks** in the same columns:
    1. The main ledger (all non-Transportation activity).
    2. A second, visually separated "Transportation" petty-spend mini-ledger —
       exactly the duplicate-mini-ledger pattern the bank/ledger plan's Phase 0
       `is_petty` flag was designed to replace.
  - A trailing totals/footer block with no per-row dates (excluded from import).

## Extraction logic

Detecting the two data blocks per sheet could not rely on a second header row
(the Transportation block does not repeat the `Date/Account/...` header). Blocks
are instead detected by locating the header row once, then splitting the rows
below it into contiguous runs separated by 5+ fully blank rows — this correctly
separates the main ledger, the Transportation block, and the totals footer
without misfiring on the sheet's isolated 0/0 filler rows (which populate columns
K/L even on otherwise blank rows).

Each row is classified into one of:

- **`transaction`** — exactly one non-zero amount among EGP-in/USD-in/EGP-out/
  USD-out. Mapped to currency + direction (`in`/`out`).
- **`fx_conversion`** — `USDTOEGP` payment-type rows where USD leaves and its EGP
  equivalent arrives on the same account/date. These are same-bank currency
  conversions, not two independent transactions, and are modeled as a single
  `AccountTransfer` with `transfer_type='same_bank_fx'` (matching Phase 3 of the
  bank/ledger implementation plan) rather than forced into the transaction lane.
- **`dual_currency_fee`** — `BANK-FEES` rows carrying simultaneous EGP and USD
  amounts (a fee charged in both currencies on the same date). Split into two
  independent `transaction` records rather than one row with an ambiguous single
  amount.
- **`unclassified`** — rows with no amount, a missing date, a missing account, a
  missing category (for non-petty rows), or an amount combination that did not
  match any of the patterns above.

## Verified result (extraction only, no import performed)

| Outcome | Count |
|---|---:|
| Total candidate rows extracted | 397 |
| Clean, directly importable (`transaction` + `fx_conversion`) | 277 |
| Flagged for manual review (`unclassified` / missing data) | 120 |

Flagged-row reasons (a single row can have more than one):

- `no_amount` — filler/placeholder rows with no monetary value.
- `missing_date` — rows where the date cell was blank in the source sheet.
- `missing_account` — rows where the account column was blank.
- `missing_category` — non-petty rows with no category assigned in the source.
- `multiple_amounts_unclassified` — a small number of rows (mostly ambiguous
  `BANK-FEES` combinations) that did not match either dual-currency-fee pattern.

Flagged rows are never silently imported. Fix them in the source spreadsheet and
re-run the script; do not hand-patch the script or any exported review CSV to
force flagged rows through.

## Files in this change

- `scripts/migrations/migrate_cashbook_2026.py` — the complete, self-contained
  migration. Defaults to `--dry-run`; only `--commit` writes to the database,
  inside one transaction, and only if zero lookup errors occurred across the
  whole batch. Supports `--export-csv` for a read-only review export.

## Before running with `--commit`

1. Confirm every `account` value (ARAB_BANK, CIB, NBK, CASH) already exists as a
   `FinanceAccount` — the script will not auto-create accounts.
2. Confirm every `category` value already exists in `TransactionCategory` — the
   script will not auto-create categories.
3. Confirm every `payment_type` value already exists in `PaymentType` — the
   script will not auto-create payment types.
4. Run with `--dry-run` first (optionally with `--export-csv` for review) and
   inspect `migration_report.csv` in full.
5. Cross-check post-import account balances against the `USD BALANCE SUMMARY` /
   `EGP BALANCE SUMMARY` blocks in the source workbook for each month before
   trusting the imported ledger for reporting.
6. Resolve the ~120 flagged rows separately in the source spreadsheet; they
   represent roughly 30 percent of the extracted history and should not be
   considered "imported" until corrected in `VOYANCE-CASH-BOOK-2026.xlsx` and the
   script is re-run.
