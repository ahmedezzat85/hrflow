# Follow-ups plan: D-044 docs, SO-1, SH-1, AU-1, EA-1 (Archived employee + LJ-1), BK-1 (off-machine backup)

**Date:** October 26, 2026. **Status:** plan only, nothing started. **Not part of BI-1.** BI-1 is being executed in its own worktree and must not be extended. This plan is for a **later implementation round** and is committed docs-only first.
**Baseline read:** `origin/main` at `1404adf` (v0.1.5). Re-verify against the then-current `main` before starting any slice (facts below were read on that commit).
**Related:** `open-questions-resolutions-2026-10-26.md` (source text for D-044, 05 and 06), D-012, D-028, D-031, D-043, Q-003, Q-022, `docs/project-context/rbac/archived-employees-future-intake.md`, `docs/deployment/production-deployment-plan.md`.

## 0. Order and independence

| Slice | What | Size | Depends on | Risk |
|---|---|---|---|---|
| DOC-1 | Apply D-044 and the 05/06 edits (docs only) | small | BI-1 docs commit merged (D-043 and Q-024 exist) | low |
| BK-1 | Off-machine backup copy, alert, restore drill | small to medium, mostly scripts and runbook | owner decisions B1 to B4 | medium (data safety) |
| EA-1 | Archived employee state | medium | owner decisions E1 to E5 | high (touches HR, payroll, RBAC) |
| LJ-1 | Hire and leave dates respected by payroll generation | medium | EA-1 (leave date) | high (money) |
| AU-1 | Super-Admin restore of archived users, rule R12 | small to medium | none; ideally designed with EA-1 | medium (RBAC) |
| SO-1 | Attention-queue reminder for annual corporate income-tax obligation | small | none | low |
| SH-1 | Google Sheets retirement | medium | after payroll and opening-balance data entry; cold-storage dump first | medium |

Suggested order: DOC-1, BK-1 (protects the data entered during cutover, so do it early), SO-1, EA-1 with LJ-1 and AU-1 designed together, SH-1 last. The owner approves each slice separately.


## 0A. Owner decisions recorded October 26, 2026 (session)

- **E1:** one "Archive (left company)" action with a mandatory leave date.
- **E2:** **employment-periods table** (each stint has a start and an end), not a single leave date. EA-1 and LJ-1 are therefore larger: LJ-1 includes an employee for a period only if the period overlaps a stint; archive closes the current stint; restore opens a new one. Existing employees get one stint from `join_date` (open end). Design detail to be settled in the EA-1 plan before building.
- **E3:** HR archives, Super-Admin restores.
- **E4:** **On Leave is included** in generated runs; only Inactive (and people outside their stints) are skipped. This changes today's behaviour: the slice must list the employees affected and test it.
- **E5:** full amount, flagged "partial month", edited by the user; no proration.
- **B1:** cloud folder only (no external disk). **B2:** company-owned account.
- **B3:** owner chose **no encryption** for the off-machine copy "to avoid hassles". **Risk recorded:** the copy would hold salaries, bank details and personal documents in readable form in a cloud account. Compensating controls required: company account with two-step sign-in, a private folder shared with nobody, a named owner and a backup owner of the account. Revisit if the owner changes his mind; the lowest-effort encryption option is one key kept in the password manager (the script handles it, nothing to type daily). The existing database dump encryption is not removed unless the owner explicitly asks.
- **B4:** **weekly** off-machine copy. Risk recorded: up to 7 days of data could be lost if the PC is lost. Recommendation kept: the nightly local backup continues, the weekly copy goes to the cloud. Alert threshold changes to "last good off-machine copy older than 9 days" and "last local backup older than 36 hours". Retention for the weekly copies: 8 weeks plus 12 monthly (proposed, not answered).

## 1. DOC-1 (docs only)

Apply sections 1 to 3 of `open-questions-resolutions-2026-10-26.md` to `04-decision-log.md` (D-044), `05-roadmap-and-next-slices.md` and `06-open-questions.md`. Add this plan to the roadmap register as the source of SO-1, SH-1, AU-1, EA-1, LJ-1, BK-1 (status: accepted or suggested, not started; EA-1 and LJ-1 stay a **suggestion** until the owner approves). Do not commit the resolutions file itself. One commit.

## 2. EA-1: Archived employee state (with LJ-1)

### 2.1 What exists today (read on `1404adf`)
- `EmployeeDB.status` is free text, default `Active`. The UI offers Active, On Leave, Inactive. No hire or leave **date logic**: `join_date` is a string, there is no leave date.
- Native payroll generation takes every employee with `status` equal to "active" (case-insensitive) and applies **no hire-date or leave-date filter**. Consequences: an employee hired in June appears in January to May runs unless the line is deleted in draft; a leaver must stay Active or disappears from runs.
- An employee referenced by payroll lines or compensation plans cannot be deleted (foreign keys RESTRICT; delete rules R1, R2, R4 in `core/access_service.py`). So **a leaver who has history cannot be removed, and nothing records that they left.**
- Users: archived users cannot sign in (D-012). Rule R12 refuses to provision a user whose email belongs to an archived user. Nobody can restore (AU-1).

### 2.2 Gap in plain words
There is no way to say "this person left on 31 March 2025, keep everything, stop paying them, hide them from daily lists". Today the owner works around it by keeping leavers Active and deleting lines by hand in draft runs. During cutover this is a real risk of paying or counting a person in a month they were not employed.

### 2.3 Proposed design (to be approved)
- **Data:** add nullable `leave_date` (date) and `archived_at` (timestamp) to employees; keep `status` free text but add the controlled value **Archived** (shown as "Left" in the UI). `join_date` stays as is; LJ-1 reads it as a date and rejects unparsable values with a visible warning (do not convert the column in this slice).
- **Archive action (one action, Super-Admin or HR role with a new permission, see E3):** requires a leave date; sets status Archived; archives the linked user (existing mechanism, D-012); writes an audit entry; **deletes nothing**. Blocked if a payroll run is draft and contains the person in a period after the leave date, until the line is removed (message tells which run).
- **What is kept:** compensation plans, pay history, payroll lines, claims, leave, documents, bank details (flagged "former employee"), ledger links. All stay readable in history and reports.
- **What stops:** new payroll lines for periods after the leave month; new leave requests, claims and pay plans dated after the leave date are rejected; the person leaves default lists and pickers (filter "Show archived").
- **Reports and analytics:** pay analytics and cost reports keep former employees for the periods they were employed.
- **Restore (rehire):** Super-Admin only (same rule as AU-1). Clears `leave_date` and `archived_at`, status Active, audit entry. See E2 for the rehire-gap problem.
- **Delete:** unchanged. Still impossible with history; the UI points to Archive instead of failing silently.

### 2.4 LJ-1: payroll generation respects dates
- A native run for period P includes an employee when `join_date <= end of P` and (`leave_date` is empty or `leave_date >= start of P`) and status is not Inactive or On Leave (current rule for those stays; see E4).
- **No automatic proration** in the first version: the line for the join month and the leave month is created at full plan amounts, flagged "partial month", and the user edits it (payroll lines are editable in draft). Rationale: D-001, HRFlow is not the authoritative calculator; proration rules differ per case.
- `refresh_run` must not restore lines for employees outside their dates.
- Existing runs are not changed retroactively. A one-time report lists employees whose existing lines fall outside their dates.
- Tests: join mid-month, leave mid-month, leave before period, join after period, rehire, status Inactive, missing join date (included with a warning, never silently excluded), 12-month cutover scenario.

### 2.5 Owner decisions needed
- **E1.** Label and behaviour: one action "Archive (left company)" with a mandatory leave date. Recommended: yes. Alternative: two steps (set Inactive, then archive).
- **E2.** Rehire: (a) single `leave_date`, restore clears it, so months in the gap would be included if a run is regenerated for them (simple, risk limited to regenerating old runs); (b) an employment-periods table (start, end per stint), correct for rehires, more work. Recommended: (a) now, with a guard: regenerating a run for a period that is already finalized stays impossible, and (b) only if a rehire actually occurs.
- **E3.** Who may archive and restore: Super-Admin only, or HR admin to archive and Super-Admin to restore. Recommended: HR admin archives, Super-Admin restores.
- **E4.** Treatment of On Leave: included in payroll or not. Today excluded, same as Inactive. Keep unless the owner says otherwise.
- **E5.** Partial month: no proration now (recommended) or a simple calendar-day proration option later.
- **Timing for the cutover:** EA-1 and LJ-1 are **not required** to finish 2025 and 2026 data entry (the guide's workaround of deleting lines and keeping leavers Active works). If the owner wants the system to enforce dates during entry, build them before the entry reaches the affected months.

## 3. AU-1: restore archived users (Super-Admin)
- Add a restore action for archived users: Super-Admin only, audit entry, same user record, email and history, roles re-confirmed at restore (restored user starts with no roles until confirmed).
- Rule R12: provisioning a user for an archived email must prompt "restore the archived account" instead of rejecting.
- Archived users still cannot sign in; restore is the only way back. Tests for permission, audit, R12 change, and that restore of a user whose employee is still Archived is refused (restore the employee first, EA-1).
- Update `route-guard-inventory.csv` and `test_rbac.py`; one new permission key only if the existing Super-Admin gate cannot express it (decide by reading the inventory).

## 4. SO-1: corporate income-tax reminder
- Attention queue (computed when opened, no scheduler, D-031) gains an item when the annual corporate income-tax obligation for a finished fiscal year does not exist, or exists unpaid and the due date is within a configurable window (default 30 days). Fiscal year = calendar year (D-042). The obligation itself stays created by hand (D-001, D-044).
- Visible to users who can manage statutory obligations. Dismissal not required: the item disappears when the obligation exists and is paid.
- Tests: no obligation in January, obligation present, due-date window, role visibility.
- Open detail: the due date rule (statutory) is not computed by HRFlow; the reminder for a missing obligation uses "year ended more than N days ago" with N set in settings (owner value needed, default 120 days after year end; confirm with the accountant).

## 5. SH-1: Google Sheets retirement
- Pre-conditions: payroll and opening-balance data entry finished; confirm no one relies on the live export; if any old Sheet holds data not in SQL, run `be/scripts/export_sheets_cold_storage.py` first and keep the dump.
- Remove the Sheets client and live export and `gspread`; keep `google-auth` for Sign-In; **CSV and audited Excel exports stay** (answer to the owner's question: they are enough, the Sheets export is not needed for them).
- `auth.py` and `seed_data.py` still import `sheets_client`: untangle first (separate commit), then delete. Check settings, docs, deployment env variables and CI for Sheets references.
- Tests: full suite green; startup with no Sheets configuration; seed script works.

## 6. BK-1: off-machine backup copy

### 6.1 What exists today
- `deploy/prod/scripts/backup.ps1` produces an encrypted database dump plus a copy of the documents folder. Nightly schedule through Windows Task Scheduler is a **manual setup step** (confirm it is actually registered).
- Documents are copied **unencrypted**. Google Drive for Desktop runs on the **same PC**, so a Drive folder is not an independent location from the machine's point of view if it is only the local sync folder.
- No failure alert: a failed or skipped backup is silent. One restore drill was done on October 16, 2026.
- Open items from the deployment plan: Drive account ownership, where the encryption key lives, off-machine copy deferred to "Phase E".
- Production is **one PC** (D-044 context): disk failure, theft, fire or ransomware loses both data and backups.

### 6.2 Options for the second copy
| Option | Pros | Cons |
|---|---|---|
| A. External USB disk, rotated weekly, kept elsewhere | cheap, offline (ransomware safe) | manual, can be forgotten |
| B. Another PC or NAS on the network (scheduled copy) | automatic | same building, same fire or theft |
| C. Cloud folder (company Drive or similar) fed by the backup script | automatic, off site | needs encryption before upload (documents), account ownership must be the company's |
| D. Object storage via a copy tool (rclone) | automatic, off site, versioning | new account and cost, credentials to protect |

Recommended: **C plus A**. Encrypted dump and encrypted documents archive uploaded nightly to a company-owned cloud folder, plus a monthly external disk copy kept off site. Retention: 14 daily, 8 weekly, 12 monthly.

### 6.3 Work items
1. Encrypt the documents archive before it leaves the machine (same key mechanism as the database dump).
2. Add the upload/copy step to `backup.ps1` with a status file (`last_backup.json`: time, size, result per step) and a non-zero exit code on failure.
3. Failure visibility: Task Scheduler failure action plus an optional attention-queue item "last successful backup older than 36 hours" read from the status file (computed on open, no scheduler).
4. Key custody: key stored in two places (password manager and a sealed printed copy kept off site); document in the runbook; never stored with the backups.
5. Restore drill from the **off-machine** copy onto a clean machine or folder; repeat quarterly; record dates in the runbook.
6. Update `RUNBOOK.md` and `production-deployment-plan.md` (remove "remaining", add procedure).
- Tests: script dry run in a temp folder, failure path returns non-zero, status file content, restore from the encrypted archive.

### 6.4 Owner decisions needed
- **B1.** Which destination (A, B, C, D or a combination). **B2.** Which account owns the cloud folder (company, not personal). **B3.** Who holds the encryption key copies. **B4.** Retention and the alert threshold (36 hours proposed). Until B1 and B2 are answered, only items 1, 2 (local part), 4 and 6 can be prepared.

## 7. Documentation changes required (DOC-1 and per slice)
- 04: D-044 now; later entries for EA-1/LJ-1 (employee Archived state and date-aware payroll), AU-1 if it needs a permission key, BK-1 (backup policy).
- 05: register rows for the slices above; housekeeping row for the off-machine backup.
- 06: open questions E1 to E5 and B1 to B4 are **task-level decisions** and become Q-entries only if they stay unanswered when the slice is approved.
- RBAC docs: `archived-employees-future-intake.md` is superseded by the EA-1 design once approved.
