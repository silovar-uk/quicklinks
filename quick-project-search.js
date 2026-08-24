(() => {
  'use strict';

  const modal = document.getElementById('quickUrlModal');
  const searchInput = document.getElementById('quickProjectSearch');
  const clearButton = document.getElementById('quickProjectSearchClear');
  const searchMeta = document.getElementById('quickProjectSearchMeta');
  const projectSelect = document.getElementById('quickUrlProjectSelect');
  const projectInput = document.getElementById('quickUrlProject');
  const projectList = document.getElementById('quickUrlProjectList');
  const projectSort = document.getElementById('quickProjectSort');
  const recents = document.getElementById('quickProjectRecents');
  const recentButtons = document.getElementById('quickProjectRecentButtons');

  if (!modal || !searchInput || !projectSelect || !projectInput || !projectList) return;

  let sourceOptions = [];

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('ja')
      .trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function captureSourceOptions() {
    sourceOptions = Array.from(projectSelect.options)
      .slice(1)
      .map(option => ({ value: option.value, label: option.textContent || option.value }))
      .filter(option => option.value);
  }

  function setSearchMeta(query, count) {
    const searching = Boolean(query);
    if (clearButton) clearButton.hidden = !searching;
    if (!searchMeta) return;

    if (!searching) {
      searchMeta.hidden = true;
      searchMeta.textContent = '';
      return;
    }

    searchMeta.hidden = false;
    searchMeta.textContent = count
      ? `${count}件の分類が見つかりました`
      : '一致する分類はありません。下の「新しい分類を入力」から追加できます。';
  }

  function renderFilteredOptions() {
    const query = normalize(searchInput.value);
    const filtered = query
      ? sourceOptions.filter(option => normalize(option.value).includes(query))
      : sourceOptions;

    const currentValue = projectInput.value.trim();
    const placeholder = query
      ? (filtered.length ? `検索結果（${filtered.length}件）` : '一致する分類なし')
      : '既存分類から選ぶ';

    projectSelect.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + filtered
      .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    projectSelect.disabled = filtered.length === 0;

    projectList.innerHTML = filtered
      .map(option => `<option value="${escapeHtml(option.value)}"></option>`)
      .join('');

    if (filtered.some(option => option.value === currentValue)) {
      projectSelect.value = currentValue;
    } else {
      projectSelect.value = '';
    }

    if (recents) recents.hidden = query ? true : sourceOptions.length < 4;
    setSearchMeta(query, filtered.length);
  }

  function refreshSourceAndRender() {
    captureSourceOptions();
    renderFilteredOptions();
  }

  function clearSearch({ keepSelection = true } = {}) {
    if (!searchInput.value && !projectSelect.disabled) return;
    searchInput.value = '';
    renderFilteredOptions();
    if (keepSelection) {
      const value = projectInput.value.trim();
      if (sourceOptions.some(option => option.value === value)) projectSelect.value = value;
    }
  }

  searchInput.addEventListener('input', renderFilteredOptions);
  searchInput.addEventListener('search', renderFilteredOptions);

  clearButton?.addEventListener('click', () => {
    clearSearch();
    searchInput.focus();
  });

  projectSelect.addEventListener('change', event => {
    if (!event.target.value) return;
    const selected = event.target.value;
    clearSearch({ keepSelection: false });
    projectSelect.value = selected;
  });

  projectSort?.addEventListener('change', () => {
    setTimeout(refreshSourceAndRender, 0);
  });

  recentButtons?.addEventListener('click', event => {
    if (!event.target.closest('[data-quick-project]')) return;
    setTimeout(() => clearSearch(), 0);
  });

  const observer = new MutationObserver(() => {
    if (!modal.classList.contains('open')) return;
    searchInput.value = '';
    setTimeout(refreshSourceAndRender, 0);
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
})();
