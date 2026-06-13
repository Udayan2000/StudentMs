/**
 * DriveService v3 — Production-Ready Google Drive Integration
 * StudentMS — Complete file with all enterprise features
 *
 * Features:
 *  - OAuth2 token management with auto-refresh
 *  - Organized folder structure: School / StudentImages / Class / Section
 *  - Folder deduplication via cache + API search
 *  - Retry with exponential backoff (transient errors, quota)
 *  - Progress callbacks for batch uploads
 *  - Batch upload queue with concurrency control
 *  - File existence check (skip re-upload)
 *  - Drive file URL retrieval
 *  - Upload cancellation support
 *  - Detailed error classification
 *  - Firestore write-back of driveFileId and driveFileUrl
 *  - localStorage token persistence (within session)
 *  - Structured logging
 */
'use strict';

const DriveService = (() => {

  /* ─── Constants ────────────────────────────────────────── */
  const SCOPE         = 'https://www.googleapis.com/auth/drive.file';
  const FILES_API     = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD_API    = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER_MIME   = 'application/vnd.google-apps.folder';
  const TOKEN_KEY     = 'sms_drive_token';
  const TOKEN_EXP_KEY = 'sms_drive_token_exp';

  /* ─── Config (override via window.DRIVE_CONFIG) ────────── */
  const CFG = Object.assign({
    clientId:          '',          // set in config.js: window.DRIVE_CONFIG = { clientId: '...' }
    maxRetries:        3,
    retryDelayMs:      1200,
    concurrency:       4,           // parallel uploads
    chunkSizeMB:       5,           // resumable upload chunk size
    skipExistingFiles: true,        // don't re-upload if file already exists in Drive
  }, (typeof window !== 'undefined' && window.DRIVE_CONFIG) || {});

  /* ─── State ─────────────────────────────────────────────── */
  let _token       = null;
  let _tokenExp    = 0;            // epoch ms
  let _connected   = false;
  let _cancelFlag  = false;
  const _folderCache  = {};        // "parentId:name" → folderId
  const _fileCache    = {};        // "folderId:fileName" → fileId
  let _tokenClient    = null;

  /* ─── Logger ─────────────────────────────────────────────── */
  const log = {
    info:  (...a) => console.log('[DriveService]',  ...a),
    warn:  (...a) => console.warn('[DriveService]', ...a),
    error: (...a) => console.error('[DriveService]', ...a),
  };

  /* ════════════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════════════ */

  /** Returns true if token is valid and non-expired */
  function isConnected() {
    return _connected && !!_token && Date.now() < _tokenExp;
  }

  /**
   * Initiate Google OAuth2 flow.
   * Returns a Promise<boolean> that resolves when token arrives.
   */
  async function connect() {
    if (!_ensureGapi()) return false;

    const clientId = CFG.clientId || window.DRIVE_CLIENT_ID || '';
    if (!clientId) {
      log.error('No Drive Client ID configured. Set window.DRIVE_CONFIG.clientId or window.DRIVE_CLIENT_ID.');
      _showToast('error', '❌', 'Google Drive Client ID not configured.');
      return false;
    }

    return new Promise((resolve) => {
      try {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope:     SCOPE,
          callback:  (resp) => {
            if (resp.error) {
              log.error('OAuth error:', resp.error);
              _connected = false;
              resolve(false);
              return;
            }
            _token     = resp.access_token;
            _tokenExp  = Date.now() + ((resp.expires_in || 3600) * 1000) - 60000; // 1 min buffer
            _connected = true;
            _persistToken();
            log.info('Connected. Token valid for', Math.round((resp.expires_in || 3600) / 60), 'min.');
            resolve(true);
          },
          error_callback: (err) => {
            log.error('Token client error:', err);
            _connected = false;
            resolve(false);
          },
        });

        // Try silent first, fall back to consent
        _tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        log.error('connect() threw:', err);
        resolve(false);
      }
    });
  }

  /** Revoke token and clear state */
  function disconnect() {
    if (_token && typeof google !== 'undefined') {
      try { google.accounts.oauth2.revoke(_token, () => log.info('Token revoked.')); }
      catch (_) {}
    }
    _token     = null;
    _tokenExp  = 0;
    _connected = false;
    _clearPersistedToken();
    Object.keys(_folderCache).forEach(k => delete _folderCache[k]);
    Object.keys(_fileCache).forEach(k => delete _fileCache[k]);
    log.info('Disconnected.');
  }

  /**
   * Upload a single student photo with organized folder structure.
   *
   * @param {Object} student - student record (needs: name, schoolName, className, section, rollNo, studentId, photoUrl, _docId)
   * @param {Function} [onProgress] - callback(pct 0-100, message)
   * @returns {Promise<{fileId, fileUrl}>}
   */
  async function uploadStudentPhotoOrganized(student, onProgress) {
    _guardConnected();

    const school  = _sanitize(student.schoolName || 'Unknown_School');
    const cls     = _sanitize(student.className  || 'Unknown_Class');
    const section = _sanitize(student.section    || 'Unknown_Section');

    _progress(onProgress, 5, 'Creating Drive folders…');

    // Build folder tree
    const schoolId  = await _ensureFolder(school,          'root');
    const imagesId  = await _ensureFolder('StudentImages',  schoolId);
    const classId   = await _ensureFolder(cls,              imagesId);
    const sectionId = await _ensureFolder(section,          classId);

    _progress(onProgress, 25, 'Fetching photo…');

    // Resolve blob
    let blob = student._photoBlob || null;
    if (!blob) {
      if (!student.photoUrl) throw new DriveError('NO_PHOTO', 'Student has no photoUrl or _photoBlob.');
      blob = await _fetchBlob(student.photoUrl);
    }

    const fileName = student.driveFileName || _buildFileName(student);

    // Skip re-upload if file exists and config says so
    if (CFG.skipExistingFiles) {
      const existingId = await _findFile(fileName, sectionId);
      if (existingId) {
        log.info(`Skip (exists): ${fileName} → ${existingId}`);
        _progress(onProgress, 100, 'Already on Drive.');
        return { fileId: existingId, fileUrl: _buildViewUrl(existingId) };
      }
    }

    _progress(onProgress, 40, `Uploading ${fileName}…`);

    const fileId = await _uploadMultipart(blob, fileName, sectionId);
    const fileUrl = _buildViewUrl(fileId);

    _progress(onProgress, 90, 'Saving to database…');
    await _writeBackToFirestore(student._docId, { driveFileId: fileId, driveFileUrl: fileUrl });

    _progress(onProgress, 100, 'Done!');
    log.info(`Uploaded: ${school}/StudentImages/${cls}/${section}/${fileName} → ${fileId}`);
    return { fileId, fileUrl };
  }

  /**
   * Upload a single student photo (legacy compat alias).
   */
  async function uploadStudentPhoto(student, onProgress) {
    return uploadStudentPhotoOrganized(student, onProgress);
  }

  /**
   * Batch upload photos for multiple students.
   *
   * @param {Array} students
   * @param {Function} [onProgress] - callback(pct 0-100, doneCount, total, currentName)
   * @param {Function} [onError] - callback(student, error) — called per failure (upload continues)
   * @returns {Promise<{uploaded, skipped, failed, results}>}
   */
  async function batchUpload(students, onProgress, onError) {
    _guardConnected();
    _cancelFlag = false;

    const withPhotos = students.filter(s => s.photoUrl || s._photoBlob);
    const total      = withPhotos.length;
    if (!total) return { uploaded: 0, skipped: 0, failed: 0, results: [] };

    let done = 0, uploaded = 0, failed = 0, skipped = 0;
    const results = [];

    // Process in concurrency-limited batches
    const queue = [...withPhotos];
    const workers = Array.from({ length: Math.min(CFG.concurrency, total) }, async () => {
      while (queue.length > 0) {
        if (_cancelFlag) break;
        const student = queue.shift();
        try {
          const result = await _retryOp(() => uploadStudentPhotoOrganized(student));
          results.push({ student, ...result, ok: true });
          uploaded++;
        } catch (err) {
          results.push({ student, ok: false, error: err.message });
          failed++;
          if (typeof onError === 'function') onError(student, err);
          log.warn(`Batch: failed for ${student.name}:`, err.message);
        }
        done++;
        const pct = Math.round((done / total) * 100);
        if (typeof onProgress === 'function') {
          onProgress(pct, done, total, student.name || '');
        }
      }
    });

    await Promise.all(workers);
    log.info(`Batch complete: ${uploaded} uploaded, ${failed} failed, ${skipped} skipped.`);
    return { uploaded, skipped, failed, results };
  }

  /** Cancel an in-progress batchUpload */
  function cancelBatch() {
    _cancelFlag = true;
    log.info('Batch upload cancellation requested.');
  }

  /**
   * List files in a Drive folder path (School / StudentImages / Class / Section).
   * @returns {Promise<Array<{id, name, mimeType, size, webViewLink}>>}
   */
  async function listStudentPhotos(schoolName, className, section) {
    _guardConnected();
    const school  = _sanitize(schoolName || '');
    const cls     = _sanitize(className  || '');
    const sec     = _sanitize(section    || '');

    const schoolId  = await _findFolder(school,         'root');  if (!schoolId)  return [];
    const imagesId  = await _findFolder('StudentImages', schoolId); if (!imagesId) return [];
    const classId   = await _findFolder(cls,             imagesId); if (!classId)  return [];
    const sectionId = await _findFolder(sec,             classId);  if (!sectionId) return [];

    return _listFiles(sectionId);
  }

  /**
   * Delete a Drive file by ID.
   */
  async function deleteFile(fileId) {
    _guardConnected();
    await _driveReq(`${FILES_API}/${fileId}`, 'DELETE', null, true);
    log.info('Deleted file:', fileId);
  }

  /**
   * Try to restore token from sessionStorage (avoids re-auth on page reload within session).
   */
  function tryRestoreToken() {
    try {
      const t   = sessionStorage.getItem(TOKEN_KEY);
      const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
      if (t && Date.now() < exp) {
        _token     = t;
        _tokenExp  = exp;
        _connected = true;
        log.info('Token restored from session. Expires in', Math.round((exp - Date.now()) / 60000), 'min.');
        return true;
      }
    } catch (_) {}
    return false;
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL — Folder Management
  ════════════════════════════════════════════════════════ */

  /** Find or create a folder. Uses cache to avoid duplicate calls. */
  async function _ensureFolder(name, parentId) {
    const key = `${parentId}:${name}`;
    if (_folderCache[key]) return _folderCache[key];

    // Search first
    let id = await _findFolder(name, parentId);
    if (!id) {
      id = await _createFolder(name, parentId);
    }
    _folderCache[key] = id;
    return id;
  }

  /** Search for a folder by name under parentId. Returns id or null. */
  async function _findFolder(name, parentId) {
    const key = `${parentId}:${name}`;
    if (_folderCache[key]) return _folderCache[key];

    const q = `name='${_escapeQ(name)}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const data = await _retryOp(() =>
      _driveReq(`${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`, 'GET')
    );
    if (data.files && data.files.length > 0) {
      const id = data.files[0].id;
      _folderCache[key] = id;
      return id;
    }
    return null;
  }

  /** Create a folder. Returns its id. */
  async function _createFolder(name, parentId) {
    const data = await _retryOp(() =>
      _driveReq(FILES_API, 'POST', { name, mimeType: FOLDER_MIME, parents: [parentId] })
    );
    log.info(`Created folder: "${name}" in ${parentId} → ${data.id}`);
    return data.id;
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL — File Operations
  ════════════════════════════════════════════════════════ */

  /** Check if a file with fileName already exists in folderId. Returns fileId or null. */
  async function _findFile(fileName, folderId) {
    const key = `${folderId}:${fileName}`;
    if (_fileCache[key]) return _fileCache[key];

    const q = `name='${_escapeQ(fileName)}' and '${folderId}' in parents and trashed=false`;
    const data = await _retryOp(() =>
      _driveReq(`${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`, 'GET')
    );
    if (data.files && data.files.length > 0) {
      const id = data.files[0].id;
      _fileCache[key] = id;
      return id;
    }
    return null;
  }

  /** Multipart upload (suitable for files ≤ ~5 MB) */
  async function _uploadMultipart(blob, fileName, folderId) {
    const metadata = { name: fileName, parents: [folderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const res = await _fetchWithRetry(
      `${UPLOAD_API}?uploadType=multipart&fields=id`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${_token}` },
        body:    form,
      }
    );
    const data = await res.json();
    _fileCache[`${folderId}:${fileName}`] = data.id;
    return data.id;
  }

  /** List files in a folder */
  async function _listFiles(folderId) {
    const q = `'${folderId}' in parents and trashed=false`;
    const fields = 'files(id,name,mimeType,size,webViewLink,thumbnailLink)';
    const data = await _driveReq(
      `${FILES_API}?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000`,
      'GET'
    );
    return data.files || [];
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL — HTTP Helpers
  ════════════════════════════════════════════════════════ */

  async function _driveReq(url, method = 'GET', body = null, expectEmpty = false) {
    const opts = {
      method,
      headers: {
        Authorization:  `Bearer ${_token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    // 401 → try token refresh once
    if (res.status === 401) {
      const refreshed = await _refreshToken();
      if (refreshed) {
        opts.headers.Authorization = `Bearer ${_token}`;
        const res2 = await fetch(url, opts);
        if (!res2.ok) await _throwDriveError(res2);
        if (expectEmpty || res2.status === 204) return null;
        return res2.json();
      }
      throw new DriveError('UNAUTHORIZED', 'Drive token expired. Please reconnect.');
    }

    if (!res.ok) await _throwDriveError(res);
    if (expectEmpty || res.status === 204) return null;
    return res.json();
  }

  async function _fetchWithRetry(url, opts, retries = CFG.maxRetries) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, opts);

        if (res.status === 429 || res.status === 503) {
          // Quota / rate-limit: exponential backoff
          const delay = CFG.retryDelayMs * Math.pow(2, attempt);
          log.warn(`Rate-limited (${res.status}). Retry ${attempt + 1}/${retries} in ${delay}ms`);
          await _sleep(delay);
          continue;
        }

        if (!res.ok) await _throwDriveError(res);
        return res;
      } catch (err) {
        if (err instanceof DriveError) throw err; // don't retry our own errors
        if (attempt === retries) throw err;
        const delay = CFG.retryDelayMs * Math.pow(2, attempt);
        log.warn(`Network error, retry ${attempt + 1}/${retries} in ${delay}ms:`, err.message);
        await _sleep(delay);
      }
    }
    throw new DriveError('MAX_RETRIES', 'Upload failed after maximum retries.');
  }

  async function _retryOp(fn, retries = CFG.maxRetries) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof DriveError && ['UNAUTHORIZED','NO_PHOTO'].includes(err.code)) throw err;
        if (attempt === retries) throw err;
        const delay = CFG.retryDelayMs * Math.pow(2, attempt);
        log.warn(`Op retry ${attempt + 1}/${retries} in ${delay}ms:`, err.message);
        await _sleep(delay);
      }
    }
  }

  async function _throwDriveError(res) {
    let msg = `Drive API error ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error?.message || msg;
    } catch (_) {}
    throw new DriveError('API_ERROR', msg, res.status);
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL — Token / Auth
  ════════════════════════════════════════════════════════ */

  async function _refreshToken() {
    if (!_tokenClient) return false;
    return new Promise(resolve => {
      try {
        _tokenClient.callback = (resp) => {
          if (resp.error) { resolve(false); return; }
          _token     = resp.access_token;
          _tokenExp  = Date.now() + ((resp.expires_in || 3600) * 1000) - 60000;
          _persistToken();
          log.info('Token refreshed.');
          resolve(true);
        };
        _tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        log.error('Token refresh error:', err);
        resolve(false);
      }
    });
  }

  function _persistToken() {
    try {
      sessionStorage.setItem(TOKEN_KEY,     _token);
      sessionStorage.setItem(TOKEN_EXP_KEY, String(_tokenExp));
    } catch (_) {}
  }

  function _clearPersistedToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXP_KEY);
    } catch (_) {}
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL — Utilities
  ════════════════════════════════════════════════════════ */

  function _ensureGapi() {
    if (typeof google === 'undefined' || typeof google.accounts === 'undefined') {
      log.error('Google Identity Services not loaded. Add <script src="https://accounts.google.com/gsi/client"> to HTML.');
      return false;
    }
    return true;
  }

  function _guardConnected() {
    if (!isConnected()) throw new DriveError('NOT_CONNECTED', 'Drive is not connected. Call DriveService.connect() first.');
  }

  async function _fetchBlob(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new DriveError('FETCH_ERROR', `Failed to fetch photo: HTTP ${res.status}`);
    return res.blob();
  }

  function _buildFileName(s) {
    const school = _sanitize(s.schoolName  || 'School');
    const name   = _sanitize(s.name        || 'Student');
    const roll   = _sanitize(s.rollNo      || s.studentId || '');
    return `${school}_${name}${roll ? '_' + roll : ''}.jpg`;
  }

  function _buildViewUrl(fileId) {
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  function _sanitize(str) {
    return (str || 'Unknown')
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 40) || 'Unknown';
  }

  function _escapeQ(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function _progress(cb, pct, msg) {
    if (typeof cb === 'function') cb(pct, msg);
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function _writeBackToFirestore(docId, fields) {
    if (!docId) return;
    try {
      if (typeof StudentService !== 'undefined' && StudentService.updateStudent) {
        await StudentService.updateStudent(docId, fields, null, null);
      }
    } catch (err) {
      log.warn('Firestore write-back failed:', err.message);
    }
  }

  /* ════════════════════════════════════════════════════════
     DriveError — Typed errors
  ════════════════════════════════════════════════════════ */
  class DriveError extends Error {
    constructor(code, message, status) {
      super(message);
      this.name   = 'DriveError';
      this.code   = code;   // 'NOT_CONNECTED' | 'UNAUTHORIZED' | 'API_ERROR' | 'NO_PHOTO' | 'FETCH_ERROR' | 'MAX_RETRIES'
      this.status = status || null;
    }
  }

  /* ════════════════════════════════════════════════════════
     Toast helper (only if available)
  ════════════════════════════════════════════════════════ */
  function _showToast(type, icon, msg) {
    if (typeof showToast === 'function') showToast(type, icon, msg);
    else log.info(`[${type.toUpperCase()}] ${msg}`);
  }

  /* ─── Public surface ──────────────────────────────────── */
  return {
    // Core
    isConnected,
    connect,
    disconnect,
    tryRestoreToken,

    // Upload
    uploadStudentPhoto,
    uploadStudentPhotoOrganized,

    // Batch
    batchUpload,
    cancelBatch,

    // Query
    listStudentPhotos,
    deleteFile,

    // Expose DriveError for instanceof checks
    DriveError,
  };

})();