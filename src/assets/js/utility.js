/**
 * utility.js — logique légère des fenêtres Réglages, Raccourcis et À propos.
 *
 * Ces fenêtres ne chargent volontairement ni PDF.js ni operator.js : leur
 * ouverture ne doit déclencher aucun chargement de contenu de projection.
 */

const UTILITY_MODE = document.documentElement.dataset.windowMode;
const UTILITY_MODES = ['settings', 'shortcuts', 'about'];

if (!UTILITY_MODES.includes(UTILITY_MODE)) {
  throw new Error(`Mode de fenêtre utilitaire invalide : ${UTILITY_MODE || 'absent'}`);
}

const MODE_PANEL = {
  settings: 'panelSettings',
  shortcuts: 'panelHelp',
  about: 'panelAbout',
};
document.querySelectorAll('.main > .panel').forEach(panel => {
  if (panel.id !== MODE_PANEL[UTILITY_MODE]) panel.remove();
});
if (UTILITY_MODE !== 'settings') document.getElementById('contentModal')?.remove();

applyI18n();

function localizeOpenVersoButton() {
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
  const isWin = /Win/i.test(navigator.platform || navigator.userAgent || '');
  if (!isMac && !isWin) return;
  const label = document.getElementById('btnOpenVersoDirLabel');
  const btn = document.getElementById('btnOpenVersoDir');
  if (label) label.dataset.i18n = isMac ? 'settings.openInFinder' : 'settings.openInExplorer';
  if (btn) {
    btn.dataset.i18nTitle = isMac
      ? 'settings.openVersoFinderTitle'
      : 'settings.openVersoExplorerTitle';
  }
}

localizeOpenVersoButton();
applyI18n();

// ─── ÉCRAN DE PROJECTION ────────────────────────────────────────────────────

const PROJ_SCREEN_KEY = 'verso.projectionMonitor';
let _screenSelectMonitors = [];

function _savedScreen() {
  try { return JSON.parse(localStorage.getItem(PROJ_SCREEN_KEY) || 'null'); }
  catch (_) { return null; }
}

function _screenLabel(m, index) {
  if (m.name) return m.name;
  if (m.is_internal) return t('screen.builtin');
  if (index != null) return t('screen.numbered', { n: index + 1 });
  return (!m.x && !m.y)
    ? t('screen.main')
    : t('screen.numbered', { n: `${m.width}×${m.height}` });
}

function _renderSavedScreen(m) {
  const select = document.getElementById('screenSelect');
  if (!select) return;
  const option = document.createElement('option');
  option.value = '';
  option.textContent = m ? (m.label || _screenLabel(m)) : t('screen.none');
  select.replaceChildren(option);
}

function _renderScreenSelect(monitors) {
  const select = document.getElementById('screenSelect');
  if (!select) return;
  const saved = _savedScreen();
  _screenSelectMonitors = monitors;
  select.replaceChildren();
  let selectedIndex = -1;

  monitors.forEach((m, i) => {
    const label = _screenLabel(m, i);
    const primary = m.is_primary ? t('screen.primary') : '';
    const selected = saved && m.x === saved.x && m.y === saved.y
      && m.width === saved.width && m.height === saved.height;
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `${label}${primary}`;
    option.title = `${m.width}×${m.height} — ${t('screen.position')} ${m.x},${m.y}`;
    select.appendChild(option);
    if (selected) selectedIndex = i;
  });

  if (selectedIndex >= 0) {
    select.value = String(selectedIndex);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('screen.none');
    placeholder.disabled = true;
    select.prepend(placeholder);
    select.value = '';
  }
}

async function refreshScreenSelect() {
  if (UTILITY_MODE !== 'settings') return;
  try {
    _renderScreenSelect(await apiListMonitors());
  } catch (_) {
    _screenSelectMonitors = [];
    _renderSavedScreen(_savedScreen());
  }
}

async function selectProjectionScreen(index) {
  const i = Number(index);
  const monitor = _screenSelectMonitors[i];
  if (!monitor) return;
  const saved = { ...monitor, label: _screenLabel(monitor, i) };
  localStorage.setItem(PROJ_SCREEN_KEY, JSON.stringify(saved));
  await tauriEvent.emit('projection-screen-changed', saved);
}

document.getElementById('screenSelect')?.addEventListener('change', e => {
  selectProjectionScreen(e.currentTarget.value);
});

// ─── LANGUE ─────────────────────────────────────────────────────────────────

function _syncLanguageSelect() {
  const select = document.getElementById('langSelect');
  if (select) select.value = currentLang();
}

function _retranslateDynamic() {
  _syncLanguageSelect();
  if (_screenSelectMonitors.length) _renderScreenSelect(_screenSelectMonitors);
  else _renderSavedScreen(_savedScreen());
  if (_contentKind) {
    document.getElementById('contentModalTitle').textContent = t(CONTENT_TITLE_KEY[_contentKind]);
    refreshContentList();
  }
  _renderAvailableUpdate();
}

document.getElementById('langSelect')?.addEventListener('change', e => {
  const lang = e.currentTarget.value;
  setLang(lang, _retranslateDynamic);
  apiSetMenuLanguage(lang).catch(() => {});
});

tauriEvent.listen('language-changed', e => {
  const lang = e.payload;
  if (lang !== currentLang()) setLang(lang, _retranslateDynamic);
  else {
    applyI18n();
    _retranslateDynamic();
  }
});

// ─── GESTION DES CONTENUS ───────────────────────────────────────────────────

const CONTENT_KINDS = ['songbooks', 'bibles', 'pdf', 'images'];
const CONTENT_FILTERS = {
  songbooks: { name: 'Recueils', extensions: ['json'] },
  bibles:    { name: 'Bibles', extensions: ['json'] },
  pdf:       { name: 'PDF', extensions: ['pdf'] },
  images:    { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
};
const CONTENT_TITLE_KEY = {
  songbooks: 'settings.songbooks',
  bibles:    'settings.bibles',
  pdf:       'settings.pdfs',
  images:    'settings.images',
};

let _contentKind = null;

function _setContentStatus(text, kind) {
  const el = document.getElementById('contentStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-update-status' + (kind ? ' ' + kind : '');
}

async function manageContent(kind) {
  if (!CONTENT_KINDS.includes(kind)) return;
  _contentKind = kind;
  document.getElementById('contentModalTitle').textContent = t(CONTENT_TITLE_KEY[kind]);
  _setContentStatus('', '');
  const list = document.getElementById('contentModalList');
  list.innerHTML = `<li class="content-mgr-empty">${esc(t('list.loading'))}</li>`;
  document.getElementById('contentModal').hidden = false;
  await refreshContentList();
}

function closeContentManager() {
  const modal = document.getElementById('contentModal');
  if (modal) modal.hidden = true;
  _contentKind = null;
}

async function refreshContentList() {
  const ul = document.getElementById('contentModalList');
  if (!ul || !_contentKind) return;
  let items;
  try {
    items = await apiListContent(_contentKind);
  } catch (_) {
    ul.innerHTML = `<li class="content-mgr-empty">${esc(t('settings.contentError'))}</li>`;
    return;
  }
  if (!items.length) {
    ul.innerHTML = `<li class="content-mgr-empty">${esc(t('settings.contentEmpty'))}</li>`;
    return;
  }
  ul.innerHTML = items.map(it => `
    <li class="content-mgr-item" data-file="${esc(it.filename)}">
      <span class="content-mgr-name">${esc(it.label)}</span>
      <span class="content-mgr-actions">
        <button class="hdr-btn content-mgr-del" data-del-file="${esc(it.filename)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>${esc(t('settings.delete'))}</span>
        </button>
      </span>
    </li>`).join('');
}

async function _notifyContentChanged(kind) {
  await tauriEvent.emit('content-changed', kind);
}

async function _importPaths(paths) {
  const kind = _contentKind;
  if (!kind || !paths?.length) return;
  let ok = 0;
  let lastErr = '';
  for (const path of paths) {
    try { await apiImportContent(kind, path); ok++; }
    catch (err) { lastErr = String(err); }
  }
  if (ok) {
    await refreshContentList();
    await _notifyContentChanged(kind);
  }
  if (lastErr && ok < paths.length) {
    _setContentStatus(t('settings.importError', { err: lastErr }), 'error');
  } else if (ok) {
    _setContentStatus(t('settings.imported', { count: String(ok) }), 'ok');
  }
}

async function addCurrentContent() {
  if (!_contentKind) return;
  let selected;
  try {
    selected = await window.__TAURI__.dialog.open({
      multiple: true,
      filters: [CONTENT_FILTERS[_contentKind]],
    });
  } catch (_) { return; }
  if (!selected) return;
  await _importPaths(Array.isArray(selected) ? selected : [selected]);
}

async function _deleteContent(filename) {
  const kind = _contentKind;
  if (!kind) return;
  try {
    await apiDeleteContent(kind, filename);
  } catch (err) {
    _setContentStatus(t('settings.deleteError', { err: String(err) }), 'error');
    return;
  }
  await refreshContentList();
  await _notifyContentChanged(kind);
  _setContentStatus('', '');
}

function _askDeleteConfirm(item, filename) {
  if (!item || item.querySelector('.content-mgr-confirm')) return;
  const actions = item.querySelector('.content-mgr-actions');
  const word = t('settings.deleteConfirmWord');
  actions.innerHTML = `
    <span class="content-mgr-confirm">
      <span class="content-mgr-confirm-btns">
        <button class="hdr-btn content-mgr-cancel" data-confirm="cancel">
          <span>${esc(t('common.cancel'))}</span>
        </button>
        <button class="hdr-btn content-mgr-confirm-del" data-confirm="delete" data-del-file="${esc(filename)}" disabled>
          <span>${esc(t('settings.delete'))}</span>
        </button>
      </span>
      <span class="content-mgr-confirm-hint">${esc(t('settings.deleteConfirmPrompt', { word }))}</span>
      <input type="text" class="content-mgr-confirm-input" data-confirm-word="${esc(word)}"
        placeholder="${esc(word)}" autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </span>`;
  actions.querySelector('.content-mgr-confirm-input')?.focus();
}

function _confirmMatches(input) {
  const expected = (input?.dataset.confirmWord || '').trim().toLowerCase();
  return expected !== '' && input.value.trim().toLowerCase() === expected;
}

const _contentModalList = document.getElementById('contentModalList');

_contentModalList?.addEventListener('click', e => {
  const cancel = e.target.closest('[data-confirm="cancel"]');
  if (cancel) { refreshContentList(); return; }
  const confirm = e.target.closest('[data-confirm="delete"]');
  if (confirm) {
    if (!confirm.disabled) _deleteContent(confirm.dataset.delFile);
    return;
  }
  const del = e.target.closest('.content-mgr-del');
  if (del) _askDeleteConfirm(del.closest('.content-mgr-item'), del.dataset.delFile);
});

_contentModalList?.addEventListener('input', e => {
  const input = e.target.closest('.content-mgr-confirm-input');
  if (!input) return;
  const btn = input.closest('.content-mgr-confirm')?.querySelector('[data-confirm="delete"]');
  if (btn) btn.disabled = !_confirmMatches(input);
});

_contentModalList?.addEventListener('keydown', e => {
  const input = e.target.closest('.content-mgr-confirm-input');
  if (!input) return;
  if (e.key === 'Enter' && _confirmMatches(input)) {
    e.preventDefault();
    const btn = input.closest('.content-mgr-confirm')?.querySelector('[data-confirm="delete"]');
    if (btn) _deleteContent(btn.dataset.delFile);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    refreshContentList();
  }
});

document.addEventListener('click', e => {
  if (e.target.id === 'contentModal') closeContentManager();
});

document.addEventListener('keydown', e => {
  const modal = document.getElementById('contentModal');
  if (e.key === 'Escape' && modal && !modal.hidden) {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeContentManager();
  }
});

// ─── MISES À JOUR ───────────────────────────────────────────────────────────

let _pendingUpdate = null;
let _updateChecked = false;

function _setSettingsUpdateStatus(text, kind) {
  const el = document.getElementById('settingsUpdateStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-update-status' + (kind ? ' ' + kind : '');
}

function _setUpdateControlsDisabled(disabled) {
  const settingsBtn = document.getElementById('btnCheckUpdate');
  const aboutLink = document.getElementById('aboutUpdateLink');
  if (settingsBtn) settingsBtn.disabled = disabled;
  if (aboutLink) aboutLink.disabled = disabled;
}

function _renderAvailableUpdate() {
  const settingsBtn = document.getElementById('btnCheckUpdate');
  const link = document.getElementById('aboutUpdateLink');
  if (!_pendingUpdate) {
    if (link) {
      link.dataset.action = 'checkUpdate';
      link.textContent = t('update.check');
      link.disabled = false;
    }
    if (settingsBtn) {
      settingsBtn.dataset.action = 'checkUpdate';
      settingsBtn.disabled = false;
      settingsBtn.querySelector('.settings-btn-label').textContent = t('settings.checkNow');
    }
    return;
  }
  const label = _pendingUpdate.version
    ? t('update.updateTo', { version: _pendingUpdate.version })
    : t('update.update');
  if (link) {
    link.dataset.action = 'installUpdate';
    link.textContent = label;
    link.disabled = false;
  }
  if (settingsBtn) {
    settingsBtn.dataset.action = 'installUpdate';
    settingsBtn.disabled = false;
    settingsBtn.querySelector('.settings-btn-label').textContent = t('settings.installRestart');
  }
  _setSettingsUpdateStatus(t('update.available'), 'available');
}

async function checkUpdate(silent = false) {
  _updateChecked = true;
  if (!silent) {
    _setUpdateControlsDisabled(true);
    _setSettingsUpdateStatus(t('update.checking'));
    const link = document.getElementById('aboutUpdateLink');
    if (link) link.textContent = t('update.checking');
  }
  let update;
  try {
    update = await apiCheckUpdate();
  } catch (err) {
    console.warn('Update check failed:', err);
    if (!silent) {
      _setSettingsUpdateStatus(t('update.checkFailed'), 'error');
      _setUpdateControlsDisabled(false);
      const link = document.getElementById('aboutUpdateLink');
      if (link) {
        link.dataset.action = 'checkUpdate';
        link.textContent = t('update.checkFailed');
      }
    }
    return;
  }
  if (!update) {
    _pendingUpdate = null;
    _renderAvailableUpdate();
    _setSettingsUpdateStatus(t('update.upToDate'), 'ok');
    if (!silent) {
      const link = document.getElementById('aboutUpdateLink');
      if (link) link.textContent = t('update.upToDate');
    }
    return;
  }
  _pendingUpdate = update;
  _renderAvailableUpdate();
}

async function installUpdate() {
  if (!_pendingUpdate) return;
  const btn = document.getElementById('btnCheckUpdate');
  const link = document.getElementById('aboutUpdateLink');
  _setUpdateControlsDisabled(true);
  if (link) {
    link.textContent = t('update.installing');
  }
  _setSettingsUpdateStatus(t('update.installing'));
  try {
    await apiInstallUpdate(_pendingUpdate);
  } catch (_) {
    if (btn) btn.disabled = false;
    if (link) {
      link.textContent = t('update.installRetry');
      link.disabled = false;
    }
    _setSettingsUpdateStatus(t('update.installFailed'), 'error');
  }
}

// ─── CYCLE D'OUVERTURE ──────────────────────────────────────────────────────

async function openVersoDir() {
  try { await apiRevealVersoDir(); } catch (_) {}
}

let _preparePromise = null;
function prepareForOpen() {
  if (_preparePromise) return _preparePromise;
  _preparePromise = (async () => {
    applyI18n();
    if (_pendingUpdate) _renderAvailableUpdate();
    _syncLanguageSelect();
    if (UTILITY_MODE === 'settings') await refreshScreenSelect();
    if ((UTILITY_MODE === 'settings' || UTILITY_MODE === 'about') && !_updateChecked) {
      checkUpdate(true);
    }
  })().finally(() => { _preparePromise = null; });
  return _preparePromise;
}

tauriEvent.listen('utility-opened', e => {
  if (e.payload === UTILITY_MODE) prepareForOpen();
});
window.addEventListener('focus', prepareForOpen);

tauriEvent.listen('utility-closing', e => {
  if (e.payload === UTILITY_MODE) closeContentManager();
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = window[el.dataset.action];
  if (typeof fn !== 'function') return;
  if (el.dataset.arg !== undefined) fn(el.dataset.arg);
  else fn();
});

(async function initializeUtility() {
  _syncLanguageSelect();
  _renderSavedScreen(_savedScreen());
  const year = document.getElementById('aboutYear');
  if (year) year.textContent = new Date().getFullYear();
  const version = document.getElementById('aboutVersion');
  if (version) {
    try { version.textContent = await apiAppVersion(); } catch (_) {}
  }

  // Une fenêtre créée directement depuis le menu est visible avant que son
  // écouteur d'événement soit prêt. Une fenêtre préchauffée reste, elle, inactive.
  try {
    const visible = await window.__TAURI__.window.getCurrentWindow().isVisible();
    if (visible) prepareForOpen();
  } catch (_) {}
})();
