/**
 * auth.service.js — StudentMS v3 Authentication Service
 *
 * Wraps Firebase Auth:
 *  - Email/password sign-in
 *  - Auth state observer
 *  - Sign-out
 *  - Role-based access (stored in Firestore users/{uid})
 *  - Session persistence
 */
'use strict';

const AuthService = (() => {

  let _auth = null;

  function _getAuth() {
    if (!_auth) _auth = firebase.auth();
    return _auth;
  }

  /**
   * Sign in with email + password.
   * @returns {Promise<{ok, user, msg}>}
   */
  async function signIn(email, password) {
    try {
      const cred = await _getAuth().signInWithEmailAndPassword(email, password);
      return { ok: true, user: cred.user };
    } catch (err) {
      return { ok: false, msg: _friendlyAuthError(err) };
    }
  }

  /**
   * Sign out current user.
   */
  async function signOut() {
    try {
      await _getAuth().signOut();
    } catch (err) {
      console.error('[AuthService] signOut error:', err);
    }
  }

  /**
   * Subscribe to auth state changes.
   * @param {Function} callback - (user|null, role|null) => void
   * @returns {Function} unsubscribe
   */
  function onAuthStateChanged(callback) {
    return _getAuth().onAuthStateChanged(async (user) => {
      if (!user) { callback(null, null); return; }
      // Optionally fetch role from Firestore
      let role = 'admin'; // default
      try {
        const snap = await firebase.firestore().collection('users').doc(user.uid).get();
        if (snap.exists) role = snap.data().role || 'admin';
      } catch (_) {}
      callback(user, role);
    });
  }

  /**
   * Get currently signed-in user.
   */
  function currentUser() {
    return _getAuth().currentUser;
  }

  function _friendlyAuthError(err) {
    switch (err.code) {
      case 'auth/user-not-found':      return 'No account found with this email.';
      case 'auth/wrong-password':      return 'Incorrect password.';
      case 'auth/invalid-email':       return 'Invalid email address.';
      case 'auth/user-disabled':       return 'This account has been disabled.';
      case 'auth/too-many-requests':   return 'Too many failed attempts. Try again later.';
      case 'auth/network-request-failed': return 'Network error. Check your connection.';
      default: return err.message || 'Authentication failed.';
    }
  }

  return { signIn, signOut, onAuthStateChanged, currentUser };
})();