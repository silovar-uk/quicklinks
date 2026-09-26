(() => {
  'use strict';

  const root = document.documentElement;
  const mobileQuery = window.matchMedia('(max-width: 719px)');
  const editableSelector = 'input, textarea, select, [contenteditable="true"]';
  let frame = 0;
  let baselineHeight = 0;
  let navObserver = null;
  const tabScroll = { links: 0, prompts: 0, settings: 0 };
  let lastTab = typeof state !== 'undefined' ? state.activeTab : 'links';

  function viewportHeight() {
    const visualHeight = window.visualViewport?.height;
    const fallback = window.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(0, Math.round(Number.isFinite(visualHeight) ? visualHeight : fallback));
  }

  function isEditableFocus() {
    const active = document.activeElement;
    return Boolean(active && active.matches?.(editableSelector));
  }

  function applyShellMetrics() {
    frame = 0;

    if (!mobileQuery.matches) {
      root.classList.remove('quick-mobile-shell', 'quick-keyboard-open');
      root.style.removeProperty('--quick-shell-height');
      root.style.removeProperty('--quick-bottom-nav-size');
      baselineHeight = 0;
      return;
    }

    root.classList.add('quick-mobile-shell');

    const height = viewportHeight();
    if (height > 0) {
      root.style.setProperty('--quick-shell-height', height + 'px');
    }

    const nav = document.querySelector('.tabs');
    if (nav) {
      const navHeight = Math.ceil(nav.getBoundingClientRect().height);
      if (navHeight > 0) root.style.setProperty('--quick-bottom-nav-size', navHeight + 'px');
    }

    const editable = isEditableFocus();
    if (!editable && height > 0) baselineHeight = Math.max(baselineHeight, height);
    if (!baselineHeight && height > 0) baselineHeight = Math.max(height, window.innerHeight || 0);

    const keyboardOpen = Boolean(
      editable &&
      baselineHeight > 0 &&
      height > 0 &&
      height < baselineHeight * 0.78
    );
    root.classList.toggle('quick-keyboard-open', keyboardOpen);
  }

  function scheduleShellMetrics() {
    if (frame) return;
    frame = requestAnimationFrame(applyShellMetrics);
  }

  function observeNavigation() {
    navObserver?.disconnect?.();
    const nav = document.querySelector('.tabs');
    if (!nav || !('ResizeObserver' in window)) return;
    navObserver = new ResizeObserver(scheduleShellMetrics);
    navObserver.observe(nav);
  }

  mobileQuery.addEventListener?.('change', () => {
    baselineHeight = 0;
    observeNavigation();
    scheduleShellMetrics();
  });

  window.addEventListener('resize', scheduleShellMetrics, { passive: true });
  window.addEventListener('orientationchange', () => {
    baselineHeight = 0;
    scheduleShellMetrics();
  }, { passive: true });
  document.addEventListener('focusin', scheduleShellMetrics, true);
  document.addEventListener('focusout', () => setTimeout(scheduleShellMetrics, 0), true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleShellMetrics, { passive: true });
  }

  document.addEventListener('click', event => {
    if (!mobileQuery.matches) return;
    const tab = event.target.closest?.('.tab-btn[data-tab]');
    if (!tab) return;
    const main = document.querySelector('main');
    if (!main) return;
    const nextTab = tab.dataset.tab || 'links';
    if (lastTab && lastTab !== nextTab) tabScroll[lastTab] = main.scrollTop;
    lastTab = nextTab;
    requestAnimationFrame(() => {
      const currentMain = document.querySelector('main');
      if (currentMain) currentMain.scrollTop = tabScroll[nextTab] || 0;
    });
  });

  observeNavigation();
  scheduleShellMetrics();

  window.QuickLinksMobileShell = {
    refresh: scheduleShellMetrics,
    viewportHeight,
    isActive: () => mobileQuery.matches
  };
})();