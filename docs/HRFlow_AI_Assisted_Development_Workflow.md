# HRFlow AI-Assisted Development Workflow

**Status:** Active working guide  
**Last updated:** September 22, 2026  
**Purpose:** A practical workflow for using Perplexity and coding agents to discuss, plan, implement, review, and preserve context for HRFlow.

---

## 1. Purpose and Principles

This guide defines how to use Perplexity Project context and coding agents without losing product decisions, repository truth, or branch-specific implementation context.

The workflow is designed for HRFlow, an HR and Finance operations platform where changes can affect employee data, payroll, statutory obligations, financial records, permissions, documents, and reports.

### Core principles

1. **GitHub is the implementation source of truth.**
   Current code, migrations, tests, and reviewed repository documents determine what the application actually does.

2. **Perplexity is the context, discovery, planning, and review workspace.**
   Use it to explore ideas, compare options, produce feature briefs, construct implementation plans, review agent output, and preserve concise handoffs.

3. **`main` is the stable integrated baseline.**
   It contains the shared architecture, accepted project-wide decisions, and merged behavior.

4. **The active branch is the implementation truth for the current task.**
   When working on a branch, do not assume `main` includes the branch's work. Always identify the branch, current HEAD, and merge base when task details depend on current code.

5. **A commit SHA is the evidence anchor.**
   Use commit references in audits, handoffs, and review notes so a claim can be tied to the exact repository state reviewed.

6. **Start light; escalate deliberately.**
   Do not force full engineering intake during open brainstorming. Increase context and structure when a discussion can create durable requirements, a decision, or an implementation plan.

7. **Separate discovery, decision, planning, implementation, and review.**
   Exploratory suggestions are not requirements. A plan is not implementation. Passing tests are not sufficient proof of correct product behavior.

8. **Do not let an agent decide unresolved business policy.**
   Questions in the open-question register must be resolved by the owner before implementation depends on their answer.

---

## 2. Authoritative Context

### 2.1 Source-of-truth hierarchy

When documentation, chat history, code, or a feature branch disagree, apply this order:

1. Current code, migrations, and tests on the active working branch.
2. Project-wide context documents on `main`.
3. Approved domain documentation, including current finance-module documentation.
4. Explicit acceptance criteria for the current approved task.
5. Previous Perplexity Project threads that do not conflict with the above.
6. Historical roadmaps, completed plans, branch notes, and old discussion as reference only.

### 2.2 Core project-context documents

Read only the documents relevant to the task. Do not load everything by default.

| Need | Primary reference |
|---|---|
| Quick project entrypoint | `docs/project-context/00-project-start-here.md` |
| Verified repository reality | `docs/project-context/01-repository-baseline.md` |
| Architecture, domains, and boundaries | `docs/project-context/02-architecture-and-domain-boundaries.md` |
| Owner-approved durable decisions | `docs/project-context/04-decision-log.md` |
| Sequenced delivery and next slices | `docs/project-context/05-roadmap-and-next-slices.md` |
| Unresolved owner-level decisions | `docs/project-context/06-open-questions.md` |
| Finance architecture/history | `docs/finance-module/00-architecture-blueprint.md` and `01-implementation-plan.md` |

### 2.3 Stable baseline and branch overlay

Use a two-layer model:

| Layer | What it provides | Reference |
|---|---|---|
| Stable baseline | Shared architecture, approved decisions, merged behavior, current project direction | `main` and its project-context documents |
| Working overlay | Current task code, branch-specific docs, changed tests, branch progress, implementation delta | Active branch and its current HEAD |

**Rule:** `main` explains the accepted product baseline; the active branch explains what the current task is changing; the commit SHA proves what was reviewed.

### 2.4 Link policy

- Keep stable project-context documents linked from `main` in the Perplexity Project.
- Prefer repository links or GitHub-connected references over uploaded duplicate copies.
- Use immutable commit-SHA links for audits, handoffs, and historical evidence.
- Use branch links for an active feature task, feature plan, pull request, compare view, or branch-specific handoff.
- Use relative Markdown links inside repository documents so documentation works across branches.
- Never treat an unmerged branch as global project truth.

---

## 3. Perplexity Project Setup

### 3.1 What belongs in the Project

Keep the Project focused on durable context:

- Project operating instructions.
- The small project-context document set.
- Current architecture or product documents when they are authoritative.
- Reviewed feature plans that span multiple sessions.
- Decision summaries and implementation handoffs.
- Research notes that remain useful beyond a single task.

### 3.2 What does not belong in the Project

Avoid adding:

- Full exports of old chats.
- Duplicate copies of repository documents when repository links are available.
- `.env` files, credentials, API keys, tokens, certificates, or production configuration secrets.
- Production databases, unredacted payroll exports, employee data, medical documents, or sensitive financial files.
- Build output, dependencies, generated binaries, or large transient artifacts.
- Historical roadmaps unless a specific task needs them.

### 3.3 Project-level operating rule

The Project should help an agent understand:

- What HRFlow is.
- Which sources are authoritative.
- Which decisions are accepted.
- Which questions remain unresolved.
- How to begin and close a task.

The Project should not replace GitHub as the source of truth for code, tests, documents, branches, commits, pull requests, or production operations.

---

## 4. Choosing the Right Intake Level

Use one of three intake levels at the start of a fresh Perplexity thread.

| Thread type | Intake level | Typical examples |
|---|---|---|
| Free ideation or general research | Level 0: Discovery | Explore a UX idea, naming, product pain point, alternative workflows |
| Context-aware product/design discussion | Level 1: Discussion | Discuss how a feature fits HRFlow, prototype a workflow, compare design approaches |
| Feature planning, architecture, data/security changes, code review, coding-agent handoff | Level 2: Full planning | Prepare a plan, change payroll, finance, permissions, documents, schemas, or cross-domain behavior |

### 4.1 Decision rule

Ask these questions:

- Could this discussion create a requirement, decision, or implementation plan that changes the repository?
  - If yes, start with at least **Level 1**.
- Could it affect money, payroll, employee data, permissions, security, architecture, documents, exports, database behavior, or multiple domains?
  - If yes, use **Level 2** before approving a plan.
- Is it only a rough idea with no expected repository consequence yet?
  - Use **Level 0**.

---

## 5. Level 0: Free Discovery

Use Level 0 for unconstrained exploration before a requirement or solution has been selected.

### Prompt template

```text
We are in discovery mode for HRFlow.

Topic:
<idea, workflow, problem, or feature area>

Goal:
Understand the problem, user workflow, options, trade-offs, and likely constraints.

Relevant context:
- Domain: <HR / Finance / Payroll / Core / Employee Portal>
- Relevant decisions or questions, if known: <D-xxx / Q-xxx>
- Working branch, if relevant: <branch and SHA>; otherwise, no implementation branch is in scope.

Rules:
- Do not propose code changes, migrations, or an implementation plan yet.
- Do not treat exploratory ideas as approved requirements.
- Separate confirmed facts, assumptions, options, and open questions.
- Flag if this discussion could conflict with an accepted decision or an open question.

Start by helping me clarify the problem and alternatives.
```

### End-of-discovery checkpoint

Before moving to a design or plan, ask:

```text
Summarize this discussion into:
1. Confirmed requirements
2. Candidate options and trade-offs
3. Rejected ideas
4. Assumptions
5. Open questions requiring owner decision
6. Decisions that should be recorded if I approve them

Do not create an implementation plan yet.
```

### When to escalate

Move from Level 0 to Level 1 when the discussion starts depending on existing HRFlow behavior, a specific module, a branch, a decision-log entry, or an open question.

---

## 6. Level 1: Context-Aware Discussion

Use Level 1 when you want free but grounded feature, UX, workflow, prototype, or architecture discussion.

### Prompt template

```text
HRFlow context-aware discussion

Topic:
<feature, design, workflow, prototype, or problem>

Working branch and HEAD:
<branch> / <SHA>

Base branch and merge base:
<base branch> / <SHA>

Read only the context needed for this discussion:
- docs/project-context/00-project-start-here.md
- <specific relevant project-context documents>
- <specific module documentation or code, if known>

Before proposing a direction:
1. State the verified current behavior relevant to this topic.
2. Identify applicable decisions (D-xxx) and open questions (Q-xxx).
3. Identify branch-specific differences from the base, if material.
4. Separate implementation facts from design possibilities.

Then help me explore the design. Do not create an implementation plan or propose
repository changes until I explicitly ask.
```

### Use Level 1 for

- UX and workflow refinement.
- Prototyping before implementation.
- Feature shape and user journey discussions.
- Deciding whether a concern belongs in HR, Finance, or Core.
- Comparing architectural options before selecting one.
- Debugging discussion where you know the branch, reproduction, and expected behavior.

### Example: payroll UX

```text
HRFlow context-aware discussion

Topic:
Improve the payroll worksheet so HR can review standing compensation, optional monthly
bonuses/commissions, deductions, and bank-data warnings efficiently before approval.

Working branch and HEAD:
feature/payroll-deductions / <SHA>

Base branch and merge base:
main / <SHA>

Read:
- docs/project-context/02-architecture-and-domain-boundaries.md
- docs/project-context/04-decision-log.md
- docs/project-context/06-open-questions.md
- relevant payroll UI and service code on this branch

Pay special attention to D-003 through D-007. Do not resolve Q-001.

First state verified current behavior and branch differences. Then help me explore
workflow and UI options. Do not create an implementation plan yet.
```

---

## 7. Level 2: Full Planning Intake

Use Level 2 when you are ready to produce a plan that may be passed to the coding agent.

### Mandatory use cases

Use a full intake for:

- Payroll, finance, statutory, accounting, or exports.
- Employee data, documents, compensation, or HR workflow changes.
- Authentication, authorization, RBAC, security, privacy, or audit changes.
- Database models, migrations, data backfills, or persistence changes.
- Architecture changes or cross-domain integration.
- Pull request review or material debugging work.
- Any plan intended for coding-agent implementation.

### Prompt template

```text
HRFlow planning intake

Working branch: <branch>
Working HEAD: <SHA>
Base branch / merge base: <branch> / <SHA>

Feature or problem:
<one concise statement>

Read first:
- docs/project-context/00-project-start-here.md
- Relevant architecture, decision-log, roadmap, and open-question documents
- Relevant code, migrations, tests, and branch diff

Before drafting the plan:
1. State verified current behavior.
2. Define the product goal and success criteria.
3. Separate confirmed facts from assumptions.
4. Identify applicable accepted decisions (D-xxx).
5. Identify open-question gates (Q-xxx).
6. Identify architecture, data, authorization, security, backward-compatibility,
   and test impacts.
7. State explicit in-scope and out-of-scope boundaries.

Then provide an implementation-ready plan with:
- proposed behavior and user flow
- affected modules and interfaces
- data/migration impact
- authorization/security implications
- backward compatibility and rollback approach
- acceptance criteria
- test strategy
- coding-agent handoff

Do not prescribe unverified line-level edits.
```

### Required plan contents

A plan suitable for an agent should contain:

```markdown
# Feature Plan: <name>

## Goal
Business or user outcome.

## Verified Baseline
Branch, commit, known behavior, relevant documents, and relevant tests.

## Scope
In scope and explicitly out of scope.

## Product Rules
Durable behavior that must hold.

## Proposed Design
Workflow, states, validation, permissions, data ownership, and boundaries.

## Implementation Approach
Module-level phased changes, not premature line-by-line edits.

## Data and Migration Impact
No migration / required migration / data conversion / rollback considerations.

## Authorization and Security
Actors, permissions, sensitive data, audit behavior, and failure cases.

## Compatibility and Rollback
Existing behavior that must remain stable and practical rollback path.

## Acceptance Criteria
Observable positive, negative, authorization, and state-transition outcomes.

## Test Strategy
Unit, API, integration, UI, and mock-versus-live limitations.

## Decision Gates
Applicable D-xxx and Q-xxx entries; state what cannot be assumed.

## Coding-Agent Handoff
Working branch, files/modules likely affected, scope limits, and expected report.
```

---

## 8. From Discussion to Approved Work

For meaningful work, progress through these stages deliberately.

### Stage 1: Discover

Explore needs, workflows, user pain, alternatives, risks, and constraints.

**Output:** Discovery checkpoint, not a plan.

### Stage 2: Decide

Choose a direction. Convert the approved direction into stable product rules and a concise feature brief.

Use this request:

```text
Convert only the approved direction into product rules and a scoped feature brief.
Flag any rule that should be added to the decision log or open-question register.
Do not invent unresolved details.
```

**Update durable context when necessary:**

- If the owner has made a lasting choice, add or update an entry in `04-decision-log.md`.
- If a significant owner-level choice remains unresolved, add or update an entry in `06-open-questions.md`.
- Do not add temporary implementation decisions to the decision log.

### Stage 3: Plan

Use Level 2. Produce a plan only after the intended product direction is selected.

**Output:** Implementation-ready plan, still subject to repository validation.

### Stage 4: Coding-agent preflight

The coding agent validates the plan against the actual active branch before modifying anything.

**Output:** Confirmed or corrected implementation plan.

### Stage 5: Implement

The coding agent works in a focused scope, runs appropriate tests, and reports exact results.

### Stage 6: Review

Review implementation against the feature plan, acceptance criteria, source-of-truth documents, actual diff, and test evidence.

### Stage 7: Close and preserve context

Create a handoff. Promote only durable decisions and updated project status into repository documentation.

---

## 9. Coding-Agent Preflight

Never treat a Perplexity plan as unquestionable repository truth. Before implementation, require the agent to reconcile the plan with the active branch.

### Preflight prompt

```text
Validate this proposed plan against the active repository branch before editing code.

Working branch: <branch>
Working HEAD: <SHA>
Base / merge base: <SHA>

Read:
- The implementation plan below
- Relevant docs/project-context files
- Relevant code, migrations, API routes, frontend modules, and tests

Return:
1. A confirmed or corrected current-state summary.
2. Plan items already implemented, obsolete, incomplete, or conflicting with code.
3. Exact files/modules likely to change.
4. Data/migration, authorization, security, backward-compatibility, and test impacts.
5. Any decision-log or open-question gate that blocks implementation.
6. A revised scoped plan and acceptance criteria.

Do not edit files, create branches, run migrations, commit, or push until I approve
the revised plan.
```

### Approve implementation only when

- The branch and commit are confirmed.
- The relevant baseline behavior is evidence-backed.
- The agent identified no unresolved policy that it would need to guess.
- Scope is small enough to review and test.
- Acceptance criteria are observable.
- Migration, permissions, security, data, and rollback impacts are clear where applicable.

---

## 10. Implementation Rules

### 10.1 Keep changes narrow

Prefer a small, independently testable change over a broad mixed refactor. One feature slice should have a coherent outcome and a reviewable diff.

### 10.2 Preserve architecture boundaries

- **Core** owns authentication, sessions, RBAC, shared configuration, and persistence infrastructure.
- **HR** owns employees, employee bank accounts, compensation history, leave, claims, documents, requests, and salary payment documents.
- **Finance** owns company accounts, ledger, bills, sales invoices, payroll runs, statutory obligations, financial reports, and financial exports.
- Cross-domain interaction should use explicit service/domain interfaces rather than presentation-layer coupling or arbitrary cross-domain database updates.

### 10.3 Check accepted decisions and open questions

Before coding, identify relevant `D-xxx` and `Q-xxx` entries.

- Follow accepted decisions.
- Do not silently resolve an open question.
- If the code conflicts with an accepted decision, flag it and scope the alignment work explicitly.
- If the new work introduces a durable product policy, obtain owner confirmation and update the decision log before or alongside implementation.

### 10.4 HRFlow-specific non-negotiables

- SQLAlchemy and Alembic govern persistent schema changes.
- SQL is authoritative persistence; Google Sheets is export-only.
- Sensitive document and bank-data access must remain authenticated and authorized.
- Finance RBAC conventions must not be bypassed; HR legacy guards should be migrated carefully rather than weakened.
- Do not assume a background queue, external payment rail, automated FX feed, or S3-compatible storage exists unless verified.
- For payroll, distinguish internal estimates, portal-confirmed statutory liabilities, actual payments, and variances.
- Do not confuse employee bank accounts with company bank accounts, or HR salary payment documents with Finance sales invoices.

---

## 11. Verification and Review

### 11.1 Passing tests are necessary, not sufficient

Tests may validate old behavior, mock state, or an incomplete integration. Review behavior against the accepted product rules and actual implementation.

For example, a mock-mode Playwright test can pass while the live frontend does not call the backend endpoint that persists the workflow.

### 11.2 Minimum review checklist

Before accepting a change, verify:

- The diff matches the approved scope.
- Product acceptance criteria are satisfied.
- Relevant decisions are honored.
- No open question was silently decided.
- New or changed authorization behavior has allow and deny coverage.
- State transitions have valid and invalid-path coverage.
- Data changes include migrations and rollback considerations where applicable.
- Existing behavior is not unintentionally broken.
- Tests were executed and exact results are provided.
- Mock-only validation is clearly labeled; live API behavior is tested where needed.
- Sensitive data, employee isolation, and document access are not weakened.

### 11.3 Recommended test coverage dimensions

Use the dimensions relevant to the task:

| Dimension | Example |
|---|---|
| Happy path | Authorized HR admin completes an approved workflow |
| Invalid input | Required value absent, unsupported state, invalid amount |
| Authorization | Authorized user succeeds; unauthorized user receives denial |
| Ownership isolation | Employee cannot access another employee's document or payslip |
| State transition | Draft → submitted → approved; invalid transition rejected |
| Empty state | No records, no documents, no eligible payroll run |
| Failure path | Storage error, export error, integration failure, malformed import |
| Compatibility | Existing routes/workflows still operate as before |
| Data integrity | Migration, transaction rollback, idempotency, audit trail |

---

## 12. Task Closure and Handoff

At the end of every material task, require a concise, factual handoff.

### Handoff template

```text
# HRFlow Task Handoff: <task name>

## Reference
- Working branch: <branch>
- Final commit: <SHA>
- Base branch / merge base: <SHA>

## Outcome
- What was completed.
- What was intentionally not changed.

## Files changed
- <path> — <purpose>

## Verified behavior
- <observable behavior and evidence>

## Tests run
- <exact command> — <result>

## Decisions and open questions
- Decisions applied: <D-xxx>
- Open questions not resolved: <Q-xxx>
- New decision or question needed: <if any>

## Risks or follow-up
- Known limitation, deferred work, or validation still needed.

## Context updates
- Documents that need an update, if any.

## Recommended next step
- One narrow next action.
```

### Update durable documentation only when appropriate

| Event | Documentation action |
|---|---|
| Durable owner decision | Add/update `04-decision-log.md` |
| Significant unresolved owner choice | Add/update `06-open-questions.md` |
| Current architecture/boundary changes | Update `02-architecture-and-domain-boundaries.md` |
| Major verified system-state change | Update `01-repository-baseline.md` at a deliberate checkpoint |
| Delivery order changes | Update `05-roadmap-and-next-slices.md` |
| Feature implementation detail only | Keep in code, tests, PR, feature plan, and handoff; do not over-document |

---

## 13. Branch Workflow

### Branch intake template

```text
HRFlow branch intake

Authoritative product/context baseline:
- Repository: HRFlow
- Baseline branch: main
- Baseline commit: <main SHA>
- Read first:
  - docs/project-context/00-project-start-here.md
  - docs/project-context/02-architecture-and-domain-boundaries.md
  - docs/project-context/04-decision-log.md
  - docs/project-context/06-open-questions.md

Working implementation overlay:
- Active branch: <branch name>
- Active commit: <HEAD SHA>
- Base commit or merge-base with main: <merge-base SHA>
- Task: <single feature/fix/review goal>
- Branch-specific documents: <paths, or none>
- Branch-specific changes relative to main: <short summary>

Rules:
- Main defines stable architecture, accepted decisions, and integrated behavior.
- The active branch defines implementation truth for this task.
- If branch behavior conflicts with an accepted decision, flag it; do not silently
  normalize the conflict.
- Do not promote branch-only behavior or unmerged branch decisions into global
  project context without explicit review and merge/approval.
```

### Working with branches that change context documents

If a branch proposes a new architectural decision or changes a context document:

1. Read both the `main` version and the branch version.
2. Treat the branch version as a proposal until reviewed and merged.
3. Record the relevant decision in the decision log when the owner approves it.
4. Do not update the Project-level operating context based on branch-only changes until they are merged or explicitly accepted as project-wide policy.

---

## 14. Common Failure Modes to Avoid

### Treating chat history as implementation truth

Old discussions often describe intended work, abandoned options, or branch-only behavior. Verify through the active branch and current documents.

### Planning directly from a vague request

A vague request can hide authorization, migration, accounting, or integration implications. Use Level 1 or Level 2 intake before committing to a direction.

### Giving an agent an unvalidated plan

The agent may find that modules, routes, migrations, or tests differ from the plan. Require preflight before it edits code.

### Loading every document into every thread

Excess context creates noise. Load the project entrypoint plus only the documents relevant to the topic.

### Promoting branch work too early

Branch code and tests can be incomplete, incorrect, or later abandoned. Keep branch status in branch/PR handoffs until it is merged.

### Letting an open question become a hidden decision

If a choice changes product policy, financial meaning, security, or operational workflow, document it as an open question and obtain owner approval.

### Treating mock UI tests as live integration proof

Mock-mode tests are valuable for UI behavior but may not demonstrate persistence, API calls, authorization, or backend state transitions.

### Over-documenting feature details

Keep enduring rules in project-context documents. Keep implementation-specific details in code, tests, PRs, feature plans, and task handoffs.

---

## 15. Daily Quick Reference

### Before discussion

- Is this Level 0, Level 1, or Level 2?
- Does the branch/commit matter?
- Which one to three context documents are relevant?
- Are there relevant `D-xxx` or `Q-xxx` entries?

### Before planning

- What is verified current behavior?
- What is the desired product outcome?
- What is in scope and explicitly out of scope?
- Does the proposal affect data, payroll, finance, permissions, security, documents, or cross-domain behavior?
- Is any owner decision still needed?

### Before implementation

- Has the coding agent performed preflight against the active branch?
- Is the implementation plan corrected for repository reality?
- Are acceptance criteria and test strategy explicit?
- Are migration, security, authorization, rollback, and compatibility impacts addressed?

### Before merge or acceptance

- Does the diff match the approved scope?
- Do tests prove the intended behavior, including negative cases?
- Are mock-only tests labeled as mock-only?
- Are decisions/open questions still accurate?
- Is the handoff complete?

---

## 16. Default Prompts

### Default discussion prompt

```text
Use the HRFlow Project operating context.

We are discussing: <feature/problem>.
Working branch and commit: <branch> / <SHA>.
Base branch and commit: <base> / <SHA>.

First verify the relevant current behavior from the active branch and relevant
project-context documents. Then help me explore and refine the feature.

Before drafting an implementation plan, provide:
- verified baseline
- product goal
- options and trade-offs
- confirmed requirements
- assumptions
- applicable decisions (D-xxx)
- open-question gates (Q-xxx)
- risks and affected domains

Do not assume unresolved choices or propose code changes until the direction is agreed.
```

### Default planning prompt

```text
Use the HRFlow Project operating context and create an implementation-ready plan.

Working branch and HEAD: <branch> / <SHA>
Base branch / merge base: <base> / <SHA>
Feature: <one concise statement>

First verify current behavior from relevant code, tests, branch diff, and project-context
documents. Then provide scope, product rules, module-level approach, data/migration
impact, authorization/security implications, acceptance criteria, test strategy,
rollback considerations, D-xxx/Q-xxx gates, and a coding-agent handoff.

Do not prescribe unverified line-level edits.
```

### Default coding-agent preflight prompt

```text
Validate the proposed implementation plan against the active branch before editing.

Branch / HEAD: <branch> / <SHA>
Base / merge base: <base> / <SHA>

Return verified baseline, conflicts or obsolete plan items, affected files, data and
security impacts, decision/open-question gates, a corrected scoped plan, and acceptance
criteria. Do not edit, commit, or push until I approve.
```

---

## My Prompts
This is by me

### Concuding design thread

```text
We have completed the discovery and design discussion.

Create a Design Handoff for the next planning thread. This is not yet an
implementation plan.

Include only the final approved direction and clearly separate it from assumptions.

Use this structure:

# Feature Design Handoff — <feature name>

## Reference
- Working branch and HEAD: <branch> / <SHA>
- Base branch and merge base: <base> / <SHA>
- Relevant project-context documents reviewed
- Relevant D-xxx decisions
- Relevant Q-xxx questions that remain unresolved

## Problem and objective
- Business/user problem
- Intended outcome
- Success criteria

## Confirmed product rules
- Rules explicitly agreed in this thread
- Required behavior
- Validation and edge-case behavior
- Permission/role expectations
- UI/workflow expectations

## Selected design
- Chosen workflow and states
- Data ownership and domain boundaries
- Inputs, outputs, calculations, snapshots, and audit expectations
- What must remain configurable or effective-dated

## Explicitly out of scope
- Items deliberately deferred
- Related work that is not part of this feature

## Unresolved questions and constraints
- Q-xxx entries that remain open
- Assumptions that the implementation plan must not make
- Decisions that block only specific future stages

## Risks and design cautions
- Data integrity, payroll, finance, authorization, backward compatibility,
  performance, or migration risks

## Planning instructions
- What the next planning thread must verify in code before producing a plan
- Expected plan sections
- Required acceptance and test coverage

Do not create an implementation plan.
Do not introduce new requirements.
Do not turn an unresolved question into an assumed answer.
```

## Final Operating Rule

> Explore freely, decide deliberately, plan from verified context, implement in small slices, validate against the real branch, and preserve only durable knowledge in the project context.
