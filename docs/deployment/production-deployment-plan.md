# HRFlow Production Deployment Plan

Status: plan agreed, not yet implemented. Owner: Ahmed Ezzat.
Scope of this document: how to run HRFlow as a **production** environment (Docker, PostgreSQL) next to the existing **development** environment (local folder, SQLite), from one codebase.

## 1. Decisions

| Topic | Decision |
|---|---|
| Environments | **Dev**: local folder, SQLite, `be/.env`, Vite. **Prod**: Docker images, PostgreSQL, separate credentials. One codebase; differences are configuration only. |
| Production data | Start with an **empty** PostgreSQL. Schema from Alembic; RBAC, finance lookups and payroll tax defaults are seeded by the app. The SQLite migration script is not used. |
| Document storage | **Local volume** (`FILE_STORAGE_BACKEND=local`), included in backups. No Google Drive/Sheets in prod. |
| Google Sign-In | Same OAuth client as dev. Add `http://localhost` (port 80) to the client's Authorized JavaScript origins (and the HTTPS origin later). Keep `ALLOWED_WORKSPACE_DOMAIN` set. |
| Network | Local only for now, plain HTTP on **port 80**, accessed as `http://localhost`. HTTPS on 443 is optional later if verified to work. Cloudflare Tunnel is a later, additive step (Cloudflare provides the HTTPS). |
| First Super-Admin | `ahmed.ezzat@voyance.health` |
| Backups | Encrypted backups copied to a **Google Drive** folder (Drive for Desktop sync folder or rclone), plus a local copy. Drive is a backup target only; the application itself stays free of Drive/Sheets. |
| Layout | Deployment files in repo under `deploy/prod/`. Secrets, data and backups in `D:/services/hrflow-prod/` (never committed). |
| Legacy Sheets/Drive cleanup | **Deferred.** Out of scope for this plan; tracked separately. Prod simply does not configure those settings. |

## 2. Layout

In the repo (committed):

```
deploy/prod/
  Dockerfile.app          # multi-stage: build frontend, then slim Python runtime
  docker-compose.yml      # app + postgres + proxy (later: cloudflared)
  proxy/                  # reverse-proxy config (TLS, headers)
  .env.prod.example       # template, no real values
  scripts/                # backup, restore, upgrade, rollback
  RUNBOOK.md
```

On the host (not committed), `D:/services/hrflow-prod/`:

```
.env                # real secrets (SECRET_KEY, POSTGRES_PASSWORD, ...)
certs/              # local TLS certificate and key
data/postgres/      # database files
data/documents/     # uploaded files (LOCAL_STORAGE_PATH)
data/logs/          # application logs
backups/            # dumps + documents archives
```

Compose is run from the repo but reads env file and data paths from the host folder. The repo can be cleaned, switched or rebuilt without touching production data.

## 3. Architecture

- **proxy** (Caddy or nginx): only service publishing a host port. Listens on port 80 (plain HTTP on localhost; HTTPS optional later), serves the built single-file frontend, forwards `/api` to the app. One origin for UI and API, so cookies and CORS stay simple.
- **app**: FastAPI/uvicorn, non-root user, `ENVIRONMENT=production`. Not exposed to the host.
- **postgres**: Postgres 16, internal network only, never published. App connects as a restricted role.
- Internal Docker network; named restart policy, health checks, resource limits on every service.

## 4. Work items (implementation order)

### Phase A - Build and run
1. **Frontend prod build**: build with a prod `config.js` (same-origin API base URL, shared Google client ID). Disable `?mock=` mode in the prod bundle.
2. **Dockerfile.app**: multi-stage; pinned base images and dependencies; exclude test packages, tests, `.env`, `*.db`, `credentials.json`, `node_modules` (use `.dockerignore`); non-root user; health endpoint.
3. **Compose stack** with env file and data paths from `D:/services/hrflow-prod/`.
4. **Startup sequence**: run `alembic upgrade head` before the app starts; in production stop relying on `create_all` + ad-hoc `ALTER TABLE` in `init_db()` (Alembic is the only schema authority). Verify a clean Alembic run on an empty Postgres yields the full schema.
5. **Bootstrap first admin**: define how the first Super-Admin Google account is created on an empty database (env var or one-off command). Needs confirmation of the account.
6. **Plain HTTP on port 80 for localhost**: proxy listens on 80 only. Chromium browsers (Chrome, Edge) and Firefox accept `Secure` cookies on `http://localhost`, so the production cookie setting is left unweakened; always browse via `http://localhost` (not the PC name or LAN IP, where the cookie would be dropped). Safari does not support this. HSTS is ignored over HTTP, which is harmless. Optional later: add a local certificate (mkcert) and 443 once tested.

### Phase B - Security hardening
7. Disable `/docs`, `/redoc`, `/openapi.json` in production.
8. Trust proxy forwarded headers so the app sees HTTPS and the real client IP.
9. Rate limiting on login and sensitive endpoints (proxy or app level).
10. Review CSP and security headers for the proxied setup; keep HSTS only once HTTPS is stable.
11. Postgres roles: least-privilege app role; separate migration role; strong generated passwords.
12. Secrets only via the host `.env`; none baked into images; `.env` file permissions restricted to the owner account.
13. Scans in CI/manual: `pip-audit`, `npm audit`, image scan (Trivy). No `latest` tags.
14. Log hygiene: confirm no tokens, personal or financial data in logs; rotate logs on the volume.

### Phase C - Operations
15. **Backups**: nightly `pg_dump` plus documents archive to `backups/`, **encrypted before leaving the PC** (age or gpg; key stored separately, e.g. password manager, never only on this PC), then copied to a dedicated Google Drive folder (Drive for Desktop sync or rclone; use a restricted/dedicated folder, dated file names, retention of daily/weekly/monthly so deletions or corruption do not propagate unnoticed). Keep a short local copy too. **Test a restore from the Drive copy** before real data goes in.
16. **Upgrade and rollback scripts**: tag images by version/commit; backup, then migrate, then switch; keep previous image for rollback.
17. **Auto-start**: Docker Desktop (WSL2) starts at boot; PC power plan set not to sleep.
18. **Monitoring**: container health checks and a simple uptime check; alert path for failed backup.
19. **RUNBOOK.md**: first install, upgrade, rollback, restore, certificate renewal, rotating `SECRET_KEY` (invalidates sessions), adding the tunnel.

### Phase D - Verification (before using real data)
20. Fresh stack from scratch on empty folders: all containers healthy, migrations applied, seeds present.
21. Sign in with Google at `https://localhost`; verify session cookie is `Secure`, `HttpOnly`; session expiry flow works.
22. Permission checks: employee vs admin scopes via the real backend (mock mode cannot prove this).
23. Document upload/download through the local volume; confirm authorization is enforced and no storage paths leak.
24. Backup then wipe then restore drill; compare row counts and document files.
25. Run backend test suite and relevant UI specs against the built artifact.

### Phase E - Later, optional
- Cloudflare Tunnel (`cloudflared` container, named tunnel + Cloudflare Access in front); add the public hostname to the OAuth client; set `ALLOWED_ORIGINS`.
- Legacy Sheets/Drive code cleanup (separate task).
- Off-machine backup copy.

## 5. Risks and notes

- Same OAuth client for dev and prod: acceptable, but a client-ID mix-up between environments is possible; verify the environment banner/URL before acting on data.
- Single PC host: availability equals the PC's uptime; backups on a separate disk are the real safety net.
- Production forces `Secure` cookies. On `http://localhost` this works in Chrome, Edge and Firefox only; Safari and any non-localhost hostname over HTTP will lose the session. Must be verified in Phase D. When the tunnel is added, Cloudflare terminates HTTPS and the proxy keeps serving HTTP internally.
- `init_db()` currently seeds and alters schema at import time; moving schema ownership to Alembic is a behaviour change in a high-risk area (migrations) and needs its own tests.
- Empty Postgres means no historical data; existing dev data stays in SQLite and is not carried over.

- Backups contain HR and financial data: unencrypted copies in Drive are not acceptable. Losing the encryption key makes backups useless.
- Drive for Desktop on the same PC means a compromised PC can alter synced backups; the retention/versioning above mitigates this.

## 6. Open items

- Which Google account owns the backup Drive folder (personal vs company), and its folder name.
- Where the encryption key is kept.
