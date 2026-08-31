(() => {
  'use strict';

  const STYLE_ID = 'quickLinksRediscoveryStyles';
  const MODAL_ID = 'promptRediscoveryModal';
  let activePromptId = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .prompt-reuse-dormant {
        padding-top: 4px;
      }

      .prompt-reuse-button {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .prompt-reuse-button .prompt-reuse-label {
        min-width: 0;
        flex: 1 1 auto;
      }

      .prompt-reuse-button .prompt-reuse-action {
        flex: 0 0 auto;
        color: #85847f;
        font-size: 9px;
        font-weight: 600;
        overflow: visible;
      }

      .prompt-rediscovery {
        padding: 10px 0 11px;
        border-top: 1px solid var(--line);
      }

      .prompt-rediscovery-copy {
        min-width: 0;
      }

      .prompt-rediscovery-title {
        margin: 0;
        color: #242421;
        font-size: 13px;
        line-height: 1.4;
        font-weight: 650;
        letter-spacing: -.01em;
      }

      .prompt-rediscovery-excerpt {
        display: -webkit-box;
        margin: 5px 0 0;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        color: #686762;
        font-size: 11px;
        line-height: 1.55;
        word-break: break-word;
      }

      .prompt-rediscovery-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px 8px;
        margin-top: 7px;
        color: #92918c;
        font-size: 9px;
        line-height: 1.4;
        font-weight: 500;
      }

      .prompt-rediscovery-category {
        color: #74736e;
        font-weight: 600;
      }

      .prompt-rediscovery-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(94px, .72fr);
        gap: 7px;
        margin-top: 9px;
      }

      .prompt-rediscovery-actions .btn {
        min-height: 40px;
      }

      .rediscovery-modal .modal-sheet {
        width: min(680px, 100%);
        max-height: min(82dvh, 760px);
        display: flex;
        flex-direction: column;
        padding: 0;
        overflow: hidden;
        background: #fbfbf9;
      }

      .rediscovery-modal .modal-head {
        flex: 0 0 auto;
        margin: 0;
        padding: 14px 16px 11px;
        border-bottom: 1px solid var(--line);
        background: #fbfbf9;
      }

      .rediscovery-preview-scroll {
        min-height: 0;
        flex: 1 1 auto;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 14px 16px 18px;
        -webkit-overflow-scrolling: touch;
      }

      .rediscovery-preview-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-bottom: 14px;
        color: #85847f;
        font-size: 10px;
        line-height: 1.4;
      }

      .rediscovery-preview-body {
        margin: 0;
        color: #33332f;
        font: inherit;
        font-size: 13px;
        line-height: 1.72;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .rediscovery-preview-empty {
        color: #8c8b86;
      }

      .rediscovery-modal .modal-actions {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: minmax(100px, .72fr) minmax(150px, 1.28fr);
        gap: 8px;
        margin: 0;
        padding: 10px 16px calc(10px + var(--safe-bottom));
        border-top: 1px solid var(--line);
        background: #fbfbf9;
      }

      .rediscovery-modal .modal-actions .btn {
        min-height: 46px;
      }

      @media (max-width: 719px) {
        .prompt-rediscovery-actions {
          grid-template-columns: 1fr 1fr;
        }

        .prompt-rediscovery-actions .btn {
          min-height: 44px;
        }

        .rediscovery-modal.open {
          align-items: flex-end;
        }

        .rediscovery-modal .modal-sheet {
          width: 100%;
          max-height: 84dvh;
          border-radius: 16px 16px 0 0;
        }
      }

      @media (min-width: 720px) {
        .rediscovery-modal.open {
          align-items: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function excerptFromBody(body, maxLength = 140) {
    const source = String(body || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .find(Boolean) || '';
    if (!source) return '本文の内容を確認してから再利用できます。';
    return source.length > maxLength ? `${source.slice(0, maxLength).trimEnd()}…` : source;
  }

  function setCloseIcon(button) {
    const icon = window.QuickLinksPrecisionUI?.icons?.close;
    if (icon) button.innerHTML = icon;
    else button.textContent = '×';
  }

  function focusPromptAfterRediscovery(id) {
    requestAnimationFrame(() => {
      const searchRow = [...document.querySelectorAll('#searchShiftPanel [data-search-kind="prompt"][data-search-id]')]
        .find(row => row.dataset.searchId === id);
      const searchAction = searchRow?.querySelector('[data-search-action="copy-prompt"]');
      if (searchAction) {
        searchAction.focus({ preventScroll: true });
        return;
      }

      const recentButton = [...document.querySelectorAll('[data-copy-prompt-id]')]
        .find(button => button.dataset.copyPromptId === id);
      if (recentButton) {
        recentButton.focus({ preventScroll: true });
        return;
      }

      const promptRow = [...document.querySelectorAll('#promptsList [data-id]')]
        .find(row => row.dataset.id === id);
      const rowAction = promptRow?.querySelector('button:not([disabled])');
      if (rowAction) {
        rowAction.focus({ preventScroll: true });
        return;
      }

      $('promptSortSelect')?.focus?.({ preventScroll: true });
    });
  }

  function ensurePreviewModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'modal rediscovery-modal';
    modal.id = MODAL_ID;
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'rediscoveryPreviewTitle');
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-head">
          <h2 class="modal-title" id="rediscoveryPreviewTitle">プロンプトの内容</h2>
          <button class="modal-close" id="rediscoveryPreviewClose" type="button" aria-label="閉じる">×</button>
        </div>
        <div class="rediscovery-preview-scroll">
          <div class="rediscovery-preview-meta" id="rediscoveryPreviewMeta"></div>
          <div class="rediscovery-preview-body" id="rediscoveryPreviewBody"></div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" id="rediscoveryPreviewEdit" type="button">編集</button>
          <button class="btn primary" id="rediscoveryPreviewCopy" type="button">コピー</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const closeButton = document.getElementById('rediscoveryPreviewClose');
    setCloseIcon(closeButton);
    closeButton.addEventListener('click', () => closeModal(MODAL_ID));
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal(MODAL_ID);
    });

    document.getElementById('rediscoveryPreviewCopy').addEventListener('click', () => {
      if (!activePromptId) return;
      const id = activePromptId;
      copyPrompt(id);
      setTimeout(() => {
        closeModal(MODAL_ID);
        focusPromptAfterRediscovery(id);
      }, window.QuickLinksFeedback?.timings?.transition || 320);
    });

    document.getElementById('rediscoveryPreviewEdit').addEventListener('click', () => {
      const memo = state.promptMemos.find(item => item.id === activePromptId);
      if (!memo) return;
      closeModal(MODAL_ID);
      requestAnimationFrame(() => {
        if (document.body.classList.contains('search-shift-active')) $('globalSearch')?.focus?.({ preventScroll: true });
        openPromptModal(memo);
      });
    });

    return modal;
  }

  function openRediscoveryPreview(id) {
    const memo = state.promptMemos.find(item => item.id === id);
    if (!memo) return;
    activePromptId = id;
    ensurePreviewModal();

    document.getElementById('rediscoveryPreviewTitle').textContent = memo.title || '無題のプロンプト';
    const lastUsed = memo.lastCopiedAt ? formatShortDate(memo.lastCopiedAt) : '';
    const count = Number(memo.copyCount || 0).toLocaleString();
    const category = memo.categoryName || '未分類';
    document.getElementById('rediscoveryPreviewMeta').innerHTML = `
      <span>${escapeHtml(category)}</span>
      <span>${count}回使用</span>
      ${lastUsed ? `<span>最終利用 ${escapeHtml(lastUsed)}</span>` : ''}`;

    const body = document.getElementById('rediscoveryPreviewBody');
    const text = String(memo.body || '');
    body.textContent = text || '本文はありません。';
    body.classList.toggle('rediscovery-preview-empty', !text);
    openModal(MODAL_ID);
  }

  function renderRecentSection(recent) {
    if (!recent.length) return '';
    return `
      <section class="prompt-reuse prompt-reuse-recent" aria-label="最近使ったプロンプト">
        <h2 class="prompt-reuse-title">最近使った</h2>
        <div class="prompt-reuse-list">
          ${recent.map(memo => `
            <button class="prompt-reuse-button" type="button" data-copy-prompt-id="${escapeHtml(memo.id)}" aria-label="${escapeHtml(memo.title || '無題のプロンプト')}をコピー">
              <span class="prompt-reuse-label">${escapeHtml(memo.title || '無題のプロンプト')}</span>
              <span class="prompt-reuse-action" aria-hidden="true">コピー</span>
            </button>`).join('')}
        </div>
      </section>`;
  }

  function renderRediscoverySection(dormant) {
    if (!dormant) return '';
    const memo = dormant.memo;
    const excerpt = excerptFromBody(memo.body);
    const category = memo.categoryName || '未分類';
    return `
      <section class="prompt-reuse prompt-reuse-dormant" aria-label="久しぶりのプロンプト">
        <h2 class="prompt-reuse-title">久しぶり</h2>
        <article class="prompt-rediscovery" data-rediscovery-id="${escapeHtml(memo.id)}">
          <div class="prompt-rediscovery-copy">
            <h3 class="prompt-rediscovery-title">${escapeHtml(memo.title || '無題のプロンプト')}</h3>
            <p class="prompt-rediscovery-excerpt">${escapeHtml(excerpt)}</p>
            <div class="prompt-rediscovery-meta">
              <span class="prompt-rediscovery-category">${escapeHtml(category)}</span>
              <span>${formatTimeAway(dormant.daysSinceUse)}</span>
              <span>以前${Number(memo.copyCount || 0).toLocaleString()}回使用</span>
            </div>
          </div>
          <div class="prompt-rediscovery-actions">
            <button class="btn ghost compact" type="button" data-rediscovery-action="preview">内容を見る</button>
            <button class="btn primary compact" type="button" data-rediscovery-action="copy">コピー</button>
          </div>
        </article>
      </section>`;
  }

  function renderRediscoveryPromptReuse() {
    const el = $('promptReuse');
    if (!el) return;
    const recent = getRecentPrompts();
    const dormant = getDormantPrompt(recent);
    if (!recent.length && !dormant) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `<div class="prompt-reuse-group">${renderRecentSection(recent)}${renderRediscoverySection(dormant)}</div>`;

    el.querySelectorAll('[data-copy-prompt-id]').forEach(button => {
      button.addEventListener('click', () => copyPrompt(button.dataset.copyPromptId));
    });

    el.querySelectorAll('[data-rediscovery-id]').forEach(card => {
      const id = card.dataset.rediscoveryId;
      card.querySelector('[data-rediscovery-action="preview"]')?.addEventListener('click', () => openRediscoveryPreview(id));
      card.querySelector('[data-rediscovery-action="copy"]')?.addEventListener('click', () => {
        if (window.QuickLinksFeedback?.deferRender) {
          window.QuickLinksFeedback.deferRender(() => copyPrompt(id), window.QuickLinksFeedback.timings?.transition || 320);
          return;
        }
        copyPrompt(id);
      });
    });
  }

  ensureStyles();
  ensurePreviewModal();
  window.QuickLinksRediscoveryUI = { openPreview: openRediscoveryPreview };
  renderPromptReuse = renderRediscoveryPromptReuse;
  render();
})();
