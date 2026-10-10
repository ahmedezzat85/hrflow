# HRFlow Open Questions

**Status:** Draft — needs owner decisions  
**Last verified against:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main`)  
**Last updated:** October 1, 2026  
**Branch note:** Q-006 to Q-013 were added on `feature/rbac` and are not part of `main` until the branch is merged. On October 1, 2026 the owner approved the interim treatments for Q-006 to Q-009, Q-011 and Q-012 and resolved Q-010 as recommended; Q-013 was raised afterwards and approved on October 2, 2026.  
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
- **Status:** Resolved — D-025 (October 10, 2026): Option A, net pay only; employer tax and social insurance are paid as statutory obligations.  
- **Question:**  
  When a payroll run is marked `Paid`, should company bank balances and payment settlement records reflect:  
  A. Net employee pay only, with employer tax and social-insurance obligations settled separately; or  
  B. The full employer cost, including employer-side statutory contributions?  
- **Why It Matters:**  
  This decision dictates cash balance accuracy, liability timing, expense presentation, and statutory reconciliation in general ledger reporting.  
- **Known Current Context:**  
  - Baseline analysis in [01-repository-baseline.md](01-repository-baseline.md) confirms that current code records net-pay disbursements against selected funding accounts.  
  - Decisions `D-001` and `D-002` in [04-decision-log.md](04-decision-log.md) require explicit separation between internal estimates, portal-confirmed liabilities, actual paid amounts, and variance.  
  - Neither option is formally approved as the durable product rule. Code reconciliation (October 1, 2026): `payroll_service.post_journal` posts only net-disbursement entries (never deduction, tax, employer-cost, or liability lines), which matches Option A in behavior.  
- **Decision Needed from Owner:**  
  Select Option A or B, and define whether the non-disbursed portion is accrued as an independent statutory obligation.  
- **Related References:**  
  - [01-repository-baseline.md](01-repository-baseline.md)  
  - [04-decision-log.md](04-decision-log.md) (`D-001`, `D-002`)  

### Q-002 — Creation Model for Non-Payroll Statutory Obligations
- **Status:** Partly resolved — D-023 (October 10, 2026): VAT estimates are created on demand by the user from invoices (no scheduler). Annual corporate income tax remains open.  
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

### Q-006 — Restoring Archived Users
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  Can an archived user ever be restored? The owner wants history kept and a guarantee that they never regain access. Options: (a) archive is terminal and a returning person needs a new record (but `users.email` is unique, so the old record must free the email or be reused); (b) Super-Admin-only, audited restore.  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: Archived blocks access; restore is not built until decided.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-007 — Payroll-Maker Access to Funding Accounts
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  Payroll-Maker data access. Creating a run takes company funding-account IDs; listing them needs `finance.account.read`, which the role lacks. Owner chose to keep as is for now.  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: No grant; verify during implementation.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-008 — Ownership of Employee Compensation Plans
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  Who maintains employee compensation plans? The endpoints sit under `finance.payroll.*` but HR-Admin has no finance access.  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: Mapped to `finance.payroll.prepare`.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-009 — Splitting `finance.account` Permissions
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  Split `finance.account.*` (bank accounts, ledger, transfers, cheques, statements, rules, categories, payment types)?  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: Keep one pair; revisit if a role needs a subset.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-010 — Permission-Catalog Sync Strategy
- **Status:** Resolved — D-011 (October 1, 2026): sync permission rows and Super-Admin at application start through the existing `init_db()` path; grant new keys to editable roles only through migrations.  
- **Question:**  
  When does the catalog sync run: at application start, in migrations only, or by an explicit command?  
- **Known Current Context:**  
  - Correction to the original draft: a startup path already exists. `be/main.py` calls `init_db()` at import, which runs `seed_rbac` on every start (and re-links users to roles from the legacy `users.role`; that re-link is removed by D-011).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`)  

### Q-011 — Employee Self-Service Writes
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  Employee self-service writes: confirm own-document upload/delete stays (current behavior) and whether own bank-detail edits are wanted (not included).  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: As stated.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-012 — Post-Journal Permission for Payroll
- **Status:** Open — interim treatment approved October 1, 2026  
- **Question:**  
  `post-journal` assigned to `finance.payroll.pay` — confirm.  
- **Why It Matters:**  
  Part of the RBAC initiative (D-011 to D-013, accepted October 1, 2026); the answer changes the permission catalog, role grants, or lifecycle rules.  
- **Known Current Context:**  
  - Interim treatment until decided: As stated.  
  - Details: [rbac/technical-spec.md](rbac/technical-spec.md) and [rbac/implementation-plan.md](rbac/implementation-plan.md).  
- **Decision Needed from Owner:**  
  Choose an option or confirm the interim treatment, then record it in [04-decision-log.md](04-decision-log.md).  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`, `D-012`, `D-013`)  

### Q-013 — Self-Approval Bypass After the Payroll Split
- **Status:** Resolved — D-011 (October 2, 2026): the `allow_self_approval` bypass is honored only for a caller who holds both `finance.payroll.prepare` and `finance.payroll.approve` (by default only Super-Admin).  
- **Question:**  
  `approve_run` blocks approval by the user who submitted a run, but any `finance.payroll.write` holder can bypass it with the `allow_self_approval=true` query parameter (and the env var `ENFORCE_MAKER_CHECKER=false` disables it globally). After the prepare/approve/pay split, should the bypass be honored only for a caller who holds both `finance.payroll.prepare` and `finance.payroll.approve` (by default only Super-Admin)?  
- **Why It Matters:**  
  Without this, Payroll-Maker would still be able to approve their own run by passing the parameter if they ever held an approve key, and Super-Admin could not do both steps as the owner intends.  
- **Known Current Context:**  
  - Code: `be/finance/services/payroll_service.py` (`approve_run`) and `be/finance/routers/payroll.py` (`allow_self_approval` query parameter).  
  - Current behavior is unchanged until RBAC slice 4 implements the decision.  
- **Decision Needed from Owner:**  
  None; approved by the owner on October 2, 2026.  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-011`)  
  - [rbac/implementation-plan.md](rbac/implementation-plan.md)  

### Q-014 — Finance Bills Restyle: Direction, FUX-414 Layout, Density Default, Button Icons
- **Status:** Resolved — D-021 (October 9, 2026): direction A "Clean Table"; FUX-414 pill and Change view replaced by an always-visible status row (owner override); FUX-415 density setting kept with Regular as default; no icons on in-page tabs and text buttons.  
- **Question:**  
  Which visual direction for the shared Finance components, may it replace the FUX-414 layout, should the density default change, and should in-page tabs and text buttons keep icons?  
- **Related References:**  
  - [04-decision-log.md](04-decision-log.md) (`D-021`)  
  - [../finance-module/19-finance-ui-restyle-direction-a.md](../finance-module/19-finance-ui-restyle-direction-a.md)  

---

## Resolved-Question Procedure

When an open question reaches an owner decision, follow this three-step procedure:

1. **Record Decision:** The repository owner records the agreed outcome in [04-decision-log.md](04-decision-log.md) as a new decision entry (or an explicit update/supersession of an existing entry).  
2. **Update Register:** This register updates the question status to `Resolved`, referencing the decision ID (e.g., `D-008`), completion date, and a one-line summary of the chosen path.  
3. **Scoped Implementation:** Architecture, roadmap, schema, test, and operational documentation are updated only as part of the subsequent scoped task that implements the decision.
