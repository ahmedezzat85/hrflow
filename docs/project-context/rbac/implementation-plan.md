# RBAC Implementation Plan

**Status:** Plan accepted by the owner on October 1, 2026 (D-011–D-013 accepted); documentation only on `feature/rbac`, no code changes. Implementation starts only after the gates in section 2 are cleared and the owner gives the go-ahead.  
**Date:** October 1, 2026  
**Branch intake:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main` / `origin/main`). Alembic head: `0023_payroll_income_tax_settings`. Baseline test status: **not run** (git and a shell are unavailable on the owner's machine in this session); D-010 cites 252 passing tests on the previous branch.  
**Inputs:** `../04-decision-log.md` (D-011–D-013), `permission-matrix.md`, `technical-spec.md`, `route-guard-inventory.csv`.  
**Risk class:** High-risk (permissions, authentication, migrations, data lifecycle) under `AGENTS.md`. Sizes below are relative (S/M/L), not time estimates.

---

## 1. Principles

1. **Small, independently reviewable slices.** Each slice leaves the application working and the test suite green.
2. **Behavior-preserving first, restrictive later.** Slices 1–2 change the machinery without taking access from anyone; guards tighten only in slices 3–4.
3. **Existing admins keep access.** Every current `users.role = 'admin'` user becomes Super-Admin in slice 1 and can be downgraded later on the Users page.
4. **Backend is the authority.** Frontend hiding is convenience only (`AGENTS.md`).
5. **Targeted tests while working, one full regression at the end of each slice** (`AGENTS.md` verification protocol). Run `npm run build` in `fe/` whenever frontend files change.
6. **No unresolved product decision is implemented.** Slices that depend on an open question are marked blocked.
7. **Do not assign HR-Admin, Financial-Admin or Payroll-Maker to real users until slices 3 and 4 have landed.** Until then un-migrated routes still require Super-Admin, so those roles would appear to have no access.

## 2. Gates before any code

| Gate | Needed for | Owner action |
|---|---|---|
| G1 | Everything | **Cleared (October 1, 2026):** D-011–D-013 and the D-008/D-009/D-010 amendments are accepted. Remaining owner action: commit the documentation changes. Items tagged **[Pending owner OK]** in D-011 (startup seeding change, self-approval bypass) still need approval. |
| G2 | Slice 1 | **Cleared (Q-010 resolved, D-011):** sync permission rows and Super-Admin at application start, grant new keys to editable roles through migrations only. |
| G3 | Slice 1 on real data | Run the read-only pre-migration data check against a **copy** of the production database and decide what to do with any user without a linked employee and without roles. |
| G4 | Slice 5 | None blocking. Restore of archived users stays unbuilt until Q-006 is decided. |
| G5 | Slice 4 | Interim treatment approved: `post-journal` belongs to `finance.payroll.pay` (Q-012); revisit only if the owner changes it. |
| G6 | Slice 4 | **Cleared (Q-013 approved October 2, 2026):** honor the `allow_self_approval` bypass only for a caller holding both `finance.payroll.prepare` and `finance.payroll.approve`. |

## 3. Slice overview

| # | Slice | Size | Depends on | Behavior change for users |
|---|---|---|---|---|
| 0 | Documentation (decisions, questions, roadmap) | S | — | None |
| 1 | Catalog, roles, schema and startup-seeding fix | M | G3 | None |
| 2 | Resolution, session and scope helpers | L | 1 | None for existing admins; archived users blocked |
| 3 | HR guards and self-service keys | L | 2 | HR routes become permission-based |
| 4 | Finance guards and payroll split | M | 2, G5, G6 | Payroll split; tightened endpoints |
| 5 | Access service, API and employee lifecycle | L | 2 | New API; delete/create employee rules |
| 6 | Sign-in policy (any Google domain) | S | 5 | External users can sign in |
| 7a | Frontend: session, navigation, control gating | M | 2, 4 | Role-aware navigation |
| 7b | Frontend: Roles and Users pages | L | 5, 7a | New System pages |
| 8 | Cleanup and documentation | M | all | Legacy removed |

Order: 0 → 1 → 2 → {3, 4, 5} in any order after 2 (3 and 4 before 7a) → 6 after 5 → 7a → 7b → 8.

---

## 4. Slices

### Slice 0 — Documentation (S)
**Goal:** decisions are recorded before behavior changes.  
**Scope:** `docs/project-context/04-decision-log.md`, `05-roadmap-and-next-slices.md`, `06-open-questions.md` (text from the drafts; owner approves each edit).  
**Status:** written to the `feature/rbac` working tree on October 1, 2026 (uncommitted). D-011–D-013 are accepted; the project-context documents were also reconciled with code the same day.  
**Acceptance:** D-011–D-013 present and accepted; D-008/D-009/D-010 amendments recorded; Q-006…Q-012 added to the open-questions register; Archived-employees intake listed; no code touched.

### Slice 1 — Catalog, roles and schema (M)
**Goal:** the catalog and roles exist in code and database with no behavior change.  
**Scope**
- New `be/core/permission_catalog.py` (63 keys plus the transitional deprecated `finance.payroll.write` until slice 4), `be/core/role_seed.py`, `sync_catalog()`.
- Alembic `0024_…`: `roles.system_key`, `roles.is_locked`, `users.name`, `users.archived_at`, `users.archived_by`; frozen data steps from spec §3.2 (rename roles, create the three new roles, insert missing permission rows, assign every legacy admin to Super-Admin).
- Replace the mutable `rbac_seed` usage in migration 0003 with a frozen list only if needed for fresh-database parity; do not edit already-applied migrations in place without a parity test.
- Rewrite `seed_rbac` / the `init_db()` startup step: sync permission rows and Super-Admin only; stop re-linking users from `users.role` and stop re-granting keys on every start; log errors and fail startup if the sync fails (pending owner OK). Keep migration 0003 working on a fresh database through a frozen copy.
- Update `test_rbac.py` expectations (role names, counts).

**Acceptance criteria**
1. Fresh database and database upgraded from 0023 both contain the five roles with the matrix grants (closed under implication) and all catalog permission rows.
2. Super-Admin is flagged `is_locked`; former `users.role = 'admin'` users hold Super-Admin.
3. Catalog import fails on bad key format, unknown implied key or cycle (unit tests). A restart after a role revocation leaves the revocation in place (regression test for the old startup re-link).
4. `sync_catalog()` is idempotent and never touches editable roles' grants.
5. Migration passes on SQLite and PostgreSQL; downgrade restores the schema.
6. Existing test suite unchanged and green (no authorization behavior moved yet).

**Tests:** catalog unit tests, migration tests on a fresh DB and an upgraded DB, `test_rbac.py`.  
**Risks:** renaming `system_admin` must not break code that still looks it up by name (permissions.py until slice 2; tests). Keep a compatibility lookup until slice 2.

### Slice 2 — Resolution, session and scope helpers (L)
**Goal:** the single-authority resolver, with legacy checks still working through compatibility shims.  
**Scope**
- `core/permissions.py`: `resolve_access`, `AccessContext`, derived Employee baseline, Super-Admin from the full catalog, archived check; remove the `*` wildcard and the legacy role-string indicators.
- `auth.py`: `get_current_user` gets `request` and `db`, adds `uid` to new tokens, returns `user_id`, `permissions`, `roles`. Transitional dict `role` is `"admin"` only for Super-Admin so un-migrated `role == "admin"` checks keep their meaning.
- `require_admin` becomes "holds Super-Admin" (shim, removed in slice 8).
- New `permission_scope(all_key, self_key)` helper in `be/deps.py` (old helpers stay until slice 3).
- `routers/auth.py`: `/auth/google` and `/auth/me` return `permissions`, `portal`, `roles` and a compatibility `role`.
- Fix inline adjustment check in `finance/routers/bank_accounts.py` (reads resolved permissions).

**Acceptance criteria**
1. A Super-Admin user can do everything an admin could before (existing admin-based tests pass unchanged).
2. A user whose token says `role=admin` but who holds no admin role gets 403 on admin routes.
3. An archived user with a valid cookie gets 403 on the next request and cannot log in.
4. A user with a linked employee gets the Employee permissions without any `user_roles` row.
5. Super-Admin has all catalog keys even if `role_permissions` rows are missing.
6. A non-admin role holding `finance.adjustment.manage` can record an adjustment.
7. `/auth/me` returns `permissions`, `portal`, `roles`, and a compatibility `role` that keeps the existing frontend working.
8. Existing sessions (tokens without `uid`) still work by email lookup.

**Tests:** new resolution suite (criteria 2–5, 8), fixture helper that creates DB users with chosen roles, regression of existing suites with a compatibility `admin_cookies`.  
**Risks:** one extra lookup per request; verify with the heaviest endpoints. Fixture rework (unknown breadth, spec §17.1).

### Slice 3 — HR guards and self-service keys (L)
**Goal:** every HR route uses catalog keys; scope comes from permissions, not roles.  
**Scope:** the HR routers (all except `auth.py`) and `be/deps.py` per the inventory CSV (change types `key-from-admin`, `scope-by-permission`, `new-key`): HR keys, new `self.*` keys, `hr.employee_bank_account.*`, `hr.export.run` plus dataset keys, `system.audit.read`; rewrite `current_user_employee_scope`, `resolve_employee_scope`, `resolve_target_employee`, `_check_document_access`; new employee-side bank-details read; `reveal=true` requires `hr.employee_bank_account.reveal`.  
**Acceptance criteria**
1. No HR route imports `require_admin`.
2. For every HR route, the guard matches the CSV `proposed_guard`.
3. Employee role gets 403 on every admin-only route and still sees only its own records on scoped routes.
4. HR-Admin passes all HR routes and gets 403 on every finance route.
5. A user with `self.*` plus `hr.*` sees all records.
6. On-behalf-of submission requires the matching `hr.*.write`.
7. Exports: an HR dataset needs `hr.export.run` plus its read key; `finance_*` datasets need `finance.report.read` plus their read key.
8. An employee can read their own masked bank details; reveal is denied without `hr.employee_bank_account.reveal`.

**Tests:** parametrized authorization tests per role (spec §15) for the HR routes; the existing scope tests (`test_employee_scope.py`, `test_authorization.py`) updated, not weakened.  
**Risks:** 15 role-scoped route registrations are the most error-prone; keep one test per registration. The legacy `/api/invoices` aliases share handlers with `/api/salary-payment-docs`; test both.

### Slice 4 — Finance guards and payroll split (M)
**Goal:** maker/authorizer separation and the guard clean-ups.  
**Scope**
- `finance/routers/payroll.py` and `compensation_plans.py`: `prepare` / `approve` / `pay` per the CSV.
- `statutory.py`: `finance.statutory.*`.
- `vendors.py`: payment instructions require `manage` / `verify` only (alias removed).
- `activity.py`: per-entity read guard; fix the undefined `user_permissions` name; masking from resolved permissions.
- `observability.py`: GET endpoints require `finance.settings.read`.
- Migration `0025_…`: every role that holds `finance.payroll.write` receives `read`, `prepare`, `approve`, `pay`; then the old key is removed from the catalog and the database.
- Frontend call-site check for `feature-flags` and `observability/metrics` **before** tightening (spec §17.3).

**Acceptance criteria**
1. Payroll-Maker can preview, adjust, generate/create, add/delete lines, submit and edit compensation plans, and gets 403 on approve, finalize, pay and post-journal.
2. Financial-Admin can approve, finalize, pay and post-journal and gets 403 on prepare routes.
3. Super-Admin can do all.
4. A role holding only `finance.vendor.write` can no longer create, update or verify payment instructions.
5. Statutory routes accept `finance.statutory.*` and reject `finance.bill.*` alone.
6. A user without the entity's read key gets 403 from the activity timeline; the vendor branch no longer raises `NameError` for non-admins.
7. Feature-flag and metrics GETs reject users lacking `finance.settings.read`, and no employee-facing screen breaks.
8. The old `finance.payroll.write` key no longer exists after migration; existing payroll tests pass with Super-Admin.
9. The submitter-cannot-approve check still applies to Payroll-Maker/Financial-Admin pairs; `allow_self_approval` works only for a caller holding both `prepare` and `approve` (Q-013, approved).

**Tests:** extend `test_finance_guided_payroll.py`, `test_finance_vendor_security.py`, `test_finance_statutory_obligations.py`, `test_finance_activity_timeline.py`, `test_finance_observability.py` with per-role cases.  
**Blocked by:** G5 (interim treatment already approved).

### Slice 5 — Access service, API and employee lifecycle (L)
**Goal:** roles and users can be managed through the API and lifecycle rules are enforced in one place.  
**Scope:** `be/core/access_service.py`; `be/routers/access.py` mounted in `main.py` (guards `system.roles.manage`, `system.users.manage`); wire employee create (provision user, rule R12) and delete (rules R1, R4, R5) through the service; audit entries.  
**Acceptance criteria**
1. Rules R1–R13 each have a passing positive and negative test.
2. Creating an employee creates a linked user with no explicit role row and full baseline access; creating an employee whose email matches a non-archived external user links that user.
3. Deleting an employee with an elevated role is rejected with a message pointing to the Users page; deleting a baseline-only employee also removes the user.
4. An external user cannot lose their last role; archiving works and blocks access on the next request.
5. The last active Super-Admin cannot be revoked, archived or deleted; no actor can do these to themselves.
6. Locked role edits/deletes and deleting an assigned role are rejected; saving a role returns the auto-added implied keys.
7. Every mutation writes an audit entry.
8. Employee email-update sync (R14) is verified and fixed or recorded as a defect.

**Tests:** `test_access_service.py`, `test_access_api.py`, employee create/delete integration tests.  
**Risks:** transaction boundaries when HR repositories call the service; keep one session per action.

### Slice 6 — Sign-in policy (S)
**Goal:** D-013.  
**Scope:** `auth.py` (`verify_google_credential` domain gate removed, `login_with_google` rejects archived/no-access users), `config.py` and `test_config_validation.py` (production no longer requires `ALLOWED_WORKSPACE_DOMAIN`).  
**Acceptance criteria**
1. A verified Google account on any domain signs in if and only if a non-archived user exists for that email (case-insensitive).
2. Unverified emails and unknown emails are rejected.
3. Archived users get a clear 403.
4. Production configuration validation no longer demands the domain variable; its test is updated, not deleted.

### Slice 7a — Frontend: session, navigation and control gating (M)
**Goal:** the admin shell reflects the user's permissions.  
**Scope:** `fe/api.js` (`SessionInfo`), `fe/public/js/session.js` (portal from the server), `admin-nav.js` (permission-derived module visibility, first visible module as default, System module shell), per-control gating in the HR and finance scripts, mock sessions for the five roles, `npm run build`.  
**Acceptance criteria**
1. `hasPermission` is a plain membership test; no role shortcuts remain.
2. Payroll-Maker sees only the Payroll module and lands there; Financial-Admin sees Finance and Payroll; HR-Admin sees HR; Super-Admin sees all plus System; Employee sees the employee portal.
3. Approve and Pay controls are hidden without their keys; the backend still returns 403 when called directly.
4. No JavaScript error for any mock role (Playwright console/page-error checks).
5. Existing Playwright specs pass with mock admin = Super-Admin.

**Tests:** new Playwright specs for navigation per role and control gating (`/?mock=<role>`).

### Slice 7b — Frontend: Roles and Users pages (L)
**Goal:** D-011 and D-012 in the interface.  
**Scope:** pages `a-system-roles` and `a-system-users`, `FinanceApi`-style API module and mock handlers for `/api/access/*`, partials and styles, `npm run build`.  
**Acceptance criteria**
1. Roles page lists roles with user counts; the permission editor is grouped by catalog group; ticking a key ticks what it implies; unticking a key unticks what implies it; non-assignable keys are not offered for unlocked roles.
2. The Super-Admin role is read-only with an explanation; create, rename and delete behave per R6/R7, with server messages shown.
3. Users page filters All / Employees / External / Archived; external users carry an **External** badge; the Employee role is never displayed; the signed-in user's own destructive actions are disabled with an explanation.
4. Adding an external user requires email, name and at least one role; archive asks for confirmation and shows the row as archived.
5. Employees page shows the server message when a delete is blocked by R4.
6. Accessibility basics from D-010 phase work are respected (labels, keyboard).

**Tests:** Playwright specs for both pages and for the blocked-delete message.

### Slice 8 — Cleanup and documentation (M)
**Goal:** remove transitional code and finalize records.  
**Scope:** delete `require_admin`, the compatibility `role` field and claim, legacy scope helpers, any remaining `role == "admin"` checks; migration `0026_…` drops `users.role` after confirming no readers remain; update `02-architecture-and-domain-boundaries.md` (§5 rules 2–3, §7), `01-repository-baseline.md`, `AGENTS.md` note on `sql`; set decision statuses to Accepted; final full regression.  
**Acceptance criteria**
1. Searching the repository finds no `require_admin`, no `role == "admin"`, no `"*" in perms`, and no reference to the role name `system_admin`.
2. Route-coverage and catalog-usage tests pass with an unchanged allow-list.
3. Full backend suite and the Playwright suite pass; results recorded with exact counts.
4. Documents updated and reviewed by the owner.

---

## 5. Traceability: decisions to slices

| Decision point | Slice |
|---|---|
| Single authority, no `*`, legacy retired | 2, 3, 8 |
| Code-defined catalog, no prefix wildcards | 1 |
| Write implies read; role normalization | 1 (catalog), 5 (API), 7b (UI) |
| Maker/authorizer split | 4 |
| Five seeded roles, Super-Admin locked, create-once seeding | 1, 5 |
| `system.*` non-assignable | 1, 5 |
| Scope from keys | 2, 3 |
| Employee baseline derived | 2 |
| Users page, external users, labels | 5, 7b |
| Deletion rules, self-protection, last Super-Admin | 5 |
| Archived (no disable), roles kept, access blocked | 2 (check), 5 (action), 7b (UI) |
| Sign-in any Google domain | 6 |
| Guard clean-ups (vendor alias, activity, flags, adjustment) | 2 (adjustment), 4 |
| Coverage test | 1 (catalog test), 3–4 (route test grows), 8 (allow-list frozen) |
| D-008 / D-009 / D-010 amendments | 0, 4, 7a |

## 6. Verification commands (to confirm locally; not run here)

- Backend (from the repository's backend directory): `pytest tests/<file>.py -q` during work; full `pytest -q` once per slice.
- Frontend: `npm run build` in `fe/`; `npx playwright test tests/ui/<spec>.js --reporter=line`.
- Migrations: Alembic upgrade/downgrade on a fresh SQLite database and on a copy of the production-shaped database; the exact Alembic invocation and PostgreSQL test target are **unknown** here and should be confirmed.

## 7. What does not change

Payroll calculation, statutory and tax logic, ledger behavior, export content, document storage, and the Employee portal layout. Only who may call which route, and how identity and roles are managed, change.

## 8. Handoff checklist at the end of each slice

Outcome; files changed; tests run with exact counts; confirmed facts versus assumptions; decision-log, roadmap and open-question updates required; short handoff summary for the next thread (per project thread protocol).
