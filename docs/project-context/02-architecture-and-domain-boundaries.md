# HRFlow Architecture and Domain Boundaries

**Status:** Draft — needs owner review  
**Last verified against:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main`)  
**Last updated:** October 1, 2026 (reconciled with code; link targets made relative)  
**Authority:** Repository evidence, `01-repository-baseline.md`, and approved finance architecture documentation  

---

## 1. Purpose and Scope

HRFlow is an internal operations platform uniting Human Resources (HR) and Financial Management for Voyance Health. It provides an Admin Portal for operations and an Employee Portal for self-service profiles, requests, medical claims, and payslips.

This document serves as the durable architecture anchor and domain boundary reference for developers and coding agents. It defines system structure, data-tier contracts, authentication mechanics, and cross-domain rules. It is not an exhaustive API catalog, schema reference, workflow manual, or deployment checklist; detailed operational specifications reside in their respective companion documents.

---

## 2. Architecture at a Glance

HRFlow is a single-deployment **modular monolith** with three core tiers:

- **Backend:** FastAPI application ([be/main.py](../../be/main.py)) structured into routers ([be/routers/](../../be/routers/), [be/finance/routers/](../../be/finance/routers/)), services ([be/services/](../../be/services/), [be/finance/services/](../../be/finance/services/)), and repositories ([be/repositories/sql/](../../be/repositories/sql/), [be/finance/repositories/](../../be/finance/repositories/)).
- **Frontend:** Vanilla HTML, CSS, and modern JavaScript without frontend frameworks (no React/Vue). Built with Vite 5.4 ([fe/vite.config.js](../../fe/vite.config.js)) and `vite-plugin-singlefile`, compiling HTML partials ([fe/src/partials/](../../fe/src/partials/)), styles, and scripts into a single self-contained artifact ([fe/dist/index.html](../../fe/dist/index.html)).
- **Persistence:** Relational SQL exclusively through SQLAlchemy 2.0 and Alembic ([be/db.py](../../be/db.py), [be/migrations/](../../be/migrations/)). Uses `sqlite` ([hrflow.db](../../hrflow.db)) for local development/testing and `postgres` / `postgresql` (PostgreSQL 16+) for staging and production ([docker-compose.db.yml](../../docker-compose.db.yml)).
- **Data Persistence Reality:** **Google Sheets is strictly an export destination, not an application database.** The backend enforces `STORAGE_ENGINE=sql` and fails fast on startup if configured otherwise ([be/config.py:180](../../be/config.py#L180)).
- **File Storage Drivers:** Abstracted via `StorageClient` ([be/storage.py](../../be/storage.py)) supporting Google Drive via service account ([be/drive_client.py](../../be/drive_client.py)) and the local filesystem (`LOCAL_STORAGE_PATH`) for local testing or air-gapped environments.

---

## 3. Domain Boundaries

The application logic is partitioned into Core, HR, and Finance domains:

| Domain | Responsibility | Primary Backend Areas | Primary Frontend Areas | Boundary Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Core** | Authentication, session lifecycle, security headers, RBAC resolution, database session management, and global configuration. | `be/auth.py`<br>`be/config.py`<br>`be/db.py`<br>`be/deps.py`<br>`be/core/` (`permissions.py`, `rbac_models.py`, `rbac_seed.py`) | `fe/public/js/session.js`<br>`fe/src/partials/shell/login-screen.html`<br>`fe/src/partials/shell/app-loader.html` | Owns identities, role links, and permission evaluation. Exposes route dependencies (`require_permission`) and current user context to other domains. |
| **HR** | Employees, compensation/salary history, employee bank details, vacations, insurance policies/claims, documents, salary payment docs, requests. | `be/routers/` (`employees.py`, `salary.py`, `employee_bank_accounts.py`, `vacations.py`, `insurance.py`, `documents.py`, `salary_payment_docs.py`, `requests.py`, `social_insurance.py`)<br>`be/repositories/sql/`<br>`be/models_db.py` | `fe/public/js/` (`employees.js`, `salary.js`, `invoices.js`, `vacations.js`, `insurance.js`, `dochub.js`, `requests.js`)<br>`fe/src/partials/admin/sections/`<br>`fe/src/partials/employee/` | Primary authority for employee master data (`EmployeeDB`). Never directly alters company ledger balances or vendor liabilities. |
| **Finance** | Company bank accounts, double-entry ledger, transfers, AP bills, sales invoices, vendors/customers, cheques, statement reconciliation, obligations, payroll, reports, and exports. | `be/finance/routers/` (20 routers)<br>`be/finance/services/` (25 services)<br>`be/finance/repositories/` (16 repos)<br>`be/finance/models.py`<br>`be/finance/schemas.py` | `fe/public/js/` (`finance-*.js`, `payroll-*.js`)<br>`fe/api/finance/` (assembled to `finance-api.js`)<br>`fe/src/partials/admin/sections/finance-*.html`<br>`fe/src/partials/modals/finance-*.html` | Owns monetary transactions, account balances, and financial reporting. Reads employee salary structures to compile immutable `PayrollLineDB` snapshots; does not mutate HR employee records. |

### Boundary Enforcement
- **Explicit Interfaces:** Cross-domain operations must proceed through explicit service or repository interfaces rather than direct database manipulation.
- **Table Namespacing:** Core uses base entity names (`users`, `roles`). HR tables are domain-specific (`employees`, `salary_history`). Finance tables use the `finance_` prefix (`finance_bank_accounts`, `finance_bills`, `finance_ledger_transactions`, `finance_payroll_runs`).
- **Decoupled Client APIs:** Frontend clients are segregated into `fe/api.js` (HR) and `fe/finance-api.js` (Finance), with shared modal containers in `fe/src/partials/modals/`.

---

## 4. Key Terminology and Collision Avoidance

To prevent cross-domain confusion, use these canonical terms and paths:

| Entity / Concept | Domain | Canonical Path | Disambiguation & Rules |
| :--- | :--- | :--- | :--- |
| **Salary Payment Document** | **HR** | `SalaryPaymentDocDB`<br>`/api/salary-payment-docs`<br>`be/routers/salary_payment_docs.py` | Individual employee monthly pay receipt / invoice. Avoid calling this simply "Invoice" to prevent confusion with commercial AR invoices. |
| **Sales Invoice** | **Finance** | `SalesInvoiceDB`<br>`/api/finance/invoices`<br>`be/finance/routers/sales_invoices.py` | Commercial Accounts Receivable (AR) billing invoice issued to external customers (`CustomerDB`). |
| **Employee Bank Account** | **HR** | `EmployeeBankAccountDB`<br>`/api/employee-bank-accounts`<br>`be/routers/employee_bank_accounts.py` | Personal bank account/IBAN owned by an employee to receive net pay disbursements. Gated under HR access rules. |
| **Company Bank Account** | **Finance** | `FinanceBankAccountDB`<br>`/api/finance/accounts`<br>`be/finance/routers/bank_accounts.py` | Operational treasury account, bank account, or petty cash drawer owned by Voyance Health. |
| **Employee Compensation / Salary** | **HR** | `EmployeeDB.salary`<br>`SalaryHistoryDB`<br>`/api/salary` | Standing base compensation rates, USD internal/external splits, and historical raise logs. |
| **Payroll Run & Line** | **Finance** | `PayrollRunDB`<br>`PayrollLineDB`<br>`/api/finance/payroll/runs` | Accounting period execution (`draft` → `submitted` → `approved` → `finalized` → `partially_paid` / `paid`). Records net-pay disbursements and posts net-disbursement ledger entries; does not generate tax or liability entries. |
| **Google Sheets Export** | **Integration** | `be/services/export.py`<br>`be/sheets_client.py` | Outbound export pipeline syncing current dataset snapshots to an external spreadsheet sink. |
| **SQL Persistence** | **Core Data** | `be/db.py`<br>`be/models_db.py`<br>`be/finance/models.py` | The authoritative database layer storing all domain records and financial state. |

---

## 5. Cross-Cutting Architecture Rules

1. **Persistence and Migrations:** All persistent schema updates must use Alembic migrations in `be/migrations/versions/`. Maintain cross-compatibility between SQLite (development) and PostgreSQL (production).
2. **Authentication Flow:** Authenticate via Google Sign-In OAuth 2.0 ([be/auth.py](../../be/auth.py)). Session tokens are HS256 JWTs stored in an `HttpOnly`, `SameSite=Lax` cookie (`hrflow_session`). Per D-013, verified Google accounts of any domain are supported for provisioned users (matched case-insensitively against active HRFlow users).
3. **Authorization Model (Unified RBAC per D-011):**
   - **Single Authority:** Relational RBAC (`roles`, `role_permissions`, `user_roles`) is the sole authorization authority across both HR and Finance domains. Legacy `require_admin`, `users.role`, role claims, and `*` wildcards are eliminated.
   - **All Routes Gated:** Every route across HR and Finance enforces fine-grained catalog permissions via `require_permission(...)` or scoped dependencies (`permission_scope(...)`), except the public allow-list (`/api/auth/google`, `/api/auth/logout`, `/api/auth/me`, `/api/health`).
   - **Five Seeded Roles:** Super-Admin (locked, all catalog permissions), HR-Admin, Financial-Admin, Payroll-Maker, Employee (derived baseline for linked employees).
   - **Payroll Separation:** Payroll actions are partitioned into `finance.payroll.prepare`, `finance.payroll.approve`, and `finance.payroll.pay`. Runtime maker-checker prevents self-approval unless holding both prepare and approve.
4. **Data Masking:** IBANs, bank accounts, and vendor remittance details are masked by default. Unmasking of company and vendor details is restricted to `finance.bank_account.reveal` and `finance.vendor_payment.reveal`; unmasking employee bank details is restricted to `hr.employee_bank_account.reveal`.
5. **Storage Gating:** Direct storage links are never exposed. File access streams through authenticated endpoints ([be/routers/documents.py](../../be/routers/documents.py)) enforcing employee ownership or admin rights.
6. **Synchronous Execution Note:** Long-running processes (PDF OCR extraction via `pypdf`, statement imports, Excel exports via `openpyxl`) run **synchronously** within FastAPI request handlers. Do not assume background job queues (Celery/Redis) exist.

---

## 6. Sources of Truth and Documentation Hierarchy

When resolving technical conflicts, apply the following order of precedence:

1. **Active Code, Migrations, and Tests:** Code in `be/`, Alembic migrations, and automated tests (`be/tests/`, `fe/tests/ui/`) represent definitive operational truth.
2. **Repository Baseline Audit:** [docs/project-context/01-repository-baseline.md](../../docs/project-context/01-repository-baseline.md) reflects verified implementation status as of September 2026.
3. **Approved Domain Specifications:** Technical specs in [docs/finance-module/](../../docs/finance-module/) (`00-architecture-blueprint.md`, FUX-406 through FUX-420) govern domain requirements.
4. **Active Task Acceptance Criteria:** Explicit requirements defined in prompt or story specs.
5. **Conversation Context:** Intermediate thread context when not contradicted by levels 1–4.
6. **Historical Roadmap Documentation:** Files in [docs/roadmap/](../../docs/roadmap/) (August 2026) are historical references only.

> [!WARNING]
> The docstring and API description in [be/main.py](../../be/main.py) still describe Google Sheets as a database; that text is a legacy remnant. SQL is the primary database.

---

## 7. Current Known Boundary Gaps

- **Dormant Repositories:** `be/repositories/sheets/` and `be/repositories/dual/` are migration relics, but `be/routers/insurance.py` still imports `compute_consumption` from `repositories/sheets/insurance.py`.
- **Incomplete Payslip Self-Service:** the employee payslip section ([fe/src/partials/employee/sections/payslips.html](../../fe/src/partials/employee/sections/payslips.html)) calls `refreshMyPayslips()`, which is not defined; the API client already exposes `getMyPayslips`.
- **No Background Processing Layer:** Heavy tasks run synchronously in-process, needing careful query and payload optimization.

---

## 8. Related References

- [01-repository-baseline.md](../../docs/project-context/01-repository-baseline.md) — Comprehensive baseline audit and system status.
- [../finance-module/00-architecture-blueprint.md](../../docs/finance-module/00-architecture-blueprint.md) — Guiding principles for modular monolith and Finance domain.
- [../finance-module/01-implementation-plan.md](../../docs/finance-module/01-implementation-plan.md) — Phased delivery plan for Finance features.
- [../../be/SETUP_GUIDE.md](../../be/SETUP_GUIDE.md) — Backend setup, SQL configuration, and service account setup.
- [../../AGENTS.md](../../AGENTS.md) — Operating guide, Playwright UI testing, and git conventions.
