# Bank Fees Import Kind

Decision D-056 (proposed), question Q-026. Extends the bulk import (plan 25, D-033) and its posting rules (D-052).

## Why

The `transfers` kind posts a fee only as the `fee` of a transfer between two company accounts. A standalone fee (monthly charge, card fee, subscription charge) had to be entered by hand, one transaction at a time. The 2023 cash book holds 67 of them (4,169.93 EGP and 109.89 USD across two banks).

## Manifest

Manifest only (CSV UTF-8 or the first XLSX sheet), no ZIP. Header names are exact and lowercase, dates are `YYYY-MM-DD`, amounts are plain decimals.

| Column | Required | Notes |
| :--- | :--- | :--- |
| `row_ref` | yes | unique inside the manifest |
| `account` | yes | company account name, exact match, case-insensitive |
| `date` | yes | ISO |
| `amount` | yes | greater than 0 |
| `currency` | no | must equal the account currency |
| `description` | no | default "Bank fees" |
| `category` | no | default "Bank Fees", resolved by name |
| `reference` | no | ledger reference |
| `source_file`, `confidence`, `review_flags`, `notes` | no | common columns |

## Behaviour

- One valid row posts one money-out ledger row through `LedgerService.record_manual_transaction`: payment type `BANK_FEES`, entry type `bank_fee`, no payee, source `manual`.
- Currency, closed reconciliation month and `finance.account.write` follow the manual-transaction rules; nothing is duplicated or relaxed.
- The dry run writes nothing. The commit needs `confirm_posting`, creates one row at a time, and one bad row does not block the others.
- A repeated `row_ref` in the file is an error. A row already imported (same `row_ref`, account, date, amount) is a duplicate, so re-running a file does not post twice. A fee identical to an existing ledger row only warns.
- Provenance is in the audit log (action `bank_fee.imported`: batch and `row_ref`). The ledger text carries no marker.
- Undo: delete the manual ledger row (`DELETE /api/finance/transactions/{id}`). Ledger rows are not tied to an import batch.

## Code and tests

`be/finance/services/bank_fees_importer.py`, `be/tests/test_finance_import_bank_fees.py`, `fe/api/finance/imports-api.js`, `fe/public/js/finance-import.js`, `fe/tests/ui/finance-import.spec.js`. Mock mode does not cover permissions, the closed-month lock or the re-commit guard; the backend tests do.
