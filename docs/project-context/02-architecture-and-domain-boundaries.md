# HRFlow Architecture and Domain Boundaries

**Status:** Draft — needs owner review  
**Last verified against:** `feature/payroll-deductions` at `1695cfc` (`main` at `a4d6202`)  
**Last updated:** September 22, 2026  
**Authority:** Repository evidence, `01-repository-baseline.md`, and approved finance architecture documentation  

---

## 1. Purpose and Scope

HRFlow is an internal operations platform uniting Human Resources (HR) and Financial Management for Voyance Health. It provides an Admin Portal for operations and an Employee Portal for self-service profiles, requests, medical claims, and payslips.

This document serves as the durable architecture anchor and domain boundary reference for developers and coding agents. It defines system structure, data-tier contracts, authentication mechanics, and cross-domain rules. It is not an exhaustive API catalog, schema reference, workflow manual, or deployment checklist; detailed operational specifications reside in their respective companion documents.

---

## 2. Architecture at a Glance

HRFlow is a single-deployment **modular monolith** with three core tiers:

- **Backend:** FastAPI application ([be/main.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/main.py)) structured into routers ([be/routers/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/routers/), [be/finance/routers/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/finance/routers/)), services ([be/services/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/services/), [be/finance/services/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/finance/services/)), and repositories ([be/repositories/sql/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/repositories/sql/), [be/finance/repositories/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/finance/repositories/)).
- **Frontend:** Vanilla HTML, CSS, and modern JavaScript without frontend frameworks (no React/Vue). Built with Vite 5.4 ([fe/vite.config.js](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/fe/vite.config.js)) and `vite-plugin-singlefile`, compiling HTML partials ([fe/src/partials/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/fe/src/partials/)), styles, and scripts into a single self-contained artifact ([fe/dist/index.html](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/fe/dist/index.html)).
- **Persistence:** Relational SQL exclusively through SQLAlchemy 2.0 and Alembic ([be/db.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/db.py), [be/migrations/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/migrations/)). Uses `sqlite` ([hrflow.db](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/hrflow.db)) for local development/testing and `postgres` / `postgresql` (PostgreSQL 16+) for staging and production ([docker-compose.db.yml](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docker-compose.db.yml)).
- **Data Persistence Reality:** **Google Sheets is strictly an export destination, not an application database.** The backend enforces `STORAGE_ENGINE=sql` and fails fast on startup if configured otherwise ([be/config.py:180](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/config.py#L180)).
- **File Storage Drivers:** Abstracted via `StorageClient` ([be/storage.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/storage.py)) supporting Google Drive via service account ([be/drive_client.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/drive_client.py)) and the local filesystem (`LOCAL_STORAGE_PATH`) for local testing or air-gapped environments.

---

## 3. Domain Boundaries

The application logic is partitioned into Core, HR, and Finance domains:

| Domain | Responsibility | Primary Backend Areas | Primary Frontend Areas | Boundary Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Core** | Authentication, session lifecycle, security headers, RBAC resolution, database session management, and global configuration. | `be/auth.py`<br>`be/config.py`<br>`be/db.py`<br>`be/deps.py`<br>`be/core/` (`permissions.py`, `rbac_models.py`, `rbac_seed.py`) | `fe/public/js/session.js`<br>`fe/src/partials/shell/login-screen.html`<br>`fe/src/partials/shell/app-loader.html` | Owns identities, role links, and permission evaluation. Exposes route dependencies (`require_permission`) and current user context to other domains. |
| **HR** | Employees, compensation/salary history, employee bank details, vacations, insurance policies/claims, documents, salary payment docs, requests. | `be/routers/` (`employees.py`, `salary.py`, `employee_bank_accounts.py`, `vacations.py`, `insurance.py`, `documents.py`, `salary_payment_docs.py`, `requests.py`)<br>`be/repositories/sql/`<br>`be/models_db.py` | `fe/public/js/` (`employees.js`, `salary.js`, `invoices.js`, `vacations.js`, `insurance.js`, `dochub.js`, `requests.js`)<br>`fe/src/partials/admin/sections/`<br>`fe/src/partials/employee/` | Primary authority for employee master data (`EmployeeDB`). Never directly alters company ledger balances or vendor liabilities. |
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
| **Payroll Run & Line** | **Finance** | `PayrollRunDB`<br>`PayrollLineDB`<br>`/api/finance/payroll/runs` | Accounting period execution (Draft $\rightarrow$ Approved $\rightarrow$ Processing $\rightarrow$ Paid). Disburses cash, generates ledger entries, and records expense lines. |
| **Google Sheets Export** | **Integration** | `be/services/export.py`<br>`be/sheets_client.py` | Outbound export pipeline syncing current dataset snapshots to an external spreadsheet sink. |
| **SQL Persistence** | **Core Data** | `be/db.py`<br>`be/models_db.py`<br>`be/finance/models.py` | The authoritative database layer storing all domain records and financial state. |

---

## 5. Cross-Cutting Architecture Rules

1. **Persistence and Migrations:** All persistent schema updates must use Alembic migrations in `be/migrations/versions/`. Maintain cross-compatibility between SQLite (development) and PostgreSQL (production).
2. **Authentication Flow:** Authenticate via Google Sign-In OAuth 2.0 ([be/auth.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/auth.py)). Session tokens are HS256 JWTs stored in an `HttpOnly`, `SameSite=Lax` cookie (`hrflow_session`). Production mandates domain validation (`ALLOWED_WORKSPACE_DOMAIN`).
3. **Authorization Model:**
   - **Finance:** 100% gated by granular RBAC permissions using `require_permission(...)` ([be/core/permissions.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/core/permissions.py)).
   - **HR:** Gated by `require_permission` and legacy `require_admin`. Existing `require_admin` guards must not be bypassed; they must be incrementally migrated to RBAC permissions.
   - Administrative users (`role="admin"` or RBAC `system_admin`) receive wildcard permission `*`.
4. **Data Masking:** IBANs, bank accounts, and vendor remittance details are masked by default. Unmasking is restricted to permission holders (`finance.bank_account.reveal`, `finance.vendor_payment.reveal`).
5. **Storage Gating:** Direct storage links are never exposed. File access streams through authenticated endpoints ([be/routers/documents.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/routers/documents.py)) enforcing employee ownership or admin rights.
6. **Synchronous Execution Note:** Long-running processes (PDF OCR extraction via `pypdf`, statement imports, Excel exports via `openpyxl`) run **synchronously** within FastAPI request handlers. Do not assume background job queues (Celery/Redis) exist.

---

## 6. Sources of Truth and Documentation Hierarchy

When resolving technical conflicts, apply the following order of precedence:

1. **Active Code, Migrations, and Tests:** Code in `be/`, Alembic migrations, and automated tests (`be/tests/`, `fe/tests/ui/`) represent definitive operational truth.
2. **Repository Baseline Audit:** [docs/project-context/01-repository-baseline.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/project-context/01-repository-baseline.md) reflects verified implementation status as of September 2026.
3. **Approved Domain Specifications:** Technical specs in [docs/finance-module/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/finance-module/) (`00-architecture-blueprint.md`, FUX-406 through FUX-420) govern domain requirements.
4. **Active Task Acceptance Criteria:** Explicit requirements defined in prompt or story specs.
5. **Conversation Context:** Intermediate thread context when not contradicted by levels 1–4.
6. **Historical Roadmap Documentation:** Files in [docs/roadmap/](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/roadmap/) (August 2026) are historical references only.

> [!WARNING]
> References in [AGENTS.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/AGENTS.md) or [be/main.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/main.py) describing Google Sheets as a database are legacy remnants. SQL is the primary database.

---

## 7. Current Known Boundary Gaps

- **HR Route Guard Inconsistency:** ~35 endpoints in `be/routers/` still check `require_admin` instead of granular RBAC permissions.
- **Pending Role Expansion:** Specialist roles (`accountant`, `hr_admin`, `hr_staff`) are defined conceptually but remain unseeded in `SEED_ROLES` ([be/core/rbac_seed.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/core/rbac_seed.py)).
- **Dormant Repositories:** `be/repositories/sheets/` and `be/repositories/dual/` are inactive migration relics.
- **Incomplete Payslip Self-Service:** The employee payslip section ([fe/src/partials/employee/sections/payslips.html](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/fe/src/partials/employee/sections/payslips.html)) needs full UI wiring to backend payslip endpoints.
- **No Background Processing Layer:** Heavy tasks run synchronously in-process, needing careful query and payload optimization.

---

## 8. Related References

- [01-repository-baseline.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/project-context/01-repository-baseline.md) — Comprehensive baseline audit and system status.
- [../finance-module/00-architecture-blueprint.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/finance-module/00-architecture-blueprint.md) — Guiding principles for modular monolith and Finance domain.
- [../finance-module/01-implementation-plan.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/finance-module/01-implementation-plan.md) — Phased delivery plan for Finance features.
- [../../be/SETUP_GUIDE.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/SETUP_GUIDE.md) — Backend setup, SQL configuration, and service account setup.
- [../../AGENTS.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/AGENTS.md) — Operating guide, Playwright UI testing, and git conventions.
