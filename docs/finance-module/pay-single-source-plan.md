# Pay has one stored source (PAY-1): implementation plan

Status: IMPLEMENTED on `refactor/pay-single-source` (from `origin/main` at `09a3b78`), awaiting review. Decision: **D-046**. Risk class: **high** (schema migration that drops columns, money-adjacent data).
Origin: a wrong compensation row corrected directly in the database did not show in the app, because the same pay was stored in three places and only the app kept them in step. Owner approved the corrected scope on October 27, 2026. No payroll data has been entered yet.

## 1. Findings (audit, October 27, 2026)

| Where | Role before | Role after |
| :--- | :--- | :--- |
| `finance_employee_compensation_plans` | Drives payroll (dated rows per component) | **The only stored source of amounts** (unchanged) |
| `employees.salary`, `internal_salary_usd`, `external_salary_usd` | Cached copy of the current plan amounts, kept in step by `_sync_employee_fields` | **Dropped.** The API keeps the same field names and derives them from the plan in force today (`finance/current_pay.py`) |
| `salary_history` | Log of pay changes with reason, author, percentage, date | **Kept** as an append-only event log (the plan table has no reason or author and one raise is one event, not two rows) |
| `salary_history.previous_salary`, `new_salary` | Totals, superseded by the internal/external split | **Dropped.** Derived as internal + external on read |

History: the employee salary columns and `salary_history` came with the first SQL engine (2026-08-23); the plan table came later (FUX-416/417, 2026-09-17).

## 2. Design

- `finance/current_pay.py`: `current_pay_map` and `current_pay` return, per employee, the internal, external and total amounts of the plan rows in force on a day (default today): `effective_start_date <= day` and `effective_end_date` empty or `>= day`. One query serves a whole list.
- Employee API responses (`GET /api/employees`, detail), the employee export, salary payment docs (they read `external_salary_usd` from the employee dict), the raise flow and `salary_history` responses keep every field name, so **no frontend change** and no API contract change.
- Writers: `CompensationPlanService` no longer syncs employee columns; the history row is written in the same transaction as before without the two total columns. `SqlEmployeeRepository.create` ignores salary keys (pay is only set through the Pay plan, D-036).
- Payroll: the fallback `employees.internal_salary_usd` when an employee has no internal component is now `0.0`. It was reachable only for an employee with an external plan and a stale internal column.
- Migration `0048_pay_single_source`: drops the five columns (batch mode for SQLite) and logs, per employee, any old amount that differs from the plan in force today, so nothing is lost silently. It writes nothing to the plan table. Downgrade re-adds the columns and refills them from the plan in force today and from the history split.
- `scripts/check_pay_columns.py`: read-only check to run before upgrading production; lists the same differences.
- Removed: `scripts/backfill_compensation_plans_from_employee_fields.py` (copied the old columns into plans; the columns no longer exist). The Sheets backfill no longer reads salary columns; old single-total history rows are kept as internal amounts.

## 3. Risks and mitigations

| Risk | Mitigation |
| :--- | :--- |
| Dropping columns cannot be undone without a backup | Verified `pg_dump` before production; trial on a copy; downgrade provided |
| An employee with an old amount in the columns but no matching plan loses that amount | `check_pay_columns.py` before upgrading and the migration log; fix the plan first |
| A missed reader shows zero pay | All readers found by search, covered by tests; API names unchanged |
| Tests that built employees with salary columns | Updated to create plan rows, which is what payroll reads |

## 4. Production steps (owner)

1. Back up the database.
2. From `be/`, run `python scripts/check_pay_columns.py` and fix any listed difference in the Pay plan.
3. Deploy; the migration runs. Check the log for "pay columns dropped" warnings.
4. Open an employee card and the Pay plan modal: the amounts match the plan.
