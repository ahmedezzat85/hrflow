# HRFlow Implementation Plan (Agent-Executable)

Purpose: a step-by-step, unambiguous plan for an implementation agent (human or AI coding agent) to execute without needing to infer missing decisions. Each phase produces a working, demoable state. Do not skip phases or reorder them — later phases assume earlier placeholders exist.

Read `00-architecture-blueprint.md` first. This document assumes that architecture as fixed, including the data-layer statement: **persistence is SQLite (dev) / PostgreSQL (prod) only, via SQLAlchemy — no Google Sheets or other spreadsheet-backed database variant exists or is to be introduced.**

---

## Phase 0 — Housekeeping (rename and audit before adding)

**Goal:** remove naming collisions and confirm the data-layer boundary before Finance code exists.

1. Rename `be/routers/bank.py` -> `be/routers/employee_bank_accounts.py`. Update the class/function names inside (e.g. `BankAccount` model used here, if any, should be renamed to `EmployeeBankAccount` or similar so it never collides with the new Finance `BankAccount`). Update `main.py` router registration and any frontend `api.js` calls referencing this endpoint's path if the path itself changes.
2. Rename `be/routers/invoices.py` -> `be/routers/salary_payment_docs.py`. Rename any `Invoice` model/table used here to something like `SalaryPaymentDocument` so it never collides with the new Finance `SalesInvoice`.
3. **Audit `be/sheets_client.py` usage.** Search the codebase for all imports of this module. If it is not called from any active router/service path, mark it clearly as legacy/export-only in a code comment and exclude it from the Finance/HR data path entirely — it must never become a source of truth for any table covered by this plan. If it is actively used for something (e.g. a one-off export routine), document that specific purpose in `02-project-description.md` so it isn't mistaken for a database layer later. Confirm `be/db.py` has no `DATABASE_TYPE`/backend switch pointing at Sheets; if one exists, remove it.
4. Confirm existing tests in `be/tests/` still pass after the rename (update imports/paths as needed).
5. **Acceptance check:** no file, class, or table in the codebase named ambiguously `Invoice`, `Bill`, or `BankAccount` without a domain qualifier; `sheets_client.py`'s role (legacy/export-only, never a database backend) is documented and confirmed.

---

## Phase 1 — Core RBAC Skeleton (permissions before roles)

**Goal:** the permission-checking mechanism exists and is wired into at least one real route, before any Finance code is written.

1. Create `be/core/rbac_models.py` with four SQLAlchemy models (SQLite/PostgreSQL compatible — avoid PostgreSQL-only column types unless a fallback is defined for SQLite):
   - `Permission(id, key: str unique, description: str)` — `key` follows `<module>.<resource>.<action>`.
   - `Role(id, name: str unique, description: str)`.
   - `RolePermission(role_id FK, permission_id FK)` — composite unique.
   - `UserRole(user_id FK, role_id FK)` — composite unique. (If the current `User` model already has a single role column, keep it temporarily for backward compatibility during migration, but stop reading it once `UserRole` is populated.)
2. Create Alembic migration for these four tables plus seed data:
   - Seed roles: `system_admin`, `employee`.
   - Seed a starter permission list (expand over time, never delete once used):
     - `system.users.manage`, `system.roles.manage`
     - `hr.employee.read`, `hr.employee.write`
     - `hr.salary.read`, `hr.salary.write`
     - `hr.vacation.read`, `hr.vacation.write`
     - `self.profile.read`, `self.payslip.read`, `self.requests.write`
   - Assign `system_admin` all permissions. Assign `employee` the three `self.*` permissions.
3. Create `be/core/permissions.py`:
   - Function `get_user_permissions(user_id) -> set[str]` — resolves via `UserRole -> Role -> RolePermission -> Permission`, cached per-request.
   - FastAPI dependency factory `require_permission(permission_key: str)` — raises `403` if the resolved current user's permission set does not contain `permission_key`.
4. Apply `require_permission("hr.employee.read")` (or the closest existing equivalent) to one existing HR endpoint (e.g. `GET /api/employees`) as a proof of wiring. Do not touch other existing routes yet.
5. **Acceptance check:** logging in as the seeded `system_admin` role can call the protected endpoint; a user with only the `employee` role gets `403`. This is testable end-to-end before any Finance code exists, against SQLite locally.

---

## Phase 2 — Placeholder Architecture (structure before logic)

**Goal:** every component named in the Blueprint exists as an empty/stub, wired end-to-end, before any real business logic is written. This phase is intentionally shallow — it exists to validate plumbing (routing, navigation, permission gating) cheaply.

### 2.1 Backend stubs

For each of these, create the file with a router that returns a hardcoded static JSON list/object, and register it in `main.py` under `/api/finance/*`. Each route gets a placeholder `require_permission("finance.<resource>.read")` call (permission key doesn't need to exist in the seed table yet for this phase — add it now to the seed migration so it's ready for Phase 3).

- `be/finance/routers/sales_invoices.py` -> `GET /api/finance/invoices` returns `[]` or 2 fake rows.
- `be/finance/routers/bills.py` -> `GET /api/finance/bills`.
- `be/finance/routers/payroll.py` -> `GET /api/finance/payroll/runs`.
- `be/finance/routers/bank_accounts.py` -> `GET /api/finance/accounts`.
- `be/finance/routers/subscriptions.py` -> `GET /api/finance/subscriptions`.
- `be/finance/routers/reports.py` -> `GET /api/finance/reports/summary` returns fake `{balance, revenue_mtd, cost_mtd}`.

Add matching `finance.*.read` and `finance.*.write` permission keys to the seed migration now (do not assign them to any role yet — they exist but are unused until Phase 3+, keeping the seed list authoritative and growing incrementally).

### 2.2 Frontend stubs

1. Create `fe/finance-api.js` mirroring the conventions of the existing `fe/api.js`, with one function per stub endpoint above (e.g. `getInvoices()`, `getBills()`, `getPayrollRuns()`, `getAccounts()`, `getSubscriptions()`, `getFinanceSummary()`).
2. Add a "Finance" nav group to `fe/src/partials/admin/sidebar.html` with entries: Dashboard, Invoices, Bills, Payroll, Bank Accounts, Subscriptions. Gate the entire group's rendering on the presence of any `finance.*` permission in the current user's resolved set (fetched once at login/session start).
3. Create the six section partials under `fe/src/partials/admin/sections/`:
   - `finance-dashboard.html`, `finance-invoices.html`, `finance-bills.html`, `finance-payroll.html`, `finance-accounts.html`, `finance-subscriptions.html`.
   - Each renders a static heading, a placeholder table with the eventual column headers (see Phase 3 field lists below for what headers to use — even though no real data flows yet), and an "empty state" message. Wire each to call the matching `finance-api.js` function and render whatever the stub endpoint returns (even if just 2 fake rows) — this validates the fetch-and-render path.
4. Add a `payslips.html` partial under `fe/src/partials/employee/` with a placeholder empty state ("No payslips yet") wired to a stub `getMyPayslips()` call, gated on `self.payslip.read`.

**Acceptance check for Phase 2:** clicking every new sidebar entry switches the visible section correctly, each section successfully fetches from its stub endpoint (visible in browser network tab), and the Finance nav group is invisible when logged in as a user without any `finance.*` permission. No real data model exists yet — this is intentional.

---

## Phase 3 — Data Model and Migrations

**Goal:** real tables backing every Finance stub, without changing any route paths or frontend contracts established in Phase 2. All tables below are created via SQLAlchemy models and Alembic migrations, targeting both SQLite (dev) and PostgreSQL (prod) — avoid PostgreSQL-specific types (e.g. native arrays, JSONB-only features) unless a documented SQLite-compatible fallback is included.

Create `be/finance/models.py` with the following tables (fields listed are the minimum required set; extend later without renaming):

- **Customer**: id, name, contact_email, contact_phone, tax_id (nullable), notes, created_at.
- **Vendor**: id, name, contact_email, contact_phone, tax_id (nullable), category, notes, created_at.
- **SalesInvoice**: id, customer_id FK, invoice_number (unique), issue_date, due_date, status (draft/sent/paid/overdue/void), currency, subtotal, tax_amount, total, notes, created_at.
- **SalesInvoiceLine**: id, invoice_id FK, description, quantity, unit_price, line_total.
- **Bill**: id, vendor_id FK, bill_number, category, issue_date, due_date, status (unpaid/paid/overdue/void), currency, subtotal, tax_amount, total, notes, created_at.
- **BillLine**: id, bill_id FK, description, quantity, unit_price, line_total.
- **Payment**: id, direction (incoming/outgoing), related_invoice_id FK nullable, related_bill_id FK nullable, amount, currency, payment_date, bank_account_id FK, method (bank_transfer/cash/card/other), reference, created_at.
- **BankAccount** (finance-scoped, company-level): id, account_name, bank_name, account_number (masked in API responses), currency, opening_balance, current_balance (computed or cached), is_active, created_at.
- **Subscription**: id, vendor_id FK, name, amount, currency, billing_cycle (monthly/quarterly/yearly), next_renewal_date, auto_generate_bill (bool), is_active, created_at.
- **PayrollRun**: id, period_label (e.g. "2026-09"), period_start, period_end, status (draft/approved/paid), total_gross, total_tax, total_deductions, total_net, total_employer_cost, bank_account_id FK, created_at, approved_at, paid_at.
- **PayrollLine**: id, payroll_run_id FK, employee_id FK (references `hr.employees`), base_salary, allowances_total, deductions_total, tax_amount, net_pay, employer_cost_extra (e.g. insurance employer share), snapshot_notes, created_at.

Migration notes:
- `PayrollLine.employee_id` is a cross-domain FK (`finance` table referencing an `hr` table) — allowed per the Blueprint's schema/prefix-grouping rule, and works identically on SQLite (table-prefix convention) and PostgreSQL (real schemas).
- Never update a `PayrollLine` after a run is approved/paid — corrections go through a new adjustment run, preserving historical accuracy for payslip reprints.
- Add DB indexes on `SalesInvoice.status`, `Bill.status`, `PayrollRun.period_label`, `Payment.payment_date` — these will be queried constantly by the reporting service.

**Acceptance check:** Alembic migration applies cleanly on top of Phase 0-2 migrations on both SQLite (dev) and PostgreSQL (staging/prod, if available); all Phase 2 stub endpoints still return 200 (still hardcoded — do not wire real queries yet in this phase, to keep the change surface reviewable).

---

## Phase 4 — Core CRUD

**Goal:** replace each stub endpoint's hardcoded response with real repository/service-backed logic, one resource at a time. Do not parallelize across resources — finish one fully (repository + service + router + frontend section wired to real create/edit/list) before starting the next, to keep the pattern consistent.

Recommended order (dependencies matter):
1. **BankAccount** (finance) — needed by everything else that posts a transaction.
2. **Customer** and **Vendor** — needed before invoices/bills can reference them.
3. **SalesInvoice** + **SalesInvoiceLine** + incoming **Payment**.
4. **Bill** + **BillLine** + outgoing **Payment**.
5. **Subscription** — including the scheduled job/check that auto-generates a `Bill` on `next_renewal_date` if `auto_generate_bill` is true.

For each resource: implement list (with pagination and status filter), get-by-id, create, update, and soft-delete/void (never hard-delete financial records — use a status field). Attach the corresponding `finance.<resource>.read` / `.write` permission checks established in Phase 1-2.

---

## Phase 5 — Payroll Engine

**Goal:** payroll run generation, tied to both HR salary data and Finance expense tracking, per the agreed requirement that payroll serves as both an expense record and a salary/tax history source.

1. `payroll_service.create_run(period_label, period_start, period_end)`:
   - Pulls all active employees and their current salary structure from the existing HR `Salary`/`Employee` tables (read-only cross-domain call — do not duplicate HR data into Finance tables except as the deliberate `PayrollLine` snapshot).
   - Creates one `PayrollLine` per employee with computed gross, deductions, tax, and net pay based on the existing salary/tax logic already implemented in `be/routers/salary.py`. Reuse that logic rather than reimplementing tax rules in Finance.
   - Sets `PayrollRun.status = 'draft'` and totals computed from the lines.
2. `payroll_service.approve_run(run_id)`: locks the run (no further line edits), sets `status = 'approved'`.
3. `payroll_service.mark_paid(run_id, bank_account_id, paid_at)`: sets `status = 'paid'`, decrements the selected `BankAccount.current_balance` (confirm net-pay-only vs. total-employer-cost convention — see Open Decisions), and creates a corresponding expense-side `Payment` record (direction=outgoing) so payroll flows into the same cost reporting as vendor bills.
4. `payroll_service.get_employee_history(employee_id)`: returns all `PayrollLine` rows for that employee across all runs, ordered by period — this backs both "salary history" and "generate payslip at any time."
5. Payslip rendering: reuse the existing document-generation pattern already used in `be/routers/documents.py` to render a `PayrollLine` into a PDF payslip on demand. The generated PDF file itself may be stored via the existing Google Drive integration (`drive_client.py`) as a **file storage** destination only — the payslip's underlying structured data (amounts, dates, employee link) always lives in the `PayrollLine` row in SQLite/PostgreSQL, never in Drive or Sheets. Retrievable by employee self-service (`self.payslip.read` permission) or by Accountant/Admin for any employee.

**Acceptance check:** running payroll for a test period produces correct per-employee `PayrollLine` rows, an aggregate `PayrollRun` total, a downloadable payslip PDF, and — once marked paid — a visible entry in the Finance cost/expense reporting for that period.

---

## Phase 6 — Reporting Layer

**Goal:** derived, read-only views — no new stored state, only queries against Phases 3-5 data in SQLite/PostgreSQL.

- **Balances**: sum of `BankAccount.current_balance` across active accounts, plus a per-account breakdown.
- **Revenue**: sum of `SalesInvoice.total` where `status = 'paid'`, filterable by date range, with a trend (monthly) breakdown.
- **Cost breakdown**: sum of `Bill.total` (by vendor category) plus `PayrollRun.total_employer_cost` (by period), combined into one cost view so payroll and vendor spend are comparable.
- **Subscriptions overview**: upcoming renewals in the next 30 days, total recurring monthly commitment.

Build this as a single `reporting_service.py` with clearly named functions per metric — do not let routers compute aggregates directly; keep aggregation logic testable and centralized.

---

## Phase 7 — Role Expansion (deferred, schema-ready)

**Goal:** activate `accountant`, `hr_admin`, `hr_staff` roles once Phases 1-6 are stable. This phase should require zero endpoint code changes — only new rows.

1. Insert new `Role` rows: `accountant`, `hr_admin`, `hr_staff`.
2. Insert `RolePermission` rows:
   - `accountant`: all `finance.*` permissions. No `hr.*` permissions.
   - `hr_admin`: all `hr.*` permissions. No `finance.*` permissions.
   - `hr_staff`: subset of `hr.*` — read on employees/vacations, write on requests, no write on salary, no delete on employees. Define the exact subset against the current `hr.*` permission list at the time this phase starts.
3. Reassign existing users from the two-role system into the five-role system via a data migration script, not manual UI clicks, to avoid inconsistency.
4. **Acceptance check:** an HR Admin account cannot access any `/api/finance/*` route (403) and does not see the Finance sidebar group. An Accountant account cannot access any `/api/hr/*` write route.

---

## Open Decisions to Confirm Before Phase 5

- Does `mark_paid` decrement the bank balance by `total_net` (cash actually leaving for employee wages) or `total_employer_cost` (including employer-side tax/insurance contributions)? This affects balance accuracy — confirm your accounting convention before building Phase 5 step 3.
- Multi-currency: is HRFlow single-currency only for now, or should `currency` fields be treated as live/required from day one? (Schema above already includes the field either way, but reporting logic differs.)
- Confirmed in this revision: no Google Sheets or other spreadsheet-backed database variant is in scope anywhere in this plan. Persistence is SQLite (dev) / PostgreSQL (prod) exclusively. Any future non-relational component (e.g. Redis cache) would be additive and documented separately, not a replacement.
