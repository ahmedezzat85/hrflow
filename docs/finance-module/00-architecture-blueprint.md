# HRFlow Architecture Blueprint

Status: Draft v1.1
Scope: Adds a Finance/Accounting module and a permission-based access control layer to the existing HRFlow application, as a modular monolith — no service split, no new deployment, same codebase and design language.

## 1. Guiding Principles

1. **One deployable application.** Single FastAPI backend, single Vite/vanilla-JS frontend, single database. Finance is a new internal domain, not a new service. Revisit only if concrete triggers appear later (multiple independent dev teams, PCI-scoped payment processing at volume, or productizing Finance separately from HR).
2. **Domain boundaries in code, not infrastructure.** HR and Finance are separated by folder/module structure and explicit service interfaces, not by network calls. Neither domain imports the other's ORM models directly — cross-domain reads go through a small service-layer interface.
3. **Permissions are the ground truth; roles are a label.** No endpoint ever checks a role name. Every protected route declares a permission string. Roles are just named, reusable bundles of permissions, resolved at request time.
4. **Architecture before detail.** Every component in this document gets a placeholder (empty router, empty table, empty section partial, stub permission string) before any business logic is written. Functional depth is added incrementally, module by module, without restructuring folders or renaming endpoints later.
5. **Terminology is fixed from day one.** See Section 5 — these names must not drift once code is written against them.

## 2. Data Layer — Explicit Statement

**HRFlow's persistence layer is relational SQL only: SQLite for local/dev use, PostgreSQL for staging/production.** Both are accessed through the single SQLAlchemy engine/session defined in `be/db.py`, with one Alembic migration history shared by both domains (HR and Finance). There is no Google Sheets (or any spreadsheet-backed) database variant in this architecture, and none is planned.

Two Google-related client files already exist in the codebase — `be/sheets_client.py` and `be/drive_client.py` — and must be understood correctly to avoid confusion with the database layer:

- **`drive_client.py`** — Google Drive integration for **file storage** (e.g. uploaded documents, generated payslip/document PDFs). This is a storage/export concern, not a database, and continues to be used for that purpose (see Implementation Plan Phase 5 — payslip PDF storage).
- **`sheets_client.py`** — appears to provide Google Sheets read/write, likely for export or a legacy integration. **Its actual current usage should be audited before Finance work begins** (see Phase 0 addition below): if nothing in `routers/` or `services/` depends on it as a source of truth for application data, it is either dead code to remove/archive, or a deliberate export/reporting utility that should be explicitly labeled as such — but it is never to be treated as, or extended into, a database backend for Finance or HR data.

If NoSQL components are introduced later for a specific non-relational need (e.g. a document store for audit logs, or a cache like Redis for session/permission-set caching), that is a distinct, additive infrastructure decision — not a replacement for the relational SQLite/PostgreSQL layer, and would be documented here explicitly when proposed.

## 3. System Overview

```
                        ┌─────────────────────────────────────┐
                        │              fe/ (Vite)              │
                        │  partials/shell   (topbar, sidebar)  │
                        │  partials/admin/sections/  ─ HR      │
                        │  partials/admin/sections/  ─ Finance │
                        │  partials/employee/        (self)    │
                        │  partials/modals/                    │
                        └───────────────┬───────────────────────┘
                                        │ REST (fetch via api.js)
                        ┌───────────────▼───────────────────────┐
                        │              be/ (FastAPI)             │
                        │  main.py  (router registration)        │
                        │  auth.py / deps.py  (JWT, permissions)  │
                        │                                        │
                        │  ┌───────────────┐  ┌────────────────┐│
                        │  │   hr/          │  │  finance/       ││
                        │  │  routers       │  │  routers        ││
                        │  │  repositories  │  │  repositories   ││
                        │  │  services      │  │  services       ││
                        │  │  models        │  │  models         ││
                        │  └──────┬────────┘  └────────┬────────┘│
                        │         └── shared: models_db.py ───────┘
                        │              db.py (single SQLAlchemy engine) │
                        └───────────────┬───────────────────────┘
                                        │
                                ┌───────▼────────┐
                                │  SQLite (dev) /  │
                                │  PostgreSQL (prod)│
                                │  schema: hr.*      │
                                │  schema: finance.* │
                                │  schema: core.*  (users, roles, perms) │
                                └────────────────────┘

        (Google Drive: file storage only — documents, generated PDFs.
         Not part of the database layer. See Section 2.)
```

## 4. Backend Structure

### 4.1 Current state (confirmed from repository)

```
be/
  main.py            # FastAPI app, router registration
  auth.py            # current auth logic (JWT-based)
  deps.py            # FastAPI dependencies (current_user, etc.)
  db.py              # SQLAlchemy engine/session (SQLite dev / PostgreSQL prod)
  models.py          # Pydantic schemas
  models_db.py       # SQLAlchemy ORM models
  config.py
  storage.py, drive_client.py   # file storage (Drive) — not database
  sheets_client.py               # audit usage before Finance work begins; not a database backend
  routers/
    auth.py, employees.py, salary.py, vacations.py,
    insurance.py, documents.py, requests.py,
    bank.py            # -> RENAME: employee external bank info, not company finance
    invoices.py         # -> RENAME: employee payment-received doc generation, not company finance
    export.py, system.py
  repositories/
  services/
  migrations/          # Alembic
  tests/
```

### 4.2 Target structure (additive, no breaking moves)

```
be/
  main.py                       # registers hr.* and finance.* routers, both under /api
  core/                         # NEW — cross-cutting, not domain-specific
    permissions.py              # permission string constants, require_permission() dependency
    rbac_models.py               # Role, Permission, RolePermission, UserRole ORM models
    rbac_repository.py           # role/permission lookups
  hr/                           # NEW namespace wrapping existing HR logic
    __init__.py
    routers/                    # existing routers/*.py move here over time (non-breaking, see Phase plan)
  finance/                      # NEW
    __init__.py
    models.py                   # SalesInvoice, Bill, Payment, PayrollRun, PayrollLine,
                                 # BankAccount (company), Subscription, Customer, Vendor
    schemas.py                  # Pydantic request/response schemas
    repositories/
      invoices_repository.py
      bills_repository.py
      payroll_repository.py
      accounts_repository.py
      subscriptions_repository.py
    services/
      invoices_service.py
      bills_service.py
      payroll_service.py        # payroll run generation, payslip data assembly
      reporting_service.py      # balances, revenue, cost breakdown (read-only, derived)
    routers/
      sales_invoices.py         # /api/finance/invoices
      bills.py                  # /api/finance/bills
      payroll.py                # /api/finance/payroll
      bank_accounts.py          # /api/finance/accounts
      subscriptions.py          # /api/finance/subscriptions
      reports.py                # /api/finance/reports
  routers/
    bank.py       -> employee_bank_accounts.py   (rename; HR-scoped)
    invoices.py   -> salary_payment_docs.py       (rename; HR-scoped)
```

**Renaming rule:** `bank.py` and `invoices.py` keep their current HR meaning (employee external-transfer bank info; employee payment-received document generation) but are renamed to remove ambiguity before Finance ships, since both domains will otherwise have colliding concepts under confusingly similar names.

### 4.3 Database

- All persistence is relational SQL: **SQLite for local development, PostgreSQL for staging/production**, both accessed via the same SQLAlchemy engine and the same Alembic migration history. No spreadsheet-backed or NoSQL database variant exists in this architecture.
- Single Alembic migration history (do not split migrations per domain — ordering matters when Finance tables reference HR tables, e.g. `PayrollLine.employee_id`).
- Use **schemas** to group tables logically without separate databases: `core.*` (users, roles, permissions), `hr.*` (employees, salary, vacations, insurance), `finance.*` (invoices, bills, payroll, accounts, subscriptions). This costs nothing now and provides a documented extraction seam if a future split is ever needed. Note: SQLite does not support multiple schemas natively — for dev/SQLite, use table name prefixes (e.g. `hr_employees`, `finance_bills`) to preserve the same logical grouping; PostgreSQL uses real schemas. Keep ORM model definitions schema-aware so this maps cleanly in both environments.
- Cross-schema/cross-prefix foreign keys are allowed (e.g. `finance.payroll_lines.employee_id -> hr.employees.id`) since this is still one database — the grouping is organizational, not a hard boundary.
- If a non-relational component is ever introduced (e.g. Redis for caching resolved permission sets, or a document store for audit trails), it is additive infrastructure alongside SQLite/PostgreSQL, never a replacement for the relational layer, and must be documented here explicitly when proposed.

## 5. Frontend Structure

### 5.1 Current state (confirmed from repository)

```
fe/
  api.js                       # fetch wrapper / API calls
  src/
    index.html
    styles.css, styles/
    partials/
      shell/                  # layout, likely nav shell shared across roles
      admin/
        sidebar.html
        topbar.html
        sections/             # one partial per HR feature area
      employee/                # self-service views
      modals/
```

### 5.2 Target structure (additive)

```
fe/
  finance-api.js                          # NEW — mirrors api.js conventions, calls /api/finance/*
  src/partials/admin/
    sidebar.html                          # add "Finance" nav group (permission-gated render)
    sections/
      finance-dashboard.html              # NEW — balances, revenue, cost breakdown widgets
      finance-invoices.html               # NEW — sales invoices list/detail
      finance-bills.html                  # NEW — vendor bills list/detail
      finance-payroll.html                # NEW — payroll runs, payslip access
      finance-accounts.html               # NEW — company bank accounts
      finance-subscriptions.html          # NEW — recurring services
  src/partials/employee/
    payslips.html                         # NEW — self-scoped payslip history/download
```

**Navigation rule:** the sidebar renders each nav group by checking the current user's resolved permission set client-side (mirroring the server-side check) — an HR Admin with no `finance.*` permission never sees the Finance group rendered, not just blocked on click.

## 6. Fixed Terminology (do not deviate)

| Term | Meaning | Do NOT use for |
|---|---|---|
| Sales Invoice | Issued by the company to a customer; creates accounts receivable | Never call this "Bill" |
| Bill (Vendor Bill) | Received from a supplier/vendor; creates accounts payable | Never call this "Invoice" |
| Payment | A cash movement linked to a Sales Invoice (incoming) or Bill (outgoing); supports partial payments | Not the same as "Invoice paid" flag |
| PayrollRun | One payroll cycle for a pay period (e.g. "2026-09"), with run-level status and totals | Not an individual employee's payslip |
| PayrollLine | One employee's snapshot within a PayrollRun — salary components, tax/deductions, net pay at that time | Not the employee's current live salary record |
| BankAccount (Finance) | Company-owned account used for receiving customer payments and paying vendors/payroll | Do not confuse with employee's personal external-transfer bank info |
| Subscription | A recurring vendor obligation that generates Bills automatically on renewal | Not a customer-facing product subscription |

## 7. Permission Model

See `01-implementation-plan.md` Section on RBAC for the concrete schema and seed data. Summary of the abstraction:

```
User ──< UserRole >── Role ──< RolePermission >── Permission
```

- **Permission** naming convention: `<module>.<resource>.<action>` — e.g. `finance.invoice.write`, `hr.salary.read`, `self.payslip.read`, `system.roles.manage`.
- **Role** is a saved set of Permission rows via RolePermission. Initial roles to seed: `system_admin`, `employee`. Deferred roles (schema exists, not seeded yet): `accountant`, `hr_admin`, `hr_staff`.
- Every new route, from the very first placeholder, declares its required permission via a FastAPI dependency, even while only two roles exist.

## 8. Non-Negotiable Boundaries (for the implementation agent)

- Do not let `finance/` modules import `hr/` ORM models directly for writes. Cross-domain reads (e.g. payroll needs employee salary data) go through a defined service function, not a raw join scattered across files.
- Do not hardcode role name checks (`if role == "admin"`) anywhere. Always check permission strings via the shared dependency.
- Do not reuse the existing `bank.py`/`invoices.py` HR routers or tables for Finance entities. These are being renamed, not repurposed.
- Do not create a second auth system, second JWT issuer, or second user table for Finance. One identity system for the whole app.
- Do not introduce Google Sheets, or any spreadsheet-backed store, as a database for any HR or Finance entity. The database layer is SQLite (dev) / PostgreSQL (prod) only. Google Drive remains valid for file storage (documents, generated PDFs) — that is a separate concern from persistence of structured data.
- Do not skip the placeholder phase. Every router, table, and section partial listed in Section 4-5 gets created empty/stubbed before any one feature is built end-to-end in detail.
