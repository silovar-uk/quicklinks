(() => {
  let pendingQuickProject;

  function contextProject() {
    const current = String(state.currentProject || '').trim();
    return current && current !== 'ALL' ? current : '';
  }

  function syncSelect(inputId, selectId, value) {
    const input = $(inputId);
    const select = $(selectId);
    if (!input || !select) return;
    input.value = value;
    select.value = state.projects.includes(value) ? value : '';
  }

  function prioritizeLinkProject() {
    const modal = $('linkModal');
    const sheet = modal?.querySelector('.modal-sheet');
    const hiddenId = $('linkId');
    const projectInput = $('linkProject');
    const projectRow = projectInput?.closest('.form-row');
    if (!modal || !sheet || !hiddenId || !projectRow) return;

    if (projectRow.previousElementSibling !== hiddenId) {
      sheet.insertBefore(projectRow, hiddenId.nextSibling);
    }
    projectRow.classList.add('classification-priority');
    projectInput.placeholder = '分類を選択 / 入力（未選択可）';
  }

  function rememberQuickProject() {
    pendingQuickProject = $('quickUrlProject')?.value.trim() ?? '';
  }

  prioritizeLinkProject();

  const originalOpenQuickAdd = openYamlAddModal;
  openYamlAddModal = function(...args) {
    originalOpenQuickAdd(...args);
    const inherited = contextProject();
    syncSelect('quickUrlProject', 'quickUrlProjectSelect', inherited);
    pendingQuickProject = undefined;
  };

  $('fetchQuickUrlBtn')?.addEventListener('click', rememberQuickProject, true);
  $('manualQuickUrlBtn')?.addEventListener('click', rememberQuickProject, true);
  $('quickUrlInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) rememberQuickProject();
  }, true);

  const linkModal = $('linkModal');
  if (linkModal) {
    const observer = new MutationObserver(() => {
      if (!linkModal.classList.contains('open')) return;

      prioritizeLinkProject();
      linkModal.scrollTop = 0;

      if (pendingQuickProject !== undefined) {
        const value = pendingQuickProject;
        queueMicrotask(() => {
          syncSelect('linkProject', 'linkProjectSelect', value);
          linkModal.scrollTop = 0;
          pendingQuickProject = undefined;
        });
      }
    });
    observer.observe(linkModal, { attributes: true, attributeFilter: ['class'] });
  }
})();
