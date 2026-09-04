(() => {
  const TARGET_URL = 'https://silovar-uk.github.io/quicklinks/';
  const HASH_PREFIX = '#add=';
  const MODE_CLASS = 'bookmarklet-add-mode';
  let payload = null;
  let projectTouched = false;
  let duplicateItem = null;

  function cleanText(value, max = 0) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return max > 0 && text.length > max ? text.slice(0, max) : text;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function canonicalUrl(value) {
    const safe = safeHttpUrl(value);
    if (!safe) return '';
    try {
      const url = new URL(safe);
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function findDuplicate(url) {
    const key = canonicalUrl(url);
    if (!key || !Array.isArray(state?.items)) return null;
    return state.items.find(item => canonicalUrl(item?.url) === key) || null;
  }

  function createDirectBookmarkletCode() {
    const target = JSON.stringify(TARGET_URL);
    return `javascript:(()=>{const c=(v,n)=>String(v||'').replace(/\\s+/g,' ').trim().slice(0,n);const m=s=>document.querySelector(s)?.content||'';const u=location.href;if(!/^https?:/i.test(u)){alert('http / https のページだけ追加できます');return}const p={v:1,url:u,title:c(document.title,300),description:c(m('meta[name="description"]')||m('meta[property="og:description"]')||m('meta[name="twitter:description"]')||'',600)};location.href=${target}+'#add='+encodeURIComponent(JSON.stringify(p))})()`;
  }

  function upgradeBookmarkletUi() {
    if (typeof createBookmarkletCode === 'function') {
      createBookmarkletCode = createDirectBookmarkletCode;
    }
    if (typeof refreshBookmarkletUi === 'function') refreshBookmarkletUi();

    const link = document.getElementById('bookmarkletLink');
    const copy = document.getElementById('copyBookmarkletBtn');
    const code = document.getElementById('bookmarkletCode');
    const yaml = document.getElementById('bookmarkletYamlText');
    const card = link?.closest('.settings-card');
    if (link) link.textContent = 'Quick Linksに追加';
    if (copy) copy.textContent = 'ブックマークレットをコピー';
    if (code) code.value = createDirectBookmarkletCode();
    const lead = card?.querySelector('.settings-lead');
    if (lead) lead.textContent = '閲覧中のページからQuick Linksを直接開き、分類を選ぶだけで保存できます。';
    if (yaml?.closest('.form-row')) yaml.closest('.form-row').style.display = 'none';
    const yamlActions = card?.querySelector('.bookmarklet-actions');
    if (yamlActions) yamlActions.style.display = 'none';
    const hint = card?.querySelector('.hint');
    if (hint) hint.textContent = 'スマホでは、このリンクをブックマークに登録して使います。実行するとQuick Linksが開き、分類だけ選んで保存できます。';
  }

  function decodePayload() {
    if (!location.hash.startsWith(HASH_PREFIX)) return null;
    const raw = location.hash.slice(HASH_PREFIX.length);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      const url = safeHttpUrl(parsed?.url);
      if (!url) throw new Error('invalid url');
      return {
        v: Number(parsed?.v || 1),
        url,
        title: cleanText(parsed?.title, 300),
        description: cleanText(parsed?.description, 1000)
      };
    } catch (error) {
      console.warn('Bookmarklet payload parse failed', error);
      return null;
    }
  }

  function clearAddHash() {
    if (!location.hash.startsWith(HASH_PREFIX)) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }

  function ensureModeStyle() {
    if (document.getElementById('bookmarkletAddStyle')) return;
    const style = document.createElement('style');
    style.id = 'bookmarkletAddStyle';
    style.textContent = `
      #quickUrlModal.${MODE_CLASS} .bookmarklet-page-preview {
        margin: 2px 0 14px;
        padding: 12px 13px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #f8fafc;
      }
      #quickUrlModal.${MODE_CLASS} .bookmarklet-page-title {
        color: #172033;
        font-size: 14px;
        line-height: 1.45;
        font-weight: 850;
        word-break: break-word;
      }
      #quickUrlModal.${MODE_CLASS} .bookmarklet-page-url {
        margin-top: 5px;
        color: #85857f;
        font-size: 10px;
        line-height: 1.45;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #quickUrlModal.${MODE_CLASS} .bookmarklet-mode-lead {
        margin: -3px 0 12px;
        color: #64748b;
        font-size: 11px;
        line-height: 1.5;
      }
      #quickUrlModal.${MODE_CLASS} #fetchQuickUrlBtn[disabled] {
        opacity: .48;
        cursor: default;
      }
      #quickUrlModal.${MODE_CLASS} .bookmarklet-duplicate-note {
        margin: 0 0 10px;
        padding: 8px 10px;
        border: 1px solid #fde68a;
        border-radius: 10px;
        color: #92400e;
        background: #fffbeb;
        font-size: 11px;
        line-height: 1.45;
      }
    `;
    document.head.appendChild(style);
  }

  function getProjectName() {
    return cleanText(document.getElementById('quickUrlProject')?.value, 120) || '未分類';
  }

  function updateSaveState() {
    if (!payload) return;
    const button = document.getElementById('fetchQuickUrlBtn');
    if (!button) return;
    duplicateItem = findDuplicate(payload.url);
    button.disabled = !projectTouched;
    button.textContent = duplicateItem ? '分類を変更して保存' : 'この分類に保存';

    let note = document.querySelector('#quickUrlModal .bookmarklet-duplicate-note');
    if (duplicateItem) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'bookmarklet-duplicate-note';
        const actions = document.querySelector('#quickUrlModal .modal-actions');
        actions?.parentNode?.insertBefore(note, actions);
      }
      note.textContent = `登録済みのリンクです。現在の分類「${duplicateItem.projectName || '未分類'}」から、選んだ分類へ変更します。`;
    } else {
      note?.remove();
    }
  }

  function fillHiddenLinkForm(item, projectName) {
    const titleFallback = (() => {
      try { return new URL(payload.url).hostname.replace(/^www\./i, ''); } catch (_) { return payload.url; }
    })();
    const values = item ? {
      id: item.id || '',
      title: item.title || payload.title || titleFallback,
      url: item.url || payload.url,
      project: projectName,
      note: item.note || '',
      favorite: Boolean(item.isFavorite || (item.favoriteType && item.favoriteType !== 'none'))
    } : {
      id: '',
      title: payload.title || titleFallback,
      url: payload.url,
      project: projectName,
      note: payload.description || '',
      favorite: false
    };

    document.getElementById('linkId').value = values.id;
    document.getElementById('linkTitle').value = values.title;
    document.getElementById('linkUrl').value = values.url;
    document.getElementById('linkProject').value = values.project;
    const projectSelect = document.getElementById('linkProjectSelect');
    if (projectSelect) projectSelect.value = state.projects.includes(values.project) ? values.project : '';
    document.getElementById('linkNote').value = values.note;
    document.getElementById('linkFavorite').checked = values.favorite;
  }

  function saveBookmarkletItem() {
    if (!payload || !projectTouched) return;
    const projectName = getProjectName();
    const duplicate = findDuplicate(payload.url);
    const beforeCount = state.items.length;
    const beforeUpdatedAt = duplicate?.updatedAt || '';
    fillHiddenLinkForm(duplicate, projectName);

    if (typeof saveLinkFromModal !== 'function') {
      toast('保存処理を読み込めませんでした');
      return;
    }
    saveLinkFromModal();

    const saved = duplicate
      ? state.items.find(item => item.id === duplicate.id)?.updatedAt !== beforeUpdatedAt
      : state.items.length > beforeCount;
    if (!saved) return;

    clearAddHash();
    payload = null;
    projectTouched = false;
    const modal = document.getElementById('quickUrlModal');
    modal?.classList.remove(MODE_CLASS);
    if (typeof closeModal === 'function') closeModal('quickUrlModal');

    state.currentProject = projectName;
    state.onlyFavorites = false;
    state.linkPage = 1;
    if (typeof save === 'function') save();
    if (typeof render === 'function') render();
    toast(duplicate ? '登録済みリンクの分類を変更しました' : 'リンクを保存しました');
  }

  function resetModalPresentation() {
    const modal = document.getElementById('quickUrlModal');
    if (!modal) return;
    modal.classList.remove(MODE_CLASS);
    const modalTitle = modal.querySelector('.modal-title');
    if (modalTitle) modalTitle.textContent = 'リンクを追加';
    modal.querySelector('.bookmarklet-page-preview')?.remove();
    modal.querySelector('.bookmarklet-mode-lead')?.remove();
    modal.querySelector('.bookmarklet-duplicate-note')?.remove();
    const rows = modal.querySelectorAll('.form-row');
    if (rows[0]) rows[0].style.display = '';
    const status = document.getElementById('quickUrlStatus');
    const privacy = modal.querySelector('.quick-url-privacy');
    const manual = document.getElementById('manualQuickUrlBtn');
    const json = document.getElementById('openJsonImportBtn');
    if (status) status.style.display = '';
    if (privacy) privacy.style.display = '';
    if (manual) manual.style.display = '';
    if (json) {
      json.style.display = '';
      if (json.previousElementSibling) json.previousElementSibling.style.display = '';
    }
  }

  function openBookmarkletMode(nextPayload) {
    payload = nextPayload;
    projectTouched = false;
    ensureModeStyle();
    resetModalPresentation();

    if (typeof openYamlAddModal !== 'function') {
      toast('追加画面を読み込めませんでした');
      clearAddHash();
      return;
    }
    openYamlAddModal();

    const modal = document.getElementById('quickUrlModal');
    if (!modal) return;
    modal.classList.add(MODE_CLASS);
    const title = modal.querySelector('.modal-title');
    if (title) title.textContent = '分類して保存';

    const rows = modal.querySelectorAll('.form-row');
    if (rows[0]) rows[0].style.display = 'none';
    const status = document.getElementById('quickUrlStatus');
    const privacy = modal.querySelector('.quick-url-privacy');
    const manual = document.getElementById('manualQuickUrlBtn');
    const json = document.getElementById('openJsonImportBtn');
    if (status) status.style.display = 'none';
    if (privacy) privacy.style.display = 'none';
    if (manual) manual.style.display = 'none';
    if (json) {
      json.style.display = 'none';
      if (json.previousElementSibling) json.previousElementSibling.style.display = 'none';
    }

    const urlInput = document.getElementById('quickUrlInput');
    if (urlInput) {
      urlInput.value = payload.url;
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const preview = document.createElement('div');
    preview.className = 'bookmarklet-page-preview';
    preview.innerHTML = `
      <div class="bookmarklet-page-title">${escapeHtml(payload.title || payload.url)}</div>
      <div class="bookmarklet-page-url">${escapeHtml(payload.url)}</div>`;
    const head = modal.querySelector('.modal-head');
    head?.insertAdjacentElement('afterend', preview);

    const lead = document.createElement('div');
    lead.className = 'bookmarklet-mode-lead';
    lead.textContent = '保存先の分類を1つ選んでください。URLとタイトルは入力済みです。';
    preview.insertAdjacentElement('afterend', lead);

    const button = document.getElementById('fetchQuickUrlBtn');
    if (button) button.disabled = true;
    updateSaveState();

    setTimeout(() => {
      const search = document.getElementById('quickProjectSearch');
      const project = document.getElementById('quickUrlProject');
      (search || project)?.focus();
    }, 180);
  }

  function handleHash() {
    const next = decodePayload();
    if (!location.hash.startsWith(HASH_PREFIX)) return;
    if (!next) {
      clearAddHash();
      toast('ブックマークレットのデータを読み取れませんでした');
      return;
    }
    openBookmarkletMode(next);
  }

  document.addEventListener('input', event => {
    if (!payload) return;
    if (event.target?.id === 'quickUrlProject') {
      projectTouched = true;
      updateSaveState();
    }
  });

  document.addEventListener('change', event => {
    if (!payload) return;
    if (event.target?.id === 'quickUrlProjectSelect') {
      projectTouched = true;
      setTimeout(updateSaveState, 0);
    }
  });

  document.addEventListener('click', event => {
    if (!payload) return;
    const saveButton = event.target?.closest?.('#fetchQuickUrlBtn');
    if (saveButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveBookmarkletItem();
      return;
    }
    const closeButton = event.target?.closest?.('[data-close-modal="quickUrlModal"]');
    if (closeButton) {
      clearAddHash();
      payload = null;
      projectTouched = false;
      resetModalPresentation();
    }
  }, true);

  const modal = document.getElementById('quickUrlModal');
  if (modal) {
    new MutationObserver(() => {
      if (!payload || modal.classList.contains('open')) return;
      clearAddHash();
      payload = null;
      projectTouched = false;
      resetModalPresentation();
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('hashchange', handleHash);

  upgradeBookmarkletUi();
  handleHash();
})();
