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
  document.getElementById('dochubFileInput').value = '';
  document.getElementById('dochubUploadProgressWrap').style.display = 'none';
  document.getElementById('companyDocumentModal').classList.add('active');
}
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
function renderCompanyDocumentsAdmin(filter=''){
  const body = document.getElementById('dochubTableBody');
  if(!body) return;
  const f = (filter||'').toLowerCase();
  const list = companyDocuments.filter(d => (d.name||'').toLowerCase().includes(f) || (d.category||'').toLowerCase().includes(f));
  body.innerHTML = list.map(d=>`<tr>
    <td><div class="doc-name-cell"><div class="doc-type-icon ${d.file_type==='image'?'image':'pdf'}">${docHubTypeIcon(d.file_type)}</div><span class="doc-name-text">${String(d.name||'').replace(/'/g,"\\'")}</span></div></td>
    <td>${d.category||'General'}</td>
    <td>${d.uploaded_at||''}</td>
    <td style="display:flex;gap:6px;justify-content:flex-end;">
      <button class="icon-action" title="Preview" onclick="previewCompanyDocument(${d.id}, '${String(d.name||'').replace(/'/g,"\\'")}', '${d.file_type||''}')"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-action" title="Download" onclick="downloadCompanyDocument(${d.id})"><i class="fa-solid fa-download"></i></button>
      <button class="icon-action" title="Delete" onclick="deleteCompanyDocumentPrompt(${d.id})"><i class="fa-solid fa-trash"></i></button>
    </td>
  </tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No company documents uploaded yet.</p></div></td></tr>`;
}
function renderCompanyDocumentsEmployee(filter=''){
  const body = document.getElementById('empDochubTableBody');
  if(!body) return;
  const f = (filter||'').toLowerCase();
  const list = companyDocuments.filter(d => (d.name||'').toLowerCase().includes(f) || (d.category||'').toLowerCase().includes(f));
  body.innerHTML = list.map(d=>`<tr>
    <td><div class="doc-name-cell"><div class="doc-type-icon ${d.file_type==='image'?'image':'pdf'}">${docHubTypeIcon(d.file_type)}</div><span class="doc-name-text">${String(d.name||'').replace(/'/g,"\\'")}</span></div></td>
    <td>${d.category||'General'}</td>
    <td>${d.uploaded_at||''}</td>
    <td style="display:flex;gap:6px;justify-content:flex-end;">
      <button class="icon-action" title="Preview" onclick="previewCompanyDocument(${d.id}, '${String(d.name||'').replace(/'/g,"\\'")}', '${d.file_type||''}')"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-action" title="Download" onclick="downloadCompanyDocument(${d.id})"><i class="fa-solid fa-download"></i></button>
    </td>
  </tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No company documents available yet.</p></div></td></tr>`;
}
const dochubSearchEl = document.getElementById('dochubSearch');
if(dochubSearchEl) dochubSearchEl.addEventListener('input', e=>renderCompanyDocumentsAdmin(e.target.value));
const empDochubSearchEl = document.getElementById('empDochubSearch');
if(empDochubSearchEl) empDochubSearchEl.addEventListener('input', e=>renderCompanyDocumentsEmployee(e.target.value));

async function submitCompanyDocument(evt){
  const name = document.getElementById('dochubDocName').value.trim();
  const category = document.getElementById('dochubDocCategory').value;
  const file = document.getElementById('dochubFileInput').files[0];
  if(!name){ toast('Please enter a document name.','fa-solid fa-triangle-exclamation'); return; }
  if(!file){ toast('Please choose a file to upload.','fa-solid fa-triangle-exclamation'); return; }
  if(file.size > 4*1024*1024){ toast('File must be under 4MB.','fa-solid fa-triangle-exclamation'); return; }
  const fileType = detectDochubFileType(file);
  const progressWrap = document.getElementById('dochubUploadProgressWrap');
  const progressFill = document.getElementById('dochubUploadProgressFill');
  const progressPct = document.getElementById('dochubUploadProgressPct');
  const progressText = document.getElementById('dochubUploadProgressText');
  const uploadBtn = document.getElementById('dochubUploadBtn');
  setButtonLoading(uploadBtn, true, 'Uploading...');
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
    setButtonLoading(uploadBtn, false);
  }
}
async function deleteCompanyDocumentPrompt(docId){
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
    container.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Loading preview...</div>';
  }
  document.getElementById('documentPreviewModal').classList.add('active');
  Api.getCompanyDocumentPreviewBlobUrl(docId).then(url => {
    if(!container) return;
    container.innerHTML = fileType === 'image'
      ? `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;">`
      : `<iframe src="${url}" style="width:100%;height:100%;border:none;"></iframe>`;
  }).catch(err => {
    if(container) container.innerHTML = `<div style="color:#f87171;font-size:13px;padding:20px;text-align:center;">${err.message}</div>`;
  });
}
function downloadCompanyDocument(docId){
  Api.downloadCompanyDocumentFile(docId, 'document').catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
}