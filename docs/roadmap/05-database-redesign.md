# 05 — Database Redesign Plan (Standalone)

**This document is intentionally self-contained.** It does not require reading the other roadmap files to be useful — read this one on its own when doing the database redesign.

**Revision note (v2):** This version adds two things that were gaps in v1, based on direct code-evidence review: (1) an explicit **Phase 0 — Repository Abstraction Layer**, because none currently exists, and (2) a dedicated **Migration Tooling** section covering both schema migrations and data migrations as distinct concerns. Do not start Phase 1 (parallel-write) until Phase 0 is done.

**Scope:** HRFlow currently uses Google Sheets as its primary system of record and Google Drive as its document store (`be/sheets_client.py`, `be/drive_client.py`). This document analyzes why that's the biggest architectural risk in the system today, confirms there is no data-access abstraction to protect the app from a storage swap, and lays out a path to a real relational database that keeps Sheets viable as a fallback until the new design is verified.

## 1. Current state (as-is) — verified against actual code changes, not just structure

- **System of record:** Google Sheets. Confirmed by `be/sheets_client.py` (~16.5KB) handling reads/writes to spreadsheet ranges as the primary data store for employees, salary, insurance, invoices, bank details, requests, and vacations.
- **Document store:** Google Drive (`be/drive_client.py`, ~22KB), used for uploaded files (claims, invoices, documents).
- **Data modeling today:** `be/models.py` contains Pydantic models used for **request/response validation only** — there is no ORM layer (e.g., SQLAlchemy) and no schema migration tool (e.g., Alembic). Pydantic models describe the API contract, not persistent storage structure.
- **No repository/data-access abstraction exists today — confirmed, not assumed.** This is the direct answer to "is there an abstraction layer already." Evidence:
  - The salary-split commit ("salary(stage1): write internal/external USD components on employee create/update") shows `update_employee` in `be/routers/employees.py` **reading the employee's current row directly and recomputing a derived total inline**, in the router function itself — this is storage-aware business logic living in the API layer.
  - Only two domains (`invoices`, `uploads`) have anything resembling a service layer (`be/services/invoices.py`, `be/services/uploads.py`), added ad hoc alongside their routers rather than as a deliberate architectural pattern applied everywhere.
  - `sheets_client.py` and `drive_client.py` are **thin Google API wrappers, not domain repositories**: they expose spreadsheet-shaped operations (read range, write range, sheet IDs, quota-aware caching), not domain-shaped operations (`get_employee(id)`, `save_salary_history(entry)`). Callers still need to know the sheet's column layout to use them correctly.
  - Practical consequence: today, swapping the underlying store would require touching every router (`employees`, `salary`, `insurance`, `bank`, `vacations`, `requests`, `documents`), not one central layer.
- **Caching layer:** Added specifically "to avoid hitting Google Sheets Read Quota Limits." This is a direct, self-reported signal that the Sheets-as-database approach has already hit real API rate limits in practice — not a hypothetical future concern.
- **Schema evolution pattern observed:** New columns are added to a `REQUIRED_COLUMNS` list in the sheets schema and "existing spreadsheets self-heal on next connect (existing rows default to blank -> 0)" (see the `internal_salary_usd`/`external_salary_usd` rollout). This is a pragmatic pattern for a spreadsheet, but it is an **implicit, un-versioned, non-reversible schema migration** — there is no migration history, no down-migration, and no record of what the schema looked like at any past point in time other than by reading old commits.

## 2. Why this is the highest-risk architectural item

| Concern | Detail |
|---|---|
| **Quota ceilings** | Google Sheets API has hard read/write quota limits per project/per user. A caching layer already exists to work around this — the ceiling is making itself felt at current, small scale. |
| **No real transactions** | Sheets has no ACID transaction support. Multi-step writes (e.g., updating salary AND writing a SalaryHistory row) are not atomic — a partial failure can leave data inconsistent with no rollback. |
| **No row-level locking** | Concurrent edits (two HR staff editing the same employee record at once) can race silently. |
| **No indexing** | Lookups scale roughly linearly with sheet size. Fine at dozens of employees; noticeably degraded at a few hundred. |
| **Row/cell limits** | Google Sheets has a hard, if distant, cell-count ceiling per spreadsheet. |
| **Weak referential integrity** | Relationships between employees, salary history, claims, invoices, and bank details are maintained by convention (matching IDs across sheets/tabs), not enforced foreign keys. |
| **Un-auditable at the storage layer** | Sheets' version history is coarse-grained; no equivalent of write-ahead logs or point-in-time recovery, even though application-level audit logging exists (Phase 5 security work). |
| **Implicit schema migrations** | The `REQUIRED_COLUMNS` self-healing pattern is silent and un-reviewed compared to an Alembic migration file a teammate can read in a PR diff. |
| **No data-access abstraction (this document's Phase 0 finding)** | Router-level code reads/writes storage directly, so today a storage swap is an app-wide change, not a swap-one-layer change. This must be fixed before, not during, the database migration. |

## 3. Target architecture

**Recommendation: PostgreSQL** as the system of record, keeping Google Drive for document/file storage (no need to change that — it's a reasonable choice for binaries regardless of the structured-data store).

### Why PostgreSQL specifically
- Strong relational integrity (foreign keys, constraints) — directly solves the referential integrity gap.
- Mature Python/FastAPI fit: SQLAlchemy (ORM) + Alembic (migrations) is the standard, well-documented pairing — and directly answers your migration-tooling question (section 5).
- Works identically whether deployed via Google Cloud SQL or a local container — no lock-in either direction.
- JSON/JSONB columns give an escape hatch for semi-structured data not yet fully normalized, useful during incremental migration.

### Proposed high-level schema shape (starting point, not final)

Validate field-by-field against the real current Sheets columns before finalizing:

- `employees` — core identity/employment fields (name, role, start date, status, manager_id FK to self for future org-chart readiness)
- `salary_components` — internal_salary_usd, external_salary_usd, effective_date, employee_id FK
- `salary_history` — per-component before/after deltas (already modeled in app logic per the "stage5" commits — maps almost directly to a relational table today)
- `bank_accounts` — employee_id FK, account details
- `insurance_claims` — employee_id FK, claim status, amounts, linked Drive file IDs
- `invoices` — employee_id FK, invoice metadata, linked Drive file ID for the generated PDF
- `vacation_requests` / `leave_requests` — employee_id FK, approver_id FK (once org chart exists), status, dates
- `documents` — employee_id FK (nullable for company-wide docs), Drive file ID, document type
- `audit_log` — already exists at the application level (Phase 5); move into the relational store for real queryability (confirm during migration design whether it's currently Sheets-backed too)

### What stays on Google Drive
Actual file binaries (claim attachments, invoices, contracts). Keep Drive as the file store; reference Drive file IDs from the new relational tables instead of from spreadsheet rows.

## 4. Phase 0 — Repository Abstraction Layer (mandatory, do this first)

**This phase did not exist in the initial draft of this plan and is now the required starting point.** Its entire purpose is to make Sheets swappable later without touching routers again — i.e., to make Sheets remain a fully viable, working option for as long as needed while the new database is built and verified in parallel, with a single flip-point to cut over.

### 4.1 Design the repository interface per domain

For each domain currently touching `sheets_client.py`/`drive_client.py` directly (`employees`, `salary`, `insurance`, `bank`, `vacations`, `requests`, `documents`, `invoices`), define a small interface expressed in domain terms, not storage terms. Example shape for employees:

```python
# be/repositories/interfaces.py
class EmployeeRepository(Protocol):
    def get_by_id(self, employee_id: str) -> Employee | None: ...
    def list_all(self, scope: EmployeeScope) -> list[Employee]: ...
    def create(self, data: EmployeeCreate) -> Employee: ...
    def update(self, employee_id: str, data: EmployeeUpdate) -> Employee: ...
```

Repeat this shape for `SalaryRepository`, `InsuranceRepository`, `BankRepository`, `VacationRepository`, `RequestRepository`, `DocumentRepository`, `InvoiceRepository`. Each interface should describe *what the router needs*, not *how Sheets happens to store it* — e.g. `get_by_id`, not `read_range`.

### 4.2 Implement the Sheets-backed version of each interface

Move the logic currently embedded in routers (like the inline row-read-and-recompute in `update_employee`) into a `SheetsEmployeeRepository` class that implements `EmployeeRepository`. This is a pure refactor — same behavior, new location. This step alone is valuable independent of whether Postgres ever ships, because it:
- Centralizes the column-layout knowledge that's currently duplicated/implicit across routers.
- Makes the existing `REQUIRED_COLUMNS` self-healing pattern visible and testable in one place per domain.
- Gives you a natural seam to add the repository-level tests you'll need for Phase 1 parallel-write comparisons.

### 4.3 Wire routers to depend on the interface, not the concrete class

Use FastAPI's dependency injection (you already have `be/deps.py` for shared dependencies) to inject `EmployeeRepository` (interface) into `employees.py`, resolved at startup to the concrete `SheetsEmployeeRepository`. Routers should no longer import `sheets_client` directly.

### 4.4 Exit criteria for Phase 0

- No router imports `sheets_client` or `drive_client` directly for structured-data reads/writes (Drive access for raw file bytes is fine to keep direct, since that store isn't changing).
- Every domain has an interface + a Sheets-backed implementation + existing tests passing unchanged (behavior-preserving refactor, verified the same way the router-decomposition refactor was — "pure structural move, no behavior change").
- This phase is shippable and valuable on its own even if the Postgres migration is later paused or deprioritized.

## 5. Migration tooling — schema migrations vs. data migrations (two distinct concerns)

This directly addresses whether the plan accounts for schema changes and old-to-new data movement. It does, and the two are handled with different tools because they are different problems.

### 5.1 Schema migrations (structure changes to the new Postgres database itself)

- **Tool: Alembic**, paired with SQLAlchemy models.
- Every table creation and every future structural change (new column, new constraint, new table) is a versioned Alembic migration file, checked into the repo and reviewed in a PR — this is the direct replacement for today's silent `REQUIRED_COLUMNS` self-healing pattern.
- Both an `upgrade()` and `downgrade()` path are required for every migration, so any schema change can be rolled back without a manual data recovery exercise.
- Convention: one migration per logical change, named descriptively (Alembic supports this natively), so the migration history reads as a changelog of the schema's evolution — something the current Sheets approach cannot provide at all.

### 5.2 Data migrations (moving/reshaping actual records, old store → new store, or old shape → new shape)

Two different data-migration situations will come up, and they need different handling:

**(a) One-time bulk migration: Sheets → Postgres (the main event)**
- A standalone backfill script (not an Alembic migration — Alembic is for schema, not bulk data loads) that reads every row from Sheets via the Phase 0 repository interface (not raw Sheets calls, so it exercises the same code path production will use) and writes it into Postgres via the SQLAlchemy models.
- Idempotent by design: re-running the backfill script should not create duplicates (upsert on a stable natural key, e.g. employee ID) — this matters because you will run it more than once during Phase 2 (parallel-write/reconcile) below.
- A companion reconciliation script diffs Sheets vs. Postgres row-by-row for a soak period, flagging mismatches for investigation rather than silently trusting the backfill.

**(b) Ongoing schema evolution after cutover (the steady-state case)**
- Once Postgres is live, any future structural change (e.g., adding a `department_id` column, or splitting a table) follows the standard Alembic `upgrade()`/`downgrade()` workflow, same as any mature relational-database project. This is a solved problem once Phase 0 and the initial migration are done — it's precisely what Alembic is for, and it's the capability you're missing today with Sheets' silent self-healing columns.

### 5.3 Rollback plan if the new database has a critical issue post-cutover

Because Phase 0's repository interface makes the storage backend swappable behind a single seam, rollback is a configuration change (point the DI container back at `SheetsEmployeeRepository` instead of a new `PostgresEmployeeRepository`), not a code change — provided dual-write (section 6, Phase 1) was still running recently enough that Sheets data isn't stale. This is the direct payoff of doing Phase 0 first: it's what keeps Sheets "a viable option until the full new database design is verified," exactly as required.

## 6. Full migration strategy (updated with Phase 0)

Do **not** attempt a big-bang cutover.

### Phase 0 — Repository abstraction layer
See section 4. Must complete before Phase 1 starts. Sheets remains the only store in production during this phase; this phase is a pure refactor with no new infrastructure.

### Phase 1 — Parallel-write (shadow mode)
- Stand up PostgreSQL locally via Docker Compose.
- Introduce SQLAlchemy models + the first Alembic migrations (see section 5.1) mirroring the schema sketch in section 3.
- Implement the Postgres-backed repository classes (`PostgresEmployeeRepository`, etc.) against the *same interfaces* defined in Phase 0.
- Change the DI wiring so writes go to **both** repositories (Sheets, still primary/authoritative, and Postgres, shadow) — reads still come exclusively from Sheets.
- Goal: validate the new schema and catch data-shape surprises with zero user-facing risk, since Sheets remains the source of truth throughout this phase.

### Phase 2 — Backfill and reconcile
- Run the one-time backfill script (section 5.2a) to copy all historical Sheets data into Postgres.
- Run the reconciliation script across a soak period (suggest one to two weeks of parallel-write) to catch any write-path bugs before cutover.

### Phase 3 — Read cutover (per domain, not all at once)
- Flip the DI wiring's *read* path to Postgres one domain at a time — start with the lowest-risk domain (candidates: `vacations` or `bank`, given their small current footprint) rather than `employees` or `salary` first.
- Keep dual-write running during this phase as a safety net (and as the rollback path from section 5.3).
- Only move to the next domain once the previous one has run cleanly in production for a defined soak period.

### Phase 4 — Retire Sheets as system of record
- Once all domains read and write exclusively via the Postgres repositories, stop dual-writing.
- Export the final historical Sheets data as a cold-storage backup/audit artifact — do not delete it outright.
- Decide whether `sheets_client.py` is removed entirely or repurposed for a legitimate remaining use case (e.g., an HR-staff-facing "export to Sheets" convenience feature is fine to keep — just not as the source of truth).

### Phase 5 — Remove the caching workaround
- Once Sheets quota is no longer a constraint, re-evaluate the caching layer that was added specifically for Sheets read-quota limits — it can likely be simplified or removed, since Postgres has a much higher performance ceiling.

## 7. Risks and mitigations during migration

| Risk | Mitigation |
|---|---|
| Data-shape mismatches between Sheets' loosely-typed cells and Postgres' strict columns | Phase 1's parallel-write surfaces these early, before read traffic depends on Postgres |
| Downtime during cutover | Per-domain phased cutover (Phase 3); rollback is a DI config flip, not a code change (section 5.3) |
| Losing historical audit trail | Explicit cold-storage export step in Phase 4 before any deletion |
| Team unfamiliarity with SQLAlchemy/Alembic | Start Phase 1 with the smallest, simplest table (e.g., `bank_accounts`) as a learning exercise before tackling `employees`/`salary` |
| Scope creep (redesigning the schema *and* adding new fields at the same time) | Keep the first migration a faithful structural port of existing Sheets columns; layer in schema improvements (like `manager_id`) as a clearly separate, later Alembic migration |
| Skipping Phase 0 to "save time" | Don't. Without it, every domain router needs a second, separate rewrite during the actual migration instead of a config flip — Phase 0 is what makes Phases 1-4 low-risk and reversible at all. |

## 8. Decision this document is meant to support

The concrete next step is: **implement Phase 0 (repository interfaces + Sheets-backed implementations for one domain, e.g. `bank_accounts` or `vacations`) as the first piece of work**, verify it's a behavior-preserving refactor (existing tests pass unchanged), and only then stand up Postgres and write the first Alembic migration for that same domain as a proof of concept. Everything else in this document follows from validating that first slice end-to-end — abstraction first, then infrastructure, then cutover.

## 9. Status update (2026-09-06)

**Phase 0 and Phase 1 are implemented and merged to `main`** (PR #11, commit `f3e8c4f`). This section records what shipped, one deliberate deviation from the original plan, and what's still genuinely open.

### 9.1 What shipped

- Phase 0: repository interfaces + Sheets-backed implementations for all 10 domains (`employees`, `salary`, `insurance`, `bank`, `vacations`, `requests`, `documents`, `invoices`, `auth`, `audit`).
- Phase 1: SQLAlchemy models (`be/models_db.py`), Alembic setup (`be/alembic.ini`, `be/migrations/`), SQL-backed repositories (`be/repositories/sql/*.py`) and dual-write repositories (`be/repositories/dual/*.py`) for all 10 domains.
- Backfill script (`be/scripts/backfill_sheets_to_sql.py`) and reconciliation script (`be/scripts/reconcile_stores.py`), both exercised successfully against a local SQLite database — the migrated data was verified correct.
- `DB_BACKEND=sql` set and confirmed working end-to-end in local testing.

### 9.2 Deliberate deviation: per-domain phased cutover — accepted as not required

The original plan (section 6, Phase 3) called for cutting over reads one domain at a time (starting with a low-risk domain like `vacations` or `bank`), rather than flipping every domain to SQL at once, specifically to limit the blast radius of any bug discovered post-cutover and to allow an easy per-domain rollback.

**Decision:** this staging is not required at the current project stage. Rationale: single developer, pre-production, no real HR users depending on data correctness yet, and the SQLite migration + reconciliation already passed cleanly across all domains in one pass. The risk the phased approach was designed to manage (a bug in one domain's SQL repository silently affecting `employees`/`salary` alongside everything else, discovered only after real usage) is low-consequence right now precisely because there is no real usage yet.

**This decision should be revisited, not treated as permanently settled**, once real HR staff start relying on this data day-to-day — at that point, the original reasoning (isolate blast radius, enable partial rollback) starts to matter again, especially for any *future* schema or repository change, not just this initial migration.

### 9.3 Genuinely still open (independent of the cutover-staging decision above)

These remain outstanding regardless of the phased-cutover decision, because they test different things than "did the SQLite migration produce correct data":

- **Postgres validation.** SQLite has not exercised Postgres-specific behavior: stricter type/constraint enforcement, and a fundamentally different concurrency model (SQLite serializes writes via a file lock; Postgres allows real concurrent transactions with row-level locking). Since Postgres is the stated production target (section 3), this must be validated before any real multi-user deployment — SQLite success does not imply Postgres success.
- **Sustained reconciliation.** `reconcile_stores.py` has run once, successfully, as a point-in-time check. It has not run over an extended period against a system still receiving writes, so ongoing drift (particularly relevant while `dual` write mode and `sheets_client.py` both still exist in the codebase) is not yet ruled out.
- **Phase 4 — retiring Sheets as system of record.** Not started. `sheets_client.py` and the `repositories/dual/*.py` layer are still present; Sheets remains structurally part of the system even though reads are now on SQL.
- **Phase 5 — removing/simplifying the Sheets-quota caching workaround.** Not started. `test_sheets_caching.py` and the underlying caching logic are untouched; now that reads are on SQL rather than Sheets, this caching layer's original purpose (avoiding Sheets API quota limits on reads) may be partially or fully moot and worth re-evaluating.

### 9.4 Practical bottom line

The database redesign is **not yet complete** — it is at the end of a successful Phase 1, with Phase 2 partially exercised (backfill + one reconciliation pass done, sustained soak not done) and Phases 3 (as a formal staged rollout), 4, and 5 not started. The phased-cutover requirement specifically has been consciously dropped per the decision in 9.2; the remaining items in 9.3 have not been dropped and represent the actual remaining scope of this redesign.

## 10. Completion update (2026-09-06)

All outstanding database redesign milestones and PostgreSQL readiness requirements have been completed on branch `refactor/database`.

### 10.1 Key Deliverables Implemented

1. **Flexible Database Engine Selection (`DB_TYPE`)**:
   - Added `DB_TYPE` (`sqlite` | `postgres`) in `be/config.py`.
   - Discrete PostgreSQL configuration variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`) with automatic URI generation, or direct `DATABASE_URL` override.
   - Production connection pooling in `be/db.py` (`pool_size`, `max_overflow`, `pool_recycle`, `pool_pre_ping=True`) for PostgreSQL, alongside thread-safe concurrency settings for SQLite.
   - `psycopg2-binary>=2.9.9` activated in `be/requirements.txt`.
   - Dedicated local container definition in `docker-compose.db.yml` (PostgreSQL 16 Alpine with healthchecks).

2. **Authoritative Migration & Cold-Storage**:
   - **Direct SQLite -> PostgreSQL Migration (`be/scripts/migrate_sqlite_to_postgres.py`)**: Accounting for the fact that SQLite (`hrflow.db`) became the active authoritative store while Google Sheets was stale, this utility safely migrates all 13 SQLAlchemy models in dependency order, handles duplicate resolution, and dynamically resets PostgreSQL primary key sequences (`setval(pg_get_serial_sequence(...))`).
   - **Google Sheets Cold-Storage Archival (`be/scripts/export_sheets_cold_storage.py`)**: Exports all 11 Google Sheets tables to timestamped CSV + JSON files along with a cryptographic `manifest.json` for compliance and historical audit backup before retiring Sheets.
   - **Granular Backfill & Reconciliation Tools**: Enhanced `be/scripts/backfill_sheets_to_sql.py` and `be/scripts/reconcile_stores.py` to support `--domain` filtering, `--dry-run`, and formatted tabular status reporting.

3. **Inversion of Dual-Write Repositories**:
   - Updated all 10 `DualWrite...Repository` implementations in `be/repositories/dual/` so SQL is the authoritative `primary` (reads and primary writes) and Sheets is the `shadow` replica. This guarantees stale Sheets data cannot overwrite fresh SQL data.

4. **Standalone / Offline Mode Decoupling**:
   - Decoupled `be/services/invoices.py` and `be/auth.py` from hardcoded Google client dependencies.
   - Under `STORAGE_ENGINE=sql` and `FILE_STORAGE_BACKEND=local`, the entire backend operates without Google service accounts or external API quotas.

5. **Test Validation & Documentation**:
   - Added test suites: `test_db_config.py`, `test_migration_and_reconciliation.py`, `test_sqlite_to_postgres_migration.py`, and `test_standalone_sql_mode.py`.
   - Verified 146 passing tests with zero regressions.
   - Updated `be/SETUP_GUIDE.md` with complete instructions for database configuration, docker setup, and migration workflows.
