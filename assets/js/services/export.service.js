/**
 * export.service.js — StudentMS v3 Export & Import Service
 *
 * Supports:
 *  - Excel (.xlsx) export — full formatting, headers, column widths
 *  - CSV export
 *  - Excel (.xlsx) import — maps column headers to student fields
 *  - PDF export (via print-friendly HTML)
 *  - Filtered/selected export
 *  - Progress modal integration
 */
'use strict';

const ExportService = (() => {

  /* ── Column definitions ──────────────────────────────── */
  const COLUMNS = [
    { key: 'name',             label: 'Full Name',         width: 25 },
    { key: 'studentId',        label: 'Student ID',        width: 16 },
    { key: 'className',        label: 'Class',             width: 12 },
    { key: 'section',          label: 'Section',           width: 10 },
    { key: 'rollNo',           label: 'Roll Number',       width: 12 },
    { key: 'gender',           label: 'Gender',            width: 10 },
    { key: 'dob',              label: 'Date of Birth',     width: 14 },
    { key: 'bloodGroup',       label: 'Blood Group',       width: 12 },
    { key: 'fatherName',       label: "Father's Name",     width: 25 },
    { key: 'motherName',       label: "Mother's Name",     width: 25 },
    { key: 'guardianName',     label: 'Guardian Name',     width: 22 },
    { key: 'guardianRelation', label: 'Guardian Relation', width: 18 },
    { key: 'contactNo',        label: 'Contact Number',    width: 16 },
    { key: 'aadhaarNo',        label: 'Aadhaar Number',    width: 16 },
    { key: 'address',          label: 'Address',           width: 40 },
    { key: 'session',          label: 'Session',           width: 12 },
    { key: 'academicYear',     label: 'Academic Year',     width: 14 },
    { key: 'stream',           label: 'Stream',            width: 16 },
    { key: 'subjects',         label: 'Subjects',          width: 40 },
    { key: 'schoolName',       label: 'School Name',       width: 30 },
    { key: 'isActive',         label: 'Status',            width: 10 },
    { key: 'createdAt',        label: 'Created At',        width: 20 },
    { key: 'updatedAt',        label: 'Last Updated',      width: 20 },
  ];

  /* ── Import column aliases ───────────────────────────── */
  const IMPORT_ALIASES = {
    'full name':         'name',
    'student name':      'name',
    'name':              'name',
    'student id':        'studentId',
    'registration no':   'studentId',
    'roll no':           'rollNo',
    'roll number':       'rollNo',
    'class':             'className',
    'section':           'section',
    'gender':            'gender',
    'dob':               'dob',
    'date of birth':     'dob',
    "father's name":     'fatherName',
    'father name':       'fatherName',
    "mother's name":     'motherName',
    'mother name':       'motherName',
    'guardian name':     'guardianName',
    'guardian relation': 'guardianRelation',
    'contact number':    'contactNo',
    'contact no':        'contactNo',
    'mobile':            'contactNo',
    'phone':             'contactNo',
    'aadhaar number':    'aadhaarNo',
    'aadhaar':           'aadhaarNo',
    'address':           'address',
    'blood group':       'bloodGroup',
    'blood':             'bloodGroup',
    'session':           'session',
    'academic year':     'academicYear',
    'stream':            'stream',
    'subjects':          'subjects',
    'school name':       'schoolName',
    'school':            'schoolName',
  };

  /* ════════════════════════════════════════════════════════
     EXCEL EXPORT (.xlsx)
  ════════════════════════════════════════════════════════ */

  /**
   * Export students array to .xlsx file.
   * @param {Array} students
   * @param {boolean} [driveConnected]
   */
  async function exportToExcel(students, driveConnected = false) {
    if (!students || !students.length) {
      if (typeof showToast === 'function') showToast('warning', '⚠️', 'No records to export.');
      return;
    }

    const modalId = 'exportModal';
    _openExportModal('Exporting to Excel…', 0);

    try {
      // Load SheetJS dynamically if not available
      const XLSX = await _loadSheetJs();
      _updateExportModal('Building rows…', 30);
      await _tick(50);

      const rows = students.map(s => {
        const row = {};
        COLUMNS.forEach(col => {
          let val = s[col.key];
          if (val === null || val === undefined) { row[col.label] = ''; return; }
          if (col.key === 'isActive') { row[col.label] = val === false ? 'Deleted' : 'Active'; return; }
          if (col.key === 'createdAt' || col.key === 'updatedAt') {
            row[col.label] = _formatDate(val);
            return;
          }
          // Subjects — may be array or comma-string
          if (col.key === 'subjects' && Array.isArray(s.subjectsArray)) {
            row[col.label] = s.subjectsArray.join(', ');
            return;
          }
          row[col.label] = String(val);
        });
        return row;
      });

      _updateExportModal('Creating worksheet…', 60);
      await _tick(50);

      const ws = XLSX.utils.json_to_sheet(rows);

      // Column widths
      ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }));

      // Header row style (bold) — basic SheetJS support
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c: C });
        if (!ws[addr]) continue;
        ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: '4F46E5' } } };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Students');

      _updateExportModal('Writing file…', 85);
      await _tick(50);

      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `StudentMS_Export_${dateStr}.xlsx`);

      _updateExportModal('Done!', 100);
      await _tick(500);
      _closeExportModal();
      if (typeof showToast === 'function') showToast('success', '✅', `Exported ${students.length} records to Excel.`);

    } catch (err) {
      _closeExportModal();
      if (typeof showToast === 'function') showToast('error', '❌', 'Export failed: ' + err.message);
      console.error('[ExportService] exportToExcel error:', err);
    }
  }

  /* ════════════════════════════════════════════════════════
     CSV EXPORT
  ════════════════════════════════════════════════════════ */

  /**
   * Export students array to .csv file.
   * @param {Array} students
   */
  function exportToCsv(students) {
    if (!students || !students.length) {
      if (typeof showToast === 'function') showToast('warning', '⚠️', 'No records to export.');
      return;
    }

    const headers = COLUMNS.map(c => _csvEscape(c.label));
    const rows = students.map(s =>
      COLUMNS.map(col => {
        let val = s[col.key];
        if (val === null || val === undefined) return '';
        if (col.key === 'isActive') return val === false ? 'Deleted' : 'Active';
        if (col.key === 'createdAt' || col.key === 'updatedAt') return _formatDate(val);
        if (col.key === 'subjects' && Array.isArray(s.subjectsArray)) return _csvEscape(s.subjectsArray.join(', '));
        return _csvEscape(String(val));
      }).join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel compat
    _downloadBlob(blob, `StudentMS_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    if (typeof showToast === 'function') showToast('success', '✅', `Exported ${students.length} records to CSV.`);
  }

  /* ════════════════════════════════════════════════════════
     PDF EXPORT (print-friendly HTML)
  ════════════════════════════════════════════════════════ */

  /**
   * Export students to a print-ready HTML page (opens in new tab).
   * @param {Array} students
   * @param {string} [title]
   */
  function exportToPdf(students, title = 'Student Records') {
    if (!students || !students.length) {
      if (typeof showToast === 'function') showToast('warning', '⚠️', 'No records to export.');
      return;
    }

    const cols = COLUMNS.filter(c => !['updatedAt'].includes(c.key));
    const headerRow = cols.map(c => `<th>${_esc(c.label)}</th>`).join('');

    const bodyRows = students.map((s, i) => {
      const cells = cols.map(col => {
        let val = s[col.key];
        if (col.key === 'isActive') return `<td>${val === false ? '❌ Deleted' : '✅ Active'}</td>`;
        if (col.key === 'createdAt' || col.key === 'updatedAt') return `<td>${_formatDate(val)}</td>`;
        if (col.key === 'subjects' && Array.isArray(s.subjectsArray)) return `<td>${_esc(s.subjectsArray.join(', '))}</td>`;
        return `<td>${_esc(val !== null && val !== undefined ? String(val) : '')}</td>`;
      }).join('');
      return `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cells}</tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${_esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #111; padding: 16px; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #4f46e5; color: #fff; padding: 5px 4px; text-align: left; font-size: 9px; }
  td { padding: 4px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr.even td { background: #f9fafb; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${_esc(title)}</h1>
<div class="meta">Generated: ${new Date().toLocaleString('en-IN')} · Total: ${students.length} records</div>
<table>
  <thead><tr>${headerRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else if (typeof showToast === 'function') showToast('warning', '⚠️', 'Pop-up blocked. Please allow pop-ups for PDF export.');
  }

  /* ════════════════════════════════════════════════════════
     EXCEL IMPORT (.xlsx / .xls)
  ════════════════════════════════════════════════════════ */

  /**
   * Parse an Excel file into an array of student record objects.
   * @param {File} file
   * @returns {Promise<Array>}
   */
  async function importFromExcel(file) {
    const XLSX = await _loadSheetJs();
    const data = await _readFileAsArrayBuffer(file);
    const wb   = XLSX.read(data, { type: 'array', cellDates: true });

    // Use first sheet
    const wsName = wb.SheetNames[0];
    if (!wsName) throw new Error('Excel file has no sheets.');
    const ws = wb.Sheets[wsName];

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) throw new Error('Excel file has no data rows.');

    return rows.map(row => _mapImportRow(row)).filter(r => r.name || r.studentId);
  }

  function _mapImportRow(row) {
    const student = {};
    Object.entries(row).forEach(([rawKey, value]) => {
      const key    = rawKey.trim().toLowerCase();
      const mapped = IMPORT_ALIASES[key];
      if (mapped && value !== undefined && value !== null && String(value).trim()) {
        student[mapped] = String(value).trim();
      }
    });
    return student;
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL HELPERS
  ════════════════════════════════════════════════════════ */

  function _loadSheetJs() {
    if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload  = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('Failed to load SheetJS (xlsx) library.'));
      document.head.appendChild(s);
    });
  }

  function _readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function _downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a);
    a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function _csvEscape(str) {
    const s = String(str || '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function _formatDate(val) {
    if (!val) return '';
    try {
      const d = val?.toDate ? val.toDate() : new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleString('en-IN');
    } catch (_) { return String(val); }
  }

  function _esc(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  function _openExportModal(title, pct) {
    const el = document.getElementById('exportModal');
    if (el) el.classList.add('open');
    _updateExportModal(title, pct);
  }

  function _updateExportModal(msg, pct) {
    const status   = document.getElementById('exportStatus');
    const progress = document.getElementById('exportProgress');
    if (status)   status.textContent = msg;
    if (progress) { progress.style.width = pct + '%'; progress.setAttribute('aria-valuenow', pct); }
  }

  function _closeExportModal() {
    const el = document.getElementById('exportModal');
    if (el) setTimeout(() => el.classList.remove('open'), 400);
  }

  function _tick(ms = 0) { return new Promise(r => setTimeout(r, ms)); }

  /* ── Public API ────────────────────────────────────────── */
  return {
    exportToExcel,
    exportToCsv,
    exportToPdf,
    importFromExcel,
    COLUMNS,
  };

})();