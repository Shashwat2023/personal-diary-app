/* =============================================
   PERSONAL DIARY — DIARY.JS
   Entry CRUD, autosave, search, rendering
   ============================================= */

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
    isDirty: false
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
    };
  }

  // ─── Initialize ─────────────────────────────
  async function init() {
    bindDOM();
    UI.initCursor();
    UI.initRipples();

    // Populate user info
    const user = Auth.getUser();
    if (user) {
      if (DOM.userNameEl) DOM.userNameEl.textContent = user.username || user.email;
      if (DOM.userAvatarEl) DOM.userAvatarEl.textContent = (user.username || user.email || '?')[0].toUpperCase();
    }

    // Sticky header
    UI.initStickyHeader(DOM.editorHeader, DOM.editorScroll);

    // Live clock
    UI.startLiveClock(DOM.liveTime);

    // Load entries from backend
    await loadEntries();

    // Events
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
        e.content.toLowerCase().includes(query)
      );
    }

    // Update entry count
    if (DOM.entriesCount) {
      DOM.entriesCount.textContent = state.entries.length
        ? `${state.entries.length} entr${state.entries.length === 1 ? 'y' : 'ies'}`
        : '';
    }

    if (filtered.length === 0) {
      DOM.entriesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${query ? '🔍' : '📖'}</div>
          <p class="empty-state-text">${query ? 'No entries match your search.' : 'No entries yet.\nStart writing your first page.'}</p>
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
        item.innerHTML = `
          <div class="entry-item-date">${UI.formatDate(entry.created_at)} · ${UI.formatTime(entry.created_at)}</div>
          <div class="entry-item-preview">${highlight(preview, query)}</div>
        `;
        item.addEventListener('click', () => openEntry(entry.id));
        groupEl.appendChild(item);
      });

      DOM.entriesList.appendChild(groupEl);
    });
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

    // Update editor
    showEditor();
    DOM.editor.value = entry.content;
    updateEditorDate(entry.created_at);
    updateWordCount();

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
    updateEditorDate(new Date().toISOString());
    updateWordCount();

    if (DOM.moodBtns) {
      DOM.moodBtns.forEach(b => b.classList.remove('selected'));
    }

    // Hide delete button for new (unsaved) entries
    if (DOM.deleteBtn) {
      DOM.deleteBtn.style.display = 'none';
    }
    const deleteFooter = document.getElementById('delete-btn-footer');
    if (deleteFooter) deleteFooter.style.display = 'none';

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

    try {
      let saved;

      if (state.isNew || !state.activeId) {
        // CREATE
        console.log('[Diary] Creating new entry…');
        const data = await API.createEntry({ content, mood: state.selectedMood });
        console.log('[Diary] Create response:', data);

        saved = data.entry || data;

        state.isNew = false;
        state.activeId = saved.id;

        // FIX 4: Re-fetch all entries from backend after create so sidebar
        //         is always an accurate reflection of the database.
        await loadEntries();

        if (!silent) UI.showToast('Entry saved.', 'success');

      } else {
        // UPDATE
        console.log(`[Diary] Updating entry ${state.activeId}…`);
        const data = await API.updateEntry(state.activeId, { content, mood: state.selectedMood });
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

  // ─── Public ─────────────────────────────────
  return { init };
})();