# RBAC Review Fixes — Coding-Agent Handoff Pack

**Audience:** any coding agent that will fix the findings of the October 3, 2026 code review of `feature/rbac`.
**Owner:** repository owner. **Run mode: autonomous**, same rules as `agent-handoff.md` (Parts E and F of that file apply here unchanged: run-log entry after every slice, blocker handling).
**Date written:** October 3, 2026
**Baseline when written:** branch `feature/rbac`, HEAD `d6c718d94102df7d05523acb337511d8dea2eb57`, merge-base with `main` `c236b00cb6fea09cb3474cb8d5fbda66eb23135e`, Alembic head `0026_drop_users_role`. Development database is SQLite.
**Working tree:** there are **uncommitted, untested** changes on top of HEAD (slice F0 below). They were syntax-checked only (`py_compile`, `node --check`); no test suite and no frontend build was run.

Companions (read, do not guess): `technical-spec.md`, `permission-matrix.md`, `implementation-plan.md`, `agent-handoff.md`, `run-log.md`, and decisions D-011 to D-013 in `../04-decision-log.md` including the **October 3, 2026 amendments**.

---

## Part A — Master prompt (paste to the agent)

> You are fixing code-review findings on the RBAC initiative in the HRFlow repository (FastAPI + SQLAlchemy/Alembic backend in `be/`, vanilla JS frontend in `fe/` built with Vite), on branch `feature/rbac`.
>
> **Read first, in this order:** `AGENTS.md`; `docs/project-context/00-project-start-here.md`; `docs/project-context/rbac/review-fix-handoff.md` (this file); `docs/project-context/rbac/technical-spec.md`; `docs/project-context/rbac/permission-matrix.md`; decisions D-011, D-012, D-013 with their October 3, 2026 amendments in `docs/project-context/04-decision-log.md`; Parts E and F of `docs/project-context/rbac/agent-handoff.md`.
>
> **Source of truth:** code, migrations and tests on the branch. If a document disagrees with the code, follow the code and record it in the run log. Never invent a product decision; Part B lists the decisions already made.
>
> **Before editing:** write a branch-intake block (branch, HEAD, merge-base with `main`, slice range, working-tree state from `git status`) to `docs/project-context/rbac/run-log.md`.
>
> **Work rules:**
> - Run slices F0 to F7 in order. One commit per slice, message starting with the slice id (for example `RBAC-F1: remove dev/test auto-provisioning from access resolution`), pushed to `feature/rbac`. Never push to or merge into `main`.
> - No unrelated refactoring, formatting churn or dependency upgrades. The repository mixes CRLF and LF files: keep each file's existing line endings.
> - Do not weaken a test, validation, audit entry or safeguard to make something pass. Change a test only to match an intentional behavior change listed in this file, and say so in the run log.
> - Backend is the authority; frontend hiding is convenience only.
> - Schema changes only through Alembic, working on SQLite and written to be valid on PostgreSQL. PostgreSQL is not available yet: mark it "untested" in the run log, do not skip the portability work.
> - Run `npm run build` in `fe/` after any frontend change and keep `/?mock=admin` working.
> - Targeted tests while working; full backend suite (`pytest -q` in `be/`) and full Playwright suite (`npx playwright test --reporter=line` in `fe/`) once at the end of each slice. Record exact passed/failed/skipped counts. Known pre-existing failures are listed in the "Baseline Test Results" section of `run-log.md`; anything else that fails is yours to fix before pushing.
> - Do not ask the owner questions mid-run. For anything undecided, follow Part F of `agent-handoff.md`.
>
> **After each slice:** append the Part E run-log entry from `agent-handoff.md`, include it in the slice's commit, push, continue. Finish with a one-page summary: slices done, blockers, what the owner must do next.

---

## Part B — Decisions already made (do not reopen)

| # | Decision | Source |
|---|---|---|
| 1 | **One assigned role per user.** Effective access = that role + the derived Employee baseline when an employee is linked. External users have exactly one role; linked employees have zero or one. | D-011 / D-012 amendments, October 3, 2026 |
| 2 | The Employee role is never assigned to or shown on a user. It **is** editable on the Roles page, and edits (including removing a permission) must take effect for all employees. | D-011, D-012; owner, October 3, 2026 |
| 3 | A custom role may combine `finance.payroll.prepare` with `approve` / `pay`; the role editor does not block it. | D-011 amendment |
| 4 | **No restore of archived users.** The restore/unarchive endpoint and button are removed. Q-006 stays open. | Owner, October 3, 2026; Q-006 |
| 5 | Existing development users and their role rows need no careful migration. A simple deterministic cleanup is enough. | Owner, October 3, 2026 |
| 6 | PostgreSQL migration runs happen when the owner moves to PostgreSQL. Migrations must still be written to be valid there; migration `0024` is corrected in place because it has only run on development databases. | Owner, October 3, 2026 |

---

## Part C — Findings register (what the review found, and where it is fixed)

| ID | Severity | Finding | Location at review time | Slice |
|---|---|---|---|---|
| B1 | Critical | `resolve_access` auto-creates unknown users, grants Super-Admin from the token `role` claim, and auto-links Super-Admin to any `admin@…` email whenever `ENVIRONMENT` is `development` or `test`. `development` is the default (`config.py`). | `be/core/permissions.py` (`resolve_access`), `be/routers/auth.py` (`admin@hrflow.test` fallback) | F1 |
| B2 | Critical (PostgreSQL) | Migration 0024 uses `server_default '0'` and `is_locked = 1` / `0` literals on a Boolean column. | `be/migrations/versions/0024_rbac_schema_and_roles.py` | F2 |
| B3 | High | R4 bypass: `RoleDB.system_key != "employee"` drops custom roles (NULL key). | `be/core/access_service.py` (`on_employee_delete`) | F0 (done, verify) |
| B4 | High | Legacy explicit Employee rows in `user_roles` survive migration 0024. | data | F2 |
| B5 | High | Users page: search and role filter assume string roles; real API returns objects. | `fe/public/js/system-access.js` | F0 (done, verify) |
| B6 | High | Roles page never uses the server catalog (`data.permissions` on a list response) and reads `is_system`, which the API does not send. | `fe/public/js/system-access.js` (`loadCatalog`, `renderRolesTable`, `openEditRoleModal`, `deleteRole`) | F4 |
| B7 | Medium | Starting the app before `alembic upgrade` lets `init_db` add columns and `sync_catalog` create a second Super-Admin next to legacy `system_admin`. | `be/db.py`, `be/core/role_seed.py` | F2 |
| B8 | Medium | `sync_catalog` calls `db.rollback()` on a unique conflict, discarding earlier flushed inserts while keeping stale objects. | `be/core/role_seed.py` | F2 |
| B9 | Medium | Employee email change: no collision check; duplicate raises 500. | `access_service.on_employee_email_update` | F3 |
| B10 | Medium | `on_employee_create` commits in the middle of the repository transaction. | `be/core/access_service.py`, `be/repositories/sql/employees.py` | F3 |
| B11 | Medium | Unescaped names in `innerHTML` (roles table, permission picker). Users table and role modal were escaped in F0. | `fe/public/js/system-access.js` | F4 |
| B12 | Low | Migration 0025 downgrade binds a tuple to `IN :keys` without an expanding bind parameter (fails on SQLite). | `be/migrations/versions/0025_payroll_split.py` | F2 |
| D1 | Drift | Restore of archived users was built (Q-006 says not built). | `be/routers/access.py`, `access_service.unarchive_user`, `fe/api.js`, `system-access.js` | F5 |
| D2 | Drift | Six alias routes and role-name lookup for role assignment. | `be/routers/access.py` | F0 (done, verify) |
| D3 | Drift | Employee baseline permissions always come from code, so the Employee role cannot lose a permission. | `be/core/permissions.py` (`resolve_access`) | F3 |
| D4 | Drift | Users page: no add-external-user, no All/Employees/External/Archived filter, no External badge, own-row actions not disabled. | `fe/` | F5 |
| D5 | Drift | Employee delete is two transactions; the HR repository still deletes `users` rows. | `access_service.on_employee_delete`, `repositories/sql/employees.py` (`delete`) | F3 |
| D6 | Drift | Coverage test accepts hand-written endpoint markers and a free-text `hrflow_proposed_guard`. | `be/tests/test_rbac.py` (`test_all_routes_guard_coverage_walker`), several routers | F6 |
| D7 | Drift | Slices 6–8 recorded only targeted test runs. | `run-log.md` | every slice here |
| D8 | Drift | Roles page: unticking a key does not untick keys that imply it; non-assignable keys are shown; rename is never sent. | `fe/public/js/system-access.js` | F4 |
| D9 | Leftover | Compatibility `role` in `/api/auth/google` and `/api/auth/me`; dead `current_user_employee_scope` / `resolve_employee_scope`; `finance.payroll.write` in `MOCK_PERMISSIONS_ALL`; "Google Workspace account" in the employee-create message; stale `00`/`01`/`05` docs. | various | F7 |
| D10 | Test gap | Playwright mock data has a different shape from the real API (`is_system` vs `is_locked`/`system_key`). | `fe/public/js/system-access.js`, `fe/tests/ui/rbac-system-pages.spec.js` | F4, F6 |

---

## Part D — Slice packets

### F0 — Verify and commit the single-role change (already in the working tree)

**State:** uncommitted edits in 11 files:
`be/core/access_service.py`, `be/routers/access.py`, `be/tests/test_rbac.py`, `fe/api.js`, `fe/public/js/system-access.js`, `fe/src/partials/modals/assign-roles-modal.html`, `fe/src/partials/admin/sections/system-users.html`, `fe/tests/ui/rbac-system-pages.spec.js`, `docs/project-context/04-decision-log.md`, `docs/project-context/rbac/technical-spec.md`, `docs/project-context/rbac/permission-matrix.md` (plus this file).

**What they do**
- `AccessService.set_user_role(user_id, role_id, actor_user)` replaces `update_user_roles`; `create_external_user` takes one `role_id`; `_get_assignable_role` rejects the Employee role (422); `list_users` and the responses return `role` (object or null) instead of `roles`; `list_users.name` prefers the linked employee's name.
- `PUT /api/access/users/{id}/role` with `{role_id}` is the only assignment route. The `/roles`, `/role` POST, and `PUT/PATCH /users/{id}` aliases and the name lookup are removed.
- R4 filters in Python so custom roles (NULL `system_key`) count as elevated.
- Frontend: radio modal, Employee never offered, "No additional role" only for linked employees, single Role column, `Api.setUserRole`, HTML-escaped user and role names in the users table and modal, mock users in API shape.
- Tests: slice-5 tests moved to the new route and payload; `test_assign_super_admin_role_methods_and_payloads` replaced by `test_single_assigned_role_per_user`; new `test_r4_blocks_delete_for_custom_role_holder`; Playwright users test asserts radios and no Employee option.

**Do**
1. Run `pytest tests/test_rbac.py -q`, then the full backend suite, `npm run build`, then the Playwright suite. Fix whatever these changes broke (look for other consumers of `roles` on user rows, `role_ids`, or the removed routes).
2. Commit as `RBAC-F0`.

**Acceptance**
1. Assigning a role replaces the previous one; `user_roles` holds one row for that user afterwards.
2. Assigning the Employee role returns 422, both on `PUT …/role` and on `POST /api/access/users`.
3. A linked employee can be set to no role (200) and keeps baseline access; an external user cannot (409).
4. The users list never contains the Employee role.
5. The old alias routes return 404/405.
6. Deleting an employee whose user holds a custom role returns 409.
7. `fe/dist/index.html` is rebuilt and contains no `assignUserRoles`.

### F1 — Close the resolver back door (B1)

**Build**
- `be/core/permissions.py` `resolve_access`: delete the development/test auto-provision block (unknown user → always 401) and the `admin@` auto-link block. Decide Super-Admin by `system_key == "super_admin"` only (drop the `r.name == "Super-Admin"` alternative); same in `UserDB.role` (`be/models_db.py`) if that property survives F7.
- `get_current_user_permissions`: remove the `except Exception: pass` around `resolve_access`.
- `be/routers/auth.py`: remove the `except TypeError` retry and the block that falls back to `admin@hrflow.test` / `employee@hrflow.test`.
- Tests: `be/tests/conftest.py` and any module minting tokens (`create_session_token`) must create their users in the database with the wanted role through a fixture helper (spec §15), instead of relying on auto-provisioning. `admin_cookies` maps to a real Super-Admin user; the employee fixture maps to a user linked to an employee.

**Acceptance**
1. A valid token for an email with no `users` row gets 401 with `ENVIRONMENT=development`, `test` and `production` (parametrized test).
2. A token claiming `role=admin` for a non-existent user creates nothing (assert the `users` count is unchanged).
3. A user whose email starts with `admin@` and who holds only Payroll-Maker does not receive Super-Admin.
4. Searching `be/` (excluding `tests/`) finds no `hrflow.test` and no `ENVIRONMENT in ("development", "test")` in authorization code.
5. Full backend suite: no new failures.

**Blocker if:** a test module cannot be moved to database-created users without weakening it. Record it; do not re-add auto-provisioning.

### F2 — Migrations, startup and the one-role constraint (B2, B4, B7, B8, B12)

**Build**
- `0024_rbac_schema_and_roles.py` (edit in place, decision 6): `server_default=sa.false()` for `is_locked`; every `is_locked = 1` / `0` and `VALUES (…, 1, …)` literal becomes a bound parameter (`:locked` with `True` / `False`).
- `0025_payroll_split.py` downgrade: use `bindparam("keys", expanding=True)` / `bindparam("pids", expanding=True)` for the two `IN` clauses.
- New `0027_single_assigned_role.py`:
  1. Delete every `user_roles` row that points to the role with `system_key = 'employee'`.
  2. For a user who still holds more than one row, keep one: Super-Admin if present, otherwise the lowest `role_id` (decision 5).
  3. Add a unique constraint on `user_roles.user_id` (`uq_user_roles_user`) with `batch_alter_table`. Downgrade drops it.
- `be/core/rbac_models.py`: add the same unique constraint to `UserRoleDB.__table_args__`.
- Tests that insert several rows for one user must be adjusted to the rule, not weakened: `_create_test_user_with_roles` in `be/tests/test_rbac.py` skips the `employee` key (the baseline comes from `employee_id`); `test_user_holding_both_self_and_hr_sees_all_records` keeps `employee_id` and assigns only `hr_admin`; `be/tests/test_finance_activity_timeline.py` replaces the existing row instead of adding a second custom role.
- `be/core/role_seed.py` `sync_catalog`: if no role has `system_key = 'super_admin'` but a role named `system_admin` exists, adopt it (rename to `Super-Admin`, set `system_key`, `is_locked`) instead of creating a second role. Replace `db.rollback()` in the three conflict handlers with savepoints (`with db.begin_nested():` around each insert).

**Acceptance**
1. `alembic upgrade head` on a fresh SQLite database and on a copy upgraded from `0023` both succeed; `alembic downgrade 0023_payroll_income_tax_settings` then `upgrade head` succeeds.
2. After `0027`, no `user_roles` row references the Employee role and no user has two rows; inserting a second row for a user raises `IntegrityError` (test).
3. A database at `0023` on which the application is started before migrating ends up with exactly one Super-Admin role after `upgrade head` (test with `sync_catalog` run against a pre-0024 role set).
4. `sync_catalog` run twice concurrently-simulated (second run sees a conflict on one insert) still leaves every catalog key present (test forcing one `IntegrityError`).
5. No integer literal is written to a Boolean column in any migration on this branch (grep recorded in the run log). PostgreSQL: "written for, untested".

### F3 — Employee lifecycle and editable Employee role (B9, B10, D3, D5)

**Build**
- `AccessService` lifecycle hooks stop committing; they work in the caller's session and the caller commits once:
  - `on_employee_create`: no `commit()`; `repositories/sql/employees.py` `create` commits at its end as it already does.
  - Delete: split into `validate_employee_delete(employee_id, actor_user)` (rules R1, R2, R4; no writes) called by the router, and `remove_user_for_employee(employee_id)` (no commit) called by the repository inside the same transaction that deletes the employee. The repository no longer queries or deletes `UserDB` itself.
  - Email: `validate_employee_email_change(employee_id, new_email)` raises 409 when another user (archived or not) already has that email; the sync of `users.email` happens in the same transaction as the employee update.
- `resolve_access`: the Employee baseline is the permission set of the database role with `system_key = 'employee'`. Use `DEFAULT_ROLES["employee"]` only when that role row does not exist. Remove the unconditional `raw_perms.update(emp_base.permissions)`.
- `AccessService.delete_role`: reject deleting the role with `system_key = 'employee'` (409, "The Employee role provides baseline access and cannot be deleted"). Record this in the run log as a rule added for integrity of decision 2.

**Acceptance**
1. Removing `self.salary.read` from the Employee role on the Roles API makes a baseline-only employee get 403 on `GET /api/salary/history` on the next request; adding it back restores access.
2. If the employee delete fails after the user removal (force an error in the repository), neither row is gone (rollback test).
3. Creating an employee whose later step fails leaves no `employees` and no `users` row.
4. Changing an employee's email to one that another user holds returns 409 and changes nothing.
5. `be/repositories/sql/employees.py` contains no `UserDB` write.
6. R1, R2, R4, R5, R12, R14 tests still pass.

### F4 — Roles page (B6, B11, D8, D10)

**Build** (`fe/public/js/system-access.js`, `fe/src/partials/modals/role-modal.html`)
- `loadCatalog`: the API returns `[{group, permissions:[{key, description, implies, assignable}]}]`. Flatten it to the internal list (adding `group` to each item). Keep `DEFAULT_CATALOG` for mock mode only, and make its `implies` match `be/core/permission_catalog.py` (today `finance.vendor_payment.*` and `finance.adjustment.manage` differ).
- Replace `role.is_system` with `!!role.system_key` and `role.name === 'Super-Admin'` with `role.is_locked`. Mock roles get `system_key` and `is_locked` and include the Employee role, so mock and API shapes are the same.
- Locked role: Edit opens read-only with the explanation banner (spec §12), not a disabled button with a toast.
- Send `name` on update for roles without a `system_key` (rename); seeded roles keep a read-only name.
- Unticking a key also unticks every key that implies it (spec §12), instead of leaving it ticked and disabled.
- Do not render non-assignable keys for unlocked roles.
- Escape role names, descriptions and catalog text wherever they go into `innerHTML` (reuse `escHtml`).
- Delete button: disabled for locked roles and for the Employee role; other roles rely on the server's R7 message, shown verbatim.

**Acceptance**
1. With the backend running (not mock mode), the Roles page shows the server catalog groups and the System badge on the five seeded roles.
2. Ticking `hr.employee.write` ticks `hr.employee.read`; unticking `hr.employee.read` unticks `hr.employee.write`.
3. `system.*` keys are not offered when editing HR-Admin; Super-Admin opens read-only.
4. Renaming a custom role persists; a role named `<img src=x onerror=alert(1)>` renders as text.
5. Playwright spec for the Roles page updated and passing; no console or page errors.

### F5 — Users page (D1, D4)

**Build**
- Remove restore: `@router.post("/users/{user_id}/unarchive")` and `/restore` in `be/routers/access.py`, `AccessService.unarchive_user`, `Api.unarchiveUser`, the Restore button and the restore branch of `toggleUserArchive`, and the restore step in `fe/tests/ui/rbac-system-pages.spec.js`.
- `list_users` adds `is_self` (the row is the acting user); the router passes the actor. The frontend disables Role and Archive on that row with the tooltip "You cannot change your own access" (R1).
- Archived rows show no Role and no Archive button.
- Filter control: All / Employees / External / Archived, sent as `GET /api/access/users?filter=`; search sent as `?search=`. The current role dropdown may stay as a second, client-side filter.
- **External** badge on users without a linked employee (replace the "External Account" caption).
- "Add external user" button and modal: email, name, one role (select, Employee not offered); `Api.createExternalUser` → `POST /api/access/users` `{email, name, role_id}`; server errors shown verbatim.
- Mock handlers for all of the above so `/?mock=admin` keeps working.

**Acceptance**
1. `POST /api/access/users/{id}/unarchive` and `/restore` return 404/405; no "Restore" text in `fe/`.
2. Each filter shows the right rows against a real backend; External users carry the badge.
3. The signed-in user's own row has disabled actions with the explanation.
4. Adding an external user without a role is blocked in the form; with a role it appears in the list with the badge.
5. Playwright spec for the Users page updated and passing.

### F6 — Test integrity (D6, D10)

**Build**
- Routes that check permissions inline become dependency-guarded so the marker and the enforcement are the same object:
  - Own-or-all writes (`POST /api/vacations/request`, `POST /api/requests`, `POST /api/insurance/claims`) and `GET /api/insurance/categories`, `GET /api/employees/{id}/bank-account`: use `permission_scope(all_key, self_key)` (or a small `permission_any(*keys)` factory in `be/deps.py` that sets the same markers) as the dependency.
  - `be/routers/export.py`: a dependency that reads the `dataset` path parameter and applies `check_export_permission`.
  - `be/finance/routers/activity.py`: a dependency that reads `entity_type` and applies the per-entity read key; unknown entity types are rejected (400) before any data access.
- Remove every hand-set `fn.hrflow_permission_all = …`, `fn.hrflow_permission_self = …` and `fn.hrflow_proposed_guard = …` on endpoint functions (`be/routers/access.py`, `employees.py`, `insurance.py`, `requests.py`, `vacations.py`, `salary.py`, `employee_bank_accounts.py`, `export.py`, `finance/routers/activity.py`).
- `test_all_routes_guard_coverage_walker` and `test_catalog_usage`: read markers only from the route's dependency tree (walk `dependant.dependencies` recursively); the allow-list stays `/api/auth/google`, `/api/auth/logout`, `/api/auth/me`, `/api/health`.

**Acceptance**
1. Temporarily removing a guard dependency from any route makes the walker fail (prove it once with a throwaway route in the test).
2. No `hrflow_proposed_guard` and no endpoint-level marker assignment remains (grep recorded).
3. Existing authorization tests for the converted routes pass unchanged.

### F7 — Cleanup and records (D9, D7)

**Build**
- Remove the compatibility `role` from `LoginResponse` (`be/models.py`, `be/routers/auth.py`); frontend `SessionInfo` stops storing `_role` (`isKnown()` uses the portal), `admin-nav.js` stops calling `getRole()`; mock sessions drop `role`.
- Delete `current_user_employee_scope` and `resolve_employee_scope` from `be/deps.py`; remove `UserDB.role` property and the `role` kwarg shim if no reader remains (grep first; `repositories/sql/auth.py` and `be/auth.py` read it today).
- Remove `finance.payroll.write` from `MOCK_PERMISSIONS_ALL` in `fe/public/js/session.js`.
- Employee-create message: "They can now sign in with their Google account."
- Documents: `00-project-start-here.md` (§3–§4), `01-repository-baseline.md` (RBAC sections, migration count, guard coverage), `05-roadmap-and-next-slices.md` (§2, §3A status, §6), and `rbac/implementation-plan.md` status line, so they describe the implemented state. Do not change decision texts.

**Acceptance**
1. A repository search finds no `require_admin`, no `role == "admin"`, no `"*" in perms`, no `system_admin` role-name reference outside migrations, and no compatibility `role` in the auth responses.
2. Full backend suite and full Playwright suite pass (pre-existing baseline failures aside), with exact counts in the run log.
3. Final one-page summary written.

---

## Part E — Things the author could not verify (confirm early)

- Whether the F0 working-tree changes pass the suites (never executed).
- Whether any test or script outside `be/tests/test_rbac.py` uses `roles` on user rows, `role_ids`, or the removed alias routes.
- How many test modules rely on the auto-provisioning removed in F1.
- PostgreSQL behavior of any migration on this branch.
- Whether the Windows development environment needs anything beyond `be/requirements.txt` and `fe/package.json` to run both suites.
