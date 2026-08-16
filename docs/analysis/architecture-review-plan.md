# HRFlow Architecture Review Plan

Branch: security-analysis
Base: main

## Scope
Architecture quality, maintainability, cloud readiness, and backend/frontend best-practice comparison for the HRFlow platform (as of the `salary` branch).

## Main Concerns
1. Google Sheets used as the primary datastore (no transactions, no row locking, API quota limits, no schema enforcement)
2. Monolithic backend entrypoint (`be/main.py`, ~900 lines, 40+ endpoints across employees/documents/requests/vacations/insurance/salary)
3. No service/router layering - business logic, data access, and HTTP concerns are mixed together
4. Global mutable state on the frontend (`employees`, `insuranceClaims`, `currentLoggedInEmployee`, etc. shared across JS files)
5. Zero automated test coverage, including for salary/raise calculation logic
6. No pagination or caching strategy - every list endpoint fetches the entire sheet on every request
7. No containerization or reproducible deployment definition
8. No structured audit trail or cloud-native observability (JSON logs, deep health checks)
9. Denormalized `employee_name` duplicated across Requests/VacationHistory/InsuranceClaims/SalaryHistory
10. Race-condition-prone `next_id()` pattern for ID generation under concurrent writes

## Review Areas

### Backend
- API boundaries and router decomposition (split `main.py` into `routers/`, `services/`)
- Authorization consistency (single source of truth for role-based filtering)
- Storage abstraction (isolate Google Sheets/Drive behind a repository interface to ease a future Postgres migration)
- Validation strategy (Pydantic model coverage, upload content validation)
- Error handling consistency (mix of raised HTTPException vs. silent fallbacks)
- Dependency management (pinned versions, no hash verification, no test dependencies)

### Frontend
- State management (replace ad hoc globals with a defined store, or migrate to a component framework)
- Modularity of `fe/src/js/*.js` files
- Session lifecycle (token storage, cookie mirroring, expiry handling)
- Configuration handling (`config-example.js` pattern)
- Date/time correctness (hardcoded dates found in `salary.js`)
- General maintainability of a 41KB single-page HTML file with no build-time component structure

### Cloud / Ops
- Secret management (service account JSON file vs. Workload Identity on GKE/Cloud Run)
- Health checks (shallow `/api/health` vs. dependency-aware deep health check)
- Structured logging (plain text file logs vs. JSON to stdout for Cloud Logging)
- Scalability limits of the Sheets/Drive model under real usage growth
- Migration path to a managed relational database (e.g. Cloud SQL for PostgreSQL)
- API versioning (no `/v1` prefix currently)

## Suggested Phasing (for later, after security Phase 1-5 lands)
1. Backend decomposition into routers/services (no behavior change, pure refactor)
2. Introduce caching layer for read-heavy Sheets calls
3. Add automated tests for salary/insurance calculation logic before further refactors
4. Data model cleanup (remove denormalized name fields, fix `next_id()` race condition)
5. Evaluate and plan Postgres migration as a separate, larger initiative
6. Frontend state/modularity improvements
7. Cloud-native observability and deployment hardening (Docker, structured logs, deep health checks)

## Notes
This file intentionally does not propose code changes yet. Architecture changes should be sequenced after the security remediation phases in `security-analysis-plan.md`, since several architecture items (e.g. router decomposition) will touch the same files as security fixes (e.g. `be/main.py`).


## Frontend Hardening Backlog (added after Phase 3 security headers)

These items are deliberately deferred from the security phases because
they are refactors, not header/config changes, and touch every page of
the UI. Tracked here so they aren't lost.

1. **Remove inline event handlers, tighten CSP.** The frontend currently
   uses `onclick="..."` attributes throughout `fe/src/index.html` and an
   inline `<style>` block, which requires `Content-Security-Policy` to
   include `'unsafe-inline'` for both `script-src` and `style-src` (see
   `be/main.py`'s `security_headers` middleware, Phase 3). This still
   blocks third-party/supply-chain script injection, but does **not**
   block an attacker's inline `<script>` or `onclick="..."` injected via
   an XSS bug elsewhere in the app (e.g. via the several places the
   frontend builds HTML with unescaped template literals - document
   names, employee names, etc.).
   - Migrate all `onclick="fn(...)"` attributes to `addEventListener`
     calls wired up in the relevant `fe/src/js/*.js` module.
   - Move the inline `<style>` block to a CSS file already partially done
     via `fe/src/styles.css` in the Vite migration - verify no inline
     `<style>` remains in `fe/src/index.html`.
   - Once both are done, drop `'unsafe-inline'` from `script-src` and
     `style-src` in `_CSP_POLICY` (`be/main.py`) and add `nonce`-based or
     `strict-dynamic` script loading instead.
   - Also audit and HTML-escape all user-controlled strings interpolated
     into `innerHTML` (documents, employee names, notes) rather than
     relying solely on CSP for this class of bug.

2. **`fe/dist/` build artifact drift.** Confirmed via `fe/vite.config.js`
   that `fe/dist/` is fully generated output (Vite build), and
   `fe/public/js/*.js` is the real build input consumed by the
   `singleFileDeployBundle` plugin - not just a duplicate of
   `fe/src/js/*.js`. Both `fe/dist/` and `fe/public/js/` are currently
   committed to git, which allowed them to silently drift out of sync
   with `fe/src/js/` during the Phase 1 security commit (a `TokenStore`
   reference survived in `fe/public/js/session.js` and `fe/src/js/app.js`
   after the rest of the codebase moved to cookie-based sessions - fixed
   in a follow-up commit, see `docs/analysis/security-analysis-plan.md`).
   - Add `fe/dist/` to `.gitignore` and stop committing it; generate it
     only via `npm run build` in CI/deploy.
   - Decide whether `fe/public/js/` should remain committed (it is a
     legitimate build input, unlike `dist/`) or whether the build process
     should read directly from `fe/src/js/` to eliminate the duplication
     entirely - this second option removes an entire class of "forgot to
     sync both copies" bugs.
