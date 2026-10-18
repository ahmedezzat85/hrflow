# Payroll module: app vs mocks (visual differences), updated 2026-10-18
Read-only review; no code changed. Updated after the owner confirmed three intentional deviations (section 0). Side-by-side images (mock LEFT, app RIGHT) are in this folder.
Caveat: the app's mock-mode data differs from the mock data (8 employees, one run, -$371 draft), so number differences are fixtures, tagged [D]. The mock shows each step in a different run state; the app was captured as: draft (steps 1-2), approved and finalized (steps 3-6).


## 0. Intentional deviations (owner decisions, not defects)
- I1 The exchange rate text is not in the top bar (the rate lives in Step 1 "FX rate, USD to EGP" and Settings).
- I2 Review pay shows a search box ("Search employee name...") instead of the mock's "All variable pay" select.
- I3 Review pay keeps the "+" button (and the bonus chips) per row; the mock's inline select and amount field are not built.
Closed items: former M1 (FX part), P4, P5, and the "+" note in D3.

## Whole module
- M1 Revert to draft: the mock shows an outlined "Revert to draft" button in the top bar once a run is approved. The app has the button in its markup, but it sits inside the hidden FX block and is never shown, so a finalized run currently has no visible way to revert (only the text "Revert to draft to change them" in the snapshot strip). This is a missing control, not only styling; Revert dialog (D2) cannot be opened from the UI. [S][bug]
- M2 Run status pill wording and style: mock "Draft" dashed pill, "Approved" blue pill with dot, "Finalized · not paid yet", "Salaries paid" green; app shows a plain "Draft", "Finalized" for approved and finalized alike. [T][V]
- M3 Extra banners above the stepper in the app (not in the mock): amber "This run is finalized. Compensation and additions are read-only." and "Payroll run finalized and locked. Backend snapshots populated." (a developer message). The mock only has the blue "Finalized snapshot" strip. [S][T]
- M4 Cards: mock cards are ~12 px tighter in padding and use 12 px title spacing; app card titles sit 6-8 px higher with sub text jammed against the title (e.g. "Review pay", "Statutory processing"). [V]
- M5 Selects: mock native chevron selects with "Name · ••4821"; app uses a custom chevron and "Name · •••• 4821". [V]
- M6 Dates: mock text inputs "30 Sep 2026"; app native date inputs "09/30/2026" (accepted decision D7). [C]
- M7 Footer cards: the mock footer is one row (Back at left, hint, primary at right, 52 px). App footer is taller (56 px) and on steps 5-6 has a second footer card. [S]

## Payroll runs (Pay-Runs)
- R1 Banner: mock "Pay date 30 Sep 2026 · 2 employees eligible", net pay $29,000.00 (22/28 px type); app "8 employees eligible", -$371.00 and the net pay figure is larger and bolder. [D][V]
- R2 Table: mock has a download icon at the end of each row; app has none. [S]
- R3 Statuses: mock "Paid" and "Partly reconciled" and "Not recorded"; app "Salaries paid", "Partially Reconciled", "Statutory not recorded" (kept by spec). [T]
- R4 Column widths: mock Employees column is right-aligned narrow; Net pay shows "projected" under the draft amount (both present). Row height 48 px in mock vs 49 px app, matches.

## Settings (Pay-Settings)
- S1 Page title: mock "Payroll settings / Payroll"; app "Payroll settings / Settings". [T]
- S2 Card header icons and sub text match; the app cards are 10 px shorter because helper boxes are tighter. [V]
- S3 Fields: mock selects and text dates; app unformatted "20000" for the exemption (mock "20,000") and native month/date pickers. [V][C]
- S4 "Save settings" bar matches (Cancel + Save settings).

## Step 1 Set up
- P1 Missing: amber strip "1 employee has no bank details. The run continues; the payment preview flags the row." (mock shows it; app does not). [S]
- P2 Stat tiles match in labels; app tiles are 4 px shorter. [V]
- P3 Footer: app footer card is taller and the "Saved automatically after every change" text is lighter. [V]

## Step 2 Review pay
- P4/P5 (closed, intentional I2 and I3).
- P6 Rows: app rows are 8 px taller because the role sub line wraps ("Software Engineer" over two lines), and employee names appear bold/blue links. [V]
- P7 Footer button: app "Submit for approval" has a paper-plane icon; mock has none. [V]
- P8 Info strip text matches.

## Step 3 Statutory
- P9 Title bar: mock "Approved" + "Revert to draft" in the top bar; app "Finalized". [S][T]
- P10 Table values are 0.00 in the app (fixture, no statutory data) and the sub line under names says "Employee" (mock shows the job title only as a single line). [D]
- P11 Footer: mock one row; app has a taller footer with Back at the far left. [V]

## Step 4 Payment preview
- P12 Tiles: mock 4 tiles at 92 px, the fourth is "1 of 2 flagged" with amber outline; app "5 of 8 flagged" ok, but the missing-bank pill shows a double dot "● ● Missing bank details". [D][V bug]
- P13 Rows: mock flagged rows are tinted and 48 px; app rows are 46-52 px, ok. The sub line "Pay outside HRFlow and record it here" matches.
- P14 "None (Internal only)" text for employees without external pay is not in the mock (mock shows bank, IBAN last digits and SWIFT). [T]

## Step 5 Confirm payment
- P15 App shows a "Payment confirmation" heading above the cards (not in the mock). [S]
- P16 Mock has an amber strip naming the employee with missing bank details; app has none. [S]
- P17 Cards: dates show ISO "2026-09-30" (mock "30 Sep 2026"); account shows "CIB EGP Operating" without the masked digits (mock "· ••3319"). [T][D]
- P18 Footers: app has two stacked footer cards ("Back / Export CSV / hint / Confirm" and then "Back / Next: Statutory payments"); mock has one. [S]

## Step 6 Statutory payments
- P19 Heading "Statutory reconciliation" and a status pill "Recorded — Unpaid" at the right appear in the app only. [S]
- P20 Cards: estimates show "282150.00 EGP ($5643.00)" unformatted (mock "EGP 5,452.00"); "Record payment" primary button missing (app only shows "Record obligation" in both cards). [S][D]
- P21 Table: empty state in the app ("No statutory obligations recorded yet...") vs one populated row in the mock; header columns match. [D]
- P22 "Finish and return to runs" primary button sits below the hint in the app (mock has only Back + hint). [S]

## Dialogs
- D1 Record as paid: structure matches. App title/sub line are 8 px lower; the "Missing bank details" tile is not amber-tinted when the count is 0 (mock tints it when > 0; data 0 here). The icon is outlined instead of the violet tile. [V]
- D2 Revert run: not compared (the run in mock mode has no "Revert to draft" control, see M1). Needs the top-bar button first.
- D3 The "+" bonus dialog on Review pay has no mock; it is kept (I3). It should be styled as one of the v3 dialogs (frame, labels, add-on fields); not yet reviewed against the dialog frame.

## Priority
1. Visible "Revert to draft" (M1), status pill wording (M2) and run banners (M3).
2. Step 5/6 footers and extra headings (P15, P18, P19, P22).
3. Step 1 and Step 5 amber strips (P1, P16).
4. Table/card spacing (M4, P6) and formatting (P17, P20).
5. Fixture data (all [D]).

## Status after implementation (front end only)
Done: Revert to draft button in the top bar while approved (M1); status pill wording and blue pill with dot (M2); amber lock note and the "Backend snapshots populated" banner removed (M3); Step 5 and 6 headings made screen-reader only (P15, P19), one footer row on Step 5 with Next next to Confirm (P18); Step 5 dates as "30 Sep 2026" and accounts with masked digits (P17); double dot on the missing-bank pill removed (P12); paper-plane icon removed (P7); Review pay role line one line (P6); Step 6 status pill hidden. New colours: Step 5 icon tiles and amounts (internal green, external blue), Step 6 tinted cards with top rule (social insurance teal, income tax ochre).
Not changed: runs-list download icon (needs a new action), tax limit thousands separator (native number input), settings page area label, amber strips (the Step 1 and Step 5 strips already exist and appear when a run has missing bank details; mock-mode data had none), Revert dialog comparison.
