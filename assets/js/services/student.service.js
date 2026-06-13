/**
 * student.service.js — StudentMS v3
 * OPTIMIZED: Instant save with background photo upload.
 * Text data saves immediately → redirect → photo uploads silently in bg.
 */
'use strict';

const StudentService = (() => {
  const db      = () => firebase.firestore();
  const storage = () => firebase.storage();
  const col     = () => db().collection('students');

  /* ── Background upload queue ────────────────────────── */
  // Tracks in-progress background uploads so the table can show
  // a placeholder and swap in the real URL when done.
  const _pendingUploads = new Map(); // docId → { dataUrl, resolve[] }

  /* ════════════════════════════════════════
     ADD STUDENT — instant save, bg photo
  ════════════════════════════════════════ */
  async function addStudent(data, photoDataUrl) {
    try {
      // 1. Strip the photoUrl from data — we'll fill it after upload
      const record = {
        ...data,
        photoUrl:    '',          // placeholder until upload finishes
        photoPath:   '',
        isActive:    true,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      };

      // 2. Save text record instantly → get docId
      const ref = await col().add(record);
      const docId = ref.id;

      // 3. If there's a photo, kick off background upload (do NOT await)
      if (photoDataUrl) {
        _uploadPhotoBackground(docId, data, photoDataUrl);
      }

      // 4. Return immediately — caller redirects now
      return { ok: true, id: docId };
    } catch (err) {
      console.error('[StudentService] addStudent error:', err);
      return { ok: false, msg: err.message };
    }
  }

  /* ════════════════════════════════════════
     UPDATE STUDENT — instant save, bg photo
  ════════════════════════════════════════ */
  async function updateStudent(docId, data, photoDataUrl, oldPhotoPath) {
    try {
      const update = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // If new photo provided, blank out photoUrl temporarily
      // so UI shows spinner/placeholder while bg upload runs.
      // If no new photo, keep existing photoUrl as-is.
      if (photoDataUrl) {
        update.photoUrl  = '';
        update.photoPath = '';
      }

      // 1. Save text fields instantly
      await col().doc(docId).update(update);

      // 2. Background photo upload (no await)
      if (photoDataUrl) {
        _uploadPhotoBackground(docId, data, photoDataUrl, oldPhotoPath);
      }

      return { ok: true, id: docId };
    } catch (err) {
      console.error('[StudentService] updateStudent error:', err);
      return { ok: false, msg: err.message };
    }
  }

  /* ════════════════════════════════════════
     BACKGROUND PHOTO UPLOAD
     Runs after redirect — updates Firestore
     when done so table auto-refreshes.
  ════════════════════════════════════════ */
  async function _uploadPhotoBackground(docId, data, photoDataUrl, oldPhotoPath) {
    try {
      // Convert base64 → blob (avoids large string uploads)
      const blob     = _dataUrlToBlob(photoDataUrl);
      const ext      = blob.type === 'image/png' ? 'png' : 'jpg';
      const safeName = (data.name || 'student').replace(/[^a-z0-9]/gi, '_');
      const path     = `students/${docId}/${safeName}_${Date.now()}.${ext}`;

      // Delete old photo if editing
      if (oldPhotoPath) {
        try { await storage().ref(oldPhotoPath).delete(); } catch (_) {}
      }

      const snap = await storage().ref(path).put(blob, { contentType: blob.type });
      const url  = await snap.ref.getDownloadURL();

      // Update Firestore with real photo URL — listener triggers table re-render
      await col().doc(docId).update({ photoUrl: url, photoPath: path });

      console.log('[StudentService] Background photo upload complete:', docId);
    } catch (err) {
      console.error('[StudentService] Background photo upload failed:', err);
      // Non-fatal — record exists without photo, user can re-upload on edit
    }
  }

  /* ── Blob helper ─────────────────────── */
  function _dataUrlToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime  = header.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ════════════════════════════════════════
     DELETE OPERATIONS
  ════════════════════════════════════════ */
  async function softDelete(docId) {
    try {
      await col().doc(docId).update({
        isActive:  false,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  async function hardDelete(docId) {
    try {
      const snap = await col().doc(docId).get();
      if (snap.exists && snap.data().photoPath) {
        try { await storage().ref(snap.data().photoPath).delete(); } catch (_) {}
      }
      await col().doc(docId).delete();
      return { ok: true };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  async function bulkDelete(ids) {
    try {
      const batch = db().batch();
      for (const id of ids) {
        batch.delete(col().doc(id));
        // Fire-and-forget photo cleanup
        col().doc(id).get().then(snap => {
          if (snap.exists && snap.data().photoPath) {
            storage().ref(snap.data().photoPath).delete().catch(() => {});
          }
        });
      }
      await batch.commit();
      return { ok: true };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  async function deleteAll() {
    try {
      const snap = await col().get();
      const batchSize = 400;
      let batch = db().batch();
      let count = 0;
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
        count++;
        if (count >= batchSize) {
          await batch.commit();
          batch = db().batch();
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      return { ok: true };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  /* ════════════════════════════════════════
     READ
  ════════════════════════════════════════ */
  async function getStudent(docId) {
    try {
      const snap = await col().doc(docId).get();
      if (!snap.exists) return null;
      return { _docId: snap.id, ...snap.data() };
    } catch (err) { return null; }
  }

  function subscribeStudents({ orderBy = 'createdAt', orderDir = 'desc', limit = 10000 } = {}, cb) {
    return col()
      .orderBy(orderBy, orderDir)
      .limit(limit)
      .onSnapshot(snap => {
        const docs = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        cb(docs);
      }, err => console.error('[StudentService] subscribeStudents:', err));
  }

  function subscribeStats(cb) {
    return col().onSnapshot(snap => {
      let active = 0, deleted = 0;
      snap.docs.forEach(d => {
        if (d.data().isActive === false) deleted++;
        else active++;
      });
      cb({ total: snap.size, active, deleted });
    });
  }

  async function getDistinctValues(field) {
    try {
      const snap = await col().get();
      const vals = new Set();
      snap.docs.forEach(d => { const v = d.data()[field]; if (v) vals.add(v); });
      return [...vals].sort();
    } catch (_) { return []; }
  }

  /* ════════════════════════════════════════
     IMPORT
  ════════════════════════════════════════ */
  async function importStudents(records) {
    try {
      const batchSize = 400;
      let batch = db().batch();
      let count = 0;
      let imported = 0;

      for (const rec of records) {
        const ref = col().doc();
        batch.set(ref, {
          ...rec,
          isActive:  true,
          photoUrl:  '',
          photoPath: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        count++;
        imported++;
        if (count >= batchSize) {
          await batch.commit();
          batch = db().batch();
          count = 0;
        }
      }
      if (count > 0) await batch.commit();
      return { ok: true, imported };
    } catch (err) { return { ok: false, msg: err.message }; }
  }

  return {
    addStudent,
    updateStudent,
    softDelete,
    hardDelete,
    bulkDelete,
    deleteAll,
    getStudent,
    subscribeStudents,
    subscribeStats,
    getDistinctValues,
    importStudents,
  };
})();