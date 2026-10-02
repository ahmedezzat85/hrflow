# HRFlow — Start Here

**Status:** Active project entrypoint  
**Last verified against:** `feature/rbac` at `c236b00cb6fea09cb3474cb8d5fbda66eb23135e` (equal to `main`)  
**Last updated:** October 1, 2026 (reconciled with code)  
**Authority:** Index of the project-context documentation set  

## 1. What HRFlow is

HRFlow is the internal HR and finance operations platform for Voyance Health, supporting administrative operations, employee self-service, financial workflows, and operational reporting. The system uses a FastAPI backend backed by SQLAlchemy and Alembic migrations, alongside a vanilla HTML, CSS, and JavaScript frontend bundled via Vite into a single-file distribution. Relational SQL persistence serves as the authoritative data store for all records, while Google Sheets integration functions strictly as an export-only reporting sink.

## 2. Read these first

Before initiating architectural changes, writing code, or making design assumptions, consult the authoritative documentation set:

| Need | Read |
| :--- | :--- |
| Implementation reality | [01-repository-baseline.md](01-repository-baseline.md) |
| Architecture/boundaries | [02-architecture-and-domain-boundaries.md](02-architecture-and-domain-boundaries.md) |
| Approved decisions | [04-decision-log.md](04-decision-log.md) |
| Recommended sequence | [05-roadmap-and-next-slices.md](05-roadmap-and-next-slices.md) |
| Unresolved owner choices | [06-open-questions.md](06-open-questions.md) |
| RBAC design, role matrix, and delivery plan | [rbac/technical-spec.md](rbac/technical-spec.md), [rbac/permission-matrix.md](rbac/permission-matrix.md), [rbac/implementation-plan.md](rbac/implementation-plan.md) |
| Finance history/design context | [00-architecture-blueprint.md](../finance-module/00-architecture-blueprint.md) and [01-implementation-plan.md](../finance-module/01-implementation-plan.md) |

Consulting these documents first preserves domain boundaries, avoids repetitive codebase exploration, and ensures alignment with verified implementation realities.

## 3. Current working reference

As of October 1, 2026, `main` and `feature/rbac` are both at commit `c236b00cb6fea09cb3474cb8d5fbda66eb23135e`; the RBAC documentation work is in the `feature/rbac` working tree. Per the branch-awareness rule, `main` is the stable baseline, and for a task on another branch that branch and its HEAD are the implementation truth. Feature branches, draft pull requests, and exploratory branches do not represent implementation truth for other work unless audited or merged into `main`.

Previously recorded conflict, now resolved in code: decision D-006 (missing employee bank details are a warning, not a blocker) is implemented. `be/finance/services/payroll_service.py` emits a `MISSING_BANK_DETAILS` readiness exception with severity `warning` for employees who have an external-USD component and no IBAN on file. Only employees paid through an external-USD component are checked; whether employees with only internal components should also be flagged has not been decided.

The payroll scope audit (roadmap Slice 1, `docs/project-context/payroll-scope-audit.md`) has not been produced, so decisions D-003 to D-007 have not been systematically reconciled with code.

Do not start implementation automatically; always evaluate incoming tasks against the current task and roadmap before introducing modifications to the codebase.

## 4. Current next action

The accepted direction is the RBAC initiative (decisions D-011 to D-013, roadmap section 3A, plan in [rbac/implementation-plan.md](rbac/implementation-plan.md)). Slice 1 (catalog, roles, schema) starts only after the pre-migration data check on a copy of the production database (gate G3) and the owner's go-ahead.

Open questions Q-006 to Q-009 and Q-011 to Q-013 are open with interim treatments; Q-001 to Q-005 remain unresolved. None of them may be assumed during planning, architecture, or implementation.

## 5. Rules for a new thread

Whenever starting a new thread or resuming work, adhere to this sequence:

1. Confirm branch and commit: state the active branch, its HEAD, and the merge-base with `main` (branch-intake block).
2. Read only the relevant context documents: inspect specific project-context documents pertinent to the current task rather than reloading all documentation.
3. State scope, verified current behavior, assumptions, and open-question gates: clarify the intended boundary, verify actual baseline behavior in code, and highlight open questions.
4. Propose a small plan and acceptance criteria before changing code: obtain confirmation on a bounded implementation plan and test strategy before editing.
5. End with a handoff: outcome, changed files, tests, decisions, and next step: deliver a structured completion summary highlighting changed files, test results, and next actions.
