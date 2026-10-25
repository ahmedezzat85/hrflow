# Payroll funding accounts owned by Payroll Settings: implementation plan

Status: PLAN FOR OWNER REVIEW. Nothing below is implemented. Branch: `feat/payroll-funding-account-settings` (from main `fbd3456`).
Risk class: high (finance workflow, schema, migration, payment controls). Origin: Part C finding (Q-007 follow-up, D-039) and the owner's rule below.

## 1. Owner rule (as given)

- If no funding bank accounts are set, payroll stops at payment and never proceeds until they are explicitly set by someone who has the permission to set them.
- Funding accounts are read from the global Payroll Settings. Any change is made there.
- The Payment step offers to set them only when Settings has none. If Settings already has them, changing them at payment is optional or not permitted.
- Server strictness: block `pay` and `post-journal` only. Create, preview, submit, approve and finalize still work with accounts unset.

## 2. Findings that shape the plan (verified in code on main)

| # | Finding | Where |
|---|---|---|
| F1 | `finance_payroll_settings` holds only `employee_rate` and `employer_rate`. No funding accounts. A migration is required. | `be/finance/models.py` `PayrollSettingsDB` |
| F2 | Settings reads need `finance.payroll.read` (Payroll-Maker has it). Settings writes need `finance.settings.write`. | `be/finance/routers/payroll.py` `/settings` |
| F3 | Create, preview and generate fall back to the first active bank account when none is given, and copy it into `bank_account_id`. Funding ids are stored as sent, with no existence or active check. | `payroll_service.py` ~575, ~986, ~1172 |
| F4 | `_post_run_ledger` already refuses a missing funding account (`funding_account_required`) but falls back to `run.bank_account_id`, which is the first-active default, so the refusal almost never fires. It runs after lines are marked paid (the transaction is rolled back on refusal). | `payroll_service.py` ~1790, ~1801 |
| F5 | `POST /runs/{id}/pay` accepts a `bank_account_id` that overwrites `run.bank_account_id`. | `payroll_service.py` ~1785 |
| F6 | The run screen sends hardcoded `|| 1` and `|| 2` when no account is selected, and remembers choices in `localStorage` (`hrflow_payroll_funding_accounts`). | `fe/public/js/finance-payroll.js` ~1309, ~1352, ~2340, ~258 |
| F7 | A Payroll-Maker gets 403 on `GET /api/finance/accounts` (`finance.account.read`), so the dropdowns are empty for them. D-039: this stays. | `be/finance/routers/bank_accounts.py` |
| F8 | No `require_all_permissions` helper exists, only `require_permission` and `require_any_permission`. | `be/core/permissions.py` |
| F9 | Mock mode: `getPayrollSettings` and `updatePayrollSettings` exist in `fe/api/finance/payroll-api.js`; the mock pay path already throws `funding_account_required`. | `payroll-api.js` ~815, ~1201 |

## 3. Design

### 3.1 Data (migration `0044_payroll_funding_accounts`)

- Add to `finance_payroll_settings`: `external_funding_account_id` and `internal_funding_account_id`, both nullable Integer, FK to `finance_bank_accounts.id` with `ON DELETE SET NULL` (same as the run columns).
- Idempotent (inspect existing columns), like `0043`. Use `batch_alter_table` so SQLite can add the FK columns. Downgrade drops both columns.
- No backfill. Existing databases start with accounts unset, which is the explicit-set rule. Existing runs keep the ids they already store.
- Mirror the columns on `PayrollSettingsDB`, `PayrollSettingsResponse` and `PayrollSettingsUpdate` (ids optional, `None` leaves unchanged, explicit clear is a separate flag, see Q3). `init_db()` adds missing columns, but the Alembic migration is still required.

### 3.2 Settings API (no new permission key)

- `PUT /api/finance/payroll/settings` (`finance.settings.write`, unchanged guard) accepts both ids. Each must exist, be active, and have the currency the run will use (USD for external; see Q4 for internal). 400 with a clear message otherwise. Audit the change (old and new ids), like the rate audit.
- `GET /api/finance/payroll/settings` (`finance.payroll.read`, unchanged guard) returns the ids plus a safe summary per account: `id`, `name`, `currency`, `type`. No account number, no IBAN, no reveal. This lets Payroll-Maker see which account is configured without `finance.account.read`.
- The Settings page needs the accounts list to pick from, so choosing needs `finance.account.read` (Financial-Admin and Super-Admin have it).

### 3.3 Run creation

- The server resolves funding accounts from Settings. The first-active-account default is removed from create, preview and generate.
- `PayrollRunCreate` and `PayrollRunGenerateRequest` keep their funding fields for compatibility, but a value that differs from Settings is rejected with 400 (`funding_accounts_come_from_settings`). A missing value is fine. If Settings has none, the run is stored with `null` funding ids. `bank_account_id` is set equal to the external funding account (or `null`) and kept only as a legacy column.
- The run reads Settings live while it is draft, submitted or approved. At finalize the server freezes the resolved ids on the run (see Q2). Pay and post-journal then use the frozen ids.

### 3.4 Payment guard (the stop)

- New `_require_funding_accounts(run)` called at the top of `execute_payment` and `post_journal`, before any line is marked paid.
- Needs a funding account for each leg with net pay above 0 (same leg rule as `_post_run_ledger`). Each must exist, be active and match the run currency.
- Failure returns 409 `{code: "funding_accounts_not_set", message, missing: ["external"|"internal"]}`. `_post_run_ledger` loses its `or run.bank_account_id` fallback.
- `POST /runs/{id}/pay` stops accepting a `bank_account_id` override (field ignored with 400 if it differs from the run).

### 3.5 Setting accounts at the Payment step (only when Settings has none)

- New `PUT /api/finance/payroll/runs/{run_id}/funding-accounts` with `{external_funding_account_id, internal_funding_account_id}`.
- Allowed only if the run is finalized or partially paid (not paid) and Settings has no account for that leg. If Settings already has the account, 409 `set_in_settings`.
- Guard: the caller needs both `finance.payroll.pay` and `finance.account.read`. This needs a small `require_all_permissions(...)` in `core/permissions.py` (F8), with the same `hrflow_permission_all` marker the route-guard walker already knows. No new permission key.
- Validates exists, active, currency. Audited. Writes to the run only, not to Settings (see Q1).

### 3.6 Frontend (vanilla JS, existing tokens, preserve IDs)

- Payroll Settings page: two selects, "External salaries funding account" and "Internal salaries funding account", editable only with `finance.settings.write` and `finance.account.read`. Read-only text otherwise.
- Run set-up step (`#p1ExtAccount`, `#p1IntAccount`): show the accounts from Settings as read-only text (selects kept for IDs but disabled). Remove `localStorage` persistence and every `|| 1` and `|| 2` fallback. When unset, show a notice: "Funding accounts are not set. You can prepare this run. Payment is blocked until they are set in Payroll settings."
- Pay step: when the server returns `funding_accounts_not_set`, show a blocked panel. With permission (and Settings empty), show the selects and a "Set funding accounts" button that calls 3.5. Without permission, name what is needed ("ask someone with Payroll payment and Accounts access, or set them in Payroll settings").
- Mock mode: extend `FinanceMockState.payrollSettings` with the two ids, add the new run endpoint, enforce the same guard in the mock pay and post-journal paths, and honour role fixtures.

## 4. Permissions and roles (no new keys, no role-grant change)

| Action | Key | Super-Admin | Financial-Admin | Payroll-Maker | HR-Admin | Employee |
|---|---|---|---|---|---|---|
| Read Settings and account summary | `finance.payroll.read` | yes | yes | yes | no | no |
| Set accounts in Settings | `finance.settings.write` (+ `finance.account.read` to pick) | yes | yes | no | no | no |
| Create or prepare run | `finance.payroll.prepare` | yes | no | yes | no | no |
| Pay, post-journal | `finance.payroll.pay` | yes | yes | no | no | no |
| Set accounts at payment | `finance.payroll.pay` AND `finance.account.read` | yes | yes | no | no | no |

Result: Payroll-Maker prepares runs and sees which accounts apply but cannot change them. Financial-Admin can set them in Settings or, if Settings is empty, at payment.

## 5. Compatibility and rollout

- API contract: request fields stay, so older clients still deserialize; behaviour changes for mismatching values (400) and for pay (409 when unset).
- Existing runs keep stored ids. Existing drafts with null ids are blocked at pay until set. Existing databases need Settings configured once after deploy, before the next payment.
- Ledger postings already written are untouched. No change to net pay calculation, tax, statutory obligations or the D-025 ledger rules.
- Biggest test risk: many existing payroll tests create runs without accounts and then pay, relying on the first-active default (F3). They will need a shared helper that sets both Settings accounts in the fixture. Count them before implementation and list the changes in the PR.

## 6. Test plan (mapped to the rule)

Backend (`be/tests/`, new `test_payroll_funding_accounts.py` plus targeted updates):

1. Migration upgrade and downgrade on SQLite; idempotent re-run.
2. Settings PUT: valid ids saved; unknown, inactive or wrong-currency id gives 400; non-`finance.settings.write` gives 403; audit row written.
3. Settings GET returns the account summary and never an account number; Payroll-Maker can read it.
4. Create run with Settings unset: succeeds with null ids, no first-active default. Create with a differing client id: 400.
5. Pay and post-journal with Settings unset: 409 `funding_accounts_not_set`, no line marked paid, no ledger row.
6. After Settings is set: pay succeeds and posts the legs to the configured accounts.
7. Finalize freezes ids; a later Settings change does not alter a finalized run (per Q2).
8. Payment-step endpoint: allowed only for pay AND account.read, only when Settings is empty, only before paid; otherwise 403 or 409. Matrix for all five roles and a no-key user.
9. Route-guard walker and inventory stay green (new `all` guard recognised; update inventory only as the test requires).
10. Existing payroll suites green after the fixture helper.

Frontend (`fe/tests/ui/`, mock mode, after `npm run build`): Settings selects by role; run screen shows read-only accounts and the unset notice; Pay step blocked panel with and without permission; no `1` or `2` in the create payload; no `localStorage` key written.

Commands to report at the end: targeted pytest per file with `-q`, then the one final `python -m pytest tests -q -n 12`, and `npx playwright test <specs> --reporter=line`.

## 7. Files expected to change

Backend: `be/migrations/versions/0044_payroll_funding_accounts.py` (new), `be/finance/models.py`, `be/finance/schemas.py`, `be/finance/services/payroll_service.py`, `be/finance/routers/payroll.py`, `be/core/permissions.py`, `be/tests/` (new file plus fixture helper).
Frontend: `fe/public/js/finance-payroll.js`, `fe/api/finance/payroll-api.js`, `fe/src/partials/admin/sections/finance-payroll.html`, `fe/tests/ui/` (new spec plus updates).
Docs (listed, not edited here): decision log entry, open-question closure, RBAC technical spec note, route-guard inventory rows for the new route and the stale compensation-plan rows.

## 8. Open questions for the owner (answer before implementation)

- **Q1.** At the Payment step, should setting the accounts apply to this run only (recommended; Settings stays the single place for defaults, but every run then needs the step until Settings is set), or also save them as the Settings default (needs `finance.settings.write` too)?
- **Q2.** "Read the settings always": should a run follow Settings live until it is finalized and then freeze (recommended, so a later Settings change cannot redirect money on a finalized run), or follow Settings live until it is paid?
- **Q3.** Can Settings accounts be cleared once set? Recommended: no clearing, only replacing, so payroll cannot be silently un-configured.
- **Q4.** Currency rule: the run currency must equal each funding account's currency (the current ledger rule). Is that correct for the internal (cash) account too, or does the internal leg use a different currency?
- **Q5.** Existing environments: confirm Settings will be configured by a Financial-Admin once after deploy, with no automatic backfill from the first active account.

## 9. Delivery steps (after approval)

1. Migration, model and schema, with the migration test.
2. Settings API and audit, with tests.
3. Resolution at run creation, removal of the first-active default, freeze at finalize.
4. Payment guard and the payment-step endpoint, with the permission matrix test.
5. Frontend Settings, run screen, Pay step, mock state, UI specs.
6. Fix existing payroll tests via the fixture helper; run the full backend suite once; `npm run build` and the UI specs; commit with a story identifier; push.
