(() => {
  const METADATA_ENDPOINT = 'https://api.microlink.io/';
  const BODY_PREVIEW_LIMIT = 1600;
  const DIRECT_FETCH_TIMEOUT = 6500;
  const PROJECT_SORT_KEY = 'quick-links-quick-project-sort-v1';
  const PROJECT_SORT_MODES = new Set(['recent', 'count', 'name', 'default']);
  const PROJECT_COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

  const originalOpenLinkModal = openLinkModal;

  function cleanText(value, max = 0) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return max > 0 && text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function normalizeQuickUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) throw new Error('URLを入力してください');
    raw = extractFirstUrl(raw) || raw;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('http / https のURLを入力してください');
    return parsed.href;
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(normalizeQuickUrl(value));
      url.hash = '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function findDuplicate(url) {
    const key = canonicalUrl(url);
    if (!key) return null;
    return state.items.find(item => canonicalUrl(item.url) === key) || null;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function absoluteUrl(value, base) {
    if (!value) return '';
    try {
      return safeHttpUrl(new URL(value, base).href);
    } catch (_) {
      return '';
    }
  }

  function fallbackMetadata(url) {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./i, '');
    return {
      url,
      title: domain,
      siteName: domain,
      domain,
      favicon: absoluteUrl('/favicon.ico', url),
      image: '',
      description: '',
      bodyExcerpt: '',
      source: 'fallback'
    };
  }

  function setFetchStatus(message, kind = '') {
    const el = $('quickUrlStatus');
    if (!el) return;
    el.className = `fetch-status ${kind}`.trim();
    el.textContent = message;
  }

  function projectTimeValue(value) {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  }

  function readQuickProjectSortMode() {
    try {
      const saved = localStorage.getItem(PROJECT_SORT_KEY);
      return PROJECT_SORT_MODES.has(saved) ? saved : 'recent';
    } catch (_) {
      return 'recent';
    }
  }

  function writeQuickProjectSortMode(mode) {
    if (!PROJECT_SORT_MODES.has(mode)) return;
    try { localStorage.setItem(PROJECT_SORT_KEY, mode); } catch (_) {}
  }

  function getQuickProjectSortMode() {
    const selected = $('quickProjectSort')?.value;
    return PROJECT_SORT_MODES.has(selected) ? selected : readQuickProjectSortMode();
  }

  function getQuickProjectEntries(mode = getQuickProjectSortMode()) {
    const names = Array.isArray(state.projects) && state.projects.length ? [...state.projects] : ['未分類'];
    const order = new Map(names.map((name, index) => [name, index]));
    const entries = new Map(names.map(name => [name, { name, count: 0, lastUsed: 0, order: order.get(name) }]));

    (Array.isArray(state.items) ? state.items : []).forEach(item => {
      if (!item || item.archived) return;
      const name = String(item.projectName || '未分類').trim() || '未分類';
      if (!entries.has(name)) {
        order.set(name, order.size);
        names.push(name);
        entries.set(name, { name, count: 0, lastUsed: 0, order: order.get(name) });
      }
      const entry = entries.get(name);
      entry.count += 1;
      entry.lastUsed = Math.max(entry.lastUsed, projectTimeValue(item.updatedAt), projectTimeValue(item.addedAt));
    });

    const sorted = names.map(name => entries.get(name));
    if (mode === 'count') {
      sorted.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed || a.order - b.order);
    } else if (mode === 'name') {
      sorted.sort((a, b) => PROJECT_COLLATOR.compare(a.name, b.name) || a.order - b.order);
    } else if (mode === 'default') {
      sorted.sort((a, b) => a.order - b.order);
    } else {
      sorted.sort((a, b) => b.lastUsed - a.lastUsed || b.count - a.count || a.order - b.order);
    }
    return sorted;
  }

  function chooseQuickProject(name) {
    const input = $('quickUrlProject');
    const select = $('quickUrlProjectSelect');
    if (!input || !select) return;
    input.value = name;
    select.value = state.projects.includes(name) ? name : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderQuickProjectRecents() {
    const wrap = $('quickProjectRecents');
    const buttons = $('quickProjectRecentButtons');
    if (!wrap || !buttons) return;
    const projects = getQuickProjectEntries('recent');
    if (projects.length < 4) {
      wrap.hidden = true;
      buttons.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    buttons.innerHTML = projects.slice(0, 3).map(entry => {
      const encoded = encodeURIComponent(entry.name);
      return `<button type="button" class="btn ghost compact" data-quick-project="${encoded}" title="${escapeHtml(entry.name)}（${entry.count.toLocaleString()}件）" style="min-height:30px;padding:5px 8px;border-radius:6px;font-size:11px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.name)}</button>`;
    }).join('');
    buttons.querySelectorAll('[data-quick-project]').forEach(button => {
      button.addEventListener('click', () => chooseQuickProject(decodeURIComponent(button.dataset.quickProject || '')));
    });
  }

  function syncQuickProjectSelect() {
    const input = $('quickUrlProject');
    const select = $('quickUrlProjectSelect');
    const list = $('quickUrlProjectList');
    if (!input || !select || !list) return;
    const mode = getQuickProjectSortMode();
    const projects = getQuickProjectEntries(mode);
    list.innerHTML = projects.map(entry => `<option value="${escapeHtml(entry.name)}"></option>`).join('');
    select.innerHTML = `<option value="">既存分類から選ぶ</option>` + projects.map(entry => {
      const label = mode === 'count' ? `${entry.name}（${entry.count.toLocaleString()}）` : entry.name;
      return `<option value="${escapeHtml(entry.name)}">${escapeHtml(label)}</option>`;
    }).join('');
    const value = input.value.trim();
    select.value = projects.some(entry => entry.name === value) ? value : '';
    renderQuickProjectRecents();
  }

  function updateDuplicateWarning() {
    const el = $('quickUrlDuplicate');
    if (!el) return null;
    let duplicate = null;
    try {
      const raw = $('quickUrlInput').value.trim();
      if (raw) duplicate = findDuplicate(raw);
    } catch (_) {}
    if (duplicate) {
      el.classList.add('show');
      el.textContent = `登録済み：${duplicate.title || duplicate.url}（分類：${duplicate.projectName || '未分類'}）`;
    } else {
      el.classList.remove('show');
      el.textContent = '';
    }
    return duplicate;
  }

  function meta(doc, selectors) {
    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      const value = el?.getAttribute('content') || el?.textContent || '';
      if (String(value).trim()) return String(value).trim();
    }
    return '';
  }

  async function fetchDirectMetadata(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECT_FETCH_TIMEOUT);
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('HTMLではありません');
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const finalUrl = response.url || url;
      const parsed = new URL(finalUrl);
      const domain = parsed.hostname.replace(/^www\./i, '');
      const faviconHref = doc.querySelector('link[rel~="icon"]')?.getAttribute('href') || doc.querySelector('link[rel="shortcut icon"]')?.getAttribute('href') || '/favicon.ico';
      const imageHref = meta(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']);
      const bodyText = cleanText(doc.body?.innerText || doc.body?.textContent || '', BODY_PREVIEW_LIMIT);
      return {
        url: finalUrl,
        title: cleanText(meta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']), 240) || domain,
        siteName: cleanText(meta(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']), 120) || domain,
        domain,
        favicon: absoluteUrl(faviconHref, finalUrl),
        image: absoluteUrl(imageHref, finalUrl),
        description: cleanText(meta(doc, ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']), 1000),
        bodyExcerpt: bodyText,
        source: 'direct'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchMicrolinkMetadata(url) {
    const functionCode = `({ page }) => page.evaluate(() => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${BODY_PREVIEW_LIMIT}))`;
    const endpoint = new URL(METADATA_ENDPOINT);
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('function', functionCode);
    const response = await fetch(endpoint.href, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.status !== 'success' || !payload?.data) throw new Error(payload?.message || 'ページ情報を取得できませんでした');
    const data = payload.data;
    const finalUrl = safeHttpUrl(data.url) || url;
    const parsed = new URL(finalUrl);
    const domain = parsed.hostname.replace(/^www\./i, '');
    const functionValue = data.function?.isFulfilled === false ? '' : data.function?.value;
    return {
      url: finalUrl,
      title: cleanText(data.title, 240) || domain,
      siteName: cleanText(data.publisher, 120) || domain,
      domain,
      favicon: safeHttpUrl(data.logo?.url) || absoluteUrl('/favicon.ico', finalUrl),
      image: safeHttpUrl(data.image?.url),
      description: cleanText(data.description, 1000),
      bodyExcerpt: cleanText(functionValue, BODY_PREVIEW_LIMIT),
      source: 'microlink'
    };
  }

  async function fetchPageMetadata(url) {
    try {
      const direct = await fetchDirectMetadata(url);
      if (direct.title || direct.description) return direct;
    } catch (error) {
      console.info('Direct metadata fetch unavailable; using metadata endpoint.', error);
    }
    return fetchMicrolinkMetadata(url);
  }

  function renderMetadataPreview(data) {
    const preview = $('linkMetadataPreview');
    if (!preview) return;
    if (!data) {
      preview.hidden = true;
      preview.innerHTML = '';
      return;
    }
    const favicon = safeHttpUrl(data.favicon);
    const image = safeHttpUrl(data.image);
    const siteName = data.siteName || data.domain || 'ページ情報';
    const description = data.description || 'description は取得できませんでした。';
    const body = data.bodyExcerpt || '本文プレビューは取得できませんでした。';
    preview.innerHTML = `
      <div class="metadata-preview-head">
        ${favicon ? `<img class="metadata-favicon" src="${escapeHtml(favicon)}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="metadata-site-wrap">
          <div class="metadata-site">${escapeHtml(siteName)}</div>
          <div class="metadata-domain">${escapeHtml(data.domain || '')}</div>
        </div>
      </div>
      ${image ? `<img class="metadata-image" src="${escapeHtml(image)}" alt="ページ画像" onerror="this.style.display='none'">` : ''}
      <div class="metadata-content">
        <div>
          <div class="metadata-label">DESCRIPTION</div>
          <div class="metadata-text">${escapeHtml(description)}</div>
        </div>
        <details class="metadata-details">
          <summary>本文プレビューを見る</summary>
          <div class="metadata-body">${escapeHtml(body)}</div>
        </details>
      </div>`;
    preview.hidden = false;
  }

  openLinkModal = function(item = null, options = {}) {
    originalOpenLinkModal(item, options);
    renderMetadataPreview(null);
  };

  function applyFetchedMetadata(data, projectName) {
    openLinkModal(null, { skipClipboardAutofill: true });
    $('linkTitle').value = data.title || data.domain || data.url;
    $('linkUrl').value = data.url;
    $('linkProject').value = projectName || '未分類';
    $('linkProjectSelect').value = state.projects.includes($('linkProject').value) ? $('linkProject').value : '';
    $('linkNote').value = data.description || '';
    renderMetadataPreview(data);
    const sourceText = data.source === 'direct' ? '対象ページから情報を取得しました。' : data.source === 'microlink' ? 'ページ情報を取得しました。' : 'ページ情報を取得できなかったため、URLをもとに入力しました。';
    setClipboardHint(`${sourceText} タイトル・分類・備考を確認して保存してください。`);
  }

  function getQuickProjectName() {
    return $('quickUrlProject')?.value.trim() || '未分類';
  }

  function setQuickBusy(busy) {
    const fetchBtn = $('fetchQuickUrlBtn');
    const manualBtn = $('manualQuickUrlBtn');
    const pasteBtn = $('pasteQuickUrlBtn');
    const urlInput = $('quickUrlInput');
    if (fetchBtn) {
      fetchBtn.disabled = busy;
      fetchBtn.textContent = busy ? '取得中…' : '情報を取得';
    }
    if (manualBtn) manualBtn.disabled = busy;
    if (pasteBtn) pasteBtn.disabled = busy;
    if (urlInput) urlInput.disabled = busy;
  }

  async function confirmQuickUrl() {
    let url;
    try {
      url = normalizeQuickUrl($('quickUrlInput').value);
    } catch (error) {
      setFetchStatus(error.message || 'URLを確認してください', 'error');
      $('quickUrlInput').focus();
      return;
    }

    const projectName = getQuickProjectName();
    $('quickUrlInput').value = url;
    updateDuplicateWarning();
    setQuickBusy(true);
    setFetchStatus('ページへアクセスして、タイトル・説明・画像などを取得しています…', 'loading');

    let data;
    let failed = false;
    try {
      data = await fetchPageMetadata(url);
      setFetchStatus('取得しました。内容確認へ進みます。', 'success');
    } catch (error) {
      console.warn('Metadata fetch failed', error);
      data = fallbackMetadata(url);
      failed = true;
      setFetchStatus('ページ情報を取得できませんでした。URLだけでも登録できます。', 'warning');
    } finally {
      setQuickBusy(false);
    }

    setTimeout(() => {
      closeModal('quickUrlModal');
      applyFetchedMetadata(data, projectName);
      toast(failed ? '情報取得に失敗したため、URLをもとに内容確認を開きました' : 'ページ情報を取得しました。確認して保存してください');
    }, 180);
  }

  function openManualFromQuickUrl() {
    let url = '';
    try {
      if ($('quickUrlInput').value.trim()) url = normalizeQuickUrl($('quickUrlInput').value);
    } catch (_) {
      url = $('quickUrlInput').value.trim();
    }
    const projectName = getQuickProjectName();
    closeModal('quickUrlModal');
    openLinkModal(null, { skipClipboardAutofill: true });
    $('linkUrl').value = url;
    $('linkProject').value = projectName;
    $('linkProjectSelect').value = state.projects.includes(projectName) ? projectName : '';
    if (url) {
      try {
        const parsed = new URL(url);
        $('linkTitle').value = parsed.hostname.replace(/^www\./i, '');
      } catch (_) {}
    }
    setClipboardHint('情報取得をせず通常入力で開きました。内容を確認して保存してください。');
  }

  async function pasteQuickUrl() {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      console.warn('Clipboard read failed', error);
      toast('クリップボードを読めませんでした');
      return;
    }
    const url = extractFirstUrl(text) || text.trim();
    if (!url) {
      toast('URLが見つかりませんでした');
      return;
    }
    $('quickUrlInput').value = url;
    updateDuplicateWarning();
    toast('URLを貼り付けました');
  }

  async function tryAutofillQuickUrl() {
    if (!$('quickUrlInput') || $('quickUrlInput').value.trim()) return;
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      const url = extractFirstUrl(text);
      if (!url) return;
      $('quickUrlInput').value = url;
      updateDuplicateWarning();
    } catch (_) {}
  }

  function openQuickUrlModal() {
    $('quickUrlInput').value = '';
    const defaultProject = state.currentProject !== 'ALL' ? state.currentProject : '未分類';
    $('quickUrlProject').value = defaultProject;
    if ($('quickProjectSort')) $('quickProjectSort').value = readQuickProjectSortMode();
    syncQuickProjectSelect();
    $('quickUrlProjectSelect').value = state.projects.includes(defaultProject) ? defaultProject : '';
    $('quickUrlDuplicate').classList.remove('show');
    $('quickUrlDuplicate').textContent = '';
    setFetchStatus('URLを貼ると、ページ情報を取得してから内容確認へ進みます。');
    setQuickBusy(false);
    openModal('quickUrlModal');
    setTimeout(() => tryAutofillQuickUrl(), 80);
    setTimeout(() => $('quickUrlInput').focus(), 140);
  }

  openYamlAddModal = openQuickUrlModal;

  const urlInput = $('quickUrlInput');
  const projectInput = $('quickUrlProject');
  const projectSelect = $('quickUrlProjectSelect');
  const projectSort = $('quickProjectSort');
  const fetchBtn = $('fetchQuickUrlBtn');
  const pasteBtn = $('pasteQuickUrlBtn');
  const manualBtn = $('manualQuickUrlBtn');

  if (projectSort) projectSort.value = readQuickProjectSortMode();
  urlInput?.addEventListener('input', updateDuplicateWarning);
  urlInput?.addEventListener('paste', () => setTimeout(updateDuplicateWarning, 0));
  urlInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      confirmQuickUrl();
    }
  });
  projectInput?.addEventListener('input', () => {
    projectSelect.value = state.projects.includes(projectInput.value.trim()) ? projectInput.value.trim() : '';
  });
  projectSelect?.addEventListener('change', event => {
    if (event.target.value) projectInput.value = event.target.value;
  });
  projectSort?.addEventListener('change', event => {
    writeQuickProjectSortMode(event.target.value);
    syncQuickProjectSelect();
  });
  fetchBtn?.addEventListener('click', confirmQuickUrl);
  pasteBtn?.addEventListener('click', pasteQuickUrl);
  manualBtn?.addEventListener('click', openManualFromQuickUrl);

  const saveButton = $('saveLinkBtn');
  saveButton?.addEventListener('click', event => {
    if ($('linkId').value || saveButton.dataset.allowDuplicate === '1') return;
    const duplicate = findDuplicate($('linkUrl').value);
    if (!duplicate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const proceed = window.confirm(`同じURLがすでに登録されています。\n「${duplicate.title || duplicate.url}」\n\nそれでも別リンクとして追加しますか？`);
    if (!proceed) return;
    saveButton.dataset.allowDuplicate = '1';
    saveButton.click();
    delete saveButton.dataset.allowDuplicate;
  }, true);
})();