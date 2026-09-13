/* =============================================
   PERSONAL DIARY — DIARY.JS
   Entry CRUD, autosave, search, rendering
   ============================================= */
import { COMMON_TAGS } from './data/commonTags';

const Diary = (() => {
  // ─── State ──────────────────────────────────
  let state = {
    entries: [],
    activeId: null,
    isNew: false,
    searchQuery: '',
    autoSaveTimer: null,
    autoSaveTimeout: null,
    lastSavedContent: '',
    selectedMood: null,
    isDirty: false,
    filterMood: '',
    filterTag: '',
    sortBy: 'newest',
    viewMode: 'list',   // 'list' | 'trash'
    isPreview: false,
    currentTags: [],
    category: ''
  };

  // ─── DOM refs ───────────────────────────────
  let DOM = {};

  function bindDOM() {
    DOM = {
      entriesList:    document.getElementById('entries-list'),
      editor:         document.getElementById('entry-editor'),
      editorDate:     document.getElementById('editor-date'),
      editorWrap:     document.getElementById('editor-wrap'),
      welcomeScreen:  document.getElementById('welcome-screen'),
      saveBtn:        document.getElementById('save-btn'),
      deleteBtn:      document.getElementById('delete-btn'),
      newBtn:         document.getElementById('new-entry-btn'),
      searchInput:    document.getElementById('search-input'),
      autosaveEl:     document.getElementById('autosave-indicator'),
      autosaveText:   document.getElementById('autosave-text'),
      autosaveDot:    document.getElementById('autosave-dot'),
      wordCountEl:    document.getElementById('word-count'),
      userNameEl:     document.getElementById('user-name'),
      userAvatarEl:   document.getElementById('user-avatar'),
      logoutBtn:      document.getElementById('logout-btn'),
      moodBtns:       document.querySelectorAll('.mood-btn'),
      editorHeader:   document.getElementById('editor-header'),
      editorScroll:   document.getElementById('editor-scroll'),
      liveTime:       document.getElementById('live-time'),
      entriesCount:   document.getElementById('entries-count'),
      filterMood:     document.getElementById('filter-mood'),
      filterTag:      document.getElementById('filter-tag'),
      sortSelect:     document.getElementById('sort-select'),
      streakBadge:    document.getElementById('streak-badge'),
      trashBtn:       document.getElementById('trash-toggle-btn'),
      exportBtn:      document.getElementById('export-json-btn'),
      favoriteBtn:    document.getElementById('favorite-btn'),
      pinBtn:         document.getElementById('pin-btn'),
      previewBtn:     document.getElementById('preview-btn'),
      preview:        document.getElementById('entry-preview'),
      readingTimeEl:  document.getElementById('reading-time'),
      categorySelect: document.getElementById('category-select'),
      tagsField:      document.getElementById('tags-field'),
      tagsChips:      document.getElementById('tags-chips'),
      tagsInput:      document.getElementById('tags-input'),
      tagsSuggest:    document.getElementById('tags-suggest'),
    };
  }

  // ─── Initialize ─────────────────────────────
  async function init() {
    bindDOM();
    UI.initRipples();

    // Populate user info
    const user = await Auth.getUser();
    if (user) {
      const displayName = user.username || user.email;
      if (DOM.userNameEl) DOM.userNameEl.textContent = displayName;
      if (DOM.userAvatarEl) DOM.userAvatarEl.textContent = UI.getInitials(displayName);
    }

    // Sticky header
    UI.initStickyHeader(DOM.editorHeader, DOM.editorScroll);

    // Live clock
    UI.startLiveClock(DOM.liveTime);

    // Load entries from backend
    await loadEntries();
    loadStreak();

    // Events
    if (DOM.filterMood) DOM.filterMood.addEventListener('change', e => { state.filterMood = e.target.value; renderSidebar(); });
    if (DOM.filterTag)  DOM.filterTag.addEventListener('input', e => { state.filterTag = e.target.value.toLowerCase().trim(); renderSidebar(); });
    if (DOM.sortSelect) DOM.sortSelect.addEventListener('change', e => { state.sortBy = e.target.value; renderSidebar(); });
    if (DOM.trashBtn)   DOM.trashBtn.addEventListener('click', toggleTrashView);
    if (DOM.exportBtn)  DOM.exportBtn.addEventListener('click', exportPDF);
    if (DOM.favoriteBtn) DOM.favoriteBtn.addEventListener('click', toggleFavorite);
    if (DOM.pinBtn)       DOM.pinBtn.addEventListener('click', togglePin);
    if (DOM.previewBtn)   DOM.previewBtn.addEventListener('click', togglePreview);
    if (DOM.categorySelect) DOM.categorySelect.addEventListener('change', () => { state.isDirty = true; scheduleAutoSave(); });
    initTagsWidget();

    if (DOM.newBtn)      DOM.newBtn.addEventListener('click', newEntry);
    if (DOM.saveBtn)     DOM.saveBtn.addEventListener('click', () => saveActive());
    if (DOM.deleteBtn)   DOM.deleteBtn.addEventListener('click', confirmDelete);
    if (DOM.logoutBtn)   DOM.logoutBtn.addEventListener('click', Auth.logout);
    if (DOM.searchInput) DOM.searchInput.addEventListener('input', onSearch);
    if (DOM.editor) {
      DOM.editor.addEventListener('input', onEditorInput);
      DOM.editor.addEventListener('keydown', onEditorKeydown);
    }

    // Mood buttons
    if (DOM.moodBtns) {
      DOM.moodBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          DOM.moodBtns.forEach(b => b.classList.remove('selected'));
          btn.classList.toggle('selected');
          state.selectedMood = btn.dataset.mood;
          state.isDirty = true;
          scheduleAutoSave();
        });
      });
    }

    // Auto-save every 5 seconds
    state.autoSaveTimer = setInterval(autoSave, 5000);

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActive();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newEntry();
      }
    });
  }

  // ─── Load entries from backend ───────────────
  // FIX 1: Use API.getEntries() (which uses 'diary_token') instead of raw
  //         fetch with 'token'. Remove ALL demo/fake entry fallbacks.
  async function loadEntries() {
    UI.renderSkeletons(DOM.entriesList);

    try {
      console.log('[Diary] Loading entries from backend…');
      const data = await API.getEntries();
      console.log('[Diary] Entries response:', data);

      state.entries = Array.isArray(data) ? data : (data.entries || []);
      console.log(`[Diary] Loaded ${state.entries.length} entries`);
      renderSidebar();

    } catch (err) {
      console.error('[Diary] Failed to load entries:', err.message);

      // FIX 2: On error, show a message but NO fake demo entries.
      //         The UI must only ever reflect real DB data.
      DOM.entriesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚡</div>
          <p class="empty-state-text">Could not reach the server.<br>Make sure the backend is running.</p>
        </div>`;

      state.entries = [];
    }
  }

  // ─── Render sidebar ──────────────────────────
  function renderSidebar() {
    const query = state.searchQuery.toLowerCase().trim();
    let filtered = state.entries;

    if (query) {
      filtered = filtered.filter(e =>
        e.content.toLowerCase().includes(query) ||
        (e.title || '').toLowerCase().includes(query)
      );
    }
    if (state.filterMood) {
      filtered = filtered.filter(e => e.mood === state.filterMood);
    }
    if (state.filterTag) {
      filtered = filtered.filter(e => (e.tags || []).some(t => t.toLowerCase().includes(state.filterTag)));
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (state.sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (state.sortBy === 'longest') return (b.content || '').length - (a.content || '').length;
      return new Date(b.created_at) - new Date(a.created_at); // newest
    });
    // Pinned entries float to top (list view only)
    if (state.viewMode === 'list') {
      filtered = [...filtered.filter(e => e.is_pinned), ...filtered.filter(e => !e.is_pinned)];
    }

    // Update entry count
    if (DOM.entriesCount) {
      DOM.entriesCount.textContent = state.entries.length
        ? `${filtered.length} of ${state.entries.length} entr${state.entries.length === 1 ? 'y' : 'ies'}`
        : '';
    }

    if (filtered.length === 0) {
      DOM.entriesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${state.viewMode === 'trash' ? '🗑' : (query ? '🔍' : '📖')}</div>
          <p class="empty-state-text">${state.viewMode === 'trash' ? 'Trash is empty.' : (query ? 'No entries match your search.' : 'No entries yet.\nStart writing your first page.')}</p>
        </div>`;
      return;
    }

    // Group by month
    const groups = {};
    filtered.forEach(entry => {
      const key = UI.getMonthYear(entry.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    });

    DOM.entriesList.innerHTML = '';

    Object.entries(groups).forEach(([month, entries]) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'month-group';
      groupEl.innerHTML = `<div class="month-label">${month}</div>`;

      entries.forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = `entry-item${entry.id === state.activeId ? ' active' : ''}`;
        item.dataset.id = entry.id;
        item.style.animationDelay = `${idx * 40}ms`;

        const preview = UI.getPreview(entry.content);
        const badges = `${entry.is_pinned ? '📌 ' : ''}${entry.is_favorite ? '★ ' : ''}`;
        if (state.viewMode === 'trash') {
          item.innerHTML = `
            <div class="entry-item-date">${badges}${UI.formatDate(entry.created_at)} · ${UI.formatTime(entry.created_at)}</div>
            <div class="entry-item-preview">${highlight(preview, query)}</div>
            <div style="display:flex;gap:0.4rem;margin-top:0.35rem;">
              <button class="btn btn-ghost btn-sm restore-btn" data-id="${entry.id}">Restore</button>
              <button class="btn btn-danger btn-sm perm-delete-btn" data-id="${entry.id}">Delete forever</button>
            </div>`;
        } else {
          item.innerHTML = `
            <div class="entry-item-date">${badges}${UI.formatDate(entry.created_at)} · ${UI.formatTime(entry.created_at)}</div>
            <div class="entry-item-preview">${highlight(preview, query)}</div>
          `;
          item.addEventListener('click', () => openEntry(entry.id));
        }
        groupEl.appendChild(item);
      });

      DOM.entriesList.appendChild(groupEl);
    });

    if (state.viewMode === 'trash') {
      DOM.entriesList.querySelectorAll('.restore-btn').forEach(btn =>
        btn.addEventListener('click', e => { e.stopPropagation(); restoreEntry(btn.dataset.id); }));
      DOM.entriesList.querySelectorAll('.perm-delete-btn').forEach(btn =>
        btn.addEventListener('click', e => { e.stopPropagation(); permanentDelete(btn.dataset.id); }));
    }
  }

  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(query);
    return escaped.replace(new RegExp(`(${escapedQ})`, 'gi'), '<mark style="background:rgba(196,147,63,0.25);color:var(--ink-primary);border-radius:2px;">$1</mark>');
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ─── Open entry ──────────────────────────────
  function openEntry(id) {
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;

    // Save dirty state first
    if (state.isDirty && state.activeId) {
      autoSave(true); // silent
    }

    state.activeId = id;
    state.isNew = false;
    state.selectedMood = entry.mood || null;
    state.lastSavedContent = entry.content;
    state.isDirty = false;
    state.isPreview = false;

    // Update editor
    showEditor();
    DOM.editor.value = entry.content;
    DOM.editor.style.display = 'block';
    if (DOM.preview) DOM.preview.style.display = 'none';
    updateEditorDate(entry.created_at);
    updateWordCount();

    if (DOM.categorySelect) DOM.categorySelect.value = entry.category || '';
    state.currentTags = [...(entry.tags || [])];
    renderTagChips();
    updateFavPinButtons(entry.is_favorite, entry.is_pinned);

    // Mood
    if (DOM.moodBtns) {
      DOM.moodBtns.forEach(b => {
        b.classList.toggle('selected', b.dataset.mood === state.selectedMood);
      });
    }

    // Show delete button
    if (DOM.deleteBtn) {
      DOM.deleteBtn.style.display = 'flex';
    }
    if (DOM.favoriteBtn) DOM.favoriteBtn.style.display = 'flex';
    if (DOM.pinBtn) DOM.pinBtn.style.display = 'flex';
    if (DOM.previewBtn) DOM.previewBtn.style.display = 'flex';

    // Show footer delete button
    const deleteFooter = document.getElementById('delete-btn-footer');
    if (deleteFooter) deleteFooter.style.display = 'flex';

    // Update sidebar active state
    renderSidebar();

    // Scroll to top
    DOM.editorScroll?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── New entry ───────────────────────────────
  function newEntry() {
    if (state.isDirty && state.activeId) {
      autoSave(true);
    }

    state.activeId = null;
    state.isNew = true;
    state.selectedMood = null;
    state.lastSavedContent = '';
    state.isDirty = false;

    showEditor();
    DOM.editor.value = '';
    DOM.editor.style.display = 'block';
    if (DOM.preview) DOM.preview.style.display = 'none';
    state.isPreview = false;
    updateEditorDate(new Date().toISOString());
    updateWordCount();

    if (DOM.moodBtns) {
      DOM.moodBtns.forEach(b => b.classList.remove('selected'));
    }
    if (DOM.categorySelect) DOM.categorySelect.value = '';
    state.currentTags = [];
    renderTagChips();
    updateFavPinButtons(false, false);

    // Hide delete button for new (unsaved) entries
    if (DOM.deleteBtn) {
      DOM.deleteBtn.style.display = 'none';
    }
    const deleteFooter = document.getElementById('delete-btn-footer');
    if (deleteFooter) deleteFooter.style.display = 'none';
    if (DOM.favoriteBtn) DOM.favoriteBtn.style.display = 'none';
    if (DOM.pinBtn) DOM.pinBtn.style.display = 'none';
    if (DOM.previewBtn) DOM.previewBtn.style.display = 'flex';

    renderSidebar();
    DOM.editor.focus();
  }

  function showEditor() {
    if (DOM.welcomeScreen) DOM.welcomeScreen.style.display = 'none';
    if (DOM.editorWrap)    DOM.editorWrap.style.display = 'flex';
    DOM.editorWrap.classList.remove('editor-content-area');
    void DOM.editorWrap.offsetWidth;
    DOM.editorWrap.classList.add('editor-content-area');
  }

  function showWelcome() {
    if (DOM.editorWrap)    DOM.editorWrap.style.display = 'none';
    if (DOM.welcomeScreen) DOM.welcomeScreen.style.display = 'flex';
  }

  // ─── Save ────────────────────────────────────
  // FIX 3: Use API.createEntry / API.updateEntry (which use 'diary_token')
  //         instead of raw fetch calls that were looking for 'token' (wrong key).
  //         After save, re-fetch from backend so state always matches DB.
  async function saveActive(silent = false) {
    const content = DOM.editor?.value?.trim();
    if (!content) {
      if (!silent) UI.showToast('Write something first.', 'info');
      return;
    }

    showAutosave('saving');

    const tags = state.currentTags.slice();
    const category = DOM.categorySelect?.value || null;

    try {
      let saved;

      if (state.isNew || !state.activeId) {
        // CREATE
        console.log('[Diary] Creating new entry…');
        const data = await API.createEntry({ content, mood: state.selectedMood, tags, category });
        console.log('[Diary] Create response:', data);

        saved = data.entry || data;

        state.isNew = false;
        state.activeId = saved.id;

        // FIX 4: Re-fetch all entries from backend after create so sidebar
        //         is always an accurate reflection of the database.
        await loadEntries();
        loadStreak();
        if (DOM.favoriteBtn) DOM.favoriteBtn.style.display = 'flex';
        if (DOM.pinBtn) DOM.pinBtn.style.display = 'flex';

        if (!silent) UI.showToast('Entry saved.', 'success');

      } else {
        // UPDATE
        console.log(`[Diary] Updating entry ${state.activeId}…`);
        const data = await API.updateEntry(state.activeId, { content, mood: state.selectedMood, tags, category });
        console.log('[Diary] Update response:', data);

        saved = data.entry || data;

        // Update local state immediately for a snappy UI
        const idx = state.entries.findIndex(e => e.id === state.activeId);
        if (idx > -1) {
          state.entries[idx] = { ...state.entries[idx], ...saved, content };
        }

        if (!silent) UI.showToast('Changes saved.', 'success');
        renderSidebar();
      }

      state.lastSavedContent = content;
      state.isDirty = false;
      showAutosave('saved');

    } catch (err) {
      console.error('[Diary] Save failed:', err.message);
      showAutosave(null);
      if (!silent) UI.showToast(err.message || 'Save failed.', 'error');
    }
  }

  // ─── Auto-save ───────────────────────────────
  function scheduleAutoSave() {
    clearTimeout(state.autoSaveTimeout);
    state.autoSaveTimeout = setTimeout(() => {
      if (state.isDirty) autoSave(true);
    }, 5000);
  }

  async function autoSave(silent = true) {
    const content = DOM.editor?.value?.trim();
    if (!state.isDirty || !content || content === state.lastSavedContent) return;
    await saveActive(silent);
  }

  // ─── Delete ──────────────────────────────────
  function confirmDelete() {
    if (!state.activeId) return;
    UI.showConfirm({
      title: 'Delete this entry?',
      body: 'This action is permanent and cannot be undone.',
      confirmText: 'Delete',
      onConfirm: deleteActive
    });
  }

  // FIX 5: Use API.deleteEntry (which uses 'diary_token') instead of raw
  //         fetch with 'token'. Re-fetch from backend after deletion.
  async function deleteActive() {
    if (!state.activeId) return;
    const id = state.activeId;

    try {
      console.log(`[Diary] Deleting entry ${id}…`);
      await API.deleteEntry(id);
      console.log('[Diary] Entry deleted successfully');

      state.activeId = null;
      state.isNew = false;
      state.isDirty = false;

      // Re-fetch to sync with DB
      await loadEntries();

      showWelcome();
      UI.showToast('Entry deleted.', 'success');

    } catch (err) {
      console.error('[Diary] Delete failed:', err.message);
      UI.showToast(err.message || 'Delete failed.', 'error');
    }
  }

  // ─── Search ──────────────────────────────────
  function onSearch(e) {
    state.searchQuery = e.target.value;
    renderSidebar();
  }

  // ─── Editor events ───────────────────────────
  function onEditorInput() {
    state.isDirty = true;
    updateWordCount();
    scheduleAutoSave();
  }

  function onEditorKeydown(e) {
    // Tab = 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = DOM.editor.selectionStart;
      const end   = DOM.editor.selectionEnd;
      DOM.editor.value = DOM.editor.value.slice(0, start) + '  ' + DOM.editor.value.slice(end);
      DOM.editor.selectionStart = DOM.editor.selectionEnd = start + 2;
    }
  }

  function updateWordCount() {
    if (!DOM.wordCountEl || !DOM.editor) return;
    const wc = UI.wordCount(DOM.editor.value);
    DOM.wordCountEl.textContent = `${wc} word${wc !== 1 ? 's' : ''}`;
    if (DOM.readingTimeEl) {
      const mins = Math.max(1, Math.round(wc / 200));
      DOM.readingTimeEl.textContent = `${mins} min read`;
      DOM.readingTimeEl.style.display = wc > 0 ? 'block' : 'none';
    }
  }

  function updateEditorDate(dateStr) {
    if (DOM.editorDate) {
      DOM.editorDate.textContent = UI.formatDate(dateStr).toUpperCase();
    }
  }

  // ─── Autosave indicator ──────────────────────
  let autosaveTimer;
  function showAutosave(state_) {
    const el = DOM.autosaveEl;
    if (!el) return;
    clearTimeout(autosaveTimer);

    el.className = 'autosave-indicator';

    if (state_ === 'saving') {
      el.classList.add('visible', 'saving');
      if (DOM.autosaveText) DOM.autosaveText.textContent = 'Saving…';
    } else if (state_ === 'saved') {
      el.classList.add('visible', 'saved');
      const t = UI.formatTime(new Date().toISOString());
      if (DOM.autosaveText) DOM.autosaveText.textContent = `Saved at ${t}`;
      autosaveTimer = setTimeout(() => el.classList.remove('visible'), 3000);
    } else {
      el.classList.remove('visible', 'saving', 'saved');
    }
  }

  // ─── Favorite / Pin ──────────────────────────
  function updateFavPinButtons(isFav, isPinned) {
    if (DOM.favoriteBtn) {
      DOM.favoriteBtn.textContent = isFav ? '★' : '☆';
      DOM.favoriteBtn.classList.toggle('selected', !!isFav);
    }
    if (DOM.pinBtn) {
      DOM.pinBtn.classList.toggle('selected', !!isPinned);
    }
  }

  // ─── Tags widget (chip input + # suggestions) ──
  
  const availableTags = COMMON_TAGS;

  function renderTagChips() {
    if (!DOM.tagsChips) return;
    DOM.tagsChips.innerHTML = state.currentTags.map((t, i) => `
      <span class="tag-chip">#${escapeHtml(t)}<button type="button" class="tag-chip-remove" data-i="${i}" aria-label="Remove tag ${escapeHtml(t)}">×</button></span>
    `).join('');
  }

  function addTag(raw) {
    const clean = raw.trim().replace(/^#+/, '').toLowerCase();
    if (!clean) return;
    if (!state.currentTags.includes(clean)) {
      state.currentTags.push(clean);
      renderTagChips();
      state.isDirty = true;
      scheduleAutoSave();
    }
    if (DOM.tagsInput) DOM.tagsInput.value = '';
    hideTagSuggestions();
  }

  function removeTagAt(i) {
    state.currentTags.splice(i, 1);
    renderTagChips();
    state.isDirty = true;
    scheduleAutoSave();
  }

  function showTagSuggestions(query) {
    if (!DOM.tagsSuggest) return;
    const q = query.toLowerCase().replace(/^#+/, '');
    const matches = COMMON_TAGS.filter(t => t.startsWith(q) && !state.currentTags.includes(t)).slice(0, 8);
    if (!matches.length) { hideTagSuggestions(); return; }
    DOM.tagsSuggest.innerHTML = matches.map(t => `<div class="tag-suggest-item" role="option" data-tag="${t}">#${t}</div>`).join('');
    DOM.tagsSuggest.style.display = 'block';
  }

  function hideTagSuggestions() {
    if (DOM.tagsSuggest) DOM.tagsSuggest.style.display = 'none';
  }

  function initTagsWidget() {
    if (!DOM.tagsInput) return;

    // Typing "#" (or anything) shows matching suggestions; typing a space,
    // comma, or Enter commits the current text as a tag chip — no need to
    // type a comma to separate tags.
    DOM.tagsInput.addEventListener('input', () => {
      const val = DOM.tagsInput.value;
      if (/[\s,]$/.test(val)) {
        addTag(val.slice(0, -1));
        return;
      }
      if (val.trim()) {
        showTagSuggestions(val);
      } else {
        hideTagSuggestions();
      }
    });

    DOM.tagsInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag(DOM.tagsInput.value);
      } else if (e.key === 'Backspace' && !DOM.tagsInput.value && state.currentTags.length) {
        removeTagAt(state.currentTags.length - 1);
      }
    });

    DOM.tagsInput.addEventListener('focus', () => {
      if (DOM.tagsInput.value.trim()) showTagSuggestions(DOM.tagsInput.value);
    });

    DOM.tagsInput.addEventListener('blur', () => {
      // Commit whatever's left so a typed-but-unsubmitted tag isn't lost,
      // but delay so a suggestion click (which also blurs) can land first.
      setTimeout(() => {
        if (document.activeElement !== DOM.tagsInput) {
          if (DOM.tagsInput.value.trim()) addTag(DOM.tagsInput.value);
          hideTagSuggestions();
        }
      }, 150);
    });

    if (DOM.tagsSuggest) {
      DOM.tagsSuggest.addEventListener('mousedown', e => {
        const item = e.target.closest('.tag-suggest-item');
        if (item) {
          e.preventDefault(); // keep focus on the text input
          addTag(item.dataset.tag);
          DOM.tagsInput.focus();
        }
      });
    }

    if (DOM.tagsChips) {
      DOM.tagsChips.addEventListener('click', e => {
        const btn = e.target.closest('.tag-chip-remove');
        if (btn) removeTagAt(Number(btn.dataset.i));
      });
    }

    if (DOM.tagsField) {
      DOM.tagsField.addEventListener('click', e => {
        if (e.target === DOM.tagsField || e.target === DOM.tagsChips) {
          DOM.tagsInput.focus();
        }
      });
    }
  }

  async function toggleFavorite() {
    if (!state.activeId) return;
    const entry = state.entries.find(e => e.id === state.activeId);
    if (!entry) return;
    const next = !entry.is_favorite;
    try {
      await API.updateEntry(state.activeId, { content: entry.content, mood: entry.mood, tags: entry.tags, category: entry.category, is_favorite: next });
      entry.is_favorite = next;
      updateFavPinButtons(entry.is_favorite, entry.is_pinned);
      UI.showToast(next ? 'Added to favorites.' : 'Removed from favorites.', 'success');
    } catch (err) {
      UI.showToast(err.message || 'Failed to update favorite.', 'error');
    }
  }

  async function togglePin() {
    if (!state.activeId) return;
    const entry = state.entries.find(e => e.id === state.activeId);
    if (!entry) return;
    const next = !entry.is_pinned;
    try {
      await API.updateEntry(state.activeId, { content: entry.content, mood: entry.mood, tags: entry.tags, category: entry.category, is_pinned: next });
      entry.is_pinned = next;
      updateFavPinButtons(entry.is_favorite, entry.is_pinned);
      renderSidebar();
      UI.showToast(next ? 'Entry pinned.' : 'Entry unpinned.', 'success');
    } catch (err) {
      UI.showToast(err.message || 'Failed to update pin.', 'error');
    }
  }

  // ─── Markdown preview ────────────────────────
  function renderMarkdown(src) {
    let html = escapeHtml(src);
    html = html
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/\n/g, '<br>');
    return html.replace(/(<li>.*<\/li>)(<br>)?/g, m => m).replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  }

  function togglePreview() {
    if (!DOM.editor || !DOM.preview) return;
    state.isPreview = !state.isPreview;
    if (state.isPreview) {
      DOM.preview.innerHTML = renderMarkdown(DOM.editor.value || '');
      DOM.editor.style.display = 'none';
      DOM.preview.style.display = 'block';
      DOM.previewBtn.textContent = 'Edit';
    } else {
      DOM.editor.style.display = 'block';
      DOM.preview.style.display = 'none';
      DOM.previewBtn.textContent = 'Preview';
    }
  }

  // ─── Trash ────────────────────────────────────
  async function toggleTrashView() {
    state.viewMode = state.viewMode === 'trash' ? 'list' : 'trash';
    if (DOM.trashBtn) DOM.trashBtn.textContent = state.viewMode === 'trash' ? '📖 Entries' : '🗑 Trash';
    if (state.viewMode === 'trash') {
      await loadTrash();
    } else {
      await loadEntries();
    }
  }

  async function loadTrash() {
    UI.renderSkeletons(DOM.entriesList);
    try {
      const data = await API.getTrash();
      state.entries = data.entries || [];
      renderSidebar();
    } catch (err) {
      UI.showToast(err.message || 'Failed to load trash.', 'error');
    }
  }

  async function restoreEntry(id) {
    try {
      await API.restoreEntry(id);
      UI.showToast('Entry restored.', 'success');
      await loadTrash();
    } catch (err) {
      UI.showToast(err.message || 'Restore failed.', 'error');
    }
  }

  function permanentDelete(id) {
    UI.showConfirm({
      title: 'Delete forever?',
      body: 'This entry will be permanently removed and cannot be recovered.',
      confirmText: 'Delete forever',
      onConfirm: async () => {
        try {
          await API.permanentDeleteEntry(id);
          UI.showToast('Entry permanently deleted.', 'success');
          await loadTrash();
        } catch (err) {
          UI.showToast(err.message || 'Delete failed.', 'error');
        }
      }
    });
  }

  // ─── Streak ───────────────────────────────────
  async function loadStreak() {
    if (!DOM.streakBadge) return;
    try {
      const stats = await API.getStats();
      if (stats.streak > 0) {
        DOM.streakBadge.textContent = `🔥 ${stats.streak} day${stats.streak !== 1 ? 's' : ''} streak`;
        DOM.streakBadge.style.display = 'block';
      } else {
        DOM.streakBadge.style.display = 'none';
      }
    } catch (err) {
      console.warn('[Diary] Could not load streak:', err.message);
    }
  }

  // ─── Export (vintage PDF book) ─────────────────
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function buildBookHTML(entries, username) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position: absolute; left: -99999px; top: 0;
      width: 794px;
      background: linear-gradient(180deg, #f8f0dd 0%, #f1e6cd 100%);
      box-shadow: inset 0 0 90px rgba(90,64,32,0.28);
      padding: 70px 76px 90px;
      font-family: 'Crimson Pro', Georgia, serif;
      color: #3b2a1a;
    `;

    const sorted = [...entries].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    const today = new Date().toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    let html = `
      <div style="text-align:center; padding-bottom:56px; margin-bottom:56px; border-bottom: 1px solid rgba(90,64,32,0.25);">
        <div style="font-family:'Cormorant Garamond', Georgia, serif; font-style:italic; font-size:16px; letter-spacing:3px; color:#8a6a3f; margin-bottom:14px;">❦ ❦ ❦</div>
        <h1 style="font-family:'Cormorant Garamond', Georgia, serif; font-weight:600; font-size:46px; margin:0 0 10px;">The Diary of ${escapeHtml(username || 'Folio')}</h1>
        <div style="font-style:italic; font-size:15px; color:#7a6248;">A collection of thoughts &amp; reflections</div>
        <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#9a8362; margin-top:22px;">Compiled ${today}</div>
      </div>
    `;

    sorted.forEach((entry, i) => {
      const dateLine = `${UI.formatDate(entry.created_at)} · ${UI.formatTime(entry.created_at)}`;
      const title = entry.title ? escapeHtml(entry.title) : 'Untitled';
      const moodTag = entry.mood
        ? `<span style="font-style:italic; color:#8a6a3f;">feeling ${escapeHtml(entry.mood)}</span>`
        : '';
      const tags = (entry.tags || []).length
        ? `<span style="color:#9a8362;"> · ${entry.tags.map(t => escapeHtml(t)).join(', ')}</span>`
        : '';
      const bodyHtml = renderMarkdown(entry.content || '');

      html += `
        <div style="margin-bottom:52px; ${i > 0 ? 'padding-top:46px; border-top:1px solid rgba(90,64,32,0.18);' : ''}">
          <div style="font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#9a8362; margin-bottom:6px;">
            ${dateLine}
          </div>
          <h2 style="font-family:'Cormorant Garamond', Georgia, serif; font-weight:600; font-size:30px; margin:0 0 6px; color:#2e2013;">
            ${title}
          </h2>
          <div style="font-size:13px; margin-bottom:18px;">${moodTag}${tags}</div>
          <div class="book-entry-body" style="font-size:16.5px; line-height:1.85; text-align:justify;">
            ${bodyHtml}
          </div>
        </div>
      `;
    });

    html += `
      <div style="text-align:center; margin-top:40px; font-family:'Cormorant Garamond', Georgia, serif; font-style:italic; font-size:15px; color:#8a6a3f;">
        ❦ End of volume ❦
      </div>
    `;

    wrap.innerHTML = html;

    // Drop cap on the first letter of every entry's opening paragraph
    wrap.querySelectorAll('.book-entry-body').forEach(body => {
      const firstP = body.querySelector('p') || body;
      const text = firstP.innerHTML;
      const match = text.match(/^([\s\S]{0,3}?)([A-Za-z])/);
      if (match) {
        const dropCap = `<span style="float:left; font-family:'Cormorant Garamond', Georgia, serif; font-size:58px; line-height:44px; padding:4px 8px 0 0; color:#6b4a26;">${match[2]}</span>`;
        firstP.innerHTML = text.replace(match[0], match[1] + dropCap) ;
        // remove the plain letter we duplicated into the drop cap
        firstP.innerHTML = firstP.innerHTML.replace(match[2] + match[2], match[2]);
      }
    });

    return wrap;
  }

  async function exportPDF() {
    if (!state.entries.length) {
      UI.showToast('No entries to export yet.', 'info');
      return;
    }

    UI.showToast('Binding your book…', 'info');

    try {
      await Promise.all([
        loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
        loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
      ]);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;

      const user = await Auth.getUser();
      const book = buildBookHTML(state.entries, user ? user.username : 'Folio');
      document.body.appendChild(book);

      const canvas = await window.html2canvas(book, {
        scale: 2,
        backgroundColor: '#f4ecd8',
        useCORS: true,
        windowWidth: book.scrollWidth
      });
      book.remove();

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`folio-diary-${new Date().toISOString().slice(0, 10)}.pdf`);
      UI.showToast('Your diary book is ready.', 'success');
    } catch (err) {
      console.error('[Diary] PDF export failed:', err.message);
      UI.showToast('Could not create the PDF export.', 'error');
    }
  }

  // ─── Public ─────────────────────────────────
  return { init };
})();