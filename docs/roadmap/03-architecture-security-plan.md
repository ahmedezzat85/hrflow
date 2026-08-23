# 03 — Architecture & Security Plan

**Scope:** Cloud Solutions Architect-level review of backend architecture, deployment posture, and security. Written as a remediation backlog to layer on top of the security work already completed in PR #5 ("Phases 1-5").
**Note on the database:** the data-layer (Google Sheets/Drive as system of record) is the single biggest architectural item and has its own standalone document — see `05-database-redesign.md`. This document covers everything else.

## 1. Current state summary

- **Backend**: FastAPI, recently and properly decomposed. `main.py` shrank from ~800+ lines to a slim entrypoint; `be/deps.py` holds shared dependencies; nine domain routers exist (`employees`, `auth`, `bank`, `documents`, `insurance`, `invoices`, `requests`, `salary`, `system`, `vacations`). This was a real, well-executed refactor (PR #6), not just a file move.
- **Frontend**: Vite-built vanilla JS/HTML/CSS, served as static files.
- **Data layer**: Google Sheets (`be/sheets_client.py`) + Google Drive (`be/drive_client.py`) as the primary store — covered in depth in `05-database-redesign.md`.
- **Security**: A genuinely mature 5-phase remediation already shipped (PR #5):
  - Phase 1: required `SECRET_KEY`, HttpOnly cookie sessions, removed token-in-URL, sanitized download filenames.
  - Phase 3: security headers middleware (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, conditional HSTS).
  - Phase 4: upload validation via magic bytes (not just file extension); rate limiting explicitly deferred to deployment phase — **this is the open item, see section 3**.
  - Phase 5: audit logging with test coverage.
  - Authorization scope centralization across history/requests/insurance/claims endpoints (PR #6), reducing risk of cross-employee data leaks.
- **Testing**: A real `pytest` suite exists (`test_authorization.py`, `test_audit_log.py`, `test_employee_scope.py`, `test_config_validation.py`, `test_salary_logic.py`, `test_sheets_caching.py`, `test_invoices.py`, `test_employee_salary_split.py`) — but is not enforced in CI.
- **CI/CD**: only `.github/workflows/frontend-build-check.yml` exists. No backend test run, no lint, no deploy pipeline.
- **Containerization**: no Dockerfile found in the repo tree reviewed.

## 2. Risk register

| Risk | Severity | Evidence | Notes |
|---|---|---|---|
| Backend tests not run in CI | High | Only frontend workflow exists | A regression in authorization scoping (the exact class of bug PR #6 fixed) could merge silently. This is the highest-leverage, lowest-cost fix available. |
| No rate limiting | Medium-High | Explicitly deferred in Phase 4 commit message | Was correctly deferred, but is now overdue — needed before any internet-facing deployment (see `04-deployment-plan.md`). |
| No containerization | Medium | No Dockerfile in tree | Blocks reproducible deploys and both deployment options in `04-deployment-plan.md`. |
| Single external dependency (Google Workspace) | Medium | Sheets/Drive/Sign-In all Google | A Google-side outage or API change takes down the entire system at once, with no degraded mode. Accepted risk if you stay on Sheets; revisit if `05-database-redesign.md` is implemented. |
| Secrets handling for service-account credentials | Medium (unconfirmed) | `config.py` grew significantly in Phase 1 to require `SECRET_KEY` | Needs explicit confirmation that the Google service-account JSON key is stored via a secrets manager / env injection, not committed or shipped in the image. |
| No environment separation (dev/staging/prod) | Low-Medium | Not evidenced in repo structure | Matters once you have a real deployment (see `04-deployment-plan.md`) — you'll want distinct service-account credentials per environment so a bug in dev can't touch prod Sheets data. |

## 3. Remediation backlog

### High priority

1. **Add a backend CI workflow.**
   - Run `pytest` (the existing suite) on every PR, mirroring the existing `frontend-build-check.yml` pattern.
   - Add basic linting (e.g. `ruff` or `flake8`) while you're in there — cheap to add now, expensive to retrofit after the codebase grows further.

2. **Implement rate limiting.**
   - Explicitly flagged as deferred in the Phase 4 security commit — this is a known, self-identified gap, not a new finding.
   - Suggested approach: `slowapi` at the FastAPI level for auth/upload endpoints specifically, or push it to the reverse proxy layer if you go with the Nginx/Caddy setup in `04-deployment-plan.md`. Either is acceptable; pick based on which you're deploying first.

3. **Add a Dockerfile (multi-stage build).**
   - Stage 1: install Python deps from `be/requirements.txt`.
   - Stage 2: copy `be/` source, run via `uvicorn`/`gunicorn`.
   - This directly unblocks both deployment options in `04-deployment-plan.md` and makes local dev/prod parity possible.

### Medium priority

4. **Confirm and document secrets handling.**
   - Verify the Google service-account key for Sheets/Drive access is never checked into the repo.
   - Move it to Google Secret Manager (Option A in `04-deployment-plan.md`) or a local `.env`-injected file excluded via `.gitignore` (Option B) — document whichever is chosen in `be/SETUP_GUIDE.md`.

5. **Environment separation.**
   - Distinct service-account credentials and `SECRET_KEY` per environment (dev/staging/prod) once a real deployment exists.

### Lower priority / longer horizon

6. **Reduce single-point-of-dependency risk on Google Workspace.**
   - Not urgent while Sheets remains the data store (accepted tradeoff), but track this as a benefit of the database redesign in `05-database-redesign.md` if/when that work happens — a real DB removes the read-quota ceiling and reduces (though doesn't eliminate, since auth still uses Google Sign-In) this dependency.

## 4. How to use this doc

Treat items 1-3 as a near-term hardening sprint that should land *before* any new feature work from `01-feature-gap-plan.md`, since they reduce risk for everything built afterward. Items 4-6 can be folded into the deployment work (`04-deployment-plan.md`) when that's tackled.
