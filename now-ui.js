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
        margin: 0 0 18px;
        padding: 10px 0 16px;
      }

      .now-context[hidden] { display: none !important; }
      .now-context-active .prompt-reuse-recent { display: none !important; }
      .now-context-active .prompt-reuse-group:not(:has(.prompt-reuse-dormant)) { display: none !important; }

      .now-head {
        display: flex;
        align-items: center;
        min-height: 18px;
        margin-bottom: 7px;
      }

      .now-title {
        margin: 0;
        color: #777670;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 760;
        letter-spacing: .11em;
      }

      .now-tray {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
        padding: 7px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: rgba(255, 255, 255, .34);
      }

      .now-slot {
        width: 100%;
        min-width: 0;
        min-height: 76px;
        display: grid;
        grid-template-rows: 1fr auto;
        gap: 9px;
        padding: 11px 11px 9px;
        border: 0;
        border-radius: 9px;
        color: var(--ink);
        background: rgba(255, 255, 255, .76);
        box-shadow: 0 1px 0 rgba(36, 36, 33, .025);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background-color .14s ease, transform .14s ease, box-shadow .14s ease;
      }

      .now-slot-main {
        min-width: 0;
        display: grid;
        grid-template-columns: 19px minmax(0, 1fr);
        align-items: start;
        gap: 8px;
      }

      .now-kind {
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        color: #85847f;
      }

      .now-kind svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .now-item-title {
        min-width: 0;
        display: -webkit-box;
        overflow: hidden;
        color: #252522;
        font-size: 12.5px;
        line-height: 1.36;
        font-weight: 650;
        text-overflow: ellipsis;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .now-slot-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-left: 27px;
      }

      .now-time {
        min-width: 0;
        overflow: hidden;
        color: #9a9994;
        font-size: 8.5px;
        line-height: 1.25;
        font-weight: 560;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .now-action {
        flex: 0 0 auto;
        color: var(--red);
        font-size: 9.5px;
        line-height: 1.2;
        font-weight: 720;
        white-space: nowrap;
      }

      .now-slot.is-copied .now-action {
        color: #6d6c67;
      }

      @media (hover: hover) and (pointer: fine) {
        .now-slot:hover {
          background: #fff;
          box-shadow: 0 4px 14px rgba(36, 36, 33, .055);
          transform: translateY(-1px);
        }
      }

      .now-slot:focus-visible {
        outline: 2px solid var(--red);
        outline-offset: 2px;
      }

      @media (max-width: 719px) {
        .now-context {
          margin-bottom: 15px;
          padding-top: 8px;
          padding-bottom: 14px;
        }

        .now-tray {
          grid-template-columns: 1fr;
          gap: 4px;
          padding: 5px;
          border-radius: 12px;
        }

        .now-slot {
          min-height: 58px;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-rows: 1fr;
          align-items: center;
          gap: 10px;
          padding: 9px 10px;
          border-radius: 8px;
        }

        .now-slot-main {
          align-items: center;
        }

        .now-item-title {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .now-slot-foot {
          min-width: 58px;
          display: grid;
          justify-items: end;
          gap: 3px;
          padding-left: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .now-slot { transition: none !important; }
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

  function activeKind() {
    const tab = state?.activeTab || document.querySelector('.tab-btn.active')?.dataset.tab;
    if (tab === 'links') return 'link';
    if (tab === 'prompts') return 'prompt';
    return null;
  }

  function cleanText(value, max = 82) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function domainFor(url) {
    try {
      return new URL(String(url || '')).hostname.replace(/^www\./i, '') || '';
    } catch (_) {
      return '';
    }
  }

  function getCandidates(kind = activeKind()) {
    if (!kind) return [];

    if (kind === 'link') {
      return state.items
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
            domain: domainFor(item.url),
            note: cleanText(item.note),
            count,
            usedAt,
            days,
            score: candidateScore(count, days)
          };
        })
        .filter(item => item.count > 0 && item.days <= MAX_AGE_DAYS)
        .sort((a, b) => b.score - a.score || timestampValue(b.usedAt) - timestampValue(a.usedAt))
        .slice(0, MAX_ITEMS);
    }

    return state.promptMemos
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
      .filter(item => item.count > 0 && item.days <= MAX_AGE_DAYS)
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

  function shouldShow(kind) {
    if (!kind) return false;
    if (document.body.classList.contains('search-shift-active')) return false;
    return !state?.query;
  }

  function showCopied(context, id) {
    queueMicrotask(() => {
      const button = Array.from(context.querySelectorAll('[data-now-kind="prompt"][data-now-id]'))
        .find(item => item.dataset.nowId === id);
      if (!button) return;

      const action = button.querySelector('.now-action');
      if (!action) return;

      button.classList.add('is-copied');
      action.textContent = '✓ コピー';

      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.classList.remove('is-copied');
        action.textContent = 'コピー';
      }, 1300);
    });
  }

  function renderNow() {
    const context = ensureContext();
    if (!context) return;
    const kind = activeKind();
    const candidates = getCandidates(kind);
    const visible = shouldShow(kind) && candidates.length > 0;
    document.body.classList.toggle('now-context-active', visible && kind === 'prompt');
    context.hidden = !visible;
    if (!visible) {
      context.innerHTML = '';
      return;
    }

    context.innerHTML = `
      <div class="now-head">
        <h2 class="now-title">NOW</h2>
      </div>
      <div class="now-tray">
        ${candidates.map(item => `
          <button class="now-slot ${item.kind === 'link' ? 'now-slot-link' : 'now-slot-prompt'}" type="button" data-now-kind="${item.kind}" data-now-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)}を${actionFor(item.kind)}">
            <span class="now-slot-main">
              <span class="now-kind" aria-hidden="true">${iconFor(item.kind)}</span>
              <span class="now-item-title">${escapeHtml(item.title)}</span>
            </span>
            <span class="now-slot-foot">
              <span class="now-time">${timeLabel(item.days)}</span>
              <span class="now-action" aria-live="polite">${actionFor(item.kind)}</span>
            </span>
          </button>`).join('')}
      </div>`;

    context.querySelectorAll('[data-now-kind][data-now-id]').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.nowId;
        if (button.dataset.nowKind === 'link') return handleLinkAction(id, 'open');
        const result = copyPrompt(id);
        showCopied(context, id);
        return result;
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

  renderNow();
})();
