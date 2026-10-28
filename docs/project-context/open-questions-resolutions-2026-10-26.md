# Open-question resolutions, October 26, 2026 (source text for the docs)

**Use:** source text for `docs/project-context/04-decision-log.md`, `05-roadmap-and-next-slices.md` and `06-open-questions.md`. Apply it in the **same documentation commit** as BI-1 (D-043), then do **not** commit this file itself. Owner decisions were given in session on October 26, 2026 after the facts below were read in the code on `origin/main` at `1404adf`.

## 1. Decision log: add after D-043

### D-044 — Resolution of Q-002, Q-004, Q-005 and Q-006; Q-003 and Q-022 unchanged

- **Status:** Accepted by owner, October 26, 2026. No code change is part of this entry; the follow-up slices below each need their own approval.
- **Decision:** (1) **Q-002:** the annual corporate income-tax obligation stays created by an authorized user by hand (the portal is authoritative, D-001). HRFlow adds a **reminder** in the attention queue (calculated when opened, no scheduler) when the obligation for a finished year is missing or its due date is near. (2) **Q-004:** exchange rates stay **manual**; no automatic feed. A monthly rate table may be planned later only if typing becomes a burden. (3) **Q-005:** Google Sheets is retired **after the payroll and opening-balance data entry**: the Sheets code, the live export and `gspread` go; CSV and audited Excel exports remain the export formats; `google-auth` stays for Sign-In; a cold-storage dump (`be/scripts/export_sheets_cold_storage.py`) is taken first if any old Sheets hold data that is not in SQL; if someone is found to rely on the live export when the cleanup is planned, the decision is revisited. (4) **Q-006:** an archived user can be restored by a **Super-Admin only**, with an audit entry; the same record, email and history return; roles are re-confirmed at restore. Archived users still cannot sign in, and nobody else can restore. (5) **Q-003** stays **Deferred** (confirmed): revisit only when HRFlow leaves the single host, runs a second instance, or uptime becomes a business problem; S3-compatible storage would then be the direction for more than one host. (6) **Q-022** stays **Open** until a historical payroll import is revived.
- **Rationale:** Facts verified in code: no scheduler exists (D-031); the attention queue is computed on opening and already lists open statutory obligations; payroll FX rates must match the accountant's monthly rate, not a market quote; production is a single PC without Sheets or Drive configured; `users.email` is unique and provisioning rejects an archived email (rule R12), so a rehired person is currently blocked.
- **Follow-up slices (not started):** SO-1 attention-queue reminder for the annual corporate income-tax obligation (small); SH-1 Google Sheets retirement (roadmap slice 5; after the cutover; `auth.py` and `seed_data.py` still import `sheets_client`, so it is not a simple delete); AU-1 Super-Admin restore of archived users, including the provisioning rule R12 (an archived email prompts a restore instead of rejecting), the audit action and the permission check.
- **Related References:** [06-open-questions.md](06-open-questions.md) (`Q-002`, `Q-003`, `Q-004`, `Q-005`, `Q-006`, `Q-022`); D-001, D-011 to D-013, D-023, D-031, D-035, D-040.

## 2. Open questions file (`06`)

- At-a-glance table: remove Q-002, Q-004, Q-005, Q-006 from the open list. Keep Q-003 (Deferred, confirmed October 26, 2026) and Q-022 (Open). Add the BI-1 question Q-024 as written in the BI-1 plan.
- Move Q-002, Q-004, Q-005 and Q-006 to **Resolved Questions (Archive)**, each with: `Status: Resolved — D-044 (October 26, 2026): <the choice in one sentence>`.
- Q-003: status line gains "confirmed Deferred by the owner on October 26, 2026 (D-044)".
- Q-022: add "kept open by the owner on October 26, 2026 until a historical payroll import is revived; recommendation recorded: mirror native typing (bonus and commission amounts in both `base_salary` and `net_pay`)".

## 3. Roadmap (`05`)

- Section 4 table: Q-002, Q-004, Q-005, Q-006 rows become "Resolved by D-044" with the follow-up slice named; keep Q-003 as Deferred.
- Section 4B register, "Active / ready": add SO-1, AU-1 (accepted, not started). "Planned earlier": Slice 5 row gains "Sheets retirement SH-1 accepted (D-044), after the cutover". "Deferred": remove the rows for scheduled corporate income tax, automatic FX feed, Sheets retirement and restore of archived users (resolved), keep cloud object storage.
- Section 4B "Housekeeping awaiting the owner": add "Off-machine backup copy for production (listed as remaining in `docs/deployment/production-deployment-plan.md`); production runs on one PC, so backups on another disk or location are the safety net".
- Section 4A / register: add a **suggestion, not a decision**: schedule the Archived employee state together with LJ-1 (hire and leave dates that payroll generation respects). Today a departure means deleting the employee, and an employee who appears in payroll runs or ledger records cannot be deleted, so leavers stay Active.
