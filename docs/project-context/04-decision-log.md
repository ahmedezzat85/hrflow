# HRFlow Decision Log

**Status:** Draft — needs owner review  
**Last verified against:** `main` at `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`  
**Last updated:** September 22, 2026  
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
  - *Implementation Status:* In progress (six-screen redesign implementation).

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

---

## Related but Not Decisions

The following items are established architectural baseline rules or future roadmaps rather than standalone decision entries:

- **Modular Monolith Architecture:** Established architectural pattern canonically documented in [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md).
- **SQL Persistence & Google Sheets Export Role:** Verified operational facts documented in [01-repository-baseline.md](01-repository-baseline.md) and [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md).
- **Statutory Obligations Workflow Scope (VAT & Annual Income Tax):** Multi-tax obligation tracking is planned roadmap work, not an accepted implementation decision.
- **Branch-Specific Test Status and UI Defects:** Ephemeral test suite results and branch-specific UI defect fixes are historical branch records, not durable product context.
