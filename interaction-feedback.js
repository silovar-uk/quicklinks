(() => {
  'use strict';

  const STYLE_ID = 'quickLinksInteractionFeedbackStyles';
  const COPY_STANDARD_MS = 900;
  const COPY_TRANSITION_MS = 320;
  const SAVE_SUCCESS_MS = 280;
  const timers = new Map();
  const copyContextQueue = [];
  const saveButtons = new Map([
    ['saveLinkBtn', { modalId: 'linkModal', action: () => saveLinkFromModal() }],
    ['savePromptBtn', { modalId: 'promptModal', action: () => savePromptFromModal() }]
  ]);

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
        color: var(--quick-feedback-color, #30302e);
        font: inherit;
        white-space: nowrap;
        pointer-events: none;
      }

      .quick-feedback-success,
      .quick-feedback-failure {
        position: relative;
      }

      .quick-feedback-failure.quick-feedback-node::after {
        color: var(--danger, #b4232c);
      }

      @media (prefers-reduced-motion: reduce) {
        .quick-feedback-success,
        .quick-feedback-failure,
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
      if (state.promptSelectMode) return null;
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
      if (state.linkSelectMode) return null;
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
    node.classList.remove('quick-feedback-node', 'quick-feedback-failure');
    delete node.dataset.feedbackText;
    node.style.removeProperty('--quick-feedback-color');
  }

  function show(context, {
    duration = COPY_STANDARD_MS,
    text = '✓ コピー',
    status = 'success'
  } = {}) {
    if (!context) return;
    const previousTimer = timers.get(context.key);
    if (previousTimer) clearTimeout(previousTimer);

    requestAnimationFrame(() => {
      const target = context.locate();
      if (!target) return;
      const node = feedbackNode(target, context.mode);
      if (!node) return;

      clearFeedbackNode(node);
      node.style.setProperty('--quick-feedback-color', getComputedStyle(node).color);
      target.classList.remove('quick-feedback-success', 'quick-feedback-failure');
      target.classList.add(status === 'failure' ? 'quick-feedback-failure' : 'quick-feedback-success');
      node.classList.add('quick-feedback-node');
      if (status === 'failure') node.classList.add('quick-feedback-failure');
      node.dataset.feedbackText = text;

      const timer = setTimeout(() => {
        const currentTarget = context.locate();
        const currentNode = feedbackNode(currentTarget, context.mode);
        if (currentTarget) currentTarget.classList.remove('quick-feedback-success', 'quick-feedback-failure');
        clearFeedbackNode(currentNode);
        timers.delete(context.key);
      }, duration);
      timers.set(context.key, timer);
    });
  }

  function success(context, options) {
    show(context, { ...options, status: 'success' });
  }

  function failure(context, options) {
    show(context, { duration: COPY_STANDARD_MS, text: 'コピー失敗', ...options, status: 'failure' });
  }

  function elementContext(element, key = `element:${element?.id || 'anonymous'}`) {
    return element ? { key, locate: () => element.isConnected ? element : null, mode: 'button' } : null;
  }

  function successForButton(button, options) {
    success(contextFromButton(button) || elementContext(button), options);
  }

  function failureForButton(button, options) {
    failure(contextFromButton(button) || elementContext(button), options);
  }

  function deferRender(action, delay = COPY_TRANSITION_MS) {
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

  async function reliableCopyText(text, message = 'コピーしました') {
    const context = copyContextQueue.shift() || null;
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text ?? ''));
        copied = true;
      }
    } catch (_) {
      copied = false;
    }

    if (!copied) {
      let textarea = null;
      try {
        textarea = document.createElement('textarea');
        textarea.value = String(text ?? '');
        textarea.style.position = 'fixed';
        textarea.style.inset = '0 auto auto -9999px';
        textarea.style.opacity = '0';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy') === true;
      } catch (_) {
        copied = false;
      } finally {
        textarea?.remove();
      }
    }

    if (copied) {
      if (context) success(context);
      toast(message);
      return true;
    }

    if (context) failure(context);
    toast('コピーできませんでした');
    return false;
  }

  function runSaveWithFeedback(button, { modalId, action }) {
    if (!button || typeof action !== 'function' || button.dataset.saveFeedbackBusy === '1') return;
    button.dataset.saveFeedbackBusy = '1';
    button.setAttribute('aria-disabled', 'true');

    const originalCloseModal = closeModal;
    const originalToast = toast;
    let closeRequested = false;
    let saveSucceeded = false;

    closeModal = function(id) {
      if (id === modalId) {
        closeRequested = true;
        saveSucceeded = true;
        return;
      }
      return originalCloseModal(id);
    };

    toast = function(message, ...args) {
      if (saveSucceeded && message === '保存しました') return;
      return originalToast(message, ...args);
    };

    try {
      action();
    } catch (error) {
      console.error(error);
      failure(elementContext(button, `save:${modalId}`), { text: '保存失敗', duration: 1200 });
      originalToast('保存できませんでした');
    } finally {
      closeModal = originalCloseModal;
      toast = originalToast;
    }

    if (!closeRequested) {
      delete button.dataset.saveFeedbackBusy;
      button.removeAttribute('aria-disabled');
      return;
    }

    success(elementContext(button, `save:${modalId}`), {
      text: '✓ 保存しました',
      duration: SAVE_SUCCESS_MS
    });

    setTimeout(() => {
      delete button.dataset.saveFeedbackBusy;
      button.removeAttribute('aria-disabled');
      originalCloseModal(modalId);
    }, SAVE_SUCCESS_MS);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;

    const saveConfig = saveButtons.get(button.id);
    if (saveConfig) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runSaveWithFeedback(button, saveConfig);
      return;
    }

    const context = contextFromButton(button);
    if (context) copyContextQueue.push(context);
  }, true);

  ensureStyles();
  copyText = reliableCopyText;

  window.QuickLinksFeedback = {
    success,
    failure,
    successForButton,
    failureForButton,
    contextFromButton,
    deferRender,
    runSaveWithFeedback,
    timings: {
      copy: COPY_STANDARD_MS,
      transition: COPY_TRANSITION_MS,
      save: SAVE_SUCCESS_MS
    }
  };
})();
