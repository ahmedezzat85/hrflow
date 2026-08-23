# HRFlow Productization Roadmap — Overview

**Status:** Draft for review
**Owner:** Ahmed Ezzat
**Created:** 2026-08-23
**Source review:** Full-stack review of `main` @ commit `635143929e870db134a60346ab6cf331275ce52b` (PR #10 "ux-enhance" merged)

## Purpose

This folder consolidates an external, in-depth review of HRFlow into an actionable roadmap. It is meant to be read top-down, then used to derive concrete implementation/design-plan docs (in the style already used elsewhere in `docs/`, e.g. `modal-form-system-implementation-plan.md`) before starting work on any single item.

**This is a backlog, not a sprint plan.** Nothing here should be implemented wholesale — pick items one at a time, write a short implementation plan per item (matching existing repo conventions), then execute.

## Documents in this folder

| File | Covers | Use it when... |
|---|---|---|
| `01-feature-gap-plan.md` | Feature-map of what exists today vs. what a complete HR platform needs | Deciding which HR *capability* to build next (recruitment, attendance, performance, etc.) |
| `02-ux-ui-redesign-plan.md` | UX/UI ranking, what's inconsistent, what needs redesign | Planning the next visual/interaction pass, especially for not-yet-redesigned screens (vacations, requests, dashboards) |
| `03-architecture-security-plan.md` | Cloud architecture + security deep-dive, risks, and remediation backlog | Planning backend/infra hardening work, CI, containerization |
| `04-deployment-plan.md` | Cloud vs. local deployment options for HR-team-only access | Actually standing up a hosted or on-prem environment |
| `05-database-redesign.md` | Standalone plan for moving off Google Sheets/Drive as system of record | Doing the database redesign — **read this one in isolation**, it's self-contained |

## How these documents were derived

The review was based on:
- Full backend/frontend directory and module structure on `main`
- Complete commit history on `main` (100+ commits), including commit messages, authorship, timestamps, and per-commit file change stats
- Existing `docs/analysis/*` planning docs already in the repo (`architecture-review-plan.md`, `security-analysis-plan.md`, `salary-advanced-plan.md`)
- The existing test suite under `be/tests/`
- CI configuration under `.github/workflows/`

No production data, secrets, or runtime behavior was inspected — this is a static, structural review. Some recommendations should be re-validated against actual runtime/load characteristics before committing engineering time.

## Suggested sequencing

This is a suggestion, not a mandate — reorder based on business priority:

1. **Architecture & security hardening** (`03`) — do this early since later feature work builds on top of it (CI, containerization, rate limiting are cheap now, expensive later).
2. **Database redesign** (`05`) — the biggest lever and the riskiest to defer; every new feature you build on top of Google Sheets today is a feature you may need to re-plumb later.
3. **Deployment** (`04`) — once you have a Dockerfile and CI (from `03`), stand up a real environment instead of ad hoc local runs.
4. **UX/UI consistency pass** (`02`) — bring vacations/requests/dashboards up to the same visual bar as employees/insurance/documents.
5. **Feature gaps** (`01`) — start layering in recruitment, attendance, performance, etc., once the foundation from steps 1-3 is in place.

## Non-goals of this roadmap

- This is not a cost/timeline estimate. Effort sizing should happen per-item when you write its implementation plan.
- This does not replace the existing `docs/analysis/architecture-review-plan.md` and `docs/analysis/security-analysis-plan.md` — treat those as the historical record of what was already fixed, and this roadmap as what's still outstanding.
