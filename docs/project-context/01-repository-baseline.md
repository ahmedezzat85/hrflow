# HRFlow Repository Baseline Audit

**Date of Audit:** September 22, 2026  
**Auditor:** Antigravity (Advanced Agentic Coding Agent)  
**Repository Branch:** `feature/payroll-deductions` (Commit: `1695cfc`, synced with `main`)  
**Status:** Clean working tree, read-only baseline snapshot  

---

## 1. Executive Summary

HRFlow is an internal operations platform combining Human Resources Management and Financial Accounting for Voyance Health. The codebase is organized as a modular monolith:

- **Single Backend:** Python 3.10+ running FastAPI (`be/main.py`), utilizing SQLAlchemy for ORM persistence and Alembic for schema migrations.
- **Single Frontend:** Vanilla HTML/CSS/JavaScript with zero frontend frameworks (No React/Vue), managed via Vite (`fe/vite.config.js`) and compiled via `vite-plugin-singlefile` into a single self-contained deployment artifact (`fe/dist/index.html`).
- **Data Persistence Reality:** Persistence is exclusively relational SQL (`sqlite` for local/testing, `postgresql` for staging/production). Google Sheets is strictly an export destination; startup fails fast with a `RuntimeError` if `STORAGE_ENGINE != "sql"` (`be/config.py:180`).
- **Storage Subsystem:** File storage supports Google Drive via service account (`be/drive_client.py`) and a local filesystem driver (`be/storage.py`) for air-gapped or local development.
- **Authentication & Security:** Google Sign-In OAuth 2.0 credential verification with optional Workspace domain restriction (`ALLOWED_WORKSPACE_DOMAIN`). Session tokens are HMAC-SHA256 JWTs stored exclusively in an `HttpOnly`, `SameSite=Lax` cookie (`hrflow_session`).
- **Access Control:** An internal Role-Based Access Control (RBAC) engine (`be/core/permissions.py`) gates routes using structured permission strings (`<module>.<resource>.<action>`), supplemented by wildcard administrative overrides.
- **Current State of Implementation:**
  - All core HR modules (Employees, Salary & Splits, Bank Accounts, Vacations, Claims, Invoices/Payment Docs, Requests) are fully implemented and backed by SQL.
  - The Finance module has progressed far beyond its initial blueprint, featuring 20 Alembic migrations, double-entry ledger transactions, cheques lifecycle, AP bill workflows with PDF OCR extraction, sales invoices, bank statement parsing, automated reconciliation rules, statutory obligations, and an in-page 4-step payroll runner (Draft $\rightarrow$ Approved $\rightarrow$ Processing $\rightarrow$ Paid).
  - 66 backend test suites (`be/tests/`) and 55 Playwright UI specs (`fe/tests/ui/`) validate business rules and end-to-end workflows.

---

## 2. Repository Map

```
hrflow/
├── .env.example                               # Root environment configuration template
├── AGENTS.md                                  # Repository operating guidelines and conventions
├── docker-compose.db.yml                      # PostgreSQL 16 container definition for local/staging DB
├── hrflow_test.db                             # Local SQLite test database
├── migration_report.csv                       # Historical Sheets-to-SQL migration audit report
├── be/                                        # FastAPI Backend
│   ├── main.py                                # App factory, middleware, router registration
│   ├── config.py                              # Configuration loader and fail-fast validator
│   ├── auth.py                                # Google OAuth verification, JWT issuance, session cookies
│   ├── db.py                                  # SQLAlchemy engine, session maker, SQLite auto-column sync
│   ├── deps.py                                # Dependency injection for auth & common services
│   ├── logging_config.py                      # Rotating file and console logger setup
│   ├── models.py                              # Core domain Pydantic schemas (legacy & HR)
│   ├── models_db.py                           # Core domain SQLAlchemy ORM models
│   ├── storage.py                             # Abstract StorageClient (DriveStorageClient & LocalStorageClient)
│   ├── drive_client.py                        # Google Drive service account integration
│   ├── sheets_client.py                       # Google Sheets client (legacy / export destination only)
│   ├── core/                                  # Core Security & RBAC
│   │   ├── permissions.py                     # RBAC permission resolver and require_permission route guard
│   │   ├── rbac_models.py                     # PermissionDB, RoleDB, RolePermissionDB, UserRoleDB
│   │   └── rbac_seed.py                       # Idempotent permissions and starter role seeding
│   ├── routers/                               # HR Domain Endpoints
│   │   ├── auth.py                            # /api/auth (session, login, logout, me)
│   │   ├── employees.py                       # /api/employees (CRUD, search, compensation)
│   │   ├── employee_bank_accounts.py          # /api/employee-bank-accounts
│   │   ├── documents.py                       # /api/documents (employee docs & company Document Hub)
│   │   ├── insurance.py                       # /api/insurance (claims, policy, consumption)
│   │   ├── requests.py                        # /api/requests (general employee requests)
│   │   ├── salary.py                          # /api/salary (salary history, raises)
│   │   ├── salary_payment_docs.py             # /api/salary-payment-docs (monthly invoice generation)
│   │   ├── vacations.py                       # /api/vacations (leave requests and balances)
│   │   ├── export.py                          # /api/export (data export to XLSX, CSV, Sheets)
│   │   └── system.py                          # /api/system/health
│   ├── finance/                               # Finance Domain
│   │   ├── models.py                          # Finance SQLAlchemy ORM models (831 lines)
│   │   ├── schemas.py                         # Finance Pydantic DTOs & request/response contracts (92KB)
│   │   ├── seed_data.py                       # Lookup seeders (categories, payment types)
│   │   ├── deps.py                            # Finance-scoped dependency providers
│   │   ├── routers/                           # 20 Finance Routers (bills, payroll, accounts, etc.)
│   │   ├── services/                          # 25 Finance Services (ledger, forecast, reconciliation, etc.)
│   │   └── repositories/                      # 16 Finance Repositories
│   ├── repositories/                          # HR Data Repositories
│   │   ├── interfaces.py                      # Abstract repository interfaces
│   │   ├── deps.py                            # Dependency injection hard-wired to SQL repositories
│   │   ├── sql/                               # 11 active SQL repository implementations
│   │   ├── sheets/                            # 11 legacy Google Sheets repository implementations
│   │   └── dual/                              # 11 dual-write transition repositories
│   ├── migrations/                            # Alembic Database Migrations
│   │   ├── env.py                             # Alembic environment runner
│   │   └── versions/                          # 20 migrations (0001_initial_schema to 0020_fux_420_...)
│   ├── services/                              # HR & Utility Services (export, pdf_converter, uploads)
│   ├── scripts/                               # Migration & backfill utility scripts
│   └── tests/                                 # 66 pytest test files
├── fe/                                        # Frontend Application
│   ├── package.json                           # Dependencies (@playwright/test, vite, vite-plugin-singlefile)
│   ├── vite.config.js                         # Custom build pipeline with partial inliner & script injector
│   ├── playwright.config.js                   # Playwright configuration (webServer on port 5173)
│   ├── api.js                                 # Classic HR frontend API client
│   ├── finance-api.js                         # Bundled Finance API client with FinanceMockState
│   ├── api/finance/                           # 11 modular Finance API source clients
│   ├── scripts/assemble-finance-api.js        # Build script assembling api/finance/*.js -> finance-api.js
│   ├── dist/                                  # Production single-file bundle (index.html, 1.57 MB)
│   ├── public/js/                             # 28 client JavaScript modules
│   ├── src/                                   # Source Templates & Styles
│   │   ├── index.html                         # Base HTML template with <!-- @include --> directives
│   │   ├── styles.css                         # Core CSS entrypoint
│   │   ├── styles/modules/                    # Modular domain styles (payroll.css, etc.)
│   │   └── partials/                          # HTML partials (admin, employee, modals, shell)
│   └── tests/ui/                              # 55 Playwright UI specification suites
├── docs/                                      # Project Documentation
│   ├── finance-module/                        # Architecture blueprints, FUX stories 406..415, plans
│   ├── roadmap/                               # Feature gaps, security, database redesign roadmaps
│   └── project-context/                       # Context baselines and architecture records
└── scripts/migrations/                        # External migration runners (e.g. migrate_cashbook_2026.py)
```

---

## 3. Implemented Capabilities with Evidence

| Domain | Capability | Status | Evidence (Files / Modules) |
| :--- | :--- | :--- | :--- |
| **Auth** | Sign in with Google | Implemented | `be/auth.py:27`, `fe/public/js/session.js`, `fe/src/partials/shell/login-screen.html` |
| **Auth** | HttpOnly Cookie Session | Implemented | `be/auth.py:89`, `be/config.py:41` (`SESSION_COOKIE_NAME`) |
| **Auth** | Workspace Domain Guard | Implemented | `be/auth.py:40-47` (`ALLOWED_WORKSPACE_DOMAIN`) |
| **Security** | RBAC Engine & Route Guards | Implemented | `be/core/permissions.py`, `be/core/rbac_models.py`, `be/core/rbac_seed.py` |
| **Security** | Security Headers & CSP | Implemented | `be/main.py:101-122` (`security_headers` middleware) |
| **HR** | Employee Directory & CRUD | Implemented | `be/routers/employees.py`, `be/repositories/sql/employees.py`, `fe/public/js/employees.js` |
| **HR** | Split Compensation Tracking | Implemented | `be/routers/salary.py`, `be/models_db.py:77-78` (`internal_salary_usd`, `external_salary_usd`) |
| **HR** | Raise History & Calculations | Implemented | `be/routers/salary.py`, `be/models_db.py:108` (`SalaryHistoryDB`), `fe/public/js/salary.js` |
| **HR** | Employee Bank Accounts | Implemented | `be/routers/employee_bank_accounts.py`, `be/models_db.py:128` (`EmployeeBankAccountDB`) |
| **HR** | Leave & Vacation Tracking | Implemented | `be/routers/vacations.py`, `be/models_db.py:230` (`VacationHistoryDB`), `fe/public/js/vacations.js` |
| **HR** | Medical Insurance & Claims | Implemented | `be/routers/insurance.py`, `be/models_db.py:186-209`, `fe/public/js/insurance.js` |
| **HR** | Document Hub & Employee Docs | Implemented | `be/routers/documents.py`, `be/storage.py`, `be/models_db.py:156-184`, `fe/public/js/dochub.js` |
| **HR** | Monthly Invoice Generation | Implemented | `be/routers/salary_payment_docs.py`, `be/services/salary_payment_docs.py`, `fe/public/js/invoices.js` |
| **HR** | General Employee Requests | Implemented | `be/routers/requests.py`, `be/models_db.py:212` (`RequestDB`), `fe/public/js/requests.js` |
| **HR** | Audit Logging | Implemented | `be/repositories/sql/audit.py`, `be/models_db.py:277` (`AuditLogDB`) |
| **HR** | Controlled Data Exports | Implemented | `be/routers/export.py`, `be/services/export.py`, `fe/public/js/export.js` |
| **Finance** | Company Bank Accounts | Implemented | `be/finance/routers/bank_accounts.py`, `be/finance/services/accounts_service.py` |
| **Finance** | Double-Entry Ledger Engine | Implemented | `be/finance/routers/transactions.py`, `be/finance/services/ledger_service.py` |
| **Finance** | Inter-Account Transfers & FX | Implemented | `be/finance/routers/transfers.py`, `be/finance/services/transfers_service.py` |
| **Finance** | Cheques & Teller Withdrawals | Implemented | `be/finance/routers/cheques.py`, `be/finance/services/cheques_service.py` |
| **Finance** | AP Bills Inbox & Approvals | Implemented | `be/finance/routers/bills.py`, `be/finance/services/bills_service.py`, `fe/public/js/finance-bills.js` |
| **Finance** | Bill PDF Text/OCR Extraction | Implemented | `be/finance/services/bill_extractor.py`, `be/finance/routers/bills.py` (FUX-413) |
| **Finance** | Combined Bill Payments Guard | Implemented | `be/finance/services/bills_service.py` (FUX-408), `fe/tests/ui/finance-bill-combined-pay.spec.js` |
| **Finance** | Customers & Sales Invoices | Implemented | `be/finance/routers/sales_invoices.py`, `be/finance/services/invoices_service.py` |
| **Finance** | Bank Statements & Reconciliation | Implemented | `be/finance/routers/statements.py`, `rules.py`, `be/finance/services/statements_service.py` |
| **Finance** | Subscriptions & Charges | Implemented | `be/finance/routers/subscriptions.py`, `be/finance/services/subscriptions_service.py` |
| **Finance** | Statutory Obligations | Implemented | `be/finance/routers/statutory.py`, `be/finance/services/statutory_service.py` (FUX-410) |
| **Finance** | Employee Compensation Plans | Implemented | `be/finance/routers/compensation_plans.py`, `be/finance/services/compensation_plan_service.py` (FUX-416) |
| **Finance** | In-Page 4-Step Payroll Runner | Implemented | `be/finance/routers/payroll.py`, `be/finance/services/payroll_service.py`, `fe/public/js/finance-payroll.js` |
| **Finance** | Dual Payroll Funding Setup | Implemented | `be/finance/models.py:540` (`funding_account_id_ext`, `funding_account_id_int`), `fe/public/js/finance-payroll.js` |
| **Finance** | Financial Statements & Reports | Implemented | `be/finance/routers/reports.py`, `be/finance/services/reports_service.py` (P&L, Balance Sheet, Cashflow) |
| **Finance** | 30/60/90-Day Cash Forecast | Implemented | `be/finance/services/forecast_service.py`, `fe/public/js/finance-reports.js` |
| **Finance** | Attention Review Queue | Implemented | `be/finance/routers/observability.py`, `be/finance/services/attention_service.py` |
| **Finance** | Audited Excel Export Engine | Implemented | `be/finance/services/excel_exporter.py`, `be/finance/models.py:797` (`FinanceExportAuditDB`) |

---

## 4. Partially Implemented or Placeholder Capabilities

1. **Granular Role Expansion (Phase 7 of `01-implementation-plan.md`):**
   - *Status:* **Partially implemented / Schema-ready**.
   - *Evidence:* In `be/core/rbac_seed.py`, `SEED_ROLES` defines only `system_admin` and `employee`. In `be/models_db.py`, `UserDB.role` stores a single role string. The planned specialist roles (`accountant`, `hr_admin`, `hr_staff`) are defined conceptually with fine-grained permissions, but have not been seeded or wired into a user management UI.
2. **Automated Subscription Bill Generation (Background Cron):**
   - *Status:* **Partially implemented**.
   - *Evidence:* `SubscriptionDB.auto_generate_bill` exists in `be/finance/models.py:382`. However, there is no background daemon, scheduler, or queue (no Celery, RQ, or APScheduler) in the backend. Bill generation from subscriptions is executed on-demand via `subscriptions_service.log_charge(create_bill=True)` rather than automated cron triggers.
3. **Office/PDF Conversion Pipeline Fallbacks:**
   - *Status:* **Partially implemented / Environment-dependent**.
   - *Evidence:* `be/services/pdf_converter.py` attempts Windows COM automation (`win32com.client`) or local LibreOffice CLI (`soffice`), falling back to Google Drive API. On headless Linux containers without LibreOffice or Drive service credentials, PDF payslip/invoice compilation raises an error or outputs DOCX only.
4. **Dormant Google Sheets Repositories:**
   - *Status:* **Dormant / Deprecated**.
   - *Evidence:* `be/repositories/sheets/` (11 files) and `be/repositories/dual/` (11 files) remain in the tree from the transition period. `be/repositories/deps.py` exclusively instantiates `Sql*Repository`, rendering these files inactive.
5. **Frontend Mock Mode Parity:**
   - *Status:* **Partially implemented (Testing Utility)**.
   - *Evidence:* `fe/finance-api.js` provides `FinanceMockState` to support `?mock=admin` and `?mock=employee` testing without a running backend. While it mocks user interactions and state transitions for Playwright, mutations do not persist to SQL.
6. **Employee Portal Payslips Self-Service:**
   - *Status:* **Partially implemented**.
   - *Evidence:* Backend endpoint `GET /api/finance/payroll/lines/{id}/payslip` exists in `be/finance/routers/payroll.py`. The employee view `fe/src/partials/employee/sections/payslips.html` contains placeholder markup, but full self-service download and historical browsing are not yet hooked up end-to-end.

---

## 5. Finance Module Status against `docs/finance-module/01-implementation-plan.md`

| Phase | Plan Objective | Status | Implementation Details & Divergence |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Housekeeping & Naming Disambiguation | **Implemented** | Renamed `bank.py` $\rightarrow$ `employee_bank_accounts.py`, `invoices.py` $\rightarrow$ `salary_payment_docs.py`. Relegated `sheets_client.py` to export destination. Verified in `be/routers/`. |
| **Phase 1** | Core RBAC Skeleton | **Implemented** | `be/core/rbac_models.py`, `be/core/permissions.py`, `be/core/rbac_seed.py` created and active. |
| **Phase 2** | Placeholder Architecture & Stubs | **Implemented** | Initial static stub routers and frontend partials were established and subsequently replaced with functional components. |
| **Phase 3** | Data Model & Migrations | **Implemented (Exceeded)** | All 11 core tables created via Alembic migrations. Scope expanded through 20 migrations (`0001` through `0020`), adding ledger transactions, cheques, statement imports, rules, attachments, and compensation plans. |
| **Phase 4** | Core CRUD Operations | **Implemented** | Full repository/service/router CRUD active for bank accounts, customers, vendors, sales invoices, bills, and subscriptions. |
| **Phase 5** | Payroll Engine | **Implemented (Re-architected)** | Moved from a simple runner to a modern in-page 4-step workflow (Draft $\rightarrow$ Approved $\rightarrow$ Processing $\rightarrow$ Paid) in `be/finance/routers/payroll.py`, `be/finance/services/payroll_service.py`, and `fe/public/js/finance-payroll.js`. Supports dual funding accounts (FUX-420), employee salary split, inline bonuses, and ledger disbursements. |
| **Phase 6** | Reporting Layer | **Implemented** | Comprehensive `reports_service.py` (115KB) implements Balances, Revenue, P&L, Balance Sheet, Cash Flow, General Ledger, Spend reporting, and audited Excel exports. |
| **Phase 7** | Role Expansion (`accountant`, `hr_admin`, `hr_staff`) | **Planned only** | Schema and permissions are ready; roles remain unseeded in `be/core/rbac_seed.py`. |
| **Beyond Plan** | FUX-406 to FUX-420 Stories | **Implemented** | Added settlement linking (406), bill repository (407), combined bill payment guard (408), payment method naming (409), statutory obligations (410), bill defaults (411), collapsible filters (412), PDF extraction (413), collapsible status bar (414), density setting (415), compensation plans (416-418), dual funding accounts (420). |

---

## 6. Data, Security, and Authorization Status

### Data Persistence Architecture
- **Primary Database Engine:** Relational SQL exclusively. Controlled via `be/config.py` (`STORAGE_ENGINE=sql`). Config enforces `DB_TYPE` as either `sqlite` (with file path normalization) or `postgres` / `postgresql`.
- **Database Connection Management:**
  - Configured in `be/db.py` with SQLAlchemy `create_engine` using `pool_pre_ping=True`, `DB_POOL_SIZE` (default 10), `DB_MAX_OVERFLOW` (default 20), and `DB_POOL_RECYCLE` (default 1800s).
  - FastAPI dependency `get_db` yields sessions; context manager `get_db_context` manages standalone commits/rollbacks for background scripts.
- **Migration & Schema Synchronization:**
  - Alembic manages migrations (`be/migrations/versions/`) covering 20 sequential revisions.
  - Startup hook `init_db()` in `be/db.py:75` creates tables and dynamically executes `ALTER TABLE ADD COLUMN` for SQLite dev instances before seeding RBAC and lookup data.

### Authentication & Token Flow
- **Provider:** Google Identity Services ("Sign in with Google") OAuth 2.0.
- **Verification:** `be/auth.py:verify_google_credential` validates the token signature against Google's public certs using `google.oauth2.id_token.verify_oauth2_token`.
- **Domain Restriction:** `ALLOWED_WORKSPACE_DOMAIN` validates the `hd` (hosted domain) claim. When `ENVIRONMENT=production`, `Config.validate()` mandates this setting.
- **Session Cookie:** On valid login, `be/auth.py:create_session_token` signs an HMAC-SHA256 JWT containing `email`, `role`, `employee_id`, `name`, and `exp` (default 12 hours). The token is set in an `HttpOnly`, `SameSite=Lax` cookie named `hrflow_session`. JavaScript cannot access this cookie directly, eliminating XSS token exfiltration.

### Authorization & RBAC Enforcement
- **Permission Modeling:** Modeled in `be/core/rbac_models.py` (`PermissionDB`, `RoleDB`, `RolePermissionDB`, `UserRoleDB`). Permissions follow `<module>.<resource>.<action>`.
- **Resolution & Caching:** `be/core/permissions.py:get_current_user_permissions` resolves effective permissions through all assigned roles and caches the set on `request.state.user_permissions` for the request lifecycle.
- **Administrative Wildcards:** Any user having `role='admin'` in their JWT token or `UserDB` record, or assigned `system_admin` in RBAC, automatically receives the wildcard permission `*`.
- **Enforcement Discrepancy:**
  - Finance domain (`be/finance/routers/*.py`): 100% gated via `require_permission(...)` (194 references).
  - HR domain (`be/routers/*.py`): 35 routes still use legacy `require_admin` (`be/auth.py:112`), which checks `current_user.get("role") == "admin"` rather than granular permissions.

### Document Storage Security
- **Backend Storage:** `be/storage.py` routes uploads either to Google Drive (`DriveStorageClient`) or local disk (`LocalStorageClient`).
- **Authorization Gating:** Document streaming endpoints (`be/routers/documents.py:get_document`, `download_document`) authenticate through the session cookie and enforce employee ownership or administrative permissions before streaming bytes. No raw public Drive links are exposed to clients.
- **Sensitive Data Masking:** Company and employee bank account numbers and IBANs are masked in standard API serialization, with unmasking strictly gated behind `finance.vendor_payment.reveal` or `finance.bank_account.reveal`.

---

## 7. Test and Deployment Status

### Backend Test Suite (`be/tests/`)
- **Total Test Files:** 66 test modules.
- **Framework:** `pytest` 8.3.2 with `httpx` 0.27.2 for `TestClient` API testing.
- **Coverage Areas:**
  - Authentication, session expiry, token decode, and RBAC permission checks (`test_authorization.py`, `test_rbac.py`).
  - Configuration validation and environment fail-fast checks (`test_config_validation.py`, `test_db_config.py`).
  - HR domain CRUD, salary splits, insurance, vacations, requests, and payment docs (`test_domain_crud.py`, `test_employee_salary_split.py`, `test_salary_payment_docs.py`).
  - SQL repository unit tests and SQLite-to-Postgres migration checks (`test_sql_repositories.py`, `test_sqlite_to_postgres_migration.py`).
  - Complete Finance domain workflows: AP bills approval, combined payments, PDF extraction, bank accounts, double-entry ledger, cheques lifecycle, statement parsing, reconciliation rules, payroll runner, compensation plans, and financial reports.

### Frontend UI Test Suite (`fe/tests/ui/`)
- **Total Spec Files:** 55 Playwright UI specifications.
- **Framework:** `@playwright/test` 1.63.0 against Chromium.
- **Execution Mechanism:** Run via `npx playwright test tests/ui/<spec>.spec.js --reporter=line`.
- **Environment:** Automated web server launches local Vite dev server on port 5173. Mock mode (`?mock=admin` or `?mock=employee`) provides deterministic fixtures and rapid verification.
- **Key Workflow Coverage:**
  - In-Page Payroll Runner (`finance-payroll-table-cycle.spec.js`, `finance-guided-payroll.spec.js`).
  - Bills Inbox, Multi-level Approval & Collapsible Filters (`finance-bills-approval.spec.js`, `finance-bill-collapsible-filters.spec.js`).
  - Cheques lifecycle, bank transfers, reconciliation workspace, and financial statements.

### Build and Deployment Pipeline
- **Bundler:** Vite 5.4.21 with custom build script (`fe/vite.config.js`).
- **Build Command:** `npm run build` inside `fe/` invokes:
  1. `npm run bundle:finance-api` (`node scripts/assemble-finance-api.js` combines 11 API modules into `fe/finance-api.js`).
  2. `vite build` (inlines all HTML partials, concatenates 28 JS files in strict dependency order, inlines CSS, and writes single-file `fe/dist/index.html`).
- **Production Artifact:** `fe/dist/index.html` (1.57 MB) accompanied by direct asset siblings (`api.js`, `finance-api.js`, `config.js`, logo PNGs).
- **Backend Deployment:** Standard ASGI server execution: `uvicorn main:app --host 0.0.0.0 --port 8000`.

---

## 8. Known Technical Debt and Inconsistencies

1. **Documentation vs. Architecture Inconsistency (High):**
   - `AGENTS.md` and the docstring of `be/main.py` state that HRFlow is "backed entirely by a Google Sheet".
   - *Reality:* The application was completely migrated to relational SQL via SQLAlchemy and Alembic. Google Sheets is strictly an export destination; the application refuses to start if `STORAGE_ENGINE != "sql"` (`be/config.py:180`).
2. **Dormant Migration Repositories (Medium):**
   - The directories `be/repositories/sheets/` (11 files) and `be/repositories/dual/` (11 files) are dead code left over from the database migration phase. `be/repositories/deps.py` hard-wires `Sql*Repository`.
3. **Dead Imports in `be/auth.py` (Low):**
   - `be/auth.py:21-22` imports `get_client` from `sheets_client` and `SheetsUserRepository` from `repositories.sheets.auth`, neither of which is used anywhere in the file.
4. **Inconsistent Authorization Guards across HR vs Finance (Medium):**
   - All 20 Finance routers enforce RBAC via `require_permission(...)`.
   - 35 endpoints in `be/routers/*.py` (HR domain) still use `require_admin` (`be/auth.py:112`), checking a coarse role string instead of granular permissions.
5. **Absence of Background Task Infrastructure (Medium):**
   - High-latency tasks—such as PDF OCR extraction (`bill_extractor.py`), multi-period financial report compilation (`reports_service.py`), and statement import parsing—run synchronously in the HTTP request thread. There is no queue or worker pool.
6. **Monolithic Frontend Script Injection (Low/Medium):**
   - Inlining 28 JavaScript files into a single `<script>` block in `dist/index.html` creates a brittle runtime context: an uncaught syntax error in any single file halts the entire application execution.
7. **Document Generation Platform Coupling (Medium):**
   - `be/services/pdf_converter.py` couples PDF generation to Windows COM (`win32com.client`) or local LibreOffice binaries. Linux production containers require `libreoffice` pre-installed or fallback to Google Drive API.

---

## 9. Recommended Next 5 Implementation Slices

1. **Slice 1: Implement Structured Payroll Deductions Workflow**
   - *Context:* The repository is currently on branch `feature/payroll-deductions`.
   - *Scope:* Extend the in-page payroll runner (`be/finance/routers/payroll.py`, `fe/public/js/finance-payroll.js`) to support structured, itemized deductions (social insurance, salary advances, tax withholdings, penalties) with inline breakdowns in the worksheet and payslip generation.
2. **Slice 2: Harmonize HR Domain Routes with RBAC (`require_permission`)**
   - *Context:* Eliminate the legacy `require_admin` role guard across 35 HR endpoints.
   - *Scope:* Replace `require_admin` in `be/routers/*.py` with canonical RBAC permissions (`hr.employee.write`, `hr.salary.write`, `hr.vacation.write`, etc.), ensuring full parity with the Finance domain's authorization model.
3. **Slice 3: Activate Phase 7 Role Expansion**
   - *Context:* Complete the deferred role expansion from `docs/finance-module/01-implementation-plan.md`.
   - *Scope:* Seed `accountant`, `hr_admin`, and `hr_staff` in `be/core/rbac_seed.py` with their pre-defined permission bundles; provide an admin UI or migration script to assign users to these roles.
4. **Slice 4: Cleanup Dormant Sheets/Dual Repositories and Align Documentation**
   - *Context:* Remove obsolete code paths and resolve docstring drift.
   - *Scope:* Update `AGENTS.md` and `be/main.py` to document the SQL persistence engine accurately; clean up dead imports in `be/auth.py`; archive or remove `be/repositories/sheets/` and `be/repositories/dual/`.
5. **Slice 5: Complete Employee Self-Service Payslip Portal**
   - *Context:* Payslips can be generated on the backend, but the employee view is a placeholder.
   - *Scope:* Wire `fe/src/partials/employee/sections/payslips.html` to `fe/finance-api.js` to enable authenticated employees to view historical pay runs and download generated PDF payslips on demand.

---

## 10. Open Questions and Assumptions

1. **Employer Tax/Contribution Handling on Payroll Settlement:**
   - *Question:* When payroll transitions to `status='paid'`, should `payroll_service.py` debit the bank account strictly by `total_net` (wages disbursed to employees), or also generate ledger disbursements for employer tax and insurance contributions?
   - *Current Code Behavior:* It records net pay disbursements against the selected target bank accounts (`funding_account_id_ext`, `funding_account_id_int`).
2. **Permanent Storage Destination for Production Files:**
   - *Question:* Is Google Drive intended as the permanent cloud file store, or should an S3-compatible object store (e.g. AWS S3, Cloudflare R2, MinIO) replace `drive_client.py` and `LocalStorageClient` for containerized cloud deployments?
3. **Multi-Currency and Automated FX Feeds:**
   - *Question:* Transfers and ledger transactions support multi-currency (EGP, USD, EUR, etc.), but exchange rates are currently entered manually. Is an automated FX rate provider (e.g. CBE or open exchange rates API) planned?
4. **Deprecation of Legacy Google Sheets Export:**
   - *Question:* With the implementation of the audited Excel export engine (`be/finance/services/excel_exporter.py`), is the Google Sheets export functionality (`be/services/export.py`) still required by business stakeholders, or can `gspread` and service account sheet scopes be fully decommissioned?
