(() => {
  'use strict';

  const mode = { links: false, prompts: false };
  let returnFocus = null;
  let undoState = null;
  let undoTimer = null;
  let dragState = null;

  const config = {
    links: {
      label: '分類',
      itemLabel: 'リンク',
      chipsId: 'linkChips',
      names: () => [...new Set((state.projects || []).map(value => String(value || '未分類').trim() || '未分類'))],
      count: name => (state.items || []).filter(item => !item.archived && (item.projectName || '未分類') === name).length,
      style: name => typeof badgeStyle === 'function' ? badgeStyle(name) : '',
      current: () => state.currentProject,
      setCurrent: value => { state.currentProject = value; },
      pageReset: () => { state.linkPage = 1; }
    },
    prompts: {
      label: 'カテゴリ',
      itemLabel: 'プロンプト',
      chipsId: 'promptChips',
      names: () => [...new Set((state.promptCategories || []).map(value => String(value || '未分類').trim() || '未分類'))],
      count: name => (state.promptMemos || []).filter(memo => (memo.categoryName || '未分類') === name).length,
      style: name => typeof promptBadgeStyle === 'function' ? promptBadgeStyle(name) : '',
      current: () => state.currentPromptCategory,
      setCurrent: value => { state.currentPromptCategory = value; },
      pageReset: () => { state.promptPage = 1; }
    }
  };

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function encoded(value) {
    return encodeURIComponent(String(value ?? ''));
  }

  function decoded(value) {
    try { return decodeURIComponent(String(value || '')); }
    catch (_) { return String(value || ''); }
  }

  function notifyChange(reason) {
    window.dispatchEvent(new CustomEvent('quicklinks-content-changed', { detail: { reason } }));
  }

  function ensureUi() {
    if (!document.getElementById('categoryOrganizerModal')) {
      const modal = document.createElement('div');
      modal.id = 'categoryOrganizerModal';
      modal.className = 'modal category-organizer-modal';
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML =
        '<div class="modal-sheet category-organizer-sheet" role="dialog" aria-modal="true" aria-labelledby="categoryOrganizerTitle">' +
          '<div class="modal-head">' +
            '<h2 class="modal-title" id="categoryOrganizerTitle">分類を整理</h2>' +
            '<button class="modal-close" id="categoryOrganizerClose" type="button" aria-label="閉じる">×</button>' +
          '</div>' +
          '<div id="categoryOrganizerBody"></div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', event => {
        if (event.target === modal) closeOrganizerModal();
      });
      document.getElementById('categoryOrganizerClose')?.addEventListener('click', closeOrganizerModal);
    }

    if (!document.getElementById('categoryOrganizerSnackbar')) {
      const snackbar = document.createElement('div');
      snackbar.id = 'categoryOrganizerSnackbar';
      snackbar.className = 'category-organizer-snackbar';
      snackbar.setAttribute('role', 'status');
      snackbar.setAttribute('aria-live', 'polite');
      document.body.appendChild(snackbar);
    }
  }

  function openOrganizerModal(title, html, anchor) {
    ensureUi();
    returnFocus = anchor || document.activeElement;
    const titleEl = document.getElementById('categoryOrganizerTitle');
    const body = document.getElementById('categoryOrganizerBody');
    const modal = document.getElementById('categoryOrganizerModal');
    titleEl.textContent = title;
    body.innerHTML = html;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => body.querySelector('input, select, button')?.focus());
  }

  function closeOrganizerModal() {
    const modal = document.getElementById('categoryOrganizerModal');
    if (!modal?.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    const target = returnFocus;
    returnFocus = null;
    requestAnimationFrame(() => target?.focus?.());
  }

  function showSnackbar(message, undo) {
    ensureUi();
    const snackbar = document.getElementById('categoryOrganizerSnackbar');
    clearTimeout(snackbar._timer);
    snackbar.innerHTML =
      '<span class="category-organizer-snackbar-text">' + esc(message) + '</span>' +
      (undo ? '<button type="button" class="category-organizer-undo">元に戻す</button>' : '');
    snackbar.classList.add('show');

    const undoButton = snackbar.querySelector('.category-organizer-undo');
    if (undoButton && undo) {
      undoButton.addEventListener('click', () => {
        clearTimeout(undoTimer);
        undo();
        snackbar.classList.remove('show');
      }, { once: true });
    }

    snackbar._timer = setTimeout(() => snackbar.classList.remove('show'), undo ? 8000 : 2800);
  }

  function candidateKey(name) {
    return String(name || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\u3000・･._\-_/\\]+/g, '')
      .trim();
  }

  function similarPairs(kind) {
    const names = config[kind].names();
    const groups = new Map();
    names.forEach(name => {
      const key = candidateKey(name);
      if (!key) return;
      const list = groups.get(key) || [];
      list.push(name);
      groups.set(key, list);
    });
    return [...groups.values()].filter(list => list.length > 1);
  }

  function enterMode(kind) {
    mode[kind] = true;
    render();
  }

  function leaveMode(kind) {
    mode[kind] = false;
    dragState = null;
    render();
  }

  function decorateKind(kind) {
    const c = config[kind];
    const chips = document.getElementById(c.chipsId);
    if (!chips) return;

    if (!mode[kind]) {
      chips.classList.remove('category-organizer-active');
      if (chips.querySelector('[data-category-organizer-toggle]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip category-organizer-toggle';
      button.dataset.categoryOrganizerToggle = kind;
      button.setAttribute('aria-label', (kind === 'links' ? 'リンク分類' : 'プロンプトカテゴリ') + 'を整理');
      button.textContent = '整理';
      button.addEventListener('click', () => enterMode(kind));
      chips.appendChild(button);
      return;
    }

    renderOrganizer(kind, chips);
  }

  function renderOrganizer(kind, chips) {
    const c = config[kind];
    const names = c.names();
    const pairs = similarPairs(kind);
    const desktopDrag = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    chips.classList.add('category-organizer-active');

    const pairHtml = pairs.length
      ? '<button type="button" class="category-organizer-candidate" data-category-candidate="' + kind + '">' +
          '似た' + c.label + 'があります <strong>' + pairs.length + '組</strong>' +
        '</button>'
      : '';

    const rows = names.map(name => {
      const count = c.count(name);
      const code = encoded(name);
      return (
        '<div class="category-organizer-row" data-category-kind="' + kind + '" data-category-name="' + esc(code) + '">' +
          (desktopDrag ? '<span class="category-organizer-drag" draggable="true" title="ドラッグして統合先を選ぶ" aria-hidden="true">⋮⋮</span>' : '') +
          '<span class="badge category-organizer-badge" style="' + esc(c.style(name)) + '">' + esc(name) + '</span>' +
          '<span class="category-organizer-count">' + count.toLocaleString() + '件</span>' +
          '<button type="button" class="category-organizer-more" data-category-action-menu="' + esc(code) + '" aria-label="' + esc(name) + 'の操作">•••</button>' +
        '</div>'
      );
    }).join('');

    chips.innerHTML =
      '<div class="category-organizer-toolbar">' +
        '<div class="category-organizer-toolbar-copy">' +
          '<strong>' + esc(c.label) + 'を整理</strong>' +
          '<span>' + names.length.toLocaleString() + c.label + (desktopDrag ? ' · つかんで別の' + c.label + 'へ移動できます' : '') + '</span>' +
        '</div>' +
        '<button type="button" class="btn ghost compact" data-category-organizer-done="' + kind + '">完了</button>' +
      '</div>' +
      pairHtml +
      '<div class="category-organizer-grid">' + rows + '</div>';

    chips.querySelector('[data-category-organizer-done]')?.addEventListener('click', () => leaveMode(kind));
    chips.querySelectorAll('[data-category-action-menu]').forEach(button => {
      button.addEventListener('click', () => openActions(kind, decoded(button.dataset.categoryActionMenu), button));
    });

    chips.querySelector('[data-category-candidate]')?.addEventListener('click', event => {
      const first = pairs[0];
      if (!first || first.length < 2) return;
      openMergeDialog(kind, first[0], first[1], event.currentTarget, '表記が近い' + c.label + 'を見つけました。内容を確認して統合できます。');
    });

    if (desktopDrag) bindDrag(kind, chips);
  }

  function bindDrag(kind, chips) {
    chips.querySelectorAll('.category-organizer-drag').forEach(handle => {
      handle.addEventListener('dragstart', event => {
        const row = handle.closest('.category-organizer-row');
        const fromName = decoded(row?.dataset.categoryName);
        if (!fromName) return;
        dragState = { kind, fromName };
        row.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(dragState));
      });
      handle.addEventListener('dragend', () => {
        dragState = null;
        chips.querySelectorAll('.is-drop-target, .is-dragging').forEach(node => node.classList.remove('is-drop-target', 'is-dragging'));
      });
    });

    chips.querySelectorAll('.category-organizer-row').forEach(row => {
      row.addEventListener('dragover', event => {
        if (!dragState || dragState.kind !== kind) return;
        const toName = decoded(row.dataset.categoryName);
        if (!toName || toName === dragState.fromName) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        chips.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', event => {
        if (!row.contains(event.relatedTarget)) row.classList.remove('is-drop-target');
      });
      row.addEventListener('drop', event => {
        if (!dragState || dragState.kind !== kind) return;
        const toName = decoded(row.dataset.categoryName);
        const fromName = dragState.fromName;
        event.preventDefault();
        row.classList.remove('is-drop-target');
        dragState = null;
        if (!toName || !fromName || toName === fromName) return;
        openMergeDialog(kind, fromName, toName, row);
      });
    });
  }

  function openActions(kind, name, anchor) {
    const c = config[kind];
    const count = c.count(name);
    const canMerge = c.names().some(value => value !== name);
    const deleteHtml = count === 0
      ? '<button type="button" class="category-organizer-action danger" data-organizer-action="delete">この' + esc(c.label) + 'を削除</button>'
      : '';

    openOrganizerModal(
      esc(name),
      '<div class="category-organizer-action-summary">' +
        '<span class="badge" style="' + esc(c.style(name)) + '">' + esc(name) + '</span>' +
        '<span>' + count.toLocaleString() + '件</span>' +
      '</div>' +
      '<div class="category-organizer-action-list">' +
        '<button type="button" class="category-organizer-action" data-organizer-action="rename">名前を変更</button>' +
        '<button type="button" class="category-organizer-action" data-organizer-action="merge"' + (canMerge ? '' : ' disabled') + '>別の' + esc(c.label) + 'に統合</button>' +
        deleteHtml +
        '<button type="button" class="category-organizer-action muted" data-organizer-action="cancel">閉じる</button>' +
      '</div>',
      anchor
    );

    const body = document.getElementById('categoryOrganizerBody');
    body.querySelector('[data-organizer-action="rename"]')?.addEventListener('click', () => openRenameDialog(kind, name, anchor));
    body.querySelector('[data-organizer-action="merge"]')?.addEventListener('click', () => openMergeDialog(kind, name, '', anchor));
    body.querySelector('[data-organizer-action="delete"]')?.addEventListener('click', () => deleteEmptyCategory(kind, name));
    body.querySelector('[data-organizer-action="cancel"]')?.addEventListener('click', closeOrganizerModal);
  }

  function openRenameDialog(kind, oldName, anchor) {
    const c = config[kind];
    openOrganizerModal(
      c.label + '名を変更',
      '<div class="form-row">' +
        '<label for="categoryOrganizerRenameInput">新しい名前</label>' +
        '<input id="categoryOrganizerRenameInput" class="input" value="' + esc(oldName) + '" autocomplete="off" />' +
        '<div class="category-organizer-field-note">既存の' + esc(c.label) + '名を指定した場合は、名前変更ではなく統合として確認します。</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn ghost" data-rename-cancel>キャンセル</button>' +
        '<button type="button" class="btn primary" data-rename-save>名前を変更</button>' +
      '</div>',
      anchor
    );

    const input = document.getElementById('categoryOrganizerRenameInput');
    const saveButton = document.querySelector('[data-rename-save]');
    document.querySelector('[data-rename-cancel]')?.addEventListener('click', closeOrganizerModal);
    saveButton?.addEventListener('click', () => {
      const newName = String(input?.value || '').trim() || '未分類';
      if (newName === oldName) {
        closeOrganizerModal();
        showSnackbar(c.label + '名は変更されていません');
        return;
      }
      if (c.names().includes(newName)) {
        openMergeDialog(kind, oldName, newName, anchor, '「' + newName + '」は既にあります。名前変更すると同じ' + c.label + 'になるため、統合として確認します。');
        return;
      }
      performRename(kind, oldName, newName);
    });
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveButton?.click();
      }
    });
  }

  function performRename(kind, oldName, newName) {
    const c = config[kind];
    if (kind === 'links') {
      state.items.forEach(item => {
        if ((item.projectName || '未分類') === oldName) item.projectName = newName;
      });
      if (state.projectColors?.[oldName] && !state.projectColors?.[newName]) {
        state.projectColors[newName] = state.projectColors[oldName];
      }
      if (state.projectColors) delete state.projectColors[oldName];
      if (state.currentProject === oldName) state.currentProject = newName;
      state.projects = normalizeProjects(state.projects, state.items);
      state.linkPage = 1;
    } else {
      state.promptMemos.forEach(memo => {
        if ((memo.categoryName || '未分類') === oldName) memo.categoryName = newName;
      });
      if (state.currentPromptCategory === oldName) state.currentPromptCategory = newName;
      state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
      state.promptPage = 1;
    }
    save();
    notifyChange(kind === 'links' ? 'project-rename' : 'prompt-category-rename');
    closeOrganizerModal();
    render();
    showSnackbar('「' + oldName + '」を「' + newName + '」へ変更しました');
  }

  function mergeOptions(kind, fromName, selected) {
    return config[kind].names()
      .filter(name => name !== fromName)
      .map(name => '<option value="' + esc(name) + '"' + (name === selected ? ' selected' : '') + '>' + esc(name) + '</option>')
      .join('');
  }

  function openMergeDialog(kind, fromName, preferredTarget, anchor, note) {
    const c = config[kind];
    const targets = c.names().filter(name => name !== fromName);
    if (!targets.length) {
      showSnackbar('統合先にできる' + c.label + 'がありません');
      return;
    }
    const selected = targets.includes(preferredTarget) ? preferredTarget : targets[0];
    const fromCount = c.count(fromName);

    openOrganizerModal(
      c.label + 'を統合',
      (note ? '<div class="category-organizer-notice">' + esc(note) + '</div>' : '') +
      '<div class="category-merge-flow">' +
        '<div class="category-merge-node source">' +
          '<span class="category-merge-kicker">移動元</span>' +
          '<strong>' + esc(fromName) + '</strong>' +
          '<span>' + fromCount.toLocaleString() + '件</span>' +
        '</div>' +
        '<div class="category-merge-arrow" aria-hidden="true">↓</div>' +
        '<div class="category-merge-target-wrap">' +
          '<label for="categoryMergeTarget">統合先</label>' +
          '<select id="categoryMergeTarget" class="select">' + mergeOptions(kind, fromName, selected) + '</select>' +
        '</div>' +
      '</div>' +
      '<div id="categoryMergePreview" class="category-merge-preview"></div>' +
      '<div class="category-organizer-safety">' +
        esc(c.itemLabel) + '自体は削除されません。' +
        (kind === 'links'
          ? 'タイトル、URL、備考、お気に入り、利用履歴はそのまま残ります。'
          : 'タイトル、本文、利用履歴はそのまま残ります。') +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn ghost" data-merge-cancel>キャンセル</button>' +
        '<button type="button" class="btn primary" id="categoryMergeConfirm"></button>' +
      '</div>',
      anchor
    );

    const select = document.getElementById('categoryMergeTarget');
    const preview = document.getElementById('categoryMergePreview');
    const confirmButton = document.getElementById('categoryMergeConfirm');

    function updatePreview() {
      const toName = select.value;
      const toCount = c.count(toName);
      preview.innerHTML =
        '<div class="category-merge-result">' +
          '<div><span>' + esc(toName) + '</span><strong>' + toCount.toLocaleString() + '件 → ' + (toCount + fromCount).toLocaleString() + '件</strong></div>' +
          '<div><span>' + esc(fromName) + '</span><strong>' + fromCount.toLocaleString() + '件 → 統合後に消えます</strong></div>' +
        '</div>';
      confirmButton.textContent = fromCount.toLocaleString() + '件を「' + toName + '」へ統合';
    }

    select.addEventListener('change', updatePreview);
    document.querySelector('[data-merge-cancel]')?.addEventListener('click', closeOrganizerModal);
    confirmButton.addEventListener('click', () => performMerge(kind, fromName, select.value));
    updatePreview();
  }

  function performMerge(kind, fromName, toName) {
    const c = config[kind];
    if (!fromName || !toName || fromName === toName) return;

    const snapshot = {
      kind,
      fromName,
      toName,
      affectedIds: [],
      previousCurrent: c.current(),
      hadFromColor: false,
      fromColor: null
    };

    if (kind === 'links') {
      snapshot.affectedIds = state.items
        .filter(item => !item.archived && (item.projectName || '未分類') === fromName)
        .map(item => item.id);
      snapshot.hadFromColor = Object.prototype.hasOwnProperty.call(state.projectColors || {}, fromName);
      snapshot.fromColor = snapshot.hadFromColor ? JSON.parse(JSON.stringify(state.projectColors[fromName])) : null;

      const ids = new Set(snapshot.affectedIds);
      state.items.forEach(item => {
        if (ids.has(item.id)) item.projectName = toName;
      });
      if (state.projectColors) delete state.projectColors[fromName];
      if (state.currentProject === fromName) state.currentProject = toName;
      state.projects = normalizeProjects(state.projects, state.items);
      state.linkPage = 1;
    } else {
      snapshot.affectedIds = state.promptMemos
        .filter(memo => (memo.categoryName || '未分類') === fromName)
        .map(memo => memo.id);
      const ids = new Set(snapshot.affectedIds);
      state.promptMemos.forEach(memo => {
        if (ids.has(memo.id)) memo.categoryName = toName;
      });
      if (state.currentPromptCategory === fromName) state.currentPromptCategory = toName;
      state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
      state.promptPage = 1;
    }

    undoState = snapshot;
    save();
    notifyChange(kind === 'links' ? 'project-merge' : 'prompt-category-merge');
    closeOrganizerModal();
    render();

    const count = snapshot.affectedIds.length;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoState = null; }, 8000);
    showSnackbar(count.toLocaleString() + '件を「' + toName + '」へ統合しました', () => undoMerge(snapshot));
  }

  function undoMerge(snapshot) {
    if (!snapshot || undoState !== snapshot) return;
    const ids = new Set(snapshot.affectedIds || []);

    if (snapshot.kind === 'links') {
      state.items.forEach(item => {
        if (ids.has(item.id) && (item.projectName || '未分類') === snapshot.toName) {
          item.projectName = snapshot.fromName;
        }
      });
      if (snapshot.hadFromColor) state.projectColors[snapshot.fromName] = snapshot.fromColor;
      else if (state.projectColors) delete state.projectColors[snapshot.fromName];
      if (snapshot.previousCurrent === snapshot.fromName && state.currentProject === snapshot.toName) {
        state.currentProject = snapshot.fromName;
      }
      state.projects = normalizeProjects(state.projects, state.items);
      state.linkPage = 1;
    } else {
      state.promptMemos.forEach(memo => {
        if (ids.has(memo.id) && (memo.categoryName || '未分類') === snapshot.toName) {
          memo.categoryName = snapshot.fromName;
        }
      });
      if (snapshot.previousCurrent === snapshot.fromName && state.currentPromptCategory === snapshot.toName) {
        state.currentPromptCategory = snapshot.fromName;
      }
      state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
      state.promptPage = 1;
    }

    undoState = null;
    save();
    notifyChange(snapshot.kind === 'links' ? 'project-merge-undo' : 'prompt-category-merge-undo');
    render();
    showSnackbar('「' + snapshot.fromName + '」を元に戻しました');
  }

  function deleteEmptyCategory(kind, name) {
    const c = config[kind];
    if (c.count(name) !== 0) {
      showSnackbar('中身がある' + c.label + 'は削除できません');
      return;
    }
    if (kind === 'links') {
      state.projects = (state.projects || []).filter(value => value !== name);
      if (state.projectColors) delete state.projectColors[name];
      if (!state.projects.length) state.projects = ['未分類'];
    } else {
      state.promptCategories = (state.promptCategories || []).filter(value => value !== name);
      if (!state.promptCategories.length) state.promptCategories = ['未分類'];
    }
    save();
    notifyChange(kind === 'links' ? 'project-delete-empty' : 'prompt-category-delete-empty');
    closeOrganizerModal();
    render();
    showSnackbar('「' + name + '」を削除しました');
  }

  function decorate() {
    decorateKind('links');
    decorateKind('prompts');
  }

  const baseRender = render;
  render = function() {
    baseRender();
    decorate();
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.getElementById('categoryOrganizerModal')?.classList.contains('open')) {
        event.preventDefault();
        closeOrganizerModal();
        return;
      }
      if (mode.links || mode.prompts) {
        mode.links = false;
        mode.prompts = false;
        render();
      }
    }
  });

  ensureUi();
  decorate();

  window.QuickLinksCategoryOrganizer = {
    enter: enterMode,
    leave: leaveMode,
    openMerge: openMergeDialog,
    undo: () => undoState && undoMerge(undoState),
    getMode: () => ({ ...mode })
  };
})();