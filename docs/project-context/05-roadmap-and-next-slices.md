# HRFlow Roadmap and Next Slices

**Status:** Draft — planning baseline  
**Last verified against:** `feature/rbac` after the review-fix run (October 3, 2026); `main` is at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e`  
**Last updated:** October 3, 2026  
**Branch note:** Sections 3A and 4A were added on `feature/rbac` (accepted by the owner on October 1, 2026); the RBAC work they describe is implemented on that branch and is not part of `main` until the branch is merged.  
**Authority:** Main-branch repository evidence and project-context documents  

---

## 1. Planning Rules

This roadmap defines a sequenced series of delivery slices for HRFlow:

- **Sequencing Guide:** Slices define delivery order, not proof that a capability is already implemented or approved.
- **Code Authority:** The code, active migrations, and passing tests of the branch under work (`main` unless a task says otherwise) are the ground truth. Feature-branch work is not assumed present on `main` without verification.
- **Incremental & Reversible:** Slices must be independently reviewable, testable, and reversible where practical.
- **Decision Gating:** Where a slice depends on an unresolved question in [06-open-questions.md](06-open-questions.md), implementation pauses until formally decided in [04-decision-log.md](04-decision-log.md).
- **Historical Material as Reference:** Completed plans in `docs/finance-module/` or `docs/roadmap/` provide historical acceptance context, not the active roadmap.

---

## 2. Current Delivery Position

Verified main-branch evidence establishes the delivery position:

- **Relational SQL Foundation:** SQL migration via SQLAlchemy and Alembic is complete (23 migrations up to `0023_payroll_income_tax_settings.py` on `main`; 27 up to `0027_single_assigned_role` on `feature/rbac`). Google Sheets is an export destination only.
- **Core Platform Monolith:** Core HR and foundational Finance modules (Accounts, Ledger, Bills, Invoices, Cheques, Statements, Reconciliation) are functional.
- **Authorization:** on `main`, finance is gated by fine-grained RBAC except three routes, while HR still uses legacy `require_admin`. On `feature/rbac` every route is guarded by a catalog permission (section 3A); this is closed once the branch is merged.
- **Specialist Roles:** on `main` only `system_admin` and `employee` are seeded. On `feature/rbac` the five-role model of D-011 is implemented (section 3A) and replaces the Phase 7 plan.
- **Incomplete Payslip UI:** Backend payslip endpoints exist, but the employee self-service view (`fe/src/partials/employee/sections/payslips.html`) calls `refreshMyPayslips()`, which is not defined.
- **Legacy Code & Drift:** Dormant repositories (`be/repositories/sheets/`, `dual/`) remain (`routers/insurance.py` still imports from `sheets/insurance.py`), and the `be/main.py` docstring still describes Google Sheets as a database (`AGENTS.md` was corrected on October 1, 2026).
- **Synchronous Constraint:** High-latency tasks (PDF OCR parsing, statement imports, Excel exports) run synchronously in request threads; no background queue exists.
- **Branch Work Isolation:** Feature-branch enhancements (payroll runner iterations, deduction prototypes) are not part of `main` until explicitly reconciled.

---

## 3. Recommended Delivery Sequence

### Slice 1 — Complete and Validate Active Main-Line Payroll Scope

- **Objective:** Audit payroll capabilities currently on `main`, reconcile accepted decisions `D-003` through `D-007` against active code/tests, and establish a validated delivery baseline.
- **Note (October 1, 2026):** D-006 was observed implemented in code (warning-severity `MISSING_BANK_DETAILS`); the audit is still pending for D-003, D-004, D-005, D-007.
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

> **Superseded (October 1, 2026):** replaced by the accepted RBAC Initiative in section 3A (D-011 to D-013). Do not start this slice as written.

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

> **Superseded (October 1, 2026):** replaced by the accepted RBAC Initiative in section 3A (D-011 to D-013). Do not start this slice as written.

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
  1. Authenticated employees can view their own approved/paid payroll lines (`GET /api/finance/payroll/payslips/my`).
  2. Employees can download or preview generated payslip documents via authorized streaming endpoints (`GET /api/finance/payroll/runs/{run_id}/payslips/{employee_id}`).
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
- **Main Affected Areas:** `be/main.py` docstrings, `be/auth.py` (unused imports), `be/repositories/sheets/`, `be/repositories/dual/`.
- **Acceptance Criteria:**
  1. `be/main.py` docstring and API description reflect relational SQL persistence and clarify that Google Sheets is an export destination (`AGENTS.md` already corrected on October 1, 2026).
  2. Proven dead imports in `be/auth.py` (lines 21–22) are cleanly removed with zero regression in authentication tests.
  3. An architectural inventory records the status of each file in `be/repositories/sheets/` and `dual/`, proposing a deprecation path; `compute_consumption` (used by `routers/insurance.py`) must be relocated before `sheets/insurance.py` can be removed.
  4. All existing tests in `be/tests/` and `fe/tests/ui/` pass with zero failures.
- **Risks / Cautions:** Ensure utility code in `be/services/export.py` delegating to `sheets_client.py` for live exports is not broken during cleanup.
- **Recommended Output Artifact:** Documentation and code cleanup PR accompanied by a clean test execution report.

---

## 3A. RBAC Initiative (feature/rbac — accepted October 1, 2026)

Replaces Slices 2 and 3 above with a permission-based RBAC (decisions D-011 to D-013, accepted). Full detail: [rbac/technical-spec.md](rbac/technical-spec.md), [rbac/implementation-plan.md](rbac/implementation-plan.md), [rbac/permission-matrix.md](rbac/permission-matrix.md). Slices are small and independently reviewable.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| R0 | Documentation: decisions, questions, roadmap | S | — |
| R1 | Catalog, seeded roles, schema, startup-seeding fix | M | Gate G3 |
| R2 | Resolution, session and scope helpers | L | R1 |
| R3 | HR guards and self-service keys | L | R2 |
| R4 | Finance guards and payroll prepare/approve/pay split | M | R2, G5 |
| R5 | Access service, users/roles API, employee lifecycle | L | R2 |
| R6 | Sign-in policy (any Google domain) | S | R5 |
| R7a | Frontend session, navigation, control gating | M | R2, R4 |
| R7b | Frontend Roles and Users pages | L | R5, R7a |
| R8 | Cleanup and documentation | M | all |

- **Status (October 3, 2026):** slices R1–R8 and the review-fix slices F0–F7 are implemented on `feature/rbac` and logged in [rbac/run-log.md](rbac/run-log.md); the review fixes are specified in [rbac/review-fix-handoff.md](rbac/review-fix-handoff.md). Remaining before merge or deployment: the pre-migration data check on a copy of the production database (G3), PostgreSQL runs of migrations `0024`–`0027`, an owner decision on the older integer Boolean `server_default` literals (`0005`, `0018`, `0021`), and owner review of the branch. Q-006 (restore of archived users) stays open; restore is not built.
- **Gates:** Q-010 and Q-013 are resolved (D-011). Q-006 to Q-009, Q-011 and Q-012 carry approved interim treatments in the register.
- **Caution:** Do not assign HR-Admin, Financial-Admin or Payroll-Maker to real users until the data check and the PostgreSQL migration runs are done.
- **Note:** The slice labels R0–R8 in this section correspond to slices 0–8 in the implementation plan.

---

## 3B. Vendor Bill Workflow v2 (accepted October 8, 2026)

Plan: [../finance-module/18-bill-workflow-v2.md](../finance-module/18-bill-workflow-v2.md). Decisions D-016 to D-019. Not started.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| B1 | Eight-status model, transition table, data migration, void fix | M | — |
| B2 | Approval rules, `finance.bill.approve` / `finance.bill.pay` | M | B1 |
| B3 | Payment fields, same-currency and balance checks, one-transaction create-and-pay | M | B2 |
| B4 | Drafts, PDF and multi-file upload into Draft, discard | M | B1 |
| B5 | Bill screens behaviour in the current visual style | L | B2, B3, B4 |
| Later | Balance check for other outflows | S | B3 |
| Later | Bill screens visual restyle (separate plan, visual approval first) | — | B5 |
| Later | Bulk and historical bill import; then in-app AI assistant | — | B4 |

Prerequisite before B3 reaches production: run the cashbook 2026 import so account balances are accurate.

---

## 4. Deferred Until Decision

The following initiatives remain on hold until formally decided in [04-decision-log.md](04-decision-log.md):

| Open Question | Gated Architecture & Implementation Work | Status & Prerequisite |
| :--- | :--- | :--- |
| **Q-001** (Payroll Paid Funding Scope) | Redesigning `mark_paid()` accounting entries; bank balance deduction scope (net pay vs full employer cost); ledger accruals. | **Blocked** pending owner choice between Option A (net pay only) and Option B (full employer cost). |
| **Q-002** (Non-Payroll Statutory Creation) | Automated scheduling for recurring VAT and corporate tax obligations; background queue implementation. | **Blocked** pending owner choice between Option A (scheduled recurring) and Option B (manual entry). |
| **Q-003** (Production Document Storage) | S3-compatible storage adapter development; migration of Google Drive archives; storage credential redesign. | **Blocked** pending owner choice between Google Drive, S3-compatible storage, or dual driver. |
| **Q-004** (Automated FX-Rate Source) | External exchange-rate API integration; automated currency conversion pipelines in transfers and ledger. | **Blocked** pending owner choice between manual rate entry and automated market feeds. |
| **Q-006** (Restoring Archived Users) | Restore flow for archived users; email reuse for returning people. | **Open** — restore is not built until decided. |
| **Q-005** (Sheets Export Retention) | Permanent deletion of `be/sheets_client.py`, removal of `gspread` dependency, and revocation of Sheets service scopes. | **Blocked** pending business stakeholder review of live spreadsheet export usage. |

---

## 4A. Future Intake (not scheduled)

- **Archived employees:** an Archived state for employees (history kept, access never restored), recorded as a note in [rbac/archived-employees-future-intake.md](rbac/archived-employees-future-intake.md). Design deferred until the RBAC initiative lands.

---

## 5. Not Current Roadmap Items

The following areas are explicitly non-active for near-term planning:

- **Historical Pre-Database Proposals:** Proposals in `docs/roadmap/00` through `07` (e.g., legacy database migration plans, early UI scoring) are historical snapshots, not active commitments.
- **Completed Finance Stories:** Shipped epics in `docs/finance-module/` (FUX-406 through FUX-420, banking ledger, AP bills inbox) are historical acceptance baselines, not pending backlog tasks.
- **Branch-Specific Defects:** Transient UI layout quirks, localized test failures, or prototype scripts on feature branches (`feature/payroll-deductions`, `feature/payroll`) are branch concerns, not durable roadmap milestones.
- **Secondary Database Replacement:** Introducing alternative persistence mechanisms (e.g., NoSQL stores, document databases) is out of scope; relational SQL architecture is settled.

---

## 6. Recommended Immediate Next Action

Run the read-only pre-migration data check on a **copy** of the production database (users without a linked employee and without roles, duplicate emails) and the RBAC migrations (`0024`–`0027`) on PostgreSQL, then review and merge `feature/rbac` (see [rbac/run-log.md](rbac/run-log.md) for the final report). The payroll scope audit (Slice 1) remains available as a parallel read-only task.

---

## 7. Related References

- [01-repository-baseline.md](01-repository-baseline.md) — Repository baseline audit and technical debt assessment.
- [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md) — Canonical modular monolith architecture and domain boundaries.
- [04-decision-log.md](04-decision-log.md) — Authoritative owner decision register (`D-001` through `D-013`).
- [06-open-questions.md](06-open-questions.md) — Register of unresolved product and architectural questions (`Q-001` through `Q-012`).
- [rbac/implementation-plan.md](rbac/implementation-plan.md) — Accepted RBAC delivery plan (October 1, 2026).
- [../finance-module/01-implementation-plan.md](../finance-module/01-implementation-plan.md) — Historical phased delivery plan for the Finance domain.
