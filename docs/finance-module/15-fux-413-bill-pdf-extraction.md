# FUX-413 — Genuine bill PDF/document field extraction

Related: `docs/finance-module/09-fux-407-bill-document-repository.md` (bill document repository), FUX-401 AP inbox and capture (capture_source, extraction_confidence, missing_fields), Phase 4 Spend and Payables

**User story:** As an AP user, I want uploading a bill PDF to extract the real vendor, dates, amount, and line items from the document, so I don't have to manually re-type data the file already contains, and so I can trust that what I see reflects the actual document rather than placeholder values.

## Context

The bill model already carries `capture_source` (`manual | upload | ocr`), `extraction_confidence`, and `missing_fields` columns, and the AP Inbox workflow (FUX-401) is explicitly designed around review-required capture: uploaded bills are routed into a review queue rather than becoming payable immediately. However, the reported symptom — uploaded bills consistently showing "dummy data" for amount and other fields — indicates the current upload path does not perform genuine document text/field extraction; it appears to populate the record without actually reading the PDF's content, undermining the purpose of upload-based capture. The FUX-401 human-review requirement stays in place regardless of extraction quality; this story only concerns making the *extracted starting values* real instead of fabricated.

## High-level scope

1. Replace the current upload handling so that a genuine parsing step runs against the uploaded PDF: extract raw text, then extract structured fields (vendor name, bill number, issue date, due date, subtotal, tax amount, total, currency, and line items where identifiable).
2. Use a rules/regex-first extraction pass over the extracted text as the initial approach (labels like "Total", "Due Date", "Invoice #", currency symbols, date patterns), rather than committing immediately to a full ML/OCR service, since this is proportionate to the scope of the fix.
3. Record confidence per document (and per field where feasible) and populate `missing_fields` with any field the parser could not extract with reasonable confidence — never fill an unrecovered field with a fabricated or default value.
4. Detect image-only/scanned PDFs with no extractable text layer and flag these explicitly as "Unreadable — Manual Entry Required" instead of silently returning blank or placeholder fields.
5. Keep every uploaded bill routed through the existing Needs Coding / Needs Approval review flow (FUX-401) regardless of extraction confidence — extraction only pre-fills the form; it never bypasses human confirmation before a bill becomes payable.
6. Surface per-field (or overall) confidence visibly in the bill review screen so reviewers know which fields to double-check versus which are already reliable.

## Implementation level

- Add a document text-extraction step in the bill upload pipeline: extract embedded text from the PDF (most invoice/bill PDFs are text-based, not scanned images); if no text layer is found, skip straight to the "Unreadable" path.
- Implement field extraction as a set of targeted patterns/heuristics over the extracted text: currency-aware amount detection (handling thousands separators and multiple currency symbols), date pattern matching for issue/due dates, label-adjacent value capture for vendor name and bill/invoice number, and a simple table-row heuristic for line items where a tabular layout is detected.
- Persist `extraction_confidence` as an overall score (0–1) on the bill record; where implementation allows, also persist a lightweight per-field confidence map so the UI can highlight specific weak fields rather than the whole document.
- Populate `missing_fields` with the names of fields not extracted with sufficient confidence (e.g., below a defined threshold), consistent with the existing FUX-401 schema contract.
- On PDFs with no text layer (scanned/image-only), set a distinct status/flag (e.g., `capture_source: "upload"` with an `is_reviewed: false` and a clear "Unreadable" indicator) rather than emitting an empty or default-valued bill.
- Add a visible confidence indicator (e.g., a highlighted border or badge on low-confidence fields) in the bill review/edit screen, so the reviewer's attention is directed to fields most likely to need correction.
- Do not change the existing requirement that all uploaded bills remain non-payable until reviewed; this story only changes what values are proposed to the reviewer, not the approval gate itself.
- As a pre-implementation step, confirm which PDF text-extraction capability is available/permitted in the runtime environment (a lightweight text-layer parsing library versus a hosted OCR/document-AI service), since this choice materially affects both accuracy and implementation effort and must be settled before implementation-level detail can be finalized.

## Acceptance criteria

- Uploading a text-based bill PDF populates vendor, dates, and amount fields with values that match the actual content of that specific document, not fixed or generic placeholder values.
- Any field the parser cannot confidently extract is left blank or explicitly marked as missing — never auto-filled with a fabricated default.
- Every uploaded bill still requires human review and confirmation before it can reach "Ready to Pay," regardless of extraction confidence.
- Scanned or image-only PDFs are explicitly flagged as requiring manual entry, rather than silently producing an empty or dummy-valued bill.
- The reviewer can see which fields were extracted with low confidence at the point of correction (per-field or overall confidence is visible in the UI).

## Verification plan

- Test with a set of real sample bill PDFs from different vendors/layouts; confirm extracted vendor, dates, and amount match the source document for each.
- Test with a scanned image-only PDF; confirm the "Unreadable — Manual Entry Required" flag appears instead of blank/placeholder fields.
- Test with a malformed or corrupted PDF upload; confirm a clear error is surfaced rather than a silently created placeholder bill.
- Confirm `missing_fields` is populated correctly when specific fields (e.g., due date) cannot be extracted, while other fields on the same document are still correctly populated.
- Confirm no uploaded bill, regardless of confidence score, can reach "Ready to Pay" without passing through the existing Needs Coding/Needs Approval review step.
- Regression-test the existing bill upload and repository-matching tests (`finance-bill-repository.spec.js`, `finance-bills-inbox.spec.js`) to confirm no interference with duplicate detection or existing manual-entry bill creation.
