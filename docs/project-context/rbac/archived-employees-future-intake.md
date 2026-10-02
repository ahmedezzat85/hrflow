# Future Intake — Archived Employees (working name was "Departed")

**Status:** Pending / future. Not designed. Recorded so the topic is not lost. Written to the `feature/rbac` working tree for owner review.  
**Date raised:** October 1, 2026  
**Recorded in:** `../05-roadmap-and-next-slices.md`, section "4A. Future Intake".  
**Owner decisions so far:** the state is called **Archived** for both employees and external users (the earlier working name "Departed" is retired).

## 1. What this is

Today an employee who leaves can only be deleted. There is no "left the company" state, so history is lost on deletion or the record stays "Active" forever. The owner wants an Archived state for employees that keeps their history and guarantees they never get access to HRFlow again, matching the Archived state for external users in D-012.

## 2. Why it is separate from the RBAC work

The RBAC initiative needs only the *user* side (archived users are blocked at sign-in and on every request). Archiving *employee* records touches HR data, payroll history, documents, reports and exports, which is a different scope and not RBAC-related.

## 3. Constraints already decided that this feature must respect

- **Archived users keep roles for history and have no access** (D-012). An archived employee's linked user is archived with them.
- **Employee baseline is derived from the employee link.** Archiving an employee must therefore cut access explicitly, not only by relying on the link, because the link would still exist.
- **Deletion rules stay:** an employee with elevated roles cannot be deleted until the Users page revokes them; no one can delete or archive themselves; the last Super-Admin is protected.
- **No separate disable switch.**

## 3a. Interim behavior until built

Departure means deletion. Deleting a baseline-only employee also removes their linked user, which ends their access. Deletion of an employee who appears in payroll runs, salary payment documents or ledger records has not been examined (see open points).

## 4. Open points to design later

- What "Archived" does to an employee record: hidden from default lists, still visible in history, filters, counts.
- Behavior in payroll preparation (excluded from new runs, retained in past runs), salary payment documents, reports and exports.
- Whether an archived employee can be restored, and how that relates to Q-006 (restore of archived users).
- What happens to their documents, vacations balance, claims, bank details and compensation plan.
- Whether Archived replaces the existing employee `status` values (for example Active / On Leave) or sits alongside them.
- Whether archiving an employee and archiving their user is one action or two.
- Impact on the unique email constraint when a person returns.

## 5. Roadmap entry (as recorded)

> **Archived employees (future intake).** Introduce an Archived state for employees, replacing delete-on-departure, with history preserved and access permanently blocked. Depends on the RBAC identity-lifecycle work (D-012). Not designed; see `archived-employees-future-intake.md` (final location to be chosen).
