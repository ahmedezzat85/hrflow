# RBAC Role-Permission Matrix

**Status:** Accepted by the owner on October 1, 2026 (documentation only; no code changed). Reconciled with code on October 1, 2026 (see section 5 corrections).  
**Date:** October 1, 2026  
**Branch intake:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (identical to `main` / `origin/main`; fast-forward pull recorded in the local reflog). Merge-base with `ui/dual-rail-nav` (`685d284`) could not be computed because git cannot run on the owner's machine right now; RBAC-relevant files (`be/core/*`, `be/auth.py`, `be/deps.py`, `be/models_db.py`, routers, `fe/public/js/admin-nav.js`, `session.js`) were compared with the previous branch snapshot and are identical (line endings aside).  
**Documents read:** `00-project-start-here`, `02-architecture-and-domain-boundaries`, `04-decision-log`. Also read for the write-up: `05`, `06`. `01` was reconciled with code on October 1, 2026.  
**Companions:** `../04-decision-log.md`, `technical-spec.md`, `implementation-plan.md`, `route-guard-inventory.csv`

---

## 1. Conventions

- **Key format:** `<module>.<resource>.<action>`. Keys are defined in code (the catalog); roles are database rows seeded from it. No prefix wildcards and no `*`.
- **Implication rule:** every action key lists, in the catalog, the keys it implies. Today every non-read action implies the read key of its resource (`write ⇒ read`; `prepare`, `approve`, `pay`, `reveal`, `manage`, `verify` ⇒ read). It never implies another action: `approve` does not imply `prepare`. Role rows are stored closed under implication and validated on save.
- **Scope rule:** `self.*` keys mean *own records only*; `hr.*` keys mean *all records*. A user holding both sees everything. Company-wide resources (`hr.company_document.read`) have no employee scope.
- **Assignable flag:** `system.*` keys are never assignable to any role except the locked Super-Admin role.
- **Employee baseline:** the Employee role is derived from a linked employee record. It is not shown or assigned on the Users page, and it is never listed under the admin roles below.

## 2. The five initial roles

| Role | Intent | Locked | Keys (after closure) |
|---|---|---|---|
| Super-Admin | Full system access, including role and user management. Can hold both maker and authorizer permissions. | Yes | 63 |
| HR-Admin | Full HR (people, salaries, bank details, documents, leave, claims, salary payment documents, HR exports). No finance, no payroll. | No | 20 |
| Financial-Admin | All finance and payroll. Approves and pays payroll; cannot prepare it. | No | 27 |
| Payroll-Maker | Prepares payroll only. Cannot approve or pay. | No | 2 |
| Employee | Own records only: view, plus submit requests, vacations and claims. Also reads company documents. | No | 13 |

Catalog size: **63 keys** = 35 existing kept, 25 new, 3 replacing `finance.payroll.write`. (The current seed holds 36 keys.)

## 3. Matrix by group

✓ = granted (explicitly or by implication). **New** = key does not exist in today's seed. **Replaces** = split from `finance.payroll.write`.

### System / Access

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `system.users.manage` | ✓ |  |  |  |  | not assignable |
| `system.roles.manage` | ✓ |  |  |  |  | not assignable |

### System / Audit

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `system.audit.read` | ✓ |  |  |  |  | **New**; not assignable |

### HR / Employees

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.employee.read` | ✓ | ✓ |  |  |  |  |
| `hr.employee.write` | ✓ | ✓ |  |  |  | implies `hr.employee.read` |

### HR / Compensation

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.salary.read` | ✓ | ✓ |  |  |  |  |
| `hr.salary.write` | ✓ | ✓ |  |  |  | implies `hr.salary.read` |

### HR / Employee bank details

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.employee_bank_account.read` | ✓ | ✓ |  |  |  | **New** |
| `hr.employee_bank_account.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.employee_bank_account.read` |
| `hr.employee_bank_account.reveal` | ✓ | ✓ |  |  |  | **New**; implies `hr.employee_bank_account.read` |

### HR / Documents

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.employee_document.read` | ✓ | ✓ |  |  |  | **New** |
| `hr.employee_document.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.employee_document.read` |
| `hr.company_document.read` | ✓ | ✓ |  |  | ✓ | **New** |
| `hr.company_document.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.company_document.read` |

### HR / Salary payment documents

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.salary_payment_doc.read` | ✓ | ✓ |  |  |  | **New** |
| `hr.salary_payment_doc.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.salary_payment_doc.read` |

### HR / Leave and requests

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.vacation.read` | ✓ | ✓ |  |  |  |  |
| `hr.vacation.write` | ✓ | ✓ |  |  |  | implies `hr.vacation.read` |
| `hr.request.read` | ✓ | ✓ |  |  |  | **New** |
| `hr.request.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.request.read` |

### HR / Medical insurance

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.insurance.read` | ✓ | ✓ |  |  |  | **New** |
| `hr.insurance.write` | ✓ | ✓ |  |  |  | **New**; implies `hr.insurance.read` |

### HR / Data export

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `hr.export.run` | ✓ | ✓ |  |  |  | **New** |

### Self-service

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `self.profile.read` | ✓ |  |  |  | ✓ |  |
| `self.payslip.read` | ✓ |  |  |  | ✓ |  |
| `self.requests.read` | ✓ |  |  |  | ✓ | **New** |
| `self.requests.write` | ✓ |  |  |  | ✓ | implies `self.requests.read` |
| `self.salary.read` | ✓ |  |  |  | ✓ | **New** |
| `self.vacation.read` | ✓ |  |  |  | ✓ | **New** |
| `self.vacation.write` | ✓ |  |  |  | ✓ | **New**; implies `self.vacation.read` |
| `self.claim.read` | ✓ |  |  |  | ✓ | **New** |
| `self.claim.write` | ✓ |  |  |  | ✓ | **New**; implies `self.claim.read` |
| `self.bank_account.read` | ✓ |  |  |  | ✓ | **New** |
| `self.document.read` | ✓ |  |  |  | ✓ | **New** |
| `self.document.write` | ✓ |  |  |  | ✓ | **New**; implies `self.document.read` |

### Finance / Sales

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.customer.read` | ✓ |  | ✓ |  |  |  |
| `finance.customer.write` | ✓ |  | ✓ |  |  | implies `finance.customer.read` |
| `finance.invoice.read` | ✓ |  | ✓ |  |  |  |
| `finance.invoice.write` | ✓ |  | ✓ |  |  | implies `finance.invoice.read` |

### Finance / Spend

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.vendor.read` | ✓ |  | ✓ |  |  |  |
| `finance.vendor.write` | ✓ |  | ✓ |  |  | implies `finance.vendor.read` |
| `finance.vendor_payment.manage` | ✓ |  | ✓ |  |  | implies `finance.vendor.read` |
| `finance.vendor_payment.verify` | ✓ |  | ✓ |  |  | implies `finance.vendor.read` |
| `finance.vendor_payment.reveal` | ✓ |  | ✓ |  |  | implies `finance.vendor.read` |
| `finance.bill.read` | ✓ |  | ✓ |  |  |  |
| `finance.bill.write` | ✓ |  | ✓ |  |  | implies `finance.bill.read` |
| `finance.subscription.read` | ✓ |  | ✓ |  |  |  |
| `finance.subscription.write` | ✓ |  | ✓ |  |  | implies `finance.subscription.read` |
| `finance.statutory.read` | ✓ |  | ✓ |  |  |  |
| `finance.statutory.write` | ✓ |  | ✓ |  |  | implies `finance.statutory.read` |

### Finance / Banking

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.account.read` | ✓ |  | ✓ |  |  |  |
| `finance.account.write` | ✓ |  | ✓ |  |  | implies `finance.account.read` |
| `finance.bank_account.reveal` | ✓ |  | ✓ |  |  | implies `finance.account.read` |
| `finance.adjustment.manage` | ✓ |  | ✓ |  |  | implies `finance.account.write` |

### Finance / Reports

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.report.read` | ✓ |  | ✓ |  |  |  |

### Finance / Settings

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.settings.read` | ✓ |  | ✓ |  |  | **New** |
| `finance.settings.write` | ✓ |  | ✓ |  |  | implies `finance.settings.read` |

### Payroll / Runs

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.payroll.read` | ✓ |  | ✓ | ✓ |  |  |
| `finance.payroll.prepare` | ✓ |  |  | ✓ |  | **Replaces** `finance.payroll.write`; implies `finance.payroll.read` |
| `finance.payroll.approve` | ✓ |  | ✓ |  |  | **Replaces** `finance.payroll.write`; implies `finance.payroll.read` |
| `finance.payroll.pay` | ✓ |  | ✓ |  |  | **Replaces** `finance.payroll.write`; implies `finance.payroll.read` |

### Payroll / Tax settings

| Key | Super | HR-Adm | Fin-Adm | Pay-Mkr | Emp | Note |
|---|---|---|---|---|---|---|
| `finance.payroll_tax.read` | ✓ |  | ✓ |  |  |  |
| `finance.payroll_tax.write` | ✓ |  | ✓ |  |  | implies `finance.payroll_tax.read` |

## 4. Behavior changes compared with today

Derived from the route inventory (236 route registrations across 31 router files plus `main.py`; legacy-alias registrations counted separately). Counts by change type: unchanged: 162, key-from-admin: 26, scope-by-permission: 15, key-split: 13, new-key: 7, tightened: 6, key-rename (D-008 amendment): 6, bugfix: 1.

| # | Change | Where | Effect |
|---|---|---|---|
| 1 | Payroll lifecycle split | `finance/routers/payroll.py`, `compensation_plans.py` | Today 13 routes share `finance.payroll.write` (adjustments, generate/create, lines, submit, approve, finalize, pay, post-journal, plus compensation-plan edits). They split into `prepare` (preview adjustments, generate/create run, lines, submit, compensation plans), `approve` (approve, finalize) and `pay` (pay, post-journal). |
| 2 | Statutory keys | `finance/routers/statutory.py` | 6 routes move from `finance.bill.*` to `finance.statutory.*` (closes the D-008 documented gap). |
| 3 | Vendor payment instructions | `finance/routers/vendors.py` | Create/update require `finance.vendor_payment.manage` and verify requires `finance.vendor_payment.verify`. The current alias that lets any `finance.vendor.write` holder manage and verify is removed, restoring maker/checker at this step. |
| 4 | Finance activity timeline | `finance/routers/activity.py` | Today any signed-in user passes the guard. Proposed: per-entity read key. Also fixes an undefined name (`user_permissions`, line 763) that would raise `NameError` on the vendor branch for non-admins (static reading, not executed). |
| 5 | Feature flags and metrics (GET) | `finance/routers/observability.py` | Today any signed-in user. Proposed: new `finance.settings.read`. Frontend call sites must be checked first so employees do not lose a startup call they depend on. |
| 6 | Adjustment authorization | `finance/routers/bank_accounts.py` (`create_account_transaction`) | Inline check reads `permissions` from the session payload, which never contains them, so a non-admin holding `finance.adjustment.manage` is always denied. Proposed: read from resolved permissions. |
| 7 | HR routes | HR routers (all except `auth.py`) | The 31 `require_admin` route registrations in the HR routers (including 6 legacy `/api/invoices` aliases) move to HR keys, `system.audit.read` and `hr.export.run`. 15 further registrations that scope by `role == "admin"` become permission-scoped (`hr.*` or `self.*`). |
| 8 | Employee bank details | `routers/employee_bank_accounts.py` | Admin-only today (an employee cannot view their own). New `self.bank_account.read`; `reveal=true` currently has no extra check and will require `hr.employee_bank_account.reveal`. |
| 9 | Audit log | `routers/system.py` | `require_admin` becomes `system.audit.read` (Super-Admin only). |
| 10 | Exports | `routers/export.py` | `require_admin` becomes `hr.export.run` plus the dataset's read key; the 7 `finance_*` datasets need `finance.report.read` plus their dataset read key. |

## 5. Verified findings behind the matrix

Each is from reading code on `feature/rbac`; nothing was executed.

- Session payload (`create_session_token`) carries `email, role, employee_id, name, exp` only. Permissions are resolved per request from the database and cached on `request.state`.
- `*` is granted by the `system_admin` role name or by any of `admin, superadmin, super_admin, system_admin` in the token claim or `users.role`.
- `seed_rbac` is called from migration 0003 **and from `init_db()` (`be/db.py`) on every application start**. It inserts missing permission rows, grants every seeded permission to `system_admin`, grants the `self.*` keys to `employee`, and re-links each user to `system_admin` (legacy `users.role = admin`) or `employee` if that link is missing. Errors in this step are swallowed (`except Exception: pass`). *(Correction: an earlier version of this document said the seed ran only from migration 0003.)*
- `be/main.py` has no lifespan or `on_event` handler, but it calls `init_db()` at import time inside a `try/except` that logs a warning. *(Correction: an earlier version said there was no startup path.)*
- Test fixtures mint session tokens with the legacy role (`create_session_token(email, "admin", 1)`), so retiring `users.role` requires fixture rework.
- `STORAGE_ENGINE` other than `sql` is rejected by `Config`; Sheets-backed user repositories (`repositories/sheets/auth.py`, `dual/auth.py`) are legacy and out of scope.
- `AGENTS.md` described Google Sheets as the data store; it was corrected on October 1, 2026 to match `Config` and the project-context documents.
- Payroll already enforces at runtime that the submitter of a run cannot approve it (`approve_run`); the bypass is the `allow_self_approval` query parameter or `ENFORCE_MAKER_CHECKER=false`. See Q-013.

## 6. Open items for the owner

| # | Item | Interim treatment in this draft |
|---|---|---|
| 1 | Who maintains employee compensation plans? Their endpoints sit under `finance.payroll.*`, but HR-Admin has no finance access. | Mapped to `finance.payroll.prepare` (status quo behavior). Tracked as an open question. |
| 2 | Payroll-Maker data access. Run creation takes company funding-account IDs; listing them needs `finance.account.read`, which Payroll-Maker does not hold. | Kept as is per owner instruction; to be verified in the UI during implementation and recorded as an open question. |
| 3 | `post-journal` mapped to `pay`. Confirm it is not an approval-stage action. | Mapped to `finance.payroll.pay`. |
| 4 | `finance.account.*` guards bank accounts, ledger, transfers, cheques, statements, rules, categories and payment types. | One pair kept; split later only if a role needs a subset. UI grouping still presents sub-sections. |
| 5 | Employee self-service writes: own document upload/delete is allowed today and is preserved (`self.document.write`). Own bank-detail edits are not included. | Confirm both. |
| 6 | Naming debt: `self.requests.*` (plural) vs `self.vacation.*`, `self.claim.*`. | Existing key kept; rename deferred. |
| 7 | `hr.company_document.read` is granted to Employee; it is the one company-wide exception to the hr=all / self=own rule. | Confirm. |
| 8 | Existing admins on migration: all current `users.role = 'admin'` users become Super-Admin so nobody loses access; the owner then downgrades through the Users page. | Specified in the technical spec. |

## 7. Appendix

Per-route current and proposed guards for all 236 registrations: `route-guard-inventory.csv` (columns: file, method, path, handler, current_guard, proposed_guard, change_type).
