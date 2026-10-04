# HRFlow pre-launch review

**Date:** 2026-10-04 · **Reviewer:** Claude (three passes, read-only) · **Output of:** full review before PROD/DEV deployment

---

## 1. Branch intake

| Item | Value |
| :--- | :--- |
| Branch | `feature/rbac` (the brief said `[branch name]`; this is the checked-out branch and the owner confirmed the folder is at its latest commit) |
| HEAD | `98d40dd3768bd99a7f3ed6b34a16f0011ceab244` (RBAC-F7, 2026-10-03), equal to `origin/feature/rbac` |
| Merge-base with `main` | `c236b00cb6fea09cb3474cb8d5fbda66eb23135e`; branch is 21 commits ahead, 0 behind |
| Working tree | 516 files show as modified but the diff is empty once line endings are ignored, so the tree equals HEAD. One untracked file: `be/hrflow.db.bak-before-0027` |
| Size | 544 tracked files; about 64k lines Python, 49k JS, 12.5k HTML, 7.3k CSS |
| Docs read in full | `docs/project-context/00`, `01`, `02`, `04`, `05`, `06`; `docs/finance-module/00-architecture-blueprint.md` |
| Docs skimmed or not read | `docs/finance-module/01`–`17` (not read line by line; used only where a finding touched them); `docs/project-context/rbac/*` (not read); `docs/payroll/*` (not read); `docs/roadmap/*` ignored as instructed |

**Could not access or did not do**

- **Nothing was executed.** No pytest, Playwright, build, Alembic or app run. The linked machine's shell has no project dependencies and running tests would have written files into the repo. Every finding is from reading code.
- **No PostgreSQL run.** All PostgreSQL statements are from reading migrations.
- **UI was judged from source plus 8 existing payroll screenshots** (`fe/test-results/payroll-visual-checkpoints`, mock mode, possibly stale). No live browser.
- **Secrets and databases were not opened** (`be/.env` key names only; `credentials.json`, `*.db` untouched).
- **Two history blobs not opened:** `scripts/migrations/data/cashbook_2026_*.csv` at commits `01b9616` and `e017489` (see ARC-12).
- Finance reconciliation, cheque, transfer and report modals were reviewed for labels and structure only, not behaviour.

**Side effect of this review:** my first `git status` left an empty `.git/index.lock`. I could not delete it, so it was renamed to `.git/index.lock.stale-claude`. It is safe to delete.

**How to read the tables**

- **Sev:** Critical / High / Medium / Low, proportionate to a small internal tool that holds payroll, bank and personal data.
- **Eff:** S (under a day), M (1–3 days), L (more).
- **Status** is the state of the affected capability: *implemented* (shipped code with the defect), *partial*, *planned*, *open* (tied to an open question), *unknown*.
- **Conf:** **V2** = the cited lines were re-read by a second pass; **V1** = read once by one pass; **U** = unverified, needs a running app or database.

---

## 2. Top 10 to fix before PROD launch

| # | What | Why it is first | Findings |
| :-- | :--- | :--- | :--- |
| 1 | **Lock down bill update.** `PUT /api/finance/bills/{id}` accepts `attachment_url`, `approval_status`, `approved_by`, `created_by`, `amount_paid`. | A `finance.bill.write` user can point the attachment at any server file and download or delete it (`.env`, the SQLite DB), and can self-approve bills. Reading `SECRET_KEY` allows forging any session. | SEC-01 |
| 2 | **Close the stored-XSS chain.** About 220 places put server strings into `innerHTML` unescaped; uploads keep a client-chosen MIME type and are served inline. | Any employee can run script in an HR or Finance admin's session (request details, document names, claim fields, toasts). | SEC-02, SEC-03, FE-03 |
| 3 | **Stop account takeover through employee email edit.** | An HR-Admin can change a Super-Admin's employee email to a Google account they control and sign in as Super-Admin. | SEC-04 |
| 4 | **Make deployment safe by default.** Fail-open `ENVIRONMENT`, an `.env.example` that cannot start, `create_all` at startup racing Alembic, a SQLite→PostgreSQL script that copies 13 of 50 tables, uploads stored inside the code folder, no backup procedure. | This is the remaining work the owner named, and each item can lose data or weaken security on first PROD bring-up. | ARC-01 – ARC-08 |
| 5 | **Remove mock mode from the production bundle.** | Opening PROD with `?mock=1` shows believable fake finance data and silently discards every finance save. About 5,900 mock lines ship. | FE-01 |
| 6 | **Fix payroll amounts.** Mid-month compensation change pays both the old and new rows in full; bonuses are double-counted in the CSV; previews live in process memory. | Wrong pay and wrong export are the core risk of a payroll tool. | FIN-01, FIN-02, FIN-08, FIN-09 |
| 7 | **Fix payroll controls.** A draft can be approved directly, skipping maker-checker; the pay endpoint has a test hook that fabricates gateway failures; the run has no cancel or reject path; the UI disburses in one click and never exposes the export. | Decisions D-007 and D-011 are not met in practice. | FIN-03, FIN-04, FIN-05, FIN-10, UX-06, UX-07 |
| 8 | **Fix ledger integrity.** Payroll journal bypasses the ledger; cheque marks a bill paid with no payment; subscription charge creates a payable bill and a paid entry; statement line can be resolved twice; balance ignores currency; closed periods are only locked on two paths. | Bank balances and reports will be wrong after ordinary use. | FIN-06, FIN-07, FIN-11 – FIN-15 |
| 9 | **Stop leaking salary and bank data.** Employees export returns full IBANs and salaries to `hr.employee.read`; employee list returns salaries; balances report returns full company account numbers; salary PDFs are served `Cache-Control: public`. | Bypasses the reveal permissions the RBAC work just built. | SEC-05 – SEC-08 |
| 10 | **Make CI and the UI tell the truth.** CI does not run on `main` or this branch and sets the wrong secret name; all 64 Playwright specs run in mock mode only; the employee portal shows hard-coded pay and insurance values; the UI says "Funds released" and "reminder dispatched" when nothing was sent. | Regressions go unseen, and users are shown false information. | ARC-09, ARC-10, UX-08, FIN-16 |

---

## 3. Findings

### 3.1 Pass 1 — Architecture: keep or change

| Area | Verdict | Why |
| :--- | :--- | :--- |
| Modular monolith, one deployable | **Keep** | Right size for the team. No finding argues for a split. |
| Core / HR / Finance folder boundaries | **Keep, tighten** | Tables and routers are cleanly separated. Finance reads HR ORM models directly in six places and writes `EmployeeDB` in one (ARC-13). Add a small HR read interface; move the one write. |
| RBAC (catalog, one role, per-request resolution, route coverage test) | **Keep** | The strongest part of the codebase. Rules for locked role, `system.*` keys, self-protection and scope all check out. Gaps are in what the guarded handlers then return (SEC-05 – SEC-07), not in the guard model. |
| Data model | **Change (planned, L)** | All money is `Float` (93 columns, 0 `Numeric`), dates are strings, datetimes are naive. Not a launch blocker at this scale; schedule it (ARC-14, ARC-15). |
| Migrations | **Change (before PROD)** | Startup `create_all` plus `ALTER TABLE` competes with Alembic; migration `0013` builds schema from live models; nothing verified on PostgreSQL (ARC-02, ARC-03). |
| Error handling | **Change (incremental)** | 39 broad `except Exception` in finance, audit failures swallowed, exception text returned to clients (ARC-16, SEC-14). |
| Testability | **Keep backend, change frontend** | 67 backend test modules with real DB fixtures. Frontend tests never touch a real backend (ARC-10). |
| Config and secrets | **Change (before PROD)** | No secrets in git. Defaults fail open and examples are stale (ARC-01, ARC-04). |
| Deployability for separate PROD and DEV | **Change (before PROD)** | No Dockerfile, process config, proxy config, release procedure or backup runbook exists (ARC-05 – ARC-08). |
| Synchronous long tasks, no background jobs | **Keep for now** | Known and acceptable at this size. Move PDF parsing off the event loop (FIN-19). |

| ID | Sev | Eff | Location | Status | Issue and impact | Fix | Verify | Conf |
| :-- | :-- | :-- | :--- | :--- | :--- | :--- | :--- | :-- |
| ARC-01 | High | S | `be/config.py:13-14,45,60`; `be/main.py:83-90,122` | implemented | `ENVIRONMENT` defaults to `development`; any value other than exactly `production` turns off the cookie `Secure` flag and HSTS and allows `ALLOWED_ORIGINS=*` with credentials. A DEV host with real data gets all three. Origins are split without trimming spaces. `/docs` and `/openapi.json` are exposed everywhere. | Require `ENVIRONMENT` from an explicit set (`local`, `dev`, `prod`) and fail otherwise; secure by default, relaxed only for `local`; strip origins; disable docs outside `local`. | Start with `ENVIRONMENT=prod`; inspect `Set-Cookie`. | V2 |
| ARC-02 | High | M | `be/db.py:81-93`; `be/main.py:97-99`; `be/migrations/versions/0001_initial_schema.py:23` | implemented | Known: `init_db()` runs `create_all` and `ALTER TABLE ADD COLUMN` on every start. **Worse than recorded:** on a fresh database, starting the app before `alembic upgrade head` creates all tables with no `alembic_version`; `0001` is unguarded so the later upgrade fails. On an existing DB, new code started before migrating adds columns without constraints, which guarded migrations then skip. Nothing stamps or checks the head. | Restrict `create_all` and column sync to SQLite/local; in other environments refuse to start unless `alembic_version` is at head. | Empty PostgreSQL: start app, then `alembic upgrade head`. | V2 (failure not executed) |
| ARC-03 | Medium | M | `be/migrations/versions/0013_finance_ux_schema_sync.py:40-78`; `0014:54`; `0016:55-62` | implemented | `0013` calls `Base.metadata.create_all` from live models, so history is not reproducible and later conditional migrations are skipped on a fresh DB; its `bool` branch is dead (`int` check runs first); downgrade is `pass`. `0014` inserts integer `1` into a Boolean (a PostgreSQL break beyond the known `0005/0018/0021`). `0016` commits inside the migration and swallows errors. Some indexes and one FK declared in models are missing from migrations. | Freeze `0013` to explicit DDL; fix literals; add a CI job that runs `upgrade head` on PostgreSQL and asserts an empty autogenerate diff. | PostgreSQL CI job. | V2 for `0013`; V1 for the rest; PostgreSQL behaviour U |
| ARC-04 | High | S | `be/.env.example:32-36`; root `.env.example`; `be/finance/services/payroll_service.py:1497` | implemented | The example sets `STORAGE_ENGINE=sheets`, which `config.py:180` rejects, so a copied template cannot start. `ALLOWED_WORKSPACE_DOMAIN` is documented but unused since D-013. `ENFORCE_MAKER_CHECKER` is read straight from the environment, is undocumented, and `false` disables the self-approval block. Two near-duplicate example files. | One example per environment; delete dead variables; move the maker-checker flag into `Config` and reject `false` in production. | Copy example to `.env`, start. | V2 |
| ARC-05 | High | M | `be/finance/services/bills_service.py:53-55`; `statements_service.py:41`; `subscriptions_service.py:21`; `be/config.py:143-146` | implemented (Q-003 open) | Bill PDFs, statement files and subscription attachments are written to `be/uploads/...` derived from `__file__`. They ignore `FILE_STORAGE_BACKEND`, cannot be separated per environment, are lost on a fresh checkout or container redeploy, and are in no backup. `LOCAL_STORAGE_PATH` also defaults inside the code folder. | One configurable data directory (absolute path required outside `local`) used by every upload path. This is needed whatever Q-003 decides. | Upload a bill PDF; find the file. | V2 |
| ARC-06 | High | M | `be/scripts/migrate_sqlite_to_postgres.py:39-53,103` | implemented | The script copies 13 HR tables; the models define 50. Finance, payroll, RBAC, compensation plans and tax settings are not copied; it builds the target with `create_all`; it prints success regardless. A PROD cut-over with it loses finance data and every role assignment. | Iterate all tables in dependency order against a schema built by Alembic; compare row counts; fail loudly. | Dry run on a copy; compare counts. | V2 |
| ARC-07 | Medium (High with more than one worker) | M | `be/finance/services/idempotency.py:17-21`; `payroll_service.py:38,688,1124` | implemented | Idempotency keys and payroll previews are held in process memory. They are lost on restart and wrong with two workers; the preview cache is never evicted. Idempotency ignores the request body and is not applied to payroll create/pay/journal, statutory settle or statement resolve. | Persist both in tables, or document and enforce a single worker for launch. | Run two workers; create a preview; fetch it repeatedly. | V2 |
| ARC-08 | High | M | repo-wide | planned | Missing for independent PROD and DEV: backend packaging (no Dockerfile, service unit or process config); reverse proxy and TLS config; static hosting for `fe/dist`; a release procedure (migrate, then start); a backup and restore runbook for the database and files; a rule for refreshing DEV from PROD with salaries, IBANs and emails scrubbed; first Super-Admin provisioning on an empty PROD database (unknown how this is done); a dependency lock file and pinned Python version. `docker-compose.db.yml` uses a fixed container name and volume, so two stacks collide on one host. | Deliver as the Phase 1 slices in section 7. | Stand up DEV from scratch using only the runbook. | V1 |
| ARC-09 | High | S | `.github/workflows/finance-ux-ci.yml:5,35,54`; `frontend-build-check.yml:5` | implemented | Push triggers name only `refactor/finance-ux` and `refactor/frontend-modular`, so CI does not run on pushes to `main` or `feature/rbac`. The backend job sets `JWT_SECRET` but the code reads `SECRET_KEY`, so `import main` should fail before tests run. | Trigger on `main` and all pull requests; set `SECRET_KEY`. | Open the Actions history. | V2 for the file; job result U |
| ARC-10 | High | M | `fe/tests/ui/*.spec.js`; `fe/playwright.config.js:18`; `be/tests/conftest.py:232` | implemented | All 64 Playwright specs navigate to `?mock=...` and run against `vite dev`; none exercises the real API client, login, a 403 or the built `dist`. Backend tests build the schema with `create_all`, so migrations are exercised only by one SQLite test. Local artefacts show 17 failing UI tests on 2026-10-03 (stale, unverified). | One small end-to-end suite against FastAPI + seeded SQLite; smoke test against `dist`. | Run it. | V1; failing-test list U |
| ARC-11 | Medium | S | `.gitignore:166,178,255`; repo root and `be/` | implemented | `be/hrflow.db.bak-before-0027` matches no ignore rule, so `git add -A` would commit a database of payroll and personal data. A PROD database copy (`hrflow_Prod.db`), a dev DB, a service-account key and `.env` all sit in one working folder. | Add `*.db.*` and `*.bak*`; keep PROD copies and keys outside the repo folder. | `git check-ignore -v be/hrflow.db.bak-before-0027` | V2 |
| ARC-12 | Medium | M | git history: `scripts/migrations/data/cashbook_2026_*.csv` (commits `01b9616`, `e017489`, removed in `3d9faaa`) | unknown | Cash-book CSVs were committed and later removed; `01b9616` adds 35 lines of data. If these are real transactions they remain in history on the remote. | Inspect the two blobs; if real, rewrite history before adding collaborators. | `git show 01b9616 -- scripts/migrations/data` | U (content not opened) |
| ARC-13 | Medium | M | `be/finance/services/compensation_plan_service.py:171-179`; `payroll_service.py:18,316-318,359`; `ledger_service.py:136`; `reports_service.py:30` | implemented (Q-008 open) | Finance writes `EmployeeDB.internal_salary_usd`, `external_salary_usd` and `salary` with no salary-history row, and reads HR ORM models directly in six places. The blueprint (§1.2, §8) forbids both. The reverse also exists: `repositories/sql/employees.py:189-192` calls the Finance compensation service from HR. | A small HR read interface for Finance; move the write behind an HR service that also records history. | Grep `models_db` imports under `be/finance`. | V2 |
| ARC-14 | Medium | L | `be/finance/models.py`, `be/models_db.py` (93 `Column(Float`) | implemented | All money is binary float; rounding is 2 dp in settlement, 4 dp in balances, whole dollars for internal pay; tolerances vary. | `Numeric(18,2)` with `Decimal` and one rounding helper, by migration. Not a launch blocker; schedule it. | Sum many small amounts; compare. | V2 (count) |
| ARC-15 | Low–Medium | L | 139 `utcnow()` calls; about 49 date-like `String` columns | implemented | Naive UTC datetimes and string dates compared as text. "Today" and period edges differ between a Cairo laptop and a UTC server; `2026-9-5` sorts wrongly. | Validate date format at the schema edge now; migrate types later. | Post a date as `2026-9-5`. | V1 |
| ARC-16 | Low–Medium | M | `be/repositories/sql/audit.py:61-65`; `payroll_service.py:711-723`; 39 `except Exception` in `be/finance` | implemented | Audit rows are written in a separate session after commit and failures are swallowed, so a change can commit with no audit row. Placeholder identities such as `admin@hrflow.test` are written when email is missing. | Write audit in the same transaction for sensitive actions; fail the request if it cannot be written. | Force an audit failure in a test. | V1 |
| ARC-17 | Low | S | `be/routers/system.py:25-27`; `be/main.py:132-133`; `be/requirements.txt` | implemented | Health check does not touch the database. A client-supplied `X-Correlation-ID` is logged and echoed without limits. Requirements mix exact pins from mid-2024 with open ranges and include test dependencies; no lock file. No rate limiting anywhere. SQLite has no `foreign_keys=ON`, so FK rules are not enforced in dev. | Readiness endpoint with `SELECT 1` and migration head; bound the header; lock file; SQLite PRAGMA. | — | V1 |
| ARC-18 | Low | M | `be/finance/services/payroll_service.py` (2,060 lines); `reports_service.py` (2,604); `routers/activity.py` (865) | implemented | Large modules mixing settings, preview, lifecycle, export and journal; payment posting is written three times (`bills_repository.py:477-509`, `invoices_repository.py:296-321`, `settlement_service.py:226-255`). | Split when touching them for FIN fixes; one posting routine. | — | V1 |

### 3.2 Pass 1 — Security

OWASP references: ASVS v4 chapter, Top 10 2021 category.

| ID | Sev | Eff | Location | Status | Issue and impact | Fix | Verify | Conf |
| :-- | :-- | :-- | :--- | :--- | :--- | :--- | :--- | :-- |
| SEC-01 | **Critical** | S | `be/finance/schemas.py:651-680`; `be/finance/repositories/bills_repository.py:373-400`; `be/finance/services/bills_service.py:433-441,563-574,585-591`; `be/finance/routers/bills.py:256-270` | implemented | Mass assignment on bill update (ASVS V5.1, A01/A04). `attachment_url` is client-settable and, when absolute, is passed to `FileResponse` and to `os.remove`, giving arbitrary file read and delete. The same request can set `approval_status`, `approved_by`, `created_by`, `requires_approval`, `amount_paid`. | Whitelist editable fields in `BillUpdate`/`BillCreate`; store only a generated file name and resolve it under the uploads directory with a real-path prefix check. | `PUT /api/finance/bills/1 {"attachment_url":"/etc/hostname"}` then `GET .../attachment`. | V2 |
| SEC-02 | High | M | `fe/public/js/requests.js:68`; `employees.js:11,240,372`; `insurance.js:90-91`; `ui.js:34,271`; `dochub.js:101,117`; `invoices.js:222,562`; `finance-bills.js:1034,1588-1593`; `finance-accounts.js:724-725`; `finance-core.js:567`; about 220 lines in total | implemented | Stored XSS (ASVS V5.3, A03). 409 `innerHTML` writes; 16 of 24 files never escape. Employee-written text (request details, document names, claim fields, notes) is rendered raw in admin pages. `toast()` puts API error text into HTML. Five separate escape helpers exist; none is safe inside inline `onclick` strings. The session cookie is HttpOnly, but injected script can call every API as the viewing admin. | One shared escape helper; `textContent` for toasts and empty states; replace string `onclick` arguments with `data-*` attributes and delegated listeners. | Submit a request whose details are `<img src=x onerror=alert(1)>`; open admin Requests. | V2 for 4 sinks; V1 for the count; backend sanitisation U |
| SEC-03 | High | S | `be/routers/employees.py:205-215,263-267`; `be/drive_client.py:207-215,480`; `be/storage.py:247`; `be/services/uploads.py:21-38`; `be/main.py:106` | implemented | Upload validation checks only leading magic bytes; the MIME type stored and served is the one in the client's data URL (Drive) or guessed from the file name (local). Streams default to `inline`. A file beginning `%PDF-` with type `text/html` is served as HTML; the CSP allows inline script. (ASVS V12.) | Derive MIME from the detected signature; serve only PDF and images inline, otherwise `attachment`; add `Content-Security-Policy: sandbox` to stream responses. | Upload such a file; inspect `Content-Type` on the stream. | V2 (not executed) |
| SEC-04 | High | S | `be/routers/employees.py:99-106`; `be/core/access_service.py:668-692`; `be/repositories/sql/employees.py:185-187` | implemented | Changing an employee's email rewrites `users.email`, and sign-in matches by email. The only check is uniqueness. An `hr.employee.write` holder can redirect any user, including a Super-Admin, to a Google account they control (any domain, per D-013). Audit records only field names. (ASVS V4.2, A01.) | Require `system.users.manage` to change the email of a user who holds an assigned role; block self-change; log old and new values. | As HR-Admin, change a Super-Admin employee's email; check `users.email`. | V2 |
| SEC-05 | High | S | `be/services/export.py:105-116`; `be/routers/export.py:58-64` | implemented | The employees export needs only `hr.export.run` + `hr.employee.read` but returns full IBAN, SWIFT and salary columns, bypassing `hr.employee_bank_account.reveal` and `hr.salary.read`. The Sheets variant copies them to a spreadsheet. | Mask IBAN without reveal; drop salary columns without `hr.salary.read`; audit unmasked exports. | Export with a role holding only those two keys. | V2 |
| SEC-06 | Medium | S | `be/repositories/sql/employees.py:24-26` | implemented | Employee list and detail always include salary fields, so `hr.salary.read` is not a real boundary. | Strip salary fields unless the caller holds `hr.salary.read` (or `self.salary.read` for own record). | Call `/api/employees` without salary permission. | V1 |
| SEC-07 | Medium | S | `be/finance/services/reports_service.py:624`; `be/finance/routers/reports.py:533,620-659` | implemented | `/reports/balances` returns full company account numbers under `finance.report.read`, bypassing `finance.bank_account.reveal`. Line 533 checks three keys that are not in the catalog (`finance.bank.manage`, `finance.admin`, `admin`), so `can_view_sensitive` is always false. Per-employee compensation reports need only `finance.report.read`. | Mask in reports; use catalog keys. | Call the balances report as a report-only role. | V2 |
| SEC-08 | Medium | S | `be/routers/salary_payment_docs.py:168-176` | implemented | Salary payment PDFs are sent with `Cache-Control: public, max-age=3600`; errors return the exception text as a 404. | `private, no-store`; generic error with request id. | Inspect response headers. | V2 |
| SEC-09 | Medium | S | `be/routers/employees.py:92-106`; `be/repositories/sql/employees.py:172-182` | implemented | Salary can be changed through the employee update under `hr.employee.write`, with no salary-history row, no amounts in audit, and no non-negative check. | Reject salary fields without `hr.salary.write`; route through the raise path. | PUT salary fields as an HR role without salary write. | V2 |
| SEC-10 | Medium | M | `be/routers/requests.py:51`; `be/repositories/sql/requests.py:86-110`; `be/repositories/sql/insurance.py:153-171` | implemented | Approving a generic request of type "Vacation" or "Medical Insurance" finds a claim or vacation heuristically (for example, the only pending claim) and approves it. A harmless-looking request can approve an unrelated claim. No state check on re-actioning. | Store a foreign key on the request; reject actions on non-pending rows. | Create a pending claim and a generic request; approve the request. | V1 |
| SEC-11 | Medium | S | `be/deps.py:119`; `be/routers/requests.py:39-51`; `vacations.py:40-43`; `insurance.py:108-111` | implemented | For self-submitted requests the client-supplied `employee_name` is stored as given. Insurance consumption is matched by name, so a spoofed approved claim counts against a colleague's limit. | Resolve the name from the database by employee id; match consumption by id. | Submit a claim with another name. | V1 |
| SEC-12 | Medium | S | `be/routers/insurance.py:105-106`; `be/models.py:129`; `fe/public/js/app.js:245` | implemented | Claim `document_url` is an unvalidated string up to 3 MB stored in SQL, returned in every list and export, and placed unescaped into an `href`. | Store receipts through the document storage path and keep only a file id. | Submit a claim with a `javascript:` URL. | V1 |
| SEC-13 | Medium | S | `be/routers/employee_bank_accounts.py:48-55`; `be/finance/routers/vendors.py:73-80,126-133` | implemented | Revealing an employee IBAN or vendor payment details writes no audit row (company account reveal does). | Audit every reveal. | Reveal; read the audit log. | V1 |
| SEC-14 | Low–Medium | S | `be/repositories/sql/auth.py:35`; `be/core/permissions.py:63`; `be/finance/services/payroll_service.py:1837` | implemented | Email lookup uses `ilike` with the raw address; `_` is a wildcard, so `a_b@x` can match `aXb@x`. | Compare `lower(email)` for equality. | Unit test with two such users. | V2 |
| SEC-15 | Medium | S | `be/routers/export.py:239`; `be/sheets_client.py:367-368` | implemented (Q-005 open) | The Sheets export clears any worksheet named by the caller in the configured spreadsheet. | Force an `Export_` prefix. | Export to an existing tab name. | V1 |
| SEC-16 | Low–Medium | S | `be/services/export.py:49`; `be/finance/services/excel_exporter.py:158-167,391-393,472-481`; `payroll_service.py:1619-1622` | implemented | CSV and older XLSX exports write user text as-is (formula injection). A sanitiser exists and is applied only to newer reports. | Apply it to every string cell. | Name starting with `=`; open the export. | V1 |
| SEC-17 | Medium | M | `be/finance/routers/bills.py:133`; `bills_service.py:333`; `schemas.py:750`; `fe/src/partials/modals/bill-modal.html:373-374` | implemented | Approve, pay and reverse a bill all sit under `finance.bill.write`; the approver's limit is a client-supplied field the approver types in. | Needs an owner decision on permission split (section 6). At minimum hold the limit server-side. | Approve with a large `approver_limit`. | V1 |
| SEC-18 | Low | S | `be/finance/routers/reports.py:97-102,339-375,579-604`; `routers/subscriptions.py:121-139` | implemented | Several write actions (attention review, saved views, schedules) need only `finance.report.read`; any attachment, including bank statements, is downloadable with `finance.subscription.read`. | Use write keys; scope attachment download by owner type. | — | V1 |
| SEC-19 | Low | S | `be/auth.py:46-64`; `be/routers/auth.py:89-92` | implemented | Sessions are stateless 12-hour tokens; logout only clears the cookie, so a copied cookie stays valid. Archived users are blocked per request, which covers the main case. (ASVS V3.3.) | Accept for launch; consider a per-user token version later. | — | V2 |
| SEC-20 | Low | S | `be/main.py:104-113` | implemented | The CSP header is set on API responses. The page itself is served by whatever hosts `fe/dist`, so it has no CSP unless that host adds one. | Add the header at the static host or proxy. | Inspect headers on the page load. | V2 |
| SEC-21 | Low | S | `be/routers/employees.py:222,261`; `documents.py:59,97`; `export.py:247` | implemented | Raw exception text is returned to clients. | Generic message plus request id. | — | V1 |
| SEC-22 | Low | M | `be/models_db.py:100-109`; `be/repositories/sql/employees.py:229-238` | implemented | Deleting an employee hard-deletes salary history, payment docs, claims and compensation plans, leaves files behind, and audits only the id. The future "Archived employee" note covers intent, not this behaviour. | Block delete when payroll or payment docs exist until archiving is built. | Delete an employee with history. | V1 |
| SEC-23 | Low | S | `be/models.py` | implemented | Request models lack bounds: no non-negative checks on salary, days or amounts; free-text status and dates; no `max_length`. | Add constraints. | Post negative values. | V1 |
| SEC-24 | Low | S | `be/storage.py:154-159,171-176,194` | implemented | Local storage only: two files with the same name overwrite each other and deleting one record removes the other's file. | Prefix a unique id. | Upload `id.pdf` twice. | V2 |

**Checked and found fine:** every route has a catalog permission in its dependency tree; own-or-all scope is enforced down to the repository for employees, documents, bank accounts, salary history, vacations, claims and requests; no raw SQL in application code; local-storage path traversal is blocked; `Content-Disposition` names are sanitised; no token is readable by JavaScript; `SECRET_KEY` has no default; Google audience and `email_verified` are checked; no secrets in tracked files or in 456 commits of history (pattern search).

### 3.3 Pass 1 — Finance and payroll correctness

Domain-rule check:

| Rule | Result | Evidence |
| :--- | :--- | :--- |
| Finance does not mutate HR data | **Violated** | ARC-13 |
| Employee and company bank accounts stay distinct | **Partly holds** | Separate tables. `payroll_service.py:895-896` writes the label "Operating Account" and a made-up mask `••••4821` into employee-destination fields on adjustment lines. |
| Estimates, portal-confirmed amounts, paid amounts and variances stay separate | **Partly holds** | Statutory model keeps them apart (`models.py:811-815`) and refuses to settle an estimate. Payroll CSV headers "Employee Tax EGP" and "Employee SI EGP" carry no estimate marker (`payroll_service.py:1575-1581`); `reports_service.py:2479` treats an estimate as accrued. |
| Bonus and commission are optional | **Holds** | Runs work with none. |
| Missing employee bank details warn, never block | **Holds** | Severity `warning` (`payroll_service.py:343-344`); submit and approve filter on `blocking` only. Only employees with an external-USD component are checked (already recorded as undecided). |
| Payroll export is one employee per row | **Shape holds, values wrong, not reachable** | FIN-02, UX-06 |
| No assumed background jobs, bank rails, FX feeds | **Violated in places** | FIN-04, FIN-08, FIN-16 |
| Payment-rail execution is optional | **Partly holds** | No rail code exists; "pay" only flips a status. There is no enable flag and the wording says funds were released. |
| SQL is the store; Sheets is export-only | **Holds** | Dead Sheets fallbacks remain in `be/deps.py:109-111,131-141` and `services/salary_payment_docs.py:175-187` (beyond the two known imports). |

| ID | Sev | Eff | Location | Status | Issue and impact | Fix | Verify | Conf |
| :-- | :-- | :-- | :--- | :--- | :--- | :--- | :--- | :-- |
| FIN-01 | High | M | `be/finance/repositories/compensation_plan_repository.py:44-60`; `payroll_service.py:384-452` | implemented | The period query returns every plan row overlapping the period. After a mid-month change, both the closed row and the new row become full lines, so the employee is paid twice for that component. | One row per component (latest effective at period end), or pro-rate. | Set a component effective the 15th; preview that month; count lines. | V2 (not executed) |
| FIN-02 | High | S | `payroll_service.py:904,1197,1253,1592-1603` | implemented | Adjustments are saved both as payroll lines and as adjustments. The CSV excludes adjustment lines using `is_adjustment`, an attribute the line model does not have, so each bonus or commission is counted twice in "Final Payment". | Keep adjustments in one place, or add the column. | Run with one $100 bonus; compare CSV total with `total_net`. | V2 |
| FIN-03 | High | S | `payroll_service.py:1481,1498-1501` | implemented | `approve_run` accepts a `draft`. A draft has no `submitted_by`, so the maker-checker comparison is skipped and one user can create and approve. | Approve only from `submitted`; also compare with `created_by`. | Create a draft; call `/approve` as the same user. | V2 |
| FIN-04 | Medium | S | `payroll_service.py:1680-1682`; `schemas.py:2237`; `routers/payroll.py:294` | implemented | The production pay endpoint accepts `simulate_partial_failure_ids` and marks those lines failed with "Payment Gateway Reject: Account Routing Failure". No gateway exists. | Remove the parameter; name the action "mark as paid" and capture a real reference. | Call pay with the parameter. | V2 |
| FIN-05 | Medium | M | `payroll_service.py:941,1115-1122` | implemented | No reject, return-to-draft or cancel path. A wrong submitted or approved run cannot be withdrawn and blocks its period. Blocking exceptions are a frozen snapshot, not re-checked at submit or approve. | Add the transitions; recompute exceptions at submit and approve. | Submit a run; try to withdraw it. | V1 |
| FIN-06 | High | M | `payroll_service.py:1736-1824` | implemented (Q-001, Q-012 open) | The payroll journal inserts ledger rows directly with `source="manual"` and does not recalculate balances, so the account balance is stale and the rows can be edited or deleted like manual entries, after which the journal can be posted again. Only the first of up to two transactions is linked to the run. Currency is forced to the run currency. Missing lookups fall back to ids `2`, `5` and account `1`. A `finalized` (unpaid) run can be journaled. | Post through the ledger repository with a payroll source; link all rows; raise on missing lookups. Independent of Q-001. | Post a journal; compare account balance before and after. | V2 |
| FIN-07 | High | S | `be/finance/repositories/cheques_repository.py:185-188` | implemented | Linking a cheque to a bill sets the bill to `paid` with no payment record, no amount check and no approval gate; `amount_paid` stays 0, so ageing still shows it open. | Route through the settlement service. | Link a small cheque to a larger bill. | V2 |
| FIN-08 | Medium | S | `payroll_service.py:228-246`; `payroll_calculation_helper.py:208-209` | implemented (Q-004 open) | With no manual rate, payroll derives USD→EGP from the last transfer, or uses a hard-coded `50.0`, and locks it on the run without telling the user. | Whatever Q-004 decides, do not use a silent constant: show the source and block when none exists. | Preview with no transfers and no rate. | V2 |
| FIN-09 | Medium | S | `payroll_service.py:509-511,858` | implemented | Preview totals subtract deductions from an amount that is already net for GROSS-basis employees, so preview and saved run disagree after any adjustment. | Remove the second subtraction. | Add an adjustment; compare preview and run totals. | V1 |
| FIN-10 | High | S | `be/finance/routers/payroll.py:236-247` | implemented (matches D-011) | `allow_self_approval=true` is honoured for anyone holding both prepare and approve. That is what D-011 states, but the override is not recorded in the audit trail, and the UI passes `true` on every approval (`finance-payroll.js:1453`). | Audit the override; pass it only on explicit user choice. | Approve from the UI; read the audit row. | V2 |
| FIN-11 | High | S | `be/finance/repositories/subscriptions_repository.py:179-272` | implemented | Logging a subscription charge with a bank account creates a `ready_to_pay` bill and a paid ledger outflow together. Paying the bill later double-counts. | With a bank account, settle the bill; without, create the bill only. | Log a charge with `create_bill`; check the pay queue. | V2 |
| FIN-12 | High | S | `be/finance/repositories/statements_repository.py:458-647` | implemented | `resolve_line` does not check the line's current status, so a double click on "create" or "split" inserts duplicate ledger transactions. An unknown action returns success. | Require `unmatched`; reject unknown actions. | Call resolve twice. | V2 for the missing check |
| FIN-13 | High | S | `be/finance/repositories/ledger_repository.py:83-91` | implemented | Balance recalculation adds raw amounts regardless of transaction currency; `base_amount` is never used. A USD entry on an EGP account moves the balance by the USD figure. | Use the converted amount; reject mismatches in settlement. | Post a USD entry with a rate to an EGP account. | V2 |
| FIN-14 | High | M | enforced only at `ledger_repository.py:109-123` and `cheques_repository.py:239-253` | implemented | Closing a reconciliation period is enforced on two write paths. Ledger update and delete, payments, transfers, the payroll journal and statement discard ignore it. | One shared "period open" check used by every posting path. | Close a period; edit a transaction inside it. | V1 |
| FIN-15 | High | M | `be/finance/services/reports_service.py:1258-1266` | implemented | Cash-basis P&L counts every inflow as revenue and every outflow as expense. Transfers, FX legs and reversals inflate both. With currency `ALL`, USD and EGP are added together. | Exclude transfer and reversal sources; never sum across currencies. | Make one internal transfer; open the P&L. | V2 |
| FIN-16 | Medium | S | `be/finance/services/invoices_service.py:417-440`; `reports_service.py:2015-2050`; `routers/observability.py:86` | implemented | "Payment reminder successfully dispatched" is returned with no mail sent. Report schedules with recipients are stored and never run. A metrics endpoint returns a hard-coded `42.5`. | Remove or relabel until real. | Send a reminder; check for mail. | V2 |
| FIN-17 | Medium | M | `be/finance/services/bills_service.py:414-431,480-484`; `settlement_service.py:48-53` | implemented | Setting a bill to `scheduled` skips the approval gate and it can then be paid; bills in `inbox` or `needs_coding` without `requires_approval` are payable. | Explicit transition table; settle only from payable states. | Schedule an unapproved bill; pay it. | V1 |
| FIN-18 | Medium | S | `be/finance/services/invoices_service.py:405-415` | implemented | Invoice payment reversal looks up the payment by id only, so a bill payment can be reversed through an invoice URL without updating the bill. | Filter by the invoice. | Reverse a bill payment id via an invoice URL. | V1 |
| FIN-19 | Medium | S | `bills_service.py:534,626`; `statements_service.py:172,307`; `bill_extractor.py:31-36` | implemented | Worse than the known "runs synchronously": no size or type limit on any finance upload, and PDF parsing runs inside `async` handlers, so one large PDF stalls every request. | Size and page caps, signature check, run in a thread pool. | Upload a 200 MB file. | V1 |
| FIN-20 | Medium | M | `be/finance/services/statements_service.py:326-374`; `statement_parsers.py:154-161,60-63` | implemented | Statement import writes the file and commits before parsing; bad rows are dropped silently; the file name is used unsanitised in the path; a UTF-8 BOM breaks column detection; ambiguous dates are guessed day-first without warning. | Parse first, one transaction, report the error count, sanitise the name. | Import a BOM CSV. | V1 |
| FIN-21 | Medium | M | `be/finance/services/ledger_service.py:474-496`; `ledger_repository.py:193-216` | implemented | Manual transactions are hard-deleted; the reason is echoed and not stored; no audit row. Update can change `entry_type` to `adjustment` without `finance.adjustment.manage`. | Void instead of delete; audit. | Delete a transaction; read the audit log. | V1 |
| FIN-22 | Medium | M | no `with_for_update` anywhere in `be/finance` | implemented | No row locks and no unique constraint on payroll period or bill number. On PostgreSQL, concurrent requests can overpay a bill or create two runs for one period. SQLite hides this today. | Lock the parent row; add unique indexes. | Concurrent requests on PostgreSQL. | V2 (count); effect U |
| FIN-23 | Medium | S | `be/finance/services/reports_service.py:2442,2465,2479` | implemented | The payable-status report reads `tax_amount`, which is always written as 0, so per-employee tax shows zero; estimates count as accrued; draft runs are included in compensation reports. | Use the snapshot fields; filter by status. | Open the report after a run. | V1 |
| FIN-24 | Low | S | `be/finance/services/transfers_service.py:224`; `transfers_repository.py:300-315` | implemented | Matching a `to_only` transfer creates a second inflow leg. No reversal for transfers. | Check for an existing leg. | Match such a transfer. | V1 |
| FIN-25 | Low | S | `be/finance/repositories/statements_repository.py:701-703` | implemented | Period close compares against today's book balance, not the period-end balance, so closing a past month usually needs an override. | Use the balance as of period end. | Close last month. | V1 |
| FIN-26 | Low | S | `be/services/export.py:309`; `be/models_db.py:274` | implemented | The salary payment docs export calls `strftime` on a string column and should return 500 whenever a row exists. | Use the string. | Export the dataset. | V2 (not executed) |
| FIN-27 | Low | S | `be/services/salary_payment_docs.py:322-327` | implemented | Regenerating a payment doc that fails overwrites the previous good record with `failed`; successful regeneration orphans the old files. | Never overwrite a generated row with a failure. | Force a failed regeneration. | V1 |

### 3.4 Pass 1 — Frontend code

| ID | Sev | Eff | Location | Status | Issue and impact | Fix | Verify | Conf |
| :-- | :-- | :-- | :--- | :--- | :--- | :--- | :--- | :-- |
| FE-01 | High | M | `fe/api/finance/core.js:6`; `fe/public/js/session.js:198-257`; `fe/api.js:46` | implemented | Mock mode ships in the production bundle. `_isMock` is true for any URL containing `mock=`. A signed-in user who opens `?mock=1` gets real HR data, fake finance data with no banner, and finance saves that return success without reaching the server. With `?mock=admin`, the login screen is skipped (no real data is exposed without a session). 401 handling is disabled. About 5,900 shipped lines are mock code. | Build-time flag; one strict parameter check; permanent "MOCK DATA" banner; fixtures in a file loaded only when enabled. | Open PROD with `?mock=1`; watch for missing `/api/finance/*` requests. | V2 |
| FE-02 | High | S | `fe/vite.config.js:52-58,145-154`; `fe/config-example.js` | implemented | The build copies whatever `fe/config.js` is on the build machine into `dist`. A PROD build from a dev machine ships the localhost API URL; a missing file only warns and the app then fails at load. Nothing shows which environment a user is in. | Generate `config.js` at deploy per environment; fail the build if absent; add an environment name and a non-PROD banner. | Delete `fe/config.js`; build. | V2 |
| FE-03 | High | S | `fe/public/js/employees.js:375` | implemented | `JSON.stringify` output is placed inside a double-quoted `onclick`, so the attribute ends at the first quote. The Preview button on every employee document should be a syntax error, and a crafted name injects attributes. | `data-*` attributes and a listener. | Click Preview on any employee document. | V2 (not executed) |
| FE-04 | High | S | `fe/public/js/finance-bills.js:1284-1327`; `finance-invoices.js:647-695`; `fe/api/finance/*.js` | implemented | Recording a bill or invoice payment does not disable its button and sends no idempotency key (the header is sent on 3 DELETE calls only). A double click records two payments. Same for bill approval, schedule and vendor payment instruction. | Shared submit lock; send an idempotency key on every finance POST. | Double-click Save Payment. | V2 |
| FE-05 | Medium | S | `fe/public/js/app.js:27-33` | implemented (touches Q-007) | Every admin-portal user loads employees, requests, claims and salary history in one `Promise.all`. A Finance-only or Payroll-only role gets a 403 on some, the whole load fails, and dropdowns that depend on the employee list stay empty. | Gate each call by permission; use `allSettled`. | Sign in as Financial-Admin with no HR keys. | V2 for the code; effect U |
| FE-06 | Medium | S | `fe/public/js/finance-nav.js:157-158` | implemented | Worse than the known payslip gap: opening "My Payslips" calls `loadMyPayslips()`, which is not defined, so the click handler throws. | Deliver roadmap Slice 4, or hide the page until then. | Click My Payslips. | V2 |
| FE-07 | Medium | S | `fe/vite.config.js:95,106,161` | implemented | `api.js` and `finance-api.js` are separate files with no cache-busting, so a browser can pair a new page with an old client. `publicDir` copies all 30 source modules into `dist/js` (about 1.1 MB unused). The build rewrites the tracked `finance-api.js`. A missing partial only warns (`:78-81`). | Version query string or inline; `publicDir: false`; ignore the generated file or check drift in CI; throw on missing partial. | Inspect `dist`. | V1 |
| FE-08 | Medium | M | `fe/vite.config.js:10-42,101-104` | implemented | Known: one inlined script. Additional: order is a hand-kept list of 30 files in one shared scope; `formatCurrency` is defined twice (`finance-core.js:1374`, `finance-statements.js:16`) and the later one silently wins. State is about 120 top-level `let`s and 395 `window.` assignments. | See section 5. | — | V1 |
| FE-09 | Medium | S | `fe/api.js:78-113` | implemented | No timeout or abort; every network failure shows "is the backend server running?"; validation errors are shown as raw JSON; a non-JSON success body returns `null` and callers then fail; the request id is never shown to the user. | Timeout, friendly messages, show the request id. | Stop the backend; trigger a call. | V1 |
| FE-10 | Medium | S | `fe/src/index.html:10-14` | implemented | Fonts, Font Awesome and Chart.js load from CDNs without integrity hashes; Chart.js blocks rendering in `<head>`. If a CDN is blocked, all icons vanish (many buttons are icon-only). | Self-host the three assets. | Block the CDNs; load the app. | V2 |
| FE-11 | Low–Medium | S | `fe/public/js/session.js:303-313,323-335`; `finance-invoices.js:297-300` | implemented | Logout clears HR state only; finance and payroll tables stay in the DOM for the next user on the same tab. An invoice draft in `localStorage` is not per-user and survives logout. | Reload the page on logout. | Log out and in as another user. | V1 |
| FE-12 | Low–Medium | S | `fe/public/js/finance-nav.js:46-94`; `ui.js:122-127`; `admin-nav.js:158-171` | implemented | Sidebar finance badges update only at load, never after a change. One navigation click runs up to three handlers; loaders have no sequence guard, so overlapping loads resolve last-writer-wins. | Refresh badges after mutations; one navigation entry point. | Approve a bill; watch the badge. | V1 |
| FE-13 | Low | S | `fe/public/js/finance-subscriptions.js:408`; `finance-accounts.js:784-791` | implemented | The subscription attachment link omits the API base URL, so it breaks when the API is on another origin. The "reconcile" prompt after statement upload checks for a function that does not exist and can never show. | Use the authenticated download helper; remove or implement. | Click the link in a split-origin setup. | V1 |

**Checked and found fine:** no token in JavaScript or browser storage; `credentials: "include"` used consistently; login error rendered with `textContent`; `finance-statements.js` and `system-access.js` escape consistently; the modal controller (focus trap, Escape, focus return) is solid; exact pins for Vite and a committed lockfile; zero runtime npm dependencies; `finance-api.js` currently matches its sources.

### 3.5 Pass 2 — Product and UX

Coverage: 22 admin pages, 6 employee pages, 6 shell partials and 61 modals were inventoried. Pages or modals not listed below had no finding.

| ID | Sev | Eff | Location | Status | Issue and impact | Fix | Verify | Conf |
| :-- | :-- | :-- | :--- | :--- | :--- | :--- | :--- | :-- |
| UX-01 | High | S | `fe/src/styles/layout.css:419-422` | implemented | `.topbar h2, .topbar .sub {display:none}` hides the page title on every page. HR pages have no in-page heading, so with the panel collapsed nothing says where you are, and there is no heading for assistive technology. | Show the title, or add a section heading to each HR page as Finance and System have. | Collapse the panel on Employees. | V2 |
| UX-02 | High | S | `fe/src/styles/layout.css:406-417` | implemented | The topbar is sticky and transparent; content scrolls under its buttons and they cover page titles and the payroll status strip. | Solid background or non-sticky. | Scroll payroll screen 2 at 390px and 1440px. | from screenshots |
| UX-03 | High | S | `fe/public/js/finance-core.js:200-274`; 131 uses of `btn-outline`; `admin/topbar.html:11` | implemented | Classes used but never defined in CSS: `badge-approved`, `badge-pending`, `badge-success` and the rest of that family, `btn-outline`, `hide-mobile`. Finance status badges render as plain text with no colour, and secondary buttons fall back to the base style. | Define the classes from tokens, or switch to the existing pill classes. | Inspect a bill status cell. | V2 (grep: 0 definitions); visual effect U |
| UX-04 | High | S | `fe/src/styles/modules/payroll.css:434-467` | implemented | Payroll CSS redefines `.btn`, `.btn:hover`, `.btn.sm`, `.btn-fill` globally and is imported after the shared components, so every button in the app takes payroll's style. About 90 other unscoped generic selectors (`.footer`, `.tag`, `.toggle`, `.muted`) sit in the same file. | Scope everything under `#a-finance-payroll`. | Compare a button on Employees with `components.css:285-323`. | V2 |
| UX-05 | High | M | no router; only `finance-core.js:1059-1144` uses the URL | implemented | Refresh always returns to the HR dashboard; browser Back leaves the app; no page, record or payroll step can be linked. | Hash routing with a `popstate` handler. | Refresh on payroll screen 4. | V1 |
| UX-06 | High | M | `fe/src/partials/admin/sections/finance-payroll.html`; `payroll-cycle-bar.html:53-57` (not included in `index.html`); `be/finance/routers/payroll.py:262` | partial | The backend has `GET /runs/{id}/export`, but no control in the six-screen run calls it; the only export menu is in a partial that is not part of the build; the global Export dialog has no payroll dataset. The D-007 export is unreachable from the UI. | Export button on screens 4 and 5. | Search the run screens for an export control. | V2 |
| UX-07 | High | S | `fe/public/js/finance-payroll.js:1441-1476` | implemented | "Confirm & Disburse Payroll" acts on one click with no confirmation and, if needed, submits, approves (with self-approval), finalises, marks paid and posts the journal in one go. The banner then says "Funds released". | Confirmation with totals, recipient count and missing-bank count; reword to "recorded as paid". | Click it on a draft. | V2 |
| UX-08 | High | S | `fe/src/partials/employee/sections/dashboard.html:22-26`; `salary.html:13-16`; `insurance.html:17-18`; `admin/sections/insurance.html:11-23` | implemented | Hard-coded values shown to real employees: "Mar 2027, Estimated +8%, 7 of 12 months"; "Annual Bonus EGP 63,000" (never overwritten); plan "Premium Family Care / Allianz Egypt". | Bind to data or remove. | Open the employee portal. | V2 |
| UX-09 | High | S | `fe/public/js/insurance.js:85-96` | implemented | Admin claim rows have Approve and Reject but no link to the receipt; it is shown only to the employee. Reimbursements are approved blind. | Add a view-receipt action. | Open admin claims. | V1 |
| UX-10 | High | S | `admin/sections/invoices.html:19,55,56,65`; `ui.js:141`; `employees.js:20`; `export-modal.html:24`; `employee-modal.html:95`; `be/routers/export.py:48` | implemented | The HR Salary Payment Docs page title is right, but the body says "Generate Invoices", "Invoice History", "Invoice #"; the row action is "Generate Invoice"; the export calls it "Contractor Invoices". This is the confusion with Finance Sales Invoices that D-010 N-6 set out to remove. | Rename throughout. | Read the page. | V1; `export.py:48` V2 |
| UX-11 | Medium | S | `employee-detail.html:122`; `bank-account-modal.html:6`; `bill-modal.html:290`; `finance-payroll.html:348,375` | implemented | "Bank Account" labels do not say employee or company. | Prefix consistently. | — | V1 |
| UX-12 | Medium | M | HR and System modals; `employees.js:57` | implemented | HR forms validate by toast, one field at a time (only name is checked on employee create although email is marked required). 133 of 409 inputs have no associated label. No `inputmode`; email is not `type=email`; no min or max on money. Finance already has inline validation with an error summary. | Reuse the Finance form helper; add `for`/`id`. | Save an employee with a blank email. | V1 |
| UX-13 | Medium | S | `employees.js:264,576`; `insurance.js:74,104`; `requests.js:104`; native dialogs in `system-access.js:492,719`, `finance-reports.js:592,932`, `finance-statements.js:2025,2037`, `finance-payroll.js:919,1767,2186` | implemented | No confirmation on document delete, note delete, category delete, claim approve/reject or request reject (no reason captured). Elsewhere native `confirm`/`prompt`/`alert` are used. | Use the existing confirm modals everywhere. | Delete a note. | V1 |
| UX-14 | Medium | S | `fe/public/js/ui.js:267-274`; `finance-payroll.js:2153` | implemented | Toasts have no `aria-live`, look the same for error and success, vanish after 3.2 s with no close; payroll error banners hide after 5 s. | Role and persistence for errors. | Trigger an error. | V2 |
| UX-15 | Medium | S | `admin/topbar.html`, `employee/topbar.html` | implemented | The notification bell has no handler in either portal. Employees get no signal when a request is decided. | Remove or wire up. | Click it. | V1 |
| UX-16 | Medium | S | `fe/src/styles/tokens.css` | implemented | Computed contrast, light theme: secondary text 3.35:1, tertiary text 1.60:1 (165 uses), success pill 2.69, warning pill 2.61, danger pill 3.88, info pill 3.34. All below 4.5:1. Primary text and accent pass. | Darken the two text tokens and pill text. | Contrast checker. | V1 |
| UX-17 | Medium | M | payroll runs list and screens 2–4 | implemented | On a phone the runs table scrolls sideways with its total cut off; on screen 2 the stepper wraps to five rows and the worksheet starts far below the fold. | Compact stepper; card rows. | Screenshots at 390px. | from screenshots |
| UX-18 | Medium | S | `finance-statutory.html:213,225` | implemented | Statutory obligations are the fourth tab under Spend; summary shows `$`; currency is free text defaulting to USD though payroll statutory figures are EGP; period is typed text. The Spend tab bar is copied into three partials. | Currency select defaulting to EGP; `type=month`; one tab bar. | Record an obligation. | V1 |
| UX-19 | Medium | S | `finance-accounts.html:318-420,427-514`; `finance-settings.html` | implemented | Dead duplicate panes with duplicate element ids; the Settings filter tabs accumulate "active" because the handler clears only the hidden copy. | Delete the dead panes. | Click category filters in Settings. | V1 |
| UX-20 | Medium | M | employee profile; payroll rows | implemented | No route from an employee to their compensation plan, payroll lines or payment docs, and payroll rows do not link to the employee, so a "missing bank details" row cannot be fixed without leaving the run and searching. | Link names both ways. | Follow a missing-bank row. | V1 |
| UX-21 | Medium | S | `employees.js:9`; `admin/sections/employees.html` | implemented | The search placeholder promises department search; the filter covers name, role and state only. No sort, status filter or paging on HR lists; Finance lists have all three. | Reuse the Finance table helper. | Search a department. | V1 |
| UX-22 | Medium | M | `fe/public/js/search.js`; `command-palette-modal.html` | implemented | The command palette searches employees and two finance actions only, bypasses the modal controller, is not permission-gated, and in the employee portal lists all employees with email and status. | Add pages and records; gate by permission; hide employee search from employees. | Open it as an employee. | V1 |
| UX-23 | Medium | S | `finance-payroll.html:648,697`; `finance-subscriptions.html:137`; `finance-report-modals.html:83` | implemented | Copy implies bank clearing, an automatic market rate, auto-generated bills on renewal and scheduled email delivery. None exists. | Reword or hide. | Read the screens. | V1 |
| UX-24 | Low | L | partials and JS | implemented | 1,799 inline `style` attributes (reports 441, accounts 184, dashboard 177) and about 650 hard-coded colours outside tokens; three badge vocabularies; primary button spelled three ways; 25 distinct pixel font sizes. Token use inside CSS files is otherwise good. | Clean up page by page when touched. | Counts by grep. | V1 |
| UX-25 | Low | S | `employee/sidebar.html`; command palette; payroll revert overlay | implemented | Employee sidebar links have no `href` (not keyboard-focusable); 12 clickable non-buttons; no `h1`; the off-screen mobile drawer stays tabbable. | Buttons or `href`; heading. | Tab through the employee portal. | V1 |
| UX-26 | Low | S | `admin/sections/requests.html`; `system-users.html:24-27` | implemented | "Pending Requests Queue" lists all statuses by default. The Users role filter options are hard-coded, so custom roles are missing. | Rename or filter; build options from the API. | — | V1 |

**States:** empty states exist everywhere. Loading states exist on Employees and Finance lists; other HR pages and the employee portal have none beyond the global loader. Error states are toast-only except Finance Overview and Settings, which have a banner with Retry.

**Fine as is:** dual-rail navigation matches D-010; one icon set; dark theme through tokens; reduced-motion handling; `lang`, viewport and logo alt text present; touch targets forced to 44px on phones; modals go full-screen on phones; missing bank details are shown as an amber warning and do not block.

**Workflows (step counts are approximate, from source)**

| # | Workflow | Clicks | Screens / modals | Main friction |
| :-- | :--- | :-- | :--- | :--- |
| 1 | Add employee with salary split, bank details, first document | ~11 | 2 pages, 3 modals | Bank and document are outside the create flow; salary editable in three places |
| 2 | Vacation request → approval | 4 + 3 | 1 + 1 | No balance shown at request; no reject reason; no notification |
| 3 | Medical claim with receipt → processing | 4 + 3 | 1 + 1 | Admin cannot open the receipt; no provider or date field |
| 4 | Monthly salary payment docs | ~6 | 1 page, 2 modals | Quick; wording says "Invoices" |
| 5 | Payroll run to paid, one bonus, one missing bank, export | ~22 | 6 screens + list | No export; one-click disburse; bonus validated by `alert()`; step lost on refresh; cannot jump to the employee |
| 6 | Vendor bill from PDF → approve → pay → ledger | ~14 | 2 pages, 3 modals | Extraction and duplicate check are good; approver sets own limit; ledger view is three levels away |
| 7 | Sales invoice → collection | ~10 | 1 page, 2 modals | Customer must exist first; draft autosave is good |
| 8 | Import statement → reconcile | ~15 + per line | 4-step wizard + 2 modals | Capable but heavy; desktop only |
| 9 | Statutory obligation → settle | ~9 | 1 page, 2 modals | Hidden under Spend; USD default |
| 10 | External user + role | 5 | 1 page, 1 modal | Simple |

### 3.6 Pass 3 — Experienced-user assessment

Scored as someone who has used small-team HR and finance tools. Scores are from source and screenshots, not hands-on use.

| Area | Score | Reason |
| :--- | :-- | :--- |
| Navigation | 6 | Clear rail and panel; no URLs, no Back, hidden page titles |
| Speed on common jobs | 6 | Approvals are one click; payroll and reconciliation are long; no bulk actions in HR |
| HR records | 5 | Basics present; no sort or filter; no pay history on the profile |
| Leave and claims self-service | 5 | Works; placeholder data, dead bell, admin cannot see receipts |
| Payroll run | 6 | Good six-step structure with estimate, portal and variance kept apart; no export, no confirmation |
| Bills / AP | 7 | Capture with extraction, queues, approval, schedule, payment: the strongest area |
| Invoicing / AR | 6 | Solid list and queues; reminder is not real |
| Banking and reconciliation | 6 | Rules, split, close and reopen; complex for a small team |
| Reporting and exports | 6 | Many reports; payroll export missing; P&L not yet trustworthy (FIN-15) |
| Mobile use | 4 | HR is fine; Finance and Payroll mostly are not |
| Visual polish and consistency | 5 | Good tokens; undefined classes, payroll overrides, heavy inline styling |
| Trust and safety cues | 5 | Finance confirm-with-reason and audit drawer are good; HR deletes, one-click disburse and fake data undermine it |
| Learnability | 5 | Helpful step hints in payroll; overstated capability elsewhere |

**Strengths:** coherent module model; permission system; shared Finance form, table, confirm and drawer helpers; bill extraction; statutory model that matches D-001 and D-002; non-blocking bank warning; dark mode.

**Gaps that matter at this size:** no URLs or Back; no notifications; no payslip or payroll export; bank details and documents outside employee creation; no balance check when requesting leave; no receipt review; HR lists without sort, filter or paging; no audit trail visible on HR records.

**I would recommend it once:** UX-01 to UX-10 are fixed, HR forms use the Finance form helper, destructive actions use the confirm modal, and the payroll and ledger items in the Top 10 are closed.

---

## 4. Doc-versus-code mismatches and open-question impacts

### 4.1 Mismatches

| # | Doc says | Code does |
| :-- | :--- | :--- |
| M-01 | `01-repository-baseline.md` §6 (line 212): production mandates `ALLOWED_WORKSPACE_DOMAIN` and the `hd` claim is validated | No `hd` check exists (`be/auth.py:34-41`); `Config.validate()` does not require it (`be/config.py:199-204`). D-013 dropped the gate; `config.py:66-69` and `be/SETUP_GUIDE.md:56-62,178-179` still describe it. |
| M-02 | `01-repository-baseline.md` §6 (line 225): employee IBAN reveal is gated by `require_admin` | Gated by `hr.employee_bank_account.reveal` (`be/routers/employee_bank_accounts.py:48-51`). Doc 02 §5.4 is correct. |
| M-03 | `01-repository-baseline.md`: 62 Playwright specs, 28 JS modules, 20 finance routers, `dist/index.html` 1.57 MB | 64 specs, 30 modules, 19 routers, 1.79 MB. (245 routes, 63 keys, 27 migrations, 67 test modules, 25 services are correct.) |
| M-04 | `01-repository-baseline.md` and doc 00: "single self-contained" `dist/index.html` | `dist` also needs `config.js`, `api.js`, `finance-api.js` and two images (`fe/vite.config.js:52-58,106`). |
| M-05 | `00-architecture-blueprint.md` §1.2 and §8: Finance never imports HR ORM models directly; cross-domain reads go through a service; no writes | ARC-13: six direct reads and one write. |
| M-06 | `00-architecture-blueprint.md` §4.2–4.3: `be/hr/` namespace and `core.*`/`hr.*`/`finance.*` schemas | HR routers remain in `be/routers/`; only the `finance_` table prefix exists. |
| M-07 | `02-architecture-and-domain-boundaries.md` §3: HR "never directly alters" Finance data; Finance "does not mutate HR employee records" | `repositories/sql/employees.py:189-192` calls the Finance compensation service; `compensation_plan_service.py:171-179` writes `EmployeeDB`. |
| M-08 | `02-architecture-and-domain-boundaries.md` §5.3: maker-checker "prevents self-approval unless holding both prepare and approve" | Also bypassed by approving a draft directly (FIN-03) and by `ENFORCE_MAKER_CHECKER=false`. |
| M-09 | `01-repository-baseline.md` line 257: backend port 8000 | `be/SETUP_GUIDE.md:126` and `fe/config-example.js:2` use 5000. |
| M-10 | `be/SETUP_GUIDE.md:185-206`: "Dummy Password Login", `demo1234`, `/api/auth/login` | No such endpoint or string exists (good); the guide is stale. Lines 14-17 present the Sheets backfill as database initialisation; lines 155-170 describe two roles. |
| M-11 | `be/.env.example:32-36`: Sheets is the default system of record | `be/config.py:180` rejects anything but `sql`. |
| M-12 | `AGENTS.md:49`: `init_db` logs but does not raise on RBAC seeding failure | It re-raises (`be/db.py:100-103`). |
| M-13 | D-007 (accepted): final payroll export, one row per employee | Backend endpoint exists; no UI reaches it (UX-06); totals double-count adjustments (FIN-02). Status: partial. |
| M-14 | D-010 N-6: HR "Invoices" renamed Salary Payment Docs "to prevent confusion" | Nav and title renamed; page body, row action, modals and export dataset still say "Invoice" (UX-10). Status: partial. |
| M-15 | `fe/api.js:3`, `fe/vite.config.js:48,63`: `config.example.js`; "11 classic app scripts" | File is `config-example.js`; there are 30 scripts. |
| M-16 | App version | `2.12.0` hard-coded twice in `be/main.py:80,93`; `fe/package.json` says `1.0.0`. |
| M-17 | `06-open-questions.md` header: questions through Q-012 in the roadmap reference list | The register contains Q-013 (resolved). Minor. |

### 4.2 Open-question impacts (no decision made here)

| Question | Impact seen in code |
| :--- | :--- |
| Q-001 payroll paid-state funding scope | Journal posts net pay only, as recorded. Separately from the decision, the journal posting itself is defective (FIN-06) and should be fixed either way. |
| Q-002 non-payroll statutory creation | No scheduler exists. The statutory page defaults to USD and free-text periods (UX-18), which matters more if records are created by hand. |
| Q-003 production document storage | Finance uploads bypass the storage abstraction and live in the code folder (ARC-05). Either option needs that fixed first. Until decided, PROD backups must include `be/uploads` and the local storage path. |
| Q-004 FX-rate source | Payroll silently derives a rate from the last transfer or uses a constant 50.0 (FIN-08). The UI text mentions an "automatic market rate lookup" that does not exist (UX-23). |
| Q-005 Sheets export retention | While it stays, the export can clear arbitrary tabs (SEC-15) and writes IBANs to the sheet (SEC-05). Dead Sheets fallbacks remain in three files. |
| Q-006 restoring archived users | No new impact. |
| Q-007 Payroll-Maker access to funding accounts | Beyond the recorded gap, a Payroll-only or Finance-only user fails the admin bootstrap load (FE-05), so those roles are not usable in the UI today. |
| Q-008 ownership of compensation plans | Whoever owns them, the Finance service writing `EmployeeDB` without salary history (ARC-13) and the two edit paths that diverge (SEC-09) need resolving. |
| Q-009 splitting `finance.account.*` | Related: bill approve, pay and reverse share `finance.bill.write` (SEC-17). |
| Q-011 employee self-service writes | Own-document upload is the entry point for SEC-03, and employee-written text for SEC-02. Keeping the interim treatment is safe only after those are fixed. |
| Q-012 post-journal permission | See FIN-06; the journal can also be posted on a `finalized`, unpaid run. |

---

## 5. Recommendation on React

**Do not migrate to React before launch. Keep vanilla JS, and change how it is built and how it renders.**

Evidence:

- **Size:** 23,612 lines of hand-written UI JavaScript in 30 files, 9,355 lines of HTML partials in 69 files, 26 pages, 59 modals, 651 inline handlers, about 2,500 `getElementById` calls. Real API client code is about 2,300 lines; another 5,400 are mock branches.
- **Duplication:** an estimated 3,000–4,000 duplicated lines (table rendering, option builders, 87 open/close modal functions, formatting helpers written several times).
- **State:** global variables, no store. Five screens are properly stateful: banking workspace, statement reconciliation, payroll run, reports, bills. The other 21 pages are list-plus-modal.
- **The problems that actually hurt** are unescaped HTML strings (SEC-02), one shared global scope (FE-08), mock code in the bundle (FE-01) and double submits (FE-04). React would fix the first two and not the others.

**Migration cost:** rewrite all partials as components, replace inline handlers and DOM reads with state, rework all 64 Playwright specs (they depend on element ids and mock mode), and replace the build. My estimate is three to five person-months with the app frozen meanwhile; this is an estimate, not a measurement.

**Lower-cost path, in order:**

1. **Normal Vite build with ES modules** instead of one concatenated script (low–medium effort). This gives hashed file names, minification, per-environment config, the ability to strip mock code at build time, and removes the shared-scope hazard.
2. **One shared escape helper and a tagged-template renderer** (lit-html or Preact with htm, both work without JSX) introduced screen by screen, starting with the pages that render employee-written text. Templates then escape by default and bind events without inline strings.
3. **Type checking with JSDoc and `tsc --checkJs`** in CI. It would have caught the two undefined payslip functions and the missing `SessionInfo.getEmail`.

Revisit React only if the team grows or the five stateful screens keep growing after step 2.

---

## 6. Phased plan

Each slice is small, independently reviewable, and ends with a test. IDs refer to section 3.

**Phase 0 — Security blockers (before any PROD data)**

| Slice | Scope | Test |
| :-- | :--- | :--- |
| 0.1 | SEC-01: whitelist bill fields; safe attachment path | Backend test: absolute path rejected; approval fields ignored |
| 0.2 | SEC-03: MIME from signature; inline allowlist; sandbox header | Backend test with a `%PDF-` HTML payload |
| 0.3 | SEC-02 part 1: shared escape helper; `toast` and empty states use text; fix `requests.js`, `employees.js`, `insurance.js`, `dochub.js`, `invoices.js`; FE-03 | Real-backend UI test with a script payload |
| 0.4 | SEC-02 part 2: finance files | Same test on vendor, bill and ledger text |
| 0.5 | SEC-04, SEC-09, SEC-14: email-change rule, salary via raise path only, exact email match | Backend tests |
| 0.6 | SEC-05 – SEC-08, SEC-13: masking in exports and reports, salary stripping, cache header, reveal audit | Backend tests per endpoint |

**Phase 1 — Deployable PROD and DEV**

| Slice | Scope | Test |
| :-- | :--- | :--- |
| 1.1 | ARC-01, ARC-04: explicit environments, secure defaults, one example file per environment, maker-checker flag in `Config` | Config tests |
| 1.2 | ARC-02: no `create_all` outside local; start-up head check | Start against an un-migrated DB fails |
| 1.3 | ARC-03, ARC-09: PostgreSQL CI job running `upgrade head` 0001–0027; CI on `main` and all pull requests; correct secret name | CI green |
| 1.4 | ARC-05, ARC-07: one configurable data directory; persist idempotency and previews, or enforce one worker | Restart test |
| 1.5 | ARC-06: full-table SQLite→PostgreSQL copy with row-count check | Dry run on a copy |
| 1.6 | FE-01, FE-02, FE-07: mock code out of PROD build; per-environment `config.js`; environment banner; cache-busting | Build test without `config.js` fails |
| 1.7 | ARC-08: packaging, proxy and static hosting, release steps, backup and restore, DEV refresh with scrubbing, first-admin procedure | Bring up DEV from the runbook |
| 1.8 | ARC-11, ARC-12: ignore rules; inspect history blobs | `git check-ignore` |

**Phase 2 — Payroll and ledger correctness**

| Slice | Scope | Test |
| :-- | :--- | :--- |
| 2.1 | FIN-01, FIN-02, FIN-09: one line per component; adjustments stored once; preview totals | Backend tests incl. mid-month change and CSV totals |
| 2.2 | FIN-03, FIN-04, FIN-05, FIN-10: approve from submitted only; remove test hook; reject and cancel; audit self-approval | State-machine tests |
| 2.3 | UX-06, UX-07: export button; disburse confirmation; wording | UI test against real backend |
| 2.4 | FIN-06: journal through the ledger | Balance test |
| 2.5 | FIN-07, FIN-11, FIN-12, FIN-18: cheque, subscription, statement resolve, reversal scope | Backend tests |
| 2.6 | FIN-13, FIN-14, FIN-15: currency in balances; shared period lock; P&L exclusions | Report tests |
| 2.7 | FIN-17, FIN-19 – FIN-23, FE-04: bill transitions, upload limits, import atomicity, delete audit, locks, submit lock and idempotency key | Backend and UI tests |
| 2.8 | FIN-08, FIN-16, UX-23: no silent FX constant; remove or relabel reminder, schedules, metric | Depends on Q-004 for the final FX behaviour |

**Phase 3 — UX essentials**

| Slice | Scope |
| :-- | :--- |
| 3.1 | UX-01 – UX-04: titles, topbar, missing classes, payroll CSS scoping |
| 3.2 | UX-08, UX-09, UX-10, UX-11: remove fake values; receipt link; terminology |
| 3.3 | FE-05, FE-06: role-aware bootstrap; payslips page (roadmap Slice 4) |
| 3.4 | UX-12, UX-13, UX-14: HR forms on the shared form helper; confirmations; toast roles |
| 3.5 | UX-05: hash routing |
| 3.6 | UX-16 – UX-22: contrast, mobile payroll, statutory, dead panes, cross-links, HR table features, palette |

**Phase 4 — Structural (after launch)**

| Slice | Scope |
| :-- | :--- |
| 4.1 | ES-module build; shared renderer on the five stateful screens (section 5) |
| 4.2 | ARC-13: HR read interface for Finance |
| 4.3 | ARC-14, ARC-15: `Numeric` money; typed dates |
| 4.4 | ARC-10: real-backend UI suite grown per workflow; ARC-16, ARC-18 |

---

## 7. Updates needed to the decision log, roadmap and open questions

Nothing was changed in those documents. Suggested entries for the owner:

**Decision log (new decisions needed)**

- Bill approval: separate `finance.bill.approve` and `finance.bill.pay` keys or not, and where approval limits live (SEC-17).
- Payroll approval: confirm that approval is allowed only from `submitted` and whether `ENFORCE_MAKER_CHECKER=false` may exist in production (FIN-03, ARC-04).
- Mock mode: allowed in which environments (FE-01).
- Employee deletion: block when payroll or payment history exists until the Archived state is built (SEC-22).
- Who may change the email of a user who holds a role (SEC-04).
- Launch worker model: single worker, or persisted idempotency and previews (ARC-07).
- D-007: record status as partial until the export is reachable and correct. D-010 N-6: record as partial.

**Roadmap**

- Add a "pre-PROD hardening" block (Phases 0–2 above) ahead of the RBAC merge-and-deploy step in §6.
- Add the PostgreSQL migration CI job and the SQLite→PostgreSQL copy rewrite to the existing "remaining before merge" list in §3A.
- Slice 4 (payslips): note the page currently throws on open (FE-06).
- Slice 5 (cleanup): add the dead Sheets fallbacks in `be/deps.py` and `services/salary_payment_docs.py`, and the stale `SETUP_GUIDE.md` and `.env.example`.

**Open questions (new)**

- Should employees with only internal components be checked for missing bank details? (Already noted as undecided in doc 00; not in the register.)
- Should the payroll CSV label tax and social-insurance columns as estimates (D-001)?
- Is the payroll line's `bank_name` / masked account meant to be the employee's destination or the company's source? (Adjustment lines currently write a company label.)
- First Super-Admin on an empty PROD database: how is it provisioned?
- Are the cash-book CSVs in git history real data (ARC-12)?

**Baseline doc corrections:** M-01, M-02, M-03, M-04, M-09 in section 4.1.

---

## 8. Assumptions

1. `feature/rbac` at `98d40dd` is the branch under review.
2. The working tree equals HEAD (confirmed by an empty diff ignoring line endings).
3. Findings marked "not executed" follow from the code as read; none was reproduced.
4. Severity assumes a small trusted staff, with employees as the least-trusted users and the internet as reachable from the deployed hosts.
5. PROD will run PostgreSQL and DEV may run either engine, per docs 01 and 02.
6. Screenshots in `fe/test-results` reflect the current UI closely enough for layout findings.
7. The React migration estimate (three to five person-months) is my judgement from the line counts, not a measured figure.
8. "Status" in the tables describes the affected capability, not the finding.

---

## 9. Handoff summary

- **Outcome:** read-only review of `feature/rbac` @ `98d40dd` complete. One file added: `docs/REVIEW.md`. No code, branch or issue changed. One stray file renamed inside `.git` (`index.lock.stale-claude`, safe to delete).
- **Tests run:** none. Nothing was executed; PostgreSQL untested.
- **Confirmed by reading (second pass):** SEC-01, SEC-03, SEC-04, SEC-05, SEC-07, SEC-08, SEC-09, FIN-01 – FIN-04, FIN-06 – FIN-08, FIN-10 – FIN-13, FIN-15, FIN-16, FE-01 – FE-06, ARC-01 – ARC-07, ARC-09, ARC-11, UX-01, UX-03, UX-04, UX-06 – UX-08.
- **Single-pass or unverified:** everything marked V1 or U; all runtime effects; PostgreSQL behaviour; visual effects of missing CSS classes; the failing-spec list; contents of two history blobs.
- **RBAC itself held up:** guard coverage, scope enforcement, role rules and session handling had no structural finding. The defects are in what guarded endpoints accept and return.
- **Suggested next thread:** Phase 0 slice 0.1 (SEC-01), then 0.3 and 0.5. Each needs the owner's go-ahead and a branch-intake block first.
- **Owner decisions that gate work:** the list in section 7, plus Q-003 and Q-004 for Phases 1 and 2.
