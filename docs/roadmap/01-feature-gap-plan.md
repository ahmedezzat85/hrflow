# 01 — Feature Gap Plan

**Scope:** What HRFlow covers today vs. what a complete HR platform needs.
**Reference:** Backend routers on `main`: `employees`, `auth`, `salary`, `insurance`, `invoices`, `bank`, `documents`, `requests`, `vacations`, `system`.

## 1. Current feature inventory (as-is)

| Domain | Status | Notes |
|---|---|---|
| Employee records (CRUD, detail page) | Solid, recently redesigned | `be/routers/employees.py` (~14KB); 4+ iterations of card/detail redesign in one week |
| Salary management | Advanced | Internal/external USD split, raise history with per-component before/after deltas, multi-stage rollout (`docs/analysis/salary-advanced-plan.md`) |
| Invoicing / autopay | Present | `be/services/invoices.py`, PR #9 "Feature/autopay", Drive-backed generation |
| Insurance claims | Present, recently modernized | `be/routers/insurance.py` (~12.7KB) |
| Bank account details | Present, recently added | `be/routers/bank.py`, dedicated plan doc |
| Document hub | Present | `fe/public/js/dochub.js`, modal-based UI |
| Leave / vacation requests | Present but thin | `be/routers/vacations.py` (~2.5KB), `requests.js` (~1.5KB) — minimal relative to other domains |
| Auth | Google Sign-In, HttpOnly cookie sessions | `be/routers/auth.py`, `session.js` |
| Audit logging | Present | Security Phase 5 |
| Authorization scoping | Present, centralized | `test_employee_scope.py`, refactored in PR #6 |

**Verdict:** Strong for payroll/insurance/records administration in a small company. Not yet a full HRIS — recruitment, time-and-attendance, and performance are the three largest gaps.

## 2. Missing feature backlog

Each item below should get its own short implementation plan (like existing docs) before work starts. Priority is a suggestion (High/Medium/Low), reorder freely.

### High priority

- **Attendance / time tracking**
  - Gap: no clock-in/clock-out, shift scheduling, or overtime tracking.
  - Why it matters: vacations exist but attendance is the other half of time management; payroll accuracy depends on it eventually.
  - Suggested shape: a new `attendance` router + a lightweight daily check-in model; start read-only/manual entry before considering biometric/IP-based clock-in.

- **Notifications / reminders**
  - Gap: no email/Slack/Workspace notification service for approvals, contract renewals, leave request status changes.
  - Why it matters: currently HR staff must manually check the app for pending approvals — this is the highest-leverage, lowest-effort addition.
  - Suggested shape: a `notifications` service using Google Workspace (Gmail API, since you're already Google-native) triggered from existing request/approval endpoints.

- **CI test enforcement** *(process gap, not a feature, but blocks safe feature velocity)*
  - Gap: only a frontend build-check workflow exists; the decent `be/tests/` suite doesn't run in CI.
  - Cross-reference: see `03-architecture-security-plan.md` — doing this first makes every feature below safer to ship.

### Medium priority

- **Org chart / reporting lines**
  - Gap: flat employee records, no manager hierarchy or department structure.
  - Why it matters: needed for approval routing (e.g., leave requests to a manager, not just "HR"), and for any future org-wide reporting.

- **Reporting / analytics dashboards**
  - Gap: `charts.js` (~2.5KB) is minimal; no headcount trends, attrition, or cost-center breakdowns.
  - Why it matters: HR leadership visibility; also a natural showcase once the database redesign (`05-database-redesign.md`) makes aggregate queries actually fast.

- **Document e-signature**
  - Gap: document hub stores files but has no signing workflow for contracts/offer letters.
  - Suggested shape: could integrate a third-party e-sign API, or a lightweight custom flow if volume is low.

- **Employee self-service portal separation**
  - Gap: unclear from the code structure whether employees get a genuinely distinct, restricted UI vs. HR/admin, beyond API-level scoping.
  - Action: audit the frontend routing/view logic (not just the backend scope tests) to confirm the UI itself hides HR-only actions from employee logins, not just the API.

### Lower priority / longer horizon

- **Recruitment / applicant tracking**
  - Gap: no requisitions, candidate pipeline, or offer-letter workflow.
  - Note: this is a large feature area — treat as its own multi-phase initiative, not a single implementation plan.

- **Performance management**
  - Gap: no goals/OKRs, review cycles, 360 feedback, or PIPs.
  - Note: also a large feature area; consider whether a lightweight version (simple annual review form + history) covers 80% of the need before building a full system.

- **Payroll compliance depth**
  - Gap: no tax withholding engine, statutory deduction tables, or multi-country payroll rules.
  - Why it's lower priority: relevant mainly if you expand headcount/geographies; revisit once the database redesign is done, since payroll compliance logic benefits enormously from real relational integrity.

## 3. How to use this doc

For each item you decide to build:
1. Write a short implementation plan in `docs/` (same style as `docs/bank-account-details-plan.md`).
2. Confirm it doesn't depend on the database redesign (`05-database-redesign.md`) being done first — attendance, notifications, and reporting all get meaningfully easier post-migration.
3. Update this file's status column once shipped, so the gap list stays accurate over time.
