# HRFlow Production Runbook (local Docker deployment)

Host folder (never committed): `D:/services/hrflow-prod/` containing `.env`, `data/documents`, `data/logs`, `backups/`.
Database lives in the Docker named volume `hrflow-prod_pgdata` (use backups, not file copies).
The app container is read-only: uploaded Finance files (bill PDFs, cheque and invoice scans, statements, subscription proofs) are written under `data/documents/finance_bills` and `data/documents/finance_attachments` (set by `BILL_UPLOADS_DIR` / `FINANCE_UPLOADS_DIR` in `docker-compose.yml`). They are inside `data/documents`, so the encrypted backup already includes them.

All commands run from the repo root of a checkout of `main`. (The automatic deploy builds from the runner's own checkout of the release tag, `D:/services/actions-runner/_work/hrflow/hrflow`; nothing in the stack depends on any other folder or branch.)

```bash
C="docker compose --env-file D:/services/hrflow-prod/.env -f deploy/prod/docker-compose.yml"
```

## First install
1. Copy `deploy/prod/prod.env.example` to `D:/services/hrflow-prod/.env`; fill `SECRET_KEY`, both Postgres passwords (letters/digits only), `GOOGLE_OAUTH_CLIENT_ID`, `BACKUP_PASSPHRASE`. Save `BACKUP_PASSPHRASE` in a password manager.
2. In Google Cloud Console add `http://localhost` to the OAuth client's Authorized JavaScript origins.
3. `$C up -d --build` (migrations run automatically at app start).
4. Create the first admin: `docker exec hrflow-prod-app-1 python scripts/bootstrap_admin.py --email you@voyance.health`.
5. Browse to `http://localhost` (always `localhost`; the secure session cookie is not accepted on other hostnames over HTTP, and Safari does not accept it at all).

## Upgrade
1. Run `deploy/prod/scripts/backup.ps1`.
2. `git pull` / checkout the release, set `HRFLOW_VERSION` in `.env` (e.g. the commit hash), `$C up -d --build`.
3. Check `$C ps` (all healthy) and `http://localhost/api/health`.
Rollback: set `HRFLOW_VERSION` to the previous tag and `$C up -d`; if a migration changed the schema, restore the pre-upgrade backup.

## Backup / restore
- `powershell deploy/prod/scripts/backup.ps1` - encrypted (AES-256, PBKDF2) dump + documents to `BACKUP_LOCAL_DIR` and, if set, `BACKUP_DRIVE_DIR` (point it at a Google Drive for Desktop folder). Schedule it nightly with Windows Task Scheduler.
- `powershell deploy/prod/scripts/restore.ps1 -File <backup.enc>` - destructive; replaces DB and documents.
- Restore drill verified on 2026-10-16 (data deleted, restored, health OK). Repeat after any change to the scripts.
- Losing `BACKUP_PASSPHRASE` makes all backups unreadable.

## Operations
- Logs: `D:/services/hrflow-prod/data/logs/hrflow.log`, `$C logs -f app`.
- Rotate `SECRET_KEY`: edit `.env`, `$C up -d` (all users must sign in again).
- Stop: `$C down` (data is kept). **Never** run `down -v` in production: it deletes the database volume.
- Windows: set Docker Desktop to start at sign-in and keep the PC from sleeping.

## Adding the Cloudflare Tunnel later
Run `cloudflared` pointing at `http://web:80` on the `internal` network, add the public https hostname to the OAuth client origins and to `ALLOWED_ORIGINS`. Cloudflare terminates HTTPS; nginx honours `X-Forwarded-Proto`.


## Releases and automatic deploy
Production updates itself from release tags. A pull request into `main` (checks must pass) is the only way code reaches `main`; a release is a tag on a `main` commit.

1. Merge your PR into `main` and wait for the checks on `main` to turn green.
2. Create the release on the latest `main`: `git fetch && git tag v1.2.0 origin/main` and `git push origin v1.2.0` (or create a release on GitHub targeting `main`). A new release tag must point at the current tip of `main`; the images are always built from that commit.
3. The workflow **Deploy production** runs: it refuses a tag that is not on `main` or whose required checks are not green, then the self-hosted runner on this PC runs `deploy/prod/scripts/deploy.ps1`: encrypted backup, build the new images (the old version keeps running), start the new version (database migrations run on start), wait for `http://localhost/api/health`. If it never becomes healthy, it switches back to the previous version and the workflow fails.
4. On success `HRFLOW_VERSION` in `D:/services/hrflow-prod/.env` is set to the deployed tag.

### One-click release
After the PR is merged and you want it in production, run the **Release** workflow instead of tagging by hand:

```bash
gh workflow run release.yml -f bump=patch      # patch: fixes, minor: new features, major: breaking changes
gh workflow run release.yml -f bump=patch -f dry_run=true   # only show the version it would create
gh run watch                                    # follow it; then Actions > Deploy production for the deploy itself
```
Or GitHub > Actions > Release > Run workflow (pick the bump, tick `dry_run` to preview). It waits for the three required checks on the latest `main`, creates the next `vX.Y.Z` tag on exactly that commit, and starts **Deploy production** for the tag. Everything after that is the deploy described above. It refuses to run if `main` is already tagged, a required check failed, or `main` moved while it waited. It must be started from the `main` branch (a dry run may start anywhere). Rolling back is unchanged (run **Deploy production** with an older tag).

### Database migrations in a release
Migrations ship inside the release: the Alembic files in `be/migrations/versions/` are part of the tagged commit, and the app container runs `alembic upgrade head` every time it starts (`deploy/prod/scripts/entrypoint.sh`). So a release that contains a new migration applies it automatically during the deploy, after the pre-deploy backup and before the health check; a release without one changes nothing in the database. You do not run anything by hand.

Rules for a change that needs a migration:
- Add the Alembic file in the same PR as the code that needs it, with a `down_revision` that is the current head (`alembic heads` must show exactly one head), a working `downgrade`, and a test that upgrades and downgrades it.
- Make it backward compatible with the previous release where possible (add nullable columns or tables first; drop or rename in a later release). If the new version fails its health check, the deploy switches back to the previous version, but the migration has already run, so the old code must still work against the new schema.
- If a migration itself is the problem, restore the backup taken at the start of that deploy with `scripts/restore.ps1`.

Roll back to an older release: GitHub > Actions > Deploy production > Run workflow > enter the old tag (e.g. `v1.1.0`). If a bad migration already ran, restore the backup taken at the start of that deploy with `scripts/restore.ps1`.

The runner (`D:/services/actions-runner`) starts at Windows sign-in through a per-user startup entry (HKCU Run, "HRFlowGitHubRunner"), so this PC must be signed in with Docker Desktop running. Only the deploy workflow targets it (label `hrflow-prod`); test workflows run on GitHub's own machines.
