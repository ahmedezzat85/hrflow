# 26 — Feature Plan: Configurable File-Storage Root and Standard Folder Layout

**Status:** Owner decisions recorded 2026-10-21 (§8); ready for F1 once the owner approves starting. Nothing implemented. No repo files were changed.
**Intake:** read-only pass on `feature/pay-plan-sync` @ `9ff2486` (working tree has the owner's uncommitted compensation-plan edits, untouched). Merge-base not computed. Implement on a fresh branch from `main`. Re-verify everything marked *Implemented* in the branch-intake step.
**Related:** Q-003 (production document-storage direction, open), D-032 (cheque scans), D-033 (bulk import), `deploy/prod/RUNBOOK.md`.

---

## 1. Problem

Files are written to several unrelated places, with different naming, and only some of them are browsable by a human. The owner wants **one configurable root directory** and a **predictable folder structure** under it for bills, invoices, cheques, salary payment documents and everything else.

## 2. Verified current state (read from code)

| Area | Where files go today | State |
|---|---|---|
| Employee documents | `StorageClient` (`be/storage.py`), local backend: `<LOCAL_STORAGE_PATH>/employees/<id> - <name>/<file>` | Implemented |
| Company documents | `<LOCAL_STORAGE_PATH>/Company Documents/<file>` | Implemented |
| HR salary payment docs | `<LOCAL_STORAGE_PATH>/Invoices/<yyyy>/<yyyy-mm>/<file>` (.docx + .pdf) | Implemented. **Name clash:** the folder is called "Invoices" but these are HR salary payment documents, not Finance sales invoices |
| Vendor bill files | `BILL_UPLOADS_DIR` (default `be/uploads/finance_bills`), flat, generated names; `attachment_url` is sometimes absolute, sometimes relative | Implemented |
| Cheque scans, sales-invoice scans, statement files, subscription proofs, ledger attachments | `FINANCE_UPLOADS_DIR` (default `be/uploads/finance_attachments`), flat, `<uuid>_<name>`; path kept in `finance_attachments.storage_ref` | Implemented (writers in accounts, cheques, invoices importers, subscriptions services) |
| Production | Container is read-only; `LOCAL_STORAGE_PATH=/data/documents`, `BILL_UPLOADS_DIR=/data/documents/finance_bills`, `FINANCE_UPLOADS_DIR=/data/documents/finance_attachments`; backup script already covers `data/documents` | Implemented |
| Google Drive backend | `FILE_STORAGE_BACKEND=drive` still supported; future direction is Q-003 | Implemented / open |
| Employee claim attachments, payroll run exports, generated Excel exports | Location | **Unknown** — check in intake |

Consequence: two upload roots plus the `StorageClient` root, three env vars, mixed absolute/relative refs, UUID names nobody can read, and a mislabelled "Invoices" folder.

## 3. Goals and non-goals

**Goals:** one root setting; one layout; refs in the database that stay valid when the root moves; human-browsable folders; safe against path traversal; a migration for existing files; backup keeps working.
**Non-goals:** S3 or any new cloud store (Q-003 stays open), background jobs, OCR, a UI to browse files, changing what is stored in the database beyond `storage_ref` format.

## 4. Proposed directory structure

`<ROOT>` is the one configured directory. In production the container sees it as `/data/documents`; the host folder behind it is the owner's choice.

```
<ROOT>/
├─ _meta/
│  ├─ layout.json                         {"layout_version": 1}  (written once; lets future versions migrate)
│  └─ README.txt                          "Managed by HRFlow. Do not rename or move files; the database points here."
│
├─ hr/
│  ├─ employees/
│  │  └─ <employee_id>-<name-slug>/       id first and immutable; slug is cosmetic and is NOT renamed later
│  │     ├─ documents/                    contracts, IDs, general uploads
│  │     ├─ claims/<yyyy>/                claim attachments (RESERVED/planned: no claim upload code exists yet, only `document_url`)
│  │     └─ bank-account-proofs/          EMPLOYEE bank account evidence (never mixed with company accounts)
│  ├─ salary-payment-docs/                HR salary payment documents (NOT sales invoices)
│  │  └─ <yyyy>/<yyyy-mm>/                <doc_number>__<employee_id>-<slug>.docx / .pdf
│  └─ company-documents/                  policies, templates, general company files
│
├─ finance/                               YEAR IS THE OUTERMOST LEVEL (owner decision 8)
│  ├─ <yyyy>/                             e.g. 2026; share or archive a whole year as one folder
│  │  ├─ bills/<yyyy-mm>/                 bill-<id>__<vendor-slug>.pdf
│  │  ├─ sales-invoices/<yyyy-mm>/        inv-<id>__<customer-slug>.pdf  (invoice scans / copies)
│  │  ├─ cheques/<account-folder>/        chq-<number>__<att_id>.pdf  (front/back/stamp = several files)
│  │  ├─ statements/<account-folder>/     <yyyy-mm>__<att_id>.<ext>
│  │  ├─ subscriptions/<subscription-id>-<slug>/     <charge-date>__proof-<att_id>.<ext>
│  │  ├─ ledger-attachments/<yyyy-mm>/    txn-<id>__<att_id>.<ext>
│  │  ├─ balance-checkpoints/<account-folder>/
│  │  └─ payroll/<yyyy-mm>/               RESERVED/planned: portal confirmations etc. Payroll CSV and Excel exports are streamed to the browser today and not stored, so no folder is created in v1
│  └─ imports/<batch-id>/                 NOT year-specific, so outside the year folders: bulk-import archive (D-033), only if the batch is retained
│
└─ _incoming/                             temp area for in-flight uploads (write here, then atomic rename)
```
`<account-folder>` is the COMPANY bank account folder (never an employee account): `<id>-<bank_name slug>-<currency>` for bank accounts, e.g. `7-cib-usd`; for cash accounts (no bank name) `<id>-<account_name slug>`, e.g. `2-cash-egp`. The id is `finance_bank_accounts.id` (unique, immutable); the account number is never used in folder names. The folder name is fixed when first created and not renamed if the account is edited.
Month folders are kept only under bills, sales invoices and ledger attachments (highest volume). Cheques, statements and subscriptions are grouped by company account or subscription inside the year.
Salary payment documents stay in `hr/` (decision 8b), so sharing a finance year never includes salary data.
No `_trash/` (hard delete, decision 5) and no `exports/` (exports are not stored, verified).

Why these choices
- **Domain split mirrors the architecture rules:** `hr/` and `finance/` are separate subtrees; employee bank-account proofs live under `hr/`, company-account material under `finance/`; salary payment docs are `hr/salary-payment-docs`, sales invoices `finance/sales-invoices`.
- **Entity folders carry the numeric id first** (`12-acme-supplies`), so a rename never breaks anything and sorting stays stable.
- **Cheques, statements, checkpoints group by company account** because that is how they are looked up; **bills, invoices, ledger attachments group by year/month** because volumes are higher and people browse by period.
- **Finance is year-first** (`finance/<yyyy>/<type>/…`): one folder per year to share with an accountant or auditor, archive or zip.
- **Few levels, no vendor or customer folders:** vendor and customer names change and would create thousands of folders.

## 5. Rules

1. **Single setting `HRFLOW_FILES_ROOT`.** It replaces `LOCAL_STORAGE_PATH`, `BILL_UPLOADS_DIR`, `FINANCE_UPLOADS_DIR` for the local backend. Old variables are still read as a fallback and logged as deprecated; if only they are set, the root defaults to `LOCAL_STORAGE_PATH`, so nothing breaks on upgrade.
2. **Root is environment configuration, not a UI field.** The container is read-only and an editable server path is a traversal and RBAC risk. Settings may show the root, free space and a writable check read-only.
3. **Database stores root-relative POSIX refs** (`finance/bills/2026/2026-09/bill-123__acme.pdf`), never absolute paths. Moving the root then means moving the folder and changing one setting.
4. **Path is decided once, at write time, and never recomputed.** The year (and month) uses the document date when it is known at save: bill date, invoice date, cheque issue date, statement period, subscription charge date. Otherwise it uses the upload date. So a bill dated December 2025 and uploaded in January 2026 goes under `finance/2025/`. Later edits to the date, vendor, customer or employee name do not move files. This keeps DB refs stable and avoids rename races.
5. **File names are generated:** `<prefix>-<record id>__<ASCII slug>.<ext>` or `<att_id>`; the user's original name stays in `finance_attachments.file_name`. Never use a ZIP entry name or client name as a path. For attachments, insert the row and flush to get `att_id`, write to `_incoming/`, then rename into place.
6. **Windows-safe:** the host is Windows. ASCII lowercase slugs, no reserved names (`CON`, `NUL` …), no trailing dot or space, slug ≤ 40 chars, total relative ref ≤ 200 chars.
7. **All access through one module** that resolves refs with the existing traversal guard (`_resolve_secure_path` logic), rejects `..`, absolute refs, symlink escapes, and checks the resolved path is under the root.
8. **Reads fall back to legacy locations** (old absolute paths, `finance_bills/`, `finance_attachments/`) until the migration has run, so a half-migrated system still serves every file.
9. **Files are financial and personal data:** the root is outside the git repo and never committed; backups already include `data/documents` and must keep doing so wherever the root points (the backup script reads the host folder, so verify it follows the new setting).

## 6. Implementation slices (small, independently reviewable)

| Slice | Content | Acceptance |
|---|---|---|
| **F0** | Owner answers §8; add decision D-0xx and close or link Q-003 scope | Decision recorded |
| **F1** | `file_layout` module: setting, `build_ref(kind, **ctx)` pure function, `save/open/delete/exists`, slug and length rules, legacy fallback resolver, `_meta/layout.json`. No existing writer changed | Unit tests: every kind's ref, traversal and symlink attempts rejected, Windows-reserved names, long names truncated, legacy absolute and bare refs resolve |
| **F2** | Switch Finance writers (bills, cheques, sales invoices + importers, statements, subscription proofs, ledger attachments, checkpoints) to F1; new files only | Existing finance suite green; new upload lands in expected folder; `storage_ref` relative; download and delete work for old and new refs |
| **F3** | Switch HR writers (salary payment docs → `hr/salary-payment-docs`, employee docs, company docs) through `StorageClient` local backend; Drive backend untouched | HR suite green; regenerated salary doc lands in new folder; old docs still downloadable |
| **F4** | Migration CLI `scripts/migrate_file_layout.py`: **dry run by default**, copy → verify SHA-256 → update `storage_ref` in one transaction → remove old file; idempotent; per-file report CSV; refuses if target exists with different hash | Dry run writes nothing (file and row counts asserted); re-run is a no-op; rollback = restore the pre-upgrade backup (RUNBOOK) |
| **F5** | Config and ops: prod `docker-compose.yml` and `.env` use one setting (host folder becomes the owner's choice), RUNBOOK section "Moving the files root", read-only Settings status panel | Move test: stop app, move folder, change setting, start; all downloads work |
| **F6** | **Drive clone (decision 4):** extend `deploy/prod/scripts/backup.ps1` (or a sibling script) with a one-way, additive copy of `<ROOT>` into a Google Drive for Desktop folder (new setting, e.g. `FILES_CLONE_DIR`), same hierarchy, run by Windows Task Scheduler next to the database backup. The app never writes to the clone and no app background job is added | Run twice: second run copies nothing; a file deleted from the root stays in the clone; clone tree equals root tree; script failure is logged and does not touch the root |

Order F1 → F2 → F3 → F4 → F5 → F6; F4 must run only after a fresh encrypted backup. F6 is independent of F1–F4 and can run earlier against the current folders.

## 7. Risks

- **Half-migrated state** if F4 is interrupted → mitigated by legacy fallback and per-file transactional updates.
- **Orphans:** DB row deleted but file left (existing behaviour); F4 report lists files on disk with no DB row, and DB rows with no file, without deleting anything.
- **Path length on Windows** → ref cap and short root recommended (e.g. `D:/services/hrflow-prod/data/documents`).
- **Names in folders** (`employees/<id>-<name>`) expose employee names to anyone with OS access; this matches today's behaviour. Id-only folders are possible (open question 6).
- Bulk import (D-033) writes through the same module once F2 lands; no change to its rules.

## 8. Owner decisions (2026-10-21) — F0 gate cleared

1. **Period key:** document date when known at save, else upload month; frozen after write.
2. **Renames/edits:** files stay in place; no reorganise tool.
3. **Root configuration:** environment only; Settings shows it read-only.
4. **Google Drive:** not a storage backend for this feature. Drive is a **backup clone**: the app writes once, to the local root; a scheduled script copies the root with the same hierarchy into a Google Drive for Desktop folder, in addition to the scheduled database backup. 4b: **additive only**, deletions never propagate to the clone. Q-003 stays open for cloud *primary* storage and is not decided by this.
5. **Deletes:** hard delete, as today (the additive clone may still hold a copy).
6. **Employee folders:** `<id>-<name-slug>`.
7. **Verified in code:** payroll CSV and Excel exports are streamed, not stored; claim uploads do not exist yet (`document_url` text only). `claims/` and `payroll/` are reserved, not created in v1.

8. **Finance is year-first:** `finance/<yyyy>/<type>/…`, as in §4 (reason: easy tracking, and sharing or archiving a whole year as one folder). 8b: **HR salary payment documents stay `hr/salary-payment-docs/<yyyy>/<yyyy-mm>/`** (owner chose not to make HR year-first).

9. **Account folder name:** `<id>-<bank-slug>-<currency>` (cash accounts: `<id>-<account-name-slug>`); id = `finance_bank_accounts.id`.

Remaining owner confirmation: approve starting F1 on a new branch from `main`.

## 9. Handoff summary

- Goal: one `HRFLOW_FILES_ROOT`, layout version 1 as in §4, root-relative refs, legacy fallback, migration CLI, scheduled additive Drive clone (F6).
- Start at F1 once the owner approves. No schema change is expected (`storage_ref` and `attachment_url` stay strings); confirm in F1 whether any column is too short for the longest ref (500 chars on `finance_attachments.storage_ref`, same on bill `attachment_url`).
- Updates required when accepted: decision log (new D-number), roadmap (new section for F0–F5), open-questions (Q-003 scoped to "cloud backend only"), RUNBOOK (F5).
