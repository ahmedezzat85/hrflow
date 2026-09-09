# HRFlow — Project Description

A living, product-level reference for what HRFlow is, how its modules are organized, and how features map to the codebase. Intended for maintenance, onboarding, and feature planning — not for implementation detail (see the Implementation Plan for that).

## What HRFlow Is

HRFlow is a self-hosted HR management system, built as a single web application (FastAPI backend + lightweight JS/HTML frontend), currently covering core HR operations for a single organization. It is being extended with a Finance/Accounting module and a permission-based access control system, both integrated into the same application rather than split into separate services.

## Data Layer

HRFlow's database is **relational SQL only**: SQLite for local development, PostgreSQL for staging/production, both accessed through one SQLAlchemy engine and one Alembic migration history shared across HR and Finance. There is no Google Sheets or other spreadsheet-backed database variant, and none is planned.

Two Google integrations exist in the codebase and should not be confused with the database layer:

- **Google Drive** (`be/drive_client.py`) — file storage for documents and generated PDFs (e.g. payslips). A storage concern, not a database.
- **Google Sheets** (`be/sheets_client.py`) — audited in Phase 0. Confirmed to be solely an export destination utility (used by `be/services/export.py` for exporting reporting data to Google Sheets tabs) and legacy backup scripts. `be/db.py` contains zero switches pointing to Google Sheets. It is never a source of truth for HR or Finance data.

## Product Modules

### HR Module (existing)

| Feature area | What it does | Backend location |
|---|---|---|
| Employees | Employee records, profiles | `be/routers/employees.py` |
| Salary | Salary structure, tax/deduction rules | `be/routers/salary.py` |
| Vacations | Leave requests and balances | `be/routers/vacations.py` |
| Insurance | Employee insurance records | `be/routers/insurance.py` |
| Documents | Document storage, Google Drive integration | `be/routers/documents.py`, `be/drive_client.py` |
| Requests | General employee request workflow | `be/routers/requests.py` |
| Employee bank accounts | Where employees receive external salary transfers | `be/routers/employee_bank_accounts.py` (renamed from `bank.py`) |
| Salary payment documents | Auto-generated documents for external money transfers | `be/routers/salary_payment_docs.py` (renamed from `invoices.py`) |
| Export | Data export utilities | `be/routers/export.py` |

### Finance Module (new)

| Feature area | What it does | Backend location |
|---|---|---|
| Sales Invoices | Invoices issued to customers for revenue (accounts receivable) | `be/finance/routers/sales_invoices.py` |
| Bills | Vendor/supplier bills for purchases and services (accounts payable) | `be/finance/routers/bills.py` |
| Payments | Cash movements linked to invoices (incoming) or bills (outgoing) | part of `finance/services/invoices_service.py` and `bills_service.py` |
| Payroll | Monthly payroll runs; doubles as expense tracking and salary/tax history source for payslips | `be/finance/routers/payroll.py` |
| Bank Accounts (company) | Company-owned accounts used for receiving payments and paying vendors/payroll | `be/finance/routers/bank_accounts.py` |
| Subscriptions | Recurring vendor obligations, can auto-generate Bills on renewal | `be/finance/routers/subscriptions.py` |
| Reports | Derived views: balances, revenue, cost breakdown | `be/finance/routers/reports.py` |

All Finance data lives in the same SQLite/PostgreSQL database as HR data (see Data Layer above), grouped under a `finance.*` schema/prefix.

### Core / Access Control (new)

| Feature area | What it does | Backend location |
|---|---|---|
| Permissions | Atomic capability strings (`module.resource.action`) | `be/core/permissions.py` |
| Roles | Named bundles of permissions, assigned to users | `be/core/rbac_models.py` |
| User-role assignment | Which users hold which roles | `be/core/rbac_models.py` (UserRole) |

## Roles (Product-Level Summary)

| Role | Access summary |
|---|---|
| System Admin | Full access to all HR and Finance data and actions; manages users and role assignments |
| Employee | Self-service only: own profile, own requests, own payslips |
| Accountant / Financial Admin | Full access to Finance module only; no HR data access |
| HR Admin | Full access to HR module only; no Finance data access |
| HR Department Employee | Limited HR access (read employees/vacations, submit requests); no salary write, no Finance access |

Roles are implementation conveniences over the underlying permission system — the system itself only evaluates permissions. New roles can be introduced at any time by combining existing permissions, without backend code changes. See the Architecture Blueprint for the permission schema.

## Terminology Reference (do not use interchangeably)

- **Sales Invoice** — money coming in, issued by HRFlow's owning company to a customer.
- **Bill** — money going out, received from a vendor/supplier.
- **Payment** — an actual cash movement, linked to either a Sales Invoice or a Bill.
- **PayrollRun** — one payroll cycle (e.g. a given month) covering all employees.
- **PayrollLine** — one employee's snapshot within a PayrollRun; the basis for salary history and payslips.
- **BankAccount (Finance)** — a company-owned account, distinct from an employee's personal external-transfer bank info stored in the HR module.

## Design & Navigation Conventions

- Single portal, single login, single design system for both HR and Finance.
- Admin-facing UI lives under `fe/src/partials/admin/`, organized into sidebar-navigable sections; Finance sections sit alongside HR sections in the same sidebar, gated by permission rather than hidden by a hardcoded role check.
- Employee self-service UI lives under `fe/src/partials/employee/`, scoped to the logged-in user's own records only (including future payslip access).

## Status Tracking

Use this table to track module maturity as implementation proceeds. Update after each phase in the Implementation Plan is completed.

| Module | Status | Last updated |
|---|---|---|
| HR core (existing) | Implemented | — |
| Phase 0 Housekeeping & Audit | Implemented | 2026-09-09 |
| RBAC skeleton (Phase 1) | Implemented | 2026-09-09 |
| Finance placeholders (Phase 2) | Implemented | 2026-09-09 |
| Finance data model (Phase 3) | Implemented | 2026-09-09 |
| Finance CRUD (Phase 4) | Not started | — |
| Payroll engine (Phase 5) | Not started | — |
| Reporting layer (Phase 6) | Not started | — |
| Role expansion (Phase 7) | Not started | — |

### Implementation Changelog & Audit Log

- **Phase 0 Housekeeping & Data-Layer Audit Completion (2026-09-08 / 2026-09-09)**:
  - Disambiguated legacy HR entities (`employee_bank_accounts` and `salary_payment_docs`), purged all ambiguous shims, and renamed sheet/dual repositories (`0dd4e8c`, `6088317`).
  - Fully closed out the `sheets_client.py` and data-layer audit (Phase 0 Step 3):
    - Removed hardcoded default database URL (`f568c89`).
    - Updated `.env.example` to enforce `STORAGE_ENGINE=sql` as default and purged obsolete references to Google Sheets and dual-write as primary persistence engines (`c88433a`). The system of record is strictly SQLite/PostgreSQL.
- **Phase 1 Core RBAC Skeleton (2026-09-09)**:
  - Added SQLAlchemy models in `be/core/rbac_models.py` (`PermissionDB`, `RoleDB`, `RolePermissionDB`, `UserRoleDB`) and `be/core/__init__.py`.
  - Alembic migration `0003_rbac_skeleton.py` creating tables, indexes, and constraints.
  - Idempotent seed helper `be/core/rbac_seed.py` seeding `system_admin` (22 permissions), `employee` (`self.*`), and automatic user backfill.
  - Permission resolution and `require_permission` route guard in `be/core/permissions.py`.
  - Proof-of-concept wiring on `POST /api/employees` gated with `require_permission("hr.employee.write")` (`cce60cd`).
  - Test suite `be/tests/test_rbac.py` passing (163 tests total).
- **Phase 2 Placeholder Architecture (2026-09-09)**:
  - Backend stubs: created `be/finance/routers/` for `sales_invoices`, `bills`, `payroll`, `bank_accounts`, `subscriptions`, and `reports` registered under `/api/finance/*`, all gated by `require_permission`.
  - Frontend stubs: created `fe/finance-api.js` client wrapper and `fe/public/js/finance.js` controller.
  - UI integration: added dynamic `#adminFinanceNavGroup` to Admin sidebar gated on `finance.*` permissions, added "My Payslips" to Employee sidebar gated on `self.payslip.read`.
  - Section partials: created 6 admin section partials (`finance-dashboard.html`, `finance-invoices.html`, `finance-bills.html`, `finance-payroll.html`, `finance-accounts.html`, `finance-subscriptions.html`) and 1 employee partial (`payslips.html`).
  - Build pipeline: updated `fe/vite.config.js` to bundle `finance.js` in script order and distribute `finance-api.js`. Single-file Vite build confirmed working (`fe/dist/index.html`).
  - Verified end-to-end via browser automation and backend placeholder test suite (167 passing tests).
- **Phase 3 Finance Data Model and Migrations (2026-09-09)**:
  - Defined 11 SQLAlchemy models in `be/finance/models.py` (`CustomerDB`, `VendorDB`, `SalesInvoiceDB`, `SalesInvoiceLineDB`, `BillDB`, `BillLineDB`, `PaymentDB`, `FinanceBankAccountDB`, `SubscriptionDB`, `PayrollRunDB`, `PayrollLineDB`) mapping cleanly to SQLite and PostgreSQL with `finance_` table prefix.
  - Created and applied Alembic migration `0004_finance_data_model.py` with performance indexes on statuses, dates, foreign keys, and unique constraint on `invoice_number`.
  - Maintained cross-domain reference between `finance_payroll_lines.employee_id` and HR's `employees.id`.
  - Re-exported all models in `be/models_db.py` on `Base.metadata`.
  - Created unit and integration test suite `be/tests/test_finance_models.py` verifying model instantiation, cascade rules, unique constraints, and foreign key traversals (171 passing tests total).

## Related Documents

- `00-architecture-blueprint.md` — system architecture, folder structure, permission schema, data layer statement.
- `01-implementation-plan.md` — phased, agent-executable build plan with acceptance checks.
