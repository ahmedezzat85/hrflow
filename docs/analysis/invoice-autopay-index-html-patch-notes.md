# fe/src/index.html — Required Script Tag Addition

Per commit 818e182 (Phase 2 final), the classic-script load order in
index.html is currently:

```
state.js -> ui.js -> session.js -> employees.js -> requests.js ->
salary.js -> vacations.js -> insurance.js -> dochub.js -> charts.js -> app.js
```

Add invoices.js AFTER salary.js (it depends on `employees`, `toast`,
`initials`, `fmtUSD`, `Api` - all already defined by that point) and
BEFORE app.js is fine, but to match the existing domain-module grouping,
insert it right after salary.js and before vacations.js:

```html
<script src="./js/state.js"></script>
<script src="./js/ui.js"></script>
<script src="./js/session.js"></script>
<script src="./js/employees.js"></script>
<script src="./js/requests.js"></script>
<script src="./js/salary.js"></script>
<script src="./js/invoices.js"></script>   <!-- NEW -->
<script src="./js/vacations.js"></script>
<script src="./js/insurance.js"></script>
<script src="./js/dochub.js"></script>
<script src="./js/charts.js"></script>
<script src="./js/app.js"></script>
```

Also add the same line to `fe/vite.config.js`'s `inlineAppScripts` plugin
file list (see commit 6acb22d) so the production single-file build
inlines invoices.js in this same position, and to the equivalent list in
whatever CI copies `fe/public/js/*.js` into `fe/dist/` (see commit
c5cf461/1da44d5) so the built output isn't missing it.

## Sidebar nav + section markup

Insert the sidebar nav link and the `<section id="invoicesSection">`
block from `invoice-autopay-html-snippet.html` (delivered alongside this
note) next to the existing Salary nav item / `<section id="salarySection">`.

## Employee modal fields

Insert the three new `.form-field` inputs (`fEmpInvoiceId`,
`fEmpAddressLine1`, `fEmpAddressLine2`) inside `#employeeModal`'s
`.form-grid`, immediately after the "External Salary (USD)" field
(see `invoice-autopay-employees-js-patch-notes.md` for the exact JS
wiring that goes with these three inputs).
