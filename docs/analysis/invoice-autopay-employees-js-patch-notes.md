# fe/public/js/employees.js — Verified Exact Patch (invoice fields)

Content below is confirmed against the actual current file content
(verified via attached employees-2.js), not guessed. Apply these edits
directly with a find-and-replace in your editor — I'm not pushing a
full-file overwrite because I've only seen these specific functions, not
the whole file (document upload/preview, notes, behalf-modals, etc. are
also in this file but were not part of what I could verify), and
overwriting the full file would delete that unseen code.

## 1. openEmployeeModal(id=null)

FIND:
```js
    document.getElementById('fEmpInternalSalary').value = e.internalSalaryUsd || 0;
    document.getElementById('fEmpExternalSalary').value = e.externalSalaryUsd || 0;
    fEmpJoin.value=e.join; fEmpStatus.value=e.status; fEmpVac.value=e.vacTotal-e.vacUsed;
```
REPLACE WITH:
```js
    document.getElementById('fEmpInternalSalary').value = e.internalSalaryUsd || 0;
    document.getElementById('fEmpExternalSalary').value = e.externalSalaryUsd || 0;
    document.getElementById('fEmpInvoiceId').value = e.invoice_id || '';
    document.getElementById('fEmpAddressLine1').value = e.address_line_1 || '';
    document.getElementById('fEmpAddressLine2').value = e.address_line_2 || '';
    fEmpJoin.value=e.join; fEmpStatus.value=e.status; fEmpVac.value=e.vacTotal-e.vacUsed;
```

FIND:
```js
    document.getElementById('fEmpInternalSalary').value = '';
    document.getElementById('fEmpExternalSalary').value = '';
    fEmpJoin.value=''; fEmpVac.value=21; fEmpStatus.value='Active'; fEmpDept.value='Engineering';
```
REPLACE WITH:
```js
    document.getElementById('fEmpInternalSalary').value = '';
    document.getElementById('fEmpExternalSalary').value = '';
    document.getElementById('fEmpInvoiceId').value = '';
    document.getElementById('fEmpAddressLine1').value = '';
    document.getElementById('fEmpAddressLine2').value = '';
    fEmpJoin.value=''; fEmpVac.value=21; fEmpStatus.value='Active'; fEmpDept.value='Engineering';
```

## 2. saveEmployee()

FIND:
```js
  const internal_salary_usd = Number(document.getElementById('fEmpInternalSalary').value)||0;
  const external_salary_usd = Number(document.getElementById('fEmpExternalSalary').value)||0;
  try{
```
REPLACE WITH:
```js
  const internal_salary_usd = Number(document.getElementById('fEmpInternalSalary').value)||0;
  const external_salary_usd = Number(document.getElementById('fEmpExternalSalary').value)||0;
  const invoice_id = document.getElementById('fEmpInvoiceId').value.trim();
  const address_line_1 = document.getElementById('fEmpAddressLine1').value.trim();
  const address_line_2 = document.getElementById('fEmpAddressLine2').value.trim();
  if(invoice_id && !/^\d{1,2}$/.test(invoice_id)){
    toast('Invoice ID must be a number between 01 and 99.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  try{
```

FIND:
```js
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value };
      await Api.updateEmployee(currentEditId, updates);
```
REPLACE WITH:
```js
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, address_line_1, address_line_2 };
      await Api.updateEmployee(currentEditId, updates);
```

FIND:
```js
      const payload = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, next_raise: '2027-01-01', employment_state: document.getElementById('fEmpEmploymentState').value };
      await Api.createEmployee(payload);
```
REPLACE WITH:
```js
      const payload = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, next_raise: '2027-01-01', employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, address_line_1, address_line_2 };
      await Api.createEmployee(payload);
```

## 3. viewProfile(id) — Employee Detail info grid

FIND the `External Salary (USD)` info-item div inside
`detailInfoGrid.innerHTML`'s template literal (immediately followed by
the `Next Raise Date` info-item div), and INSERT two new info-item divs
between them:
```js
<div class="info-item"><span>Invoice ID</span><b>${e.invoice_id || '—'}</b></div><div class="info-item"><span>Address</span><b>${[e.address_line_1, e.address_line_2].filter(Boolean).join(', ') || '—'}</b></div>
```

## 4. Employees table row — per-employee invoice action (optional)

In `renderEmployeesTable()`, inside the row's action `<td>` (the one
containing the view/edit/delete icon-action buttons), add:
```js
<button class="icon-action" title="Generate Invoice" onclick="showSection('a-invoices','admin'); generateSingleInvoice(${e.id})"><i class="fa-solid fa-file-invoice"></i></button>
```

## Notes on what was verified vs. assumed

Sections 1–2 above are copied verbatim from the actual current file
content (confirmed via the attached employees-2.js). Section 3's anchor
text is reconstructed from a whitespace-stripped extraction, so double-
check the exact surrounding characters in your editor before applying -
if it doesn't match exactly, search for `External Salary (USD)` directly
inside `viewProfile()`'s `detailInfoGrid.innerHTML` template literal.
