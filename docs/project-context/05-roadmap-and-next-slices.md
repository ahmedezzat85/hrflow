# HRFlow Roadmap and Next Slices

**Status:** Draft — planning baseline  
**Last verified against:** `main` at `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`  
**Last updated:** September 22, 2026  
**Authority:** Main-branch repository evidence and project-context documents  

---

## 1. Planning Rules

This roadmap defines a sequenced series of delivery slices for HRFlow:

- **Sequencing Guide:** Slices define delivery order, not proof that a capability is already implemented or approved.
- **Main Branch Authority:** The `main` branch, its active migrations, and passing tests represent operational ground truth. Feature-branch work is not assumed present on `main` without verification.
- **Incremental & Reversible:** Slices must be independently reviewable, testable, and reversible where practical.
- **Decision Gating:** Where a slice depends on an unresolved question in [06-open-questions.md](06-open-questions.md), implementation pauses until formally decided in [04-decision-log.md](04-decision-log.md).
- **Historical Material as Reference:** Completed plans in `docs/finance-module/` or `docs/roadmap/` provide historical acceptance context, not the active roadmap.

---

## 2. Current Delivery Position

Verified main-branch evidence establishes the delivery position:

- **Relational SQL Foundation:** SQL migration via SQLAlchemy and Alembic (20 migrations up to `0020_fux_420_payroll_dual_funding_accounts.py`) is complete. Google Sheets is an export destination only.
- **Core Platform Monolith:** Core HR and foundational Finance modules (Accounts, Ledger, Bills, Invoices, Cheques, Statements, Reconciliation) are functional.
- **Authorization Discrepancy:** Finance is fully gated by fine-grained RBAC (`require_permission`), while ~35 endpoints in HR rely on legacy `require_admin` guards.
- **Deferred Specialist Roles:** Phase 7 role expansion (`accountant`, `hr_admin`, `hr_staff`) remains pending; only `system_admin` and `employee` are seeded.
- **Incomplete Payslip UI:** Backend payslip generation endpoints exist, but the employee self-service view (`fe/src/partials/employee/sections/payslips.html`) is an incomplete placeholder.
- **Legacy Code & Drift:** Dormant repositories (`be/repositories/sheets/`, `dual/`) remain, and `AGENTS.md` and `be/main.py` contain outdated text describing Google Sheets as a database.
- **Synchronous Constraint:** High-latency tasks (PDF OCR parsing, statement imports, Excel exports) run synchronously in request threads; no background queue exists.
- **Branch Work Isolation:** Feature-branch enhancements (payroll runner iterations, deduction prototypes) are not part of `main` until explicitly reconciled.

---

## 3. Recommended Delivery Sequence

### Slice 1 — Complete and Validate Active Main-Line Payroll Scope

- **Objective:** Audit payroll capabilities currently on `main`, reconcile accepted decisions `D-003` through `D-007` against active code/tests, and establish a validated delivery baseline.
- **Boundaries / Out of Scope:** Do not resolve question `Q-001` (payroll funding scope) by assumption. Do not implement new deduction engines, bank rails, or schema changes.
- **Dependencies / Decision Gates:** None. Relies on verified `main` code, [01-repository-baseline.md](01-repository-baseline.md), and [04-decision-log.md](04-decision-log.md).
- **Main Affected Areas:** `be/finance/routers/payroll.py`, `be/finance/services/payroll_service.py`, `fe/public/js/finance-payroll.js`, `fe/tests/ui/finance-payroll-*.spec.js`.
- **Acceptance Criteria:**
  1. Capability matrix compares `main` against decisions `D-003` through `D-007`.
  2. Each decision is marked `Implemented`, `Partial`, or `Not started` with code citations.
  3. Feature-branch discrepancies are cataloged into discrete follow-up tasks.
- **Risks / Cautions:** Avoid assuming UI behaviors on `feature/payroll` are on `main`. Keep work read-only or limited to diagnostic tests.
- **Recommended Output Artifact:** Capability audit report (`docs/project-context/payroll-scope-audit.md`).

---

### Slice 2 — Harmonize HR Authorization with Core RBAC

- **Objective:** Replace legacy `require_admin` guards in the HR domain with granular RBAC permissions (`require_permission`), matching Finance standards.
- **Boundaries / Out of Scope:** Do not activate or assign deferred specialist roles (`accountant`, `hr_admin`). Do not alter frontend visibility or data models.
- **Dependencies / Decision Gates:** Conforms to [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md). May be delivered in incremental sub-slices (employees $\rightarrow$ salary $\rightarrow$ vacations $\rightarrow$ documents). Does not require Phase 7 role expansion to begin.
- **Main Affected Areas:** `be/routers/` (`employees.py`, `salary.py`, `vacations.py`, `insurance.py`, `documents.py`, `salary_payment_docs.py`, `requests.py`), `be/core/rbac_seed.py`, `be/tests/test_authorization.py`.
- **Acceptance Criteria:**
  1. Targeted HR routes transition from `require_admin` to canonical permissions (`hr.employee.read`, `hr.employee.write`, `hr.salary.write`, `hr.vacation.write`, etc.).
  2. Existing admin access is preserved via wildcard permissions (`*`).
  3. Self-service permissions (`self.profile.read`, `self.requests.write`) enforce employee data isolation.
  4. Backend tests verify 403 Forbidden for unauthorized callers and 200 OK for authorized callers.
- **Risks / Cautions:** Ensure wildcard resolution for admin tokens remains intact across all routes to prevent lockout.
- **Recommended Output Artifact:** Pull request with scoped router updates and pytest coverage in `be/tests/test_authorization.py`.

---

### Slice 3 — Activate Specialist Roles and Operational Assignment

- **Objective:** Implement deferred Phase 7 role expansion by seeding specialist roles (`accountant`, `hr_admin`, `hr_staff`) with reviewed permission bundles and providing a controlled assignment mechanism.
- **Boundaries / Out of Scope:** Do not introduce third-party identity providers or directory sync. Role assignment operates within `UserRoleDB`.
- **Dependencies / Decision Gates:** Requires Slice 2 completion so HR permissions exist. Requires owner review if permission allocations diverge from `01-implementation-plan.md`.
- **Main Affected Areas:** `be/core/rbac_seed.py`, `be/core/rbac_models.py`, `be/routers/auth.py`, `be/models_db.py`, `be/tests/test_rbac.py`, `fe/public/js/session.js`.
- **Acceptance Criteria:**
  1. `SEED_ROLES` in `be/core/rbac_seed.py` defines `accountant`, `hr_admin`, and `hr_staff` idempotently.
  2. `accountant` holds all `finance.*` permissions and zero `hr.*` permissions; `hr_admin` holds all `hr.*` permissions and zero `finance.*` permissions.
  3. `hr_staff` holds read on employees/vacations, write on requests, and zero write on salaries or employee deletion.
  4. An authorized admin endpoint allows assigning and revoking user roles with audit logging.
  5. Tests demonstrate separation of duties (e.g., `accountant` gets 403 on `/api/salary`, `hr_admin` gets 403 on `/api/finance/bills`).
- **Risks / Cautions:** Role reassignment must not orphan the administrator; enforce that at least one active user retains `system_admin`.
- **Recommended Output Artifact:** Backend PR with seed updates, user-role management endpoints, and unit tests.

---

### Slice 4 — Complete Employee Self-Service Payslips

- **Objective:** Deliver an employee self-service payslip viewing and download interface within the Employee Portal, connecting to backend payslip endpoints.
- **Boundaries / Out of Scope:** Do not alter the payroll calculation engine or modify historical `PayrollRunDB` records. Out-of-scope for email distribution or document signing.
- **Dependencies / Decision Gates:** Relies on payroll payslip generation verified in Slice 1. Must conform to `D-001` (estimates unless portal-confirmed) and enforce self-service data isolation.
- **Main Affected Areas:** `fe/src/partials/employee/sections/payslips.html`, `fe/public/js/finance-payroll.js` or `payslips.js`, `be/finance/routers/payroll.py`, `fe/tests/ui/finance-payroll-*.spec.js`.
- **Acceptance Criteria:**
  1. Authenticated employees can view their own approved/paid payroll lines (`GET /api/finance/payroll/lines/my-payslips`).
  2. Employees can download or preview generated payslip documents via authorized streaming endpoints (`GET /api/finance/payroll/lines/{id}/payslip`).
  3. Cross-employee access attempts return 403 Forbidden or 404 Not Found.
  4. UI handles empty states and download errors gracefully.
  5. Playwright UI tests validate listing, access restriction, and download actions under mock employee sessions.
- **Risks / Cautions:** Streaming must enforce session cookie validation and ownership checks; direct Drive IDs or storage paths must never be exposed.
- **Recommended Output Artifact:** Full-stack feature PR with updated HTML partial, client controller, and automated Playwright UI spec.

---

### Slice 5 — Documentation and Legacy Migration Cleanup

- **Objective:** Eliminate documentation drift, remove verified dead imports, and plan a deprecation strategy for dormant migration repositories without disrupting export features.
- **Boundaries / Out of Scope:** Do not retire Google Sheets export or revoke service account scopes until question `Q-005` is formally decided.
- **Dependencies / Decision Gates:** Requires question `Q-005` in [06-open-questions.md](06-open-questions.md) to be respected: separate documentation alignment from functional integration deletion.
- **Main Affected Areas:** `AGENTS.md`, `be/main.py` docstrings, `be/auth.py` (unused imports), `be/repositories/sheets/`, `be/repositories/dual/`.
- **Acceptance Criteria:**
  1. `AGENTS.md` and `be/main.py` docstrings reflect relational SQL persistence and clarify that Google Sheets is an export destination.
  2. Proven dead imports in `be/auth.py` (lines 21–22) are cleanly removed with zero regression in authentication tests.
  3. An architectural inventory records the status of each file in `be/repositories/sheets/` and `dual/`, proposing a deprecation path.
  4. All existing tests in `be/tests/` and `fe/tests/ui/` pass with zero failures.
- **Risks / Cautions:** Ensure utility code in `be/services/export.py` delegating to `sheets_client.py` for live exports is not broken during cleanup.
- **Recommended Output Artifact:** Documentation and code cleanup PR accompanied by a clean test execution report.

---

## 4. Deferred Until Decision

The following initiatives remain on hold until formally decided in [04-decision-log.md](04-decision-log.md):

| Open Question | Gated Architecture & Implementation Work | Status & Prerequisite |
| :--- | :--- | :--- |
| **Q-001** (Payroll Paid Funding Scope) | Redesigning `mark_paid()` accounting entries; bank balance deduction scope (net pay vs full employer cost); ledger accruals. | **Blocked** pending owner choice between Option A (net pay only) and Option B (full employer cost). |
| **Q-002** (Non-Payroll Statutory Creation) | Automated scheduling for recurring VAT and corporate tax obligations; background queue implementation. | **Blocked** pending owner choice between Option A (scheduled recurring) and Option B (manual entry). |
| **Q-003** (Production Document Storage) | S3-compatible storage adapter development; migration of Google Drive archives; storage credential redesign. | **Blocked** pending owner choice between Google Drive, S3-compatible storage, or dual driver. |
| **Q-004** (Automated FX-Rate Source) | External exchange-rate API integration; automated currency conversion pipelines in transfers and ledger. | **Blocked** pending owner choice between manual rate entry and automated market feeds. |
| **Q-005** (Sheets Export Retention) | Permanent deletion of `be/sheets_client.py`, removal of `gspread` dependency, and revocation of Sheets service scopes. | **Blocked** pending business stakeholder review of live spreadsheet export usage. |

---

## 5. Not Current Roadmap Items

The following areas are explicitly non-active for near-term planning:

- **Historical Pre-Database Proposals:** Proposals in `docs/roadmap/00` through `07` (e.g., legacy database migration plans, early UI scoring) are historical snapshots, not active commitments.
- **Completed Finance Stories:** Shipped epics in `docs/finance-module/` (FUX-406 through FUX-420, banking ledger, AP bills inbox) are historical acceptance baselines, not pending backlog tasks.
- **Branch-Specific Defects:** Transient UI layout quirks, localized test failures, or prototype scripts on feature branches (`feature/payroll-deductions`, `feature/payroll`) are branch concerns, not durable roadmap milestones.
- **Secondary Database Replacement:** Introducing alternative persistence mechanisms (e.g., NoSQL stores, document databases) is out of scope; relational SQL architecture is settled.

---

## 6. Recommended Immediate Next Action

Upon adoption of this roadmap, the recommended first operational step is to execute **Slice 1 (Complete and Validate Active Main-Line Payroll Scope)**:

1. Conduct a read-only code audit of `be/finance/routers/payroll.py`, `be/finance/services/payroll_service.py`, and `fe/public/js/finance-payroll.js` on `main`.
2. Reconcile current implementation status against accepted decisions `D-003` through `D-007`.
3. Deliver the capability matrix and gap assessment as `docs/project-context/payroll-scope-audit.md` before initiating Slice 2.

---

## 7. Related References

- [01-repository-baseline.md](01-repository-baseline.md) — Repository baseline audit and technical debt assessment.
- [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md) — Canonical modular monolith architecture and domain boundaries.
- [04-decision-log.md](04-decision-log.md) — Authoritative owner decision register (`D-001` through `D-007`).
- [06-open-questions.md](06-open-questions.md) — Register of unresolved product and architectural questions (`Q-001` through `Q-005`).
- [../finance-module/01-implementation-plan.md](../finance-module/01-implementation-plan.md) — Historical phased delivery plan for the Finance domain.
