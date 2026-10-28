# HRFlow Production Runbook (local Docker deployment)

Host folder (never committed): `D:/services/hrflow-prod/` containing `.env`, `data/documents`, `data/logs`, `backups/`.
Database lives in the Docker named volume `hrflow-prod_pgdata` (use backups, not file copies).
The app container is read-only: uploaded files (Finance and HR) are stored under the unified files root `HRFLOW_FILES_ROOT` (`/data/documents` in the container, backed by `D:/services/hrflow-prod/data/documents` on the host). All stored references are relative to this root (e.g. `finance/2026/bills/...`, `hr/salary-payment-docs/...`).

## Where things live
Configuration is a single file, `D:/services/hrflow-prod/.env` (template: `.env.prod.example` in the repo root). `docker-compose.yml` passes every setting to the containers; only values that describe the container itself are fixed there. Apply a change with `$C up -d` (add `--build` after a code change).

| What | Host (disk) | Inside the container |
|---|---|---|
| Uploaded files (HR + Finance) | `${HRFLOW_DATA_DIR}/documents` | `/data/documents` (`HRFLOW_FILES_ROOT`, fixed) |
| Logs | `${HRFLOW_DATA_DIR}/logs` | `/data/logs` |
| Secret files (Google service account key `google-credentials.json`) | `${HRFLOW_DATA_DIR}/secrets` | `/run/secrets` (read-only) |
| Fonts for PDFs (the template uses Calibri, Cambria, Tahoma) | `${HRFLOW_DATA_DIR}/fonts` (copy `calibri*.ttf`, `cambria*.ttf`/`cambria.ttc`, `tahoma*.ttf` from `C:\Windows\Fonts`; licensed Microsoft fonts, never committed; without them the image falls back to look-alike open fonts) | `/usr/local/share/fonts/hrflow` (read-only) |
| Invoice template | in git: `docs/templates/` | baked into the image at `/app/templates/` (change it with a new release) |
| Database | Docker volume `hrflow-prod_pgdata` | PostgreSQL service |

`HRFLOW_FILES_ROOT` is a container path and is not set in the host `.env`; to move the files, change `HRFLOW_DATA_DIR` (and move the folders first). Inside `documents/`: `employees/`, `Company Documents/`, `finance_bills/`, `finance_attachments/`, `_meta/`. The database stores paths relative to this root, so never rename or move files inside it.

All commands run from the repo root of a checkout of `main`. (The automatic deploy builds from the runner's own checkout of the release tag, `D:/services/actions-runner/_work/hrflow/hrflow`; nothing in the stack depends on any other folder or branch.)

```bash
C="docker compose --env-file D:/services/hrflow-prod/.env -f deploy/prod/docker-compose.yml"
```

## First install
1. Copy `.env.prod.example` (repo root) to `D:/services/hrflow-prod/.env`; create `D:/services/hrflow-prod/data/secrets/` (put `google-credentials.json` there if Drive or Sheets export is used); fill `SECRET_KEY`, both Postgres passwords (letters/digits only), `GOOGLE_OAUTH_CLIENT_ID`, `BACKUP_PASSPHRASE`. Save `BACKUP_PASSPHRASE` in a password manager.
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
- `powershell deploy/prod/scripts/backup-files-clone.ps1` - unencrypted additive one-way clone of the unified files root to `FILES_CLONE_DIR` (Google Drive for Desktop synced folder). Never deletes files from the clone even if removed from the app. Schedule hourly or nightly.
- `powershell deploy/prod/scripts/restore.ps1 -File <backup.enc>` - destructive; replaces DB and documents.
- Restore drill verified on 2026-10-16 (data deleted, restored, health OK). Repeat after any change to the scripts.
- Losing `BACKUP_PASSPHRASE` makes all backups unreadable.

## Operations
- Logs: `D:/services/hrflow-prod/data/logs/hrflow.log`, `$C logs -f app`.
- Rotate `SECRET_KEY`: edit `.env`, `$C up -d` (all users must sign in again).
- Stop: `$C down` (data is kept). **Never** run `down -v` in production: it deletes the database volume.
- Windows: set Docker Desktop to start at sign-in and keep the PC from sleeping.

## Moving the files root
All stored file references in HRFlow are root-relative POSIX paths. Moving the files root to another drive or volume requires zero database updates:
1. Stop the application stack:
   ```bash
   $C down
   ```
2. Copy files recursively to the new host folder:
   ```powershell
   robocopy D:\services\hrflow-prod\data\documents E:\hrflow-files /E /COPY:DAT
   ```
3. Update `HRFLOW_DATA_DIR` in `D:/services/hrflow-prod/.env` (or override `HRFLOW_FILES_ROOT`).
4. Restart the stack:
   ```bash
   $C up -d
   ```
5. Check health: browse to `http://localhost/api/health` and verify document downloads.

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

### The deploy runner
The runner (`D:/services/actions-runner`, name `hrflow-prod-pc`, label `hrflow-prod`) is the only thing that deploys; test workflows run on GitHub's own machines.

- **Preferred: a Windows service that starts at boot.** Run `deploy/prod/scripts/install-runner-service.ps1` once, from an elevated PowerShell, started as `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\prod\scripts\install-runner-service.ps1 -Token <token>` (Windows blocks scripts by default; this bypasses that for the one run only; try `-DryRun` first). The runner then starts when Windows boots, has no window, survives sign-out and is restarted by Windows if it crashes. It runs as your Windows account so it can reach Docker.
- **Docker Desktop still has to be running.** It only runs inside a signed-in session, so keep it set to start at sign-in. A deploy that arrives while Docker is not running stops at the backup step (nothing is changed); start Docker Desktop and run **Deploy production** again.
- **Before the service is installed** the runner starts at Windows sign-in through a per-user startup entry (HKCU Run, "HRFlowGitHubRunner"), so the PC must be signed in. If it is offline, a queued deploy waits (GitHub gives up after about 24 hours); start `D:/services/actions-runner/run.cmd`, and if the job still does not start, run **Deploy production** again with the same tag.
- **Check it:** GitHub > Settings > Actions > Runners should show `hrflow-prod-pc` as Idle.
- **PowerShell policy:** the deploy workflow starts its script with `-ExecutionPolicy Bypass` for that one process, so it works even when Windows blocks scripts by default.
