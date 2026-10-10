# 22. Finance restyle v2: backend support (three small API additions)

Status: **Implemented on 10 Oct 2026 (D-027).**
Work type: backend only (`be/`). Runs **in parallel** with the UI plan [21-finance-ui-restyle-v2.md](21-finance-ui-restyle-v2.md), which is done by a different agent on a different branch. The UI already works without these fields (it feature-detects them), so nothing here blocks the UI and nothing in the UI blocks this.

## 1. Why

The approved Finance design (doc 21) shows three things the API does not return today:

| ID | Screen | Needs |
| :--- | :--- | :--- |
| BE-1 | Every table with a category (Bills, Ledger, Settings, later charts) | A stored colour per transaction category, chosen in Finance Settings |
| BE-2 | Sales › Customers | Each customer's open receivable balance, open invoice count and late count |
| BE-3 | Spend › Vendors | Each vendor's open payable balance and open bill count |

## 2. Rules for the implementer

- Follow `AGENTS.md` (High-Risk workflow: write `implementation_plan.md`, show it to the owner, wait for approval, then implement). Backend 3-tier order: models/schemas → repositories → services → routers.
- **Do not edit anything under `fe/`** (the UI agent owns the frontend and the mock API, and will add these fields to the mocks itself). Do not edit `docs/project-context/*` or doc 21; update only this doc's status.
- Additive only: no field is removed or renamed; existing clients keep working. No permission changes: the list endpoints keep `finance.customer.read` and `finance.vendor.read`, and the category endpoints keep their current permissions.
- **Reuse the existing balance logic.** Customer balances must come from the same code that powers the customer 360 receivables summary (`CustomersService.get_customer_360`) and invoice balances (paid amounts, withholding per D-024). Vendor balances must come from the same logic as `VendorsRepository.get_vendor_metrics` and the bill balance used for payments (D-016, B3). Do not write a new formula; if the existing ones disagree, stop and ask.
- No N+1 queries on list endpoints: compute the summaries for the returned page in one or two grouped queries.
- Never sum different currencies: every summary is a list with one entry per currency.
- SQLite for tests, PostgreSQL in production: no SQLite-only SQL; migrations use Alembic batch mode where SQLite needs it and have a working `downgrade`.
- Never run a migration against `hrflow_Prod.db`; test up and down on a copy in a temp folder. Never commit a `.db` file.

## 3. Slices

### BE-1 Category colour

- Model: add `color = Column(String(16), nullable=True)` to the transaction category model (table `finance_transaction_categories`).
- Allowed values (fixed order, same as doc 21 §3.3): `blue`, `orange`, `teal`, `violet`, `green`, `pink`, `sky`, `ochre`. Store the name, never a hex value.
- Migration `0035_category_color` (confirm the head is `0034_payroll_ledger_source`; renumber only if the head moved and say so): add the column, then backfill existing rows in `sort_order` (then `id`) order with the palette in order, wrapping after 8. `downgrade` drops the column.
- Seeding (`init_db` finance lookups): seeded categories get colours by the same rule.
- Schemas: `CategoryBase` gains `color: Optional[str]`, validated against the allowed list (422 otherwise). `CategoryUpdate` gains `color: Optional[str]`.
- Create without `color`: assign the palette slot `count_of_existing_categories mod 8`. Update with `color: null`: keep the current colour (no reset).
- Acceptance:
  - [ ] Every category in `GET /api/finance/categories` has a non-null `color` from the allowed list after migration.
  - [ ] Create with and without `color`; update `color`; invalid value returns 422.
  - [ ] Migration up and down on a database copy; tests in `be/tests/test_finance_categories_payment_types.py`.

### BE-2 Customer receivables on the list

- `GET /api/finance/customers` adds to each customer:
  ```json
  "receivables": [
    { "currency": "USD", "open_amount": 10000.0, "open_count": 1, "overdue_count": 1, "max_days_overdue": 29 }
  ]
  ```
  Empty list when the customer has nothing open.
- Open = invoice status `sent` or `partially_paid` (D-022). `open_amount` = the same balance the invoice list and the 360 view show. `overdue_count` / `max_days_overdue` use the same overdue rule as the invoice `is_overdue` flag (due date before today, status sent or partially paid).
- Also add the same `receivables` list to `GET /api/finance/customers/{id}` (cheap) so the dialog and drawer can reuse it.
- Acceptance:
  - [ ] Values equal the customer 360 receivables summary for the same customer (test compares them).
  - [ ] Draft, paid and void invoices are not counted; a customer with USD and EGP invoices returns two entries.
  - [ ] One grouped query for the page (assert query count or document it). Tests in `be/tests/test_finance_customers_vendors.py`.

### BE-3 Vendor payables on the list

- `GET /api/finance/vendors` adds to each vendor:
  ```json
  "payables": [
    { "currency": "USD", "open_amount": 13740.0, "open_count": 3, "overdue_count": 1 }
  ]
  ```
- Open = bill statuses that are owed: `pending_approval`, `approved`, `scheduled`, `partially_paid` (not `draft`, `rejected`, `paid`, `void`; D-016). `open_amount` = remaining balance (amount minus payments) exactly as the bill payment rules compute it. Overdue = due date before today and status `approved`, `scheduled` or `partially_paid` (doc 19 slice 1 rule).
- If `get_vendor_metrics` uses a different definition of "open", stop and ask the owner before changing either.
- Acceptance:
  - [ ] Values match `get_vendor_metrics` (or the agreed definition) for the same vendor.
  - [ ] Miscellaneous vendor (protected, D-020) returns its payables like any other vendor.
  - [ ] Multi-currency vendors return one entry per currency; no N+1.

## 4. Git and delivery

- **Work in a separate checkout from the UI agent.** The UI agent works in the owner's folder on `feature/finance-ui-restyle-v2`; two agents switching branches in one folder would overwrite each other's files. Use your own clone or your own environment, branch `feature/finance-restyle-v2-backend` from an up-to-date `main`.
- One commit per slice (`feat(finance): BE-1 category colour (D-027)` and so on), push after each slice, one draft PR into `main` at the end. Do not merge.
- Tests: during work only the targeted file (`pytest be/tests/<file> -q --tb=short`); once at the end `pytest be/tests -q -k "finance or rbac"`. Report exact results and any pre-existing failures.

## 5. Final report

Outcome per slice, PR link, files changed (`git diff --stat`), migration revision used, exact test results, and the final JSON shape of each new field (one real example per slice) so the UI agent can confirm its mocks match.
