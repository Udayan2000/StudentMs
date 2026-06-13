/**
 * BulkImageDownloader — Memory-safe bulk image ZIP download
 * Handles 1000+ images via chunked processing with progress tracking
 */
'use strict';

class BulkImageDownloader {
  constructor() {
    this._cancelled = false;
  }

  /**
   * Download images for a list of students as a ZIP file
   * @param {Array} students — array of student objects with photoUrl, name, schoolName, rollNo, studentId
   * @param {string} [zipName] — optional ZIP file name
   */
  async download(students, zipName = 'StudentImages') {
    if (typeof JSZip === 'undefined') {
      showToast('error', '❌', 'JSZip library not loaded. Cannot create ZIP.');
      return;
    }

    const withPhotos = students.filter(s => s.photoUrl);
    if (!withPhotos.length) {
      showToast('warning', '⚠️', 'No students with photos found.');
      return;
    }

    this._cancelled = false;
    openModal('downloadImagesModal');
    const statusEl  = document.getElementById('downloadImagesStatus');
    const progressEl= document.getElementById('downloadImagesProgress');

    const updateUI = (msg, pct) => {
      if (statusEl)  statusEl.textContent = msg;
      if (progressEl) {
        progressEl.style.width = pct + '%';
        progressEl.setAttribute('aria-valuenow', pct);
      }
    };

    // Cancel button
    const cancelBtn = document.getElementById('cancelDownloadBtn');
    const cancelHandler = () => { this._cancelled = true; };
    cancelBtn.addEventListener('click', cancelHandler, { once: true });

    try {
      updateUI(`Preparing ${withPhotos.length} images…`, 5);
      await tick(50);

      const zip = new JSZip();

      // Group by school then class then section
      const grouped = {};
      withPhotos.forEach(s => {
        const school  = this._sanitizeFolderName(s.schoolName || 'Unknown_School');
        const cls     = this._sanitizeFolderName(s.className  || 'Unknown_Class');
        const section = this._sanitizeFolderName(s.section    || 'Unknown_Section');
        const key = `${school}/${cls}/${section}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s);
      });

      const CHUNK_SIZE = 10; // fetch 10 images at a time
      let done = 0;
      const total = withPhotos.length;

      for (const [folderPath, students_in_folder] of Object.entries(grouped)) {
        for (let i = 0; i < students_in_folder.length; i += CHUNK_SIZE) {
          if (this._cancelled) break;

          const chunk = students_in_folder.slice(i, i + CHUNK_SIZE);
          await Promise.all(chunk.map(async (s) => {
            if (this._cancelled) return;
            try {
              const blob = await this._fetchImageBlob(s.photoUrl);
              if (!blob) return;
              const ext      = this._getExtension(s.photoUrl, blob.type);
              const fileName = this._buildFileName(s) + ext;
              zip.folder(folderPath).file(fileName, blob);
            } catch (err) {
              console.warn(`Skip image for ${s.name}:`, err.message);
            }
            done++;
            const pct = Math.round(5 + (done / total) * 80);
            updateUI(`Downloaded ${done} / ${total} images…`, pct);
          }));

          // yield to browser between chunks
          await tick(10);
        }
        if (this._cancelled) break;
      }

      if (this._cancelled) {
        closeModal('downloadImagesModal');
        showToast('info', 'ℹ️', 'Download cancelled.');
        return;
      }

      updateUI('Creating ZIP file…', 88);
      await tick(50);

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => {
          const pct = Math.round(88 + (meta.percent / 100) * 10);
          updateUI(`Compressing… ${Math.round(meta.percent)}%`, pct);
        }
      );

      updateUI('Saving ZIP…', 99);
      await tick(50);

      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${this._sanitizeFolderName(zipName)}_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      updateUI(`Done! ${done} images downloaded.`, 100);
      await tick(800);
      closeModal('downloadImagesModal');
      showToast('success', '✅', `Downloaded ${done} student images as ZIP.`);

    } catch (err) {
      closeModal('downloadImagesModal');
      showToast('error', '❌', 'Download failed: ' + err.message);
      console.error('BulkImageDownloader error:', err);
    } finally {
      cancelBtn.removeEventListener('click', cancelHandler);
    }
  }

  async _fetchImageBlob(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  }

  _buildFileName(s) {
    const school = this._sanitizeFileName(s.schoolName || 'School');
    const name   = this._sanitizeFileName(s.name       || 'Student');
    const roll   = this._sanitizeFileName(s.rollNo     || s.studentId || '');
    return `${school}_${name}${roll ? '_' + roll : ''}`;
  }

  _sanitizeFolderName(str) {
    return (str || 'Unknown').replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
  }

  _sanitizeFileName(str) {
    return (str || '').replace(/[/\\:*?"<>|.]/g, '').replace(/\s+/g, '_').substring(0, 40);
  }

  _getExtension(url, mimeType) {
    if (mimeType === 'image/png')  return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif')  return '.gif';
    if (url && url.toLowerCase().includes('.png')) return '.png';
    return '.jpg';
  }
}

// Singleton
const BulkDownloader = new BulkImageDownloader();