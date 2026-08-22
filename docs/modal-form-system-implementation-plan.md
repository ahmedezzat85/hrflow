# Modal & Form System Redesign — Implementation Plan

**Status:** Approved design.

**Reference preview:** `add-employee-modal-redesign.html` — shared modal/form visual language (sectioned fields, required/optional signaling, optional-block toggle, clean non-grey inputs, loading-capable primary button).

**Scope of this plan:** Implement the shared CSS system once, then apply it to the **Add Employee modal first** (`#employeeModal`) as the proving case. Do **not** touch any other modal in this pass — Bank Account, Raise, Behalf Vacation/Claim, Category, and Document Upload modals are explicitly deferred to follow-up plans that reuse these same classes.

**Files touched:**
1. `fe/src/styles.css` — append new CSS (additive only; existing `.modal`, `.form-grid`, `.form-field` rules are not modified, since other modals still depend on them until they're migrated in later passes).
2. `fe/src/index.html` — restructure `#employeeModal` markup only.
3. `fe/public/js/employees.js` — add a button-loading helper and use it in `saveEmployee()`.

---

## 0. Design rationale (for context, not implementation)

The current `#employeeModal` renders all 13 fields in one flat `.form-grid`, mixing four unrelated domains (identity, compensation, employment, invoicing) with no visual grouping, no required/optional signaling, and a grey (`var(--surface2)`) background on every input. The Save button has no loading state, so submission feels unresponsive. The redesign groups fields into labeled sections, isolates the two invoicing-only fields (Invoice ID, Address) into a visually distinct optional block, switches inputs to a clean white/bordered style consistent with the already-approved employee-card redesign, and adds a spinner-based loading state to the Save button.

---

## 1. CSS — append to `fe/src/styles.css`

Add this block at the end of the file. It is fully additive: no existing `.modal`, `.modal-head`, `.modal-body`, `.modal-foot`, `.form-grid`, or `.form-field` rule is changed, so every modal that has not yet been migrated continues to render exactly as before. All new rules are scoped under a `.modal-v2` wrapper class so they only apply where explicitly opted in.

```css
/* ===== Modal & form system v2 (sectioned forms) ===== */
.modal-v2 .modal-head{
  display:flex;align-items:center;gap:14px;
  padding:20px 26px;
}
.modal-v2 .modal-head-icon{
  width:40px;height:40px;border-radius:12px;flex-shrink:0;
  background:var(--accent-soft);color:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:16px;
}
.modal-v2 .modal-head-text{flex:1;min-width:0}
.modal-v2 .modal-head-text h3{font-size:16px;font-weight:700;font-family:var(--font-head)}
.modal-v2 .modal-head-text p{font-size:12px;color:var(--text2);margin-top:2px}

.modal-v2 .modal-body{padding:22px 26px}

.modal-v2 .form-section{margin-bottom:26px}
.modal-v2 .form-section:last-child{margin-bottom:0}
.modal-v2 .form-section-label{
  display:flex;align-items:center;gap:9px;margin-bottom:14px;
  font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);
}
.modal-v2 .form-section-label i{font-size:11px;color:var(--accent)}
.modal-v2 .form-section-label .line{flex:1;height:1px;background:var(--border)}
.modal-v2 .form-section.optional-section{
  background:var(--surface2);border:1px dashed var(--border);border-radius:14px;padding:16px 18px;
}
.modal-v2 .form-section.optional-section .form-section-label{margin-bottom:12px}

.modal-v2 .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px}
.modal-v2 .form-grid .full{grid-column:1/-1}
.modal-v2 .form-field label{
  display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px;
}
.modal-v2 .form-field label .req{color:var(--danger);font-size:11px}
.modal-v2 .form-field label .opt{color:var(--text3);font-weight:500;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
.modal-v2 .form-field input,
.modal-v2 .form-field select,
.modal-v2 .form-field textarea{
  width:100%;padding:10px 13px;border-radius:10px;
  border:1.5px solid var(--border);background:var(--surface);
  color:var(--text);font-size:13.5px;outline:none;font-family:inherit;transition:.15s;
}
.modal-v2 .form-field input:focus,
.modal-v2 .form-field select:focus,
.modal-v2 .form-field textarea:focus{
  border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);
}

.modal-v2 .toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.modal-v2 .toggle-row .t-label{font-size:13px;font-weight:600}
.modal-v2 .toggle-row .t-sub{font-size:11.5px;color:var(--text2);margin-top:2px}
.modal-v2 .switch{position:relative;width:40px;height:22px;flex-shrink:0}
.modal-v2 .switch input{opacity:0;width:0;height:0}
.modal-v2 .slider{position:absolute;inset:0;background:var(--border);border-radius:20px;cursor:pointer;transition:.2s}
.modal-v2 .slider:before{
  content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;
  background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2);
}
.modal-v2 .switch input:checked + .slider{background:var(--accent)}
.modal-v2 .switch input:checked + .slider:before{transform:translateX(18px)}

/* Button loading spinner (reusable outside modal-v2 too) */
.btn-spinner{
  width:14px;height:14px;border-radius:50%;
  border:2px solid rgba(255,255,255,.4);border-top-color:#fff;
  animation:btnSpin .7s linear infinite;flex-shrink:0;display:inline-block;
}
@keyframes btnSpin{to{transform:rotate(360deg)}}
.btn:disabled,.btn-fill:disabled{opacity:.65;cursor:not-allowed;transform:none}
```

---

## 2. HTML — restructure `#employeeModal` in `fe/src/index.html`

### 2.1 Locate the current markup

Search for `id="employeeModal"`. It occurs exactly once. The current structure is:

```html
<div class="modal-overlay" id="employeeModal">
  <div class="modal wide">
    <div class="modal-head">
      <h3 id="empModalTitle">Add Employee</h3>
      <button class="modal-close" onclick="closeModal('employeeModal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="modal-body">
      <div class="form-grid">
        <!-- 13 form-field divs, flat, no sections -->
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('employeeModal')">Cancel</button>
      <button class="btn btn-fill" onclick="saveEmployee(event)"><i class="fa-solid fa-check"></i> Save Employee</button>
    </div>
  </div>
</div>
```

**Do not guess field IDs from memory.** Before editing, read the actual current field IDs directly from the file (search for `fEmpName`, `fEmpEmail`, `fEmpDept`, `fEmpRole`, `fEmpInternalSalary`, `fEmpExternalSalary`, `fEmpInvoiceId`, `fEmpAddressLine1`, `fEmpAddressLine2`, `fEmpJoin`, `fEmpStatus`, `fEmpEmploymentState`, `fEmpVac`) and confirm each exists exactly once. All of these IDs must be preserved unchanged — `openEmployeeModal()` and `saveEmployee()` in `employees.js` read/write them directly by ID.

### 2.2 Replace with the sectioned structure

Replace the entire `#employeeModal` block with:

```html
<div class="modal-overlay" id="employeeModal">
  <div class="modal wide modal-v2">
    <div class="modal-head">
      <div class="modal-head-icon"><i class="fa-solid fa-user-plus"></i></div>
      <div class="modal-head-text">
        <h3 id="empModalTitle">Add Employee</h3>
        <p>Create a new employee record and invite them to sign in.</p>
      </div>
      <button class="modal-close" onclick="closeModal('employeeModal')"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="modal-body">

      <div class="form-section">
        <div class="form-section-label"><i class="fa-solid fa-id-card"></i> Basic Information <span class="line"></span></div>
        <div class="form-grid">
          <div class="form-field">
            <label>Full Name <span class="req">*</span></label>
            <input id="fEmpName" placeholder="e.g. Laila Hassan">
          </div>
          <div class="form-field">
            <label>Email <span class="req">*</span></label>
            <input id="fEmpEmail" placeholder="laila@hrflow.com">
          </div>
          <div class="form-field">
            <label>Department</label>
            <select id="fEmpDept">
              <option>Engineering</option>
              <option>Product</option>
              <option>Design</option>
              <option>Sales</option>
              <option>Finance</option>
              <option>Operations</option>
            </select>
          </div>
          <div class="form-field">
            <label>Role Title</label>
            <input id="fEmpRole" placeholder="e.g. Senior Developer">
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-label"><i class="fa-solid fa-sack-dollar"></i> Compensation <span class="line"></span></div>
        <div class="form-grid">
          <div class="form-field">
            <label>Internal Salary <span class="opt">USD</span></label>
            <input type="number" id="fEmpInternalSalary" placeholder="1000">
          </div>
          <div class="form-field">
            <label>External Salary <span class="opt">USD</span></label>
            <input type="number" id="fEmpExternalSalary" placeholder="0">
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-label"><i class="fa-solid fa-briefcase"></i> Employment <span class="line"></span></div>
        <div class="form-grid">
          <div class="form-field">
            <label>Join Date</label>
            <input type="date" id="fEmpJoin">
          </div>
          <div class="form-field">
            <label>Status</label>
            <select id="fEmpStatus">
              <option>Active</option>
              <option>On Leave</option>
              <option>Suspended</option>
            </select>
          </div>
          <div class="form-field">
            <label>Employment State</label>
            <select id="fEmpEmploymentState">
              <option>Full-Time</option>
              <option>Part-Time</option>
              <option>Freelance</option>
              <option>Occasional</option>
            </select>
          </div>
          <div class="form-field">
            <label>Vacation Balance <span class="opt">days</span></label>
            <input type="number" id="fEmpVac" value="21">
          </div>
        </div>
      </div>

      <div class="form-section optional-section">
        <div class="form-section-label"><i class="fa-solid fa-file-invoice-dollar"></i> Consultant Invoicing <span class="line"></span></div>
        <p style="font-size:11.5px;color:var(--text2);margin-bottom:12px;">
          Only needed if this employee has an external USD salary and requires consultant-fee invoices.
        </p>
        <div class="form-grid">
          <div class="form-field">
            <label>Invoice ID <span class="opt">01–99</span></label>
            <input type="text" id="fEmpInvoiceId" placeholder="e.g. 02" maxlength="2">
          </div>
          <div class="form-field full">
            <label>Address Line 1</label>
            <input id="fEmpAddressLine1" placeholder="e.g. 15 Example Street">
          </div>
          <div class="form-field full">
            <label>Address Line 2</label>
            <input id="fEmpAddressLine2" placeholder="e.g. New Cairo, Cairo Governorate">
          </div>
        </div>
      </div>

    </div>

    <div class="modal-foot">
      <button class="btn" id="empModalCancelBtn" onclick="closeModal('employeeModal')">Cancel</button>
      <button class="btn btn-fill" id="empModalSaveBtn" onclick="saveEmployee(event)">
        <i class="fa-solid fa-check"></i> Save Employee
      </button>
    </div>
  </div>
</div>
```

### 2.3 What changed and why

- Added `modal-v2` class to the outer `.modal` element (activates the new scoped CSS from Section 1). `.modal.wide` is preserved so width behavior is unchanged.
- Added an icon chip + one-line subtitle in the header — purely presentational, no functional impact.
- Split the flat `.form-grid` into four `.form-section` blocks: Basic Information, Compensation, Employment, and a visually distinct dashed-border "Consultant Invoicing" block for Invoice ID / Address.
- Added `id="empModalCancelBtn"` and `id="empModalSaveBtn"` to the footer buttons — new IDs needed for the loading-state JS in Section 3. These are additive; no existing `onclick` handler is removed.
- Did **not** remove the toggle switch shown in the prototype for the Consultant Invoicing section — it was omitted here to avoid adding new JS-driven show/hide behavior in this pass. The section is always visible, just visually de-emphasized. Wiring an actual show/hide toggle is a candidate for a later, separate enhancement — do not add it in this implementation.
- All 13 original field IDs are preserved exactly (`fEmpName`, `fEmpEmail`, `fEmpDept`, `fEmpRole`, `fEmpInternalSalary`, `fEmpExternalSalary`, `fEmpJoin`, `fEmpStatus`, `fEmpEmploymentState`, `fEmpVac`, `fEmpInvoiceId`, `fEmpAddressLine1`, `fEmpAddressLine2`) — no JavaScript changes are needed to `openEmployeeModal()`.

---

## 3. JavaScript — add a button-loading helper and use it in `saveEmployee()`

**File:** `fe/public/js/employees.js`

### 3.1 Add a shared helper (once)

Search the file for an existing `setButtonLoading` helper — the codebase may already have one from earlier UX work in this project (button loading states were previously discussed for other actions). If it already exists and matches this signature, reuse it and skip to Section 3.2. If it does not exist, add it once, near other small shared helpers (e.g. near `initials()` or `fmtMoney()`):

```js
function setButtonLoading(btn, isLoading, loadingText = 'Saving…') {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalHtml) {
      btn.dataset.originalHtml = btn.innerHTML;
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}
```

### 3.2 Locate the current `saveEmployee` function

Search for `async function saveEmployee`. Read its current body in full before editing — it may already accept an `evt` parameter (confirmed present in recent commits on this branch) and may already contain partial button-disable logic. Do not assume its exact current contents; verify directly.

### 3.3 Wrap the async call with the loading helper

Modify `saveEmployee` so that:

1. At the very start of the function (after any early-return validation, such as the "Please enter employee name" check), resolve the Save button — either from the `evt` parameter (`evt.currentTarget`) if the function already receives one, or via `document.getElementById('empModalSaveBtn')` if it does not.
2. Call `setButtonLoading(btn, true, 'Saving…')` immediately before the `Api.createEmployee(...)` / `Api.updateEmployee(...)` call.
3. Wrap the existing `try { ... } catch (err) { ... }` block with a `finally` clause that calls `setButtonLoading(btn, false)`, so the button always resets whether the request succeeds or fails.

Example shape (adapt to match the function's actual current structure — do not replace wholesale without first reading the real current implementation):

```js
async function saveEmployee(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('empModalSaveBtn');
  const name = document.getElementById('fEmpName').value.trim();
  if (!name) { toast('Please enter employee name.', 'fa-solid fa-triangle-exclamation'); return; }

  // ...existing field-reading and validation logic, unchanged...

  setButtonLoading(btn, true, 'Saving…');
  try {
    // ...existing Api.createEmployee(...) / Api.updateEmployee(...) call, unchanged...
    closeModal('employeeModal');
    await loadAdminData();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}
```

Do not change the validation logic, the payload shape, the API call, or the success/error toast behavior — only add the loading-state wrapper around the existing logic.

### 3.4 Do not touch Cancel button behavior

`closeModal('employeeModal')` on Cancel does not need a loading state (it's synchronous, no network call). Do not add `setButtonLoading` to the Cancel button.

---

## 4. Verification checklist

1. Open the Employees page and click "Add Employee." Confirm the modal renders with four visually distinct sections: Basic Information, Compensation, Employment, and a dashed-border Consultant Invoicing block.
2. Confirm all input fields have a white/bordered background, not grey.
3. Confirm Full Name and Email show a small red asterisk; Internal/External Salary and Vacation Balance show a muted "USD"/"days" unit label.
4. Fill in a valid new employee and click "Save Employee." Confirm the button immediately shows a spinner and "Saving…" text, and is disabled, for the duration of the request.
5. Confirm the button returns to its normal "Save Employee" label and re-enables after the request completes (both on success and if you simulate a failure, e.g. by temporarily disconnecting network).
6. Confirm the new employee is created correctly and all fields (including Invoice ID / Address if filled) are saved as before — the payload sent to the backend must be identical to before this change.
7. Click "Edit" on an existing employee (opens the same modal via `openEmployeeModal(id)`). Confirm all fields populate correctly into the new sectioned layout, exactly as they did in the old flat layout.
8. Resize the browser to confirm the modal remains usable at narrower widths (existing `@media` rules for `.form-grid` still apply, since the class name is unchanged).
9. Toggle dark theme and confirm the new section labels, dashed border, and icon chip remain legible (all new colors use existing CSS variables).
10. Confirm no other modal in the app changed in appearance — Bank Account, Raise, Behalf Vacation/Claim, Category, and Document Upload modals must look exactly as they did before this change, since none of them have the `modal-v2` class yet.

---

## 5. Next steps (do not implement yet — separate future passes)

Once Add Employee is verified working in production, apply the same `modal-v2` class and section pattern to the remaining modals, one at a time, each as its own commit:

1. Bank Account Details modal.
2. Apply Raise modal.
3. Behalf Vacation Request modal.
4. Behalf Insurance Claim modal.
5. Insurance Category modal.
6. Employee Document Upload modal (note: this one already has upload-progress UI; the loading-button pattern should complement, not replace, the existing progress bar).

Each of these should reuse the exact same `.modal-v2`, `.form-section`, `.form-section-label`, `.optional-section`, and `setButtonLoading()` building blocks defined in this plan — no new CSS classes should be invented per modal.

## 6. Rollback

This change is isolated to:
- One appended, scoped CSS block (`.modal-v2 ...`) — deleting it fully reverts styling for any element with that class.
- The `#employeeModal` markup — revert via version control history if needed.
- The `setButtonLoading` addition and its use in `saveEmployee` — both are additive; removing the `setButtonLoading(...)` calls restores the previous (non-loading) button behavior without affecting validation or the save logic itself.

No backend, API, or other modal is touched by this change.
