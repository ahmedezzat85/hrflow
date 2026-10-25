# HRFlow Decision Log

**Status:** Draft — needs owner review  
**Last verified against:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main`)  
**Last updated:** October 18, 2026  
**Branch note:** D-011 to D-013 and the D-008/D-009/D-010 amendments were added on `feature/rbac` (base `c236b00`) and accepted by the owner on October 1, 2026. They are not part of `main` until the branch is merged. The bullet tagged **[Pending owner OK]** (startup seeding) was found during the October 1, 2026 code reconciliation, after that approval, and is not yet accepted.  
**Authority:** Owner-approved decisions, reconciled against repository context documents  

---

## How to Use This Log

This document records durable product and architectural decisions approved by the repository owner to guide future implementation and planning:

- **Scope:** Captures durable accounting, policy, and workflow decisions; does not replicate detailed schemas, API catalogs, or bug fixes.
- **Operational Reality vs. Intent:** Active code, migrations, and automated tests on `main` remain the operational source of truth. An accepted decision records approved product intent, not proof that the feature is fully implemented in the current codebase.
- **Status Lifecycle:** Entries are marked `Accepted` (active policy), `Superseded` (replaced by a newer decision), or `Needs review` (requires owner re-confirmation).
- **Maintenance:** Append new decisions sequentially using IDs starting at `D-001`. Do not overwrite historical entries; document changes by citing what they supersede.

---

## Decisions

### D-001 — Payroll Statutory-Calculation Boundary
- **Status:** Accepted  
- **Decision:**
  - HRFlow is a net-payment preparation and payroll-execution workflow, not an authoritative gross-to-net calculator for Egyptian tax or social insurance.
  - Official government portals (including EETAX where applicable) are authoritative for payroll-related statutory liabilities.
  - Internal HRFlow statutory calculations, if present, are estimates or planning aids only and must not be represented as official payable obligations.
- **Rationale:** Statutory rules are volatile, and external government portal formulas can produce results that differ from internal estimates.
- **Implementation Implications:**
  - Preserve a clear distinction between *internal estimate*, *portal-confirmed liability*, *actual paid amount*, and *variance*.
  - Do not present estimates as final legal/statutory results.
- **Evidence / Reference:**
  - Owner-approved Project discussion (September 15, 2026).
  - *Implementation Status:* Requires repository verification.

### D-002 — Actual Statutory-Payment Reconciliation
- **Status:** Accepted  
- **Decision:**
  - Record statutory obligations and their actual payments separately from payroll estimates.
  - Support adjustment and reconciliation for portal-calculation variance, actual payment variance, and payment fees.
- **Rationale:** Actual government payment receipts frequently differ from preliminary internal payroll estimates.
- **Implementation Implications:**
  - Financial records require traceability from obligation to actual payment evidence.
  - Do not lock a preliminary estimate as an immutable payable amount.
- **Evidence / Reference:**
  - Owner-approved Project discussions (September 15–17, 2026).
  - *Implementation Status:* Requires repository verification.

### D-003 — Salary-Component Carry-Forward
- **Status:** Accepted  
- **Decision:**
  - Salary components entered during employee creation must carry into compensation review without requiring the user to re-enter those same values.
  - A subsequent compensation-review step may permit confirmation or change.
- **Rationale:** Avoid duplicate data entry while maintaining a controlled review point.
- **Implementation Implications:**
  - Employee setup and compensation-review flows must preserve existing salary-component values as defaults, while allowing authorized review or amendment.
  - The specific data mapping and UI flow remain implementation details.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

### D-004 — Monthly Variable Compensation in One Payroll Flow
- **Status:** Accepted  
- **Decision:**
  - Bonus and commission are optional, dynamic monthly payroll components.
  - A payroll cycle must support adding them during the normal operational flow, without forcing a user to save a draft and return through a separate edit sequence solely to add variable items.
- **Rationale:** Monthly compensation varies, and payroll operations must remain efficient.
- **Implementation Implications:**
  - The payroll experience must accept optional monthly bonus and commission values within the normal payroll cycle.
  - The specific UI controls, save behavior, and recalculation mechanism remain implementation details.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

### D-005 — Optional Payment-Rail Execution
- **Status:** Accepted  
- **Decision:**
  - HRFlow supports internal and external payroll processing, but is not inherently a bank-transfer engine.
  - Transfer execution must be optional/configurable and disabled unless explicitly enabled.
- **Rationale:** Separate payroll preparation, approval, and recordkeeping from external payment rail integration.
- **Implementation Implications:**
  - Payroll lifecycle design must support operation without a direct external bank-transfer integration.
  - Any ledger, payment-record, or transfer-integration behavior must be verified and specified separately.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

### D-006 — Missing Employee Bank Details Are a Warning
- **Status:** Accepted  
- **Decision:**
  - In external payroll, missing employee bank-account information is a critical, highly visible warning.
  - It must not block payroll preparation or processing by itself.
- **Rationale:** Operations need to continue while payroll staff can resolve disbursement risk.
- **Implementation Implications:**
  - The payroll workflow must make missing bank details clearly visible to authorized operators while preserving the decision’s non-blocking rule.
  - The warning presentation and exact lifecycle behavior remain implementation details.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

### D-007 — Payroll Export Row Shape
- **Status:** Accepted  
- **Decision:**
  - Final payroll CSV/Excel export must emit one row per employee.
  - That employee’s relevant payroll components must appear on the same row.
- **Rationale:** Supports practical downstream review, handoff, and operational processing.
- **Implementation Implications:**
  - Payroll export design must preserve a single employee-level record per row, with applicable payroll components represented in that row.
  - Column order, file format options, and export implementation remain separate specifications.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

### D-008 — Payroll UI Redesign: Screen 6 Statutory Linkage, Permission Scope, and Screen-to-Lifecycle Mapping
- **Status:** Accepted  
- **Decision:**
  - The payroll UI journey redesign (six-screen sequence) links its Screen 6 (Statutory Payments) to the existing statutory-obligations module via **Option (b)**: a frontend-only call to the existing manual `POST /api/finance/statutory-obligations` endpoint, prefilled from the payroll run's SI/tax snapshot totals (`total_social_insurance_egp`, `total_employee_tax_egp`). No backend lifecycle change to `finalize_run()` or the statutory obligations state machine.
  - Traceability from a created statutory obligation back to its originating payroll run is achieved by tagging the obligation's `notes` field with a structured marker (e.g., `payroll_run_id:{id}`) at creation time, since `StatutoryObligationCreate` has no formal `payroll_run_id` field.
  - Two new RBAC permission keys are introduced: `finance.statutory.read` and `finance.statutory.write`, distinct from both `finance.payroll.*` (Screens 1–5) and `finance.bill.*` (the existing statutory-obligations router's current guards).
  - For the current testing phase, both new keys are granted explicitly to the `system_admin` role via role-permission rows, in addition to the implicit wildcard (`*`) grant `system_admin` already receives.
  - The new `finance.statutory.*` keys gate the **frontend** Screen 6 UI only. The **backend** statutory-obligations endpoints Screen 6 calls continue to enforce their existing `finance.bill.read`/`finance.bill.write` guards, unchanged. This is an accepted, documented gap: a future non-admin role granted only `finance.statutory.write` would pass the Screen 6 frontend gate but receive a 403 from the backend call, since it would lack `finance.bill.write`. This gap must be resolved (either by granting both key sets together, or by widening the backend guard) before any non-admin role is ever assigned `finance.statutory.write`. It is not a concern while only `system_admin` holds these permissions.
  - Definition and management of custom roles built from individual permission groups (which would allow assigning `finance.statutory.*` independently of `finance.bill.*`/`finance.payroll.*`) is explicitly deferred to a future initiative.
  - The six UI screens map onto the real backend payroll lifecycle (`draft → submitted → approved → finalized → paid/partially_paid`) as follows: Screen 1 (Initiation) operates on a preview only; Screen 2 (Approve) persists the run as `draft`, then transitions `draft → submitted → approved`; the transition into Screen 3 (Processing) triggers `finalize_run` (`approved → finalized`); Screen 4 (Payment Preview) is read-only against the `finalized` run; Screen 5 (Payment Confirmation) triggers disbursement (`finalized → paid`/`partially_paid`); Screen 6 (Statutory Payments) operates on the statutory-obligations module independently of payroll run status.
- **Rationale:**
  - Option (b) preserves the redesign's frontend-only premise and avoids reversing the existing, deliberate code comment in `finalize_run()` stating that finalization does not create statutory obligations under the current net-payment runner.
  - Keeping SI/tax figures as obligations only when manually recorded (rather than auto-accrued at finalize) is consistent with D-001 and D-002: HRFlow's internal SI/tax figures are estimates, and government-portal-confirmed liabilities are recorded and reconciled separately.
  - Splitting `finance.statutory.*` from `finance.bill.*` avoids conflating "manage vendor bills" with "manage payroll-linked statutory obligations," which are distinct operational concerns even though they currently share a backend router and guard.
  - Frontend-only enforcement of the new keys for now is proportionate to the current single-admin-role reality of the system and avoids a backend change that was not requested for this redesign; the gap is explicitly documented rather than silently accepted.
- **Implementation Implications:**
  - `be/core/rbac_seed.py`: add `finance.statutory.read` and `finance.statutory.write` to `SEED_PERMISSIONS`, and add explicit `system_admin` role-permission rows for both.
  - Screen 6 calls existing `FinanceStatutoryApi.createStatutoryObligation` (`POST /api/finance/statutory-obligations`) prefilled from run totals with `notes` tagged with `payroll_run_id:{id}` and variance, and optionally `settleStatutoryObligation` (`/settle`) for remittance.
  - No changes to `be/finance/routers/statutory.py`'s existing `finance.bill.read`/`finance.bill.write` guards.
  - No changes to `be/finance/services/payroll_service.py`'s lifecycle guards beyond the six-screen redesign calling `finalize_run` at the confirmed screen boundary above.
- **Evidence / Reference:**
  - Owner-approved Project discussion (September 25, 2026), payroll UI journey redesign planning thread.
  - Verified against `feature/payroll-deductions` branch code: `be/finance/routers/payroll.py`, `be/finance/routers/statutory.py`, `be/finance/services/payroll_service.py`, `be/core/permissions.py`, `be/core/rbac_seed.py`, `be/finance/schemas.py`, `fe/api/finance/payroll-api.js`, `fe/api/finance/statutory-api.js`, `fe/public/js/finance-payroll.js`.
  - *Implementation Status:* Implemented in code as of the October 1, 2026 reconciliation: Screen 6 creates statutory obligations with the `payroll_run_id:{id}` note tag and gates on `finance.statutory.write` in `fe/public/js/finance-payroll.js`; the backend statutory routes still enforce `finance.bill.*` until RBAC slice 4. The remaining screen-to-lifecycle mapping was not re-audited.
- **Amendment (accepted via D-011, October 1, 2026):**
  - The accepted frontend/backend gap is closed: the six statutory-obligation routes move to `finance.statutory.read` and `finance.statutory.write`.
  - Financial-Admin receives `finance.statutory.*`, which satisfies this decision's condition for assigning it to a non-admin role.
  - The deferral of custom roles ends: roles are defined by D-011.
  - Unchanged: Screen 6 linkage via the manual statutory-obligations endpoint, the `payroll_run_id:{id}` note tag, and the six-screen-to-lifecycle mapping.

### D-009 — Payroll Income Tax Calculation, Effective-Dated Persistence, and NET Basis Solver
- **Status:** Accepted
- **Decision:**
  - **Scope:** Income tax applies strictly to internal salary lines (`component_type="internal_usd_cash"`). External lines (`external_usd`) are never taxed and do not require tax settings to exist.
  - **Calculation Authority:** Implements the owner's Egyptian income tax formula verbatim from the Excel model, preserving exact inclusive thresholds, tax jumps, unrounded Decimal arithmetic, and monthly tax rounded with `ROUND_HALF_UP` to 0.01 EGP.
  - **Social Insurance Integration:** For insured employees, employee SI is deducted from gross before annualization (`ANNUAL_TAXED = (taxable gross - employee SI) x 12 - TAX_LIMIT_P`). For uninsured employees, SI = 0.
  - **Variable Compensation:** Bonuses and commissions are added to taxable gross after recurring gross determination and taxed forward; they do not feed or alter the recurring NET basis solver target.
  - **NET Basis Solver:** Inverts the bracket function for target net $N$, limit $L$, and employee SI $S$ across ascending tax bands (`Y = (12N - L - r*b + F) / (1 - r)`). Accepts the first band where $Y$ lies within the band (lowest valid gross rule). Self-checks that forward tax calculation on derived gross matches target net within 0.01 EGP.
  - **Effective-Dated Persistence:** Settings (`tax_limit_p_egp` and brackets JSON) are persisted in `finance_payroll_tax_settings` table (Alembic migration `0023_payroll_income_tax_settings`). `effective_from` must be the first of a calendar month (`YYYY-MM-01`). A payroll run resolves the newest settings record with `effective_from` on or before the period start date.
  - **Blocking Safeguard:** If any internal salary line exists and no tax settings record is resolved for the period, the calculation emits the blocking exception `MISSING_TAX_SETTINGS`, which blocks run approval.
  - **Snapshot Immutability:** Persisted runs store `tax_settings_version_id` on the run and line-level snapshots (`taxable_gross_egp`, `tax_employee_si_egp`, `annual_taxed_salary_egp`, `annual_tax_egp`, `tax_settings_version_id`). Persisted runs are never silently recalculated when new tax settings are created.
  - **RBAC Governance:** New permission keys `finance.payroll_tax.read` and `finance.payroll_tax.write` restricted to `system_admin`.
- **Rationale:**
  - Egyptian income tax is mandatory for internal payroll cash flows. Applying the owner's exact formula preserves parity with existing manual spreadsheets while enforcing auditability, effective-dating, and immutability.
- **Evidence / Reference:**
  - Owner-approved Project discussion (September 29, 2026), `docs/payroll/12-payroll-income-tax-calculation-spec.md`.
  - Implemented in `be/finance/services/payroll_calculation_helper.py`, `be/finance/services/payroll_service.py`, `be/finance/models.py`, `be/finance/routers/payroll.py`, `be/migrations/versions/0023_payroll_income_tax_settings.py`, and verified in `be/tests/test_payroll_income_tax.py`.
- **Amendment (accepted via D-011, October 1, 2026):**
  - "Restricted to `system_admin`" becomes "granted to Super-Admin and Financial-Admin". All other content is unchanged.
- **Code reconciliation (October 1, 2026):** `init_db()` seeds default tax settings (effective 2026-01-01) at startup when none exist, so `MISSING_TAX_SETTINGS` applies to periods before the earliest settings record or if seeding failed. The rest was confirmed present: migration `0023`, `finance.payroll_tax.*` keys, and the `/api/finance/payroll/tax-settings` routes.

### D-010 — Admin Dual-Rail Navigation Redesign and Payroll Module Separation (N-1–N-10)
- **Status:** Accepted
- **Decision:**
  - **Dual-Rail Shell:** The single 22-item scrollable admin sidebar is replaced by a dual-rail navigation structure consisting of a slim 64px module rail and a 232px collapsible contextual page panel. The Employee portal sidebar remains completely untouched (N-1, N-2).
  - **Module Rail:** Features HR, Finance, and Payroll as top-level navigation modules (N-3). The rail remains permanently visible; only the contextual page panel collapses.
  - **Finance Simplification:** The Finance panel is organized into 6 primary domain pages: Overview, Sales, Spend, Banking, Reports & Export, and Finance Settings (N-4). Nested child rows (Invoices, Bills, Subscriptions, Statutory, Bank Accounts) are removed from the sidebar (N-4/N-5).
  - **Unified Spend Sub-Navigation:** In-page tabs carry sub-domain detail. A unified 4-button Spend sub-navigation bar (`Vendor Bills`, `Vendors`, `Subscriptions`, `Statutory`) is embedded across all three Spend pages (`a-finance-bills`, `a-finance-subscriptions`, `a-finance-statutory`) with identical labels, order, and bidirectional routing (N-5).
  - **Payroll Separation (N-10):** Payroll is separated from `#adminFinanceNavGroup` into its own top-level module rail entry (`data-module="payroll"`), with a dedicated panel (`#adminPayrollNavGroup`) containing Payroll Runs and Payroll Settings. This supersedes Story 1.1 Acceptance Criteria 1 ('7 finance domains in sidebar') by validating 6 domains in the Finance panel while Payroll is independently reachable via its own module rail with Runs and Settings.
  - **Terminology Renames:** HR page "Invoices" is renamed **Salary Payment Docs** (label, title, topbar, command palette) to prevent confusion with Finance Sales Invoices (N-6). Finance Settings is labeled **Finance Settings** (N-7).
  - **Independent State Persistence:** Admin panel collapsed/expanded state is persisted under its own key `hrflow.admin.navPanelCollapsed`. The Employee portal's collapse key (`hrflow-sidebar-collapsed`) is preserved independently without cross-portal sync (N-8).
  - **Active State & Backward Compatibility:** Legacy child routes (`a-finance-invoices`, `a-finance-bills`, etc.) and programmatic attention links resolve cleanly through `financeParentMap`, activating the corresponding parent item and view with single highlighting (no double-highlighting).
  - **Gated Module Access:** Permissions remain unchanged; module rail visibility for Finance and Payroll reuses existing role/permission checks (`AdminNav.canSeeModule`) without modifying backend RBAC (N-9).
- **Rationale:**
  - Solves cognitive overload and excessive scrolling caused by the legacy 22-item flat navigation list while maintaining 100% backward compatibility for all existing tests, deep-linking, and legacy section routes.
- **Evidence / Reference:**
  - Implementation plan: `docs/ui-design/dual-rail-navigation-plan-v2.md`.
  - Visual reference: `docs/ui-design/hrflow-dual-rail-design.html`.
  - Branch `ui/dual-rail-nav`, commit `c5b6b67`. Verified across 252 tests with 0 regressions.
  - *Implementation Status:* Complete.
- **Amendment (accepted via D-011, October 1, 2026):**
  - N-9 is superseded for visibility rules: module visibility becomes permission-derived per module, and a Super-Admin-only System module is added. All other content is unchanged.


### D-011 — RBAC Role Model: Permission-Based Roles, Code-Defined Catalog, Seeded Roles

- **Status:** Accepted (owner approval, October 1, 2026; implemented; merged to `main` from branch `feature/rbac`)
- **Decision:**
  - **Single authority. [Agreed]** RBAC (`roles`, `role_permissions`, `user_roles`) is the sole authorization authority. The legacy `users.role` string, the `role` claim in the session token, and the `*` wildcard are retired. This is a long-term direction delivered in slices; legacy paths stay until each consumer is migrated.
  - **Permissions are code. [Agreed]** Permission keys are defined in a code catalog with the format `<module>.<resource>.<action>`. Roles are database rows composed from catalog keys. There are no prefix wildcards.
  - **Implication rule. [Agreed]** Write implies read. Action keys such as `approve`, `pay`, `prepare`, `reveal`, `manage` and `verify` imply read of the same resource and never imply another action. Implication is declared per key in the catalog, enforced in the role editor, and re-validated on the server when a role is saved. Role rows are stored closed under implication.
  - **Maker / authorizer. [Agreed]** Payroll's single `finance.payroll.write` is split into `finance.payroll.prepare`, `finance.payroll.approve` and `finance.payroll.pay` (approve and pay are separate keys). Only the Super-Admin role holds all three. Payroll already enforces at runtime that the user who submitted a run cannot approve it (`approve_run`; bypassed by env `ENFORCE_MAKER_CHECKER=false` or by the `allow_self_approval` query parameter, which any `finance.payroll.write` holder can pass today); that check stays. **[Approved October 2, 2026; resolves Q-013]** After the split, `allow_self_approval` is honored only for a caller who holds both `finance.payroll.prepare` and `finance.payroll.approve`, which only Super-Admin does by default.
  - **Initial roles. [Agreed]** Five seeded roles: **Super-Admin**, **HR-Admin**, **Financial-Admin**, **Payroll-Maker**, **Employee** (grants in `rbac/permission-matrix.md`).
    - Super-Admin: locked by a flag; cannot be edited, renamed or deleted by anyone, including a Super-Admin.
    - The other four are editable by Super-Admin and are created once by the seed and never overwritten afterwards.
    - Only Super-Admin may create, edit or delete roles and assign them.
  - **`system.*` keys. [Agreed]** `system.users.manage`, `system.roles.manage` and `system.audit.read` are held only by the locked Super-Admin role and cannot be assigned to any other role.
  - **Composition. [Agreed]** Union of roles only. No deny rules, no role inheritance.
  - **Scope. [Agreed]** Data scope follows the keys: `self.*` means own records, `hr.*` means all records, and a user holding both sees all. Shared endpoints stop deciding scope from `role == "admin"`. Company-wide resources (company documents) carry no employee scope.
  - **Role contents. [Agreed]**
    - HR-Admin: full HR including salaries, employee bank details and salary payment documents; no finance or payroll.
    - Financial-Admin: all finance and payroll including `finance.statutory.*` and `finance.payroll_tax.*`; can approve and pay payroll but not prepare it.
    - Payroll-Maker: prepare only.
    - Employee: own records, plus submitting requests, vacations and claims.
    - New `self.*` keys are created for vacations, claims, bank details and documents ("do it properly").
  - **Super-Admin completeness. [Approved]** Super-Admin's effective permissions are the full catalog, computed at resolution time, so a newly added key can never be missing for Super-Admin. Its `role_permissions` rows are kept in sync by the seed for display.
  - **Catalog sync. [Approved; resolves Q-010]** An idempotent catalog sync inserts missing keys and never removes or re-grants keys on editable roles. It runs at application start through the existing `init_db()` startup path (permission rows and Super-Admin rows only). New keys are granted to editable roles only through migrations that carry a frozen key list.
  - **Startup seeding. [Pending owner OK]** Verified in code: `seed_rbac` runs on every start, re-grants all keys to `system_admin`, and re-links users to roles from the legacy `users.role`. The re-link would undo role changes made on the Users page, so it is removed; role assignment is owned only by the access service and the migration. Seeding and sync errors are logged and fail startup instead of being swallowed by `except Exception: pass`.
  - **Guard clean-up. [Approved]** (a) The `finance.vendor.write` alias that lets a vendor-writer manage and verify payment instructions is removed. (b) The finance activity timeline gets per-entity read guards. (c) Feature-flag and observability GETs get a new `finance.settings.read`. (d) The `finance.adjustment.manage` check reads resolved permissions instead of the session payload. (e) A coverage test fails any route that has neither a permission guard nor an explicit public/authenticated allow-list entry.
- **Rationale:**
  - The schema already models a role as a set of permissions. What is missing is a single authority (today a legacy admin string and a name-matched wildcard run alongside RBAC), role and user management, and guards on the 31 `require_admin` route registrations in the HR routers.
  - Splitting payroll keys gives the maker/authorizer control the owner wants while letting the Super-Admin keep both for a small team.
  - Keeping roles few and Super-Admin-defined avoids a complex permission matrix and corner cases (owner's stated goal).
- **Implementation Implications:**
  - New code module for the catalog and role seeds; new Alembic migration(s) for role columns; `core/permissions.py` rewrite; scope helpers in `be/deps.py` rewritten; all HR routers moved off `require_admin`.
  - Test fixtures that mint session tokens with the legacy role must be reworked.
  - Frontend `SessionInfo.hasPermission` and `AdminNav.canSeeModule` stop shortcutting on role strings.
  - Full detail: `rbac/technical-spec.md`, `rbac/implementation-plan.md`.
- **Evidence / Reference:** `be/core/permissions.py`, `be/core/rbac_seed.py`, `be/core/rbac_models.py`, `be/db.py` (`init_db`), `be/deps.py`, `be/auth.py`, `be/finance/services/payroll_service.py` (`approve_run`), `be/finance/routers/payroll.py`, `vendors.py`, `activity.py`, `observability.py`, `bank_accounts.py`; route inventory in `rbac/route-guard-inventory.csv` (236 route registrations).
- **Amendment (owner decision, October 3, 2026) — one assigned role per user:**
  - Supersedes the **Composition** bullet above ("Union of roles only").
  - A user holds **at most one assigned role**. Effective permissions are that role plus the derived Employee baseline when an employee is linked (for example Employee + Payroll-Maker, or Employee + Super-Admin). Still no deny rules and no role inheritance.
  - The Employee role stays editable on the Roles page but is never assigned to, or shown on, a user.
  - Whether a custom role may combine `finance.payroll.prepare` with `approve` or `pay` is left to the Super-Admin's judgment; the role editor does not block it.
  - Existing development data is not migrated: the access service replaces whatever rows a user holds with the single role the next time the role is set. No database constraint is added yet.

### D-012 — Identity Lifecycle: Users Page, External Users, Archiving, Self-Protection

- **Status:** Accepted (owner approval, October 1, 2026; implemented; merged to `main` from branch `feature/rbac`)
- **Decision:**
  - **Users page. [Agreed]** A Super-Admin-only Users page (Core domain), alongside a Roles page, in a new Super-Admin-only System area of the admin navigation. Roles are not assigned from the Employees page.
  - **One creation path. [Agreed]** An employee is created only on the Employees page; a user is provisioned for them automatically. No second creation step.
  - **Employee role is derived. [Agreed]** Any user with a linked employee record automatically receives the Employee role's permissions. It is not shown, highlighted or manually assigned. If the link disappears, so does the baseline.
  - **Assigning roles. [Agreed]** From the Users page the Super-Admin picks an existing employee or creates a new **external user** (no linked employee), which is labeled External. A user created from the Users page must be given at least one role.
  - **Always one effective role. [Agreed]** A user always has at least one effective role. For external users this means their last role cannot be revoked; they are archived instead.
  - **Deletion rule. [Agreed]** An employee whose user holds a role above the Employee baseline cannot be deleted until the Users page revokes it. Deleting a baseline-only employee also removes the linked user. *(The user-removal half is the drafter's reading of the discussion; confirm.)*
  - **Archived, not disabled. [Agreed]** There is no disable switch. External users who must be removed are **Archived**, so history is kept. The future employee equivalent is also called **Archived** (see the intake note).
  - **Archived users keep roles but have no access. [Approved mechanism]** Roles stay on the record for history. Access is blocked by an archived check at sign-in and on every authenticated request, so a still-valid session cookie stops working immediately. Whether an archived user can ever be restored is open (Q-006).
  - **Super-Admin management. [Agreed]** A Super-Admin can add other Super-Admins and can remove (revoke or archive) other Super-Admins, for example when one leaves the company.
  - **Self-protection. [Agreed]** No user can delete, archive or revoke the access of their own account, whatever their role (examples: an HR-Admin deleting their own employee record; a Super-Admin archiving themselves; a Super-Admin revoking their own Super-Admin role). The last active Super-Admin cannot be revoked, archived or deleted.
  - **One rules owner. [Approved]** All lifecycle rules live in one Core access service. HR calls it when creating and deleting employees; the HR repository stops writing the users table directly.
- **Rationale:**
  - Avoids duplicate user creation, supports non-employee users (for example an external accountant), keeps history, and gives a guarantee that departed people cannot return through an old session.
  - HR owns employees and Core owns authentication and RBAC (doc 02 §3); a single access service keeps that boundary instead of letting two routers each enforce part of the rules.
- **Implementation Implications:**
  - New `users` columns for archive state and external-user name; an access service; roles and users APIs; two new frontend pages and navigation entries; a per-request database check in `get_current_user`.
  - Today employee creation inserts a `users` row with the legacy role and no `user_roles` row; employee deletion deletes only the employee, leaving the `users` row in place (read from code, not executed). Both change.
- **Evidence / Reference:** `be/routers/employees.py`, `be/repositories/sql/employees.py` (`create`, `delete`), `be/models_db.py` (`UserDB`), `be/repositories/sql/auth.py`.
- **Amendment (owner decision, October 3, 2026) — one assigned role per user:**
  - **Assigning roles:** a user created from the Users page (external user) must be given **exactly one** role, replacing "at least one role".
  - **Always one effective role:** an external user's role can be changed but not cleared; to remove access the user is archived. A user with a linked employee has zero or one assigned role; zero means Employee baseline only.
  - API: `PUT /api/access/users/{id}/role` with `{role_id}` replaces `PUT /users/{id}/roles`; assigning the Employee role is rejected.

### D-013 — Sign-In Policy: Provisioned Google Accounts of Any Domain

- **Status:** Accepted (owner approval, October 1, 2026; implemented; merged to `main` from branch `feature/rbac`)
- **Decision:**
  - **Google-only. [Agreed]** Sign-in remains Google Sign-In only. No passwords or other providers.
  - **Any domain. [Agreed]** Accounts outside the company Workspace domain are allowed, so external users can sign in.
  - **Provisioned only. [Agreed]** Access requires an existing, non-archived HRFlow user matched by verified Google email. There is no self-registration.
  - **Verification kept. [Approved]** `email_verified` stays mandatory and email matching stays case-insensitive. The workspace-domain check (`ALLOWED_WORKSPACE_DOMAIN` against the Google `hd` claim) is dropped as an access gate; if retained at all it would become informational. The exact configuration change is for the spec to settle.
- **Rationale:** External users cannot be provisioned if only Workspace accounts can sign in. The user table already acts as the allow-list, and the archived check closes the remaining gap.
- **Implementation Implications:** amends `be/auth.py` (`verify_google_credential`), production configuration, and doc 02 §5 rule 2, which currently states that production mandates domain validation.
- **Evidence / Reference:** `be/auth.py`, `be/config.py`.

### D-014 — Top-Bar Account Menu, Title-Only Header and Visible Bell

- **Status:** Accepted by owner 2026-10-05; merged to `main` (branch `fix/review-ui-fixes`).
- **Decision (OD-1…OD-10):**
  - **Account menu top-right (OD-1).** Identity, the Light/Dark control and Sign out live in a top-bar account menu in both the Admin and Employee portals. The admin rail avatar and logout, the admin panel user card, and the employee sidebar user card and logout button are removed.
  - **Theme control in the menu (OD-2).** A two-option Light/Dark segmented control replaces the top-bar theme icon buttons. The login screen keeps its own toggle.
  - **Visible bell (OD-3).** The notification bell is shown in both top bars and opens a "No notifications yet" popover; no unread dot or API until notifications exist.
  - **Title only (OD-4).** The page subtitle is removed; the top bar shows the title only.
  - **Compact top bar (OD-5).** About 56 px on desktop.
  - **Avatar component (OD-6).** Non-bold initials on a soft tinted background, built so a user picture can be added later.
  - **Brand footer removed (OD-7).** The "HRFlow by Voyance Health" logo footer is removed from both sidebars.
  - **Employee portal included (OD-8).**
  - **Navigation polish (OD-9).** HR panel groups are "People" and "Benefits & records"; Salary & Raises and Salary Payment Docs have distinct icons; the active indicator sits inside the active pill.
  - **No Profile item yet (OD-10).** A "Profile" menu item ships only when a target page exists.
- **Supersedes:** `docs/UI-UX-FIX-PLAN.md` items "Notification bell: remove from both topbars" and "show title and subtitle on every page" (the "title on every page" part still holds).
- **Amends:** D-010 N-1/N-2 ("Employee portal sidebar remains completely untouched"): the Employee portal shell now receives the same top bar, account menu and bell and loses its sidebar footer. All other D-010 rules remain: the module rail stays visible, only the panel collapses, the collapse keys stay independent, and `AdminNav.canSeeModule` gating is unchanged.
- **Rationale:** One identity location that works on desktop and phone, less sidebar clutter, and a compact, elegant header.
- **Evidence / Reference:** implementation plan `docs/ui-design/topbar-account-menu-implementation-plan.md`; branch `fix/review-ui-fixes`.

### D-015 — Admin Rail Clicks Navigate to a Landing Page

- **Status:** Accepted by owner 2026-10-05; merged to `main` (branch `fix/review-ui-fixes`).
- **Decision:** Clicking an admin module rail button opens a page instead of only swapping the side panel. The landing page is the last sidebar page visited in that module during the current session, otherwise the module default: HR `a-dashboard`, Finance `a-finance-dashboard`, Payroll `a-finance-payroll-runs`, System `a-system-roles`. Clicking the current module's button leaves the page unchanged. With the mobile drawer open, the rail still only swaps the panel, because navigating closes the drawer.
- **Details:** Remembered pages are kept in memory only (never persisted) and cleared on sign-out, session expiry and session change. Pages not listed in the sidebar are remembered as their parent sidebar page (for example employee detail as Employees). Module visibility rules (`AdminNav.canSeeModule`) are unchanged.
- **Amends:** the "rail click only switches the panel" behaviour in `docs/ui-design/dual-rail-navigation-plan-v2.md`; D-010 is otherwise unchanged.
- **Rationale:** A rail click that leaves the previous page on screen under a different module's menu was a navigation glitch.

### D-016 — Vendor Bill Status Model

- **Status:** Accepted by owner, October 8, 2026. Implemented and merged to `main` (branch `feature/bills-b1-status-model`) (slice B1); plan in [../finance-module/18-bill-workflow-v2.md](../finance-module/18-bill-workflow-v2.md).
- **Decision:**
  - Eight bill statuses: Draft, Pending approval, Rejected, Approved, Scheduled, Partially paid, Paid, Void. `inbox`, `needs_coding`, `unpaid`, `ready_to_pay` and `exceptions` are removed; the `is_reviewed` flag is no longer used.
  - Overdue is a flag derived from the due date, not a status.
  - Status changes only through server actions; no form or API input sets it directly. Partially paid and Paid come only from recorded payments.
  - Void means cancelled and kept on record with a reason, excluded from every total, final. A bill with unreversed payments cannot be voided. Only drafts may be deleted.
  - Only Approved, Scheduled and Partially paid count as money owed (AP aging, cash forecast, vendor open totals). Draft, Pending approval and Rejected do not.
- **Rationale:** The old set mixed workflow queues, payment state and date facts; most moves were free edits and several statuses had no user meaning for a single operator.
- **Supersedes:** FUX-401 status queues; the status list in FUX-414 (the tab-bar control itself stays).

### D-017 — Bill Approval and Bill Permissions

- **Status:** Accepted by owner, October 8, 2026. Implemented and merged to `main` (branch `feature/bills-b1-status-model`) (slice B2).
- **Decision:**
  - New permissions `finance.bill.approve` and `finance.bill.pay`. Super admin holds them; no seeded role is granted them for now, so Financial-Admin keeps create/edit but loses approve and pay until granted.
  - Bills saved by a holder of `finance.bill.approve` are Approved immediately, marked auto-approved. Others submit for approval; the super admin approves or rejects (reason required).
  - A creator may not approve their own bill unless super admin.
  - Withdrawing a submitted bill returns it to Draft. A rejected bill is edited and resubmitted, or voided.
  - A material edit (vendor, amount, currency, lines) by a non-approver returns an Approved or Scheduled bill to Pending approval.
  - Approval fields (`approval_status`, `approved_by`, `approved_at`, `created_by`) are server-controlled and refused as input.
  - Finance users cannot record a bill as already paid; payment needs `finance.bill.pay`. Approval applies to every finance-user bill (no threshold yet).
- **Rationale:** Today self-approval is blocked even for super admin while the approval fields are writable by any bill-write user, which blocks honest use without preventing misuse.

### D-018 — Bill Payment Fields, Currency and Balance Rules

- **Status:** Accepted by owner, October 8, 2026. Implemented and merged to `main` (branch `feature/bills-b1-status-model`) (slice B3).
- **Decision:**
  - No exchange rate on bills or bill payments. The paying account must be in the bill's currency; a mismatch is an error. Currency exchange happens only through account transfers.
  - A bill payment the account balance cannot cover is an error, for every account (no overdraft). Extending the check to other outflows is a later slice.
  - Source account and payment type are separate fields, defaulting to CASH - EGP and Cash payment; payment types are limited to outgoing types that fit the account kind. Cheque payments require a cheque number.
  - The ledger row records the chosen payment type, the reference as entered (empty by default), details as entered (default vendor name), the vendor as payee and the creating user. New bills default to EGP.
  - Creating a bill as already paid is one transaction: bill, payment, balance and ledger row together or nothing.
  - The cashbook layout is a reference, not a specification.
- **Rationale:** Live data showed USD bill payments posted against an EGP account with no rate; the ledger ignored entered references and recorded every bill payment as an outgoing transfer.

### D-019 — Bill Drafts and PDF Upload

- **Status:** Accepted by owner, October 8, 2026. Implemented and merged to `main` (branch `feature/bills-b1-status-model`) (slice B4).
- **Decision:**
  - Draft holds unfinished bills; it needs a vendor or an attachment. Leaving Draft runs full validation.
  - Every PDF or photo upload creates a Draft; several files can be uploaded at once from different vendors, each becoming its own Draft with its own vendor match. Weak matches are flagged "vendor to confirm"; new vendors are suggested, never auto-created.
  - Discard draft deletes it permanently.
  - The new-bill form offers "Not paid yet / Already paid" to approvers, starting on the user's last choice, and an "Add another after saving" option.
- **Deferred:** a visual restyle of the bill screens (separate plan, shown visually before approval; decided in D-021) and bulk/historical import (separate plan; historical bills link to existing ledger transactions rather than posting payments again).

### D-020 — Banking Rules: Same-Currency Entries, Spend as Bills, Cheque Reversals

- **Status:** Accepted by owner, October 9, 2026. Implemented and merged to `main` (branch `feature/bills-b1-status-model`) (slice B6).
- **Decision:**
  - A ledger transaction is always in its account's currency. Manual entries lose the exchange-rate path; exchange happens only through FX transfers. Cash withdrawals (teller or cheque) require the cash account to have the bank account's currency.
  - Spend with a vendor or shop is recorded as a bill (one-step "Already paid" where it is already paid). Plain transactions are for bank fees, transfers, exchange, withdrawals and money in.
  - Every route that pays a bill (bill dialogs, manual transaction linked to a bill, cheque linked to a bill) goes through the settlement service with the D-017 permission and D-018 checks.
  - Undoing a cheque posts reversing entries with a reason; ledger rows are never deleted for a reversal.
- **Amendment (owner decision, October 9, 2026) — unknown or minor vendors:** spend with a shop not worth tracking is still a bill, recorded against a protected **Miscellaneous** vendor with the shop name in Details; category carries the reporting. A blank bill number is auto-assigned (`EXP-YYMM-NNNN`). A shop can be promoted to its own vendor at any time; earlier bills stay under Miscellaneous. Delivered in slices B4 and B5.
- **Rationale:** Code review on October 9, 2026 found foreign-currency manual entries reducing balances by the unconverted amount, withdrawals crediting cash accounts in the wrong currency, cheques marking bills paid without a payment record, and cheque reversals deleting ledger rows.

### D-021 — Finance Bills Visual Restyle: Direction A "Clean Table"

- **Status:** Accepted by owner, October 9, 2026. Implemented and merged to `main` (branch `feature/finance-ui-restyle-a`); plan in [../finance-module/19-finance-ui-restyle-direction-a.md](../finance-module/19-finance-ui-restyle-direction-a.md).
- **Decision:**
  - Restyle the shared Finance components (data table, status pills and flags, status filter, page header and toolbar, summary cards, dialog) with direction A "Clean Table", starting with the Bills page. Sales invoices are not restyled in this work; they get a regression check only. Three other directions (Compact Ledger, Soft Cards, Structured Workbench) were explored and not chosen.
  - FUX-414's status pill with a "Change view" panel is replaced by an always-visible status row with counts and an Overdue only control. The row wraps to a second line when narrow. This is an explicit owner override of FUX-414's "exact and only approved layout".
  - The FUX-415 global density setting stays and Regular remains the default. The three density class definitions are not changed.
  - In-page tabs and text buttons carry no icons. Icons stay in the sidebar, search box, filter button and row "more" menu.
  - Table dates keep the year. Two solid blue primary buttons (top-bar "Add transaction" and the page-level "Record bill") are accepted; the top bar is not changed.
- **Scope:** Visual only. No API, schema, permission or workflow change; D-016 to D-020 are unchanged.
- **Rationale:** Today's bill rows are 100 to 200 px tall because text wraps; direction A reaches about 53 px at Regular with the lowest review risk of the four directions explored on the "Finance Restyle: Alternative Directions" design canvas.

### D-022 — Sales Invoice Status and Safety Rules

- **Status:** Accepted by owner, October 10, 2026. Invoice rules implemented and merged to `main` (branch `feature/fin-f1-invoice-rules`) (slice F1, migration `0031_invoice_status_model`); the statutory-payment currency rule was delivered in slice F4 (no migration). Plan: [../finance-module/20-finance-review-round-2.md](../finance-module/20-finance-review-round-2.md).
- **Decision:** Invoice statuses are Draft, Sent, Partially paid, Paid, Void; overdue is a flag. Status changes only through actions. A sent invoice's customer, currency, lines, amounts, VAT and withholding rate are locked (void and reissue to correct). Void is refused while unreversed receipts exist. Receipts must use an account in the invoice's currency, with no exchange rate, and go through the settlement service. Statutory payments follow the same currency rule (F4).
  - Owner clarifications (October 10, 2026): issue date is also locked once issued; receipts use Cash payment for cash accounts and Incoming transfer for bank accounts; refusals use 409 (`invoice_locked`, `invoice_void`, `invalid_transition`, `has_unreversed_receipts`) and 400 `currency_mismatch` / `payment_type_not_allowed`.
- **Rationale:** Mirrors D-016, D-018 and D-020 for receivables; the review found partly paid invoices voidable, sent invoices editable and receipts accepted in another currency.

### D-023 — VAT on Sales Invoices

- **Status:** Accepted by owner, October 10, 2026. Implemented and merged to `main` (branch `feature/fin-f1-invoice-rules`) (slice F2, migration `0032_invoice_vat_rate`). A confirmed or remitted monthly obligation is never overwritten by regenerating the estimate (409 `obligation_confirmed`).
- **Decision:** Each invoice carries a VAT rate (default 14% for EGP, 0% otherwise). Revenue is the net amount. A user-triggered "Generate VAT estimate" creates or updates one monthly sales-tax obligation (estimated, EGP) from invoices issued that month; the portal-confirmed figure is entered through the existing confirm/adjust step (D-001, D-002). No scheduler.
- **Rationale:** The owner's EGP invoices include 14% VAT (cashbook REVENUE sheet), while HRFlow hard-codes invoice tax to 0 and reports VAT-inclusive totals as revenue.

### D-024 — Customer Withholding Tax at Invoice Preparation

- **Status:** Accepted by owner, October 10, 2026 (owner delegated the design). Implemented and merged to `main` (branch `feature/fin-f1-invoice-rules`) (slice F3, migration `0033_customer_withholding_tax`). Withheld tax on a receipt cannot exceed the invoice's expected withholding.
- **Decision:** Optional withholding rate per customer (default 0) copied to the invoice and editable while Draft. The invoice shows the amount expected to be received; a receipt plus the withheld amount settles it. Withheld amounts are recorded on the payment without a bank movement and listed in a withholding-credits report.
- **Rationale:** Customers withheld tax last year but not currently; the feature must stay invisible at rate 0.

### D-025 — Payroll Paid Moves Net Pay Only; Payroll Posting Fixes

- **Status:** Accepted by owner, October 10, 2026. Resolves Q-001 (Option A). Implemented and merged to `main` (branch `feature/fin-f1-invoice-rules`) (slice F5, migration `0034_payroll_ledger_source`). Marking a run fully paid posts the net-pay rows immediately; the migration recalculates affected account balances, which lowers them by the historical net pay that was never deducted.
- **Decision:** Marking a payroll run paid moves net pay only; employer tax and social insurance are paid as statutory obligations. Payroll ledger rows are `source="payroll"` (not editable as manual entries), follow the funding account's currency and kind, update balances immediately, and are refused when funding accounts are missing (no hard-coded fallback IDs).
- **Rationale:** Matches current behaviour and the cashbook; the review found payroll rows saved as manual, balances not recalculated and fallbacks to account 1.

### D-026 — Cash Basis Is the Main P&L View

- **Status:** Accepted by owner, October 10, 2026. Implemented and merged to `main` (branch `feature/fin-f1-invoice-rules`) (slice F6, no migration). Scope: the cash/accrual summary KPIs and the cash/accrual P&L statement; other cash-basis reports (cash flow, category rollups) keep their own logic.
- **Decision:** The cash-basis P&L is the primary view. Reversals reduce the side they reverse; movements between own accounts (transfers, exchange, withdrawals) are excluded; payroll and statutory payments count as spend. "All currencies" shows one column per currency with no converted total. The accrual view is labelled partial until completed later.
- **Rationale:** The owner runs the business on a cashbook; the review found reversals counted as revenue, withdrawals counted on both sides, and USD and EGP summed under a USD label.

### D-027 — Finance UI Restyle v2: Colour Direction on Every Finance Page

- **Status:** Accepted by owner, October 10, 2026. Implemented and merged to `main` (branch `feature/finance-ui-restyle-v2`, UI only); UI plan in [../finance-module/21-finance-ui-restyle-v2.md](../finance-module/21-finance-ui-restyle-v2.md), backend support in [../finance-module/22-finance-restyle-v2-backend.md](../finance-module/22-finance-restyle-v2-backend.md). Approved references: `docs/finance-module/mocks/restyle-v2/`.
- **Decision:**
  - Every Finance page in the six Finance sidebar items (Overview, Sales, Spend, Banking, Reports & Export, Finance Settings), their dialogs and drawers move to the colour direction: navy ink instead of black, brand blue for anything clickable or identifying, eight identity colours (fixed order, colour-blind validated in light and dark) for avatars, category dots and future charts, one colour per Finance area, white table header rows, direction C soft summary cards.
  - Bills keeps its approved UX (D-021, doc 19 §12); only colours and sizes change. Every table follows the Bills row-action pattern: at most one text button plus up to three icon buttons, no "⋯" menus.
  - Finance buttons get smaller: page buttons 32 px, row buttons 28 px, dialog footer buttons 34 px, dialog fields 36 px. Applied inside Finance only; global button rules are unchanged.
  - Categories get a stored colour; customers and vendors lists return open balances per currency (backend, additive).
  - Payroll Runs and Payroll Settings are out of scope (separate plan later).
- **Scope:** Visual and small UI-level changes (control types, client-side counts and sums, removal of obsolete columns). Three additive API fields (doc 22). No workflow, permission or calculation change; D-016 to D-026 unchanged.
- **Rationale:** The owner wants a calmer, more colourful Finance module that uses the brand colour and stays readable; the Bills restyle proved the table pattern, and the full design was reviewed screen by screen in a clickable prototype before approval.

### D-028 — Books: Local and Overseas, Three Report Views

- **Status:** Accepted by owner, October 18, 2026. Resolves Q-017 and Q-020. Implemented and merged to `main` (branch `feature/finance-expansion`) (slice X2, migration 0038); plan in [../finance-module/23-finance-expansion-plan.md](../finance-module/23-finance-expansion-plan.md) (slice X2).
- **Decision:**
  - New `finance_books`: `Local` (Egyptian entity, default; every existing account migrates here) and `Overseas` (overseas entity). Every company account has a required book and a visibility of `full` or `partial`.
  - A `partial` account (the overseas bank account) shows its balance as known movements plus owner-entered balance checkpoints; the gap is shown as "Unrecorded difference" and is never auto-adjusted.
  - Money moving between the two entities is recorded once, as an inter-book transfer, and read three ways: **Local** = "Income from overseas entity" (counts as Local revenue); **Overseas** = "Transferred to local entity" (outflow, not an operating expense); **Consolidated** = eliminated on both sides (same rule as D-026 own-account movements). An invoice from the local entity to the overseas entity uses a customer marked intercompany and is eliminated the same way in Consolidated.
  - Finance pages get a `Local | Overseas | Consolidated` switcher, remembered per user. First defaults: dashboard, cash-basis P&L and cash flow = Local (unchanged from today); accounts = all accounts grouped by book; revenue analytics = Consolidated; spend/subscriptions/vendors/categories = Consolidated with a "Paid from" book column.
  - Overseas external salaries stay in HRFlow payroll runs using the existing `external_funding_account_id` (overseas account); no payroll model change.
  - Legal and tax treatment of the two entities is outside the system; HRFlow labels and separates only. D-026 currency rule unchanged (no converted totals).
- **Rationale:** The two entities are legally separate but one company logically; local income tracking must count overseas money as income while company-wide figures must not double count it.

### D-029 — External Revenue: Receipts Tagged by Source, No Stripe Account Yet

- **Status:** Accepted by owner, October 18, 2026. Resolves Q-019. Implemented and merged to `main` (branch `feature/finance-expansion`) (slice X4, migration 0039).
- **Decision:** Stripe is not modelled as an account now. Money reaching a company account without an HRFlow invoice is recorded as a **revenue receipt** (a `money_in` ledger row) with `revenue_source` from an editable list (`Invoice`, `Stripe payout`, `Direct transfer`, `Cash`, `Other`), optional product and customer, period covered, and optional memo-only gross and fee amounts. When the planned revenue-service integration arrives, imported service revenue becomes the revenue record and bank payouts are matched to it; earlier payout receipts stay as historical records.
- **Rationale:** Stripe money mostly originates from other services the owner plans to integrate directly; a Stripe account now would be replaced later.

### D-030 — Product Catalog and Revenue Tagging

- **Status:** Accepted by owner, October 18, 2026. Implemented and merged to `main` (branch `feature/finance-expansion`) (slices X3, migration 0037, and X4, migration 0039 for `product_id` on revenue receipts). Permissions `finance.product.read` / `finance.product.write` (write granted to Financial-Admin).
- **Decision:** New Finance-owned `finance_products` (name, code, type `saas_subscription | license | implementation_service | support | other`, default currency/price, default receiving account, active). Optional `product_id` on sales invoice lines and revenue receipts; untagged revenue stays visible in reports. Invoice book is derived from its expected receiving account; `revenue_channel` is kept for history and mapped to book + source.
- **Rationale:** The owner wants revenue by product across local and overseas accounts.

### D-031 — Subscriptions: Expected Charges, Proof Tracking, In-App Reminders Only

- **Status:** Accepted by owner, October 18, 2026. Resolves Q-016 (no email, no scheduler for now). Implemented and merged to `main` (branch `feature/finance-expansion`) (slice X5, migration 0040).
- **Decision:** Subscriptions gain `billing_email`, `proof_source` (`email_inbox | vendor_portal | bank_only | none`), paid-from account (any book) and `proof_expected`. Expected charges are generated on demand and idempotently (button and on page open), status `expected → settled | skipped` with variance. Settle links an existing ledger/statement row or creates an "Already paid" bill through the settlement service (D-020) and advances the renewal date. Proof per charge is `attached | pending | unavailable` with reason, never blocks settlement, and feeds a "proofs missing" list. Reminders are in-app attention items only. Email and a background scheduler are a future standalone feature.
- **Rationale:** Some proofs cannot be obtained; recurring charges must be visible and settled monthly without new infrastructure.

### D-032 — Cheque Scans and Manual Entry; No Extraction

- **Status:** Accepted by owner, October 18, 2026. Resolves Q-015. Implemented and merged to `main` (branch `feature/finance-expansion`) (slice X1, migration 0036). Scans use the finance-attachment local store (same as subscription charges); read/write use `finance.account.read` / `finance.account.write`, the existing cheque-register permissions.
- **Decision:** No external OCR or AI service and no extraction. Cheques get one or more stored scans (front, back, bank stamp) through `finance_attachments` (`cheque_id`), with a "scan missing" flag and filter; existing `attachment_url` values are migrated and the column deprecated. Entry shortcuts: next cheque number suggested per account; payee, amount and currency prefilled from a linked bill.
- **Rationale:** The owner will not subscribe to an external service; free local OCR cannot read handwritten cheques reliably.

### D-033 — Bulk Import via Manifest + ZIP Upload; Drafts Only

- **Status:** Accepted by owner, October 20, 2026. Resolves Q-021. Plan: [../finance-module/25-bulk-historical-import-plan.md](../finance-module/25-bulk-historical-import-plan.md). Implemented and merged to `main` (branch `feature/bulk-import`) (slices I0–I4).
- **Decision:** Import is an authenticated upload of a manifest (CSV/XLSX) and a ZIP of PDFs/images through the HRFlow UI; HRFlow never reads caller-supplied filesystem paths. It creates only Draft bills, draft cheques and Draft sales invoices: it never approves, sends, issues, pays, posts ledger rows, or creates vendors/customers/categories/accounts. Provenance is recorded on every record (`capture_source = import`, batch id, source file, confidence, review flags); imported bills start `is_reviewed = false`. Permissions mirror the target entity (`finance.bill.write`, `finance.account.write`, `finance.invoice.write`); no new permission. HRFlow calls no external OCR/AI service: documents are read outside the app and the owner reviews the manifest (consistent with D-032). The 25 MB nginx limit stays; the ZIP carries compressed copies.
- **Rationale:** One-time backlog of old documents; an MCP/public endpoint was disproportionate. Dry run then commit keeps the owner in control, and Drafts keep the ledger untouched.

### D-034 — Pay Plan Sync: Raises Reach the Plan, Zero Closes a Component, One-Form Pay Plan Modal

- **Status:** Accepted by owner, October 21, 2026. Plan: [../finance-module/27-pay-plan-sync-and-modal-plan.md](../finance-module/27-pay-plan-sync-and-modal-plan.md). Implemented and merged to `main` (slices P1–P3 on `feature/pay-plan-sync`). Extends the Q-008 interim treatment; Q-008 stays Open. Decision 6 (pay in the create/edit modals) is superseded by D-036.
- **Decision:** (1) Either pay component (internal USD cash, external USD) may be 0, never both; a 0 closes the active plan row the day before the effective date and keeps history. (2) The Pay plan modal writes plan rows only; the Raise modal remains the raise event (plan + raise history + next-raise date). (3) A raise dated today or earlier applies to the plan if the plan guards pass; future dates and guard failures are rejected and nothing is written. (4) Raises update the plan through the service under `hr.salary.write` (as employee create/update already do under `hr.employee.write`). (5) The Pay plan modal becomes one form saved through one atomic endpoint (`PUT /api/finance/employees/{id}/compensation-plan`), single transaction, single audit entry. (6) The employee create modal gains "Pay effective from"; the edit modal shows pay read-only with an "Edit pay plan" button.
### D-035 — Unified File Storage Root and Folder Layout

- **Status:** Accepted by owner, October 21, 2026. Resolves local scope of Q-003. Plan: [../file-storage/26-file-storage-layout-plan.md](../file-storage/26-file-storage-layout-plan.md). Implemented and merged to `main` (branch `feature/file-storage-layout`) (slices F0–F6).
- **Decision:**
  - HRFlow unifies all stored files (Finance and HR) under a single environment-configured root `HRFLOW_FILES_ROOT` (defaults to `/data/documents` in container, `${HRFLOW_DATA_DIR}/documents` on host).
  - Database records store root-relative POSIX paths only (e.g., `finance/2026/bills/2026-04/12-vendor.pdf`), never absolute host filesystem paths.
  - Files are written once to their canonical layout path and never moved or renamed afterwards, even if underlying records (vendor name, account details) change.
  - File deletions are hard deletes (no recycle bin).
  - Finance files follow year-first layout: `finance/<yyyy>/<type>/...` (`bills`, `cheques`, `invoices`, `statements`, `subscription-proofs`, `balance-checkpoints`, `ledger-attachments`, `imports`).
  - HR files preserve approved structure: `hr/salary-payment-docs/<yyyy>/<yyyy-mm>/...`, `hr/employees/<id>-<name>/...`, `hr/company-documents/...`.
  - Account folders are structured as `<id>-<bank-slug>-<currency>` (cash accounts: `<id>-<account-name-slug>`).
  - Google Drive is used strictly as an additive, unencrypted one-way backup clone (`deploy/prod/scripts/backup-files-clone.ps1`) for instant disaster recovery and file browsing, plus the existing encrypted tar.gz backup destination; it is not a runtime API backend.
- **Rationale:** Eliminate fragmented storage locations (`BILL_UPLOADS_DIR`, `FINANCE_UPLOADS_DIR`, `LOCAL_STORAGE_PATH`), replace brittle absolute file paths in database tables with root-relative paths, and make the files folder human-browsable and portable without database updates.

### D-036 — Personal Details Behind a Dedicated Permission, One-Row Pay History, Pay Only in the Pay Plan Modal

- **Status:** Accepted by owner, October 21, 2026. Plan: [../finance-module/29-personal-details-and-pay-history-plan.md](../finance-module/29-personal-details-and-pay-history-plan.md). Implemented and merged to `main` (slices S1–S3 on `feature/personal-details-pay-history`). Supersedes decision 6 of D-034 (the create/edit modals no longer carry pay).
- **Decision:** (1) Every pay change writes exactly one `salary_history` record, and every screen, including the Pay plan modal, shows that table as one row per change with Internal and External as columns. (2) The Add/Edit employee modal has no pay fields; after creating an employee the Pay plan modal opens and may be skipped (an employee may have no plan, shown as "Not set"). (3) `name` stays the short display name used everywhere; new `legal_name` is the full legal name used only on the employee page, contracts and rendered payment documents. (4) New personal fields `legal_name`, `phone`, `id_type`, `id_number` join the existing address lines; the ID is optional, validated per type and stored as text. (5) Personal details are HR-admin only through new permissions `hr.employee_personal.read|write|reveal`, served only by a dedicated endpoint, audited, and excluded from lists, self-service and the Sheets export. (6) Payment-doc generation is blocked when the legal name or address line 1 is missing and never falls back to the display name; generated documents are not rewritten when details change.
- **Rationale:** Two pay surfaces and two history shapes kept disagreeing (D-034 findings); the payment documents need a legal name and address that the system's short names and open employee reads should not expose. Production is empty, so the schema and permission changes need no data migration beyond local test data.

### D-037 — Employee Pay Analytics: Composer Architecture, Scoped Permissions, and Export Audit

- **Status:** Accepted by owner, October 24, 2026. Backend implemented and merged to `main` (PR #48). Frontend implemented and merged to `main` (PR #49, merge `fbd3456`); review fixes (plan-change ordering, null effective date, HR-only link and tooltips) are handed to Claude Code on branch `fix/pay-analytics-plan-order`, not yet merged.
- **Decision:**
  1. New read-only composer package `be/analytics/`. It depends on HR and Finance service interfaces only; no domain depends on it.
  2. No new permission. Payments section requires `finance.report.read`. Plan/raises section requires `hr.salary.read`. The endpoint requires at least one of them, otherwise 403.
  3. Sections the caller cannot see are omitted from the response (key absent). No placeholder, no flag that data exists.
  4. Amounts are gross payroll-line amounts as recorded (`base_salary + allowances_total`), as the existing compensation report does. Not net, not statutory.
  5. Classify by `compensation_type`: `external_usd` = base external; `internal_usd_cash` = base internal; any type containing "commission" = commission; "bonus" = bonus. An unknown type is counted under base internal and logged, never dropped.
  6. Cancelled runs are excluded. Draft runs are included with `payment_status = "draft"`.
  7. An employee viewing their own record (self-service scope) gets 403. Unknown employee id gets 404.
  8. Currency: one currency per request, default USD. Never sum across currencies. No FX. Return `currencies_available` with the payments section.
  9. Export audit: log through the existing HR audit repository (`AuditRepository`, as `routers/salary.py` does) with action key `analytics.employee_pay.export`, recording user email, employee id, format and filters.
- **Rationale:** Delivers an employee-level pay view combining gross payment history (split into base external, base internal, commission, bonus) and compensation plan changes (raises) for HR and Finance users while preserving modular-monolith domain boundaries and avoiding cross-domain direct table queries.

---


### D-038 — Compensation Plan Access for HR (Resolves Q-008)

- **Status:** Accepted by owner, October 24, 2026. Resolves Q-008. Not implemented: the code change is a separate slice that needs its own approval. Extends the Q-008 interim treatment recorded with D-011 and D-034.
- **Decision:** (1) Compensation-plan routes accept either the finance key or the matching HR salary key. Write routes (`PUT /api/finance/employees/{id}/compensation-plan` and `PUT .../compensation-plan/{component_type}`) accept `finance.payroll.prepare` or `hr.salary.write`. Read routes (`GET .../compensation-plan`, `.../history`, `.../pay-history`) accept `finance.payroll.read` or `hr.salary.read`. (2) No new permission key and no change to role grants: HR-Admin already holds `hr.salary.read` and `hr.salary.write`, Payroll-Maker and Financial-Admin keep their finance keys. (3) Frontend gating of the Pay plan modal and its entry points follows the same either-or rule. (4) The existing `require_any_permission` guard is reused; nothing else about plan behaviour (D-034, D-036) changes.
- **Rationale:** HR-Admin could record raises through `hr.salary.write` (D-034) but could not open or save the Pay plan modal, so it could not set an employee's starting pay after D-036 removed pay from the create and edit modals. Both paths change the same data, so they should be reachable by the same holders of the HR salary permission. This also avoids granting HR-Admin any finance key.

### D-039 — RBAC Interim Treatments Confirmed as Final (Resolves Q-007, Q-009, Q-011, Q-012)

- **Status:** Accepted by owner, October 24, 2026. Resolves Q-007, Q-009, Q-011 and Q-012. Records the current behaviour; no code change except the verification follow-up in decision 1.
- **Decision:** (1) **Q-007:** Payroll-Maker is not granted `finance.account.read`. The API lets it create a run without that key (the service defaults to the first active company account when none is given). Follow-up, not yet done: check that the payroll run creation screen degrades gracefully for Payroll-Maker (the account list call returns 403) and report; any change to how the funding account is chosen is a separate decision. (2) **Q-009:** `finance.account.*` stays one read/write pair; revisit only if a role needs a subset (for example an auditor who reads the ledger but must not edit accounts). (3) **Q-011:** employees keep upload and delete of their own documents (`self.document.write`) and can view their own bank details (`self.bank_account.read`); they cannot edit their own bank details. Bank details are maintained by HR. (4) **Q-012:** `POST /runs/{run_id}/post-journal` requires `finance.payroll.pay`.
- **Rationale:** The interim treatments from the RBAC initiative (D-011) have run since October 1, 2026 without a role needing a different rule. Keeping bank-detail edits with HR prevents an account swap by the employee; keeping post-journal with the pay permission keeps preparing payroll separate from posting it.

### D-040 — Payroll Cutover Strategy for Historical Data (partly resolves Q-022)

- **Status:** Accepted by owner, October 25, 2026 (recorded from the owner's answers in session). Implementation not started. The step-by-step guide is a draft in the Project: `claude/hrflow-historical-data-cutover-guide-2026-10-25.md`.
- **Decision:** (1) Payroll history for **2023 and 2024 is deferred** (may never be done). Bills, invoices and cash payments for those years are imported as ordinary transactions; salary payments come in as plain transactions. (2) **2025 and 2026** payroll is entered **manually**, one native run per month, in calendar order, with the USD-EGP rate **typed in for each run**. Each month is finalized only after it is compared with the accountant's sheet. The runs stay **unpaid** in HRFlow. (3) **One home for salary cash:** for any month, salary cash exists either as an imported transaction or as a run payment, never both. Salary payments are not part of the bank import. (4) **Raise history first:** every employee's full pay and insured-base history (including 2023-2024 raises) is entered oldest to newest **before** the first 2025 run is finalized, because pay and insured-base changes dated in or before a finalized period are rejected. (5) Employees paid with **no social insurance and a fixed 10% tax** appear in 2025-2026: HRFlow gets an employee-level **tax method setting with its own dated history**, like the insured base (slice FT-1), before those runs: `progressive` (the default when no row exists) or `flat` with the rate stored on the row (10% for these employees); an employee can move from flat to progressive over time, and a move to fully external pay is a pay plan change, not a tax method change. Agreed definition: 10% deducted from gross; applies to salary, bonus and commission; no personal exemption; no social insurance; remitted with the regular payroll tax on its own line. (6) The **fiscal year is January to December**, with the start month as a setting. Reports only (opening balance, money in, money out, spend, closing balance per account and per category); **no year lock for now** (slice FY-1).
- **Rationale:** Native runs read employees who are Active today, with no hire or leave date filter, and recalculate tax and social insurance, so they suit recent months and not history. Salary cash in two places would be counted twice. Locking rules make the order of data entry matter more than the data itself.
- **Not decided:** the historical payroll import (PI-0 to PI-4) stays planned and unscheduled; whether the Social Insurance rate becomes effective-dated (Q-023); handling of employees who joined or left during 2025-2026.
- **Verified in code on October 25, 2026:** a run can stay finalized without being paid and then posts nothing to the ledger; payroll reports include every non-cancelled run; the run FX rate is one value per run and falls back silently to 50.0 when no manual rate and no earlier USD-to-EGP transfer exist; tax is calculated only for the internal USD part; point-in-time balances exist but no fiscal-year concept exists apart from the cheque field.
- **Related References:** [06-open-questions.md](06-open-questions.md) (`Q-022`, `Q-023`); [05-roadmap-and-next-slices.md](05-roadmap-and-next-slices.md) (`3K`); D-025, D-033, D-036, D-037.

### D-041 — Effective-Dated Social Insurance Rates (resolves Q-023)

- **Status:** Accepted by owner, October 25, 2026. Implemented on `feat/payroll-si-rates-effective-dated` (SI-1).
- **Decision:** The employee and employer social insurance rates are effective-dated. New table `finance_payroll_rate_settings` (`effective_from` = first day of a month, `employee_rate`, `employer_rate`); the newest row with `effective_from` on or before the payroll period start applies, like the income tax settings. The migration (`0046`) seeds one row from the current global rates dated `2000-01-01`, so existing results do not change. A rate is added with `POST /api/finance/payroll/settings/rates` (a row with the same date is edited in place, another date is never overwritten) and is rejected when dated in or before the latest finalized, paid or partially paid period. `PUT /api/finance/payroll/settings` with rates and no date creates or edits the row for the first day of the current month. The global `finance_payroll_settings` rates stay as the readable fallback and mirror the rates in force for the current month; the funding accounts stay on that row.
- **Rationale:** A rate change must affect only later periods; a refreshed draft used to re-read the current global setting. The owner's 2023 workbook used 18.75% for the employer share.
- **Owner choices:** no pre-seeded 2023 rate (2023 payroll is deferred by D-040; it can be added later as a dated row); seed date `2000-01-01`; undated `PUT /settings` rates default to the first day of the current month.
- **Related References:** [06-open-questions.md](06-open-questions.md) (`Q-023`); [05-roadmap-and-next-slices.md](05-roadmap-and-next-slices.md) (`3K`, `SI-1`); `docs/finance-module/payroll-si-rates-effective-dated-plan.md`; D-040.

## Related but Not Decisions

The following items are established architectural baseline rules or future roadmaps rather than standalone decision entries:

- **Modular Monolith Architecture:** Established architectural pattern canonically documented in [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md).
- **SQL Persistence & Google Sheets Export Role:** Verified operational facts documented in [01-repository-baseline.md](01-repository-baseline.md) and [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md).
- **Statutory Obligations Workflow Scope (VAT & Annual Income Tax):** Multi-tax obligation tracking is planned roadmap work, not an accepted implementation decision.
- **Branch-Specific Test Status and UI Defects:** Ephemeral test suite results and branch-specific UI defect fixes are historical branch records, not durable product context.
