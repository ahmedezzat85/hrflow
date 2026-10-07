# Handoff prompt: UI refinements plan

Paste the block below to the coding agent at the start of each slice. Replace `R?` with the slice id (start with `R1`).

---

You are implementing slice **R?** of `docs/fix-plans/01-ui-refinements-plan.md` in the HRFlow repository. HRFlow is an internal HR, Finance and Payroll tool: a FastAPI backend in `be/` and a vanilla HTML, CSS and JavaScript frontend in `fe/` built by Vite.

**Read first, in this order**

1. `AGENTS.md`
2. `docs/project-context/00-project-start-here.md`
3. `docs/fix-plans/01-ui-refinements-plan.md`: sections 1 to 5 in full, then the slice itself
4. `docs/UI-UX-FIX-PLAN.md` section 3 (ground rules; they still apply)
5. The mockups the slice names, in `docs/fix-plans/mockups/`. Open the HTML files in a browser and look at both the dark and the light version.

**What the owner has already decided. Do not reopen these.**

- This is not a redesign. Layout, navigation, fonts and the existing colour language stay.
- Colours stay: internal salaries blue, external green, warnings orange, tax purple.
- The Google sign-in button is not touched: not its container `#googleSignInButton`, not `initGoogleSignIn`, not its styling.
- `docs/UI-UX-FIX-PLAN.md` (U1 to U9) is implemented. Do not re-review it.
- Backend, security and calculation fixes are tracked in `docs/REVIEW.md` and are out of scope here.

**Your first reply must contain only this, then stop and wait for approval**

1. A branch-intake block: branch, HEAD, merge-base with `main`, and whether `git status` is clean once line endings are ignored.
2. Whether the app you can run is a fresh build of that HEAD.
3. For each change in the slice: the current behaviour you verified in code, with file and line. Say plainly if something in the plan is already fixed or no longer matches the code.
4. The exact list of files you will change.
5. The acceptance criteria, copied from the plan.
6. Anything unclear, and anything that would need a backend change. If a backend change is needed, do not make it; report it.
7. For R1 only: the cause of the session-expired event firing on a first visit.
8. Before R1 only: the Playwright baseline (`npx playwright test --reporter=line` from `fe/`), listing the failing specs.

**After approval**

- Implement this slice only. Frontend only; nothing under `be/`.
- Do not rename or remove element ids, `data-page` values or global function names.
- Use tokens from `fe/src/styles/tokens.css`. No new hex colour outside that file, no new inline `style=`, no new dependency, no framework. If a mockup colour has no token, add one for light and dark.
- The mockups are visual references. Do not paste their inline styles; build with shared classes.
- Use the shared `escapeHtml` for any data you interpolate.
- Edit `fe/api/finance/*.js`, never the generated `fe/finance-api.js`.
- Keep mock mode working.
- Do not change which numbers the app computes, stores or requests. In R6 in particular, leave the FX rate source, the preview call and the funding account ids alone.
- Do not edit `docs/project-context/*` or `docs/REVIEW.md`. Do not decide any open question.
- Do not commit line-ending-only changes.
- Do not merge and do not push without the owner's say-so.

**Finish with a handoff**

1. Outcome per acceptance criterion: met, not met or unverified.
2. Files changed.
3. Commands run with exact results: CSS variable check, build, Playwright now against the baseline, the new spec.
4. Screenshots at 1440px and 390px, light and dark, of each page touched, beside the matching mockup.
5. Proof for R4 that the Google sign-in code paths have no diff.
6. Anything you could not verify, and which criteria need the owner's manual check on the real backend.
7. Follow-ups, including anything you noticed that belongs in `docs/REVIEW.md`.

Then stop. Do not start the next slice until the owner approves this one.
