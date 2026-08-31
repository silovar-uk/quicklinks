(() => {
  'use strict';

  const SNACKBAR_ID = 'quickLinksUndoSnackbar';
  const STYLE_ID = 'quickLinksRecoveryStyles';
  const UNDO_MS = 5000;
  let pendingDelete = null;
  let pendingTimer = null;

  function ensureStyles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .quick-undo-snackbar {
        position: fixed;
        left: 50%;
        bottom: calc(78px + var(--safe-bottom));
        z-index: 120;
        width: min(420px, calc(100% - 24px));
        min-height: 48px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 8px 8px 8px 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #242421;
        color: #fff;
        box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
        transform: translateX(-50%);
      }

      .quick-undo-snackbar[hidden] { display: none !important; }

      .quick-undo-message {
        min-width: 0;
        font-size: 12px;
        line-height: 1.4;
        font-weight: 600;
      }

      .quick-undo-button {
        min-width: 92px;
        min-height: 36px;
        border: 0;
        border-radius: 10px;
        padding: 7px 11px;
        background: #fff;
        color: #242421;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      .quick-undo-button:focus-visible {
        outline: 3px solid var(--focus-ring, #f5b7bd);
        outline-offset: 2px;
      }

      @media (min-width: 720px) {
        .quick-undo-snackbar { bottom: 24px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .quick-undo-snackbar { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureSnackbar() {
    let snackbar = $(SNACKBAR_ID);
    if (snackbar) return snackbar;

    snackbar = document.createElement('div');
    snackbar.id = SNACKBAR_ID;
    snackbar.className = 'quick-undo-snackbar';
    snackbar.hidden = true;
    snackbar.setAttribute('role', 'status');
    snackbar.setAttribute('aria-live', 'polite');
    snackbar.setAttribute('aria-atomic', 'true');
    snackbar.innerHTML = `
      <span class="quick-undo-message" id="quickUndoMessage">削除しました</span>
      <button class="quick-undo-button" id="quickUndoButton" type="button">元に戻す</button>`;
    document.body.appendChild(snackbar);
    $('quickUndoButton').addEventListener('click', undoPendingDelete);
    return snackbar;
  }

  function visibleRows(kind) {
    const selector = kind === 'link' ? '#linksList [data-id]' : '#promptsList [data-id]';
    return [...document.querySelectorAll(selector)];
  }

  function visualIndexFor(kind, id) {
    const rows = visibleRows(kind);
    const index = rows.findIndex(row => row.dataset.id === id);
    return index < 0 ? 0 : index;
  }

  function primaryActionFor(row, kind) {
    if (!row || row.offsetParent === null) return null;
    const primary = kind === 'link'
      ? row.querySelector('[data-action="open"], button:not([disabled])')
      : row.querySelector('[data-action="copy-prompt"], button:not([disabled])');
    return primary && primary.offsetParent !== null ? primary : null;
  }

  function focusCurrentContext(kind, preferredId = null, visualIndex = 0) {
    requestAnimationFrame(() => {
      if (document.body.classList.contains('search-shift-active')) {
        $('globalSearch')?.focus?.({ preventScroll: true });
        return;
      }

      const activeTab = state.activeTab || document.querySelector('.tab-btn.active')?.dataset.tab;
      const matchingTab = (kind === 'link' && activeTab === 'links') || (kind === 'prompt' && activeTab === 'prompts');
      if (matchingTab) {
        const rows = visibleRows(kind);
        const row = preferredId
          ? rows.find(element => element.dataset.id === preferredId)
          : rows[Math.min(visualIndex, Math.max(rows.length - 1, 0))];
        const primary = primaryActionFor(row, kind);
        if (primary) {
          primary.focus({ preventScroll: true });
          return;
        }
        const toolbar = kind === 'link' ? $('linkSortSelect') : $('promptSortSelect');
        if (toolbar && toolbar.offsetParent !== null) {
          toolbar.focus({ preventScroll: true });
          return;
        }
      }

      document.querySelector('.tab-btn.active')?.focus?.({ preventScroll: true });
    });
  }

  function hideSnackbar() {
    const snackbar = $(SNACKBAR_ID);
    if (snackbar) snackbar.hidden = true;
  }

  function commitPendingDelete() {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingDelete = null;
    hideSnackbar();
  }

  function showUndo(kind, item, originalIndex) {
    commitPendingDelete();
    pendingDelete = {
      kind,
      item,
      originalIndex,
      deletedAt: Date.now()
    };

    const snackbar = ensureSnackbar();
    $('quickUndoMessage').textContent = kind === 'link' ? 'リンクを削除しました' : 'プロンプトを削除しました';
    snackbar.hidden = false;
    pendingTimer = setTimeout(commitPendingDelete, UNDO_MS);
  }

  function deleteLinkWithUndo(id) {
    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;
    const item = state.items[index];
    const visualIndex = visualIndexFor('link', id);

    if (pendingDelete) commitPendingDelete();
    state.items.splice(index, 1);
    save();
    render();
    showUndo('link', item, index);
    focusCurrentContext('link', null, visualIndex);
  }

  function deletePromptWithUndo(id) {
    const index = state.promptMemos.findIndex(memo => memo.id === id);
    if (index < 0) return;
    const memo = state.promptMemos[index];
    const visualIndex = visualIndexFor('prompt', id);

    if (pendingDelete) commitPendingDelete();
    state.promptMemos.splice(index, 1);
    state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
    save();
    render();
    showUndo('prompt', memo, index);
    focusCurrentContext('prompt', null, visualIndex);
  }

  function undoPendingDelete() {
    const pending = pendingDelete;
    if (!pending) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingDelete = null;
    hideSnackbar();

    if (pending.kind === 'link') {
      if (!state.items.some(item => item.id === pending.item.id)) {
        const index = Math.min(Math.max(pending.originalIndex, 0), state.items.length);
        state.items.splice(index, 0, pending.item);
      }
    } else {
      if (!state.promptMemos.some(memo => memo.id === pending.item.id)) {
        const index = Math.min(Math.max(pending.originalIndex, 0), state.promptMemos.length);
        state.promptMemos.splice(index, 0, pending.item);
        state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
      }
    }

    save();
    render();
    toast('元に戻しました');
    focusCurrentContext(pending.kind, pending.item.id);
  }

  ensureStyles();
  ensureSnackbar();

  if (window.QuickLinksPrecisionData) {
    window.QuickLinksPrecisionData.deleteLink = deleteLinkWithUndo;
  }
  deletePrompt = deletePromptWithUndo;

  window.QuickLinksRecovery = {
    deleteLink: deleteLinkWithUndo,
    deletePrompt: deletePromptWithUndo,
    undo: undoPendingDelete,
    commit: commitPendingDelete,
    hasPending: () => Boolean(pendingDelete),
    undoWindowMs: UNDO_MS
  };
})();
