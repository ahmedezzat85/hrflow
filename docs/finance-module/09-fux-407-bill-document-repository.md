# FUX-407 — Bill document storage and repository view

Related: `docs/finance-module/05-finance-ux-implementation-plan.md` (Phase 4, Bill capture), `docs/finance-module/08-fux-406-unified-settlement-linking.md`

## Context

Story 4.1 (Bill capture and AP inbox) added `attachment_url`, `attachment_name`, and `file_fingerprint` fields to `BillDB`, and a document dropzone in the bill capture modal. Direct inspection of the current implementation shows the dropzone captures the file name and computes a client-side fingerprint, but there is no real binary storage (no upload-to-storage call, no `attachment_url` ever actually populated with a retrievable location) and no document preview or download action anywhere in the bill list or detail drawer. The bill capture flow currently simulates OCR extraction confidence for demonstration purposes without persisting the source file at all.

This story is scoped for a specific usage pattern: using Bills primarily as a **searchable vendor-document repository** (one place to find every vendor bill and its original file) rather than as an active approval/payment-tracking workflow. The existing approval, scheduling, and maker-checker machinery from Stories 4.1–4.2 remains available but is not required for this use case — a bill can be created and left in `ready_to_pay` or `paid` status without engaging approval at all.

## High-level scope

1. Add real file storage for bill attachments: upload the actual file (not just its name) to durable storage and persist a retrievable reference in `attachment_url`.
2. Add a document preview and download action wherever a bill is displayed: bill list row action, bill detail drawer, and the edit-bill modal when an attachment already exists.
3. Add a repository-oriented bill list view: a default "All Bills" list optimized for search and document lookup (vendor, bill number, date range, department, has-attachment filter) that does not require navigating through AP-inbox work-queue tabs to find a bill.
4. Preserve all existing approval/payment/duplicate-detection behavior unchanged; this story only adds storage and retrieval, and does not remove or bypass any existing safeguard.

## Implementation level

- Add a file storage backend call (matching whatever object storage or local file storage pattern the application already uses elsewhere, e.g. Document Hub or employee document storage) invoked when a bill attachment is uploaded, returning a durable, permission-checked URL or storage key.
- Update `BillDB.attachment_url` to store the real storage reference instead of remaining unset; keep `attachment_name` for display and `file_fingerprint` for duplicate detection as already implemented.
- Add a `GET /api/finance/bills/{bill_id}/attachment` (or equivalent) endpoint that streams or redirects to the stored file, permission-gated by `finance.bill.read`.
- Add a preview/download button in:
  - The bill list row actions (icon button, visible only when `attachment_url` is set).
  - The bill detail drawer's document/attachment section.
  - The edit-bill modal, showing the currently attached file with a link/preview instead of only the file name.
- Add a "Has attachment" filter and a plain vendor/date/number search to the bill list, independent of the work-queue tab filter, so a document-repository search does not require picking a queue first.
- Ensure re-uploading a new file on an existing bill replaces the stored reference and updates `file_fingerprint`, without breaking duplicate-detection logic for other bills.

## Acceptance criteria

- Uploading a file when creating or editing a bill results in a real, retrievable file, not just a captured file name.
- A bill with an attachment shows a working preview/download action in the list, in the detail drawer, and in the edit modal.
- A bill without an attachment shows no broken or misleading preview control.
- Searching or filtering bills by vendor, number, date, or department works without first selecting a work-queue tab.
- Existing approval, payment, scheduling, and duplicate-detection behavior from Stories 4.1 and 4.2 is unaffected by this change.
- Unauthorized users cannot retrieve a bill attachment they do not have permission to view.

## Verification plan

- Upload a real PDF/image when creating a bill; confirm the stored reference is retrievable after the browser session ends (not just held in client memory).
- Open the bill detail drawer and edit modal for a bill with an attachment; confirm the preview/download control works in both places.
- Confirm a bill created without an attachment shows no broken preview element.
- Run the existing Story 4.1 and 4.2 backend and Playwright suites in full to confirm no regression in duplicate detection, review-gating, approval, or payment behavior.
- Test attachment retrieval with an unauthorized session/role and confirm access is denied.
- Search the bill list by vendor name and by bill number without selecting any work-queue tab, and confirm correct results.
