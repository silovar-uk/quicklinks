(() => {
  const QUICK_MODAL_ID = 'quickUrlModal';
  const STATUS_ID = 'quickUrlStatus';
  const MICROLINK_TIMEOUT = 9000;
  const originalFetch = window.fetch.bind(window);
  const activeMetadataControllers = new Set();
  let suppressNextMetadataEditor = false;

  function statusElement() {
    return document.getElementById(STATUS_ID);
  }

  function quickModalElement() {
    return document.getElementById(QUICK_MODAL_ID);
  }

  function isQuickLoading() {
    return statusElement()?.classList.contains('loading') === true;
  }

  function getRequestUrl(input) {
    try {
      if (input instanceof Request) return new URL(input.url, location.href);
      return new URL(String(input), location.href);
    } catch (_) {
      return null;
    }
  }

  function shouldManageMetadataRequest(input) {
    if (!isQuickLoading()) return false;
    const url = getRequestUrl(input);
    if (!url || !/^https?:$/.test(url.protocol)) return false;
    return url.origin !== location.origin;
  }

  function mergeSignals(controller, upstreamSignal) {
    if (!upstreamSignal) return () => {};
    const abortFromUpstream = () => {
      if (!controller.signal.aborted) controller.abort(upstreamSignal.reason);
    };
    if (upstreamSignal.aborted) {
      abortFromUpstream();
      return () => {};
    }
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    return () => upstreamSignal.removeEventListener('abort', abortFromUpstream);
  }

  window.fetch = async function quickLoadingFetch(input, init = {}) {
    if (!shouldManageMetadataRequest(input)) return originalFetch(input, init);

    const requestUrl = getRequestUrl(input);
    const controller = new AbortController();
    const cleanupUpstream = mergeSignals(controller, init?.signal);
    const isMicrolink = requestUrl?.hostname === 'api.microlink.io';
    let timedOut = false;
    let timer = null;

    if (isMicrolink) {
      timer = setTimeout(() => {
        timedOut = true;
        if (!controller.signal.aborted) controller.abort();
      }, MICROLINK_TIMEOUT);
    }

    activeMetadataControllers.add(controller);

    try {
      return await originalFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new DOMException('Metadata request timed out', 'TimeoutError');
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      cleanupUpstream();
      activeMetadataControllers.delete(controller);
    }
  };

  function abortMetadataRequests() {
    for (const controller of activeMetadataControllers) {
      if (!controller.signal.aborted) controller.abort();
    }
    activeMetadataControllers.clear();
  }

  function syncStatusUi() {
    const status = statusElement();
    if (!status) return;

    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');

    const loading = status.classList.contains('loading');
    status.setAttribute('aria-busy', String(loading));

    if (!loading || status.querySelector('.loading-spinner')) return;

    const message = status.textContent.trim();
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'fetch-status-text';
    text.textContent = message;

    status.replaceChildren(spinner, text);
  }

  function markUserCancellation() {
    if (!isQuickLoading()) return;
    suppressNextMetadataEditor = true;
    abortMetadataRequests();
  }

  function wrapMetadataEditorOpen() {
    const originalOpenLinkModal = window.openLinkModal;
    if (typeof originalOpenLinkModal !== 'function') return;

    window.openLinkModal = function quickLoadingOpenLinkModal(item = null, options = {}) {
      if (suppressNextMetadataEditor && item == null && options?.skipClipboardAutofill === true) {
        suppressNextMetadataEditor = false;
        return;
      }
      return originalOpenLinkModal.apply(this, arguments);
    };
  }

  function install() {
    const status = statusElement();
    if (status) {
      const observer = new MutationObserver(syncStatusUi);
      observer.observe(status, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class']
      });
      syncStatusUi();
    }

    document.addEventListener('click', event => {
      const closeButton = event.target.closest?.('[data-close-modal="quickUrlModal"]');
      const modal = quickModalElement();
      const clickedBackdrop = modal && event.target === modal;
      if (closeButton || clickedBackdrop) markUserCancellation();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const modal = quickModalElement();
      if (modal?.classList.contains('open')) markUserCancellation();
    }, true);

    wrapMetadataEditorOpen();
  }

  install();
})();
