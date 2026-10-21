# 29 — Personal Details, Single-Row Pay History, and Pay Moved Out of the Employee Modal: Plan (S1–S3)

**Status:** **Approved by owner, October 21, 2026** (recorded as D-036). **Implemented** on `feature/personal-details-pay-history` (slices S1, S2, S3).
**Baseline:** `main` at `f7bd75b` (after D-034 / P1–P3). **Re-verify the code facts in section 1 in the branch-intake step of each slice.**
**Scope in one line:** show pay history as one row per change on every screen; add legal name, phone and optional ID to the employee record behind a dedicated permission; and make the Pay plan modal the only place pay is edited.

---

## 1. Verified findings (October 21, 2026)

| # | Finding | Where |
|---|---|---|
| V1 | `salary_history` already holds both components in one record (`previous_*`/`new_internal_usd`, `*_external_usd`). The raise path is the only writer. | `be/models_db.py` (`SalaryHistoryDB`), `be/repositories/sql/salary.py` (`apply_raise`) |
| V2 | The company raise history, the profile compensation card and the employee portal already render one row per change. | `fe/public/js/salary.js`, `fe/public/js/employees.js` (`renderCompensationCard`), `fe/public/js/app.js` |
| V3 | **Only the Pay plan modal history is per component** (it reads plan rows with start, end, status, basis). It is the one inconsistent screen. | `renderCompPlanHistory` in `fe/public/js/salary.js` |
| V4 | A Pay plan save (atomic endpoint) and the employee create/update write-through change the plan but do **not** write `salary_history`, so the one-row screens miss those changes. | `be/finance/routers/compensation_plans.py`, `be/repositories/sql/employees.py` |
| V5 | `address_line_1`, `address_line_2` and `invoice_id` already exist on `employees`, are optional on create, are returned by the list and detail endpoints to any holder of `hr.employee.read` / `self.profile.read`, and are shown in the employee modal under "Salary payment docs". | `be/models_db.py`, `be/models.py`, `be/repositories/sql/employees.py` |
| V6 | Payment-doc eligibility already requires `address_line_1`. The template context uses `employee.name` for both `employee_name` and `employee_full_name`. | `be/services/salary_payment_docs.py` |
| V7 | The payment-doc routers read employees through `employee_repo.list_all()` / `get_by_id()`. | `be/routers/salary_payment_docs.py` |
| V8 | Salary inputs (Internal, External, Pay effective from) still live in the employee modal; on edit they are read-only with an "Edit pay plan" button. | `fe/src/partials/modals/employee-modal.html`, `fe/public/js/employees.js` |

## 2. Decisions (D-036, accepted October 21, 2026)

1. **One-row history everywhere.** The Pay plan modal shows the same `salary_history` table as the other screens. Every pay change, from a raise, a Pay plan save or an initial plan, writes exactly one `salary_history` record. The per-component start/end/status/basis view is dropped from the modal history (the current plan stays visible at the top of the modal).
2. **Pay is edited only through the Pay plan modal.** The Add/Edit employee modal has no pay fields. After a new employee is saved, the Pay plan modal opens for them; it can be skipped, and an employee may have no pay plan ("Not set").
3. **Names.** `name` stays the display name used everywhere (first and last). It is typed, pre-filled from the legal name, with a soft check for two words. New `legal_name` is the full legal name, used on contracts and rendered payment documents, never shown outside the employee page.
4. **New personal fields:** `legal_name`, `phone`, `id_type` (`national_id` | `passport`), `id_number` (text). Address stays `address_line_1` (required on create) and `address_line_2` (optional). ID is optional; if a number is entered the type is required.
5. **Validation.** National ID: exactly 14 digits. Passport: 6–12 letters/digits, upper-cased, spaces trimmed. ID is always stored and handled as text. No uniqueness check. Phone: required on create; digits, spaces, `+` and dashes accepted, stored normalised; obvious non-numbers rejected.
6. **Access.** Personal details are HR-admin only: new permissions `hr.employee_personal.read`, `hr.employee_personal.write`, `hr.employee_personal.reveal` (ID number unmasked). They are returned only by a dedicated detail endpoint, never by the employee list or detail endpoints, never to self-service. Reveal and every change are audited. The Sheets export excludes them.
7. **Required vs nullable.** `legal_name` and `address_line_1` and `phone` are required by the create API; all columns stay nullable in the database. Payment-doc generation is blocked, with a clear message, if the legal name or address line 1 is missing; it never falls back to the display name.
8. **Generated documents are immutable.** Stored files keep what they printed; regenerating uses the current details.
9. **Existing data.** Production is empty. Mock and test data: `legal_name = name`, plus a placeholder address and phone. The migration sets `legal_name = name` for existing rows so local databases stay valid.

## 3. Design

### 3.1 Slice S1 — Single-row pay history
- `CompensationPlanService.apply_pay_change(...)` gains optional `reason` and `applied_by`. When at least one component actually changes, it inserts one `SalaryHistoryDB` row in the same transaction (previous values from the active components before the change, new values after). A call that changes nothing writes nothing.
- `SalaryRepository.apply_raise` stops inserting its own history row and passes its reason through `apply_pay_change`; it still sets `next_raise`.
- The atomic `PUT /api/finance/employees/{id}/compensation-plan` passes notes as the reason and the actor email as `applied_by`.
- `apply_pay_change` takes `force_history=True` from the raise path, so a raise with unchanged amounts still logs its event (existing behaviour). The employee create/update write-through is left as is in S1 (create uses `set_component`, so it writes no history row) because S3 deletes it; the starting-pay row is written when the Pay plan modal creates the first plan.
- New read endpoint `GET /api/finance/employees/{id}/compensation-plan/pay-history` (permission `finance.payroll.read`, the one the modal already uses) returns the rows newest first. The old per-component `/history` endpoint stays (tests use it) but the modal no longer calls it. Loading the modal also refreshes the in-memory profile history so the other one-row screens update without a reload.
- Frontend: replace the modal's per-component table with the single-row table (Effective, Internal, External, Total, Change, Reason). Keep the "current plan" cards. Mock mode (`FinanceMockState`) returns the same shape.
- Tests: backend — each of raise, Pay plan save, initial plan writes exactly one history row; no-change save writes none; close-to-zero shows 0 in that column. UI — modal history shows one row per change with both columns.

### 3.2 Slice S2 — Personal details
- **Schema:** Alembic migration adding `legal_name`, `phone`, `id_type`, `id_number` (all nullable strings) to `employees`; backfill `legal_name = name`. `models_db.py`, `models.py`.
- **Repository:** `_employee_to_dict` no longer includes `address_line_1/2` or any personal field. New `get_personal(employee_id)`, `update_personal(...)`; `get_by_id` / `list_all` take `include_personal=False`. Payment-doc routers and the document service call with `include_personal=True` (or merge `get_personal`). Update the repository interface and the dormant Sheets/dual repos' signatures only as far as needed to keep them importable.
- **API:** `GET /api/employees/{id}/personal` (read; ID masked unless `?reveal_id=true` and `hr.employee_personal.reveal`, audited), `PUT /api/employees/{id}/personal` (write, audited, validation above). `POST /api/employees` requires `hr.employee.write` **and** `hr.employee_personal.write`, accepting `legal_name`, `phone`, `address_line_1/2`, optional `id_type`/`id_number`. `PUT /api/employees/{id}` no longer accepts address fields.
- **Permissions:** add the three keys to `permission_catalog.py` (group "HR / Employee personal details", read ⊂ write; reveal implies read), grant write and reveal to the HR-Admin seed, and update the catalog key count wherever it is asserted.
- **Payment docs:** eligibility also requires `legal_name`; the template context's `employee_name` / `employee_full_name` use the legal name; the stored document name and record `employee_name` keep the display name so lists never show the legal name. Verify that regeneration stores rather than recomputes the printed content (decision 8).
- **Frontend:** the Add/Edit modal gets a "Personal details" section (legal name, display name with pre-fill and soft check, phone, address lines, ID type + number). The employee page gets a Personal details card (permission-gated, ID masked with a reveal control). The employees table and every list keep showing only `name`. Mock mode serves a personal endpoint and enforces the same shape.
- **Export:** the new fields (legal name, phone, ID) are not added to `services/export.py`. The existing employees export already carries the address columns; they are left as they were (no export contract change in this slice).
- **Side fix:** `openEmployeeModal` now uses `openModal`, because `closeModal` leaves an inline `display:none` that made the dialog impossible to reopen in the same page load (needed for the S3 create-then-Pay-plan flow).
- Tests: validation matrix (national ID, passport, phone, soft rules), permission matrix (HR-Admin, other admin roles, employee self), list/detail endpoints never leak personal fields, reveal audit, payment-doc eligibility and template context, migration backfill. UI specs for the modal and the card.

### 3.3 Slice S3 — Pay out of the employee modal
- Remove Internal, External and Pay effective from from the modal and from `saveEmployee`; remove the read-only block and "Edit pay plan" button on edit (the employee page keeps its Pay plan entry point).
- After a successful create, open the Pay plan modal for the new employee ("Skip, set later" closes it).
- Backend: remove `internal_salary_usd`, `external_salary_usd`, `pay_effective_from` from `EmployeeCreate` and the salary fields from `EmployeeUpdate`; delete the create/update write-through in `repositories/sql/employees.py`. The `employees` salary columns stay (they are still synced by `apply_pay_change`).
- Employees table and any consumer treat "no active plan" as a valid state ("Not set", not 0).
- Update every test and mock path that creates an employee with a salary (use the Pay plan endpoint after creation instead; `tests/employee_test_helpers.py` has `set_pay`).
- `SqlEmployeeRepository.create` stays a data layer that can seed the salary columns (imports, fixtures); `update` ignores pay keys. The API never passes pay to either.
- Starting pay is recorded by the first Pay plan save (one `salary_history` row, previous values 0).

## 4. Order and delivery
S1 → S2 → S3, each as its own commit with its own targeted tests, then one final full backend run (`cd be && python -m pytest tests -q -n 12`), `npm run build` in `fe/`, and the affected Playwright specs. Update `docs/project-context/04-decision-log.md` (D-036), the roadmap and `docs/project-context/06-open-questions.md` as needed.

## 5. Out of scope / later
Employee self-service for personal details or change requests; nationality or issuing country; encryption at rest of ID numbers; structured addresses; ID uniqueness checks.
