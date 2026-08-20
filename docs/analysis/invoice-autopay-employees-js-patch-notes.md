# fe/public/js/employees.js — Required Patch (invoice fields)

Based on the confirmed current shape of openEmployeeModal() / saveEmployee()
(commit e445be8), apply these exact edits. Shown as before/after since I
cannot safely push a full-file overwrite of employees.js without its
complete current content.

## 1. openEmployeeModal(id=null) — populate on edit, clear on create

FIND (edit branch, right after the External Salary line):
```js
    document.getElementById('fEmpExternalSalary').value = e.externalSalaryUsd || 0;
```
ADD immediately after:
```js
    document.getElementById('fEmpInvoiceId').value = e.invoice_id || '';
    document.getElementById('fEmpAddressLine1').value = e.address_line_1 || '';
    document.getElementById('fEmpAddressLine2').value = e.address_line_2 || '';
```

FIND (create branch, right after the External Salary reset line):
```js
    document.getElementById('fEmpExternalSalary').value = '';
```
ADD immediately after:
```js
    document.getElementById('fEmpInvoiceId').value = '';
    document.getElementById('fEmpAddressLine1').value = '';
    document.getElementById('fEmpAddressLine2').value = '';
```

## 2. saveEmployee() — read + validate + include in payload

FIND (near the internal/external salary reads):
```js
  const internal_salary_usd = Number(document.getElementById('fEmpInternalSalary').value)||0;
  const external_salary_usd = Number(document.getElementById('fEmpExternalSalary').value)||0;
```
ADD immediately after:
```js
  const invoice_id = document.getElementById('fEmpInvoiceId').value.trim();
  const address_line_1 = document.getElementById('fEmpAddressLine1').value.trim();
  const address_line_2 = document.getElementById('fEmpAddressLine2').value.trim();
  if(invoice_id && !/^\d{1,2}$/.test(invoice_id)){
    toast('Invoice ID must be a number between 01 and 99.', 'fa-solid fa-triangle-exclamation');
    return;
  }
```

FIND (both the `updates` object for edit and the `payload` object for create):
```js
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value };
```
REPLACE WITH:
```js
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, address_line_1, address_line_2 };
```

Similarly for the create-branch `payload` object, add `invoice_id, address_line_1, address_line_2` to the object literal.

## 3. viewProfile(id) — show on Employee Detail page (optional, recommended)

FIND (the External Salary info-item added in commit dc9f6e7):
```js
<div class="info-item"><span>External Salary (USD)</span><b>$${(e.externalSalaryUsd||0).toLocaleString()}</b></div>
```
ADD immediately after (inside the same template string):
```js
<div class="info-item"><span>Invoice ID</span><b>${e.invoice_id || '—'}</b></div>
<div class="info-item"><span>Address</span><b>${[e.address_line_1, e.address_line_2].filter(Boolean).join(', ') || '—'}</b></div>
```

## 4. app.js normalizeEmployee() — expose the raw fields

Based on confirmed commit e6006334, normalizeEmployee currently does:
```js
function normalizeEmployee(e, salaryHistoryForEmp){
  return { ...e, role: e.job_role, join: e.join_date, vacTotal: Number(e.vac_total), vacUsed: Number(e.vac_used),
    nextRaise: e.next_raise, salary: Number(e.salary),
    internalSalaryUsd: Number(e.internal_salary_usd || 0), externalSalaryUsd: Number(e.external_salary_usd || 0),
    salaryHistory: (salaryHistoryForEmp || []).map(h=>({ date: h.date, prev: Number(h.previous_salary), next: Number(h.new_salary), pct: h.pct_change, reason: h.reason })) };
}
```
No change is strictly required here: the spread `...e` already carries
`invoice_id`, `address_line_1`, `address_line_2` through untouched (same
as how `e.employment_state` already passes through without an explicit
mapping). The steps above reference `e.invoice_id` etc. directly for
this reason - consistent with how `e.employment_state` is read elsewhere
in the codebase.
