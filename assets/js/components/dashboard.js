/**
 * dashboard.js — StudentMS v3 Dashboard Controller
 * Manages all UI state, data binding, table rendering, form logic, modals.
 * NEW: Multi-select subjects, bulk image download, optimistic UI updates,
 *      improved filtering, Drive folder structure, large-data optimizations.
 */
'use strict';

/* ── Subject list ─────────────────────── */
const SUBJECTS_LIST = [
  'Mathematics','Physics','Chemistry','Biology',
  'English','Hindi','Bengali','History',
  'Geography','Civics','Economics','Accountancy',
  'Business Studies','Computer Science','Political Science',
  'Sociology','Psychology','Philosophy','Physical Education',
  'Fine Arts','Music','Sanskrit','Environmental Science',
  'Information Technology','Statistics','Home Science','Agriculture'
];

/* ── State ──────────────────────────────── */
let _allStudents   = [];
let _filtered      = [];
let _currentPage   = 1;
let _perPage       = 50;
let _sortField     = 'createdAt';
let _sortDir       = 'desc';
let _searchQuery   = '';
let _filterClass   = '';
let _filterSection = '';
let _filterStatus  = '';
let _selectedIds   = new Set();
let _editDocId     = null;
let _photoDataUrl  = '';
let _stream        = null;
let _facingMode    = 'environment';
let _viewDocId     = null;
let _subjectPicker = null; // MultiSelectSubjects instance

/* ── DOM refs ───────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
  pageMain:          $('pageMain'),
  pageReg:           $('pageReg'),
  studentTbody:      $('studentTbody'),
  searchInput:       $('searchInput'),
  navSearch:         $('navSearch'),
  searchClearBtn:    $('searchClearBtn'),
  filterClass:       $('filterClass'),
  filterSection:     $('filterSection'),
  filterStatus:      $('filterStatus'),
  sortField:         $('sortField'),
  sortDir:           $('sortDir'),
  perPage:           $('perPage'),
  selectAll:         $('selectAll'),
  bulkBar:           $('bulkBar'),
  bulkCount:         $('bulkCount'),
  resultCount:       $('resultCount'),
  pageControls:      $('pageControls'),
  exportProgress:    $('exportProgress'),
  importProgress:    $('importProgress'),
  clearAllConfirm:   $('clearAllConfirmInput'),
  confirmClearAll:   $('confirmClearAllBtn'),
  // form fields
  fName:             $('fName'),
  fStudentId:        $('fStudentId'),
  fClass:            $('fClass'),
  fSection:          $('fSection'),
  fRollNo:           $('fRollNo'),
  fGender:           $('fGender'),
  fDob:              $('fDob'),
  fBloodGroup:       $('fBloodGroup'),
  fFatherName:       $('fFatherName'),
  fMotherName:       $('fMotherName'),
  fGuardianName:     $('fGuardianName'),
  fGuardianRelation: $('fGuardianRelation'),
  fContactNo:        $('fContactNo'),
  fAadhaarNo:        $('fAadhaarNo'),
  fAddress:          $('fAddress'),
  fSession:          $('fSession'),
  fAcademicYear:     $('fAcademicYear'),
  fStream:           $('fStream'),
  fSchoolName:       $('fSchoolName'),
  fSubjects:         $('fSubjects'),
  // camera / photo
  video:             $('video'),
  camPlaceholder:    $('camPlaceholder'),
  startCamBtn:       $('startCamBtn'),
  captureBtn:        $('captureBtn'),
  stopCamBtn:        $('stopCamBtn'),
  rotateCamBtn:      $('rotateCamBtn'),
  fileUpload:        $('fileUpload'),
  previewImage:      $('previewImage'),
  noPhPlaceholder:   $('noPhPlaceholder'),
  uploadZone:        $('uploadZone'),
};

/* ════════════════════════════════════════
   BOOT
════════════════════════════════════════ */
(function boot() {
  initFirebase();
  initTheme();
  $('themeIcon').textContent = (localStorage.getItem('sms_theme') || 'dark') === 'dark' ? '🌙' : '☀️';
  initModalListeners();
  _subjectPicker = new MultiSelectSubjects({ subjects: SUBJECTS_LIST });
  bindEvents();

  AuthService.onAuthStateChanged((user, role) => {
    if (!user) { window.location.replace('login.html'); return; }

    const displayName = user.displayName || user.email || 'Admin';
    $('userName').textContent = displayName.split(' ')[0];
    $('userAvatar').textContent = displayName.charAt(0).toUpperCase();

    // Restore Drive connection (token persisted in sessionStorage) so the
    // Drive button/stat reflect the real state after a page reload.
    updateDriveUI(DriveService.tryRestoreToken());

    startStatsListener();
    startStudentsListener();
    populateFilterDropdowns();
  });
})();

/* ════════════════════════════════════════
   EVENT BINDING
════════════════════════════════════════ */
function bindEvents() {
  // Nav / theme / sign-out
  $('themeToggleBtn').addEventListener('click', () => {
    toggleTheme();
    $('themeIcon').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '🌙' : '☀️';
  });
  $('signOutBtn').addEventListener('click', () => openModal('signOutModal'));
  $('confirmSignOutBtn').addEventListener('click', async () => {
    await AuthService.signOut();
    window.location.replace('login.html');
  });

  // Dual search
  const handleSearch = debounce(q => {
    _searchQuery = q.trim();
    _currentPage = 1;
    dom.searchInput.value = q;
    dom.navSearch.value   = q;
    dom.searchClearBtn.style.display = q ? 'block' : 'none';
    renderTable();
  }, 250);
  dom.searchInput.addEventListener('input', e => handleSearch(e.target.value));
  dom.navSearch.addEventListener('input',  e => handleSearch(e.target.value));
  dom.searchClearBtn.addEventListener('click', () => handleSearch(''));

  // Filters
  dom.filterClass.addEventListener('change', e   => { _filterClass   = e.target.value; _currentPage = 1; renderTable(); });
  dom.filterSection.addEventListener('change', e => { _filterSection = e.target.value; _currentPage = 1; renderTable(); });
  dom.filterStatus.addEventListener('change', e  => { _filterStatus  = e.target.value; _currentPage = 1; renderTable(); });
  dom.sortField.addEventListener('change', e => { _sortField = e.target.value; _currentPage = 1; renderTable(); });
  dom.sortDir.addEventListener('change',   e => { _sortDir   = e.target.value; _currentPage = 1; renderTable(); });
  dom.perPage.addEventListener('change',   e => { _perPage   = Number(e.target.value); _currentPage = 1; renderTable(); });

  // Table header click-to-sort
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (_sortField === f) { _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'; }
      else { _sortField = f; _sortDir = 'asc'; }
      dom.sortField.value = _sortField;
      dom.sortDir.value   = _sortDir;
      _currentPage = 1;
      renderTable();
    });
  });

  // Select all
  dom.selectAll.addEventListener('change', e => {
    const pageIds = getPageStudents().map(s => s._docId);
    if (e.target.checked) { pageIds.forEach(id => _selectedIds.add(id)); }
    else { pageIds.forEach(id => _selectedIds.delete(id)); }
    updateBulkBar();
    renderTable();
  });

  // Bulk actions
  $('bulkExportBtn').addEventListener('click', () => {
    const sel = _allStudents.filter(s => _selectedIds.has(s._docId));
    ExportService.exportToExcel(sel, DriveService.isConnected());
  });
  $('bulkDownloadImagesBtn').addEventListener('click', () => {
    const sel = _allStudents.filter(s => _selectedIds.has(s._docId));
    BulkDownloader.download(sel, 'SelectedStudentImages');
  });
  $('bulkDeleteBtn').addEventListener('click', () => {
    $('bulkDeleteDesc').textContent = `Permanently delete ${_selectedIds.size} selected student(s)?`;
    openModal('bulkDeleteModal');
  });
  $('confirmBulkDeleteBtn').addEventListener('click', async () => {
    closeModal('bulkDeleteModal');
    const ids = [..._selectedIds];
    $('confirmBulkDeleteBtn').disabled = true;
    const result = await StudentService.bulkDelete(ids);
    if (result.ok) {
      _selectedIds.clear();
      updateBulkBar();
      showToast('success', '✅', `${ids.length} record(s) deleted.`);
    } else {
      showToast('error', '❌', result.msg);
    }
    $('confirmBulkDeleteBtn').disabled = false;
  });
  $('bulkClearBtn').addEventListener('click', () => { _selectedIds.clear(); updateBulkBar(); renderTable(); });

  // Toolbar
  $('addStudentBtn').addEventListener('click', () => showRegPage(null));
  $('downloadAllImagesBtn').addEventListener('click', () => {
    const students = _filtered.length > 0 ? _filtered : _allStudents;
    BulkDownloader.download(students, 'AllStudentImages');
  });
  $('exportBtn').addEventListener('click', () => ExportService.exportToExcel(_filtered, DriveService.isConnected()));
  $('clearAllBtn').addEventListener('click', () => { $('clearAllConfirmInput').value = ''; openModal('clearAllModal'); });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', handleImport);
  $('refreshBtn').addEventListener('click', () => { populateFilterDropdowns(); showToast('info', '🔄', 'Refreshed.'); });

  dom.clearAllConfirm.addEventListener('input', e => {
    dom.confirmClearAll.disabled = e.target.value !== 'DELETE ALL';
  });
  dom.confirmClearAll.addEventListener('click', async () => {
    closeModal('clearAllModal');
    const result = await StudentService.deleteAll();
    if (result.ok) showToast('success', '✅', 'All records deleted.');
    else showToast('error', '❌', result.msg);
  });

  // Form nav
  $('backToListBtn').addEventListener('click', () => showDashboard());
  $('cancelFormBtn').addEventListener('click', () => showDashboard());
  $('resetFormBtn').addEventListener('click', () => resetForm());
  $('studentForm').addEventListener('submit', handleFormSubmit);

  // Photo / camera
  $('startCamBtn').addEventListener('click', startCamera);
  $('stopCamBtn').addEventListener('click', stopCamera);
  $('captureBtn').addEventListener('click', capturePhoto);
  $('rotateCamBtn').addEventListener('click', rotateCamera);
  $('clearPhotoBtn').addEventListener('click', clearPhoto);
  dom.fileUpload.addEventListener('change', handleFileUpload);
  dom.uploadZone.addEventListener('click', () => dom.fileUpload.click());
  dom.uploadZone.addEventListener('keypress', e => { if (e.key === 'Enter') dom.fileUpload.click(); });
  dom.uploadZone.addEventListener('dragover', e => { e.preventDefault(); dom.uploadZone.style.borderColor = 'var(--indigo)'; });
  dom.uploadZone.addEventListener('dragleave', () => { dom.uploadZone.style.borderColor = ''; });
  dom.uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    dom.uploadZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) processImageFile(file);
  });

  // Drive
  $('driveBtn').addEventListener('click', async () => {
    if (DriveService.isConnected()) { DriveService.disconnect(); updateDriveUI(false); }
    else { const ok = await DriveService.connect(); updateDriveUI(ok); }
  });

  // View modal tabs
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click',   () => switchViewTab(tab.dataset.tab));
    tab.addEventListener('keydown', e => { if (e.key === 'Enter') switchViewTab(tab.dataset.tab); });
  });
  $('viewEditBtn').addEventListener('click',   () => { closeModal('viewModal'); showRegPage(_viewDocId); });
  $('viewDeleteBtn').addEventListener('click', () => { closeModal('viewModal'); openDeleteModal(_viewDocId); });
}

/* ════════════════════════════════════════
   FIRESTORE LISTENERS
════════════════════════════════════════ */
function startStatsListener() {
  StudentService.subscribeStats(stats => {
    animateNumber('statTotal',   stats.total);
    animateNumber('statActive',  stats.active);
    animateNumber('statDeleted', stats.deleted);
    $('statTotalPill').textContent  = `${stats.total} total`;
    $('statActivePill').textContent = `${stats.active} active`;
    $('lastUpdated').textContent    = `Last refreshed: ${new Date().toLocaleTimeString('en-IN')} · ${stats.total} records`;
  });
}

function startStudentsListener() {
  showSkeleton(dom.studentTbody, 20, 8);

  StudentService.subscribeStudents({ orderBy: _sortField, orderDir: _sortDir, limit: 10000 }, (docs) => {
    _allStudents = docs;
    _currentPage = 1;
    renderTable();
    populateFilterDropdowns();
  });
}

/* ════════════════════════════════════════
   TABLE RENDER ENGINE
════════════════════════════════════════ */
function renderTable() {
  updateSortHeaders();

  _filtered = _allStudents.filter(s => {
    if (_filterClass   && s.className !== _filterClass)   return false;
    if (_filterSection && s.section   !== _filterSection) return false;
    if (_filterStatus === 'active'  && s.isActive === false) return false;
    if (_filterStatus === 'deleted' && s.isActive !== false) return false;

    if (_searchQuery) {
      const q = _searchQuery.toLowerCase();
      // Search across many fields including subjects (now can be array or string)
      const subjectsStr = Array.isArray(s.subjects) ? s.subjects.join(' ') : (s.subjects || '');
      return [s.name, s.studentId, s.rollNo, s.fatherName, s.motherName,
              s.contactNo, s.className, s.section, s.stream, subjectsStr,
              s.aadhaarNo, s.bloodGroup, s.session, s.academicYear, s.schoolName]
        .some(v => (v || '').toLowerCase().includes(q));
    }
    return true;
  });

  // Sort
  _filtered.sort((a, b) => {
    let av = a[_sortField] ?? '';
    let bv = b[_sortField] ?? '';
    if (av?.toDate) av = av.toDate().getTime();
    if (bv?.toDate) bv = bv.toDate().getTime();
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return _sortDir === 'asc' ? -1 : 1;
    if (av > bv) return _sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  dom.resultCount.textContent = `${_filtered.length} result${_filtered.length !== 1 ? 's' : ''}`;

  const total = _filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / _perPage));
  if (_currentPage > totalPages) _currentPage = totalPages;

  const start = (_currentPage - 1) * _perPage;
  const end   = Math.min(start + _perPage, total);

  $('pageFrom').textContent  = total ? start + 1 : 0;
  $('pageTo').textContent    = end;
  $('pageTotal').textContent = total;

  renderPageControls(totalPages);
  renderRows(_filtered.slice(start, end));
  updateSelectAllState();
}

function getPageStudents() {
  const start = (_currentPage - 1) * _perPage;
  const end   = Math.min(start + _perPage, _filtered.length);
  return _filtered.slice(start, end);
}

function renderRows(students) {
  if (!students.length) {
    dom.studentTbody.innerHTML = `
      <tr class="empty-state-row">
        <td colspan="20">
          <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">🎓</div>
            <p>No students found</p>
            <span>${_searchQuery || _filterClass || _filterSection ? 'Try adjusting your search or filters.' : 'Add your first student to get started.'}</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  const q = _searchQuery;

  // Build fragment for performance
  const fragment = document.createDocumentFragment();
  const tbody    = document.createElement('tbody');

  students.forEach(s => {
    const isSelected = _selectedIds.has(s._docId);
    const isDeleted  = s.isActive === false;

    // Subjects display — handle both array and comma-string formats
    const subjectsArr    = _parseSubjects(s.subjects);
    const subjectsDisplay = subjectsArr.length
      ? subjectsArr.map(sub => `<span class="badge badge-subject" style="font-size:10px;padding:2px 6px;">${Security.esc(sub)}</span>`).join(' ')
      : '—';

    // const photoCell = s.photoUrl
    //   ? `<img src="${Security.esc(s.photoUrl)}" class="student-photo" alt="${Security.esc(s.name)}" loading="lazy"/>`
    //   : `<div class="photo-ph" aria-hidden="true">🎓</div>`;

    const imageUrl =
    s.photoUrl ||
    s.photo ||
    s.image ||
    "";

const photoCell = imageUrl
    ? `<img src="${Security.esc(imageUrl)}"
          class="student-photo"
          alt="${Security.esc(s.name)}"
          loading="lazy">`
    : `<div class="photo-ph">🎓</div>`;

    const aadhaarDisplay = s.aadhaarNo ? Security.maskAadhaar(s.aadhaarNo) : '—';

    const tr = document.createElement('tr');
    tr.dataset.id = s._docId;
    if (isSelected) tr.classList.add('selected');

    tr.innerHTML = `
      <td class="td-check">
        <input type="checkbox" class="row-check" aria-label="Select ${Security.esc(s.name)}" ${isSelected ? 'checked' : ''}/>
      </td>
      <td class="td-photo">${photoCell}</td>
      <td class="td-name">
        <div class="nm">${hlText(s.name, q)}</div>
        <div class="sid">${hlText(s.studentId, q)}</div>
        ${isDeleted ? '<span class="badge badge-blood" style="margin-top:2px;">Deleted</span>' : ''}
      </td>
      <td>${s.className ? `<span class="badge badge-class">${Security.esc(s.className)}</span>` : '—'}</td>
      <td>${s.section   ? `<span class="badge badge-section">${Security.esc(s.section)}</span>` : '—'}</td>
      <td>${Security.esc(s.rollNo) || '—'}</td>
      <td class="truncate" style="max-width:130px;" title="${Security.esc(s.fatherName)}">${hlText(s.fatherName, q) || '—'}</td>
      <td class="truncate" style="max-width:130px;" title="${Security.esc(s.motherName)}">${hlText(s.motherName, q) || '—'}</td>
      <td class="truncate" style="max-width:120px;" title="${Security.esc(s.guardianName)}">${Security.esc(s.guardianName) || '—'}</td>
      <td>${hlText(s.contactNo, q) || '—'}</td>
      <td style="font-size:11px;letter-spacing:0.5px;">${aadhaarDisplay}</td>
      <td style="font-weight:700;">${hlText(s.studentId, q) || '—'}</td>
      <td>${s.bloodGroup ? `<span class="badge badge-blood">${Security.esc(s.bloodGroup)}</span>` : '—'}</td>
      <td>${s.session ? `<span class="badge badge-session">${Security.esc(s.session)}</span>` : '—'}</td>
      <td>${Security.esc(s.academicYear) || '—'}</td>
      <td class="addr-cell truncate" title="${Security.esc(s.address)}">${Security.esc(s.address) || '—'}</td>
      <td>${s.stream ? `<span class="badge badge-stream">${Security.esc(s.stream)}</span>` : '—'}</td>
      <td class="subj-cell">${subjectsDisplay}</td>
      <td class="no-wrap text-sm text-muted2">${formatDate(s.createdAt)}</td>
      <td>
        <div class="action-cell">
          <button class="act-btn view-btn" data-id="${Security.esc(s._docId)}" title="View profile" aria-label="View ${Security.esc(s.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="act-btn edit edit-btn" data-id="${Security.esc(s._docId)}" title="Edit record" aria-label="Edit ${Security.esc(s.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="act-btn del del-btn" data-id="${Security.esc(s._docId)}" data-name="${Security.esc(s.name)}" title="Delete record" aria-label="Delete ${Security.esc(s.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14H5V6m3 0V4h8v2"/></svg>
          </button>
          <button class="act-btn drive-dl-btn" data-id="${Security.esc(s._docId)}" title="Download photo" aria-label="Download photo for ${Security.esc(s.name)}" style="color:var(--indigo);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </td>`;

    tbody.appendChild(tr);
  });

  // Replace DOM in one operation
  dom.studentTbody.innerHTML = '';
  while (tbody.firstChild) dom.studentTbody.appendChild(tbody.firstChild);

  // Event delegation on tbody
  dom.studentTbody.addEventListener('change', _handleCheckChange, { once: false });

  // Delegate row action buttons
  dom.studentTbody.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', () => openViewModal(btn.dataset.id)));
  dom.studentTbody.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => showRegPage(btn.dataset.id)));
  dom.studentTbody.querySelectorAll('.del-btn').forEach(btn =>
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id)));
  dom.studentTbody.querySelectorAll('.drive-dl-btn').forEach(btn =>
    btn.addEventListener('click', () => handlePhotoDownload(btn.dataset.id)));
}

function _handleCheckChange(e) {
  if (!e.target.matches('.row-check')) return;
  const row = e.target.closest('tr');
  const id  = row?.dataset.id;
  if (!id) return;
  if (e.target.checked) { _selectedIds.add(id); row.classList.add('selected'); }
  else { _selectedIds.delete(id); row.classList.remove('selected'); }
  updateBulkBar();
  updateSelectAllState();
}

/* ── Pagination ─────────────────────────── */
function renderPageControls(totalPages) {
  const pages = buildPageNums(_currentPage, totalPages);
  let html = `
    <button class="page-btn" ${_currentPage <= 1 ? 'disabled' : ''} id="prevPageBtn" aria-label="Previous page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15,18 9,12 15,6"/></svg>
    </button>`;
  pages.forEach(p => {
    if (p === '…') html += `<span class="page-ellipsis">…</span>`;
    else html += `<button class="page-btn ${p === _currentPage ? 'active' : ''}" data-page="${p}" aria-label="Page ${p}" ${p === _currentPage ? 'aria-current="page"' : ''}>${p}</button>`;
  });
  html += `
    <button class="page-btn" ${_currentPage >= totalPages ? 'disabled' : ''} id="nextPageBtn" aria-label="Next page">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,18 15,12 9,6"/></svg>
    </button>`;
  dom.pageControls.innerHTML = html;
  dom.pageControls.querySelectorAll('[data-page]').forEach(btn =>
    btn.addEventListener('click', () => { _currentPage = Number(btn.dataset.page); renderTable(); }));
  dom.pageControls.querySelector('#prevPageBtn')?.addEventListener('click', () => { _currentPage--; renderTable(); });
  dom.pageControls.querySelector('#nextPageBtn')?.addEventListener('click', () => { _currentPage++; renderTable(); });
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === _sortField) th.classList.add(_sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function updateSelectAllState() {
  const pageIds = getPageStudents().map(s => s._docId);
  const allChecked = pageIds.length > 0 && pageIds.every(id => _selectedIds.has(id));
  dom.selectAll.checked       = allChecked;
  dom.selectAll.indeterminate = !allChecked && pageIds.some(id => _selectedIds.has(id));
}

function updateBulkBar() {
  const n = _selectedIds.size;
  dom.bulkBar.classList.toggle('show', n > 0);
  dom.bulkCount.textContent = `${n} selected`;
}

/* ════════════════════════════════════════
   FILTER DROPDOWNS
════════════════════════════════════════ */
async function populateFilterDropdowns() {
  try {
    const [classes, sections] = await Promise.all([
      StudentService.getDistinctValues('className'),
      StudentService.getDistinctValues('section')
    ]);
    _repopulateSelect(dom.filterClass,   'All Classes',  classes);
    _repopulateSelect(dom.filterSection, 'All Sections', sections);
  } catch (e) { console.warn('Filter dropdown error:', e); }
}

function _repopulateSelect(sel, placeholder, values) {
  const current = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (v === current) o.selected = true;
    sel.appendChild(o);
  });
}

/* ════════════════════════════════════════
   REGISTRATION / EDIT PAGE
════════════════════════════════════════ */
function showDashboard() {
  stopCamera();
  dom.pageReg.style.display  = 'none';
  dom.pageMain.style.display = '';
  window.scrollTo(0, 0);
}

async function showRegPage(docId) {
  dom.pageMain.style.display = 'none';
  dom.pageReg.style.display  = '';
  window.scrollTo(0, 0);

  resetForm();
  _editDocId = docId;

  if (docId) {
    // Edit mode
    $('regTitle').innerHTML  = 'Edit <em>Student Record</em>';
    $('regSub').textContent  = 'Update the fields below and save.';
    $('editBanner').style.display = 'flex';
    $('submitBtnLabel').textContent = 'Update Student';

    const s = await StudentService.getStudent(docId);
    if (!s) { showToast('error', '❌', 'Record not found.'); showDashboard(); return; }

    $('editBannerName').textContent = s.name;
    $('editDocId').value     = s._docId;
    $('editPhotoPath').value = s.photoPath || '';

    dom.fName.value             = s.name             || '';
    dom.fStudentId.value        = s.studentId        || '';
    dom.fClass.value            = s.className        || '';
    dom.fSection.value          = s.section          || '';
    dom.fRollNo.value           = s.rollNo           || '';
    dom.fGender.value           = s.gender           || '';
    dom.fDob.value              = s.dob              || '';
    dom.fBloodGroup.value       = s.bloodGroup       || '';
    dom.fFatherName.value       = s.fatherName       || '';
    dom.fMotherName.value       = s.motherName       || '';
    dom.fGuardianName.value     = s.guardianName     || '';
    dom.fGuardianRelation.value = s.guardianRelation || '';
    dom.fContactNo.value        = s.contactNo        || '';
    dom.fAadhaarNo.value        = s.aadhaarNo        || '';
    dom.fAddress.value          = s.address          || '';
    dom.fSession.value          = s.session          || '';
    dom.fAcademicYear.value     = s.academicYear     || '';
    dom.fStream.value           = s.stream           || '';
    dom.fSchoolName.value       = s.schoolName       || '';

    // Subjects — multi-select
    const subjArr = _parseSubjects(s.subjects);
    _subjectPicker.setSelected(subjArr);

    // Photo
    if (s.photoUrl) {
      setPhotoPreview(s.photoUrl, false);
      _photoDataUrl = '';
    }
  } else {
    $('regTitle').innerHTML = 'Add <em>New Student</em>';
    $('regSub').textContent = 'Fill in all required fields.';
    $('editBanner').style.display = 'none';
    $('submitBtnLabel').textContent = 'Save Student';
  }
}

function resetForm() {
  $('studentForm').reset();
  _editDocId    = null;
  _photoDataUrl = '';
  $('editDocId').value    = '';
  $('editPhotoPath').value = '';

  document.querySelectorAll('.field.has-err').forEach(f => f.classList.remove('has-err'));

  if (_subjectPicker) _subjectPicker.clear();

  clearPhoto();
}

/* ── Parse subjects (handles both array and comma-string) ── */
function _parseSubjects(subjects) {
  if (!subjects) return [];
  if (Array.isArray(subjects)) return subjects.filter(Boolean);
  return subjects.split(',').map(x => x.trim()).filter(Boolean);
}

/* ════════════════════════════════════════
   FORM SUBMIT — Optimistic UI + Fast Save
════════════════════════════════════════ */
/**
 * dashboard.js PATCH — Replace handleFormSubmit with instant-redirect version.
 *
 * HOW TO APPLY:
 *   Find the existing handleFormSubmit function in your dashboard.js and
 *   replace it (and the validateForm function below it) with this entire block.
 *
 * KEY CHANGES:
 *   1. Click Save → validates → saves text to Firestore → redirects INSTANTLY
 *   2. Photo upload happens in background (StudentService handles it)
 *   3. Table shows row with placeholder photo immediately (blank → real photo
 *      appears automatically when Firestore listener picks up the bg update)
 *   4. Optimistic local insert: new student appears in table before
 *      Firestore even confirms, giving zero perceived wait time.
 */


/* ════════════════════════════════════════
   FORM SUBMIT — INSTANT REDIRECT
   Photo uploads happen after redirect.
════════════════════════════════════════ */
async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const btn = $('submitBtn');
  const lbl = $('submitBtnLabel');
  btn.disabled    = true;
  lbl.textContent = _editDocId ? 'Saving…' : 'Saving…';

  // Subjects
  const subjectsArr = _subjectPicker ? _subjectPicker.getSelected() : [];
  const subjectsStr = subjectsArr.join(', ');

  // Build record
  const raw = {
    name:             dom.fName.value.trim(),
    studentId:        dom.fStudentId.value.trim(),
    className:        dom.fClass.value.trim(),
    section:          dom.fSection.value.trim(),
    rollNo:           dom.fRollNo.value.trim(),
    gender:           dom.fGender.value,
    dob:              dom.fDob.value,
    bloodGroup:       dom.fBloodGroup.value,
    fatherName:       dom.fFatherName.value.trim(),
    motherName:       dom.fMotherName.value.trim(),
    guardianName:     dom.fGuardianName.value.trim(),
    guardianRelation: dom.fGuardianRelation.value.trim(),
    contactNo:        dom.fContactNo.value.trim(),
    aadhaarNo:        dom.fAadhaarNo.value.trim(),
    address:          dom.fAddress.value.trim(),
    session:          dom.fSession.value.trim(),
    academicYear:     dom.fAcademicYear.value.trim(),
    stream:           dom.fStream.value,
    subjects:         subjectsStr,
    subjectsArray:    subjectsArr,
    schoolName:       dom.fSchoolName.value.trim(),
    // photoUrl intentionally omitted here — StudentService sets it
  };

  const data   = Security.sanitizeRecord(raw);
  const photoDataUrl = _photoDataUrl || null;   // may be '' → null
  const oldPhotoPath = $('editPhotoPath').value || '';

  let result;
  if (_editDocId) {
    result = await StudentService.updateStudent(_editDocId, data, photoDataUrl, oldPhotoPath);
  } else {
    result = await StudentService.addStudent(data, photoDataUrl);
  }

  // ── Whether photo upload is pending or not, redirect NOW ──
  if (result.ok) {
    // Optimistic local insert so table shows the row immediately
    // before the Firestore listener catches up.
    if (!_editDocId && result.id) {
      const optimisticRecord = {
        _docId:    result.id,
        ...data,
        photoUrl:  _photoDataUrl || '',   // show captured photo instantly (dataUrl)
        isActive:  true,
        createdAt: { toDate: () => new Date() },  // fake timestamp for sort
        updatedAt: { toDate: () => new Date() },
      };
      _allStudents.unshift(optimisticRecord);
      renderTable();
    }

    showToast('success', '✅', _editDocId ? 'Record updated.' : 'Student added. Photo uploading…');

    // Redirect immediately — do NOT wait for Drive upload
    showDashboard();

    // Drive upload in background (fire-and-forget)
    if (DriveService.isConnected() && result.id) {
      const studentId = result.id || _editDocId;
      StudentService.getStudent(studentId).then(student => {
        if (student?.photoUrl) {
          DriveService.uploadStudentPhotoOrganized(student)
            .then(() => {
              $('driveStatus').classList.add('show');
              setTimeout(() => $('driveStatus').classList.remove('show'), 4000);
            })
            .catch(err => console.warn('Drive upload failed:', err));
        }
      });
    }

  } else {
    // Only on actual failure do we stay on the form
    btn.disabled    = false;
    lbl.textContent = _editDocId ? 'Update Student' : 'Save Student';
    showToast('error', '❌', result.msg || 'Save failed. Please try again.');
  }
}

/* ════════════════════════════════════════
   VALIDATION (unchanged logic, same place)
════════════════════════════════════════ */
function validateForm() {
  let ok = true;
  const fields = [
    { wrap: 'fw-name',      val: dom.fName.value.trim(),      test: v => v.length > 0 },
    { wrap: 'fw-studentId', val: dom.fStudentId.value.trim(), test: v => v.length > 0 },
    { wrap: 'fw-class',     val: dom.fClass.value.trim(),     test: v => v.length > 0 },
    { wrap: 'fw-contact',   val: dom.fContactNo.value.trim(), test: v => Security.validPhone(v) },
    { wrap: 'fw-aadhaar',   val: dom.fAadhaarNo.value.trim(), test: v => Security.validAadhaar(v) },
  ];
  fields.forEach(({ wrap, val, test }) => {
    const fw = $(wrap);
    if (!fw) return;
    if (!test(val)) { fw.classList.add('has-err'); ok = false; }
    else fw.classList.remove('has-err');
  });
  if (!ok) document.querySelector('.field.has-err')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return ok;
}

/* ════════════════════════════════════════
   DELETE MODAL
════════════════════════════════════════ */
let _deleteTarget = null;

function openDeleteModal(docId) {
  _deleteTarget = docId;
  const s = _allStudents.find(x => x._docId === docId);
  $('deleteStudentName').textContent = s ? `${s.name} — ${s.studentId}` : docId;
  openModal('deleteModal');

  $('softDeleteBtn').onclick = async () => {
    closeModal('deleteModal');
    const r = await StudentService.softDelete(_deleteTarget);
    if (r.ok) showToast('info', '🗄️', 'Student archived.');
    else showToast('error', '❌', r.msg);
    _deleteTarget = null;
  };
  $('hardDeleteBtn').onclick = async () => {
    closeModal('deleteModal');
    const r = await StudentService.hardDelete(_deleteTarget);
    if (r.ok) showToast('success', '✅', 'Student deleted.');
    else showToast('error', '❌', r.msg);
    _deleteTarget = null;
  };
}

/* ════════════════════════════════════════
   VIEW STUDENT MODAL
════════════════════════════════════════ */
async function openViewModal(docId) {
  _viewDocId = docId;
  const s = _allStudents.find(x => x._docId === docId) || await StudentService.getStudent(docId);
  if (!s) { showToast('error', '❌', 'Record not found.'); return; }

  $('viewStudentName').textContent = s.name || '—';
  $('viewStudentSub').textContent  = [s.studentId, s.className, s.section].filter(Boolean).join(' · ');

  if (s.photoUrl) {
    $('viewPhoto').src           = s.photoUrl;
    $('viewPhoto').style.display = 'block';
    $('viewPhIcon').style.display= 'none';
  } else {
    $('viewPhoto').style.display = 'none';
    $('viewPhIcon').style.display= 'flex';
  }

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val || '—'; };
  set('vStudentId',  s.studentId);
  set('vRollNo',     s.rollNo);
  set('vGender',     s.gender);
  set('vDob',        s.dob ? formatDate(s.dob) : null);
  set('vBloodGroup', s.bloodGroup);
  set('vAadhaar',    s.aadhaarNo ? Security.maskAadhaar(s.aadhaarNo) : null);
  set('vFather',     s.fatherName);
  set('vMother',     s.motherName);
  set('vGuardian',   s.guardianName);
  set('vGuardianRel',s.guardianRelation);
  set('vContact',    s.contactNo);
  set('vAddress',    s.address);
  set('vClass',      s.className);
  set('vSection',    s.section);
  set('vSession',    s.session);
  set('vAcadYear',   s.academicYear);
  set('vStream',     s.stream);
  set('vSchool',     s.schoolName);

  // Subjects as tags
  const subjArr = _parseSubjects(s.subjects || s.subjectsArray);
  const subjEl  = $('vSubjects');
  if (subjEl) {
    subjEl.innerHTML = subjArr.length
      ? subjArr.map(sub => `<span class="badge badge-subject">${Security.esc(sub)}</span>`).join(' ')
      : '—';
  }

  set('vCreatedAt', formatDateTime(s.createdAt));
  set('vUpdatedAt', formatDateTime(s.updatedAt));
  $('vStatus').innerHTML = s.isActive === false
    ? '<span class="badge badge-blood">Deleted / Archived</span>'
    : '<span class="badge badge-class">Active</span>';
  $('vDriveSync').innerHTML = DriveService.isConnected()
    ? '<span class="synced-yes">☁️ Drive connected</span>'
    : '<span class="synced-no">Not synced</span>';

  switchViewTab('identity');
  openModal('viewModal');
}

function switchViewTab(name) {
  document.querySelectorAll('.view-tab').forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.view-panel').forEach(p => {
    p.classList.toggle('active', p.id === `viewTab-${name}`);
  });
}

/* ════════════════════════════════════════
   INDIVIDUAL PHOTO DOWNLOAD
   Format: SchoolName_StudentName_RollNo.jpg
════════════════════════════════════════ */
async function handlePhotoDownload(docId) {
  const s = _allStudents.find(x => x._docId === docId);
  if (!s) { showToast('error', '❌', 'Student not found.'); return; }

  const clean = str => (str || '').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
  const schoolPart = clean(s.schoolName || 'School');
  const namePart   = clean(s.name       || 'Student');
  const rollPart   = clean(s.rollNo     || s.studentId || docId);
  const fileName   = `${schoolPart}_${namePart}_${rollPart}.jpg`;

  if (!s.photoUrl) { showToast('warning', '⚠️', 'No photo for this student.'); return; }

  // Always perform the local download first — this button's job.
  try {
    const res  = await fetch(s.photoUrl);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('success', '✅', `Downloaded: ${fileName}`);
  } catch (err) {
    showToast('error', '❌', 'Download failed: ' + err.message);
    return;
  }

  // If Drive is connected, also sync a copy to Drive in the background.
  if (DriveService.isConnected()) {
    DriveService.uploadStudentPhotoOrganized({ ...s, driveFileName: fileName })
      .then(() => showToast('info', '☁️', 'Also synced to Drive.'))
      .catch(err => console.warn('Drive sync failed:', err));
  }
}

/* ════════════════════════════════════════
   CAMERA
════════════════════════════════════════ */
async function startCamera() {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }
    });
    dom.video.srcObject           = _stream;
    dom.video.style.display       = 'block';
    dom.camPlaceholder.style.display = 'none';
    dom.startCamBtn.style.display  = 'none';
    dom.captureBtn.style.display   = 'flex';
    dom.stopCamBtn.style.display   = 'flex';
    dom.rotateCamBtn.style.display = 'flex';
  } catch (err) {
    showToast('warning', '📷', 'Camera access denied or unavailable.');
  }
}

async function rotateCamera() {
  _facingMode = _facingMode === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
}

function stopCamera() {
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  dom.video.srcObject           = null;
  dom.video.style.display       = 'none';
  dom.camPlaceholder.style.display = 'flex';
  dom.startCamBtn.style.display  = 'flex';
  dom.captureBtn.style.display   = 'none';
  dom.stopCamBtn.style.display   = 'none';
  dom.rotateCamBtn.style.display = 'none';
}

async function capturePhoto() {
  const canvas  = document.createElement('canvas');
  canvas.width  = dom.video.videoWidth;
  canvas.height = dom.video.videoHeight;
  canvas.getContext('2d').drawImage(dom.video, 0, 0);
  const raw = canvas.toDataURL('image/jpeg', 0.92);
  const compressed = await compressImage(raw);
  stopCamera();
  setPhotoPreview(compressed, true);
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (file) processImageFile(file);
  dom.fileUpload.value = '';
}

async function processImageFile(file) {
  const check = Security.validImage(file);
  if (!check.ok) { showToast('warning', '⚠️', check.msg); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const compressed = await compressImage(ev.target.result);
    setPhotoPreview(compressed, true);
  };
  reader.readAsDataURL(file);
}

function setPhotoPreview(src, isNew) {
  dom.previewImage.src           = src;
  dom.previewImage.style.display = 'block';
  dom.noPhPlaceholder.style.display = 'none';
  if (isNew) _photoDataUrl = src;
}

function clearPhoto() {
  dom.previewImage.src           = '';
  dom.previewImage.style.display = 'none';
  dom.noPhPlaceholder.style.display = 'flex';
  _photoDataUrl = '';
}

/* ════════════════════════════════════════
   IMPORT
════════════════════════════════════════ */
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  openModal('importModal');
  $('importStatus').textContent   = 'Reading Excel file…';
  $('importProgress').style.width = '20%';
  await tick(50);

  try {
    const records = await ExportService.importFromExcel(file);
    $('importStatus').textContent   = `Parsed ${records.length} records. Uploading…`;
    $('importProgress').style.width = '55%';
    await tick(50);

    const result = await StudentService.importStudents(records);
    $('importProgress').style.width = '100%';
    await tick(300);
    closeModal('importModal');

    if (result.ok) showToast('success', '✅', `Imported ${result.imported} student(s).`);
    else showToast('error', '❌', result.msg);
  } catch (err) {
    closeModal('importModal');
    showToast('error', '❌', 'Import failed: ' + err.message);
  }
  $('importFile').value = '';
}

/* ════════════════════════════════════════
   DRIVE UI
════════════════════════════════════════ */
function updateDriveUI(connected) {
  const btn = $('driveBtn');
  if (connected) {
    btn.classList.add('active');
    btn.innerHTML = `
      <div class="drive-dot" aria-hidden="true"></div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M22 17H12l-5-9h10l5 9z"/><path d="M2 17l5-9"/><path d="M12 17l-5-9"/>
      </svg>
      Drive Connected`;
    $('statDrive').textContent      = '✓';
    $('statDrivePill').textContent  = 'Connected';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M22 17H12l-5-9h10l5 9z"/><path d="M2 17l5-9"/><path d="M12 17l-5-9"/>
      </svg>
      Connect Drive`;
    $('statDrive').textContent     = '—';
    $('statDrivePill').textContent = 'Not linked';
  }
}