# HRFlow Roadmap and Next Slices

**Status:** Draft — planning baseline  
**Last verified against:** `feature/rbac` after the review-fix run (October 3, 2026); `main` is at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e`  
**Last updated:** October 3, 2026  
**Branch note:** Sections 3A and 4A were added on `feature/rbac` (accepted by the owner on October 1, 2026); that branch is now merged into `main` (verified October 24, 2026).  
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

- **Relational SQL Foundation:** SQL migration via SQLAlchemy and Alembic is complete (Alembic head on `main` is `0043_employee_personal_details`, verified October 24, 2026). Google Sheets is an export destination only.
- **Core Platform Monolith:** Core HR and foundational Finance modules (Accounts, Ledger, Bills, Invoices, Cheques, Statements, Reconciliation) are functional.
- **Authorization:** RBAC (section 3A) is merged into `main`. No `require_admin` guard remains in `be/routers/` (searched October 24, 2026); route-guard coverage was last audited on October 3, 2026.
- **Specialist Roles:** the five-role model of D-011 is implemented and merged (section 3A) and replaces the Phase 7 plan.
- **Incomplete Payslip UI:** the backend endpoint `GET /api/finance/payroll/payslips/my` exists, but the employee self-service view (`fe/src/partials/employee/sections/payslips.html`) is a "Payslips are coming soon" placeholder (verified October 24, 2026). The earlier undefined `refreshMyPayslips()` call is no longer in the frontend.
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

- **Status (October 3, 2026; branch since merged to `main`):** slices R1–R8 and the review-fix slices F0–F7 were implemented on `feature/rbac` and logged in [rbac/run-log.md](rbac/run-log.md); the review fixes are specified in [rbac/review-fix-handoff.md](rbac/review-fix-handoff.md). Listed as remaining before merge or deployment (whether they were completed is not recorded in the repository as of October 24, 2026): the pre-migration data check on a copy of the production database (G3), PostgreSQL runs of migrations `0024`–`0027`, an owner decision on the older integer Boolean `server_default` literals (`0005`, `0018`, `0021`), and owner review of the branch. Q-006 (restore of archived users) stays open; restore is not built.
- **Gates:** Q-010 and Q-013 are resolved (D-011). Q-006 to Q-009, Q-011 and Q-012 carry approved interim treatments in the register.
- **Caution:** Do not assign HR-Admin, Financial-Admin or Payroll-Maker to real users until the data check and the PostgreSQL migration runs are done.
- **Note:** The slice labels R0–R8 in this section correspond to slices 0–8 in the implementation plan.

---

## 3B. Vendor Bill Workflow v2 (accepted October 8, 2026)

Plan: [../finance-module/18-bill-workflow-v2.md](../finance-module/18-bill-workflow-v2.md). Decisions D-016 to D-020. B1 to B6 implemented on `feature/bills-b1-status-model`.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| B1 | Eight-status model, transition table, data migration, void fix (**done**: `feature/bills-b1-status-model`, draft PR) | M | — |
| B2 | Approval rules, `finance.bill.approve` / `finance.bill.pay` (**done**: `feature/bills-b1-status-model`) | M | B1 |
| B3 | Payment fields, same-currency and balance checks, one-transaction create-and-pay (**done**: `feature/bills-b1-status-model`) | M | B2 |
| B4 | Drafts, PDF and multi-file upload into Draft, discard, Miscellaneous vendor, bill auto-numbering | M | B1 |
| B5 | Bill screens behaviour in the current visual style (**done**: `feature/bills-b1-status-model`) | L | B2, B3, B4 |
| B6 | Banking rules: same-currency entries and withdrawals, cheque reversals, spend as bills (D-020) (**done**: `feature/bills-b1-status-model`) | M | B3 |
| Later | Balance check for other outflows | S | B3 |
| Later | Bill screens visual restyle, direction A (D-021; implemented and merged to `main` from branch feature/finance-ui-restyle-a: [19](../finance-module/19-finance-ui-restyle-direction-a.md)) | — | B5 |
| Later | Bulk and historical import: see section 3F (D-033). Then in-app AI assistant | — | B4 |

Prerequisite before B3 reaches production: run the cashbook 2026 import so account balances are accurate.

---

## 3C. Finance Review Round 2 (accepted October 10, 2026)

Plan: [../finance-module/20-finance-review-round-2.md](../finance-module/20-finance-review-round-2.md). Decisions D-022 to D-026. **F1 to F6 implemented** (`feature/fin-f1-invoice-rules`, one draft PR into `main`).

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| F1 | Sales invoice statuses, locks, void rule, same-currency receipts (D-022). **Done, in review** | M | — |
| F2 | VAT on sales invoices, on-demand monthly VAT estimate (D-023). **Done** | M | F1 |
| F3 | Customer withholding tax at invoice preparation (D-024). **Done** | S | F2 |
| F4 | Statutory: EGP default, same-currency payments (D-022). **Done** | S | — |
| F5 | Payroll paid = net only; payroll posting fixes (D-025, resolves Q-001). **Done** | M | — |
| F6 | Cash-basis P&L fixed; per-currency columns; accrual labelled partial (D-026). **Done** | M | F1, F5 |
| Later | Complete accrual P&L; VAT on bills | — | F6 |

## 3D. Finance UI Restyle v2 (accepted October 10, 2026)

Plans: [../finance-module/21-finance-ui-restyle-v2.md](../finance-module/21-finance-ui-restyle-v2.md) (UI, branch `feature/finance-ui-restyle-v2`) and [../finance-module/22-finance-restyle-v2-backend.md](../finance-module/22-finance-restyle-v2-backend.md) (backend, branch `feature/finance-restyle-v2-backend`). Decision D-027. The two run in parallel; the UI feature-detects the backend fields.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| S0 | Intake, baseline, code map (UI). **Done** | S | — |
| S1 | Tokens, `finance-v2.css`, helpers, top bar, button sizes. **Done** | M | S0 |
| S2 | Bills, Vendors, bill dialogs. **Done** | M | S1 |
| S3 | Subscriptions, Statutory, their dialogs. **Done** | M | S1 |
| S4 | Sales invoices, Customers, 360 drawer, invoice and receipt dialogs. **Done** | M | S1 |
| S5 | Accounts, Ledger, transaction and account dialogs. **Done** | M | S1 |
| S6 | Transfers, Cheques, Statements, reconciliation, their dialogs. **Done** | L | S1 |
| S7 | Overview. **Done** | M | S1 |
| S8 | Reports, Settings. **Done** | M | S1 |
| S9 | Drawers and remaining dialogs, dark pass, cleanup, docs. **Done** | M | S2–S8 |
| BE-1 | Category colour field and migration | S | — |
| BE-2 | Customer receivables on the list | S | — |
| BE-3 | Vendor payables on the list | S | — |

---

## 3E. Finance Expansion: Overseas Book, Products, Revenue Sources, Subscriptions v2, Cheque Scans (accepted October 18, 2026)

Plan: [../finance-module/23-finance-expansion-plan.md](../finance-module/23-finance-expansion-plan.md). Decisions D-028 to D-032.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| X1 | **Done** (migration 0036): cheque scans (attachments) and entry shortcuts | S | — |
| X2 | **Done** (migration 0038): books, account visibility, balance checkpoints, inter-book transfers, view switcher | L | — |
| X3 | **Done** (migration 0037): product catalog, `product_id` on invoice lines | S | — |
| X4 | **Done** (migration 0039): revenue receipts by source, invoice book, revenue reports by book/product/source | M | X2, X3 |
| X5 | **Done** (migration 0040): subscriptions v2: expected charges, settle, proof tracking, in-app reminders | M | X2 |
| X6 | **Done** (no migration): analytics pass and Excel exports | M | X2–X5 |

---

## 3F. Bulk and Historical Import (accepted October 20, 2026)

Plan: [../finance-module/25-bulk-historical-import-plan.md](../finance-module/25-bulk-historical-import-plan.md). Handoff: [../finance-module/26-bulk-import-claude-code-handoff.md](../finance-module/26-bulk-import-claude-code-handoff.md). Decision D-033, Q-021 resolved. Branch `feature/bulk-import`. Imports create Drafts only (no ledger rows). Option B (link to existing ledger transactions) is a possible future slice; there is no I5.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| I0 | **Done** (migration 0041): import engine: manifest parser, file and ZIP safety, batch table + migration, router skeleton, per-kind permissions | M | — |
| I1 | **Done**: bills importer (dry run + commit), `capture_source = import`, extractor cross-check warning | M | I0 |
| I2 | **Done**: Import screen, template downloads, mock handlers, Playwright | M | I1 |
| I3 | **Done**: cheques importer (draft cheques with scan) | S | I0 |
| I4 | **Done** (migration 0042): sales invoices importer (+ invoice scan storage if missing) | S | I0 |
| I2b | Optional offline pre-check CLI reusing the I0 module | S | I0 |

---

## 3G. Pay Plan Sync and Pay Plan Modal (accepted October 21, 2026)

Plan: [../finance-module/27-pay-plan-sync-and-modal-plan.md](../finance-module/27-pay-plan-sync-and-modal-plan.md). Handoff: [../finance-module/28-pay-plan-claude-code-handoff.md](../finance-module/28-pay-plan-claude-code-handoff.md). Decision D-034, related Q-008 (still Open). Branch `feature/pay-plan-sync`. No migration.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| P1 | **Done** (October 21, 2026): `apply_pay_change` service (zero closes, one transaction), raise syncs the plan, employee update skips unchanged pay, regression tests | M | — |
| P2 | **Done** (October 21, 2026): atomic `PUT /compensation-plan`, single-form Pay plan modal, mock mode, Playwright | M | P1 |
| P3 | **Done** (October 21, 2026): "Pay effective from" on create modal, read-only pay + "Edit pay plan" on edit modal | S | P2 |

## 3H. File-Storage Root and Folder Layout (accepted October 21, 2026)

Plan: [../file-storage/26-file-storage-layout-plan.md](../file-storage/26-file-storage-layout-plan.md). Handoff: [../file-storage/27-agent-handoff.md](../file-storage/27-agent-handoff.md). Decision D-035, related Q-003. Branch `feature/file-storage-layout`. No migration.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| F0 | **Done** (October 21, 2026): Plan and handoff committed to repository | S | — |
| F1 | **Done** (October 21, 2026): `be/file_layout.py` module (unified call-time root, slug/length rules, path traversal/symlink guards, legacy fallback, `_meta/layout.json`) | M | F0 |
| F2 | **Done** (October 21, 2026): Finance writers use `file_layout` (bills, cheques, invoices, statements, subscription proofs, ledger attachments, checkpoints) | M | F1 |
| F3 | **Done** (October 21, 2026): HR writers use `file_layout` via `LocalStorageClient` (salary payment docs, employee docs, company docs; Drive backend untouched) | M | F1 |
| F4 | **Done** (October 21, 2026): `scripts/migrate_file_layout.py` (dry-run default, copy -> SHA-256 verify -> DB update -> delete old, idempotent, CSV report, orphan scan) | M | F2, F3 |
| F5 | **Done** (October 21, 2026): Prod config (`docker-compose.yml`, `prod.env.example`, `RUNBOOK.md` "Moving the files root", backend-only) | S | F4 |
| F6 | **Done** (October 21, 2026): Additive one-way clone of `<ROOT>` to Google Drive (`deploy/prod/scripts/backup-files-clone.ps1`) | S | F5 |

---

## 3I. Employee Pay Analytics (D-037 accepted October 24, 2026; review fixes pending)

Decisions D-037 (accepted), related Q-022 (Open). Backend merged to `main` (PR #48). Frontend merged to `main` (PR #49, `fbd3456`). Review fixes on branch `fix/pay-analytics-plan-order` (not merged). No migration.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| BE-0 | **Done** (October 23, 2026): Verification test asserting payroll line persistence for adjustments (commission & bonus stored in `base_salary`) | S | — |
| BE-1 | **Done** (October 23, 2026): Extracted `PayrollReadService.get_employee_pay_lines` while preserving byte-identical compensation report output | S | BE-0 |
| BE-2 | **Done** (October 23, 2026): Read-only composer package `be/analytics/`, `require_any_permission` guard, and pay view endpoint | M | BE-1 |
| BE-3 | **Done** (October 23, 2026): Excel/CSV exporters with formula injection neutralization and HR audit logging | M | BE-2 |
| BE-4 | **Done** (October 23, 2026): Documentation updates (D-037 draft, Q-022, roadmap slice 3I) | S | BE-3 |
| FE-1 | **Done, merged** (PR #49): employee detail Overview and Pay analytics tab shell | S | — |
| FE-2 | **Done, merged** (PR #49): analytics API client and permission-aware mock fixtures | S | BE-2 |
| FE-3 | **Done, merged** (PR #49): summary, stacked chart with raise markers, plan history | M | FE-2 |
| FE-4 | **Done, merged** (PR #49): monthly breakdown table and export menu | M | FE-3 |
| FE-5 | Polish, dark mode, copy review, docs: merged in part (PR #49); review fixes FE-6 below | S | FE-4 |
| FE-6 | Review fixes: sort `plan.changes` ascending (backend returns newest first), guard null effective date, HR-only "See raise history" link and detailed tooltips, regression tests. **In progress with Claude Code, not merged** | S | FE-4 |

## 3J. HR Access to Compensation Plans (accepted October 24, 2026; not started)

Decision D-038 (resolves Q-008). Needs its own approval and a branch before work starts. No migration, no new permission key.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| HP-1 | Backend: plan write routes accept `finance.payroll.prepare` or `hr.salary.write`; plan read routes accept `finance.payroll.read` or `hr.salary.read` (reuse `require_any_permission`). **Not started** | S | — |
| HP-2 | Frontend: gate the Pay plan modal and its entry points by the same either-or rule. **Not started** | S | HP-1 |
| HP-3 | Tests and docs. **Not started** | S | HP-1 |

Acceptance criteria: (1) HR-Admin can read and save a compensation plan and sees the Pay plan modal; (2) Payroll-Maker and Financial-Admin behave as before; (3) Super-Admin unchanged; (4) a user with neither key gets 403 on every plan route; (5) the router permission matrix and the route-guard inventory test pass; (6) no change to plan calculation, `salary_history` or raise behaviour (D-034, D-036).

---

## 3K. Payroll Cutover Prerequisites (D-040, October 25, 2026; not started)

Handoff for Claude Code written October 25, 2026 (Project: `claude/claude-code-handoff-payroll-cutover-prerequisites.md`; order A FT-1, B FX-1, C SI-1, D FY-1; FT-1 branch `feat/employee-tax-method`). Each slice needs its own approval and a branch from updated `main`. The cutover guide (Project: `claude/hrflow-historical-data-cutover-guide-2026-10-25.md`) is the operating procedure and is a draft.

| Slice | Scope | Size | Depends on |
| :--- | :--- | :--- | :--- |
| FT-1 | **Required before the 2025-2026 runs.** Employee-level tax method setting with dated history, like the insured base (`progressive` by default when no row exists, or `flat` with the rate stored on the row; 10% of gross incl. bonus and commission, no exemption, remitted with payroll tax on its own line; social insurance stays its own separate setting): table and migration, calculation incl. net-to-gross, line snapshot, employee form, tax payable totals and exports, tests. **Built on `feat/employee-tax-method` (backend and frontend), awaiting review and merge** | M | — |
| FX-1 | Refuse or warn when a run would use the silent 50.0 fallback rate. Optional, recommended. **Not started** | S | — |
| SI-1 | Effective-dated social insurance rates (Q-023). Needed only if the rate changes inside 2025-2026. **Not started** | S-M | Q-023 |
| FY-1 | Fiscal year reporting: start-month setting (January default), year selector, yearly summary per account and per category (opening, in, out, spend, closing). No year lock. **Discovery note written (`docs/finance-module/fiscal-year-reporting-discovery.md`), awaiting owner approval** | S-M | — |
| LJ-1 | Hire and leave dates used by the run generator, or an exclude-employee action that survives refresh. Optional. **Not started** | M | — |

Acceptance criteria (FT-1): (1) an employee with flat 10% shows 10% tax and zero social insurance in preview and in the generated line; (2) bonus and commission are included in the taxed amount; (3) net-basis salary solves gross as net / 0.90; (4) the method has dated history per employee (a new row starts after the current one, the previous row is closed the day before) and a change dated in or before a finalized period is rejected; an employee can move from flat to progressive and the run for each period uses the row in force; (5) progressive-tax employees are unchanged; (6) the tax payable totals show the flat-tax amount on its own line.

---

## 4. Deferred Until Decision

The following initiatives remain on hold until formally decided in [04-decision-log.md](04-decision-log.md):

| Open Question | Gated Architecture & Implementation Work | Status & Prerequisite |
| :--- | :--- | :--- |
| **Q-001** (Payroll Paid Funding Scope) | Redesigning `mark_paid()` accounting entries; bank balance deduction scope (net pay vs full employer cost); ledger accruals. | **Resolved** by D-025 (October 10, 2026): net pay only; delivered in slice F5 (section 3C). |
| **Q-002** (Annual Corporate Income Tax obligation) | Automated scheduling for the recurring corporate income-tax obligation; background queue implementation. VAT is resolved (D-023: on-demand estimates). | **Blocked** pending owner choice between Option A (scheduled recurring) and Option B (manual entry). |
| **Q-003** (Production Document Storage) | S3-compatible storage adapter development; migration of Google Drive archives; storage credential redesign. | **Deferred** (local scope resolved by D-035, October 21, 2026): local unified files root `HRFLOW_FILES_ROOT` with relative POSIX paths; Drive is an additive backup clone. Cloud object storage deferred until multi-host deployment. |
| **Q-004** (Automated FX-Rate Source) | External exchange-rate API integration; automated currency conversion pipelines in transfers and ledger. | **Blocked** pending owner choice between manual rate entry and automated market feeds. |
| **Q-006** (Restoring Archived Users) | Restore flow for archived users; email reuse for returning people. | **Open** — restore is not built until decided. |
| **Q-005** (Sheets Export Retention) | Permanent deletion of `be/sheets_client.py`, removal of `gspread` dependency, and revocation of Sheets service scopes. | **Blocked** pending business stakeholder review of live spreadsheet export usage. |
| **Central Analytics Area** | Company-wide cross-domain analytics dashboard and aggregated reporting. | **Deferred** until employee-level pay analytics slice is reviewed and accepted. |

---

## 4A. Future Intake (not scheduled)

- **Archived employees:** an Archived state for employees (history kept, access never restored), recorded as a note in [rbac/archived-employees-future-intake.md](rbac/archived-employees-future-intake.md). Design deferred until the RBAC initiative lands.

---

## 4B. Planned and Not Implemented Register

**Purpose:** one place to see what is planned, deferred or unfinished. It points to the authoritative entry and does not replace it. **Last reviewed:** October 24, 2026 against `main` at `fbd3456`. Update a row's status when the work ships or the decision changes.

### Active, in flight or ready

| Item | Status | Source / gate |
| :--- | :--- | :--- |
| Employee Pay Analytics review fixes (FE-6) | In progress with Claude Code on `fix/pay-analytics-plan-order`; real-backend smoke test still to be done | Section 3I; handoff `claude-code-handoff-pay-analytics-fix-and-hr-plan-access.md` |
| Q-022: typing and amount field of imported historical payroll lines | Open (owner) | `06`; gates historical payroll import |
| HR access to compensation plans (HP-1 to HP-3) | Accepted, not started | Section 3J, D-038 |
| Payroll cutover prerequisites: flat 10% tax method (FT-1, required before 2025-2026 runs), fiscal year reporting (FY-1), FX fallback warning (FX-1), effective-dated social insurance rate (SI-1) | Accepted; FT-1 built on branch `feat/employee-tax-method` (awaiting merge), FX-1, SI-1, FY-1 not started | Section 3K, D-040, Q-023 |
| Payroll-Maker run-creation screen check (403 on account list) | Not done | D-039, Q-007 |

### Planned earlier, not done

| Item | Status | Source / gate |
| :--- | :--- | :--- |
| Payroll scope audit for D-003 to D-007 (`payroll-scope-audit.md`) | Not produced | Slice 1 |
| Employee self-service payslips (page is a "coming soon" placeholder; `GET /payslips/my` exists) | Not done | Slice 4 |
| Documentation and legacy cleanup (dormant `repositories/sheets/`, `dual/`; `compute_consumption` must move before `sheets/insurance.py` goes) | Not done | Slice 5; the Sheets retirement part is gated by Q-005 |
| RBAC leftovers: pre-migration data check on a production copy (G3), PostgreSQL runs of migrations 0024 to 0027, decision on old integer Boolean defaults (0005, 0018, 0021) | Completion not recorded in the repository | Section 3A |
| Historical payroll import (bulk import covers bills, cheques and sales invoices only); 2023-2024 payroll history deferred | Not built; deferred | D-033, D-040, Q-022 |
| Central Analytics rail (board A4) | Deferred; no plan written | Section 4 |
| Re-verify bodies of `00`, `01`, `02`; describe `be/analytics/` in `02` | Not done | Status notes added October 24, 2026 |

### Deferred by decision or open question

| Item | Status | Source / gate |
| :--- | :--- | :--- |
| Scheduler and email reminders | Deferred ("future standalone feature") | D-031 |
| Scheduled VAT and annual corporate income tax obligations | Open (corporate income tax part) | Q-002 |
| Automated FX-rate feed | Open | Q-004 |
| Retire Google Sheets export, `gspread`, service scopes | Open | Q-005 |
| Restore of archived users | Open; not built | Q-006 |
| Archived state for employees | Not scheduled | Section 4A |
| Cloud object storage | Deferred until multi-host hosting | Q-003, D-035 |
| Stripe payout matching | Deferred; no Stripe account | D-029 |
| Complete accrual P&L; VAT on bills | Later | Section 3C |
| Balance check for other outflows | Later | Section 3B |
| Import option B (link to existing ledger transaction); offline pre-check CLI (I2b) | Later / optional | Section 3F |
| In-app AI assistant | Later | Section 3B |

### Housekeeping awaiting the owner

| Item | Status |
| :--- | :--- |
| Reword Q-002, mark Q-003 Deferred, archive resolved questions in `06` | Done October 24, 2026 (uncommitted in the local folder; commits with the next dev branch) |
| Three unmerged old branches (`google-signin-fix-and-config-isolation`, `salary-advanced`, `fix/finance-ui-styling`) and about 55 fully merged remote branches | Not reviewed or pruned |
| `fe/finance-api.js` uncommitted diff (8,499 lines in and out, probably line endings) in the local folder | Not investigated |

---

## 5. Not Current Roadmap Items

The following areas are explicitly non-active for near-term planning:

- **Historical Pre-Database Proposals:** Proposals in `docs/roadmap/00` through `07` (e.g., legacy database migration plans, early UI scoring) are historical snapshots, not active commitments.
- **Completed Finance Stories:** Shipped epics in `docs/finance-module/` (FUX-406 through FUX-420, banking ledger, AP bills inbox) are historical acceptance baselines, not pending backlog tasks.
- **Branch-Specific Defects:** Transient UI layout quirks, localized test failures, or prototype scripts on feature branches (`feature/payroll-deductions`, `feature/payroll`) are branch concerns, not durable roadmap milestones.
- **Secondary Database Replacement:** Introducing alternative persistence mechanisms (e.g., NoSQL stores, document databases) is out of scope; relational SQL architecture is settled.

---

## 6. Recommended Immediate Next Action

> **Stale (flagged October 24, 2026):** the RBAC merge below has happened. The owner sets the current next action; the paragraph is kept as history until then.

Run the read-only pre-migration data check on a **copy** of the production database (users without a linked employee and without roles, duplicate emails) and the RBAC migrations (`0024`–`0027`) on PostgreSQL, then review and merge `feature/rbac` (see [rbac/run-log.md](rbac/run-log.md) for the final report). The payroll scope audit (Slice 1) remains available as a parallel read-only task.

---

## 7. Related References

- [01-repository-baseline.md](01-repository-baseline.md) — Repository baseline audit and technical debt assessment.
- [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md) — Canonical modular monolith architecture and domain boundaries.
- [04-decision-log.md](04-decision-log.md) — Authoritative owner decision register (`D-001` through `D-037`).
- [06-open-questions.md](06-open-questions.md) — Register of unresolved product and architectural questions (`Q-001` through `Q-022`).
- [rbac/implementation-plan.md](rbac/implementation-plan.md) — Accepted RBAC delivery plan (October 1, 2026).
- [../finance-module/01-implementation-plan.md](../finance-module/01-implementation-plan.md) — Historical phased delivery plan for the Finance domain.
