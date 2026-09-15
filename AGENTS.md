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
- Store only repository-approved storage references; do not create public document links or bypass the authorization layer.
- When serving a document, authorize the current user against the associated record before streaming the stored file.

## Engineering Workflow & Story Lifecycle

For standard and high-risk features (including all FUX finance stories in `docs/finance-module/`), follow this strict 5-phase sequential lifecycle:

### Phase 1: Feature Specification & Ingestion
- Ingest feature requirements from user prompt or story specs in `docs/` (e.g. `docs/finance-module/FUX-XXX.md`).
- Identify user roles, acceptance criteria, schema migrations, API endpoints, and UI touchpoints.
- Clarify ambiguities or edge cases upfront before designing.

### Phase 2: Derive Implementation Plan
- Formulate a detailed `implementation_plan.md` before writing code:
  - **Architecture & Schema**: Table definitions, Pydantic DTOs, database migration scripts.
  - **Backend Pipeline**: Repository queries, domain validation & services, router endpoints with RBAC checks.
  - **Frontend & Mock Mode**: HTML partials, UI state, handlers, and exact mock mutations in `fe/finance-api.js` (`FinanceMockState`).
  - **Verification & Test Strategy**: Specific test cases mapped directly to acceptance criteria and verification goals.
- Stop and align before executing code changes.

### Phase 3: Execute Implementation
- **Backend (3-Tier Consistency)**:
  - `models.py` / `schemas.py` for database tables and Pydantic DTOs.
  - `repositories/` for raw database queries and filtering.
  - `services/` for business logic, validation, calculations, and domain errors.
  - `routers/` for HTTP endpoints, parameter parsing, and RBAC checks (`require_permission(...)`).
  - Defensively stringify sheet-backed IDs / codes passing to frontend.
  - Preserve singleton locks (`_instance_lock`) and financial command idempotency.
- **Frontend Dual-Mode**:
  - Update `fe/finance-api.js` (`FinanceMockState` and `FinanceApi`) so mock mode (`?mock=admin` or `?mock=employee`) mirrors live backend functionality with 100% fidelity.
  - Preserve element IDs, layout structures, and semantic CSS tokens.
  - **MANDATORY BUILD STEP**: Whenever any file under `fe/` is modified (HTML partials, JS, CSS), **ALWAYS execute `npm run build` from `fe/`** before running UI tests or browser verification.

### Phase 4: Automated Verification & Test Suite Augmentation
- Map every acceptance criterion and verification goal to automated tests.
- **Save tests permanently into the repository test suite** (NEVER use disposable scratch scripts):
  - Backend tests belong in `be/tests/test_*.py`. Run with Python venv:
    ```powershell
    D:\Voyance\DICOM_UTILITY\HR\.venv\Scripts\python.exe -m pytest be/tests/<test_file>.py -v
    ```
  - Frontend UI tests belong in `fe/tests/ui/<feature>.spec.js`. Run with Playwright:
    ```powershell
    npx playwright test tests/ui/<feature>.spec.js --reporter=list
    ```
- Run full regression tests for touched domains and verify 100% pass before concluding work.

### Phase 5: Clean Teardown, Commit & Push
- Inspect `git status` to ensure zero temporary, scratch, or test-output files remain staged.
- Stage relevant source and test files.
- Commit with a descriptive message explaining **what** changed and **why** (referencing story ID e.g. `FUX-XXX`).
- Push directly to the active working branch (verify branch with `git branch --show-current`, e.g. `origin/refactor/finance-ux`).

*(Note: For trivial bug fixes or localized UI polish, agents may choose a lighter workflow: inspect -> make smallest correct change -> run targeted checks -> commit).*

## Playwright UI Testing Instructions

The repository has a comprehensive Playwright test suite in `fe/tests/ui/` configured via `fe/playwright.config.js` (reusing port 8080 or launching Vite dev server).

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

## Definition of Done

Before declaring a task complete:
- Confirm implementation satisfies all accepted scope and acceptance criteria.
- Inspect `git diff` and verify only intended files changed (verify no placeholder content).
- Run relevant build (`npm run build`), unit, and UI tests.
- Add or update permanent tests for changed behavior.
- Report: summary of changes, test commands run and results, and any assumptions.

## Maintaining This Guide

- Update this file when a durable, repeated rule, architectural decision, recurring failure mode, or command changes.
- Do not add transient branch status, one-off task plans, lengthy historical narrative, or completed migration checklists here.
- Put detailed design rationale in `docs/architecture/` or ADR-style documents; link to them from this file when relevant.
- Keep instructions imperative, specific, and verifiable.
