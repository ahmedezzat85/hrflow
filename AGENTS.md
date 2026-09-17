# AGENTS.md — HRFlow Repository Guide

This file is the durable operating guide for humans and coding agents working in HRFlow. Read it before making changes. Keep it concise, current, and actionable; move lengthy rationale and completed project history to `docs/`.

## Product

HRFlow is an internal HR and finance management system for one company (Voyance Health / HRFlow branding). It provides:

- An **Admin** portal for HR and finance operations.
- An **Employee** portal for self-service.
- Employee records, salaries and raises, vacation requests, insurance claims and consumption tracking, employee notes, employee documents, a company Document Hub, and finance workflows (AP bills, invoices, drawer settlements, cashbooks, ledger).

## Stack and Boundaries

- **Backend:** `be/` — Python, FastAPI, `uvicorn`.
- **Data store:** Google Sheets through `gspread`; one sheet tab represents a logical table.
- **File storage:** Google Drive, owned by the service account. Employee documents use employee subfolders; shared documents use the Company Documents folder.
- **Authentication:** Google Sign-In. The backend verifies the Google ID token and then issues HRFlow's own short-lived JWT session token using `PyJWT`.
- **Frontend:** `fe/` — vanilla HTML/CSS/JavaScript, bundled with Vite and `vite-plugin-singlefile` into a single deployable HTML artifact (`fe/dist/index.html`). Source of truth is `fe/src/`.
- **No React:** do not introduce React or another frontend framework unless explicitly approved.
- **Configuration:** `fe/config.js` is gitignored and contains `API_BASE_URL` and `GOOGLE_CLIENT_ID`; use `config.example.js` as the template. Never commit secrets or environment-specific configuration.

## Non-Negotiables

- Apply authentication, authorization, and company/employee scope checks on the backend (`require_permission(...)`). Frontend visibility is never authorization.
- Do not expose service-account credentials, JWTs, Google Drive IDs, storage paths, signed URLs, or sensitive personal/financial data in client code, logs, errors, fixtures, or commits.
- Reuse the nearest established repository pattern before introducing a dependency, a parallel abstraction, a new persistence mechanism, or a new API convention.
- Do not silently weaken validation, authorization, idempotency, duplicate detection, audit behavior, financial controls, or workflow safeguards to make a feature pass.
- Analyze compatibility before changing an API contract, Google Sheet schema, financial calculation, permission meaning, workflow state, or persisted-data format.
- Keep changes scoped to the task. Do not mix unrelated refactoring, formatting churn, dependency upgrades, or generated-file changes into a feature fix.
- Never commit secrets, local configuration, temporary scripts, test output, traces, screenshots, coverage artifacts, or generated files unless the repository explicitly tracks them.

## Repository Facts and Gotchas

### Singleton Clients
`SheetsClient` in `be/sheets_client.py` and `DriveClient` in `be/drive_client.py` are singleton clients. Their construction must remain thread-safe: concurrent frontend requests can otherwise receive a partially initialized instance and fail with `AttributeError`.
- Preserve the double-checked locking pattern and `_instance_lock` when modifying these clients.
- Do not replace the pattern with unsynchronized `__new__` logic.

### Google Sheets Type Normalization
Google Sheets may auto-type cell values. For example, a document named `6` (e.g. `6.jpg`) is returned by `get_all_records()` as a Python `int 6`, not string `"6"`.
- Treat sheet-backed values crossing into frontend payloads as untrusted types.
- Defensively normalize document identifiers, filenames, codes, and similar display values to strings unless they are intentionally numeric on both backend and frontend.
- Existing normalization helpers in `be/main.py` include `_normalize_document_record` and `_normalize_company_document_record`; follow this pattern.

### Session Expiry
The common 401 issue is HRFlow's own JWT session expiry (`TOKEN_EXPIRY_HOURS`), not expiration of Google service-account credentials (which auto-refresh).
- Preserve the session-expiry flow in `fe/api.js`.
- Authenticated 401 responses should trigger `forceSessionExpiredLogout()` and the `hrflow:session-expired` event before fallback reload.

### File and Document Handling
- Follow existing Google Drive storage and retrieval patterns for employee documents and the Document Hub.
- Store only repository-approved storage references; never use a publicly shareable Drive link as an authorization mechanism or bypass the backend authorization layer.
- When serving a document, authorize the current user against the associated record before streaming the stored file.

## Engineering Workflow

Choose the lightest workflow that matches the task's risk and blast radius:

### Small Changes
Use for localized bug fixes, UI polish, copy changes, simple validation, focused tests, and mechanical cleanup:
1. Inspect the relevant code and nearest existing pattern.
2. Make the smallest correct change.
3. Run targeted checks.
4. Inspect the final diff and report results.

### Standard Changes
Use for bounded features or enhancements spanning a small number of modules:
1. Inspect relevant modules, tests, and patterns.
2. State a concise approach before editing: affected modules, data/API changes, compatibility or edge cases, and test plan.
3. Implement using the established architecture.
4. Add durable tests for changed behavior where practical, and run relevant checks.

### High-Risk Changes
Use for finance (e.g., FUX stories in `docs/finance-module/`), payroll, permissions, authentication, document storage, file retrieval, migrations, data lifecycle, workflow-state changes, or broad cross-module refactors. Follow this sequence:

1. **Feature Specification & Ingestion**: Read story specs in `docs/finance-module/` or prompt. Identify user roles, acceptance criteria, schema changes, endpoints, and UI touchpoints. Resolve material ambiguities before implementation; use established local patterns for routine implementation choices.
2. **Derive Implementation Plan**: Formulate a detailed `implementation_plan.md` covering architecture, schemas/DTOs, backend services & permissions, frontend UI & mock state, and test strategy mapped to acceptance criteria.
3. **Execute Implementation**:
   - Backend 3-tier consistency (`models/schemas` $\rightarrow$ `repositories` $\rightarrow$ `services` $\rightarrow$ `routers`).
   - Frontend: update HTML partials, scripts, and mock handlers.
   - **MANDATORY**: Run `npm run build` in `fe/` whenever any frontend files are touched before running UI tests.
4. **Verification & Test Suite Augmentation**: Write durable tests (in `be/tests/` and `fe/tests/ui/`) for all acceptance criteria.
   - **Token-Efficient Verification Protocol**:
     - **Targeted First**: During implementation and debugging, run ONLY the single test or spec file directly addressing the change (e.g., `pytest be/tests/test_specific.py -q` or `npx playwright test tests/ui/specific.spec.js`).
     - **Compact Output**: Pass `-q` or `--tb=short` to `pytest` to prevent large logs from inflating the conversation context window.
     - **Defer Regressions**: Do NOT run broad directory-wide test suites during intermediate iteration. Run broader regression suites ONLY once, as the final validation step immediately before clean teardown and commit.
5. **Clean Teardown & Delivery**: Inspect `git status` and `git diff` for zero scratch/temporary artifacts, stage cleanly, and commit with descriptive messages (`FUX-XXX`).

## Frontend and Mock Mode

- For features supported in mock mode, update `FinanceMockState` and `FinanceApi` in `fe/finance-api.js` so mock mode reproduces the user-visible states, transitions, validations, and error scenarios needed for deterministic UI testing (`?mock=admin` or `?mock=employee`).
- Do not claim mock mode validates backend-only behavior such as real authorization, Google Drive streaming, persistence, concurrency, or server-side data integrity; cover those with backend/integration tests.
- Preserve element IDs, layout structures, and semantic CSS tokens.

## Playwright UI Testing Instructions

The repository has a comprehensive Playwright test suite in `fe/tests/ui/` configured via `fe/playwright.config.js`.

### How to Run Tests Efficiently
From the `fe/` directory (or with `npx` inside `fe/`):

```powershell
# Run a specific spec file (fastest and recommended during development):
npx playwright test tests/ui/finance-bill-repository.spec.js

# Run a specific test by title match:
npx playwright test tests/ui/finance-bill-repository.spec.js -g "paperclip attachment action"

# Run with verbose list reporter for real-time step output:
npx playwright test tests/ui/finance-bill-repository.spec.js --reporter=list

# Run multiple related regression specs:
npx playwright test tests/ui/finance-bills-inbox.spec.js tests/ui/finance-bills-approval.spec.js

# Run headed mode (for visual inspection when needed):
npx playwright test tests/ui/finance-bill-repository.spec.js --headed
```

### UI Testing Conventions & Gotchas
- **Deterministic Mock Mode**:
  ```javascript
  await page.goto('/?mock=admin');
  await expect(page.locator('#adminSidebar')).toBeVisible({ timeout: 15000 });
  ```
- **Console & Page Error Monitoring**:
  ```javascript
  page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', (err) => console.error('BROWSER ERROR:', err));
  ```
- **Z-Index & Modal Stacking**:
  - Overlays have distinct stacking contexts: Detail drawer (`1050`), Document preview modal (`2000`), Safe confirmation modal (`9999`).
  - When testing nested modals (e.g. previewing an attachment from inside a drawer), ensure the top modal is closed before interacting with the underlying modal/drawer to avoid pointer-intercept errors.
- **Robust Scoped Selectors**:
  - Prefer explicit IDs (`#financeBillAttachmentFilter`, `#billModalSaveBtn`).
  - Use scoped row lookups:
    ```javascript
    const billRow = page.locator('#financeBillsTableBody tr:has-text("BILL-2026-003")');
    await billRow.locator('.btn-bill-attachment').click();
    ```
- **Clean Modal Teardown**:
  - Always close opened modals and drawers within the test so active overlay state cannot leak to subsequent tests.

## Git and Delivery

- Inspect `git status` and the final `git diff`; ensure no temporary, scratch, generated, or test-output files are included.
- Stage only relevant source, documentation, and test files.
- Use a descriptive commit message explaining what changed and why; include a story identifier such as `FUX-XXX` when applicable.
- Determine the target branch from the current task, repository state, and user instruction.
- Commit, push, create branches, or open pull requests only when explicitly authorized by the user or required by the active execution environment.
- For large files or reconstructed patches, read back the resulting content or inspect the diff before and after committing.

## Definition of Done

Before declaring a task complete:
- Confirm implementation satisfies all accepted scope and acceptance criteria.
- Inspect `git diff` and verify only intended files changed (verify no placeholder content).
- Run the relevant build (`npm run build`) and applicable backend/unit/integration/UI tests for the touched area.
- Add or update permanent tests for changed behavior.
- Report: summary of changes, test commands run and results, any limitations, and unresolved assumptions.

## Maintaining This Guide

- Update this file when a durable, repeated rule, architectural decision, recurring failure mode, or command changes.
- Do not add transient branch status, one-off task plans, lengthy historical narrative, or completed migration checklists here.
- Put detailed design rationale in `docs/architecture/` or ADR-style documents; link to them from this file when relevant.
- Keep instructions imperative, specific, and verifiable.
