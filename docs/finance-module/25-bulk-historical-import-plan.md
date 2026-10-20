# 25 — Bulk and Historical Import: Plan (Bills, Cheques, Sales Invoices)

**Status:** **Approved by owner, October 20, 2026.** D-033 accepted; D-032 reading confirmed; Q-021 resolved (option A); upload-size approach chosen (compressed ZIP copies, no nginx change). Amended the same day: source documents are **PDFs** — **bills are printed documents; cheques are handwritten scans saved as PDFs**; the owner decided that matching the amount in words against the amount in figures on cheques is **not needed**. See §2, §5, I1, I3 and §10.
**Baseline:** `main` at `c416271` (Alembic head seen on disk: `0040_subscriptions_v2`; Finance Expansion X1–X6 is on `main`). The working tree had uncommitted deploy/CI edits when this was written. Treat them as the owner's, do not touch them. **Re-verify all of this in the branch-intake step.**
**Replaces:** the "Later: Bulk and historical bill import" line in roadmap §3B (D-019 deferred it to "a separate plan"; this is that plan).

---

## 1. Purpose and decision of approach

The owner has a backlog of old documents (vendor bills, cheques, sales invoices) saved as **PDFs**: bills are printed; cheques are **handwritten** scans. The owner does not want to type them. An MCP server was considered and **rejected for now** as disproportionate (public endpoint, auth, hosting from a PC, ongoing exposure of finance data) for what is a one-time backlog. It can be revisited later and would reuse the import engine built here.

**Approach**
1. **Reading is done outside HRFlow**, by Claude Code on the owner's machine: it reads the PDFs and writes a **manifest** (CSV/XLSX, one row per document) plus a **ZIP of the PDFs (compressed if needed)**. The owner reviews them.
2. **HRFlow receives an upload**, not a path: manifest + ZIP on a new Finance **Import** screen, with the owner's normal Google login and RBAC. No API token, no server-side path reading, no new auth.
3. **Dry run first** (validate, write nothing, return a per-row report), then **commit**, which creates **Draft** records with the document attached. Nothing is approved, sent, issued or posted to the ledger by the import.
4. The owner reviews drafts in the existing workflows.

Why not a server path: production runs in Docker, so a host path does not exist there, and an endpoint that opens caller-supplied paths is a path-traversal risk that also bypasses RBAC and audit.

## 2. Verified facts, assumptions, unknowns

| Item | State | Evidence / note |
|---|---|---|
| Bill drafts from PDF/photo uploads, vendor match, never auto-create vendor, SHA-256 duplicate check | **Implemented** (D-019) | `BillsService.upload_drafts`, `check_duplicates`, `file_fingerprint`; `.pdf` is an allowed extension |
| In-app PDF reading | **Implemented, text layer only** | `BillPdfExtractor` (pypdf + heuristics). Image-only scanned PDFs return `is_readable = false`; **HRFlow does no OCR** (no external service). |
| Whether the owner's bill PDFs have a text layer | **Unknown** | Mixed is likely (digital bills vs. scanned). The pilot will show; the plan works for both. |
| Cheque PDFs | **Known: handwritten scans** | Never have a usable text layer. Reading them is the least reliable part of this work; see I3 and §10.1. |
| Bill fields for provenance: `capture_source`, `extraction_confidence`, `missing_fields`, `suggested_vendor_name`, `vendor_to_confirm`, `is_reviewed` | **Implemented** | `be/finance/schemas.py` BillBase, `BillDB` |
| `capture_source` max 20 chars; comment says `manual | upload | ocr` | **Implemented** | **Trap:** `bills_service.py` ~L362 sets `is_reviewed = capture_source not in ("upload","ocr")`. A new value `import` would wrongly count as reviewed. Must be handled in I1. |
| Cheque scans via `finance_attachments.cheque_id`; cheque `draft` status; cheques post at issue | **Implemented** (D-032, migration 0036) | `ChequeCreate.status = draft|issued` |
| Cheque extraction by an in-app OCR/AI service | **Not allowed** (D-032) | This plan adds none. HRFlow only receives typed values from a file the owner reviewed. **Owner confirmed this reading on Oct 20, 2026.** Note: D-032's rationale was that free local OCR cannot read handwritten cheques reliably; Claude reading outside the app is a different tool, but handwriting accuracy is still the risk, hence the 100% human check in §10.1. |
| Sales invoice scan storage | **Unknown / likely missing** | `finance_attachments` has no `sales_invoice_id` column. Verify; I4 adds it if needed. |
| Idempotency helper | **Implemented** | `be/finance/services/idempotency.py` (header-based) |
| Upload size limit | **Constraint, kept** | `deploy/prod/nginx/nginx.conf`: `client_max_body_size 25m`, `proxy_read_timeout 120s`. **Owner chose to keep it** and compress the ZIP copies instead. |
| Background jobs / queues | **None** | Import must be synchronous and batched. |
| Historical documents already paid | **Resolved** (Q-021, option A) | Imported as unpaid Drafts; see §4 for the consequence. |
| Cashbook 2026 import done in prod | **Unknown** | Roadmap named it a prerequisite for B3. Determines how risky approving historical bills is (§4). |

## 3. Decision D-033 — Accepted by owner, October 20, 2026

**D-033 — Bulk Import via Manifest + ZIP Upload; Drafts Only**
- Import is an authenticated upload of a manifest and a ZIP through the HRFlow UI. HRFlow never reads caller-supplied filesystem paths.
- Import creates only Draft bills, draft cheques and Draft sales invoices. It never approves, sends, issues, pays, posts ledger rows, or creates vendors/customers.
- Provenance is recorded on every created record (`capture_source = import`, batch id, source file, confidence, review flags). Imported bills start `is_reviewed = false`.
- Permissions mirror the target entity: bills `finance.bill.write`, cheques `finance.account.write` (as D-032), invoices `finance.invoice.write`. No new permission.
- No external OCR/AI service is called by HRFlow. Reading of the documents happens outside the app (owner confirmed this is consistent with D-032).
- The ZIP carries compressed copies of the documents where needed so that batches fit the existing 25 MB request limit; originals stay on the owner's machine.

## 4. Q-021 — Resolved: option A (unpaid Drafts)

**Question:** how are historical documents that were already paid recorded?
**Decision (owner, Oct 20, 2026):** import them as unpaid Drafts; the owner records payments through the normal app workflow.

**Consequences to keep visible (not blockers):**
- Drafts do not count as money owed (D-017: only Approved, Scheduled and Partially paid do), so a pile of imported Drafts does not distort AP aging or the cash forecast.
- If the owner later **approves** an imported historical bill, it counts as owed until paid; **recording a payment posts a ledger outflow and lowers the account balance.** If the cashbook import already holds that money movement, the balance is counted twice. The owner accepts this and will approve/pay an imported bill only when the ledger does not already hold the movement.
- The same applies to imported cheques: a draft cheque posts to the ledger when it is issued (`posting_policy = at_issue`), so the owner should issue an imported historical cheque only when the cashbook does not already hold it.
- The Import screen shows a short notice with this warning (I2). The batch id lets the owner list or discard a batch's untouched Drafts.
- Option B (link a historical document to an existing ledger transaction, as D-019 foresaw) stays available as a **future** slice if double posting becomes a real problem. It is not part of this plan, and there is no I5.

## 5. Manifest format (v1)

One manifest per import run, one document **kind** per run (`bills`, `cheques`, `invoices`), chosen on the Import screen. CSV (UTF-8 with BOM accepted) or XLSX (first sheet). Header names are exact, lowercase. Dates are ISO `YYYY-MM-DD` (no day/month guessing). Amounts are plain decimals with `.`. Filenames in the ZIP should be ASCII (e.g. `bill-0001.pdf`) to avoid ZIP encoding problems; matching is exact, case-insensitive on the base name.

**One file = one document.** A multi-page PDF is fine (for a cheque, front and back in one PDF is expected), but a PDF that contains several separate bills or cheques must be split into one PDF per document **before** packaging (Claude Code can do this locally).

**Common columns:** `row_ref` (unique, e.g. `B-0001`), `source_file` (name inside the ZIP, may be empty), `confidence` (0–1, optional), `review_flags` (free text, optional), `notes` (optional).

**bills:** `vendor_name`, `bill_number`, `issue_date`, `due_date`, `currency`, `category`, `total_amount`, `description` (becomes one line "description × 1 × total_amount"; multi-line is a later extension).
**cheques:** `account` (bank account name or id), `cheque_number`, `payee`, `amount`, `currency`, `issue_date`, `notes`. Created as `draft`.
**invoices:** `customer_name`, `invoice_number`, `issue_date`, `due_date`, `currency`, `description`, `amount`, `vat_rate` (optional).

**Rules:** blanks are allowed where a Draft allows them and are listed in `missing_fields`; the importer never guesses. Unknown vendor/customer/category/account: the row is imported with the field empty, `vendor_to_confirm`/`suggested_vendor_name` set (bills), and a warning in the report. Nothing is created in master data.

## 6. Dry run and commit

- Single endpoint pair per kind, e.g. `POST /api/finance/imports/{kind}/dry-run` and `POST /api/finance/imports/{kind}` (multipart: `manifest`, `archive`). The commit re-validates the same files (no server-side staging area, no new server state between the two calls); the UI keeps the files in memory between steps.
- **Report per row:** `ok | warning | error | duplicate`, with messages. Duplicate checks: SHA-256 file fingerprint (bills), (vendor, bill_number) (bills), (account, cheque_number) (cheques), (customer, invoice_number) (invoices), and repeated `row_ref`/`source_file` inside the manifest. Also: totals `<= 0`, bad dates, unknown currency, manifest rows whose `source_file` is not in the ZIP, ZIP files referenced by no row (warning).
- **Commit semantics:** each row is its own transaction; one bad row never blocks the batch. The response lists created record ids and per-row failures. Re-committing the same package is safe because duplicates are detected.
- **Batch record:** a `finance_import_batches` table (id, kind, created_by, created_at, manifest_name, archive_name, rows_total, rows_created, rows_failed) and a nullable `import_batch_id` on bills, cheques and invoices, so a batch's still-untouched drafts can be listed or discarded together. This is the only migration planned (`0041_import_batches`, confirm number at branch intake).
- **Limits (configurable constants; nginx is not changed):** 50 documents per run, 24 MB per request (nginx allows 25 MB, timeout 120 s), 10 MB per file. Over-limit requests fail with a clear message that tells the user to split the batch or compress further. With the preparation procedure (§10) most PDFs should be a few hundred KB, so 50 documents fit; heavy scanned PDFs may force smaller batches.
- **File safety:** allow only `.pdf .png .jpg .jpeg .webp .heic`; verify content type by magic bytes, not just extension (a PDF must start with `%PDF`). ZIP: reject entries with absolute paths, `..`, symlinks or nested archives; cap total uncompressed size and entry count (zip-bomb guard); never extract to disk by entry name, always store via the existing attachment storage with a generated unique name.
- **Audit:** use existing audit hooks (bills `_audit("created", …, "imported from batch N row R")`; equivalents for cheques/invoices) so imported records appear in the activity timeline.

## 7. Slices (strict order, each independently reviewable)

Branch: `feature/bulk-import` from `main`. Commit prefix per slice (`I0:` …). Full backend suite green at the end of each slice.

### I0 — Import engine and batch model (no UI)
Shared module under `be/finance/` (suggested `services/import_service.py` plus a manifest parser module and `routers/imports.py`; follow nearest pattern): manifest parsing (CSV/XLSX), ZIP validation, report model, batch table + migration `0041`, router skeleton registered in `be/main.py`, permission checks by kind, config constants. Pure functions are unit-tested without a database where possible.
**Acceptance:** parsing and ZIP-safety tests (path traversal, bad types, magic-byte mismatch, bomb limits, duplicate refs, encoding/BOM, XLSX and CSV); migration upgrades and downgrades; unauthorized and wrong-permission callers get 401/403 per kind; over-limit requests are refused with the documented message.

### I1 — Bills importer
Dry run and commit for `bills`. Reuse `BillsService`/repository rules; extract a shared helper from `upload_drafts` for attachment saving and fingerprinting rather than duplicating it, **keeping existing upload behaviour and tests unchanged**. Set `capture_source = "import"`, `is_reviewed = false`, provenance fields, `import_batch_id`. Fix the `is_reviewed` trap (§2) and any other place that special-cases `upload`/`ocr` (grep `capture_source` and the frontend).
**Extractor cross-check (warning only):** for a PDF that has a text layer, run the existing `BillPdfExtractor` during the dry run and compare its bill number, total and dates with the manifest row. A mismatch adds an `extractor_mismatch` **warning** to the report. It never overrides manifest values, never blocks the row, adds no new dependency, and is skipped silently for image-only PDFs. This gives a free second opinion on the transcription.
**Acceptance:** dry run writes nothing (row counts before/after equal); commit creates Drafts with the PDF attached; vendor never created; weak/unknown vendor flagged; duplicate fingerprint and duplicate (vendor, number) rejected; imported bills show `is_reviewed = false` and appear in the existing review/queue views; one bad row does not block others; idempotent re-commit; cross-check warns on a deliberately mismatched synthetic text-layer PDF and stays silent for an image-only one; existing `test_finance_bill_drafts`, `test_finance_bill_attachments`, `test_finance_bill_extraction` and `test_finance_bills*` still pass.

### I2 — Import screen (frontend, bills first)
Finance **Import** page (Finance Settings area or nearest established pattern; D-027 `.fv` styling, no colour literals, run `npm run lint:finance-tokens`). Steps: choose kind → choose manifest + ZIP → Dry-run report table (filter by status, download report CSV) → Commit → result with links to created drafts and batch id. API wrapper in `fe/api/finance/` (e.g. `imports-api.js`) and mock-mode handlers in `fe/finance-api.js`. A downloadable **template manifest** per kind. A visible **notice** on the page carrying the §4 warning (imported historical documents stay Drafts; approving/paying a bill or issuing a cheque posts a ledger entry, so do it only when the ledger does not already hold that movement).
**Acceptance:** `npm run build` clean; Playwright spec for dry run → commit with a small synthetic fixture package; errors rendered per row; the notice is shown; user without the permission cannot see or use the page (backend still enforces).

### I3 — Cheques importer
Draft cheques with the handwritten-scan PDF attached via the `cheque_id` attachment path. Resolve `account` by exact name or id. Never set status beyond `draft`. Respect the next-number/uniqueness rules per account. Because handwriting is the weakest input, the importer is stricter than for bills: `amount`, `cheque_number` and `issue_date` are **required for a row to be `ok`**; a row missing any of them is an `error` unless the manifest flags it in `review_flags` (then it imports as a draft with a visible warning for the owner to complete). Rows with `confidence` below a configurable threshold (default 0.8) get a warning.
**Acceptance:** drafts created with `has_scan = true`; duplicate (account, number) rejected; bad account rejected; missing required fields produce the documented error/flagged-warning behaviour; low-confidence rows warn; no ledger rows created (assert ledger count unchanged).

### I4 — Sales invoices importer
Draft invoices. **Verify** whether an invoice scan can be stored; if not, add `sales_invoice_id` (nullable FK, CASCADE) to `finance_attachments` in the same `0041` migration (or `0042` if I0 already shipped) plus download endpoint following the cheque/bill pattern. Customer matched by exact name; never created.
**Acceptance:** drafts created, status `draft`, no payments or ledger rows; attachment downloadable with the invoice read permission.

### Optional I2b — Offline pre-check
A small CLI that runs the same manifest parser and file validation locally so Claude Code can validate a package before the owner uploads it. Only if it reuses the I0 module with no duplication.

*(There is no I5: Q-021 was resolved as option A, which needs no extra slice.)*

## 8. Rules that must not be broken

- D-016 to D-032 stay in force: status models, settlement service for payments, same-currency ledger entries, cash-basis rules, D-027 styling.
- No background jobs, scheduler, email, external OCR/AI, bank APIs, S3, or new auth scheme.
- Imported files and manifests are **financial data: never commit them to git.** Working folder outside the repo, e.g. `D:/services/hrflow-import/<batch>/`.
- Ledger rows are never deleted for corrections; the import creates none.
- Backend authorization on every new endpoint (`require_permission`); frontend visibility is not authorization.
- Mock mode updated for every new visible state.

## 9. Owner confirmations (all given October 20, 2026)

1. D-033 as written: accepted.
2. D-032 reading (typed cheque values from a reviewed file are acceptable; HRFlow extracts nothing): confirmed.
3. Upload size: keep the 25 MB nginx limit; ZIP carries compressed copies.
4. Q-021: option A, unpaid Drafts (consequences in §4).
5. Source documents are PDFs: bills printed, cheques handwritten scans — informs §5, I1, I3 and §10.
6. Cheque amount in words vs figures matching: **not required** (owner decision); Claude Code reads the figures only.

## 10. Operating procedure for preparing a package (owner + Claude Code, outside the repo)

1. Put the **original** PDFs in `D:/services/hrflow-import/<batch>/originals/` and keep them untouched.
2. Create `scans/` with copies renamed to ASCII (`bill-0001.pdf`, `chq-0001.pdf`). Split any PDF that contains more than one document into one file per document. For a PDF over about 500 KB, make a compressed copy locally (for example Ghostscript `-dPDFSETTINGS=/ebook`, or re-rendering image pages at about 150 dpi JPEG quality 75–80); check that the compressed copy is still readable, and fall back to the original if it is not and the size still fits the 10 MB per-file limit. Digital PDFs with a text layer are usually small already and should be copied as they are. For handwritten cheques do not compress below the point where the handwriting stays clearly legible (the owner may have to open the attachment later).
3. Ask Claude Code to read the **originals** (it reads PDFs page by page, up to 20 pages per request) and write `manifest.csv` for one kind, transcribing only what is legible and leaving a field **blank** when unsure (never invent), filling `confidence` and `review_flags` honestly, and checking line totals against the stated total.
4. Review the manifest in Excel against the PDFs; keep batches to at most 50 documents (fewer if the ZIP exceeds about 22 MB).
5. Zip the `scans` folder, open the Import screen, run **Dry run**, fix (including any `extractor_mismatch` warnings), then **Commit**.
6. Review the resulting Drafts in the normal bill/cheque/invoice screens, keeping §4 in mind before approving, paying or issuing any of them.
7. Start with a pilot of 10–15 documents per kind to measure how many fields need correction before scaling up.

### 10.1 Extra rules for handwritten cheques

- **One bank account per batch.** The owner tells Claude Code which account the batch belongs to, and every row gets that `account`. This avoids guessing the account from a stamp.
- **Fields to transcribe:** cheque number, issue date, payee and amount in figures. The cheque number is often printed and is usually the most reliable field. The amount in words is **not** read or compared (owner decision).
- **Unclear values:** if the amount, a digit, or the date is unclear, leave that field **blank**, set a low `confidence` and write the reason in `review_flags`. Never guess. Dates are ISO; if day/month order is unclear on the cheque, leave blank.
- **Arabic handwriting** (payee names) is less reliable than digits; expect more flags there.
- **100% human check for cheques.** For printed bills a sample check after the pilot may be enough. For handwritten cheques the owner compares **every** row's amount, number and date against the PDF before upload, and again when reviewing the Drafts, since there is no second source to catch a misread amount. The pilot (10–15 cheques) decides how much to trust the rest.

## 11. Documentation updates this work requires

- `04-decision-log.md`: add D-033 (Accepted by owner, October 20, 2026).
- `06-open-questions.md`: add Q-021 as **Resolved** (option A, consequences as in §4). If I4 finds invoice scan storage missing, record that as a normal implementation finding, not an open question.
- `05-roadmap-and-next-slices.md`: new section for slices I0–I4 (+ optional I2b); replace the "Later: Bulk and historical bill import" row with a pointer to it; note option B as a possible future slice.
- `docs/finance-module/`: this plan as `25-bulk-historical-import-plan.md`, handoff as `26-bulk-import-claude-code-handoff.md`.
