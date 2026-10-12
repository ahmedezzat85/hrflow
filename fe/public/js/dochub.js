function readFileAsDataUrlDochub(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function detectDochubFileType(file){
  return file.type === 'application/pdf' ? 'pdf' : 'image';
}
function openCompanyDocumentModal(){
  document.getElementById('dochubDocName').value = '';
  document.getElementById('dochubDocCategory').value = 'General';
  clearDochubDocFileSelection();
  document.getElementById('dochubUploadProgressWrap').style.display = 'none';
  document.getElementById('companyDocumentModal').classList.add('active');
}

function clearDochubDocFileSelection(){
  dochubSelectedFile = null;
  const fileInput = document.getElementById('dochubFileInput');
  if(fileInput) fileInput.value = '';
  const emptyEl = document.getElementById('dochubDocDropZoneEmpty');
  const fileEl = document.getElementById('dochubDocDropZoneFile');
  if(emptyEl) emptyEl.style.display = '';
  if(fileEl) fileEl.style.display = 'none';
}

function handleDochubDocFileSelected(file){
  if(!file) return;
  if(file.size > 4 * 1024 * 1024){
    toast('File must be under 4MB.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name);
  if(!isPdf && !isImage){
    toast('Only PDF and image files (JPG, PNG) are supported.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  dochubSelectedFile = file;
  const fileType = detectDochubFileType(file);
  const emptyEl = document.getElementById('dochubDocDropZoneEmpty');
  const fileEl = document.getElementById('dochubDocDropZoneFile');
  const nameEl = document.getElementById('dochubDocFileName');
  const sizeEl = document.getElementById('dochubDocFileSize');
  const iconWrap = document.getElementById('dochubDocFileIconWrap');
  if(emptyEl) emptyEl.style.display = 'none';
  if(fileEl) fileEl.style.display = 'flex';
  if(nameEl) nameEl.textContent = file.name;
  if(sizeEl) sizeEl.textContent = typeof formatFileSize === 'function' ? formatFileSize(file.size) : (file.size < 1024*1024 ? (file.size/1024).toFixed(1) + ' KB' : (file.size/(1024*1024)).toFixed(1) + ' MB');
  if(iconWrap){
    iconWrap.className = 'doc-file-icon ' + (fileType === 'image' ? 'image' : 'pdf');
    iconWrap.innerHTML = fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
  }
  if(!document.getElementById('dochubDocName').value.trim()){
    document.getElementById('dochubDocName').value = file.name.replace(/\.[^.]+$/, '');
  }
}

function initDochubDocDropZoneListeners(){
  const zone = document.getElementById('dochubDocDropZone');
  const input = document.getElementById('dochubFileInput');
  if(!zone || !input || zone.dataset.bound) return;
  zone.dataset.bound = '1';
  input.addEventListener('change', () => { if(input.files[0]) handleDochubDocFileSelected(input.files[0]); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if(f){
      input.files = e.dataTransfer.files;
      handleDochubDocFileSelected(f);
    }
  });
}
document.addEventListener('DOMContentLoaded', initDochubDocDropZoneListeners);
if (document.readyState !== 'loading') initDochubDocDropZoneListeners();

async function loadCompanyDocuments(){
  try{
    companyDocuments = await Api.getCompanyDocuments();
    renderCompanyDocumentsAdmin();
    renderCompanyDocumentsEmployee();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function docHubTypeIcon(fileType){
  return fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
}
let currentDochubCategory = 'all';

function renderDochubCategoryPills() {
  const group = document.getElementById('dochubCategoryFilterGroup');
  if (!group) return;
  const docs = typeof companyDocuments !== 'undefined' && Array.isArray(companyDocuments) ? companyDocuments : [];
  const knownCats = ['Policy', 'Handbook', 'Form', 'General', 'Announcement'];
  const dataCats = docs.map(d => d.category).filter(Boolean);
  const cats = Array.from(new Set([...dataCats, ...knownCats]));
  const allCount = docs.length;
  let html = `<button type="button" class="filter-tab fv-pill${currentDochubCategory === 'all' ? ' active' : ''}" data-doc-cat="all" aria-pressed="${currentDochubCategory === 'all'}">All <span class="tab-count hv-count">${allCount}</span></button>`;
  cats.forEach(c => {
    const count = docs.filter(d => (d.category || '').toLowerCase() === c.toLowerCase()).length;
    const isMuted = count === 0 ? ' style="opacity:.55;"' : '';
    html += `<button type="button" class="filter-tab fv-pill${currentDochubCategory.toLowerCase() === c.toLowerCase() ? ' active' : ''}" data-doc-cat="${escapeHtml(c)}" aria-pressed="${currentDochubCategory.toLowerCase() === c.toLowerCase()}"${isMuted}>${escapeHtml(c)} <span class="tab-count hv-count" style="opacity:.75;">${count}</span></button>`;
  });
  group.innerHTML = html;
  if (!group.dataset.bound) {
    group.dataset.bound = '1';
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-doc-cat]');
      if (!btn) return;
      currentDochubCategory = btn.dataset.docCat;
      group.querySelectorAll('[data-doc-cat]').forEach(b => {
        const active = b.dataset.docCat.toLowerCase() === currentDochubCategory.toLowerCase();
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active);
      });
      const searchVal = document.getElementById('dochubSearch') ? document.getElementById('dochubSearch').value : '';
      renderCompanyDocumentsAdmin(searchVal);
    });
  }
}

function renderCompanyDocumentsAdmin(filter=''){
  const body = document.getElementById('dochubTableBody');
  if(!body) return;
  renderDochubCategoryPills();
  const f = (filter||'').toLowerCase();
  const catFilter = currentDochubCategory;
  const list = (typeof companyDocuments !== 'undefined' ? companyDocuments : []).filter(d => {
    const matchesCat = catFilter === 'all' || (d.category || '').toLowerCase() === catFilter.toLowerCase();
    const matchesSearch = !f || (d.name||'').toLowerCase().includes(f) || (d.category||'').toLowerCase().includes(f);
    return matchesCat && matchesSearch;
  });
  body.innerHTML = list.map(d=>{
    const ext = (d.file_type === 'image' ? 'IMG' : (d.file_type || 'PDF')).toUpperCase();
    const meta = d.file_size ? `${ext} · ${typeof formatFileSize === 'function' ? formatFileSize(d.file_size) : (d.file_size/1024).toFixed(0) + ' KB'}` : ext;
    const dateFormatted = fmtDateShort(d.uploaded_at) || d.uploaded_at || '';
    return `<tr>
      <td>
        <div class="doc-name-cell">
          <div class="doc-type-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7zM14 3v4h4"></path></svg></div>
          <div>
            <span class="doc-name-text">${escapeHtml(d.name || '')}</span>
            <span class="doc-name-meta">${meta}</span>
          </div>
        </div>
      </td>
      <td data-label="Category"><span class="hv-catdot" data-cat="${escapeHtml(d.category||'General')}">${escapeHtml(d.category||'General')}</span></td>
      <td data-label="Uploaded" style="white-space:nowrap;">${dateFormatted}</td>
      <td class="col-actions">
        <button type="button" class="btn btn-sm btn-outline" data-action="preview-company-doc" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || '')}" data-type="${escapeHtml(d.file_type || '')}">Preview</button>
        <button type="button" class="icon-action" aria-label="Download ${escapeHtml(d.name || '')}" onclick="downloadCompanyDocument(${d.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M4 20h16"></path></svg></button>
        <button type="button" class="icon-action text-danger" aria-label="Remove ${escapeHtml(d.name || '')}" onclick="deleteCompanyDocumentPrompt(${d.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>
      </td>
    </tr>`;
  }).join('') || renderEmptyTableRow(4, 'No company documents uploaded yet.', 'fa-solid fa-folder-open');
  setTableFoot('dochubTableBody', list.length, 'documents');
}
function renderCompanyDocumentsEmployee(filter=''){
  const body = document.getElementById('empDochubTableBody');
  if(!body) return;
  const f = (filter||'').toLowerCase();
  const list = (typeof companyDocuments !== 'undefined' ? companyDocuments : []).filter(d => (d.name||'').toLowerCase().includes(f) || (d.category||'').toLowerCase().includes(f));
  body.innerHTML = list.map(d=>{
    const ext = (d.file_type === 'image' ? 'IMG' : (d.file_type || 'PDF')).toUpperCase();
    const meta = d.file_size ? `${ext} · ${typeof formatFileSize === 'function' ? formatFileSize(d.file_size) : (d.file_size/1024).toFixed(0) + ' KB'}` : ext;
    const dateFormatted = fmtDateShort(d.uploaded_at) || d.uploaded_at || '';
    return `<tr>
      <td>
        <div class="doc-name-cell">
          <div class="doc-type-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7zM14 3v4h4"></path></svg></div>
          <div>
            <span class="doc-name-text">${escapeHtml(d.name || '')}</span>
            <span class="doc-name-meta">${meta}</span>
          </div>
        </div>
      </td>
      <td data-label="Category"><span class="hv-catdot" data-cat="${escapeHtml(d.category||'General')}">${escapeHtml(d.category||'General')}</span></td>
      <td data-label="Uploaded" style="white-space:nowrap;">${dateFormatted}</td>
      <td class="col-actions">
        <button type="button" class="btn btn-sm btn-outline" data-action="preview-company-doc" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name || '')}" data-type="${escapeHtml(d.file_type || '')}">Preview</button>
        <button type="button" class="icon-action" aria-label="Download ${escapeHtml(d.name || '')}" onclick="downloadCompanyDocument(${d.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M4 20h16"></path></svg></button>
      </td>
    </tr>`;
  }).join('') || renderEmptyTableRow(4, 'No company documents available yet.', 'fa-solid fa-folder-open');
}
const dochubSearchEl = document.getElementById('dochubSearch');
if(dochubSearchEl) dochubSearchEl.addEventListener('input', e=>renderCompanyDocumentsAdmin(e.target.value));
const empDochubSearchEl = document.getElementById('empDochubSearch');
if(empDochubSearchEl) empDochubSearchEl.addEventListener('input', e=>renderCompanyDocumentsEmployee(e.target.value));

async function submitCompanyDocument(evt){
  const name = document.getElementById('dochubDocName').value.trim();
  const category = document.getElementById('dochubDocCategory').value;
  const file = dochubSelectedFile || (document.getElementById('dochubFileInput') && document.getElementById('dochubFileInput').files[0]);
  if(!name){ toast('Please enter a document name.','fa-solid fa-triangle-exclamation'); return; }
  if(!file){ toast('Please choose a file to upload.','fa-solid fa-triangle-exclamation'); return; }
  if(file.size > 4*1024*1024){ toast('File must be under 4MB.','fa-solid fa-triangle-exclamation'); return; }
  const fileType = detectDochubFileType(file);
  const progressWrap = document.getElementById('dochubUploadProgressWrap');
  const progressFill = document.getElementById('dochubUploadProgressFill');
  const progressPct = document.getElementById('dochubUploadProgressPct');
  const progressText = document.getElementById('dochubUploadProgressText');
  const uploadBtn = document.getElementById('dochubUploadBtn');
  const cancelBtn = document.getElementById('dochubCancelBtn');
  if(cancelBtn) cancelBtn.disabled = true;
  setButtonLoading(uploadBtn, true, 'Uploading…');
  try{
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%'; progressPct.textContent = '0%';
    progressText.textContent = 'Preparing file...';
    const dataUrl = await readFileAsDataUrlDochub(file);
    progressText.textContent = 'Uploading...';
    await Api.uploadCompanyDocumentWithProgress({ name, file_type: fileType, data_url: dataUrl, category }, (pct)=>{
      progressFill.style.width = pct + '%'; progressPct.textContent = pct + '%';
      if(pct>=100) progressText.textContent = 'Finishing up...';
    });
    toast('Document uploaded.');
    closeModal('companyDocumentModal');
    await loadCompanyDocuments();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  finally{
    progressWrap.style.display = 'none';
    if(cancelBtn) cancelBtn.disabled = false;
    setButtonLoading(uploadBtn, false);
  }
}
async function deleteCompanyDocumentPrompt(docId){
  const ok = await FinanceCommand.confirmAction({
    title: 'Delete document',
    consequence: 'Delete this company document? This cannot be undone.',
    actionLabel: 'Delete document',
  });
  if (!ok.confirmed) return;
  try{
    await Api.deleteCompanyDocument(docId);
    toast('Document deleted.', 'fa-solid fa-trash');
    await loadCompanyDocuments();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function previewCompanyDocument(docId, name, fileType){
  const container = document.getElementById('docPreviewContainer');
  document.getElementById('docPreviewTitle').textContent = name || 'Document Preview';
  // Download button: fetch-then-blob (see Api.downloadCompanyDocumentFile) instead of
  // a direct href/window.open, since a plain cross-context resource load does not
  // reliably send the SameSite=Lax session cookie.
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    Api.downloadCompanyDocumentFile(docId, name || 'document').catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
  };
  if(container){
    renderLoadingState(container, 'Loading preview...');
  }
  document.getElementById('documentPreviewModal').classList.add('active');
  Api.getCompanyDocumentPreviewBlobUrl(docId).then(url => {
    if(!container) return;
    container.innerHTML = fileType === 'image'
      ? `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;">`
      : `<iframe src="${url}" style="width:100%;height:100%;border:none;"></iframe>`;
  }).catch(err => {
    if(container) container.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:20px;text-align:center;">${err.message}</div>`;
  });
}
function downloadCompanyDocument(docId){
  Api.downloadCompanyDocumentFile(docId, 'document').catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
}