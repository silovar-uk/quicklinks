(() => {
  'use strict';

  // Functional UI icons share one 24x24 coordinate system so alignment does not depend on font glyphs or emoji rendering.
  const ICONS = Object.freeze({
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.4 13.6a4 4 0 0 0 5.7.1l2-2a4 4 0 1 0-5.7-5.7l-1.2 1.2M13.6 10.4a4 4 0 0 0-5.7-.1l-2 2a4 4 0 1 0 5.7 5.7l1.2-1.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    prompt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h4l10-10-4-4L5 15v4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>'
  });

  function setIconButton(button, icon, label) {
    if (!button || !icon) return;
    button.innerHTML = icon;
    if (label) button.setAttribute('aria-label', label);
    button.removeAttribute('title');
  }

  function decorateHeaderAndNav() {
    document.title = 'Quick Links';
    const title = document.querySelector('.brand-title');
    if (title) title.textContent = 'Quick Links';
    document.querySelector('.brand-sub')?.remove();
    const searchIcon = document.querySelector('.search-icon');
    if (searchIcon) searchIcon.innerHTML = ICONS.search;
    const tabIcons = { links: ICONS.link, prompts: ICONS.prompt, settings: ICONS.settings };
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const span = btn.querySelector('span');
      if (span && tabIcons[btn.dataset.tab]) span.innerHTML = tabIcons[btn.dataset.tab];
    });
    setIconButton($('fabBtn'), ICONS.plus, '追加');
    setIconButton($('clearSearchBtn'), ICONS.close, '検索をクリア');
    document.querySelectorAll('.modal-close').forEach(button => setIconButton(button, ICONS.close, '閉じる'));
    $('globalSearch')?.setAttribute('aria-label', 'リンクとプロンプトを検索');
  }

  function decorateCategoryGrid(inputId, selectId, existingText, newText) {
    const input = $(inputId);
    const select = $(selectId);
    const grid = input?.closest('.category-input-grid');
    if (!input || !select || !grid || grid.dataset.precisionDecorated) return;
    grid.dataset.precisionDecorated = '1';
    const existingWrap = document.createElement('div');
    existingWrap.className = 'precision-category-control';
    existingWrap.innerHTML = `<div class="precision-field-label">${existingText}</div>`;
    const newWrap = document.createElement('div');
    newWrap.className = 'precision-category-control precision-category-new';
    newWrap.innerHTML = `<div class="precision-field-label">${newText}</div>`;
    grid.textContent = '';
    existingWrap.appendChild(select);
    newWrap.appendChild(input);
    grid.append(existingWrap, newWrap);
  }

  function prioritizeClassification() {
    const hiddenId = $('linkId');
    const row = $('linkProject')?.closest('.form-row');
    if (hiddenId && row && row.previousElementSibling !== hiddenId) hiddenId.insertAdjacentElement('afterend', row);
    row?.classList.add('classification-priority');
  }

  function makeModalScrollable(modalId) {
    const modal = $(modalId);
    const sheet = modal?.querySelector('.modal-sheet');
    const head = sheet?.querySelector(':scope > .modal-head');
    const actions = sheet?.querySelector(':scope > .modal-actions');
    if (!modal || !sheet || !head || !actions || sheet.querySelector(':scope > .modal-scroll-body')) return;
    const body = document.createElement('div');
    body.className = 'modal-scroll-body';
    Array.from(sheet.children).forEach(child => { if (child !== head && child !== actions) body.appendChild(child); });
    head.classList.add('modal-fixed-head');
    actions.classList.add('modal-fixed-actions');
    sheet.insertBefore(body, actions);
  }

  function addDisplayControls() {
    [
      { kind: 'link', toolbar: document.querySelector('#linksPanel .toolbar'), tools: document.querySelector('#linksPanel .view-tools') },
      { kind: 'prompt', toolbar: document.querySelector('#promptsPanel .toolbar'), tools: document.querySelector('#promptsPanel .view-tools') }
    ].forEach(({ kind, toolbar, tools }) => {
      if (!toolbar || !tools || toolbar.querySelector('.precision-display-btn')) return;
      const sort = toolbar.querySelector('.select-mini');
      const group = document.createElement('div');
      group.className = 'precision-toolbar-actions';
      const displayBtn = document.createElement('button');
      displayBtn.type = 'button';
      displayBtn.className = 'btn ghost compact precision-display-btn';
      displayBtn.textContent = '表示';
      displayBtn.setAttribute('aria-expanded', 'false');
      if (sort) group.appendChild(sort);
      group.appendChild(displayBtn);
      toolbar.appendChild(group);
      displayBtn.addEventListener('click', () => {
        const open = tools.classList.toggle('precision-open');
        displayBtn.setAttribute('aria-expanded', String(open));
      });
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'btn ghost compact precision-select-btn';
      selectBtn.textContent = '選択して削除';
      selectBtn.addEventListener('click', () => {
        if (kind === 'link') { state.linkSelectMode = true; state.selectedLinkIds = []; }
        else { state.promptSelectMode = true; state.selectedPromptIds = []; }
        tools.classList.remove('precision-open');
        displayBtn.setAttribute('aria-expanded', 'false');
        render();
      });
      tools.appendChild(selectBtn);
    });
  }

  function compactSettings() {
    const panel = $('settingsPanel');
    if (!panel || panel.dataset.precisionCompacted) return;
    panel.dataset.precisionCompacted = '1';
    const cards = [...panel.querySelectorAll(':scope > .settings-card')];
    cards.slice(1).forEach(card => {
      const title = card.querySelector('.settings-title')?.textContent?.trim() || '設定';
      const details = document.createElement('details');
      details.className = `precision-settings-disclosure${card.classList.contains('danger-zone') ? ' danger' : ''}`;
      const summary = document.createElement('summary');
      summary.textContent = title;
      card.querySelector('.settings-title')?.classList.add('precision-visually-hidden');
      card.parentNode.insertBefore(details, card);
      details.append(summary, card);
    });
  }

  function embedQuickJsonImport() {
    const button = $('openJsonImportBtn');
    if (!button || $('precisionQuickJsonPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'precisionQuickJsonPanel';
    panel.className = 'precision-quick-json-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="form-row"><label for="precisionQuickJsonMode">取り込み方法</label><select id="precisionQuickJsonMode" class="select"><option value="merge">既存データに統合</option><option value="replace">現在のデータを置き換え</option></select></div>
      <div class="form-row"><label for="precisionQuickJsonText">JSON</label><textarea id="precisionQuickJsonText" class="textarea" placeholder="JSONを貼り付け"></textarea></div>
      <div class="precision-json-actions"><label class="btn ghost" for="precisionQuickJsonFile">JSONファイルを選ぶ</label><input id="precisionQuickJsonFile" type="file" accept="application/json,.json" hidden><button class="btn primary" id="precisionRunQuickJson" type="button">取り込む</button></div>`;
    button.insertAdjacentElement('afterend', panel);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) setTimeout(() => $('precisionQuickJsonText')?.focus(), 0);
    }, true);
    $('precisionQuickJsonFile')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      $('precisionQuickJsonText').value = await file.text();
      event.target.value = '';
    });
    $('precisionRunQuickJson')?.addEventListener('click', () => {
      importFromText($('precisionQuickJsonText').value, $('precisionQuickJsonMode').value);
    });
  }

  function improveQuickAddCopy() {
    const privacy = document.querySelector('#quickUrlModal .quick-url-privacy');
    if (privacy) privacy.textContent = 'ページ情報を取得できない場合は、取得のため外部サービスを使用します。AIによる分類・文章生成は行いません。';
    const status = $('quickUrlStatus');
    if (status && !status.classList.contains('loading')) status.textContent = 'URLを貼るとページ情報を取得し、保存前に内容を確認できます。';
  }

  function ensureActionMenu() {
    if ($('precisionActionMenuBackdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'precisionActionMenuBackdrop';
    backdrop.className = 'precision-action-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = '<div class="precision-action-menu" id="precisionActionMenu" role="dialog" aria-modal="true" aria-label="その他の操作"></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeActionMenu(); });
  }

  let menuReturnFocus = null;
  function openActionMenu(kind, id, anchor) {
    ensureActionMenu();
    menuReturnFocus = anchor || document.activeElement;
    const menu = $('precisionActionMenu');
    if (kind === 'link') {
      const item = state.items.find(entry => entry.id === id);
      if (!item) return;
      menu.innerHTML = `
        <button class="precision-action-item" data-menu-action="edit">編集</button>
        <button class="precision-action-item" data-menu-action="favorite">${isFavorite(item) ? 'お気に入りから外す' : 'お気に入りに追加'}</button>
        <button class="precision-action-item danger" data-menu-action="delete">削除</button>
        <button class="precision-action-cancel" data-menu-action="cancel">閉じる</button>`;
    } else {
      menu.innerHTML = '<button class="precision-action-item danger" data-menu-action="delete">削除</button><button class="precision-action-cancel" data-menu-action="cancel">閉じる</button>';
    }
    menu.dataset.kind = kind;
    menu.dataset.id = id;
    $('precisionActionMenuBackdrop').hidden = false;
    requestAnimationFrame(() => menu.querySelector('button')?.focus());
  }

  function closeActionMenu() {
    const backdrop = $('precisionActionMenuBackdrop');
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    menuReturnFocus?.focus?.();
    menuReturnFocus = null;
  }

  function markOverflowButtons() {
    document.querySelectorAll('#linksList [data-action="edit"]').forEach(button => {
      button.classList.add('precision-more');
      button.innerHTML = ICONS.more;
      button.setAttribute('aria-label', 'その他の操作');
    });
    document.querySelectorAll('#promptsList [data-action="delete-prompt"]').forEach(button => {
      button.classList.add('precision-more');
      button.innerHTML = ICONS.more;
      button.setAttribute('aria-label', 'その他の操作');
    });
    document.querySelectorAll('.card-actions').forEach(actions => actions.classList.add('precision-card-actions'));
    document.querySelectorAll('.simple-actions').forEach(actions => actions.classList.add('precision-simple-actions'));
  }

  ensureActionMenu();
  $('precisionActionMenu')?.addEventListener('click', event => {
    const button = event.target.closest('[data-menu-action]');
    if (!button) return;
    const menu = $('precisionActionMenu');
    const { kind, id } = menu.dataset;
    const action = button.dataset.menuAction;
    closeActionMenu();
    if (action === 'cancel') return;
    if (kind === 'link') {
      if (action === 'edit') return openLinkModal(state.items.find(item => item.id === id));
      if (action === 'favorite') return toggleFavorite(id);
      if (action === 'delete') return window.QuickLinksPrecisionData?.deleteLink(id);
    }
    if (kind === 'prompt' && action === 'delete') return deletePrompt(id);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('.precision-more');
    if (!button) return;
    const row = button.closest('[data-id]');
    if (!row) return;
    const linkOverflow = button.matches('[data-action="edit"]') && row.closest('#linksList');
    const promptOverflow = button.matches('[data-action="delete-prompt"]') && row.closest('#promptsList');
    if (!linkOverflow && !promptOverflow) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openActionMenu(linkOverflow ? 'link' : 'prompt', row.dataset.id, button);
  }, true);

  const baseRender = render;
  render = function() {
    baseRender();
    markOverflowButtons();
  };

  decorateHeaderAndNav();
  decorateCategoryGrid('quickUrlProject', 'quickUrlProjectSelect', '既存の分類から選ぶ', '新しい分類を入力');
  decorateCategoryGrid('linkProject', 'linkProjectSelect', '既存の分類から選ぶ', '新しい分類を入力');
  decorateCategoryGrid('promptCategory', 'promptCategorySelect', '既存のカテゴリから選ぶ', '新しいカテゴリを入力');
  prioritizeClassification();
  makeModalScrollable('quickUrlModal');
  makeModalScrollable('linkModal');
  addDisplayControls();
  compactSettings();
  embedQuickJsonImport();
  improveQuickAddCopy();
  markOverflowButtons();

  window.QuickLinksPrecisionUI = { closeActionMenu, icons: ICONS };
})();
