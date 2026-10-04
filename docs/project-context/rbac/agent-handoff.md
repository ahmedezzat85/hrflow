# RBAC Initiative — Coding-Agent Handoff Pack

**Audience:** any coding agent (not Claude-specific) that will implement the RBAC initiative in HRFlow.
**Owner:** repository owner. **Run mode: autonomous** (per `AGENTS.md`): the agent runs slices back to back, commits and pushes after each slice passes its checks, and does not wait for approval between slices. The owner reviews the pushed commits and the run log afterwards.
**Date written:** October 2, 2026
**Baseline when written:** branch `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main`); Alembic head `0023_payroll_income_tax_settings`; test status **unknown** (never run by the author).

This file is self-contained for process and sequencing. For exact detail it points to four companion files in the same folder; read them, do not guess:

| File | Use it for |
|---|---|
| `technical-spec.md` | Design: data model, catalog, resolution, scope helper, access-service rules R1–R14, API contract, frontend spec, tests. |
| `permission-matrix.md` | The 63-key catalog, the five roles and their exact grants, implication rules. |
| `route-guard-inventory.csv` | All 236 route registrations with `current_guard`, `proposed_guard`, `change_type`. |
| `implementation-plan.md` | Slice list, gates, acceptance criteria per slice. |

Decisions: `../04-decision-log.md` D-011 (role model), D-012 (identity lifecycle), D-013 (sign-in policy), plus amendments to D-008/D-009/D-010. Open questions: `../06-open-questions.md` (Q-006…Q-013).

---

## Part A — Prerequisites (owner; none of these block the agent from starting)

1. **Before the agent starts:** commit the documentation changes on `feature/rbac` (this folder plus the updated project-context files) so the agent reads them from the repository.
2. **In parallel, before the migrations reach production:** run the read-only data check on a **copy** of the production database (the agent adds `be/scripts/rbac_pre_migration_check.py` in slice 1; until then run these queries by hand): users where `employee_id IS NULL`, users with no row in `user_roles`, duplicate emails (case-insensitive). Any external user without a role must be given one or removed before the migration runs in production. The agent develops and tests against development/test databases only.
3. **Baseline tests:** the agent measures them itself at the start and records them in the run log; nothing to do unless you want your own numbers.
4. **Production:** back up the production database before deploying any new migration. The agent never touches production data or credentials. Merging `feature/rbac` into `main` and deploying are the owner's actions.
5. **Start:** give the agent the master prompt in Part B and tell it which slice range to run (default: all, in the Part D order).

---

## Part B — Master prompt (paste this to the agent at the start of each session)

> You are implementing one slice of the RBAC initiative in the HRFlow repository (FastAPI + SQLAlchemy/Alembic backend in `be/`, vanilla JS frontend in `fe/` built with Vite).
>
> **Read first, in this order:** `AGENTS.md`; `docs/project-context/00-project-start-here.md`; `docs/project-context/rbac/agent-handoff.md` (this file, Parts C and D for your slice); `docs/project-context/rbac/technical-spec.md`; `docs/project-context/rbac/permission-matrix.md`; the rows of `docs/project-context/rbac/route-guard-inventory.csv` for your slice; decisions D-011, D-012, D-013 in `docs/project-context/04-decision-log.md`.
>
> **Source of truth:** the code, migrations and tests on the branch are the truth. If a document disagrees with the code, follow the code and record the difference in the run log. Never invent a product decision. If a rule you need is not in these documents, or an open question in `06-open-questions.md` gates your work, handle it as a blocker under Part F.
>
> **Before editing, write a branch-intake block** (branch name, HEAD commit, merge-base with `main`, slice range, assumptions) to the run log `docs/project-context/rbac/run-log.md`, and run the backend and Playwright suites once to record the baseline pass/fail counts. If tests already fail, record the exact failing test names so you can tell old failures from new ones; continue only if the failures are unrelated to RBAC, otherwise treat it as a blocker (Part F).
>
> **Work rules:**
> - Do only the slices you were given, in order. No refactoring, formatting churn, dependency upgrades or unrelated fixes. Record any unrelated defect you find in your report instead of fixing it.
> - Backend is the authority; frontend hiding is convenience only.
> - Schema changes only through Alembic migrations that work on SQLite and PostgreSQL. Never edit an already-applied migration in place. Migrations use frozen lists, not imports of mutable seed code.
> - Do not weaken any test, validation, audit entry or safeguard to make something pass. Update tests only to match an intentional, documented behavior change, and say so in your report.
> - Keep existing admins' access working until the slice that removes the legacy path (slices 1–2 are behavior-preserving).
> - Run `npm run build` in `fe/` after any frontend change, and keep mock mode (`/?mock=admin`) working.
> - Run targeted tests while working; run the full backend suite and the Playwright suite once at the end of the slice.
> - Git (as in `AGENTS.md`): when a slice passes all its checks, stage only relevant source, test and documentation files, commit with a descriptive message that starts with the slice id (for example `RBAC-S1: permission catalog, role seeds and schema`), and push to `feature/rbac` without waiting for approval. Never push to, merge into, or open a merge of `main`. Never commit secrets, local `.env`, `credentials.json`, `*.db` files, logs, or test output. Inspect `git status` and `git diff --stat` before each commit.
> - Autonomy: do not ask the owner questions mid-run. Where a rule is missing or a Part F blocker applies, follow Part F (record it, skip or pause that item, keep going where you safely can). Do not poll background commands in loops; use targeted tests while working and one full regression per slice (`AGENTS.md`).
>
> **After each slice:** append the Part E run-log entry to `docs/project-context/rbac/run-log.md`, include it in that slice's commit, push, then start the next slice. Stop when the requested slice range is done, or when a Part F blocker prevents every remaining slice. Finish with a one-page summary of all slices run, blockers, and what the owner must do next.

---

## Part C — Facts every slice depends on (verified in code on October 1, 2026)

Treat these as correct unless the code on your branch shows otherwise (then report).

**Authorization today**
- Session: HS256 JWT in the `hrflow_session` HttpOnly cookie; claims `email, role, employee_id, name, exp`. `get_current_user` (`be/auth.py`) decodes the cookie only; no database access.
- `be/core/permissions.py` resolves permissions from `user_roles → role_permissions → permissions` and adds `*` when the role name is `system_admin`, or the token/`users.role` is one of `admin`, `superadmin`, `super_admin`, `system_admin`.
- Legacy checks use `role == "admin"`: `auth.require_admin`, `be/deps.py` (`current_user_employee_scope`, `resolve_employee_scope`, `resolve_target_employee`), inline checks in `routers/employees.py`, `routers/salary.py`, `finance/routers/activity.py`, `finance/routers/bank_accounts.py`.
- Routes: 236 registrations. HR routers: 31 `require_admin` (6 are legacy `/api/invoices` aliases), 13 role-scoped via `get_current_user`, 4 with `hr.*` keys, 8 public/session. Finance routers use `require_permission` except three (`activity` timeline, two `observability` GETs).
- Seeds: `seed_rbac` (`be/core/rbac_seed.py`) runs from migration 0003 **and from `init_db()` (`be/db.py`) on every start**; `be/main.py` calls `init_db()` at import time inside a `try/except` that only logs a warning. `seed_rbac` re-grants all seeded keys to `system_admin`, grants `self.*` to `employee`, and **re-links each user to `system_admin` or `employee` from `users.role`**; its errors are swallowed. Only roles `system_admin` and `employee` exist; 36 permission keys.
- Employee create inserts `employees` + `users` (legacy role) with no `user_roles` row. Employee delete deletes only the employee; the `users` row survives (FK `ON DELETE SET NULL`).
- Payroll: `approve_run` (`be/finance/services/payroll_service.py`) already rejects approval by the user who submitted the run, unless env `ENFORCE_MAKER_CHECKER=false` or the request passes `allow_self_approval=true` (the router exposes it as a query parameter; any `finance.payroll.write` holder can set it today).
- Sign-in: Google ID token; `email_verified` required; `ALLOWED_WORKSPACE_DOMAIN` checked against the `hd` claim; `Config.validate()` refuses production start when it is unset.
- Frontend: `SessionInfo.hasPermission` shortcuts on role `admin`/`system_admin`/`*`; `AdminNav.canSeeModule` uses role or any `finance.*` key; HR module is always visible and the default; `session.js` picks the portal from `role`.

**Agreed design (summary; the spec is authoritative)**
- RBAC is the single authority. The `*` wildcard, the `role` claim, `users.role` and the role name `system_admin` stop being consulted for authorization (final removal in slice 8).
- Permission keys are `<module>.<resource>.<action>`, defined in a code catalog (63 keys, plus the deprecated `finance.payroll.write` until slice 4). No prefix wildcards. Write implies read; action keys (`prepare`, `approve`, `pay`, `reveal`, `manage`, `verify`) imply read of the same resource only. Role rows are stored closed under implication; the server normalizes on save.
- Five seeded roles, created once and never overwritten afterwards (except Super-Admin): Super-Admin (locked; effective permissions = full catalog, computed at resolution time), HR-Admin, Financial-Admin, Payroll-Maker, Employee. Only Super-Admin manages roles and users. `system.*` keys are not assignable to other roles. Union of roles only: no deny, no inheritance.
- Employee baseline is derived from a linked `employee_id`, never stored or shown. A user without a linked employee is External and must hold at least one role.
- Lifecycle: no disable state; Archived keeps roles but is blocked at login and on every request. No actor may delete/archive/revoke themselves; the last active Super-Admin is protected. All rules R1–R14 live in one access service (spec §9).
- Startup (approved): the startup step only inserts missing permission rows and syncs Super-Admin's grants. It must not re-link users from `users.role`, must not grant keys to other roles, and must log and **fail startup** if the RBAC sync fails (no `except Exception: pass`). New keys reach editable roles only through migrations with frozen key lists.
- Payroll (approved): `finance.payroll.write` splits into `read`, `prepare`, `approve`, `pay`. The submitter-cannot-approve check stays. `allow_self_approval` is honored only for a caller who holds both `finance.payroll.prepare` and `finance.payroll.approve` (Super-Admin by default).
- Sign-in (approved): Google only; accounts of any domain; access requires an existing non-archived user matched by verified email (case-insensitive); no self-registration; drop the workspace-domain gate and its production config requirement.

**Interim treatments approved (do not change without the owner)**
- Q-006: archived users cannot be restored; restore is not built.
- Q-007: Payroll-Maker gets no `finance.account.read` (verify during slice 4 and report if run creation breaks).
- Q-008: employee compensation-plan endpoints map to `finance.payroll.prepare`.
- Q-009: keep `finance.account.*` as one read/write pair.
- Q-011: employees keep own-document upload/delete as today; own bank-detail edits are not added.
- Q-012: `post-journal` requires `finance.payroll.pay`.

---

## Part D — Slice packets

Order: 1 → 2 → {3, 4, 5} in any order after 2 (3 and 4 before 7a) → 6 after 5 → 7a → 7b → 8. Each packet lists what to build, what to read, how to prove it, and when to stop. "Spec §x" refers to `technical-spec.md`. Acceptance criteria are the minimum; each needs an automated test unless marked manual.

### Slice 1 — Catalog, roles, schema and startup-seeding fix

**Gate:** none for development. Add `be/scripts/rbac_pre_migration_check.py` (read-only: users with no employee, users with no roles, duplicate emails) and run it against the development/test database; the owner runs it on a production copy before deploying (Part A.2).
**Behavior change for users:** none.

**Build**
1. `be/core/permission_catalog.py`: `PermissionDef` (`key, group, description, implies, assignable`), the full `CATALOG` from `permission-matrix.md` (63 keys + deprecated `finance.payroll.write`), `all_keys()`, `closure(keys)`, `validate_role_keys(keys)`. Import-time assertions: key has three dot-separated parts, every `implies` target exists, no cycles. (Spec §4.)
2. `be/core/role_seed.py`: the five default roles as `system_key → base keys` from the matrix; stored grants are `closure(base)`. (Spec §5.)
3. `sync_catalog(db)`: idempotent; inserts missing permission rows, updates descriptions, syncs Super-Admin's role-permission rows to the full catalog; never grants keys to other roles; never deletes keys; safe when several workers start together (catch unique-constraint conflicts).
4. Alembic `0024_…` (SQLite batch ops, plain DDL on PostgreSQL, `server_default` for booleans): `roles.system_key` (String(50), nullable, unique), `roles.is_locked` (Boolean, not null, default false), `users.name` (String(255), nullable), `users.archived_at` (DateTime, nullable), `users.archived_by` (String(255), nullable). Data steps from Spec §3.2 (1–4) using frozen lists: rename `system_admin`→`Super-Admin` (`system_key='super_admin'`, `is_locked=true`), `employee`→`Employee` (`system_key='employee'`); create `HR-Admin`, `Financial-Admin`, `Payroll-Maker` with matrix grants; insert missing permission rows; assign Super-Admin to every user whose `users.role = 'admin'`. Provide downgrade for the schema changes.
5. Startup: rewrite the RBAC part of `init_db()` to call only `sync_catalog`. Remove the re-link from `users.role` and the per-start re-grant. Log errors and fail startup if the RBAC sync fails.
6. Keep migration 0003 working on a fresh database by giving it a frozen copy of the old seed (it must not import the changed `rbac_seed`). Do not edit applied migrations without a fresh-database parity test.
7. Compatibility: until slice 2, code that looks roles up by name (`core/permissions.py`, tests) must still work for Super-Admin (for example, resolve by `system_key` first and fall back to the old name).
8. Update `be/tests/test_rbac.py` expectations (role names, counts); do not weaken assertions.

**Acceptance**
1. Fresh database and a database upgraded from 0023 both contain the five roles with the matrix grants (closed under implication) and every catalog permission row.
2. Super-Admin is locked; all former `users.role = 'admin'` users hold it.
3. Catalog loading fails on a bad key format, an unknown implied key or a cycle (unit tests).
4. `sync_catalog()` is idempotent and leaves editable roles' grants untouched.
5. Revoke a role, restart (re-run `init_db`), and the revocation is still in place (regression test for the old re-link).
6. A failing RBAC sync makes startup fail with a logged error.
7. Migration passes upgrade and downgrade on SQLite and on PostgreSQL.
8. The existing suites still pass (no authorization behavior moved).

**Blockers (Part F) if:** PostgreSQL is not available to test (then complete the SQLite path, mark PostgreSQL untested in the log, and continue); any existing test depends on the re-link behavior in a way you cannot preserve.

### Slice 2 — Resolution, session and scope helpers

**Depends on:** 1. **Behavior change:** none for existing admins; archived users are blocked.

**Build** (Spec §6–§8)
1. `be/core/permissions.py`: `resolve_access(db, session_payload) → AccessContext` (user lookup by `uid` claim, else by email case-insensitively; 401 for unknown user, 403 for archived; assigned roles from `user_roles`; Employee baseline when `employee_id` is set; Super-Admin gets `all_keys()`; others get `closure(union of role keys)`; `portal` = admin when the user holds any key outside `self.*` and `hr.company_document.read`). Remove the `*` wildcard and the legacy role-string indicators.
2. `be/auth.py`: `get_current_user` gains `request` and `db`, caches the context on `request.state`, and returns the dict plus `user_id`, `permissions` (sorted list), `roles`. The dict's `role` is `"admin"` only for Super-Admin and `"employee"` otherwise, so un-migrated `role == "admin"` checks keep their meaning. Add a `uid` claim at login; tokens without it fall back to email lookup; keep writing the `role` claim during the transition.
3. `require_admin` becomes "holds Super-Admin" (temporary shim).
4. `permission_scope(all_key, self_key)` helper in `be/deps.py` (old helpers stay until slice 3).
5. `routers/auth.py`: `/auth/google` and `/auth/me` return `permissions`, `portal`, `roles` (names, baseline excluded) and a compatibility `role` (`"admin"` when `portal == "admin"`, else `"employee"`).
6. `finance/routers/bank_accounts.py`: the inline `finance.adjustment.manage` check reads resolved permissions (it reads `permissions` from the session dict today and never finds any).
7. Tests: a fixture helper that creates DB users with chosen roles; keep a thin `admin_cookies` that maps to a Super-Admin user so unrelated suites keep working. Find which test modules depend on legacy token minting (`conftest.py` mints tokens with `create_session_token`) and report the count.

**Acceptance**
1. A Super-Admin user can do everything an admin could before; existing admin-based tests pass unchanged.
2. A token with `role=admin` but a user holding no admin role gets 403 on admin routes.
3. An archived user with a valid cookie gets 403 on the next request and cannot log in.
4. A user with a linked employee gets Employee permissions without any `user_roles` row.
5. Super-Admin has every catalog key even when `role_permissions` rows are missing.
6. A non-admin role holding `finance.adjustment.manage` can record an adjustment.
7. `/auth/me` returns `permissions`, `portal`, `roles` and a compatibility `role`; the existing frontend keeps working.
8. Tokens without `uid` still work.
9. Measure and report request latency before/after on the heaviest endpoints (one extra lookup per request is expected).

### Slice 3 — HR guards and self-service keys

**Depends on:** 2.

**Build** (Spec §7; CSV rows with `file` starting `routers/`, change types `key-from-admin`, `scope-by-permission`, `new-key`)
- Move every HR route (all `be/routers/*.py` except `auth.py`) onto catalog keys per the CSV `proposed_guard`; use `permission_scope(all_key, self_key)` where the CSV says own-or-all.
- New keys as per the matrix: `self.*` (vacations, claims, bank details, documents), `hr.employee_bank_account.*`, `hr.export.run` plus dataset keys, `system.audit.read`.
- Rewrite `current_user_employee_scope`, `resolve_employee_scope`, `resolve_target_employee`, and `_check_document_access` (`routers/employees.py`) onto permissions. On-behalf-of submission (vacations, requests, claims) requires the matching `hr.*.write`; otherwise the target is forced to the caller's employee.
- Add the employee-side read of own (masked) bank details; `reveal=true` requires `hr.employee_bank_account.reveal`.
- Both `/api/invoices` legacy aliases and `/api/salary-payment-docs` share handlers: guard and test both.

**Acceptance**
1. No HR route imports `require_admin`.
2. For every HR route the guard equals the CSV `proposed_guard` (write a test that walks the app's routes).
3. Employee role gets 403 on every admin-only route and sees only its own records on scoped routes.
4. HR-Admin passes all HR routes and gets 403 on every finance route.
5. A user holding both `self.*` and `hr.*` sees all records.
6. On-behalf-of submission needs the matching `hr.*.write`.
7. Exports: an HR dataset needs `hr.export.run` plus its read key; `finance_*` datasets need `finance.report.read` plus their read key.
8. An employee reads their own masked bank details; reveal is denied without the reveal key.
9. Update `test_employee_scope.py` and `test_authorization.py` without weakening them; one test per role-scoped registration.

### Slice 4 — Finance guards and payroll split

**Depends on:** 2. Interim answers Q-007/Q-008/Q-012 and the Q-013 rule apply (Part C).

**Build**
- `finance/routers/payroll.py` and `compensation_plans.py`: replace `finance.payroll.write` with `prepare` / `approve` / `pay` per the CSV. `approve` covers approve and finalize; `pay` covers pay and post-journal; `prepare` covers adjustments, generate/create, line add/delete, submit, and compensation-plan edits (preview POSTs need only `finance.payroll.read`, which `prepare` implies).
- `approve_run`: keep the submitter-cannot-approve check; honor `allow_self_approval` only when the caller holds both `finance.payroll.prepare` and `finance.payroll.approve`.
- `statutory.py`: `finance.statutory.read/write` instead of `finance.bill.*`.
- `vendors.py`: payment instructions require `finance.vendor_payment.manage` / `verify` only (remove the `finance.vendor.write` alias).
- `activity.py`: per-entity read guard; fix the undefined `user_permissions` name on the vendor branch; masking from resolved permissions.
- `observability.py`: the two GETs require the new `finance.settings.read`. **Before tightening**, check the frontend call sites of `GET /api/finance/feature-flags` and `/api/finance/observability/metrics` so no employee-facing screen loses a startup call; report findings.
- Migration `0025_…`: every role holding `finance.payroll.write` receives `read`, `prepare`, `approve`, `pay`; then remove the old key from the catalog and database.

**Acceptance**
1. Payroll-Maker can preview, adjust, generate/create, add/delete lines, submit and edit compensation plans; gets 403 on approve, finalize, pay, post-journal.
2. Financial-Admin can approve, finalize, pay, post-journal; gets 403 on prepare routes.
3. Super-Admin can do all.
4. A role holding only `finance.vendor.write` can no longer create, update or verify payment instructions.
5. Statutory routes accept `finance.statutory.*` and reject `finance.bill.*` alone.
6. Activity timeline: no read key for the entity means 403; no `NameError` for non-admins.
7. Feature-flag and metrics GETs reject users without `finance.settings.read`; no employee screen breaks.
8. `finance.payroll.write` no longer exists after migration; existing payroll tests pass with Super-Admin.
9. A Payroll-Maker cannot approve their own submitted run, with or without `allow_self_approval`; a Super-Admin can with it.
10. Report whether Payroll-Maker can create a run without `finance.account.read` (Q-007); do not grant it yourself.

### Slice 5 — Access service, API and employee lifecycle

**Depends on:** 2.

**Build** (Spec §9–§10, §14)
- `be/core/access_service.py` implementing rules R1–R13 (R14 is a check item) in one transaction per action; errors as `HTTPException(detail=<string>)` with the status codes in Spec §9.
- `be/routers/access.py` mounted in `be/main.py` under `/api/access` with the endpoints in Spec §10 (`/catalog`, `/roles`, `/users`, role create/update/delete, user create-external, roles update, archive). Guards: `system.roles.manage`, `system.users.manage`. `restore` is **not** built.
- Wire employee create (provision the linked user; link an existing non-archived external user with the same email; reject an archived one) and delete (rules R4, R5) through the service; the HR repository stops writing the `users` table directly.
- Audit entries through `deps.audit_log` for every mutation (`role.create`, `role.update`, `role.delete`, `user.create_external`, `user.roles_update`, `user.archive`).
- Verify R14 (does an employee email update keep `users.email` in sync?). Fix it if broken and say so, or record it as a defect.

**Acceptance**
1. R1–R13 each have one positive and one negative test.
2. Creating an employee creates a linked user with no explicit role row and full baseline access.
3. Deleting an employee with an elevated role is rejected with a message pointing to the Users page; deleting a baseline-only employee also removes the user.
4. An external user cannot lose their last role; archiving blocks access on the next request.
5. The last active Super-Admin cannot be revoked, archived or deleted; no actor can do those to themselves.
6. Locked-role edit/delete and deleting an assigned role are rejected; saving a role returns the auto-added implied keys.
7. Every mutation writes an audit entry.

### Slice 6 — Sign-in policy (D-013)

**Depends on:** 5.
- `be/auth.py`: remove the `hd` domain gate in `verify_google_credential`; keep `email_verified`. `login_with_google` rejects archived users with a clear 403 and users with no effective access with a "no access assigned" message.
- `be/config.py` and `be/tests/test_config_validation.py`: production start no longer requires `ALLOWED_WORKSPACE_DOMAIN`; update the test, do not delete it.

**Acceptance:** a verified Google account of any domain signs in if and only if a non-archived user with that email exists (case-insensitive); unverified and unknown emails are rejected; archived users get a clear 403; the config test is updated and passes.

### Slice 7a — Frontend: session, navigation and control gating

**Depends on:** 2 and 4. (Spec §12.)
- `fe/api.js` `SessionInfo`: `hasPermission(key)` is a plain membership test (no role or `*` shortcuts); `getPortal()` returns the server's `portal`.
- `fe/public/js/session.js`: choose the portal from the server's `portal` at login and session restore.
- `fe/public/js/admin-nav.js`: module visibility from permissions — HR: any `hr.*`; Finance: any `finance.*` except `finance.payroll.*` and `finance.payroll_tax.*`; Payroll: any `finance.payroll.*` or `finance.payroll_tax.*`; System (new rail entry): `system.roles.manage` or `system.users.manage`, pages `a-system-roles`, `a-system-users`. Default module is the first visible one; Payroll-Maker lands in Payroll.
- Hide admin controls without their key (add/delete employee, salary raise, approve, pay, statutory create, reveal). Backend remains the authority.
- Mock sessions for each of the five roles in `/?mock=<role>`; keep `/?mock=admin` as Super-Admin. Run `npm run build`.

**Acceptance:** per Plan slice 7a (nav per role, approve/pay hidden without keys, no console/page errors for any mock role, existing Playwright specs pass). Add Playwright specs for nav per role and control gating.

### Slice 7b — Frontend: Roles and Users pages

**Depends on:** 5 and 7a. (Spec §12.)
- Pages `a-system-roles` and `a-system-users`, an API module and mock handlers for `/api/access/*`, partials and styles; follow existing patterns (HTML partials in `fe/src/partials/`, scripts in `fe/public/js/`, API clients in `fe/api/`). Run `npm run build`.
- Roles page: list with user counts; permission editor grouped by catalog group; ticking a key ticks everything it implies; unticking a key unticks everything that implies it; non-assignable keys not offered; Super-Admin read-only with an explanation; server messages shown verbatim.
- Users page: filters All / Employees / External / Archived; **External** badge; Employee role never displayed; own-row destructive actions disabled with an explanation; add external user (email, name, ≥1 role); archive with confirmation.
- Employees page shows the server's message when delete is blocked (R4).

**Acceptance:** per Plan slice 7b, with Playwright specs for both pages and the blocked-delete message; labels and keyboard access respected.

### Slice 8 — Cleanup and documentation

**Depends on:** all.
- Delete `require_admin`, the compatibility `role` field and claim, legacy scope helpers and any remaining `role == "admin"` checks. Migration `0026_…` drops `users.role` after confirming no readers remain.
- Make the route-coverage test (every route has a catalog permission marker or is on the named allow-list: `/api/auth/google`, `/api/auth/logout`, `/api/auth/me`, `/api/health`) and the catalog-usage test pass with an unchanged allow-list.
- Update docs: `02-architecture-and-domain-boundaries.md` (§5 rules 2–3, §7), `01-repository-baseline.md`, decision statuses in `04-decision-log.md`, roadmap and open-question registers.

**Acceptance:** a repository search finds no `require_admin`, no `role == "admin"`, no `"*" in perms`, no reference to the role name `system_admin`; full backend and Playwright suites pass with exact counts recorded; the owner reviews the documents.

---

## Part E — Run-log entry (append to `docs/project-context/rbac/run-log.md` after every slice)

1. **Outcome** — one paragraph: what works now.
2. **Branch intake** — branch, start HEAD, end HEAD, merge-base with `main`.
3. **Files changed** — list, with one line each.
4. **Tests** — exact commands and exact results (passed/failed/skipped counts) for: targeted suites, full backend suite, `npm run build`, Playwright suite. Baseline counts from before the slice alongside.
5. **Acceptance criteria** — each numbered criterion marked met / not met / not testable, with the test name that proves it.
6. **Confirmed facts vs assumptions** — what you verified in code, what you assumed, what is still unknown.
7. **Deviations and defects** — anything that differed from this pack or the documents, and unrelated defects found but not fixed.
8. **Documentation updates needed** — decision-log, roadmap and open-question changes the owner should make.
9. **Handoff summary** — five lines: state of the branch, what the next slice needs, risks.

## Part F — Blockers (autonomous handling; the agent does not wait for an answer)

The agent keeps going wherever it safely can. For each blocker it adds a `BLOCKER` entry to the run log (what, where, what it did instead, what the owner must decide) and applies the listed handling.

| Blocker | Handling |
|---|---|
| A document and the code disagree on a fact that affects the design | Follow the code; record the discrepancy; do not edit the decision documents (the owner updates them). |
| A rule is not documented, or an open question in `06-open-questions.md` gates the item | Implement only the documented parts; leave the gated item out or behind the documented interim treatment; record it. Never invent a product decision. |
| A migration cannot be made to work on both SQLite and PostgreSQL | Do not push that migration; record it; continue only with slices that do not depend on it. |
| Baseline or slice tests fail and you cannot fix them within the slice | Do not push a red slice. Record exact failures; stop the run (later slices depend on a green base). |
| The slice would remove access from a real user in a way the plan does not describe | Do not ship that change; record it; continue with the rest of the slice. |
| You need to touch code outside the slice, or edit an applied migration | Do not; record it as a defect or follow-up. |
| A secret, production database or credential would be needed | Never use or request it; record what needs the owner. |

## Part G — Things the author could not verify (confirm early)

- Whether the baseline test suites pass on `feature/rbac` (never run by the author).
- The exact Alembic command and the PostgreSQL test target (an `alembic.ini` exists in `be/`; commands untested).
- How many test modules depend on legacy token minting.
- Whether employee email changes keep `users.email` in sync (rule R14).
- Which frontend screens call `feature-flags` and `observability/metrics` as employees.
