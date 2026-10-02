# RBAC Technical Specification

**Status:** Accepted by the owner on October 1, 2026 (documentation only; no code changed). Reconciled with code on October 1, 2026 (startup seeding and payroll maker-checker corrected).  
**Date:** October 1, 2026  
**Branch intake:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main` / `origin/main`). Alembic head on this branch: `0023_payroll_income_tax_settings`.  
**Governing decisions:** D-011, D-012, D-013 in `../04-decision-log.md`. Role grants: `permission-matrix.md`. Route mapping: `route-guard-inventory.csv`.  
**Risk class:** High-risk change under `AGENTS.md` (permissions, authentication, migrations, data lifecycle). This document is the "Feature Specification & Ingestion" step; the plan is in `implementation-plan.md`.  
**Status labels used below:** implemented · partial · planned · open · unknown.

---

## 1. Goals and non-goals

**Goals**
1. One authorization authority: roles built from permissions. Custom roles can exist; only Super-Admin manages them.
2. Five seeded roles (Super-Admin locked; others editable).
3. Maker/authorizer split for payroll (`prepare`, `approve`, `pay`).
4. Users page and Roles page; identity lifecycle rules (external users, Archived, self-protection, last Super-Admin).
5. Every route guarded by a catalog permission or on an explicit allow-list, enforced by a test.

**Non-goals** (explicitly out of this initiative)
- Archived *employees* (future intake note).
- Deny rules, role inheritance, department/team scoping, attribute-based rules.
- New runtime "different person" rules for maker/authorizer beyond the existing submitter-cannot-approve check (kept as is; only its bypass changes, Q-013).
- Payment-rail changes, background jobs, or new external services.
- Splitting `finance.account.*` (Q-009).

## 2. Verified baseline (read from code; nothing executed)

| Area | Fact | Status |
|---|---|---|
| Tables | `permissions`, `roles`, `role_permissions`, `user_roles` exist (migration 0003). `roles.name` is unique free text. No locked/system flag. | implemented |
| Session | JWT payload: `email, role, employee_id, name, exp` (HS256, `HttpOnly` cookie). `get_current_user` decodes the cookie only; it does not touch the database. | implemented |
| Resolution | `core/permissions.py` unions permissions across the user's roles per request, caches on `request.state`, and adds `*` for the role name `system_admin` or for `admin / superadmin / super_admin / system_admin` in the token claim or `users.role`. | implemented |
| Legacy checks | `auth.require_admin`, `deps.current_user_employee_scope`, `resolve_employee_scope`, `resolve_target_employee`, and inline checks in `employees.py` (2), `salary.py` (1), `finance/routers/activity.py` and `bank_accounts.py` use `role == "admin"`. | implemented |
| Guards | 236 route registrations inventoried. HR routers: 31 `require_admin` registrations (6 are legacy `/api/invoices` aliases) plus 15 role-scoped registrations; finance routers are on `require_permission` except 3 (`activity`, 2× `observability` GET). | implemented |
| Seeding | `seed_rbac` is called from migration 0003 and from `init_db()` on every start (`be/db.py`, invoked at import of `be/main.py`). It inserts missing permission rows, grants all seeded keys to `system_admin`, grants `self.*` to `employee`, and re-links users to roles from the legacy `users.role`. Errors are swallowed. `tests/conftest.py` builds tables with `create_all`; whether tests seed roles was not verified. | implemented / partial |
| Payroll maker-checker | `approve_run` rejects approval by the user who submitted the run unless env `ENFORCE_MAKER_CHECKER=false` or the request passes `allow_self_approval=true` (any `finance.payroll.write` holder). | implemented |
| Employee creation | Inserts `employees` and `users` (legacy role) in one transaction through `repositories/sql/employees.py`; no `user_roles` row. | implemented |
| Employee deletion | `db.delete(emp)` only; the `users.employee_id` FK is `ON DELETE SET NULL` and the ORM relationship has no cascade, so the `users` row appears to survive with its role (read, not executed). | implemented (inferred) |
| Users table | `id, email, role, employee_id (nullable), created_at`. No name, no archive state. | implemented |
| Sign-in | Google ID token verified; `email_verified` required; `ALLOWED_WORKSPACE_DOMAIN` enforced against the Google `hd` claim; **production config validation refuses to start when it is unset**. | implemented |
| Frontend | `SessionInfo.hasPermission` shortcuts on role `admin` / `system_admin` / `*`. `canSeeModule` = role admin/system_admin or any `finance.*` key; HR module always visible; default active module is HR. `session.js` picks the admin or employee portal from `role`. | implemented |
| Storage engine | `Config` rejects any `STORAGE_ENGINE` other than `sql`. Sheets-backed user repositories are legacy. | implemented |
| Test fixtures | `conftest.py` mints tokens with the legacy role via `create_session_token`. Number of test modules depending on it: unknown (≈68 test files exist; 4 were read). | unknown |

## 3. Data model

All changes through Alembic (`be/migrations/versions/0024_…` onward), using batch operations for SQLite and plain DDL for PostgreSQL. Booleans use `server_default` for both engines.

### 3.1 Column changes

| Table | Change | Notes |
|---|---|---|
| `roles` | `system_key` `String(50)` NULL, unique | Stable identity for seeded roles: `super_admin`, `hr_admin`, `financial_admin`, `payroll_maker`, `employee`. Code looks up roles by `system_key`, never by display name. |
| `roles` | `is_locked` `Boolean` NOT NULL default false | True for Super-Admin only. |
| `users` | `name` `String(255)` NULL | Display name for external users; employee-linked users show the employee's name. |
| `users` | `archived_at` `DateTime` NULL | Null = active. |
| `users` | `archived_by` `String(255)` NULL | Actor email. |
| `users.role` | **kept, deprecated** | No code reads it after slice 2. Dropped in the final slice. |
| `permissions` | none | Metadata (group, implies, assignable) lives in the code catalog, not the database. |
| `role_permissions`, `user_roles` | none | Role rows are stored closed under implication. |

### 3.2 Data steps (frozen lists inside the migration; migrations must not import mutable seed code)

1. Rename the existing `system_admin` role to `Super-Admin`, set `system_key='super_admin'`, `is_locked=true`; rename `employee` to `Employee`, `system_key='employee'`.
2. Create `HR-Admin`, `Financial-Admin`, `Payroll-Maker` with their grants from the matrix.
3. Insert any catalog permission rows that are missing.
4. Backfill: every user with `users.role = 'admin'` is assigned Super-Admin (preserves today's access). The owner then downgrades people on the Users page.
5. Payroll split (later slice): every role that holds `finance.payroll.write` receives `prepare`, `approve`, `pay` and `read`; then the old key is removed.
6. Pre-migration data check (read-only script): list users with `employee_id IS NULL`, users with no `user_roles`, and duplicate emails (case-insensitive). The owner decides how to treat any external user without a role **before** migrating, because the rule "an external user always has at least one role" would otherwise be violated.

## 4. Permission catalog (code)

New module `be/core/permission_catalog.py`.

```python
@dataclass(frozen=True)
class PermissionDef:
    key: str                     # "<module>.<resource>.<action>"
    group: str                   # UI grouping, e.g. "HR / Employees"
    description: str
    implies: tuple[str, ...] = ()
    assignable: bool = True      # False for system.*
```

- `CATALOG: tuple[PermissionDef, ...]` — 63 keys (35 existing kept, 25 new, 3 replacing `finance.payroll.write`), listed in the matrix.
- Import-time assertions: key format has exactly three dot-separated parts; every `implies` target exists; no cycles.
- `all_keys()`, `closure(keys)`, `validate_role_keys(keys)` (returns unknown keys and non-assignable keys; implied keys are added by closure).
- `require_permission(key)` asserts at import time that `key` is in the catalog and attaches `fn.hrflow_permission = key` to the dependency so the coverage test can read it.

## 5. Role definitions and sync

- `be/core/role_seed.py` holds the five default roles as `system_key → base keys`. Stored grants are `closure(base)`.
- **Create-once rule:** a role identified by `system_key` is created only if absent. Existing roles are never overwritten, except Super-Admin.
- **Super-Admin:** `role_permissions` rows are kept equal to the full catalog by the sync (for display), and *effective* permissions are computed from the catalog at resolution time (§6). A new key can never be missing for Super-Admin.
- **Catalog sync** (`sync_catalog(db)`), idempotent: insert missing `permissions` rows, update descriptions, sync Super-Admin rows. It never grants keys to editable roles and never deletes keys.
- **Granting new keys to editable roles** happens only through migrations (frozen key lists).
- **When sync runs — decided (Q-010 resolved, D-011):** at application start through the existing `init_db()` path (permission rows and Super-Admin only), plus migrations for grants to editable roles, plus a test asserting that every catalog key exists after migrating a fresh database. The sync must be safe when several workers start together (catch unique-constraint conflicts).
- **Changes required to today's startup seeding** (`seed_rbac` in `init_db()`):
  - Stop re-linking users to roles from `users.role` on every start; after slice 1 the migration assigns roles once, and only the access service changes assignments.
  - Stop granting keys to roles other than Super-Admin.
  - Log errors and fail startup if the RBAC sync fails, instead of `except Exception: pass` (pending owner OK, D-011).
  - Keep migration 0003 working on a fresh database without importing the changed seed (use a frozen copy).

## 6. Permission resolution and session

```python
def resolve_access(db, session_payload) -> AccessContext:
    user = lookup_user(db, session_payload)          # by uid claim, else by email (case-insensitive)
    if user is None or user.archived_at is not None:
        raise HTTPException(401 if user is None else 403, "...")
    assigned = roles_of(db, user.id)                 # user_roles
    baseline = role_by_system_key(db, "employee") if user.employee_id else None
    roles = assigned | ({baseline} if baseline else set())
    if any(r.system_key == "super_admin" for r in roles):
        perms = all_keys()
    else:
        perms = closure(union(role_permission_keys(r) for r in roles))
    return AccessContext(user_id=user.id, email=user.email, employee_id=user.employee_id,
                         permissions=perms, role_names=names_excluding_baseline(roles),
                         portal="admin" if has_admin_surface(perms) else "employee")
```

- **Single authority:** the `role` claim, `users.role`, the `*` wildcard and the role-name `system_admin` are not consulted for authorization. A token whose claim still says `admin` but whose user has no admin role gets no admin access.
- **Where it runs:** inside `get_current_user` (now with `request` and `db`), cached on `request.state`. This adds one indexed lookup plus one roles query per authenticated request, and it is what makes archiving take effect on the next request even with a valid cookie.
- **Return shape:** `get_current_user` keeps returning a dict (so existing handlers keep working) and adds `user_id`, `permissions` (sorted list) and `roles`. This also fixes the inline `finance.adjustment.manage` check, which reads `permissions` from that dict today and always finds none.
- **Transitional `role` in the returned dict:** until slice 8 the dict's `role` is `"admin"` only for Super-Admin and `"employee"` for everyone else, so un-migrated `role == "admin"` checks keep their current meaning. This is separate from the compatibility `role` returned by the auth endpoints for the old frontend (below), which follows `portal`.
- **Token:** add a `uid` claim at login. Tokens without it fall back to email lookup. The `role` claim is still written during the transition for the old frontend and is removed in the final slice; extra or missing claims never invalidate existing cookies.
- **Portal:** `has_admin_surface(perms)` is true when the user holds any permission outside `self.*` and `hr.company_document.read`. `/api/auth/login` and `/api/auth/me` return `permissions`, `portal`, `roles` (names, excluding the baseline) and, until the frontend is migrated, a compatibility `role` (`"admin"` when `portal == "admin"`, else `"employee"`).
- **Baseline derivation is by `employee_id`:** deleting or detaching the employee removes the baseline automatically.

## 7. Scope resolution (own vs all)

Replaces `current_user_employee_scope`, `resolve_employee_scope` and `resolve_target_employee`.

```python
def permission_scope(all_key: str, self_key: str):      # FastAPI dependency factory
    def dep(ctx = Depends(get_access_context)) -> Scope:
        if all_key in ctx.permissions:   return Scope.all()
        if self_key in ctx.permissions and ctx.employee_id is not None:
            return Scope.own(ctx.employee_id)
        raise HTTPException(403, ...)
    return dep
```

- On-behalf-of submission (vacations, requests, claims) requires the corresponding `hr.*.write`; otherwise the target employee is forced to the caller's own employee ID (current behavior, but keyed on permission instead of role).
- Endpoint-by-endpoint keys: `route-guard-inventory.csv` (change types `scope-by-permission`, `key-from-admin`).
- Employee documents and employee reads: own-or-all follows the same helper; `_check_document_access` in `employees.py` is rewritten onto it.

## 8. Guard model and coverage

- Single-key guard: `require_permission(key)`. Own-or-all guard: `permission_scope(all_key, self_key)`.
- `require_admin` is removed in the final slice; the legacy `get_current_user`-only routes are either guarded or placed on an explicit allow-list.
- **Coverage test** walks `app.routes` and each route's dependency tree. A route passes only if it carries a catalog permission marker, or appears in a named allow-list with a one-line justification. Initial allow-list: `/api/auth/google`, `/api/auth/logout`, `/api/auth/me`, `/api/health`.
- **Catalog test:** every key string passed to `require_permission` / `permission_scope` or checked inline exists in the catalog; every catalog key is referenced by at least one guard, a role grant, or an inline check, or is explicitly marked reserved (`system.users.manage`, `system.roles.manage` until the access routes land).
- **Inline checks** (`vendors.py` reveal, `bank_accounts.py` reveal and adjustment, `activity.py` masking) read from the resolved context, not from ad-hoc dict keys.

## 9. Access service (lifecycle rules)

New module `be/core/access_service.py`, called by the access routes and by HR employee create/delete. Rules are enforced here only, inside one transaction per action. Errors use the existing `HTTPException(detail=<string>)` convention; tests assert the HTTP status and a stable message fragment.

| ID | Rule | Status code |
|---|---|---|
| R1 | An actor cannot delete, archive, or revoke the access of their own user (including removing their own roles). | 409 |
| R2 | The last active Super-Admin cannot be revoked, archived or deleted. | 409 |
| R3 | A user without a linked employee must always keep at least one role. Revoking the last one is rejected; the user is archived instead. | 409 |
| R4 | Deleting an employee is rejected while the linked user holds any assigned role other than the baseline. The message tells the Super-Admin to revoke on the Users page first. | 409 |
| R5 | Deleting a baseline-only employee also deletes the linked user in the same transaction. | — |
| R6 | A locked role cannot be edited, renamed or deleted. | 409 |
| R7 | A role that is assigned to any user cannot be deleted. | 409 |
| R8 | Saving a role normalizes the key set to its closure, rejects unknown keys and non-assignable keys, and returns the keys that were auto-added. | 422 |
| R9 | Only the Super-Admin (via `system.users.manage`) can assign roles; assigning Super-Admin is allowed to any Super-Admin. | 403 |
| R10 | Archiving sets `archived_at` and `archived_by`; roles stay on the record. All access is refused at login and on the next request. | — |
| R11 | Archived users cannot have roles changed. Restore is **not built** until Q-006 is decided. | 409 |
| R12 | Provisioning for a new employee: if a non-archived external user already has that email, link it (set `employee_id`) instead of failing; if an archived user has that email, reject (Q-006). | 409 |
| R13 | Role names are unique, 1–100 characters; the five seeded names are reserved against reuse by other roles. | 409 |
| R14 | Employee email changes must keep `users.email` in sync, or sign-in breaks. Whether the current update path does this is **unknown** and is a check item for the plan. | — |

## 10. API contract

Prefix `/api/access`. Roles and catalog endpoints require `system.roles.manage`; users endpoints require `system.users.manage`. Every mutation writes an audit entry through `deps.audit_log` (actions: `role.create`, `role.update`, `role.delete`, `user.create_external`, `user.roles_update`, `user.archive`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/catalog` | Catalog grouped by `group`: key, description, implies, assignable. |
| GET | `/roles` | Roles with id, name, description, `system_key`, `is_locked`, permission keys, `user_count`. |
| POST | `/roles` | `{name, description, permissions[]}` → closure applied, `implied_added[]` returned. |
| PUT | `/roles/{id}` | Same body; rejected for locked roles. |
| DELETE | `/roles/{id}` | Rejected for locked or assigned roles. |
| GET | `/users` | `?search=&filter=all\|employees\|external\|archived`. Row: id, email, name, `employee_id`, `employee_name`, `is_external`, assigned roles (baseline excluded), `archived_at`. |
| POST | `/users` | Create external user: `{email, name, role_ids[≥1]}`. |
| PUT | `/users/{id}/roles` | Replace the assigned-role set (rules R1–R3, R9). |
| POST | `/users/{id}/archive` | Rules R1, R2, R10. |
| POST | `/users/{id}/restore` | Not built until Q-006. |

Changed existing endpoints: `/api/auth/google` and `/api/auth/me` return `permissions`, `portal`, `roles` and the compatibility `role`. HR and finance routes change guards as listed in the inventory CSV.

## 11. Sign-in changes (D-013)

- `verify_google_credential`: remove the `hd` domain gate; keep `email_verified`.
- `login_with_google`: after the email lookup, reject archived users (403, clear message). A user with no effective role (only possible through data corruption) is rejected with a "no access assigned" message.
- `Config` validation: remove the rule that refuses production start without `ALLOWED_WORKSPACE_DOMAIN`; update `test_config_validation.py` accordingly. Keeping the variable as informational is optional.
- Email matching stays case-insensitive; no self-registration exists or is added.

## 12. Frontend specification

Vanilla JS, no framework (per `AGENTS.md`); run `npm run build` in `fe/` after any change; keep mock mode working.

- **`SessionInfo` (`fe/api.js`):** `hasPermission(key)` is a plain membership test; the `role` shortcuts and `*` are removed. `getPortal()` returns the server's `portal`. `getRole()` remains only until callers are migrated.
- **Portal selection (`session.js`):** choose admin or employee portal from `portal` (two places: login success and session restore).
- **`AdminNav` (`admin-nav.js`):** module visibility is derived from permissions:
  - HR: any `hr.*` key (HR no longer always visible).
  - Finance: any `finance.*` key other than `finance.payroll.*` and `finance.payroll_tax.*`.
  - Payroll: any `finance.payroll.*` or `finance.payroll_tax.*` key.
  - System (new rail entry): `system.roles.manage` or `system.users.manage`, with pages `a-system-roles` and `a-system-users`.
  - The default active module becomes the first visible module (today it is hard-coded to HR). Landing page for a Payroll-Maker is the Payroll module. Legacy page-to-module routing (`financeParentMap`) is unchanged.
- **Per-control gating:** admin controls (add/delete employee, salary raise, approve, pay, statutory create, reveal buttons) are hidden unless the key is present. Backend remains the authority.
- **Roles page:** role list with user counts; permission editor grouped by catalog `group`; ticking a key also ticks everything it implies; unticking a key also unticks everything that implies it; non-assignable keys never shown for unlocked roles; the Super-Admin role is read-only with a banner; create/rename/delete with the R6/R7 messages.
- **Users page:** filters (All, Employees, External, Archived); columns: name/email, linked employee or an **External** badge, assigned roles (Employee never shown), status; actions: edit roles, add external user (email, name, at least one role), archive. The signed-in user's own row has its destructive actions disabled with an explanation (R1). Server rule errors are shown verbatim.
- **Employees page:** delete shows the server's R4 message when blocked.
- **Mock mode (`?mock=...`):** add mock sessions for each seeded role and mock handlers for `/api/access/*`, so Playwright can cover navigation visibility and both pages without a backend.

## 13. Rollout and migration safety

- Back up the database before migrating; SQLite (development) and PostgreSQL (production) must both pass the migration tests.
- Slices 1–2 preserve behavior for existing admins by mapping them to Super-Admin; a user who is admin today has everything afterwards.
- The migration data steps use frozen key lists and do not import `rbac_seed`.
- Downgrade paths are provided for schema changes; data steps are documented as one-way except the payroll split (the old key can be recreated and granted to roles holding all three new keys).
- Existing sessions stay valid: new claims are optional, and authorization no longer reads the old `role` claim.

## 14. Audit

Reuse `deps.audit_log` with `actor_email`, `target_type` (`role` / `user`), `target_id` and a details string that lists added/removed keys or roles. Archive and role changes are always logged. Failed rule checks are not logged in this phase.

## 15. Test strategy

- **Unit:** catalog validity, closure, key format, non-assignable enforcement, role normalization.
- **Coverage:** route guard coverage test and catalog-usage test (§8).
- **Resolution:** archived user with a valid cookie gets 403; baseline derived from `employee_id`; Super-Admin gets the full catalog even if `role_permissions` rows are missing; a token claiming `role=admin` without an admin role gets no admin access.
- **Authorization matrix:** for each of the five roles, representative routes per permission key return 200/2xx or 403 as the matrix says; Employee gets 403 on every admin route; Payroll-Maker cannot approve or pay; Financial-Admin cannot prepare; HR-Admin has no finance route access.
- **Lifecycle:** R1–R13 each have a positive and a negative test; employee-create provisions a user and employee-delete follows R4/R5.
- **Migration:** fresh database and database migrated from 0023 end with the same catalog, the five roles, and Super-Admin for former admins.
- **Fixtures:** replace token minting with a helper that creates DB users with chosen roles; keep a thin `admin_cookies` that maps to a Super-Admin user so unrelated suites keep working.
- **Frontend (Playwright):** nav visibility per role in mock mode, Roles-page implication ticking, Users-page badges and disabled self-actions.
- **Final gate:** full backend suite and the Playwright suite once at the end of each slice's PR.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Lockout (no one can manage roles) | R2, locked Super-Admin, backfill of all current admins to Super-Admin, data check before migrating. |
| Silent permission loss for existing admins | Slice 1–2 keep access; authorization matrix tests per role. |
| Per-request database lookup in `get_current_user` | Indexed lookups, `request.state` caching; measure on the heaviest endpoints. |
| Test churn from retiring the legacy role | Fixture helper and a compatibility `admin_cookies`. |
| Frontend default module and landing page for non-HR roles | Explicit slice; Playwright coverage per role. |
| SQLite / PostgreSQL differences in migrations | Batch ops, `server_default`, tests on both engines. |
| External users without roles in existing data | Pre-migration data check and owner decision. |
| Drift between catalog and databases | Sync strategy (Q-010) and the fresh-database test. |
| Production config rule on `ALLOWED_WORKSPACE_DOMAIN` | Change config validation and its test together with D-013. |

## 17. Items that must be verified during implementation (unknown today)

1. Which of the ≈68 test modules depend on the legacy token fixtures.
2. Whether employee email updates keep `users.email` in sync (R14).
3. Frontend call sites of `GET /api/finance/feature-flags` and `/observability/metrics` (do employees call them at startup?).
4. Whether Payroll-Maker needs `finance.account.read` to create a run (Q-007).
5. How the test backfill path seeds roles, to preserve it.
6. Whether the full test suite currently passes on this branch (D-010 cites 252 passing tests on the previous branch; not re-run).
