# Insurance Claim Upload — Drop-Zone Redesign — Implementation Plan

**Status:** Approved, minimal-scope change.

**Goal:** Replace the plain `<input type="file">` for the supporting-document field inside the **Submit Insurance Claim on Behalf** modal (`#behalfClaimModal`) with the same drag-and-drop upload UI already used in the **Upload Employee Document** modal (`#employeeDocumentModal`), sized smaller to fit its role as one optional field among several, not the entire modal's purpose.

**Files touched:**
1. `fe/src/styles.css` — append one small, scoped CSS rule for a compact drop-zone variant. No existing `.doc-drop-*` rule is modified, since `#employeeDocumentModal` must keep its current (larger) appearance.
2. `fe/src/index.html` — replace the file input markup inside `#behalfClaimModal` only.
3. `fe/public/js/employees.js` — extend the existing drop-zone JS logic to support this second, independent drop zone (a new ID, not shared state with the document-upload one).

**Out of scope for this plan:** The employee-facing "Submit a Claim" form on the employee dashboard (`#claimDocument` in `insurance.js` / `submitClaim()`) is a separate, similar plain file input. It is intentionally **not** included here — only the admin-side "Submit Insurance Claim on Behalf" modal is being changed, per the request. A follow-up plan can apply the same pattern there later if desired.

---

## 1. Current state (verified)

`#behalfClaimModal` currently has, inside its "Processing & Attachment" section:

```html
<div class="form-field full">
  <label>Supporting Document <span class="opt">Optional</span></label>
  <input type="file" id="bcDocument" accept=".pdf,.jpg,.jpeg,.png">
</div>
```

`#employeeDocumentModal` has the elegant reference implementation:

```html
<div class="form-field full">
  <label>File <span class="req">*</span></label>
  <div id="docDropZone" class="doc-drop-zone" onclick="document.getElementById('docFileInput').click()">
    <input type="file" id="docFileInput" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
    <div id="docDropZoneEmpty" class="doc-drop-empty">
      <i class="fa-solid fa-cloud-arrow-up"></i>
      <p><strong>Click to browse</strong> or drag a file here</p>
      <span>PDF, JPG or PNG - up to 4MB</span>
    </div>
    <div id="docDropZoneFile" class="doc-drop-file" style="display:none;">
      <div class="doc-file-icon" id="docFileIconWrap"><i class="fa-solid fa-file"></i></div>
      <div class="doc-file-meta">
        <p id="docFileName" class="doc-file-name">-</p>
        <span id="docFileSize" class="doc-file-size">-</span>
      </div>
      <button type="button" class="icon-action" title="Remove" onclick="event.stopPropagation(); clearDocFileSelection();"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
</div>
```

The supporting JS lives in `fe/public/js/employees.js`: `detectDocFileType()`, `formatFileSize()`, `handleDocFileSelected()`, `initDocDropZoneListeners()`, `clearDocFileSelection()`. These currently operate on one hardcoded set of element IDs (`docDropZone`, `docFileInput`, `docFileName`, etc.) and one shared variable, `docSelectedFile`.

**Key constraint:** `submitBehalfClaim()` currently reads the file directly from the raw `<input>` via `fileInput.files[0]` (see `document.getElementById('bcDocument')`). This must keep working — the new drop zone must expose the selected file the same way (a real `<input type="file">` still exists underneath, just visually hidden, exactly like the reference implementation).

---

## 2. CSS — append to `fe/src/styles.css`

The existing `.doc-drop-zone`, `.doc-drop-empty`, `.doc-drop-file`, `.doc-file-icon`, `.doc-file-meta`, `.doc-file-name`, `.doc-file-size` rules are reused as-is — do not duplicate them. Add one small modifier class for the more compact sizing requested:

```css
/* ===== Compact drop-zone variant (used in Behalf Claim modal) ===== */
.doc-drop-zone.compact{
  padding:14px 12px;
}
.doc-drop-zone.compact .doc-drop-empty i{
  font-size:20px;
  margin-bottom:4px;
}
.doc-drop-zone.compact .doc-drop-empty p{
  font-size:12.5px;
  margin:0;
}
.doc-drop-zone.compact .doc-drop-empty span{
  font-size:11px;
}
.doc-drop-zone.compact .doc-file-icon{
  width:32px;
  height:32px;
  font-size:14px;
}
.doc-drop-zone.compact .doc-file-name{
  font-size:12.5px;
}
.doc-drop-zone.compact .doc-file-size{
  font-size:10.5px;
}
```

This only reduces padding, icon size, and text size; the drag-over highlight and file-type icon coloring (`.doc-drop-zone.drag-over`, `.doc-file-icon.pdf`, `.doc-file-icon.image`) are inherited unchanged from the existing rules.

---

## 3. HTML — replace the file input inside `#behalfClaimModal`

**File:** `fe/src/index.html`

Replace:

```html
<div class="form-field full">
  <label>Supporting Document <span class="opt">Optional</span></label>
  <input type="file" id="bcDocument" accept=".pdf,.jpg,.jpeg,.png">
</div>
```

With:

```html
<div class="form-field full">
  <label>Supporting Document <span class="opt">Optional</span></label>
  <div id="bcDocDropZone" class="doc-drop-zone compact" onclick="document.getElementById('bcDocument').click()">
    <input type="file" id="bcDocument" accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
    <div id="bcDocDropZoneEmpty" class="doc-drop-empty">
      <i class="fa-solid fa-cloud-arrow-up"></i>
      <p><strong>Click to browse</strong> or drag a file here</p>
      <span>PDF, JPG or PNG - up to 2MB</span>
    </div>
    <div id="bcDocDropZoneFile" class="doc-drop-file" style="display:none;">
      <div class="doc-file-icon" id="bcDocFileIconWrap"><i class="fa-solid fa-file"></i></div>
      <div class="doc-file-meta">
        <p id="bcDocFileName" class="doc-file-name">-</p>
        <span id="bcDocFileSize" class="doc-file-size">-</span>
      </div>
      <button type="button" class="icon-action" title="Remove" onclick="event.stopPropagation(); clearBcDocFileSelection();"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
</div>
```

**Important details:**
- `id="bcDocument"` on the `<input>` is **unchanged** — this preserves `submitBehalfClaim()`'s existing `document.getElementById('bcDocument')` / `fileInput.files[0]` read exactly as-is. No changes are needed to the submit logic itself.
- The size limit text says "up to 2MB" (not 4MB like the document modal) because `submitBehalfClaim()` already enforces a 2MB limit for this field (confirmed in its existing validation: `if (file.size > 2*1024*1024)`). The label must match the real limit, not the document-modal's limit.
- All new IDs are prefixed `bc...` to avoid any collision with the existing `doc...` IDs used by the Employee Document modal — these are two independent drop zones on the same page and must not share state.

---

## 4. JavaScript — add a second, independent drop-zone handler

**File:** `fe/public/js/employees.js`

### 4.1 Do not reuse the existing `docSelectedFile` variable or `handleDocFileSelected()` / `clearDocFileSelection()` functions as-is

Those are tied to the Employee Document modal's specific IDs and its own `docSelectedFile` module-level variable. Reusing them directly would cause the two upload widgets to overwrite each other's selected file if both modals were ever opened in the same session. Instead, add a small parallel set scoped to the claim modal.

### 4.2 Add a new state variable

Near the existing `let docSelectedFile = null;` declaration, add:

```js
let bcDocSelectedFile = null;
```

### 4.3 Add the claim-specific handlers

Add these functions near the existing `detectDocFileType()` / `formatFileSize()` helpers (reuse those two helpers as-is — they are generic and don't reference any specific modal's IDs):

```js
function clearBcDocFileSelection() {
  bcDocSelectedFile = null;
  const fileInput = document.getElementById('bcDocument');
  if (fileInput) fileInput.value = '';
  document.getElementById('bcDocDropZoneEmpty').style.display = '';
  document.getElementById('bcDocDropZoneFile').style.display = 'none';
}

function handleBcDocFileSelected(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Supporting document must be under 2MB.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name);
  if (!isPdf && !isImage) {
    toast('Only PDF and image files (JPG, PNG) are supported.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  bcDocSelectedFile = file;
  const fileType = detectDocFileType(file);
  document.getElementById('bcDocDropZoneEmpty').style.display = 'none';
  document.getElementById('bcDocDropZoneFile').style.display = 'flex';
  document.getElementById('bcDocFileName').textContent = file.name;
  document.getElementById('bcDocFileSize').textContent = formatFileSize(file.size);
  const iconWrap = document.getElementById('bcDocFileIconWrap');
  iconWrap.className = 'doc-file-icon ' + (fileType === 'image' ? 'image' : 'pdf');
  iconWrap.innerHTML = fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
}

function initBcDocDropZoneListeners() {
  const zone = document.getElementById('bcDocDropZone');
  const input = document.getElementById('bcDocument');
  if (!zone || !input || zone.dataset.bound) return;
  zone.dataset.bound = '1';
  input.addEventListener('change', () => { if (input.files[0]) handleBcDocFileSelected(input.files[0]); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      input.files = e.dataTransfer.files;
      handleBcDocFileSelected(f);
    }
  });
}
```

Note the `drop` handler explicitly sets `input.files = e.dataTransfer.files` — this is required so that `submitBehalfClaim()`'s existing `fileInput.files[0]` read (which reads directly from the native input, not from `bcDocSelectedFile`) continues to see the dropped file, not just a clicked/browsed one. This mirrors what a native file input does automatically for `change` events but must be done manually for `drop`.

### 4.4 Wire up initialization

Find the existing initialization calls:

```js
document.addEventListener('DOMContentLoaded', initDocDropZoneListeners);
if (document.readyState !== 'loading') initDocDropZoneListeners();
```

Add the equivalent for the new zone directly below:

```js
document.addEventListener('DOMContentLoaded', initBcDocDropZoneListeners);
if (document.readyState !== 'loading') initBcDocDropZoneListeners();
```

### 4.5 Reset the drop zone when the modal opens

Find `openBehalfClaimModal()`. It currently does:

```js
async function openBehalfClaimModal() {
  ...
  const fileInput = document.getElementById('bcDocument');
  if (fileInput) fileInput.value = '';
  document.getElementById('behalfClaimModal').classList.add('active');
}
```

Replace the two lines that reset the file input with a call to the new reset function, so the drop zone visually resets (not just the underlying input value) each time the modal opens:

```js
async function openBehalfClaimModal() {
  ...
  clearBcDocFileSelection();
  document.getElementById('behalfClaimModal').classList.add('active');
}
```

### 4.6 Do not change `submitBehalfClaim()`

Its existing logic:

```js
const fileInput = document.getElementById('bcDocument');
...
const file = fileInput && fileInput.files[0];
if (file) {
  if (file.size > 2*1024*1024) { toast('Supporting document must be under 2MB.', 'fa-solid fa-triangle-exclamation'); return; }
  try { documentUrl = await readFileAsDataUrl(file); }
  catch (e) { toast('Could not read the selected file.', 'fa-solid fa-triangle-exclamation'); return; }
}
```

remains completely unchanged. Since `id="bcDocument"` is preserved and the native input's `.files` property is correctly populated by both `change` and the manual `drop` assignment in Section 4.3, this function needs no modification.

---

## 5. Verification checklist

1. Open "Submit Insurance Claim on Behalf" from an employee's detail page.
2. Confirm the Supporting Document field now shows a compact drag-and-drop zone (smaller icon/text than the Employee Document modal's zone), not a plain file input button.
3. Click the zone and browse for a PDF or image file under 2MB. Confirm it displays the file name, size, and correct type icon (PDF or image), matching the visual style of the Employee Document modal's file-selected state.
4. Drag and drop a valid file directly onto the zone. Confirm it's accepted and displayed the same way as a browsed file.
5. Attempt to select a file over 2MB. Confirm the existing toast ("Supporting document must be under 2MB.") still fires and the file is not accepted.
6. Attempt to select an unsupported file type (e.g., `.docx`). Confirm the existing toast ("Only PDF and image files...") still fires.
7. Click the "X" remove button on a selected file. Confirm it clears back to the empty drop-zone state.
8. Submit a claim with a valid document attached. Confirm the claim is created successfully and the document is retrievable exactly as before this change (no regression in `submitBehalfClaim()`'s upload behavior).
9. Submit a claim with no document attached (it's optional). Confirm this still works exactly as before.
10. Close the modal, reopen it. Confirm the drop zone resets to its empty state (no leftover file from a previous session).
11. Open the Employee Document modal (`#employeeDocumentModal`) separately and confirm its drop zone still behaves exactly as before — larger size, independent state, no interference from the new Behalf Claim drop zone.
12. Toggle dark theme and confirm the compact drop zone remains legible (all styling uses existing CSS variables).

---

## 6. Rollback

This change is isolated to:
- One small appended CSS block (`.doc-drop-zone.compact ...`) — delete to revert styling only.
- The `#behalfClaimModal` file-field markup — revert via version control if needed; the `id="bcDocument"` input itself is unchanged, so even a partial rollback (reverting only the CSS/HTML wrapper) leaves the underlying submit logic intact.
- The four new JS functions (`clearBcDocFileSelection`, `handleBcDocFileSelected`, `initBcDocDropZoneListeners`, and the `bcDocSelectedFile` variable) plus the two edited lines in `openBehalfClaimModal()` — all additive/isolated to this one modal, with no shared state with the Employee Document modal's existing drop-zone code.

No backend, API, or other modal is touched by this change.
