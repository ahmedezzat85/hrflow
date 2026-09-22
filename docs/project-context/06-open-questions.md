# HRFlow Open Questions

**Status:** Draft — needs owner decisions  
**Last verified against:** `main` at `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`  
**Last updated:** September 22, 2026  
**Authority:** Repository baseline and unreconciled owner-level questions  

---

## How to Use This Register

This register tracks unresolved product, accounting, and technical architecture questions that require owner decisions:

- **Unresolved Status:** An entry represents an open question, not an agreed proposal, implementation task, or accepted policy.
- **No Speculative Implementation:** Do not build solutions or assume a specific direction merely because an option is described here.
- **Resolution Path:** When the repository owner decides an outcome, the decision is formally recorded in [04-decision-log.md](04-decision-log.md). This register is then updated to reflect `Resolved` status, citing the decision ID and date.
- **Operational Reality:** Current code, Alembic migrations, and automated tests on `main` remain the operational ground truth while questions remain open.

---

## Questions

### Q-001 — Payroll Paid-State Funding Scope
- **Status:** Open — blocks financial-reporting certainty  
- **Question:**  
  When a payroll run is marked `Paid`, should company bank balances and payment settlement records reflect:  
  A. Net employee pay only, with employer tax and social-insurance obligations settled separately; or  
  B. The full employer cost, including employer-side statutory contributions?  
- **Why It Matters:**  
  This decision dictates cash balance accuracy, liability timing, expense presentation, and statutory reconciliation in general ledger reporting.  
- **Known Current Context:**  
  - Baseline analysis in [01-repository-baseline.md](01-repository-baseline.md) confirms that current code records net-pay disbursements against selected funding accounts.  
  - Decisions `D-001` and `D-002` in [04-decision-log.md](04-decision-log.md) require explicit separation between internal estimates, portal-confirmed liabilities, actual paid amounts, and variance.  
  - Neither option is formally approved as the durable product rule.  
- **Decision Needed from Owner:**  
  Select Option A or B, and define whether the non-disbursed portion is accrued as an independent statutory obligation.  
- **Related References:**  
  - [01-repository-baseline.md](01-repository-baseline.md)  
  - [04-decision-log.md](04-decision-log.md) (`D-001`, `D-002`)  

### Q-002 — Creation Model for Non-Payroll Statutory Obligations
- **Status:** Open — affects statutory workflow design  
- **Question:**  
  For VAT and annual corporate income-tax obligations, should HRFlow:  
  A. Create recurring obligation records automatically on a defined schedule; or  
  B. Require authorized users to create them manually?  
- **Why It Matters:**  
  This impacts data-model complexity, scheduler/background infrastructure requirements, operational controls, and user accountability for non-payroll tax liabilities.  
- **Known Current Context:**  
  - Decision `D-001` establishes that official government portals are authoritative for final statutory liabilities.  
  - Architecture documentation in [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md) confirms that no asynchronous background queue or scheduler currently exists.  
  - Automatic scheduled generation does not currently exist in the codebase.  
- **Decision Needed from Owner:**  
  Select Option A or B. If Option A is chosen, define the recurrence schedule, approval requirements, and whether introducing a background scheduler is a prerequisite.  
- **Related References:**  
  - [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md)  
  - [04-decision-log.md](04-decision-log.md) (`D-001`, `D-002`)  

### Q-003 — Production Document-Storage Direction
- **Status:** Open — affects deployment architecture  
- **Question:**  
  Should Google Drive remain the long-term production document store, or should HRFlow adopt an S3-compatible object store for containerized cloud deployments?  
- **Why It Matters:**  
  This choice impacts production credential management, container portability, horizontal scaling, backup retention policies, and file streaming access.  
- **Known Current Context:**  
  - The application currently supports Google Drive and local filesystem storage via `StorageClient`.  
  - Baseline documentation in [01-repository-baseline.md](01-repository-baseline.md) flags long-term cloud storage as an open question.  
  - Migration to an S3-compatible store is not currently approved.  
- **Decision Needed from Owner:**  
  Choose:  
  A. Retain Google Drive as the supported production cloud store;  
  B. Adopt an S3-compatible store as the primary cloud backend; or  
  C. Retain both behind the existing storage abstraction, defining which is the production default.  
- **Related References:**  
  - [01-repository-baseline.md](01-repository-baseline.md)  
  - [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md)  

### Q-004 — Automated Foreign-Exchange-Rate Source
- **Status:** Open — affects multi-currency finance behavior  
- **Question:**  
  Should HRFlow retain manual foreign-exchange (FX) rate entry only, or integrate an external automated FX-rate feed?  
- **Why It Matters:**  
  This affects multi-currency transaction valuation, auditability, system availability during network interruptions, and financial reporting consistency.  
- **Known Current Context:**  
  - Inter-account transfers and ledger records support multi-currency operations.  
  - Baseline findings in [01-repository-baseline.md](01-repository-baseline.md) indicate that FX rates are currently entered manually by operators.  
  - No automated feed is currently implemented or configured.  
- **Decision Needed from Owner:**  
  Choose:  
  A. Retain manual rate entry as the supported operational model;  
  B. Integrate an external automated market rate feed; or  
  C. Use an external feed with mandatory manual override capabilities.  
- **Related References:**  
  - [01-repository-baseline.md](01-repository-baseline.md)  

### Q-005 — Legacy Google Sheets Export Retention
- **Status:** Open — affects technical-debt cleanup and integrations  
- **Question:**  
  Is Google Sheets export still required by business stakeholders now that audited Excel exports exist, or can the Sheets export integration and associated service-account scopes be retired?  
- **Why It Matters:**  
  Determines whether legacy export code, service account credentials, operational dependencies, and maintenance overhead remain necessary.  
- **Known Current Context:**  
  - Relational SQL is the authoritative database; Google Sheets is strictly an export destination.  
  - The codebase retains Sheets integration code and transitional repositories.  
  - Baseline documentation in [01-repository-baseline.md](01-repository-baseline.md) identifies Sheets export retirement as an open technical-debt decision.  
- **Decision Needed from Owner:**  
  Choose:  
  A. Retain Google Sheets export indefinitely;  
  B. Retire Sheets export following a stakeholder migration and communication plan; or  
  C. Retain temporarily with a defined review date and assigned business owner.  
- **Related References:**  
  - [01-repository-baseline.md](01-repository-baseline.md)  
  - [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md)  

---

## Resolved-Question Procedure

When an open question reaches an owner decision, follow this three-step procedure:

1. **Record Decision:** The repository owner records the agreed outcome in [04-decision-log.md](04-decision-log.md) as a new decision entry (or an explicit update/supersession of an existing entry).  
2. **Update Register:** This register updates the question status to `Resolved`, referencing the decision ID (e.g., `D-008`), completion date, and a one-line summary of the chosen path.  
3. **Scoped Implementation:** Architecture, roadmap, schema, test, and operational documentation are updated only as part of the subsequent scoped task that implements the decision.
