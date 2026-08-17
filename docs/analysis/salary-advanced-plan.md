# Salary Advanced — Internal/External USD Split (Phase 1)

Status: proposed, not yet implemented.
Branch: `feature/salary-advanced`.
Scope of this phase: **data model + raise-application logic only**, in USD,
split into Internal/External components. No FX, no payroll export changes,
no frontend work yet — those are separate follow-up phases so we can land
this incrementally (per user request: small reviewable steps, not one bulk
change).

## Why (business context)

An employee's salary is actually two separate payments:
- **Internal**: transferred inside Egypt to the employee.
- **External**: transferred directly from the USA to the employee's bank
  account.

Both legs are already denominated in **USD**, not EGP. Today the system
models salary as a single `salary` field (implicitly treated as one
currency, EGP-flavored in the UI text - e.g. `EGP {payload.amount}` in
insurance claims, `fmtMoney` prefixing "EGP" in the frontend). This phase
introduces the two-component structure for salary specifically; it does not
touch insurance/vacation currency display.

## Current state (reconstructed from git history — see note below)

- `Employees` sheet columns: `id, name, email, role, dept, job_role, salary,
  join_date, status, vac_total, vac_used, next_raise, employment_state`.
- `SalaryHistory` sheet columns: `id, employee_id, date, previous_salary,
  new_salary, pct_change, reason, applied_by`.
- `EmployeeCreate` / `EmployeeUpdate` (`be/models.py`): single `salary: float`.
- `RaiseApply` (`be/models.py`): `employee_id, mode ("pct"|"amount"|"new"),
  value, effective_date, reason`.
- `POST /api/salary/raise` (`be/routers/salary.py::apply_raise`): computes a
  single `new_salary` from `current_salary` + `mode`/`value`, writes one
  `SalaryHistory` row, updates `Employees.salary` and `next_raise` (skipped
  if the effective date is backdated more than 1 day).
- `GET /api/salary/history`: employee-scoped via `resolve_employee_scope`
  (see `docs/analysis/architecture-review-plan.md`); returns `SalaryHistory`
  rows as-is.
- Sheets schema self-heals via `SheetsClient._ensure_required_columns()` +
  the `REQUIRED_COLUMNS` dict in `be/sheets_client.py` — new columns are
  appended to existing tabs automatically on startup. **This is the
  mechanism we'll reuse for the new salary columns**, so no manual
  spreadsheet surgery is needed on deploy.

> Note on how this was reconstructed: direct `get_file_contents` reads of
> `be/models.py` / `be/routers/salary.py` did not surface readable text in
> this session (see `AGENTS.md`, "GitHub tool quirk"). Current file state
> was instead reconstructed by walking `list_commits` (filtered by path)
> and `get_commit(detail="full_patch")` from the initial commit forward,
> per the fallback procedure `AGENTS.md` documents. This plan should be
> spot-checked against the real files at implementation time in case
> anything landed between this analysis and implementation.

## Data model changes

### `Employees` sheet — replace `salary` with two components

New columns (added via `REQUIRED_COLUMNS`, so existing sheets migrate
automatically):
- `internal_salary_usd: float` — Internal component, USD.
- `external_salary_usd: float` — External component, USD.

`salary` (legacy single EGP-ish field) is **kept temporarily** for
backward compatibility with any code/reports not yet migrated, but is no
longer the source of truth once this phase ships. It will be dropped in a
later cleanup phase after frontend + any reporting is confirmed migrated
(explicitly out of scope here, to keep this change small).

Migration behavior for existing rows: on first run after this change,
existing `salary` values are **not** auto-split (no reliable way to infer
the internal/external ratio). Both new columns default to `0` for
pre-existing rows via the standard `_ensure_required_columns` behavior
(new column, blank cells). A one-time admin data-entry pass (or a small
one-off script, not part of this phase) will be needed to populate real
internal/external values for current employees.

### `SalaryHistory` sheet — record both components per entry

New columns:
- `previous_internal_usd: float`
- `previous_external_usd: float`
- `new_internal_usd: float`
- `new_external_usd: float`

`previous_salary` / `new_salary` (legacy) are kept as the **sum** of the
two components for backward compatibility with any existing frontend chart
code that reads them directly, until the frontend phase migrates off them.

`pct_change` continues to represent the **combined** percentage change
(see computation rule below) — this is what the user asked for explicitly:
raises to one or both components computed as a percentage over the total.

## `RaiseApply` model changes

```python
class RaiseApply(BaseModel):
    employee_id: int
    mode: Literal["pct", "amount", "new"]
    value: float
    target: Literal["internal", "external", "both"] = "both"
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"
```

- `target` is new. Defaults to `"both"` to keep existing callers (frontend
  not yet updated) working with today's semantics-nearest equivalent.
- `mode`/`value` keep their existing meaning but now apply only to the
  component(s) selected by `target`:
  - `target="internal"`: raise applies only to `internal_salary_usd`.
  - `target="external"`: raise applies only to `external_salary_usd`.
  - `target="both"`: raise applies to each component independently using
    the same `mode`/`value` (e.g. `pct=10` gives +10% to internal AND
    +10% to external separately) — this keeps `pct` mode meaningful per
    component rather than splitting the value across them.

## Raise computation rule (percentage over the **total**)

This is the key behavioral requirement: whichever component(s) receive the
raise, the reported `pct_change` must be computed against the **combined**
total, not the individual component. Worked example:

- Employee: `internal_salary_usd=1000`, `external_salary_usd=500` → total
  `1500`.
- Admin applies `mode="amount", value=150, target="internal"`.
- New internal = `1150`, external unchanged = `500` → new total `1650`.
- `pct_change = (1650 - 1500) / 1500 * 100 = +10.0%` (NOT +15%, which
  would be `150/1000` — that's the internal-only view, not what gets
  stored/displayed as the headline `pct_change`).

Pseudocode for `apply_raise`:

```python
current_internal = float(emp["internal_salary_usd"] or 0)
current_external = float(emp["external_salary_usd"] or 0)
current_total = current_internal + current_external

def _raise_component(current: float, mode: str, value: float) -> float:
    if mode == "pct":
        return round(current * (1 + value / 100), 2)
    if mode == "amount":
        return round(current + value, 2)
    return round(value, 2)  # mode == "new"

new_internal = _raise_component(current_internal, payload.mode, payload.value) \
    if payload.target in ("internal", "both") else current_internal
new_external = _raise_component(current_external, payload.mode, payload.value) \
    if payload.target in ("external", "both") else current_external
new_total = new_internal + new_external

if new_total <= 0 or new_internal < 0 or new_external < 0:
    raise HTTPException(400, "Resulting salary must be positive")

pct_change = round((new_total - current_total) / current_total * 100, 2) \
    if current_total > 0 else 0.0
```

Edge case to flag explicitly for review: `mode="new"` with `target="both"`
is ambiguous (does `value` mean the new total, split how? or the new value
for each component identically?). Proposed resolution: disallow this
specific combination with a 400 error ("Set a new salary for internal or
external individually, not both at once") — `mode="new"` will only be
valid with `target="internal"` or `target="external"`. `target="both"` is
only valid with `mode` in `("pct", "amount")`. This should be confirmed
with you before implementation.

## Audit log

`audit_log(...)` call in `apply_raise` gets a richer `details` string
reflecting both components, e.g.:
`"internal: 1000.0 -> 1150.0, external: 500.0 -> 500.0, total: 1500.0 -> 1650.0 (+10.00%), target=internal, reason=..."`

## Explicitly out of scope for this phase (tracked as follow-ups)

1. Frontend (`fe/`) changes — raise modal UI to pick target
   (internal/external/both), salary table columns, salary chart. Separate
   phase once backend is reviewed/merged.
2. Dropping the legacy `salary` / `previous_salary` / `new_salary` columns.
3. Any currency conversion / EGP display — both components stay USD-only,
   no FX logic anywhere in this phase.
4. Backfilling real internal/external split for existing employees (manual
   HR data entry, not code).
5. `EmployeeCreate` / `EmployeeUpdate` — decide whether to keep accepting
   a flat `salary` for quick-create convenience or require
   `internal_salary_usd` + `external_salary_usd` explicitly. Leaning
   towards requiring both explicitly (clearer, avoids silent 0/0 splits)
   but flagging for your confirmation before changing `models.py`.

## Open questions for you before implementation

1. Confirm the `mode="new"` + `target="both"` restriction above (disallow
   vs. some other interpretation).
2. Should `EmployeeCreate` require both USD components explicitly, or
   default them to `0` and let the first raise establish real values?
3. Any preference on keeping vs. dropping the legacy `salary` field
   sooner rather than later, given it stays unused after this phase?
