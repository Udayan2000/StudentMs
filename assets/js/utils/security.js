/**
 * security.js — StudentMS v3 Security & Sanitization Layer
 *
 * Provides:
 *  - HTML/attribute escaping (XSS prevention)
 *  - Input sanitization
 *  - Aadhaar masking & validation
 *  - Phone validation
 *  - Image file validation
 *  - Record sanitization before Firestore writes
 *  - Content Security helpers
 */
'use strict';

const Security = (() => {

  /* ── HTML Escape (XSS prevention) ──────────────────────── */
  const _escMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };

  /**
   * Escape a string for safe HTML insertion.
   * Always call this before inserting user data into innerHTML.
   */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"'`=/]/g, m => _escMap[m]);
  }

  /**
   * Strip all HTML tags from a string (plain-text extraction).
   */
  function stripHtml(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, '').trim();
  }

  /* ── Input Sanitization ─────────────────────────────────── */

  /**
   * Sanitize a plain text string:
   * - Removes leading/trailing whitespace
   * - Collapses consecutive whitespace
   * - Strips control characters
   * - Optionally truncates to maxLen
   */
  function sanitizeText(str, maxLen = 500) {
    if (!str) return '';
    return String(str)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // control chars
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, maxLen);
  }

  /**
   * Sanitize a full student record before saving to Firestore.
   * Returns a new clean object — does not mutate the input.
   */
  function sanitizeRecord(raw) {
    const clean = {};

    const textFields = [
      'name', 'studentId', 'className', 'section', 'rollNo', 'gender',
      'fatherName', 'motherName', 'guardianName', 'guardianRelation',
      'contactNo', 'bloodGroup', 'session', 'academicYear', 'stream',
      'schoolName', 'subjects', 'dob',
    ];

    textFields.forEach(field => {
      if (raw[field] !== undefined) {
        clean[field] = sanitizeText(raw[field], 200);
      }
    });

    // Longer fields
    if (raw.address !== undefined) clean.address = sanitizeText(raw.address, 800);

    // Aadhaar — store only digits (no dashes) after validation
    if (raw.aadhaarNo !== undefined) {
      const digits = String(raw.aadhaarNo).replace(/\D/g, '');
      clean.aadhaarNo = digits.length === 12 ? digits : sanitizeText(raw.aadhaarNo, 14);
    }

    // Array fields
    if (Array.isArray(raw.subjectsArray)) {
      clean.subjectsArray = raw.subjectsArray
        .filter(s => typeof s === 'string' && s.trim())
        .map(s => sanitizeText(s, 100))
        .slice(0, 50); // max 50 subjects
    }

    // Photo URL — only accept http/https/data URIs
    if (raw.photoUrl !== undefined) {
      const url = String(raw.photoUrl || '');
      clean.photoUrl = (url.startsWith('http') || url.startsWith('data:image/'))
        ? url
        : '';
    }

    // Passthrough safe fields
    ['driveFileId', 'driveFileUrl', 'photoPath'].forEach(f => {
      if (raw[f] !== undefined) clean[f] = sanitizeText(raw[f], 500);
    });

    return clean;
  }

  /* ── Validation ─────────────────────────────────────────── */

  /**
   * Validate a phone number: 7–20 digits, optional leading +
   */
  function validPhone(phone) {
    if (!phone) return true; // optional field — empty is OK
    const digits = String(phone).replace(/[\s\-().+]/g, '');
    return /^\d{7,20}$/.test(digits);
  }

  /**
   * Validate Aadhaar:
   *  - Empty is valid (optional field)
   *  - Must be exactly 12 digits if provided
   */
  function validAadhaar(aadhaar) {
    if (!aadhaar) return true;
    const digits = String(aadhaar).replace(/\D/g, '');
    return digits.length === 12;
  }

  /**
   * Validate an image file:
   * - Accepted MIME types
   * - Max size 10 MB
   */
  function validImage(file) {
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const MAX_SIZE_MB   = 10;

    if (!file) return { ok: false, msg: 'No file selected.' };
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { ok: false, msg: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF.` };
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return { ok: false, msg: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_SIZE_MB} MB.` };
    }
    return { ok: true };
  }

  /* ── Aadhaar Masking ──────────────────────────────────────
     Display format: XXXX-XXXX-1234 (last 4 digits only)
  ── */
  function maskAadhaar(aadhaar) {
    if (!aadhaar) return '—';
    const digits = String(aadhaar).replace(/\D/g, '');
    if (digits.length !== 12) return aadhaar; // can't mask, return as-is
    return `XXXX-XXXX-${digits.slice(8)}`;
  }

  /**
   * Format Aadhaar for input display: XXXX-XXXX-XXXX
   */
  function formatAadhaar(aadhaar) {
    if (!aadhaar) return '';
    const digits = String(aadhaar).replace(/\D/g, '').substring(0, 12);
    return digits.replace(/(\d{4})(\d{4})?(\d{4})?/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join('-')
    );
  }

  /* ── Unique ID Generator ─────────────────────────────────── */
  function generateId(prefix = 'STU') {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${ts}${rand}`;
  }

  /* ── Rate Limiting (client-side simple) ─────────────────── */
  const _actionLog = {};
  function rateLimit(action, maxPerMinute = 30) {
    const now = Date.now();
    if (!_actionLog[action]) _actionLog[action] = [];
    _actionLog[action] = _actionLog[action].filter(t => now - t < 60000);
    if (_actionLog[action].length >= maxPerMinute) return false;
    _actionLog[action].push(now);
    return true;
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    esc,
    stripHtml,
    sanitizeText,
    sanitizeRecord,
    validPhone,
    validAadhaar,
    validImage,
    maskAadhaar,
    formatAadhaar,
    generateId,
    rateLimit,
  };

})();