# Fix plans

Created 2026-10-06 after a live audit of the running app and an owner review of design mockups.

| What | Where | Status |
| :--- | :--- | :--- |
| UI refinements plan (slices R1 to R7) | `01-ui-refinements-plan.md` | Approved scope; do first |
| Handoff prompt for the coding agent | `01-ui-refinements-handoff-prompt.md` | Ready to paste |
| Approved mockups, dark and light, plus button evidence | `mockups/` | Reference only |
| Everything else: security, deployment, payroll and ledger correctness, product decisions | `../REVIEW.md`, with the 2026-10-06 audit merged in as **section 10** | Single tracker for non-UI fixes |

## How the two plans divide

- **This folder** holds frontend presentation work the owner approved from mockups. It changes how screens look and read, never what the app computes or stores.
- **`docs/REVIEW.md`** remains the one place that tracks correctness, security and deployment work. Section 10 adds the audit's non-duplicate findings (ids `AUD-01` onward), the slices they add to the phased plan in section 6, and the new owner decisions.
- **`docs/UI-UX-FIX-PLAN.md`** (U1 to U9) is implemented and closed.

`REVIEW.md` was left at its existing path because other documents reference it there.
