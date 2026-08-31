(() => {
  'use strict';

  const CONTEXT_ID = 'nowContext';
  const STYLE_ID = 'quickLinksNowStyles';
  const MAX_ITEMS = 3;
  const MAX_AGE_DAYS = 30;

  function ensureStyles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .now-context {
        margin: 0 0 10px;
        padding: 9px 1px 8px;
        border-bottom: 1px solid var(--line);
      }

      .now-context[hidden] { display: none !important; }

      .now-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 5px;
      }

      .now-title {
        margin: 0;
        color: #6f6e69;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 700;
        letter-spacing: .08em;
      }

      .now-sub {
        color: #9a9994;
        font-size: 9px;
        font-weight: 500;
      }

      .now-list {
        display: grid;
        gap: 0;
      }

      .now-item {
        width: 100%;
        min-height: 48px;
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        padding: 8px 1px;
        border: 0;
        border-top: 1px solid var(--line);
        border-radius: 0;
        color: var(--ink);
        background: transparent;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .now-item:first-child { border-top: 0; }

      .now-kind {
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        color: #85847f;
      }

      .now-kind svg {
        width: 17px;
        height: 17px;
        display: block;
      }

      .now-copy {
        min-width: 0;
      }

      .now-item-title {
        display: block;
        overflow: hidden;
        color: #242421;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 620;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .now-meta {
        display: block;
        margin-top: 2px;
        overflow: hidden;
        color: #92918c;
        font-size: 9px;
        line-height: 1.35;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .now-action {
        min-width: 46px;
        color: var(--red);
        font-size: 10px;
        font-weight: 700;
        text-align: right;
      }

      @media (hover: hover) and (pointer: fine) {
        .now-item:hover { background: #fff; }
      }

      @media (max-width: 719px) {
        .now-item { min-height: 52px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .now-item { transition: none !important; }
      }

      .search-shift-active #nowContext { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function timestampValue(value) {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function ageDays(value) {
    const time = timestampValue(value);
    if (!time) return Infinity;
    return Math.max(0, (Date.now() - time) / 86400000);
  }

  function recencyPoints(days) {
    if (days <= 1) return 6;
    if (days <= 3) return 5;
    if (days <= 7) return 4;
    if (days <= 14) return 3;
    if (days <= 30) return 2;
    return 0;
  }

  function candidateScore(count, days) {
    const frequency = Math.min(4.5, Math.log2(Math.max(1, count) + 1) * 1.35);
    return recencyPoints(days) * 10 + frequency;
  }

  function getCandidates() {
    const links = state.items
      .filter(item => !item.archived)
      .map(item => {
        const count = Number(item.clickCount || 0);
        const usedAt = item.lastClickedAt;
        const days = ageDays(usedAt);
        return {
          kind: 'link',
          id: item.id,
          title: item.title || item.url || '無題のリンク',
          category: item.projectName || '未分類',
          count,
          usedAt,
          days,
          score: candidateScore(count, days)
        };
      })
      .filter(item => item.count > 0 && item.days <= MAX_AGE_DAYS);

    const prompts = state.promptMemos
      .map(memo => {
        const count = Number(memo.copyCount || 0);
        const usedAt = memo.lastCopiedAt;
        const days = ageDays(usedAt);
        return {
          kind: 'prompt',
          id: memo.id,
          title: memo.title || '無題のプロンプト',
          category: memo.categoryName || '未分類',
          count,
          usedAt,
          days,
          score: candidateScore(count, days)
        };
      })
      .filter(item => item.count > 0 && item.days <= MAX_AGE_DAYS);

    return [...links, ...prompts]
      .sort((a, b) => b.score - a.score || timestampValue(b.usedAt) - timestampValue(a.usedAt))
      .slice(0, MAX_ITEMS);
  }

  function timeLabel(days) {
    if (days < 1) return '今日';
    if (days < 2) return '昨日';
    if (days < 7) return `${Math.floor(days)}日前`;
    if (days < 14) return '1週間前';
    if (days < 21) return '2週間前';
    if (days < 30) return '3週間前';
    return '1か月前';
  }

  function iconFor(kind) {
    const icons = window.QuickLinksPrecisionUI?.icons;
    if (kind === 'link') return icons?.link || '↗';
    return icons?.prompt || '✎';
  }

  function actionFor(kind) {
    return kind === 'link' ? '開く' : 'コピー';
  }

  function ensureContext() {
    let context = $(CONTEXT_ID);
    if (context) return context;
    context = document.createElement('section');
    context.id = CONTEXT_ID;
    context.className = 'now-context';
    context.setAttribute('aria-label', '今使いやすい項目');
    const main = document.querySelector('main');
    if (!main) return null;
    main.insertBefore(context, main.firstChild);
    return context;
  }

  function shouldShow() {
    if (document.body.classList.contains('search-shift-active')) return false;
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    return activeTab !== 'settings';
  }

  function renderNow() {
    const context = ensureContext();
    if (!context) return;
    const candidates = getCandidates();
    const visible = shouldShow() && candidates.length > 0;
    context.hidden = !visible;
    if (!visible) {
      context.innerHTML = '';
      return;
    }

    context.innerHTML = `
      <div class="now-head">
        <h2 class="now-title">NOW</h2>
        <span class="now-sub">最近の利用から</span>
      </div>
      <div class="now-list">
        ${candidates.map(item => `
          <button class="now-item" type="button" data-now-kind="${item.kind}" data-now-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)}を${actionFor(item.kind)}">
            <span class="now-kind" aria-hidden="true">${iconFor(item.kind)}</span>
            <span class="now-copy">
              <span class="now-item-title">${escapeHtml(item.title)}</span>
              <span class="now-meta">${escapeHtml(item.category)} · ${timeLabel(item.days)} · ${item.count.toLocaleString()}回</span>
            </span>
            <span class="now-action" aria-hidden="true">${actionFor(item.kind)}</span>
          </button>`).join('')}
      </div>`;

    context.querySelectorAll('[data-now-kind][data-now-id]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.nowId;
        if (button.dataset.nowKind === 'link') return handleLinkAction(id, 'open');
        return copyPrompt(id);
      });
    });
  }

  ensureStyles();
  window.QuickLinksNowUI = {
    hasItems: () => getCandidates().length > 0,
    render: renderNow
  };

  const baseRender = render;
  render = function() {
    baseRender();
    queueMicrotask(renderNow);
  };

  document.querySelectorAll('.tab-btn').forEach(button => button.addEventListener('click', () => queueMicrotask(renderNow)));
  renderNow();
})();
