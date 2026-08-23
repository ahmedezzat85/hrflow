# 05 — Database Redesign Plan (Standalone)

**This document is intentionally self-contained.** It does not require reading the other roadmap files to be useful — read this one on its own when doing the database redesign.

**Scope:** HRFlow currently uses Google Sheets as its primary system of record and Google Drive as its document store (`be/sheets_client.py`, `be/drive_client.py`). This document analyzes why that's the biggest architectural risk in the system today, and lays out a path to a real relational database.

## 1. Current state (as-is)

- **System of record:** Google Sheets. Confirmed by `be/sheets_client.py` (~16.5KB of client logic) handling reads/writes to spreadsheet ranges as the primary data store for employees, salary, insurance, invoices, bank details, requests, and vacations.
- **Document store:** Google Drive (`be/drive_client.py`, ~22KB), used for uploaded files (claims, invoices, documents).
- **Data modeling today:** `be/models.py` contains Pydantic models used for **request/response validation only** — there is no ORM layer (e.g., SQLAlchemy) and no schema migration tool (e.g., Alembic). Pydantic models describe the API contract, not persistent storage structure.
- **Caching layer:** A caching layer was added specifically "to avoid hitting Google Sheets Read Quota Limits" (commit: "Fixing missing invoices backend APIs from api.js / Adding Caching to avoid hitting Google Sheets Read Quota Limits"). This is a direct, self-reported signal that the Sheets-as-database approach has already hit real API rate limits in practice — not a hypothetical future concern.
- **Schema evolution pattern observed:** New columns are added to a `REQUIRED_COLUMNS` list in the sheets schema and "existing spreadsheets self-heal on next connect (existing rows default to blank -> 0)" (see the `internal_salary_usd`/`external_salary_usd` rollout in the salary redesign commits). This is a pragmatic pattern for a spreadsheet but is exactly the kind of implicit, un-versioned schema migration that a real database with proper migrations (Alembic) would make explicit, reviewable, and reversible.

## 2. Why this is the highest-risk architectural item

| Concern | Detail |
|---|---|
| **Quota ceilings** | Google Sheets API has hard read/write quota limits per project/per user. You've already had to build a caching layer to work around this — that's the ceiling making itself felt at current, small scale. It only gets worse as data volume and feature count (see feature gap backlog) grow. |
| **No real transactions** | Sheets has no ACID transaction support. Multi-step writes (e.g., updating an employee's salary AND writing a SalaryHistory row) are not atomic — a partial failure can leave data inconsistent with no rollback. |
| **No row-level locking** | Concurrent edits (two HR staff editing the same employee record at once) can race silently. A spreadsheet has no equivalent of a database's row lock or optimistic-concurrency version column. |
| **No indexing** | Lookups scale linearly with sheet size (effectively a full scan via the Sheets API for most query patterns). Fine at dozens of employees; noticeably degraded at a few hundred. |
| **Row/cell limits** | Google Sheets has a hard ceiling of 10 million cells per spreadsheet (varies by plan/version, but always finite). This is a real, if distant, wall. |
| **Weak referential integrity** | Relationships between employees, salary history, insurance claims, invoices, and bank details are maintained by convention (matching IDs across sheets/tabs) rather than enforced foreign keys. Nothing stops an orphaned row from being created. |
| **Un-auditable at the storage layer** | Compared to a real RDBMS with write-ahead logs and point-in-time recovery, Sheets' version history is coarse-grained and not designed for compliance-grade audit trails — even though the app *does* have application-level audit logging (Phase 5 security work), the underlying store itself offers no equivalent guarantee. |
| **Implicit schema migrations** | The `REQUIRED_COLUMNS` self-healing pattern works, but it's silent and un-reviewed compared to an Alembic migration file that a teammate can read in a PR diff. |

## 3. Target architecture

**Recommendation: PostgreSQL** as the system of record, keeping Google Drive for document/file storage (no need to change that part — it's a reasonable choice for binary file storage regardless of what the structured-data store is).

### Why PostgreSQL specifically
- Strong relational integrity (foreign keys, constraints) — directly solves the referential integrity gap.
- Mature Python ecosystem fit for FastAPI: SQLAlchemy (ORM) + Alembic (migrations) is the standard, well-documented pairing.
- Works identically whether deployed via Google Cloud SQL (Option A in the deployment plan) or a local container (Option B) — no lock-in either direction.
- JSON/JSONB column support gives you an escape hatch for any semi-structured data you're not ready to fully normalize yet (useful during incremental migration).

### Proposed high-level schema shape (starting point, not final)

This is a **starting sketch** to seed the actual migration design — validate field-by-field against the real current Sheets columns before finalizing.

- `employees` — core identity/employment fields (name, role, start date, status, manager_id FK to self for org chart readiness per the feature gap backlog)
- `salary_components` — internal_salary_usd, external_salary_usd, effective_date, employee_id FK (replaces the flat derived `salary` column pattern seen in the salary redesign commits)
- `salary_history` — per-component before/after deltas, already modeled in the app logic (`SalaryHistory` per the "stage5" commits) — this maps almost directly to a relational table today
- `bank_accounts` — employee_id FK, account details
- `insurance_claims` — employee_id FK, claim status, amounts, linked document references (Drive file IDs)
- `invoices` — employee_id FK, invoice metadata, linked Drive file ID for the generated PDF
- `vacation_requests` / `leave_requests` — employee_id FK, approver_id FK (once org chart exists), status, dates
- `documents` — employee_id FK (nullable for company-wide docs), Drive file ID, document type
- `audit_log` — already exists at the application level (Phase 5); should move into the relational store for real queryability (currently unclear if it's Sheets-backed too — confirm during migration design)

### What stays on Google Drive
- Actual file binaries (claim attachments, invoices, contracts). No reason to move these into the database as BLOBs — keep Drive as the file store, just reference Drive file IDs from the new relational tables instead of from spreadsheet rows.

## 4. Migration strategy

Do **not** attempt a big-bang cutover. Suggested phased approach:

### Phase 1 — Parallel-write (shadow mode)
- Stand up PostgreSQL (locally first, via Docker Compose).
- Introduce SQLAlchemy models + Alembic migrations mirroring the schema sketch above.
- Modify write paths (`be/routers/*`) to write to **both** Sheets (existing) and Postgres (new), reads still come from Sheets.
- Goal: validate the new schema and catch data-shape surprises with zero user-facing risk, since Sheets remains the source of truth during this phase.

### Phase 2 — Backfill and reconcile
- Write a one-time backfill script to copy all historical Sheets data into Postgres.
- Write a reconciliation script that diffs Sheets vs. Postgres for a period (e.g., one to two weeks of parallel-write) to catch any write-path bugs before cutover.

### Phase 3 — Read cutover (per domain, not all at once)
- Switch reads to Postgres one router/domain at a time, starting with the lowest-risk domain (candidates: `vacations` or `bank`, given their small current footprint per `01-feature-gap-plan.md` / `02-ux-ui-redesign-plan.md`) rather than `employees` or `salary` first.
- Keep dual-write running during this phase as a safety net.
- Only move to the next domain once the previous one has run cleanly in production for a defined soak period.

### Phase 4 — Retire Sheets as system of record
- Once all domains are reading and writing exclusively from Postgres, stop dual-writing.
- Keep a final export of the historical Sheets data as a cold-storage backup/audit artifact — do not delete it outright.
- Update `be/sheets_client.py` usage — either remove it entirely or repurpose it only if there's a remaining legitimate use case (e.g., an HR-staff-facing "export to Sheets" convenience feature is fine to keep, just not as the source of truth).

### Phase 5 — Remove the caching workaround
- Once Sheets quota is no longer a constraint (because Postgres is the store), the caching layer that was added specifically to avoid Sheets read-quota limits can likely be simplified or removed — re-evaluate its purpose at this point since Postgres has its own, much higher performance ceiling.

## 5. Risks and mitigations during migration

| Risk | Mitigation |
|---|---|
| Data-shape mismatches between Sheets' loosely-typed cells and Postgres' strict columns | Phase 1's parallel-write approach surfaces these early, before any read traffic depends on Postgres |
| Downtime during cutover | Per-domain phased cutover (Phase 3) means any single domain's issue doesn't take down the whole app |
| Losing historical audit trail | Explicit cold-storage export step in Phase 4 before any deletion |
| Team unfamiliarity with SQLAlchemy/Alembic if new to the stack | Start Phase 1 with the smallest, simplest table (e.g., `bank_accounts`) as a learning exercise before tackling `employees`/`salary` |
| Scope creep (redesigning the schema *and* adding new fields at the same time) | Keep the first migration a faithful structural port of existing Sheets columns; layer in schema improvements (like the `manager_id` org-chart field) as a clearly separate, later change |

## 6. Decision this document is meant to support

Once you're ready to start, the concrete next step is: **stand up Postgres locally via Docker Compose, and write the first Alembic migration for the simplest existing domain (`bank_accounts` or `vacations`)** as a proof of concept before touching `employees` or `salary`. Everything else in this document should follow from validating that first slice.
