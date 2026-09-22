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
  - Payroll run generation must read employee master salary fields ([be/models_db.py](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/be/models_db.py)) and default `PayrollLineDB` figures accordingly.
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
  - The worksheet UI must support inline bonus adder popovers and dynamic recalculation of net totals.
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
  - Marking payroll as "Paid" generates internal ledger and payment records without requiring external banking integrations.
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
  - Surface prominent non-blocking warning banners in the payroll worksheet; do not block draft compilation or review progression.
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
  - The export engine must layout employee payroll records horizontally in a single flat row per individual.
- **Evidence / Reference:**
  - Owner-approved payroll design context (September 2026).
  - *Implementation Status:* Requires repository verification.

---

## Related but Not Decisions

The following items are established architectural baseline rules or future roadmaps rather than standalone decision entries:

- **Modular Monolith Architecture:** Established architectural pattern canonically documented in [02-architecture-and-domain-boundaries.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/project-context/02-architecture-and-domain-boundaries.md).
- **SQL Persistence & Google Sheets Export Role:** Verified operational facts documented in [01-repository-baseline.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/project-context/01-repository-baseline.md) and [02-architecture-and-domain-boundaries.md](file:///d:/Voyance/DICOM_UTILITY/HR/hrflow/docs/project-context/02-architecture-and-domain-boundaries.md).
- **Statutory Obligations Workflow Scope (VAT & Annual Income Tax):** Multi-tax obligation tracking is planned roadmap work, not an accepted implementation decision.
- **Branch-Specific Test Status and UI Defects:** Ephemeral test suite results and branch-specific UI defect fixes are historical branch records, not durable product context.
