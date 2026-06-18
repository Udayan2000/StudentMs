/**
 * firebase/config.js — StudentMS v3 Firebase Configuration
 *
 * ⚠️  IMPORTANT: Replace the placeholder values below with your
 *     actual Firebase project credentials from:
 *     Firebase Console → Project Settings → Your apps → SDK setup
 *
 * ⚠️  SECURITY: Never commit real API keys to public repositories.
 *     Use environment variables or Firebase Hosting env config for production.
 */
'use strict';

// ── Firebase config ─────────────────────────────────────
const firebaseConfig = {
 apiKey: "AIzaSyBUZZRH-3kOY5CxIEKw3Tfl75YH3-yfogE",
  authDomain: "studentms-669aa.firebaseapp.com",
  projectId: "studentms-669aa",
  storageBucket: "studentms-669aa.firebasestorage.app",
  messagingSenderId: "1015966902078",
  appId: "1:1015966902078:web:ae646541fc25f6255e6e6f",
  measurementId: "G-ZTCCSK40JN"
};

// ── Google Drive OAuth2 Client ID ────────────────────────
// From: console.cloud.google.com → APIs & Services → Credentials
window.DRIVE_CONFIG = {
  // clientId: '1015966902078-7uv39f05vc7dq6qibqgbcbqbs0gnc8r6.apps.googleusercontent.com',
  clientId: '1015966902078-kgimp58l7uum4nsgn662ga1pft2722fb.apps.googleusercontent.com',
  
};

// Legacy alias (kept for compatibility)
window.DRIVE_CLIENT_ID = window.DRIVE_CONFIG.clientId;

// ── App version ──────────────────────────────────────────
window.APP_VERSION = '3.0.0';

// ── Initialize Firebase ──────────────────────────────────
(function initFirebaseApp() {
  if (firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
  }

   window.storage = firebase.storage();

  // Enable Firestore offline persistence (improves reliability)
  firebase.firestore().enablePersistence({ synchronizeTabs: true })
    .then(() => console.log('[Firebase] Offline persistence enabled.'))
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('[Firebase] Multiple tabs open — persistence disabled for this tab.');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firebase] Browser does not support offline persistence.');
      }
    });

  // Set app version in UI
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = window.APP_VERSION;
})();