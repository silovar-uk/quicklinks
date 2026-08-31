(() => {
  'use strict';

  const STYLE_ID = 'quickLinksInteractionFeedbackStyles';
  const timers = new Map();

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .quick-feedback-node {
        position: relative;
        color: transparent !important;
      }

      .quick-feedback-node::after {
        content: attr(data-feedback-text);
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: var(--red);
        font: inherit;
        white-space: nowrap;
        pointer-events: none;
      }

      .quick-feedback-success {
        position: relative;
      }

      @media (prefers-reduced-motion: reduce) {
        .quick-feedback-success,
        .quick-feedback-node { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function itemByData(selector, attribute, id) {
    return [...document.querySelectorAll(selector)].find(element => element.getAttribute(attribute) === id) || null;
  }

  function contextFromButton(button) {
    if (!button) return null;

    if (button.matches('#rediscoveryPreviewCopy')) {
      return {
        key: 'rediscovery-preview',
        locate: () => document.getElementById('rediscoveryPreviewCopy'),
        mode: 'button'
      };
    }

    if (button.matches('[data-now-kind="prompt"][data-now-id]')) {
      const id = button.dataset.nowId;
      return {
        key: `now-prompt:${id}`,
        locate: () => itemByData('#nowContext [data-now-kind="prompt"][data-now-id]', 'data-now-id', id),
        mode: 'now-action'
      };
    }

    if (button.matches('[data-search-action="copy-prompt"], [data-search-action="copy-link"]')) {
      const row = button.closest('[data-search-kind][data-search-id]');
      if (!row) return null;
      const id = row.dataset.searchId;
      const action = button.dataset.searchAction;
      const kind = row.dataset.searchKind;
      return {
        key: `search-${kind}:${id}:${action}`,
        locate: () => {
          const currentRow = [...document.querySelectorAll(`#searchShiftPanel [data-search-kind="${kind}"][data-search-id]`)]
            .find(element => element.dataset.searchId === id);
          return currentRow?.querySelector(`[data-search-action="${action}"]`) || null;
        },
        mode: 'button'
      };
    }

    if (button.matches('[data-rediscovery-action="copy"]')) {
      const card = button.closest('[data-rediscovery-id]');
      if (!card) return null;
      const id = card.dataset.rediscoveryId;
      return {
        key: `rediscovery:${id}`,
        locate: () => {
          const currentCard = itemByData('[data-rediscovery-id]', 'data-rediscovery-id', id);
          return currentCard?.querySelector('[data-rediscovery-action="copy"]') || null;
        },
        mode: 'button'
      };
    }

    if (button.matches('[data-copy-prompt-id]')) {
      const id = button.dataset.copyPromptId;
      return {
        key: `recent:${id}`,
        locate: () => itemByData('[data-copy-prompt-id]', 'data-copy-prompt-id', id),
        mode: 'recent-action'
      };
    }

    if (button.matches('[data-action="copy-prompt"]')) {
      const row = button.closest('[data-id]');
      if (!row) return null;
      const id = row.dataset.id;
      return {
        key: `prompt:${id}`,
        locate: () => {
          const currentRow = itemByData('#promptsList [data-id]', 'data-id', id);
          return currentRow?.querySelector('[data-action="copy-prompt"]') || null;
        },
        mode: 'button'
      };
    }

    if (button.matches('[data-action="copy"]')) {
      const row = button.closest('[data-id]');
      if (!row || !row.closest('#linksList')) return null;
      const id = row.dataset.id;
      return {
        key: `link:${id}`,
        locate: () => {
          const currentRow = itemByData('#linksList [data-id]', 'data-id', id);
          return currentRow?.querySelector('[data-action="copy"]') || null;
        },
        mode: 'button'
      };
    }

    return null;
  }

  function feedbackNode(target, mode) {
    if (!target) return null;
    if (mode === 'now-action') return target.querySelector('.now-action') || target;
    if (mode === 'recent-action') return target.querySelector('.prompt-reuse-action') || target;
    return target;
  }

  function clearFeedbackNode(node) {
    if (!node) return;
    node.classList.remove('quick-feedback-node');
    delete node.dataset.feedbackText;
  }

  function success(context, { duration = 900, text = '✓ コピー' } = {}) {
    if (!context) return;
    const previousTimer = timers.get(context.key);
    if (previousTimer) clearTimeout(previousTimer);

    requestAnimationFrame(() => {
      const target = context.locate();
      if (!target) return;
      const node = feedbackNode(target, context.mode);
      if (!node) return;

      target.classList.add('quick-feedback-success');
      node.classList.add('quick-feedback-node');
      node.dataset.feedbackText = text;

      const timer = setTimeout(() => {
        const currentTarget = context.locate();
        const currentNode = feedbackNode(currentTarget, context.mode);
        if (currentTarget) currentTarget.classList.remove('quick-feedback-success');
        clearFeedbackNode(currentNode);
        timers.delete(context.key);
      }, duration);
      timers.set(context.key, timer);
    });
  }

  function successForButton(button, options) {
    success(contextFromButton(button), options);
  }

  function deferRender(action, delay = 320) {
    if (typeof action !== 'function' || typeof render !== 'function') {
      action?.();
      return;
    }

    const currentRender = render;
    let requested = false;
    render = function() { requested = true; };
    try {
      action();
    } finally {
      render = currentRender;
    }

    if (requested) setTimeout(() => render(), delay);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    const context = contextFromButton(button);
    if (!context || button?.matches('#rediscoveryPreviewCopy')) return;
    queueMicrotask(() => success(context));
  }, true);

  ensureStyles();
  window.QuickLinksFeedback = {
    success,
    successForButton,
    contextFromButton,
    deferRender
  };
})();
