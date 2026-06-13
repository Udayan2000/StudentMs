/**
 * multiselect.js — Professional searchable multi-select for subjects
 * Fully self-contained, no dependencies except Security helper
 */
'use strict';

class MultiSelectSubjects {
  constructor(options = {}) {
    this.subjects    = options.subjects  || [];
    this.selected    = new Set(options.selected || []);
    this.onChange    = options.onChange  || (() => {});
    this.wrap        = document.getElementById('subjectMultiSelect');
    this.display     = document.getElementById('subjectDisplay');
    this.dropdown    = document.getElementById('subjectDropdown');
    this.searchEl    = document.getElementById('subjectSearch');
    this.optionsEl   = document.getElementById('subjectOptions');
    this.countEl     = document.getElementById('subjectCount');
    this.hiddenInput = document.getElementById('fSubjects');
    this.isOpen      = false;
    this._query      = '';

    if (this.wrap) this._init();
  }

  _init() {
    this._renderOptions(this.subjects);

    this.wrap.addEventListener('click', (e) => {
      if (e.target.closest('.ms-tag-remove')) return;
      this.toggle();
    });
    this.wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
      if (e.key === 'Escape') this.close();
    });

    if (this.searchEl) {
      this.searchEl.addEventListener('input', (e) => {
        this._query = e.target.value.toLowerCase();
        const filtered = this.subjects.filter(s => s.toLowerCase().includes(this._query));
        this._renderOptions(filtered);
      });
      this.searchEl.addEventListener('click', (e) => e.stopPropagation());
    }

    const selAllBtn = document.getElementById('subjectSelectAll');
    const clrAllBtn = document.getElementById('subjectClearAll');

    if (selAllBtn) {
      selAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._visibleSubjects().forEach(s => this.selected.add(s));
        this._renderOptions(this._visibleSubjects());
        this._updateDisplay();
        this._syncHidden();
        this.onChange([...this.selected]);
      });
    }

    if (clrAllBtn) {
      clrAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selected.clear();
        this._renderOptions(this._visibleSubjects());
        this._updateDisplay();
        this._syncHidden();
        this.onChange([...this.selected]);
      });
    }

    document.addEventListener('click', (e) => {
      if (!this.wrap.contains(e.target) && !this.dropdown.contains(e.target)) {
        this.close();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    this._updateDisplay();
  }

  _visibleSubjects() {
    if (!this._query) return this.subjects;
    return this.subjects.filter(s => s.toLowerCase().includes(this._query));
  }

  _esc(str) {
    return String(str || '').replace(/[&<>"']/g, m =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  _renderOptions(list) {
    if (!this.optionsEl) return;
    if (!list.length) {
      this.optionsEl.innerHTML = `<div style="padding:12px 16px;color:var(--muted,#888);font-size:13px;text-align:center;">No subjects found</div>`;
      return;
    }
    this.optionsEl.innerHTML = list.map(subject => {
      const checked = this.selected.has(subject);
      const id = `ms-opt-${subject.replace(/[^a-zA-Z0-9]/g,'_')}`;
      return `<label class="ms-option${checked?' checked':''}" data-value="${this._esc(subject)}" for="${id}">
        <input type="checkbox" id="${id}" class="ms-checkbox" value="${this._esc(subject)}"${checked?' checked':''} aria-label="${this._esc(subject)}"/>
        <span class="ms-check-icon"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="2,6 5,9 10,3"/></svg></span>
        ${this._esc(subject)}
      </label>`;
    }).join('');

    this.optionsEl.querySelectorAll('.ms-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const val = cb.value;
        const lbl = cb.closest('.ms-option');
        if (cb.checked) { this.selected.add(val); lbl && lbl.classList.add('checked'); }
        else            { this.selected.delete(val); lbl && lbl.classList.remove('checked'); }
        this._updateDisplay();
        this._syncHidden();
        this.onChange([...this.selected]);
      });
    });
    this._updateCount();
  }

  _updateDisplay() {
    if (!this.display) return;
    const arr = [...this.selected];
    this._updateCount();

    if (!arr.length) {
      this.display.innerHTML = `<span class="multiselect-placeholder">Select subjects…</span>`;
      this.wrap.classList.remove('has-value');
      return;
    }

    this.wrap.classList.add('has-value');
    const shown = arr.slice(0, 4);
    const extra = arr.length - shown.length;

    const tags = shown.map(s => `<span class="ms-tag">${this._esc(s)}
      <button type="button" class="ms-tag-remove" data-subject="${this._esc(s)}" aria-label="Remove ${this._esc(s)}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
      </button></span>`).join('');

    this.display.innerHTML = tags + (extra > 0 ? `<span class="ms-tag ms-tag-more">+${extra} more</span>` : '');

    this.display.querySelectorAll('.ms-tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selected.delete(btn.dataset.subject);
        this._renderOptions(this._visibleSubjects());
        this._updateDisplay();
        this._syncHidden();
        this.onChange([...this.selected]);
      });
    });
  }

  _updateCount() {
    if (this.countEl) this.countEl.textContent = `${this.selected.size} selected`;
    this.optionsEl && this.optionsEl.querySelectorAll('.ms-checkbox').forEach(cb => {
      const checked = this.selected.has(cb.value);
      cb.checked = checked;
      cb.closest('.ms-option')?.classList.toggle('checked', checked);
    });
  }

  _syncHidden() {
    if (this.hiddenInput) this.hiddenInput.value = [...this.selected].join(', ');
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    this.isOpen = true;
    this.dropdown && this.dropdown.classList.add('open');
    this.wrap.setAttribute('aria-expanded', 'true');
    if (this.searchEl) { this.searchEl.value = ''; }
    this._query = '';
    this._renderOptions(this.subjects);
    setTimeout(() => this.searchEl && this.searchEl.focus(), 50);
  }

  close() {
    this.isOpen = false;
    this.dropdown && this.dropdown.classList.remove('open');
    this.wrap.setAttribute('aria-expanded', 'false');
  }

  setSelected(values) {
    this.selected = new Set(Array.isArray(values) ? values : String(values||'').split(',').map(x=>x.trim()).filter(Boolean));
    this._renderOptions(this.subjects);
    this._updateDisplay();
    this._syncHidden();
  }

  clear() { this.setSelected([]); }

  getSelected() { return [...this.selected]; }
}