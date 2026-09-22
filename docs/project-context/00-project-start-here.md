# HRFlow — Start Here

**Status:** Active project entrypoint  
**Last verified against:** `main` at `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`  
**Last updated:** September 22, 2026  
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
| Finance history/design context | [00-architecture-blueprint.md](../finance-module/00-architecture-blueprint.md) and [01-implementation-plan.md](../finance-module/01-implementation-plan.md) |

Consulting these documents first preserves domain boundaries, avoids repetitive codebase exploration, and ensures alignment with verified implementation realities.

## 3. Current working reference

The current working reference for the project is `main` at commit `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`. Feature branches, draft pull requests, and exploratory branches do not represent implementation truth unless specifically audited or merged into `main`.

An existing payroll audit established that decision D-006 conflicts with the current implementation on `main`:
- Missing employee bank details currently block workflow progression during payroll run preparation.
- In contrast, accepted decision D-006 requires a visible, non-blocking warning when employee bank details are absent.

Do not start implementation automatically; always evaluate incoming tasks against the current task and roadmap before introducing modifications to the codebase.

## 4. Current next action

The first validated roadmap action is to reconcile and implement the narrow D-006 non-blocking bank-details behavior, but only when the project owner chooses to resume code implementation.

The project may instead first undertake further product discovery, requirements refinement, or strategic planning work beyond the current roadmap before restarting code changes.

Open questions Q-001 through Q-005 remain unresolved and must not be assumed during planning, architecture, or implementation.

## 5. Rules for a new thread

Whenever starting a new thread or resuming work, adhere to this sequence:

1. Confirm branch and commit: verify that the workspace is on `main` at commit `9d6394aeeaa3631d1787a6a94b8181da3c0c3690`.
2. Read only the relevant context documents: inspect specific project-context documents pertinent to the current task rather than reloading all documentation.
3. State scope, verified current behavior, assumptions, and open-question gates: clarify the intended boundary, verify actual baseline behavior in code, and highlight open questions.
4. Propose a small plan and acceptance criteria before changing code: obtain confirmation on a bounded implementation plan and test strategy before editing.
5. End with a handoff: outcome, changed files, tests, decisions, and next step: deliver a structured completion summary highlighting changed files, test results, and next actions.
