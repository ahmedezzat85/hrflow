# Handoff Prompt — Top Bar, Account Menu and Navigation Polish

Paste everything below the line into a fresh Claude Code session opened in the repository root (`hrflow`). A mid-tier model (Sonnet) is sufficient for execution.

---

You are implementing an owner-approved frontend change for HRFlow (Voyance Health) autonomously, end to end, without waiting for further approval.

**Read first, in this order:**
1. `AGENTS.md` and `docs/project-context/00-project-start-here.md`, then `01-repository-baseline.md`, `02-architecture-and-domain-boundaries.md`, `04-decision-log.md` (especially D-010) and `06-open-questions.md`.
2. `docs/ui-design/topbar-account-menu-implementation-plan.md` — this is your specification and the source of truth for this task (scope, owner decisions OD-1…OD-10, design spec, slices S0–S7, acceptance criteria AC-1…AC-16, guardrails, stop conditions, report format). Also skim `docs/ui-design/tokens.md`.

**Task:** execute slices **S0 → S7** of the plan, in order, on the **current branch** `fix/review-ui-fixes` (expected HEAD `10e7d66`; merge-base with `main` is `a967a1a`). Start with a branch-intake block (branch, HEAD, merge-base, scope, branch-specific docs) and verify those values match; if they differ, say so and continue from the actual HEAD only if the plan's baseline facts (§2) still hold.

**Non-negotiable rules:**
- Frontend only (`fe/` plus the docs named in S7). No backend, schema, RBAC, API, dependency or `vite.config.js` changes.
- The repo uses CRLF and `git status` shows ~551 "modified" files that are line-ending noise only. **Never** use `git add -A` or `git add .`. Stage explicit paths, check `git diff --cached --stat` before every commit, and preserve each file's existing line endings.
- One commit per slice with a clear message. Do **not** push, open a PR, merge, rebase, amend published history, or create branches.
- Do not run formatters or linters across the codebase; do not refactor beyond the plan. Do not fix unrelated failing tests; record them in the baseline.
- If `.git/index.lock` exists as a 0-byte file and no git process is running, it is a stale lock from an earlier read-only session: remove it.
- Before removing or renaming any element ID, confirm what writes to it (`app.js` writes user name/role/avatar without null checks). Every ID that code still writes must continue to exist.
- Keep HR vs Finance terminology exact; keep employee-bank vs company-bank distinctions untouched.
- Where the plan and the earlier mockup differ, the plan wins. Where the plan and current code disagree on a fact, trust the code, note it, and continue if it is not a product decision.

**Stop and report instead of guessing** if: the build/baseline is broken in a way that blocks verification; a requirement needs a product decision (check `06-open-questions.md` first); a slice would need a backend change or new dependency; or theme/identity/logout wiring differs materially from plan §2.

**Verification:** after each slice run `cd fe && npm run build` and the touched Playwright specs; after S5 and S7 run the full `npm test`. Compare against the S0 baseline — zero new failures. Measure the top-bar height in a real browser and check the viewport matrix (360, 390, 768, 1024, 1440; light and dark) for both portals. Keep screenshots outside the repo or in a git-ignored folder; do not commit them.

**Finish with the report defined in plan §11:** outcome per slice; files changed and commit hashes; exact test commands and exact results (baseline vs final); top-bar height before/after; confirmed facts vs assumptions vs open questions; decision-log/roadmap/open-question updates made or still needed; and a concise handoff summary for the next thread.
