/**
 * helpers.js — StudentMS v3 Utility Functions
 * All shared helpers: formatting, debounce, animation, pagination, compression, etc.
 */
'use strict';

/* ════════════════════════════════════════
   DEBOUNCE / THROTTLE
════════════════════════════════════════ */
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

/* ════════════════════════════════════════
   DATE / TIME FORMATTING
════════════════════════════════════════ */
function formatDate(val) {
  if (!val) return '—';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return '—'; }
}

function formatDateTime(val) {
  if (!val) return '—';
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  } catch (_) { return '—'; }
}

function formatRelative(val) {
  if (!val) return '—';
  try {
    const d   = val?.toDate ? val.toDate() : new Date(val);
    const now = Date.now();
    const diff = now - d.getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)    return 'Just now';
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800)return `${Math.floor(s / 86400)}d ago`;
    return formatDate(val);
  } catch (_) { return '—'; }
}

/* ════════════════════════════════════════
   NUMBER ANIMATION
════════════════════════════════════════ */
function animateNumber(elId, target, duration = 600) {
  const el = document.getElementById(elId);
  if (!el) return;
  const start = Number(el.textContent.replace(/[^0-9]/g, '')) || 0;
  if (start === target) return;
  const startTime = performance.now();
  const tick = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  };
  requestAnimationFrame(tick);
}

/* ════════════════════════════════════════
   TEXT HIGHLIGHT (for search)
════════════════════════════════════════ */
function hlText(text, query) {
  if (!text) return '';
  const escaped = Security.esc(String(text));
  if (!query) return escaped;
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${safeQ})`, 'gi'),
    '<mark class="hl">$1</mark>');
}

/* ════════════════════════════════════════
   PAGINATION NUMBERS
════════════════════════════════════════ */
function buildPageNums(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  const add = (n) => { if (!pages.includes(n) && n >= 1 && n <= total) pages.push(n); };
  add(1); add(2);
  if (current > 4) pages.push('…');
  for (let i = current - 1; i <= current + 1; i++) add(i);
  if (current < total - 3) pages.push('…');
  add(total - 1); add(total);
  return pages;
}

/* ════════════════════════════════════════
   SKELETON LOADER
════════════════════════════════════════ */
function showSkeleton(tbody, rows = 10, cols = 8) {
  if (!tbody) return;
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const w = [30, 100, 140, 70, 50, 60, 80, 90][c % 8];
      html += `<td><div class="skeleton-cell" style="width:${w}px;"></div></td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

/* ════════════════════════════════════════
   MODAL HELPERS
════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  // trap focus inside modal
  setTimeout(() => {
    const focusable = el.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();
  }, 100);
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function initModalListeners() {
  // Close on backdrop click
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      e.target.classList.remove('open');
    }
  });
  // Close buttons with data-close
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-close]');
    if (btn) closeModal(btn.dataset.close);
  });
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
    }
  });
}

/* ════════════════════════════════════════
   TOAST
════════════════════════════════════════ */
let _toastTimer = null;

function showToast(type, icon, msg, duration = 3500) {
  const toast   = document.getElementById('toast');
  const toastIcon = document.getElementById('toastIcon');
  const toastMsg  = document.getElementById('toastMsg');
  if (!toast) return;

  clearTimeout(_toastTimer);
  toast.className = `toast toast-${type} show`;
  if (toastIcon) toastIcon.textContent = icon;
  if (toastMsg)  toastMsg.textContent  = msg;

  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ════════════════════════════════════════
   THEME
════════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('sms_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('sms_theme', next);
}

/* ════════════════════════════════════════
   IMAGE COMPRESSION
════════════════════════════════════════ */
async function compressImage(dataUrl, maxW = 800, maxH = 800, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const ratio = Math.min(maxW / width, maxH / height, 1);
      width  = Math.round(width  * ratio);
      height = Math.round(height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fall back to original on error
    img.src = dataUrl;
  });
}

/* ════════════════════════════════════════
   TICK (yield to browser)
════════════════════════════════════════ */
function tick(ms = 0) {
  return new Promise(r => setTimeout(r, ms));
}

/* ════════════════════════════════════════
   DEEP CLONE
════════════════════════════════════════ */
function deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (_) { return { ...obj }; }
}

/* ════════════════════════════════════════
   FIRESTORE init (called from config.js)
════════════════════════════════════════ */
function initFirebase() {
  // firebase.initializeApp is called in config.js
  // This function is a no-op hook for compatibility
}