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

      #nowContext.random-context { background:#252724; color:#fff; padding:16px; border-radius:12px; margin-bottom:18px; }
      .random-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .random-title { margin:0; font-size:11px; letter-spacing:.1em; color:#fff; }
      .random-head p { margin:4px 0 0; font-size:11px; color:#c9cdc6; }
      .random-controls { display:flex; gap:6px; flex-shrink:0; }
      #nowContext.random-context .btn { min-height:44px; color:#fff; background:transparent; border-color:#7d8478; }
      #nowContext.random-context .btn.primary { background:#fff; border-color:#fff; color:#252724; }
      #nowContext.random-context .btn:disabled { opacity:.4; cursor:default; }
      #nowContext.random-context .card, #nowContext.random-context .simple-row { background:transparent; border:0; }
      #nowContext.random-context .card-inner { padding-bottom:0; }
      #nowContext.random-context .card-title, #nowContext.random-context .simple-title { color:#fff; overflow-wrap:anywhere; }
      #nowContext.random-context .card-note, #nowContext.random-context .card-url,
      #nowContext.random-context .meta, #nowContext.random-context .simple-sub,
      #nowContext.random-context .simple-url { color:#c9cdc6; overflow-wrap:anywhere; }
      #nowContext.random-context .star-btn, #nowContext.random-context .simple-star { min-width:44px; min-height:44px; color:#c9cdc6; }
      #nowContext.random-context .star-btn.on, #nowContext.random-context .simple-star.on { color:#ffe197; }
      #nowContext.random-context button:focus-visible { outline:2px solid #ffe197; outline-offset:3px; }
      #nowContext.random-context .card-actions { display:flex; }
      #nowContext.random-context .card-actions .btn { flex:1; }
      .random-status { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
      @media (hover:hover) { #nowContext.random-context .btn:not(:disabled):hover { background:#42483f; color:#fff; } }
      @media (max-width:719px) {
        #nowContext.random-context { padding:12px; }
        .random-head { flex-wrap:wrap; gap:8px; }
        .random-controls { margin-left:auto; }
        #nowContext.random-context .simple-row { flex-wrap:wrap; }
        #nowContext.random-context .simple-actions { width:100%; display:flex; }
        #nowContext.random-context .simple-actions .btn { flex:1; }
      }

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


  // Random state belongs to the session, never to a render pass.
  const RANDOM_KEY = 'quicklinks.random.v1';
  let randomState = { current: null, remaining: [], seen: [], history: [] };
  try {
    const saved = JSON.parse(sessionStorage.getItem(RANDOM_KEY));
    if (saved && ['remaining', 'seen', 'history'].every(k => Array.isArray(saved[k]))) randomState = saved;
  } catch (_) {}
  function persistRandom() {
    try { sessionStorage.setItem(RANDOM_KEY, JSON.stringify(randomState)); } catch (_) {}
  }
  function shuffled(ids) {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function syncRandom() {
    const ids = state.items.filter(item => !item.archived).map(item => item.id);
    const valid = new Set(ids);
    for (const key of ['remaining', 'seen', 'history']) randomState[key] = randomState[key].filter(id => valid.has(id));
    if (!valid.has(randomState.current)) randomState.current = null;
    const known = new Set([...randomState.remaining, ...randomState.seen]);
    const added = ids.filter(id => !known.has(id));
    if (added.length) randomState.remaining = shuffled([...randomState.remaining, ...added]);
    if (!ids.length) randomState = { current: null, remaining: [], seen: [], history: [] };
    if (!randomState.current && ids.length) advanceRandom(ids, false);
    persistRandom();
    return ids;
  }
  function advanceRandom(ids, remember = true) {
    const previous = randomState.current;
    if (remember && previous) randomState.history.push(previous);
    if (ids.length > 1 && randomState.remaining.length === 1 && randomState.remaining[0] === previous) {
      randomState.remaining = [];
    }
    if (!randomState.remaining.length) {
      randomState.remaining = shuffled(ids);
      randomState.seen = [];
    }
    if (randomState.remaining.length > 1 && randomState.remaining[0] === previous) {
      const j = 1 + Math.floor(Math.random() * (randomState.remaining.length - 1));
      [randomState.remaining[0], randomState.remaining[j]] = [randomState.remaining[j], randomState.remaining[0]];
    }
    randomState.current = randomState.remaining.shift() || previous;
    if (!randomState.seen.includes(randomState.current)) randomState.seen.push(randomState.current);
    persistRandom();
  }
  function renderRandom(context) {
    const ids = syncRandom();
    const visible = shouldShow('link') && ids.length > 0 &&
      state.currentProject === 'ALL' && !state.onlyFavorites && !state.linkSelectMode;
    context.hidden = !visible;
    context.classList.add('random-context');
    context.setAttribute('aria-label', '保存したリンクからランダムに1件');
    if (!visible) return;
    const item = state.items.find(item => item.id === randomState.current);
    const focused = context.contains(document.activeElement) ? document.activeElement : null;
    const focusSelector = focused?.dataset.randomAction ? `[data-random-action="${focused.dataset.randomAction}"]` :
      focused?.dataset.action ? `[data-action="${focused.dataset.action}"]` : null;
    const markup = `<div class="random-head"><div><h2 class="random-title">RANDOM</h2><p>保存したリンクから1件</p></div>
      <div class="random-controls"><button type="button" class="btn ghost" data-random-action="back" ${randomState.history.length ? '' : 'disabled'}>1つ戻す</button>
      <button type="button" class="btn ghost" data-random-action="next" ${ids.length > 1 ? '' : 'disabled'}>別のリンク</button></div></div>
      <div class="random-card">${state.viewMode === 'simple' ? renderLinkSimpleRow(item) : renderLinkCard(item)}</div>
      <span class="random-status" role="status" aria-live="polite"></span>`;
    // Unrelated renders must not remove focus or copy feedback.
    if (context._randomMarkup === markup) return;
    context._randomMarkup = markup;
    context.innerHTML = markup;
    context.querySelectorAll('[data-random-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.randomAction === 'back') randomState.current = randomState.history.pop() || randomState.current;
      else advanceRandom(ids);
      persistRandom();
      renderRandom(context);
      context.querySelector('.random-status').textContent = `${state.items.find(i => i.id === randomState.current)?.title || 'リンク'}を表示しました`;
    }));
    context.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      handleLinkAction(item.id, button.dataset.action);
    }));
    if (focusSelector) context.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function renderNow() {
    const context = ensureContext();
    if (!context) return;
    const kind = activeKind();
    if (kind === 'link') {
      document.body.classList.remove('now-context-active');
      renderRandom(context);
      return;
    }
    context.classList.remove('random-context');
    context._randomMarkup = null;
    context.setAttribute('aria-label', '今使いやすい項目');
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
    hasItems: () => activeKind() === 'link' ? state.items.some(item => !item.archived) : getCandidates().length > 0,
    render: renderNow
  };

  const baseRender = render;
  render = function() {
    baseRender();
    queueMicrotask(renderNow);
  };

  renderNow();
})();

