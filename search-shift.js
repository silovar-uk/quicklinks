(() => {
  'use strict';

  const PANEL_ID = 'searchShiftPanel';
  const MAX_RESULTS_PER_KIND = 20;
  const searchInput = $('globalSearch');
  const clearButton = $('clearSearchBtn');
  const main = document.querySelector('main');
  const tabs = document.querySelector('.tabs');
  const topRow = document.querySelector('.top-row');
  const fab = $('fabBtn');
  const basePanels = ['linksPanel', 'promptsPanel', 'settingsPanel'].map(id => $(id)).filter(Boolean);

  if (!searchInput || !main) return;

  function ensurePanel() {
    let panel = $(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'panel';
    panel.setAttribute('aria-label', '検索結果');
    main.insertBefore(panel, main.firstChild);
    return panel;
  }

  function queryValue() {
    return normalizeString(state.query || searchInput.value || '');
  }

  function includesQuery(value, q) {
    return normalizeString(value).includes(q);
  }

  function relevanceScore(values, q) {
    const [title = '', secondary = '', detail = ''] = values.map(normalizeString);
    let score = 0;
    if (title === q) score += 120;
    else if (title.startsWith(q)) score += 90;
    else if (title.includes(q)) score += 65;
    if (secondary === q) score += 45;
    else if (secondary.includes(q)) score += 30;
    if (detail.includes(q)) score += 15;
    return score;
  }

  function searchLinks(q) {
    return state.items
      .filter(item => !item.archived)
      .filter(item => [item.title, item.url, item.note, item.projectName].some(value => includesQuery(value, q)))
      .map(item => ({
        item,
        score: relevanceScore([item.title, item.projectName, `${item.url} ${item.note}`], q),
        recent: timeValue(item.lastClickedAt || item.updatedAt || item.addedAt)
      }))
      .sort((a, b) => b.score - a.score || b.recent - a.recent)
      .map(entry => entry.item);
  }

  function searchPrompts(q) {
    return state.promptMemos
      .filter(memo => [memo.title, memo.body, memo.categoryName].some(value => includesQuery(value, q)))
      .map(memo => ({
        memo,
        score: relevanceScore([memo.title, memo.categoryName, memo.body], q),
        recent: timeValue(memo.lastCopiedAt || memo.updatedAt || memo.createdAt)
      }))
      .sort((a, b) => b.score - a.score || b.recent - a.recent)
      .map(entry => entry.memo);
  }

  function resultFooter(total) {
    if (total <= MAX_RESULTS_PER_KIND) return '';
    return `<div class="pager-info" style="padding:8px 2px 2px;">上位${MAX_RESULTS_PER_KIND}件を表示 · 他${(total - MAX_RESULTS_PER_KIND).toLocaleString()}件</div>`;
  }

  function linkRow(item) {
    const icon = window.QuickLinksPrecisionUI?.icons?.link || '↗';
    return `
      <article class="simple-row" data-search-kind="link" data-search-id="${escapeHtml(item.id)}">
        <span class="select-mode-badge" aria-hidden="true">${icon}</span>
        <div class="simple-main">
          <div class="simple-title">${highlight(item.title || '無題')}</div>
          <div class="simple-sub">
            <span>${escapeHtml(item.projectName || '未分類')}</span>
            <span class="simple-url">${highlight(item.url || '')}</span>
          </div>
        </div>
        <div class="simple-actions">
          <button class="btn primary" type="button" data-search-action="open">開く</button>
          <button class="btn ghost" type="button" data-search-action="copy-link">URL</button>
          <button class="btn ghost" type="button" data-search-action="edit-link">編集</button>
        </div>
      </article>`;
  }

  function promptRow(memo) {
    const icon = window.QuickLinksPrecisionUI?.icons?.prompt || '✎';
    return `
      <article class="simple-row" data-search-kind="prompt" data-search-id="${escapeHtml(memo.id)}">
        <span class="select-mode-badge" aria-hidden="true">${icon}</span>
        <div class="simple-main">
          <div class="simple-title">${highlight(memo.title || '無題のプロンプト')}</div>
          <div class="simple-sub">
            <span>${escapeHtml(memo.categoryName || '未分類')}</span>
            <span>${Number(memo.copyCount || 0).toLocaleString()}回使用</span>
          </div>
        </div>
        <div class="simple-actions">
          <button class="btn primary" type="button" data-search-action="copy-prompt">コピー</button>
          <button class="btn ghost" type="button" data-search-action="preview-prompt">内容</button>
          <button class="btn ghost" type="button" data-search-action="edit-prompt">編集</button>
        </div>
      </article>`;
  }

  function group(title, total, rows) {
    if (!total) return '';
    return `
      <section aria-label="${title}の検索結果" style="margin-bottom:14px;">
        <div class="toolbar">
          <div class="toolbar-title">${title} · ${total.toLocaleString()}件</div>
        </div>
        <div class="list simple">${rows.join('')}</div>
        ${resultFooter(total)}
      </section>`;
  }

  function renderSearchResults() {
    const panel = ensurePanel();
    const q = queryValue();
    if (!q) {
      panel.innerHTML = '';
      return;
    }

    const links = searchLinks(q);
    const prompts = searchPrompts(q);
    const visibleLinks = links.slice(0, MAX_RESULTS_PER_KIND);
    const visiblePrompts = prompts.slice(0, MAX_RESULTS_PER_KIND);

    panel.innerHTML = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:2px 1px 8px;border-bottom:1px solid var(--line);">
        <div>
          <div class="prompt-reuse-title" style="margin-bottom:3px;">SEARCH RESULTS</div>
          <div class="toolbar-title">「${escapeHtml(state.query || searchInput.value)}」</div>
        </div>
        <div class="pager-info" role="status" aria-live="polite">${(links.length + prompts.length).toLocaleString()}件</div>
      </div>
      ${links.length || prompts.length ? `${group('LINKS', links.length, visibleLinks.map(linkRow))}${group('PROMPTS', prompts.length, visiblePrompts.map(promptRow))}` : `
        <div class="empty">
          <div class="empty-title">見つかりませんでした</div>
          <div>別の言葉で検索してみてください。</div>
        </div>`}`;

    panel.querySelectorAll('[data-search-kind][data-search-id]').forEach(row => {
      const kind = row.dataset.searchKind;
      const id = row.dataset.searchId;
      row.querySelectorAll('[data-search-action]').forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          const action = button.dataset.searchAction;
          if (kind === 'link') {
            const item = state.items.find(entry => entry.id === id);
            if (!item) return;
            if (action === 'open') return handleLinkAction(id, 'open');
            if (action === 'copy-link') return handleLinkAction(id, 'copy');
            if (action === 'edit-link') return openLinkModal(item);
          }
          if (kind === 'prompt') {
            const memo = state.promptMemos.find(entry => entry.id === id);
            if (!memo) return;
            if (action === 'copy-prompt') return copyPrompt(id);
            if (action === 'preview-prompt') {
              if (window.QuickLinksRediscoveryUI?.openPreview) return window.QuickLinksRediscoveryUI.openPreview(id);
              return openPromptModal(memo);
            }
            if (action === 'edit-prompt') return openPromptModal(memo);
          }
        });
      });
    });
  }

  function setSearchMode(active) {
    const panel = ensurePanel();
    document.body.classList.toggle('search-shift-active', active);
    panel.classList.toggle('active', active);
    panel.style.display = active ? 'block' : '';
    basePanels.forEach(basePanel => { basePanel.style.display = active ? 'none' : ''; });
    if (tabs) tabs.style.display = active ? 'none' : '';
    if (topRow) topRow.style.display = active ? 'none' : '';
    if (fab) fab.style.display = active ? 'none' : '';
    if (active) renderSearchResults();
    else panel.innerHTML = '';
  }

  function syncSearchShift() {
    const active = Boolean(queryValue());
    setSearchMode(active);
  }

  function clearSearchAndExit({ blur = false } = {}) {
    state.query = '';
    searchInput.value = '';
    state.linkPage = 1;
    state.promptPage = 1;
    save();
    render();
    setSearchMode(false);
    if (blur) searchInput.blur();
  }

  const baseRender = render;
  render = function() {
    baseRender();
    queueMicrotask(syncSearchShift);
  };

  searchInput.addEventListener('input', () => queueMicrotask(syncSearchShift));
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearchAndExit({ blur: true });
      return;
    }
    if (event.key === 'Enter' && !event.isComposing && queryValue()) {
      const firstPrimary = ensurePanel().querySelector('[data-search-action="open"], [data-search-action="copy-prompt"]');
      if (firstPrimary) {
        event.preventDefault();
        firstPrimary.click();
      }
    }
  });

  clearButton?.addEventListener('click', () => queueMicrotask(syncSearchShift));
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(syncSearchShift));
  });

  syncSearchShift();
  window.QuickLinksSearchShift = { sync: syncSearchShift, render: renderSearchResults };
})();
