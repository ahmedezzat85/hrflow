# AGENTS.md — HRFlow Working Context

This file exists so any agent (or human) picking up work on this repo can get
oriented in under a minute, without re-deriving context that's already been
established. Keep it updated as decisions are made — treat it as living
memory, not a one-time note.

## What HRFlow is

An internal HR management system for a single company (Voyance Health /
HRFlow branding). Two portals from one app: **Admin** (HR) and **Employee**
(self-service). Covers: employee records, salary/raises, vacation requests,
medical insurance claims + consumption tracking, employee notes, per-employee
document storage, and a company-wide "Document Hub".

## Stack

- **Backend** (`be/`): Python, FastAPI, `uvicorn`. No traditional database —
  **Google Sheets is the database** (via `gspread`), one tab per "table".
  File storage is **Google Drive** (service-account owned, per-employee
  sub-folders + one shared "Company Documents" sub-folder for the Document
  Hub). Auth is **Google Sign-In only** (Google ID token verified server-side,
  then HRFlow issues its own short-lived JWT session token, `PyJWT`).
- **Frontend** (`fe/`): currently a single hand-edited `index.html`
  (~125KB) with inline `<style>` and inline `<script>`, plus a separate
  `api.js` (already well-isolated, has its own `TokenStore` + `Api` object)
  and `config.js` (gitignored, holds `API_BASE_URL` + `GOOGLE_CLIENT_ID`,
  copy from `config.example.js`).
- **No React.** Decision made explicitly (see "Frontend architecture
  decision" below) — vanilla JS + a build step, not a framework.

## Branches

- `main` — presumed stable/production reference; not actively pushed to
  during this work.
- `stabilization` — where bug fixes land (race conditions, session-expiry
  UX, etc.). Treat as the current "latest working state".
- `refactor/frontend-modular` — **active branch for the frontend
  modularization effort** described below. Branched from `stabilization`.

## Key facts / gotchas learned the hard way

1. **Singleton race condition (fixed)**: `SheetsClient` and `DriveClient` in
   `be/sheets_client.py` / `be/drive_client.py` used unsynchronized
   `__new__` singletons. Concurrent requests (e.g. the frontend's
   `Promise.all()` on page load) could return a half-constructed instance
   and crash with `AttributeError`. Fixed with double-checked locking
   (`_instance_lock`). If you touch these files, preserve that pattern.
2. **Google Sheets auto-types cells.** A document named `"6"` (e.g.
   `6.jpg`) comes back from `get_all_records()` as Python `int 6`, not
   string `"6"`. This broke `.replace()` calls on the frontend. Backend now
   normalizes document fields to strings before returning them
   (`_normalize_document_record` / `_normalize_company_document_record` in
   `be/main.py`). **Any new sheet-backed field that flows to the frontend
   should be defensively stringified** unless it's genuinely numeric and
   handled as such on both ends.
3. **The 401 issue was NOT a Google service-account token expiry.**
   `google-auth`'s `Credentials` object auto-refreshes itself on every API
   call — that layer doesn't need manual intervention. The actual 401s are
   HRFlow's **own session JWT** (`TOKEN_EXPIRY_HOURS`, default 12h) expiring
   mid-use. Fixed in `fe/api.js`: any 401 on an authenticated request now
   calls `forceSessionExpiredLogout()`, which clears the session and forces
   the user back to the Sign-In screen (with a `hrflow:session-expired`
   window event first, for softer handling later, then a fallback reload).
4. **Past incidents of "placeholder" pushes**: multiple commits in history
   are literally titled "Fix: restore real X.py content (previous push had
   placeholder)". This happened because large file rewrites were pushed
   without verifying content first. **Always verify file content
   (read it back or diff it) before and after pushing large files**,
   especially when reconstructing content from patches rather than a
   direct read.
5. **GitHub tool quirk**: `get_file_contents` in this environment has
   returned "successfully downloaded" without surfacing readable text in
   some sessions. `get_commit` with `detail: "full_patch"` reliably returns
   patch content and was used to reconstruct current file state from
   commit history when direct reads were unreliable. If direct file reads
   ever seem to silently succeed but give you nothing usable, fall back to
   walking `list_commits` + `get_commit(detail=full_patch)` for the file's
   path to reconstruct current content, or ask the user to paste content
   directly (though the user prefers agents solve this without manual
   pasting — see "Working style" below).

## Frontend architecture decision (2026-08-12)

**Constraint from the user:** deployment must remain a single HTML file with
no runtime fetches of multiple server-side files (i.e. the browser loads one
file and everything needed is inside it).

**Question raised:** does that constraint require React, or is vanilla
HTML/JS acceptable for an app this size?

**Decision:** Vanilla JS, no React. The single-file deployment constraint
and "modular, maintainable source code" are NOT in conflict — they were a
false dichotomy. The fix is a **build step**, not a framework:

- Use **Vite** with **`vite-plugin-singlefile`** to bundle multiple modular
  source files into one self-contained `index.html` at build time. Dev
  experience is multi-file; deployment artifact is still exactly one file,
  satisfying the original constraint.
- Rejected: continuing to hand-edit one giant file (already causing bugs
  and "placeholder content" incidents), and rejected full React/Vue as
  overkill for this app's current interaction complexity (CRUD screens,
  two role-based portals, tables, modals, file upload — no need for a
  virtual DOM or heavy state management).
- Considered but not chosen: Alpine.js/Preact/Lit as a lighter middle
  ground. Worth revisiting only if plain JS module organization proves
  insufficient in practice.

## Migration strategy (frontend modularization)

See full rationale in conversation history; summarized here for quick
reference. **This is a structural refactor only — no behavior, API, or
styling changes in this phase.**

**Phase 1 — Scaffolding**
- `fe/src/` is the new source root. Original `fe/index.html` stays as a
  golden reference until parity is verified — do not delete it early.
- `vite.config.js` at `fe/` (or repo root, TBD when implementing) using
  `vite-plugin-singlefile`, entry `fe/src/main.js`, output `fe/dist/index.html`.
- Move `<style>` block verbatim to `fe/src/styles.css`.
- Move static markup verbatim to Vite's entry HTML (`fe/src/index.html`),
  **preserving all existing element IDs** so JS selectors keep working
  during incremental migration.

**Phase 2 — JS modularization by domain**
Split the current inline `<script>` into files mirroring the backend's own
domain boundaries (intentional — makes cross-referencing FE/BE easier):
- `state.js` — shared mutable state object (employees, requests, etc.)
- `session.js` — TokenStore usage, cookie persistence, login/logout,
  `bootstrapAppFromSession`
- `employees.js` — employee table, modal, notes, detail view
- `requests.js` — pending requests tab + admin actions
- `salary.js` — salary/raises page + chart
- `vacations.js` — vacation balances + request form
- `insurance.js` — categories, consumption, claims
- `documents.js` — employee documents + Document Hub (these are near-
  duplicate logic today; **dedupe during migration**, don't just copy-paste
  twice)
- `charts.js` — Chart.js init + theme refresh (cross-cutting)
- `ui.js` — toasts, modals, sidebar collapse, theme toggle (generic, no
  domain data)
- `main.js` — entry point, wires `DOMContentLoaded`, calls
  `bootstrapAppFromSession`
- `api.js` stays as-is logically (already isolated); import it as a module
  instead of relying on a global `Api`/`TokenStore`.

**Phase 3 — Verification before cutover**
- `vite build`, then manually verify every tab/modal/flow in both Admin and
  Employee portals against current `fe/index.html` behavior, including
  Document Hub upload/preview/delete and the session-expiry logout flow.
- Only after parity is confirmed: replace `fe/index.html` with the build
  output, make `fe/src/` the source of truth, update `SETUP_GUIDE.md` build
  instructions accordingly.

## Working style / preferences observed

- The user wants agents to **resolve ambiguity and verify things
  themselves** (e.g. via `get_commit`/patch reconstruction) rather than
  asking for manual pastes — manual pasting is a last resort, not a first
  move.
- Confirm before any irreversible/write action (branch creation, file
  pushes) — this has been the working pattern throughout, keep it.
- Commit messages in this repo are detailed and explain **why**, not just
  what — match that style (see recent commits for tone/format).
- Prioritize information from `github.com/ahmedezzat85/hrflow` itself
  (this repo) over generic web sources when making implementation choices.
