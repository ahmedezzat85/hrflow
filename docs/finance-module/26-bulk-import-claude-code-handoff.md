# 26 — Claude Code Handoff: Bulk and Historical Import (I0–I4)

Plan (authoritative): `docs/finance-module/25-bulk-historical-import-plan.md`. Decision: D-033 Accepted by owner, October 20, 2026. Q-021 Resolved (option A: unpaid Drafts). Do not reopen D-016 to D-033. There is no I5. Source documents: PDFs. Bills are printed (some with a text layer, some image-only scans). Cheques are handwritten scans saved as PDFs (no text layer; the least reliable input). Matching a cheque's amount in words against its figures is not required (owner decision). Branch: `feature/bulk-import`, created from `main`.

## 0. Start here

1. The owner's working tree may contain uncommitted edits (deploy/CI files such as `.github/workflows/*`, `deploy/prod/*`, `docs/ci/*`). They are not yours. Never run `git add -A` or `git add .`; stage explicit paths only. Do not stash, reset or revert them. If a `git switch` would conflict with them, stop and tell the owner.
2. `git fetch && git switch main && git pull --ff-only`, then `git switch -c feature/bulk-import`.
3. Read, in order: `AGENTS.md`, `docs/project-context/00-project-start-here.md`, plan 25, decisions D-016 to D-032 (especially D-017, D-019 and D-032), `be/finance/services/bills_service.py` (`upload_drafts`, `create_bill`, the `capture_source`/`is_reviewed` logic near L362), `be/finance/services/bill_extractor.py`, `be/finance/services/cheques_service.py`, `be/finance/services/invoices_service.py`, `be/finance/models.py` (`FinanceAttachmentDB`), `be/storage.py`, `be/finance/services/idempotency.py`, `deploy/prod/nginx/nginx.conf`.
4. Post a branch-intake block: branch, HEAD, merge-base, the Alembic head (`alembic heads`, expected `0040_subscriptions_v2`; use the next free number for the new migration), files you expect to touch, anything in plan 25 §2 that turned out different, and the answers to its "Unknown" rows.
5. Docs-only first commit (owner has approved the plan): copy the plan and this handoff into `docs/finance-module/` as docs 25 and 26; add D-033 (Accepted, Oct 20, 2026) to the decision log, Q-021 (Resolved, option A) to the open questions, and the roadmap section for I0–I4. Then begin I0. Do not wait for approval between slices unless a stop condition below is hit.

## 1. Slices

Work in order I0 → I1 → I2 → I3 → I4. Commit prefix per slice (`I0: …`). Each slice leaves the app working and the full backend suite green. Scope, acceptance criteria and the manifest format are in plan 25 §5–§7; do not restate or alter them without telling the owner.

- **I0** engine, parser, file and ZIP safety (extension and magic bytes), batch table + migration, router skeleton, permissions per kind, limits as constants. No UI.
- **I1** bills importer (dry run + commit). Fix the `is_reviewed` trap for `capture_source = "import"` and every other `upload`/`ocr` special case (backend and frontend: grep `capture_source`). Refactor shared attachment/fingerprint code out of `upload_drafts` only if existing tests stay unchanged. Add the extractor cross-check from plan 25 (I1): for text-layer PDFs, compare `BillPdfExtractor` output with the manifest row and add an `extractor_mismatch` warning only; never override values or block rows; silent for image-only PDFs; no new dependency.
- **I2** Import screen + template downloads + mock-mode handlers + Playwright, including the notice from plan 25 §4 (approving/paying an imported bill or issuing an imported cheque posts a ledger entry, so do it only when the ledger does not already hold that movement).
- **I3** cheques importer (draft cheques only) with the stricter rules from plan 25 (I3): `amount`, `cheque_number`, `issue_date` required for an `ok` row unless flagged in `review_flags`; low-confidence warning (default threshold 0.8, configurable).
- **I4** sales invoices importer; verify invoice scan storage first.
- Optional **I2b** offline pre-check CLI, only if it reuses the I0 module with no duplication.

## 2. Rules

- Import creates Drafts only: no approve, send, issue, pay, void, ledger rows, or new vendors/customers/categories/accounts.
- No HRFlow-side OCR/AI, no background jobs, no new auth scheme, no file-path parameters from callers. (Reading the text layer of a PDF with the existing extractor is already part of the app and is allowed; adding OCR is not.)
- No nginx or other deployment changes. The 25 MB request limit stays; the owner compresses the ZIP copies (plan 25 §10). Enforce the limits as constants and return clear over-limit messages.
- Permissions: bills `finance.bill.write`; cheques `finance.account.write`; invoices `finance.invoice.write`. Backend `require_permission` on every endpoint.
- Dry run must write nothing (assert row counts before/after).
- One file = one document. Use the existing storage/attachment code; stored names are generated, never taken from the ZIP entry name.
- Frontend: D-027 `.fv` scope, no colour literals (`npm run lint:finance-tokens`), `npm run build` in `fe/` before any Playwright run, mock mode updated for every new state.
- Test fixtures are synthetic (generate small PDFs in the tests; include one with a text layer and one image-only). Never commit real scans, manifests or financial data.
- When helping the owner prepare real packages later (plan 25 §10 and §10.1), follow those rules exactly: leave unclear fields blank and flag them, never invent, one bank account per cheque batch, read cheque amounts in figures only (no words-vs-figures check), and keep everything outside the repo.
- Tests: targeted during work; the full `pytest be/tests -q` and the relevant Playwright specs once at the end of each slice.

## 3. Stop and ask the owner only if

- A change alters numbers in any existing report or the behaviour of existing upload/bill tests and the cause is not a bug in new code.
- A decision (D-001 to D-033) conflicts with what the code needs, or plan 25 turns out to contradict the code.
- Staying within the 25 MB limit proves unworkable even with compressed copies (a deployment-file change needs owner approval).
- A migration cannot be reversible.
- Anything points toward creating ledger rows, payments or links to ledger transactions (out of scope; option B would be a new, separately approved slice).

Otherwise use the nearest established repository pattern and continue.

## 4. End-of-slice report (post after each slice, then continue)

Slice ID and commits; files changed (`git diff --stat`); migration id; tests run with exact pass/fail counts; confirmed facts vs assumptions; deviations from plan 25 and why; docs updated (mark the slice Done in the roadmap). After I4: final full regression, push the branch, open a PR to `main` summarising slices, migration, and test results.
