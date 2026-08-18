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

`salary` (legacy single EGP-ish field) is **kept temporarily** on the sheet
itself for backward compatibility with any code/reports not yet migrated,
but is no longer the source of truth once this phase ships, and the API no
longer writes to it (see "DECIDED" section below). It will be dropped from
the sheet in a later cleanup phase after frontend + any reporting is
confirmed migrated (explicitly out of scope here, to keep this change
small).

Migration behavior for existing rows: on first run after this change,
existing `salary` values are **not** auto-split (no reliable way to infer
the internal/external ratio). Both new columns default to `0` for
pre-existing rows via the standard `_ensure_required_columns` behavior
(new column, blank cells). A one-time admin data-entry pass (via
`EmployeeUpdate`, not a script) will be needed to populate real
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

## `EmployeeCreate` / `EmployeeUpdate` — DECIDED

Confirmed by user: **both `internal_salary_usd` and `external_salary_usd`
are required on create** (no defaults). `0` is a valid explicit value for
either component (e.g. an employee who is 100% Internal has
`external_salary_usd=0`, not a missing field) — validation requires the
fields to be *present*, not non-zero.

```python
class EmployeeCreate(BaseModel):
    name: str
    email: EmailStr
    dept: str = ""
    job_role: str = ""
    internal_salary_usd: float  # required, no default — 0 is valid
    external_salary_usd: float  # required, no default — 0 is valid
    join_date: str = ""
    status: str = "Active"
    vac_total: int = 21
    next_raise: str = ""
    employment_state: EmploymentState = "Full-Time"
    # `salary` field removed from EmployeeCreate entirely — no legacy
    # flat-salary create path once this ships.
```

`EmployeeUpdate` keeps both as `Optional[float] = None` (standard partial-
update semantics already used for every other field on this model — `None`
means "don't touch", not "set to zero"; the endpoint's existing
`{k: v for k, v in payload.model_dump().items() if v is not None}` pattern
in `be/routers/employees.py::update_employee` already handles this
correctly with no changes needed there).

## `RaiseApply` model changes — DECIDED

Confirmed by user: **a raise can change one component or both** in a
single call, and when `mode="new"` targets both components, **each
component's new value must be set explicitly** — the total is never
supplied directly, it's always derived (`new_total = new_internal +
new_external`). This resolves the earlier ambiguity cleanly: `mode="new"`
is always a per-component operation, so a single shared `value` field
cannot represent "two different new values" when `target="both"`. The
model therefore needs **separate optional value fields per component**
instead of one generic `value`:

```python
class RaiseApply(BaseModel):
    employee_id: int
    mode: Literal["pct", "amount", "new"]
    target: Literal["internal", "external", "both"] = "both"
    value: Optional[float] = None            # used when target != "both",
                                              # or when target == "both" and
                                              # mode in ("pct", "amount")
                                              # (same value applied to each
                                              # component independently)
    internal_value: Optional[float] = None   # required when target=="both"
                                              # and mode=="new"
    external_value: Optional[float] = None   # required when target=="both"
                                              # and mode=="new"
    effective_date: Optional[str] = None
    reason: str = "Annual performance raise"
```

Validation rules (enforced in the endpoint, not just the type system,
since the "required when" logic is conditional on other fields):
- `target in ("internal", "external")`: `value` is required;
  `internal_value`/`external_value` must be omitted (400 if supplied —
  avoids silent ambiguity about which one wins).
- `target == "both"` and `mode in ("pct", "amount")`: `value` is required
  (applied independently to each component — see computation section);
  `internal_value`/`external_value` must be omitted.
- `target == "both"` and `mode == "new"`: **both** `internal_value` and
  `external_value` are required explicitly (0 is a valid value, same
  "must be present, not necessarily non-zero" rule as `EmployeeCreate`);
  `value` must be omitted. The resulting total is computed automatically
  as `internal_value + external_value` — never supplied directly by the
  caller.

This mirrors the `EmployeeCreate` decision exactly: whenever both
components are being set to explicit new absolute values, both must be
stated by name, and nothing about the total is ever taken as direct
input — it's always a derived sum.

## Raise computation rule (percentage over the **total**)

This is the key behavioral requirement: whichever component(s) receive the
raise, the reported `pct_change` must be computed against the **combined**
total, not the individual component. Worked example (mode="amount"):

- Employee: `internal_salary_usd=1000`, `external_salary_usd=500` → total
  `1500`.
- Admin applies `mode="amount", value=150, target="internal"`.
- New internal = `1150`, external unchanged = `500` → new total `1650`.
- `pct_change = (1650 - 1500) / 1500 * 100 = +10.0%` (NOT +15%, which
  would be `150/1000` — that's the internal-only view, not what gets
  stored/displayed as the headline `pct_change`).

Worked example (mode="new", target="both" — the newly-resolved case):

- Employee: `internal_salary_usd=1000`, `external_salary_usd=500` → total
  `1500`.
- Admin applies `mode="new", target="both", internal_value=1200,
  external_value=500`.
- New total = `1200 + 500 = 1700` (computed, never supplied).
- `pct_change = (1700 - 1500) / 1500 * 100 = +13.33%`.

Pseudocode for `apply_raise`:

```python
current_internal = float(emp["internal_salary_usd"] or 0)
current_external = float(emp["external_salary_usd"] or 0)
current_total = current_internal + current_external

def _apply_mode(current: float, mode: str, value: float) -> float:
    if mode == "pct":
        return round(current * (1 + value / 100), 2)
    if mode == "amount":
        return round(current + value, 2)
    return round(value, 2)  # mode == "new"

if payload.target == "both" and payload.mode == "new":
    # Explicit per-component absolute values required - see validation
    # rules above. Total is always derived, never a direct input.
    new_internal = round(payload.internal_value, 2)
    new_external = round(payload.external_value, 2)
elif payload.target == "both":
    # mode in ("pct", "amount"): same `value` applied independently to
    # each component (e.g. pct=10 -> both components individually +10%).
    new_internal = _apply_mode(current_internal, payload.mode, payload.value)
    new_external = _apply_mode(current_external, payload.mode, payload.value)
elif payload.target == "internal":
    new_internal = _apply_mode(current_internal, payload.mode, payload.value)
    new_external = current_external
else:  # target == "external"
    new_internal = current_internal
    new_external = _apply_mode(current_external, payload.mode, payload.value)

new_total = new_internal + new_external

if new_total <= 0 or new_internal < 0 or new_external < 0:
    raise HTTPException(400, "Resulting salary must be positive")

pct_change = round((new_total - current_total) / current_total * 100, 2) \
    if current_total > 0 else 0.0
```

## Audit log

`audit_log(...)` call in `apply_raise` gets a richer `details` string
reflecting both components, e.g.:
`"internal: 1000.0 -> 1150.0, external: 500.0 -> 500.0, total: 1500.0 -> 1650.0 (+10.00%), target=internal, reason=..."`

## Explicitly out of scope for this phase (tracked as follow-ups)

1. Frontend (`fe/`) changes — raise modal UI to pick target
   (internal/external/both) and, for the `mode="new"` + `target="both"`
   case, two separate new-value inputs instead of one; Add Employee form
   fields for both USD components; salary table columns; salary chart.
   Separate phase once backend is reviewed/merged.
2. Dropping the legacy `salary` / `previous_salary` / `new_salary` columns
   from the sheets themselves (the `EmployeeCreate` model no longer writes
   `salary`, but the column and any pre-existing values remain on the
   sheet until a later cleanup phase).
3. Any currency conversion / EGP display — both components stay USD-only,
   no FX logic anywhere in this phase.
4. Backfilling real internal/external split for existing employees (manual
   HR data entry via `EmployeeUpdate`, not a script) — existing rows will
   show `0`/`0` until an admin edits them.

## Open questions

None outstanding — all three original open questions are now resolved:
`EmployeeCreate` requires both USD fields explicitly, raises may target
one or both components, and `mode="new"` + `target="both"` requires both
new values explicitly with the total always derived. Ready to move to
implementation (`be/models.py`, `be/routers/salary.py`,
`be/sheets_client.py` schema/`REQUIRED_COLUMNS` entries) pending final
go-ahead.
