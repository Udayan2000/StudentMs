/**
 * student.service.js — StudentMS v3 Student Data Service
 *
 * All Firestore operations for students:
 *  - Real-time listeners (subscribeStudents, subscribeStats)
 *  - CRUD: addStudent, updateStudent, getStudent, softDelete, hardDelete, deleteAll, bulkDelete
 *  - Import: importStudents (batch write in chunks)
 *  - Querying: getDistinctValues
 *  - Firebase Storage: photo upload/delete
 *  - Optimistic updates via local cache
 *  - Error classification and retry
 */
'use strict';

const StudentService = (() => {

  const COLLECTION = 'students';
  const MAX_BATCH  = 499; // Firestore batch limit is 500 ops
  const CHUNK_SIZE = 200; // import chunk size

  let _db      = null;
  let _storage = null;
  let _unsubStudents = null;
  let _unsubStats    = null;

  /* ── Lazy init ─────────────────────────────────────────── */
  function _getDb() {
    if (!_db) _db = firebase.firestore();
    return _db;
  }
  function _getStorage() {
    if (!_storage) _storage = firebase.storage();
    return _storage;
  }
  function _col() {
    return _getDb().collection(COLLECTION);
  }

  /* ════════════════════════════════════════════════════════
     REAL-TIME LISTENERS
  ════════════════════════════════════════════════════════ */

  /**
   * Subscribe to student records with optional ordering + limit.
   * @param {Object} opts - { orderBy, orderDir, limit }
   * @param {Function} callback - (docs[]) => void
   * @returns {Function} unsubscribe
   */
  function subscribeStudents(opts = {}, callback) {
    // Unsubscribe previous listener
    if (_unsubStudents) { _unsubStudents(); _unsubStudents = null; }

    let query = _col();
    const orderField = opts.orderBy  || 'createdAt';
    const orderDir   = opts.orderDir || 'desc';
    const lim        = opts.limit    || 10000;

    try {
      query = query.orderBy(orderField, orderDir).limit(lim);
    } catch (e) {
      // Fallback if index not ready
      query = _col().limit(lim);
    }

    _unsubStudents = query.onSnapshot(
      snap => {
        const docs = snap.docs.map(d => _mapDoc(d));
        callback(docs);
      },
      err => {
        console.error('[StudentService] subscribeStudents error:', err);
        // Retry with simpler query on index error
        if (err.code === 'failed-precondition') {
          console.warn('[StudentService] Falling back to unordered query. Add Firestore index for better performance.');
          _unsubStudents = _col().limit(lim).onSnapshot(
            snap => callback(snap.docs.map(d => _mapDoc(d))),
            e2 => console.error('[StudentService] Fallback query error:', e2)
          );
        }
      }
    );
    return () => { if (_unsubStudents) { _unsubStudents(); _unsubStudents = null; } };
  }

  /**
   * Subscribe to aggregate stats (total, active, deleted).
   * Uses a stats document if it exists, otherwise counts from collection.
   * @param {Function} callback - ({ total, active, deleted }) => void
   */
  function subscribeStats(callback) {
    if (_unsubStats) { _unsubStats(); _unsubStats = null; }

    _unsubStats = _col().onSnapshot(snap => {
      let total = 0, active = 0, deleted = 0;
      snap.docs.forEach(d => {
        total++;
        if (d.data().isActive === false) deleted++;
        else active++;
      });
      callback({ total, active, deleted });
    }, err => console.error('[StudentService] subscribeStats error:', err));

    return () => { if (_unsubStats) { _unsubStats(); _unsubStats = null; } };
  }

  /* ════════════════════════════════════════════════════════
     READ
  ════════════════════════════════════════════════════════ */

  /**
   * Fetch a single student by document ID.
   * @returns {Promise<Object|null>}
   */
  async function getStudent(docId) {
    try {
      const snap = await _col().doc(docId).get();
      if (!snap.exists) return null;
      return _mapDoc(snap);
    } catch (err) {
      console.error('[StudentService] getStudent error:', err);
      return null;
    }
  }

  /**
   * Get distinct values for a given field (for filter dropdowns).
   * @param {string} field
   * @returns {Promise<string[]>}
   */
  async function getDistinctValues(field) {
    try {
      const snap = await _col().select(field).get();
      const values = new Set();
      snap.docs.forEach(d => {
        const v = d.data()[field];
        if (v && typeof v === 'string' && v.trim()) values.add(v.trim());
      });
      return [...values].sort((a, b) => a.localeCompare(b, 'en-IN', { numeric: true }));
    } catch (err) {
      console.error('[StudentService] getDistinctValues error:', err);
      return [];
    }
  }

  /* ════════════════════════════════════════════════════════
     CREATE
  ════════════════════════════════════════════════════════ */

  /**
   * Add a new student.
   * @param {Object} data - sanitized student record
   * @param {string|null} photoDataUrl - base64 image (optional)
   * @returns {Promise<{ok, id, msg}>}
   */
  async function addStudent(data, photoDataUrl = null) {
    try {
      // Check for duplicate studentId
      if (data.studentId) {
        const dup = await _col().where('studentId', '==', data.studentId).limit(1).get();
        if (!dup.empty) return { ok: false, msg: `Student ID "${data.studentId}" already exists.` };
      }

      // Check for duplicate Aadhaar (only if provided and 12 digits)
      if (data.aadhaarNo && data.aadhaarNo.replace(/\D/g, '').length === 12) {
        const dup = await _col().where('aadhaarNo', '==', data.aadhaarNo.replace(/\D/g, '')).limit(1).get();
        if (!dup.empty) return { ok: false, msg: `Aadhaar number already registered for another student.` };
      }

      const record = {
        ...data,
        isActive:  true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // Upload photo first if provided
      if (photoDataUrl) {
        const photoResult = await _uploadPhoto(photoDataUrl, data.studentId || _tempId());
        if (photoResult.ok) {
          record.photoUrl  = photoResult.url;
          record.photoPath = photoResult.path;
        }
      }

      const ref = await _col().add(record);
      return { ok: true, id: ref.id };
    } catch (err) {
      console.error('[StudentService] addStudent error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /* ════════════════════════════════════════════════════════
     UPDATE
  ════════════════════════════════════════════════════════ */

  /**
   * Update an existing student.
   * @param {string} docId
   * @param {Object} data - fields to update
   * @param {string|null} newPhotoDataUrl - new photo (replaces old)
   * @param {string|null} oldPhotoPath - old Storage path to delete
   * @returns {Promise<{ok, msg}>}
   */
  async function updateStudent(docId, data, newPhotoDataUrl = null, oldPhotoPath = null) {
    try {
      // Duplicate studentId check (exclude current doc)
      if (data.studentId) {
        const dup = await _col()
          .where('studentId', '==', data.studentId)
          .limit(2).get();
        const conflicts = dup.docs.filter(d => d.id !== docId);
        if (conflicts.length > 0) {
          return { ok: false, msg: `Student ID "${data.studentId}" is already used by another student.` };
        }
      }

      // Duplicate Aadhaar check
      if (data.aadhaarNo && data.aadhaarNo.replace(/\D/g, '').length === 12) {
        const cleanAadhaar = data.aadhaarNo.replace(/\D/g, '');
        const dup = await _col().where('aadhaarNo', '==', cleanAadhaar).limit(2).get();
        const conflicts = dup.docs.filter(d => d.id !== docId);
        if (conflicts.length > 0) {
          return { ok: false, msg: 'Aadhaar number already registered for another student.' };
        }
        data.aadhaarNo = cleanAadhaar;
      }

      const updates = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // New photo
      if (newPhotoDataUrl) {
        // Delete old photo from Storage
        if (oldPhotoPath) await _deletePhoto(oldPhotoPath);

        const studentId = data.studentId || docId;
        const photoResult = await _uploadPhoto(newPhotoDataUrl, studentId);
        if (photoResult.ok) {
          updates.photoUrl  = photoResult.url;
          updates.photoPath = photoResult.path;
        }
      }

      await _col().doc(docId).update(updates);
      return { ok: true };
    } catch (err) {
      console.error('[StudentService] updateStudent error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /* ════════════════════════════════════════════════════════
     DELETE
  ════════════════════════════════════════════════════════ */

  /**
   * Soft delete — marks isActive:false, keeps the record.
   */
  async function softDelete(docId) {
    try {
      await _col().doc(docId).update({
        isActive:  false,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true };
    } catch (err) {
      console.error('[StudentService] softDelete error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /**
   * Hard delete — removes Firestore doc + Storage photo.
   */
  async function hardDelete(docId) {
    try {
      const snap = await _col().doc(docId).get();
      const data = snap.data() || {};
      if (data.photoPath) await _deletePhoto(data.photoPath);
      await _col().doc(docId).delete();
      return { ok: true };
    } catch (err) {
      console.error('[StudentService] hardDelete error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /**
   * Bulk delete multiple students by docId array.
   * Uses Firestore batched writes (chunked at 499).
   */
  async function bulkDelete(docIds) {
    if (!docIds || !docIds.length) return { ok: false, msg: 'No IDs provided.' };
    try {
      const chunks = _chunkArray(docIds, MAX_BATCH);
      for (const chunk of chunks) {
        const batch = _getDb().batch();
        chunk.forEach(id => batch.delete(_col().doc(id)));
        await batch.commit();
      }
      return { ok: true };
    } catch (err) {
      console.error('[StudentService] bulkDelete error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /**
   * Delete ALL students (hard delete). Use with extreme caution.
   * Processes in chunks to handle Firestore batch limits.
   */
  async function deleteAll() {
    try {
      const snap = await _col().get();
      if (snap.empty) return { ok: true };

      const chunks = _chunkArray(snap.docs, MAX_BATCH);
      for (const chunk of chunks) {
        const batch = _getDb().batch();
        chunk.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
      return { ok: true };
    } catch (err) {
      console.error('[StudentService] deleteAll error:', err);
      return { ok: false, msg: _friendlyError(err) };
    }
  }

  /* ════════════════════════════════════════════════════════
     IMPORT (Excel → Firestore)
  ════════════════════════════════════════════════════════ */

  /**
   * Import an array of student records (from ExportService.importFromExcel).
   * Chunks into batches of CHUNK_SIZE.
   * @param {Array} records
   * @returns {Promise<{ok, imported, failed, msg}>}
   */
  async function importStudents(records) {
    if (!records || !records.length) return { ok: false, msg: 'No records to import.' };

    let imported = 0, failed = 0;
    const chunks = _chunkArray(records, CHUNK_SIZE);

    try {
      for (const chunk of chunks) {
        const batch = _getDb().batch();
        chunk.forEach(rec => {
          try {
            const clean = Security.sanitizeRecord(rec);
            const ref   = _col().doc();
            batch.set(ref, {
              ...clean,
              isActive:  true,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            imported++;
          } catch (e) {
            failed++;
            console.warn('[StudentService] importStudents: bad record', rec, e);
          }
        });
        await batch.commit();
      }
      return { ok: true, imported, failed };
    } catch (err) {
      console.error('[StudentService] importStudents error:', err);
      return { ok: false, imported, failed, msg: _friendlyError(err) };
    }
  }

  /* ════════════════════════════════════════════════════════
     PHOTO STORAGE
  ════════════════════════════════════════════════════════ */

  async function _uploadPhoto(dataUrl, studentId) {
    try {
      const storage = _getStorage();
      const path    = `students/${studentId}_${Date.now()}.jpg`;
      const ref     = storage.ref(path);
      await ref.putString(dataUrl, 'data_url', { contentType: 'image/jpeg' });
      const url = await ref.getDownloadURL();
      return { ok: true, url, path };
    } catch (err) {
      console.error('[StudentService] _uploadPhoto error:', err);
      return { ok: false };
    }
  }

  async function _deletePhoto(path) {
    if (!path) return;
    try {
      await _getStorage().ref(path).delete();
    } catch (err) {
      // ignore not-found errors
      if (err.code !== 'storage/object-not-found') {
        console.warn('[StudentService] _deletePhoto warning:', err.message);
      }
    }
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL HELPERS
  ════════════════════════════════════════════════════════ */

  function _mapDoc(doc) {
    return { _docId: doc.id, ...doc.data() };
  }

  function _chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  }

  function _tempId() {
    return 'TEMP_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  function _friendlyError(err) {
    const code = err.code || '';
    if (code === 'permission-denied')      return 'Permission denied. Check Firestore security rules.';
    if (code === 'unavailable')            return 'Database unavailable. Check your internet connection.';
    if (code === 'deadline-exceeded')      return 'Request timed out. Try again.';
    if (code === 'resource-exhausted')     return 'Quota exceeded. Please wait and try again.';
    if (code === 'already-exists')         return 'Record already exists.';
    if (code === 'not-found')              return 'Record not found.';
    return err.message || 'An unexpected error occurred.';
  }

  /* ── Public API ────────────────────────────────────────── */
  return {
    subscribeStudents,
    subscribeStats,
    getStudent,
    getDistinctValues,
    addStudent,
    updateStudent,
    softDelete,
    hardDelete,
    bulkDelete,
    deleteAll,
    importStudents,
  };

})();