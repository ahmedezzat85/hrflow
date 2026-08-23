# 02 — UX/UI Redesign Plan

**Scope:** Ranking of current UI/UX state after the `ux-enhance` PR (#10), and what still needs redesign or consistency work.
**Overall ranking:** 6.5/10 — solid mid-tier internal-tool UI; not yet "polished SaaS product" tier.

## 1. What's working well (keep doing this)

- **Design-before-build discipline.** Recent redesigns were preceded by written implementation plans (`employee-card-two-zone-implementation-plan.md`, `modal-form-system-implementation-plan.md`) — continue this pattern for every item below.
- **Shared modal system rollout.** Add Employee, Insurance Claims, and Document Hub modals were unified under one modal system in PR #10, rather than one-off styling per feature.
- **Real UX bug fixes, not just cosmetics.** E.g. "Improve loading during the login in progress," "Fix rendering issue in employee info card," and hiding Salary from the employees list table (a sensible privacy-by-default decision on a shared view).

## 2. Gaps and redesign backlog

### High priority — consistency debt

- **Vacations and Requests screens lag behind.**
  - Evidence: `vacations.js` (~1.5KB) and `requests.js` (~1.5KB) are far smaller than `employees.js` (~36KB) or `insurance.js` (~9KB), and have not received the same redesign passes as employee/insurance/document-hub screens.
  - Action: bring these two screens up to the current modal/card visual standard before adding new features to them (see `01-feature-gap-plan.md` for the attendance/notifications work that will build on top of these screens).

- **No documented design system / tokens.**
  - Evidence: multiple redesign iterations (Variant A → two-zone → "second design" → final) suggest visual decisions were made iteratively/by trial rather than against a locked token set (colors, spacing, typography scale).
  - Action: extract a lightweight design tokens doc (even a single `docs/ui-design/tokens.md` + CSS custom properties) from the *final* employee-detail/insurance/document-hub designs, so future screens (vacations, requests, dashboards) start from the same base instead of drifting further.

### Medium priority — structural UI debt

- **Single monolithic HTML/CSS files.**
  - Evidence: `fe/src/index.html` is ~68KB and `fe/src/styles.css` is ~47KB, both single files, with no component framework.
  - Risk: as more modals/pages are added (attendance, notifications, reporting per `01-feature-gap-plan.md`), this file will become a genuine bottleneck for both design consistency and merge conflicts.
  - Action: not necessarily a full React/Vue migration — consider whether splitting `styles.css` into per-domain partials (build-time concatenated via Vite) gets 80% of the benefit at a fraction of the cost. Revisit full component-framework migration only if velocity keeps dropping.

- **Dashboards/analytics are thin.**
  - Evidence: `charts.js` is only ~2.5KB.
  - Action: pair this with the "Reporting / analytics dashboards" item in `01-feature-gap-plan.md` — this is as much a feature gap as a UX one.

### Lower priority — polish and reach

- **No visible accessibility (a11y) work.**
  - Evidence: no ARIA attributes, focus-trap, or keyboard-navigation-specific commits found in history.
  - Why it matters even for an internal tool: HR software handles sensitive personal data and is often subject to workplace accessibility expectations; also just good practice for a growing team.
  - Action: start with the modal system (already centralized in PR #10) — add focus-trap and Escape-to-close there once, and every modal benefits.

- **No responsive/mobile-specific work.**
  - Evidence: everything reads as desktop-first across the recent redesign commits.
  - Why it matters: HR staff often need to approve leave/insurance claims from a phone. Doesn't need to be a full mobile app — responsive breakpoints on the existing modal/card system would cover most of the need.

## 3. Suggested sequencing

1. Design tokens extraction (cheap, unblocks everything else being consistent).
2. Vacations + Requests visual parity pass.
3. Modal system a11y pass (focus-trap, ARIA, keyboard nav) — centralized, so one pass covers all modals.
4. Responsive breakpoints for the now-consistent modal/card system.
5. Dashboards/analytics UI, timed with the backend reporting work in `01-feature-gap-plan.md`.
6. Revisit single-file HTML/CSS structure only if the above passes start feeling blocked by file size/merge conflicts.

## 4. How to use this doc

Same convention as the rest of the repo: write a short implementation plan per item (e.g. `docs/vacations-requests-visual-parity-plan.md`) before starting, matching the style of `docs/employee-card-two-zone-implementation-plan.md`.
