(() => {
  let pendingQuickProject;

  function contextProject() {
    const current = String(state.currentProject || '').trim();
    return current && current !== 'ALL' && state.projects.includes(current) ? current : '';
  }

  function setClassification(inputId, selectId, value) {
    const input = $(inputId);
    const select = $(selectId);
    if (!input || !select) return;
    const normalized = String(value || '').trim();
    if (normalized && state.projects.includes(normalized)) {
      select.value = normalized;
      input.value = '';
    } else {
      select.value = '';
      input.value = normalized;
    }
  }

  function resolvedClassification(inputId, selectId) {
    const input = $(inputId);
    const select = $(selectId);
    return input?.value.trim() || select?.value.trim() || '';
  }

  function enhanceClassification(inputId, selectId) {
    const input = $(inputId);
    const select = $(selectId);
    const grid = input?.closest('.category-input-grid');
    if (!input || !select || !grid || grid.classList.contains('classification-stack')) return;

    input.removeAttribute('list');
    input.placeholder = '未分類（必要なら新しい分類名を入力）';

    const existing = document.createElement('div');
    existing.className = 'classification-control classification-existing';
    const existingLabel = document.createElement('div');
    existingLabel.className = 'classification-control-label';
    existingLabel.textContent = '既存の分類から選ぶ';

    const fresh = document.createElement('div');
    fresh.className = 'classification-control classification-new';
    const freshLabel = document.createElement('div');
    freshLabel.className = 'classification-control-label';
    freshLabel.textContent = '新しい分類を入力';

    grid.classList.add('classification-stack');
    grid.textContent = '';
    existing.append(existingLabel, select);
    fresh.append(freshLabel, input);
    grid.append(existing, fresh);
  }

  function prioritizeLinkProject() {
    const modal = $('linkModal');
    const sheet = modal?.querySelector('.modal-sheet');
    const hiddenId = $('linkId');
    const projectInput = $('linkProject');
    const projectRow = projectInput?.closest('.form-row');
    if (!modal || !sheet || !hiddenId || !projectRow) return;

    const container = hiddenId.parentElement?.classList.contains('modal-scroll-body') ? hiddenId.parentElement : sheet;
    if (projectRow.parentElement !== container || projectRow.previousElementSibling !== hiddenId) {
      container.insertBefore(projectRow, hiddenId.nextSibling);
    }
    projectRow.classList.add('classification-priority');
    enhanceClassification('linkProject', 'linkProjectSelect');
  }

  function makeModalScrollable(modalId) {
    const modal = $(modalId);
    const sheet = modal?.querySelector('.modal-sheet');
    const head = sheet?.querySelector(':scope > .modal-head');
    const actions = sheet?.querySelector(':scope > .modal-actions');
    if (!modal || !sheet || !head || !actions || sheet.querySelector(':scope > .modal-scroll-body')) return;

    const body = document.createElement('div');
    body.className = 'modal-scroll-body';
    const children = Array.from(sheet.children);
    children.forEach(child => {
      if (child !== head && child !== actions) body.appendChild(child);
    });
    head.classList.add('modal-fixed-head');
    actions.classList.add('modal-fixed-actions');
    sheet.insertBefore(body, actions);
  }

  function rememberQuickProject() {
    const resolved = resolvedClassification('quickUrlProject', 'quickUrlProjectSelect');
    pendingQuickProject = resolved;
    const input = $('quickUrlProject');
    if (input && !input.value.trim() && resolved) input.value = resolved;
  }

  enhanceClassification('quickUrlProject', 'quickUrlProjectSelect');
  prioritizeLinkProject();
  makeModalScrollable('quickUrlModal');
  makeModalScrollable('linkModal');

  const quickProjectInput = $('quickUrlProject');
  const quickProjectSelect = $('quickUrlProjectSelect');
  quickProjectSelect?.addEventListener('change', () => {
    if (quickProjectSelect.value) quickProjectInput.value = '';
  });
  quickProjectInput?.addEventListener('input', () => {
    if (quickProjectInput.value.trim()) quickProjectSelect.value = '';
  });

  const linkProjectInput = $('linkProject');
  const linkProjectSelect = $('linkProjectSelect');
  linkProjectSelect?.addEventListener('change', () => {
    if (linkProjectSelect.value) linkProjectInput.value = '';
  });
  linkProjectInput?.addEventListener('input', () => {
    if (linkProjectInput.value.trim()) linkProjectSelect.value = '';
  });

  const quickUrlModal = $('quickUrlModal');
  if (quickUrlModal) {
    const quickObserver = new MutationObserver(() => {
      if (!quickUrlModal.classList.contains('open')) return;
      setClassification('quickUrlProject', 'quickUrlProjectSelect', contextProject());
      pendingQuickProject = undefined;
      const body = quickUrlModal.querySelector('.modal-scroll-body');
      if (body) body.scrollTop = 0;
    });
    quickObserver.observe(quickUrlModal, { attributes: true, attributeFilter: ['class'] });
  }

  $('fetchQuickUrlBtn')?.addEventListener('click', rememberQuickProject, true);
  $('manualQuickUrlBtn')?.addEventListener('click', rememberQuickProject, true);
  $('quickUrlInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) rememberQuickProject();
  }, true);

  const saveButton = $('saveLinkBtn');
  saveButton?.addEventListener('click', () => {
    if (!$('linkProject')?.value.trim() && $('linkProjectSelect')?.value) {
      $('linkProject').value = $('linkProjectSelect').value;
    }
  }, true);

  const linkModal = $('linkModal');
  if (linkModal) {
    const observer = new MutationObserver(() => {
      if (!linkModal.classList.contains('open')) return;

      prioritizeLinkProject();
      makeModalScrollable('linkModal');
      const body = linkModal.querySelector('.modal-scroll-body');
      if (body) body.scrollTop = 0;

      if (pendingQuickProject !== undefined) {
        const value = pendingQuickProject;
        queueMicrotask(() => {
          setClassification('linkProject', 'linkProjectSelect', value);
          if (body) body.scrollTop = 0;
          pendingQuickProject = undefined;
        });
      } else {
        queueMicrotask(() => {
          const current = $('linkProject')?.value.trim() || '';
          if (current && state.projects.includes(current)) setClassification('linkProject', 'linkProjectSelect', current);
        });
      }
    });
    observer.observe(linkModal, { attributes: true, attributeFilter: ['class'] });
  }
})();
