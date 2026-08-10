(() => {
  'use strict';

  const rawSaved = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  })();

  function cleanName(value, fallback = '未分類') {
    return String(value || '').trim() || fallback;
  }

  function unionNames(stored, derived) {
    const result = [];
    [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(derived) ? derived : [])].forEach(value => {
      const name = cleanName(value);
      if (!result.includes(name)) result.push(name);
    });
    if (!result.length) result.push('未分類');
    return result;
  }

  normalizeProjects = function(projects, items = state.items) {
    const derived = (Array.isArray(items) ? items : [])
      .filter(item => !item?.archived)
      .map(item => cleanName(item?.projectName));
    return unionNames(projects, derived);
  };

  normalizePromptCategories = function(categories, memos = state.promptMemos) {
    const derived = (Array.isArray(memos) ? memos : [])
      .map(memo => cleanName(memo?.categoryName || memo?.projectName));
    return unionNames(categories, derived);
  };

  state.projects = normalizeProjects(rawSaved?.projects || state.projects, state.items);
  state.promptCategories = normalizePromptCategories(rawSaved?.promptCategories || state.promptCategories, state.promptMemos);

  matchesSearch = function(values) {
    const terms = normalizeString(state.query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystacks = values.map(value => normalizeString(value));
    return terms.every(term => haystacks.some(value => value.includes(term)));
  };

  highlight = function(value) {
    const raw = String(value || '');
    const terms = String(state.query || '').trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return escapeHtml(raw);
    const escapedTerms = [...new Set(terms)]
      .sort((a, b) => b.length - a.length)
      .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!escapedTerms.length) return escapeHtml(raw);
    try {
      const re = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
      return raw.split(re).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
    } catch (_) {
      return escapeHtml(raw);
    }
  };

  renderProjectManager = function() {
    const el = $('projectManager');
    if (!el) return;
    const counts = countNames(state.items, item => item.projectName || '未分類');
    const names = normalizeProjects(state.projects, state.items);
    el.innerHTML = names.map(name => {
      const encoded = encodeURIComponent(name);
      const count = counts.get(name) || 0;
      const disabledMerge = names.length <= 1 ? 'disabled' : '';
      return `
        <div class="category-manage-row" data-project-name="${encoded}">
          <div class="category-manage-head"><span class="badge" style="${badgeStyle(name)}">${escapeHtml(name)}</span><span class="category-count">${count.toLocaleString()}件</span></div>
          <div class="category-action-grid"><input class="input" data-role="project-rename" value="${escapeHtml(name)}" /><button class="btn ghost compact" data-project-action="rename" type="button">名前変更</button></div>
          <div class="category-action-grid"><select class="select" data-role="project-merge-target" ${disabledMerge}>${optionHtml(names, name, '統合先を選ぶ')}</select><button class="btn danger compact" data-project-action="merge" type="button" ${disabledMerge}>統合</button></div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-project-action="rename"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('[data-project-name]');
      renameProject(decodeURIComponent(row.dataset.projectName || ''), row.querySelector('[data-role="project-rename"]').value);
    }));
    el.querySelectorAll('[data-project-action="merge"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('[data-project-name]');
      mergeProject(decodeURIComponent(row.dataset.projectName || ''), row.querySelector('[data-role="project-merge-target"]').value);
    }));
  };

  renderPromptCategoryManager = function() {
    const el = $('promptCategoryManager');
    if (!el) return;
    const counts = countNames(state.promptMemos, memo => memo.categoryName || memo.projectName || '未分類');
    const names = normalizePromptCategories(state.promptCategories, state.promptMemos);
    el.innerHTML = names.map(name => {
      const encoded = encodeURIComponent(name);
      const count = counts.get(name) || 0;
      const disabledMerge = names.length <= 1 ? 'disabled' : '';
      return `
        <div class="category-manage-row" data-prompt-category="${encoded}">
          <div class="category-manage-head"><span class="badge" style="${promptBadgeStyle(name)}">${escapeHtml(name)}</span><span class="category-count">${count.toLocaleString()}件</span></div>
          <div class="category-action-grid"><input class="input" data-role="prompt-category-rename" value="${escapeHtml(name)}" /><button class="btn ghost compact" data-prompt-category-action="rename" type="button">名前変更</button></div>
          <div class="category-action-grid"><select class="select" data-role="prompt-category-merge-target" ${disabledMerge}>${optionHtml(names, name, '統合先を選ぶ')}</select><button class="btn danger compact" data-prompt-category-action="merge" type="button" ${disabledMerge}>統合</button></div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-prompt-category-action="rename"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('[data-prompt-category]');
      renamePromptCategory(decodeURIComponent(row.dataset.promptCategory || ''), row.querySelector('[data-role="prompt-category-rename"]').value);
    }));
    el.querySelectorAll('[data-prompt-category-action="merge"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('[data-prompt-category]');
      mergePromptCategory(decodeURIComponent(row.dataset.promptCategory || ''), row.querySelector('[data-role="prompt-category-merge-target"]').value);
    }));
  };

  renameProject = function(oldName, newNameRaw) {
    const newName = cleanName(newNameRaw);
    if (!oldName) return;
    if (newName === oldName) return toast('分類名は変更されていません');
    if (!confirm(`リンク分類「${oldName}」を「${newName}」に変更しますか？`)) return;
    state.items.forEach(item => { if (cleanName(item.projectName) === oldName) item.projectName = newName; });
    state.projects = unionNames(state.projects.map(name => name === oldName ? newName : name), []);
    if (state.projectColors[oldName] && !state.projectColors[newName]) state.projectColors[newName] = state.projectColors[oldName];
    delete state.projectColors[oldName];
    if (state.currentProject === oldName) state.currentProject = newName;
    state.linkPage = 1;
    save(); render(); toast('分類名を変更しました');
  };

  mergeProject = function(fromName, toNameRaw) {
    const toName = cleanName(toNameRaw, '');
    if (!fromName || !toName) return toast('統合先を選んでください');
    if (fromName === toName) return;
    const count = state.items.filter(item => cleanName(item.projectName) === fromName).length;
    if (!confirm(`リンク分類「${fromName}」${count}件を「${toName}」へ統合しますか？`)) return;
    state.items.forEach(item => { if (cleanName(item.projectName) === fromName) item.projectName = toName; });
    state.projects = unionNames(state.projects.filter(name => name !== fromName), [toName]);
    delete state.projectColors[fromName];
    if (state.currentProject === fromName) state.currentProject = toName;
    state.linkPage = 1;
    save(); render(); toast('分類を統合しました');
  };

  renamePromptCategory = function(oldName, newNameRaw) {
    const newName = cleanName(newNameRaw);
    if (!oldName) return;
    if (newName === oldName) return toast('カテゴリ名は変更されていません');
    if (!confirm(`プロンプトカテゴリ「${oldName}」を「${newName}」に変更しますか？`)) return;
    state.promptMemos.forEach(memo => { if (cleanName(memo.categoryName) === oldName) memo.categoryName = newName; });
    state.promptCategories = unionNames(state.promptCategories.map(name => name === oldName ? newName : name), []);
    if (state.currentPromptCategory === oldName) state.currentPromptCategory = newName;
    state.promptPage = 1;
    save(); render(); toast('カテゴリ名を変更しました');
  };

  mergePromptCategory = function(fromName, toNameRaw) {
    const toName = cleanName(toNameRaw, '');
    if (!fromName || !toName) return toast('統合先を選んでください');
    if (fromName === toName) return;
    const count = state.promptMemos.filter(memo => cleanName(memo.categoryName) === fromName).length;
    if (!confirm(`プロンプトカテゴリ「${fromName}」${count}件を「${toName}」へ統合しますか？`)) return;
    state.promptMemos.forEach(memo => { if (cleanName(memo.categoryName) === fromName) memo.categoryName = toName; });
    state.promptCategories = unionNames(state.promptCategories.filter(name => name !== fromName), [toName]);
    if (state.currentPromptCategory === fromName) state.currentPromptCategory = toName;
    state.promptPage = 1;
    save(); render(); toast('カテゴリを統合しました');
  };

  function cleanEmptyProjectsExplicitly() {
    const used = new Set(state.items.filter(item => !item.archived).map(item => cleanName(item.projectName)));
    const before = state.projects.length;
    state.projects = state.projects.filter(name => used.has(name));
    if (!state.projects.length) state.projects = ['未分類'];
    state.projectColors = Object.fromEntries(Object.entries(state.projectColors || {}).filter(([name]) => state.projects.includes(name)));
    if (state.currentProject !== 'ALL' && !state.projects.includes(state.currentProject)) state.currentProject = 'ALL';
    const removed = Math.max(before - state.projects.length, 0);
    save(); render(); toast(removed ? `0件分類を${removed}件削除しました` : '0件分類はありません');
  }

  function cleanEmptyPromptCategoriesExplicitly() {
    const used = new Set(state.promptMemos.map(memo => cleanName(memo.categoryName || memo.projectName)));
    const before = state.promptCategories.length;
    state.promptCategories = state.promptCategories.filter(name => used.has(name));
    if (!state.promptCategories.length) state.promptCategories = ['未分類'];
    if (state.currentPromptCategory !== 'ALL' && !state.promptCategories.includes(state.currentPromptCategory)) state.currentPromptCategory = 'ALL';
    const removed = Math.max(before - state.promptCategories.length, 0);
    save(); render(); toast(removed ? `0件カテゴリを${removed}件削除しました` : '0件カテゴリはありません');
  }

  function intercept(id, handler) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      handler();
    }, true);
  }

  intercept('cleanEmptyProjectsBtn', cleanEmptyProjectsExplicitly);
  intercept('cleanEmptyPromptCategoriesBtn', cleanEmptyPromptCategoriesExplicitly);

  const baseLinkBulk = renderLinkBulkBar;
  renderLinkBulkBar = function(list) {
    if (!state.linkSelectMode) {
      const el = $('linkBulkBar');
      el?.classList.remove('show');
      if (el) el.innerHTML = '';
      return;
    }
    baseLinkBulk(list);
  };

  const basePromptBulk = renderPromptBulkBar;
  renderPromptBulkBar = function(list) {
    if (!state.promptSelectMode) {
      const el = $('promptBulkBar');
      el?.classList.remove('show');
      if (el) el.innerHTML = '';
      return;
    }
    basePromptBulk(list);
  };

  window.QuickLinksPrecisionData = {
    deleteLink(id) {
      const item = state.items.find(link => link.id === id);
      if (!item) return;
      if (!confirm(`リンク「${item.title || '無題'}」を削除しますか？`)) return;
      state.items = state.items.filter(link => link.id !== id);
      save(); render(); toast('削除しました');
    }
  };
})();
