(() => {
  'use strict';

  const focusReturn = new Map();

  document.querySelectorAll('.modal').forEach((modal, index) => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const title = modal.querySelector('.modal-title');
    if (title) {
      if (!title.id) title.id = `${modal.id || `modal-${index}`}-title`;
      modal.setAttribute('aria-labelledby', title.id);
    }
    modal.querySelector('.modal-close')?.setAttribute('aria-label', '閉じる');
  });

  const baseOpenModal = openModal;
  const baseCloseModal = closeModal;

  openModal = function(id) {
    focusReturn.set(id, document.activeElement);
    baseOpenModal(id);
    const modal = $(id);
    requestAnimationFrame(() => {
      const preferred = modal?.querySelector('input:not([type="hidden"]), textarea, select, button:not([disabled]), [href]');
      preferred?.focus?.({ preventScroll: true });
    });
  };

  closeModal = function(id) {
    baseCloseModal(id);
    const previous = focusReturn.get(id);
    focusReturn.delete(id);
    requestAnimationFrame(() => previous?.focus?.({ preventScroll: true }));
  };

  const toastEl = $('toast');
  toastEl?.setAttribute('role', 'status');
  toastEl?.setAttribute('aria-live', 'polite');
  toastEl?.setAttribute('aria-atomic', 'true');

  document.addEventListener('keydown', event => {
    const actionBackdrop = $('precisionActionMenuBackdrop');
    if (event.key === 'Escape' && actionBackdrop && !actionBackdrop.hidden) {
      event.preventDefault();
      window.QuickLinksPrecisionUI?.closeActionMenu();
      return;
    }

    const openModals = [...document.querySelectorAll('.modal.open')];
    const modal = openModals.at(-1);
    if (!modal) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(modal.id);
      return;
    }

    if (event.key !== 'Tab') return;
    const focusables = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.hidden && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  render();
})();
