# 27 — Implementation Handoff: File-Storage Root and Folder Layout (F1–F6)

**Plan (authoritative, decisions 1–9 in §8):** `26-file-storage-layout-plan.md`, provided with this handoff (check Downloads folder for it). Add both files to the repo as `docs/file-storage/26-file-storage-layout-plan.md` and `docs/file-storage/27-agent-handoff.md`; **the first commit contains only those two docs**. Read the repo copies from then on.
**Branch:** create `feature/file-storage-layout` from `main`. Do not use `feature/pay-plan-sync`, and never touch the owner's uncommitted edits (compensation-plan files, `export.xlsx`).
**Decisions are closed. Do not reopen them:** Finance is year-first (`finance/<yyyy>/<type>/…`); HR salary docs stay `hr/salary-payment-docs/<yyyy>/<yyyy-mm>/`; account folder `<id>-<bank-slug>-<currency>` (cash: `<id>-<account-name-slug>`); files never move after write; hard delete; env-only root; Drive is an additive backup clone, not a storage backend.

---

## 0. Start here

1. `git checkout main && git pull && git checkout -b feature/file-storage-layout`. Add the two docs, commit `F0: file-storage plan and handoff`.
2. Read `AGENTS.md`, `docs/project-context/00…06`, the plan, `be/storage.py`, `be/finance/storage_paths.py`, and every writer found by `grep -rn "UPLOADS_DIR\|upload_invoice_file\|upload_file\|upload_company_file" be --include=*.py`.
3. Post a branch-intake block (branch, HEAD, merge-base, slice, files you expect to touch) and begin F1. Do not wait for approval between slices unless a stop condition (§5) is hit.

## 1. Slices (work in order; commit prefix `F1: …`)

Scope, rules and acceptance criteria are in plan §4–§6. Short form:

- **F1** `file_layout` module (single `HRFLOW_FILES_ROOT`, `build_ref`, `save/open/delete/exists`, slug and length rules, traversal and symlink guard, legacy-ref fallback, `_meta/layout.json`). No existing writer changed. **Resolve the root at call time, not at import time** (today `BILL_UPLOADS_DIR` and `FINANCE_UPLOADS_DIR` are import-time constants; keep them only as deprecated fallbacks).
- **F2** Finance writers (bills, cheques, sales invoices and importers, statements, subscription proofs, ledger attachments, checkpoints) use F1 for new files. Refs stored root-relative.
- **F3** HR writers (salary payment docs, employee docs, company docs) via the local `StorageClient`; Drive backend untouched.
- **F4** `scripts/migrate_file_layout.py`: dry run by default; copy → SHA-256 verify → update ref in one transaction → remove old; idempotent; CSV report; lists orphans without deleting.
- **F5** Prod config (`deploy/prod/docker-compose.yml`, `.env` template, `RUNBOOK.md` "Moving the files root"), optional read-only Settings status panel **only if the owner says yes** (default: skip; backend-only).
- **F6** Additive one-way clone of `<ROOT>` to a Google Drive for Desktop folder, via `deploy/prod/scripts/backup.ps1` or a sibling script run by Task Scheduler. App never writes to the clone; no app background job. Independent of F1–F4.

## 2. Rules

- No schema change unless F1 proves a ref column is too short (`finance_attachments.storage_ref` and bill `attachment_url` are 500 chars); then one Alembic migration, and say so.
- No S3, Drive API code, background jobs, scheduler inside the app, OCR, or new auth. Distinguish employee bank accounts from company accounts and HR salary payment documents from sales invoices in names and folders.
- Backend authorization is unchanged. Every download path keeps its existing permission check.
- Files and test data are never committed. Tests write only under pytest temp directories.
- Do not modify `deploy/` or CI beyond F5/F6 scope.

## 3. Parallel backend testing (mandatory; do not run the suite serially)

The full backend suite takes about 50 minutes serially and about 7 minutes with `-n 12` (`pytest-xdist` is already in `be/requirements.txt`; `AGENTS.md` documents it). Every existing test uses its own temp database, so workers do not collide.

**Commands** (run from `be/`):
- Targeted, while developing: `python -m pytest tests/<file>.py -q --tb=short -n 4` (add `-n` even for a handful of files; for one small file plain `-q` is fine).
- Full suite, once per slice gate: `python -m pytest tests -q --tb=short -n 12`. If the machine has fewer than 12 cores use `-n auto`.
- Failures only: `python -m pytest tests -q --tb=short -n 12 --lf`, or `--maxfail=10` to stop early on a broken change.
- If a module is flaky only under xdist, retry that module once with `--dist loadfile`, and fix the isolation problem instead of falling back to serial.

**How to save time**
1. **Run the full suite in the background and keep working.** Start it with output redirected to a file (`... -n 12 > /tmp/suite-F2.txt 2>&1`, or `--junitxml`), then use the 7 minutes to write the next slice's tests, docs and runbook text. Check the file when it finishes. Do not sit idle waiting.
2. **Never run two full suites at the same time** (they fight for CPU and cause timeouts). Targeted runs may overlap with each other only if the sum of their `-n` values is at most the core count.
3. **Gate rule:** targeted tests after every edit; the full parallel suite once at the end of each slice (F2, F3, F4 at minimum), not after every edit. F1, F5, F6 need the full suite only once, at the end.
4. **Timing-sensitive tests** such as `test_rbac_latency_benchmark` can fail under load. Re-run those alone, serially, before calling them failures.
5. **F6 (PowerShell script) and docs have no backend tests**; verify them by their own acceptance steps while a backend suite runs in the background.
6. **Frontend:** this feature is expected to be backend-only. If the optional Settings panel is approved, run `npm run build` and Playwright only after the backend suite finishes, never at the same time.

**Writing tests that are safe in parallel**
- The files root is always set per test: `monkeypatch.setenv("HRFLOW_FILES_ROOT", str(tmp_path))` (or the equivalent override in the F1 module). Never write under `be/uploads`, `be/storage`, the repo, or a fixed shared path.
- No module-level state captured at import time (this is why F1 resolves the root at call time). No reliance on test order, on files left by other tests, or on fixed file names.
- Each test creates its own records and DB through the existing fixtures; do not reuse `hrflow_test.db` directly.
- Tests must pass with `-n 12` and also when a single file is run alone.
- Include in the final report the exact full-suite command, worker count, wall-clock time and pass/fail counts.

## 4. Acceptance per slice

As in plan §6, plus: the full parallel suite is green at the end of F2, F3 and F4; dry-run migration writes nothing (assert file and row counts); F6 run twice copies nothing the second time and a file deleted from the root remains in the clone.

## 5. Stop conditions (stop, report, wait for the owner)

- A needed decision is not in plan §8, or the code contradicts a verified fact in the plan (for example claim uploads or payroll exports turn out to be stored).
- Any change would alter permissions, ledger or payroll behaviour, or require a schema change beyond a ref-length migration.
- The full suite fails in areas unrelated to this feature after one targeted retry.
- You are about to touch the owner's uncommitted files or the Drive API/S3.

## 6. End-of-task report

Outcome; files changed; tests run with exact commands, worker counts, durations and results; confirmed facts vs assumptions; decision-log, roadmap and open-question updates needed (new D-number, roadmap section F0–F6, Q-003 scoped to cloud primary storage only, RUNBOOK); and a concise handoff for the next thread.
