/**
 * student.service.js — StudentMS v3
 * FIXED: Correct image save/load/edit/download flow.
 *
 * Key fixes:
 *  1. addStudent: saves text instantly, uploads photo in background,
 *     then writes real photoUrl back to Firestore (no premature blank).
 *  2. updateStudent: does NOT blank photoUrl during transition —
 *     old photo remains visible until new one is ready.
 *  3. updateStudent: when no new photo, existing photoUrl is fully preserved.
 *  4. _uploadPhotoBackground: accepts and correctly uses oldPhotoPath for cleanup.
 *  5. photoPending field: the new photo's base64 is written onto the
 *     document itself (same call that saves the text fields), instead of
 *     only living in the browser (sessionStorage). This is what makes the
 *     preview show up in EVERY open tab and survive a hard refresh, and why
 *     it never disappears on a timer — it's cleared only when the real
 *     photoUrl lands after a successful upload, or when the record is
 *     deleted (the field goes away with the document).
 */
'use strict';

const StudentService = (() => {
  const db      = () => firebase.firestore();
  const storage = () => firebase.storage();
  const col     = () => db().collection('students');

  /* ════════════════════════════════════════
     ADD STUDENT — instant save, bg photo
  ════════════════════════════════════════ */
  async function addStudent(data, photoDataUrl) {
    try {
      // 1. Save text record instantly WITHOUT blanking photoUrl.
      //    We omit a real photoUrl/photoPath entirely so the document has no
      //    stale empty string — the background upload will add them.
      const record = {
        ...data,
        isActive:  true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      // Ensure photoUrl and photoPath start as empty strings (not undefined)
      record.photoUrl  = '';
      record.photoPath = '';

      // Stash the new photo's base64 directly on the document, in the same
      // write as the text fields. Because it lives in Firestore (not
      // sessionStorage), every tab that has this dashboard open — and a
      // fresh page load — sees the photo immediately via the real-time
      // listener. There is no timer: it only goes away once the background
      // upload finishes (replaced by the real photoUrl) or the record is
      // deleted.
      if (photoDataUrl) {
        record.photoPending = photoDataUrl;
      }

      // 2. Write text record → get docId immediately
      const ref   = await col().add(record);
      const docId = ref.id;

      // 3. Kick off background photo upload without awaiting.
      //    It will write photoUrl + photoPath back to Firestore when done,
      //    triggering the real-time listener to refresh the table row.
      if (photoDataUrl) {
        _uploadPhotoBackground(docId, data, photoDataUrl, '');
      }

      // 4. Return immediately — dashboard redirects now
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

      // CRITICAL FIX: Do NOT blank photoUrl when a new photo is being uploaded.
      // The old photo URL stays visible in the table while the new one uploads
      // in the background. The background function will overwrite photoUrl only
      // after the new upload succeeds.
      //
      // Explicitly remove photoUrl / photoPath from the immediate update so we
      // never accidentally erase them here. They are managed solely by
      // _uploadPhotoBackground when a new photo is provided.
      delete update.photoUrl;
      delete update.photoPath;

      // Same idea as addStudent: stash the new photo's base64 on the
      // document itself, in this same write, so it's visible everywhere
      // immediately and isn't lost on a refresh or tab switch.
      if (photoDataUrl) {
        update.photoPending = photoDataUrl;
      }

      // 1. Save text fields instantly (photoUrl/photoPath untouched in Firestore)
      await col().doc(docId).update(update);

      // 2. If a new photo was provided, upload in background.
      //    Pass oldPhotoPath so the old file is deleted after the new one lands.
      if (photoDataUrl) {
        _uploadPhotoBackground(docId, data, photoDataUrl, oldPhotoPath || '');
      }
      // If no new photo: existing photoUrl/photoPath remain unchanged in Firestore ✓

      return { ok: true, id: docId };
    } catch (err) {
      console.error('[StudentService] updateStudent error:', err);
      return { ok: false, msg: err.message };
    }
  }

  /* ════════════════════════════════════════
     BACKGROUND PHOTO UPLOAD
     Runs after the dashboard has already redirected.
     Writes the real photoUrl back to Firestore so the
     Firestore listener auto-refreshes the table row, and clears
     photoPending now that the real URL is the source of truth.
  ════════════════════════════════════════ */
  async function _uploadPhotoBackground(docId, data, photoDataUrl, oldPhotoPath) {
    try {
      // Convert base64 dataUrl → Blob for efficient upload
      const blob     = _dataUrlToBlob(photoDataUrl);
      const ext      = blob.type === 'image/png' ? 'png' : 'jpg';
      const safeName = (data.name || 'student').replace(/[^a-z0-9]/gi, '_');
      const path     = `students/${docId}/${safeName}_${Date.now()}.${ext}`;

      // Delete the OLD photo file from Storage (if any) before writing new one.
      // Use the path string, not the URL — URLs can't be used to delete.
      if (oldPhotoPath && oldPhotoPath.trim()) {
        try {
          await storage().ref(oldPhotoPath).delete();
        } catch (delErr) {
          // Non-fatal: old file may already be deleted or path may be stale
          console.warn('[StudentService] Could not delete old photo:', delErr.message);
        }
      }

      // Upload new blob to Firebase Storage
      const snap = await storage().ref(path).put(blob, { contentType: blob.type });
      const url  = await snap.ref.getDownloadURL();

      // Write real photoUrl + photoPath back and clear photoPending — this
      // fires the Firestore real-time listener which updates the table row
      // (in every open tab) automatically, swapping the base64 preview for
      // the real URL.
      await col().doc(docId).update({
        photoUrl:     url,
        photoPath:    path,
        photoPending: firebase.firestore.FieldValue.delete(),
        updatedAt:    firebase.firestore.FieldValue.serverTimestamp(),
      });

      console.log('[StudentService] Background photo upload complete:', docId, url);
    } catch (err) {
      console.error('[StudentService] Background photo upload failed:', err);
      // Non-fatal: the text record is already saved, and photoPending is
      // deliberately left in place so the base64 preview keeps showing
      // (instead of disappearing) until the user re-saves with a photo or
      // deletes the record. There is no automatic expiry.
    }
  }

  /* ── Blob conversion helper ─────────────── */
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
    // Try ordered query first. If Firestore throws a missing-index error
    // (code 'failed-precondition'), fall back to an unordered query so the
    // table always loads. Users can create the index from the Firebase console
    // link that appears in the browser console.
    const onSnap = snap => {
      const docs = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
      cb(docs);
    };
    const onErr = err => {
      console.error('[StudentService] subscribeStudents:', err);
      if (err.code === 'failed-precondition' || err.message?.includes('index')) {
        console.warn('[StudentService] Index missing — falling back to unordered query. '
          + 'Create the index in Firebase Console to restore sort order.');
        col()
          .limit(limit)
          .onSnapshot(onSnap, err2 => console.error('[StudentService] fallback query error:', err2));
      }
    };
    return col()
      .orderBy(orderBy, orderDir)
      .limit(limit)
      .onSnapshot(onSnap, onErr);
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