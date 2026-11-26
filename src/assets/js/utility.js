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
  _renderOpenLyricsImport();
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
  const importBtn = document.getElementById('contentImportBtn');
  if (importBtn) importBtn.hidden = kind !== 'songbooks';
  const list = document.getElementById('contentModalList');
  list.innerHTML = `<li class="content-mgr-empty">${esc(t('list.loading'))}</li>`;
  document.getElementById('contentModal').hidden = false;
  await refreshContentList();
}

function closeContentManager() {
  closeOpenLyricsImport();
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
  const songbooks = _contentKind === 'songbooks';
  ul.innerHTML = items.map(it => `
    <li class="content-mgr-item" data-file="${esc(it.filename)}">
      ${songbooks ? `<span class="content-mgr-book">
        <span class="content-mgr-name">${esc(it.label)}</span>
        ${it.added_at ? `<span class="content-mgr-date">${esc(_formatAddedAt(it.added_at))}</span>` : ''}
      </span>` : `<span class="content-mgr-name">${esc(it.label)}</span>`}
      <span class="content-mgr-actions">
        ${songbooks ? `<button class="hdr-btn content-mgr-export" data-export-file="${esc(it.filename)}"
          data-export-code="${esc(it.code || '')}" data-export-label="${esc(it.label)}">
          <span>${esc(t('settings.export'))}</span>
        </button>` : ''}
        <button class="hdr-btn content-mgr-del" data-del-file="${esc(it.filename)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>${esc(t('settings.delete'))}</span>
        </button>
      </span>
    </li>`).join('');
}

// Date d'ajout d'un recueil, dans la langue de l'interface :
// « Ajouté le 3 mars 2026 à 18:47 » / « Added March 3, 2026 at 6:47 PM ».
function _formatAddedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const text = new Intl.DateTimeFormat(currentLang(), { dateStyle: 'long', timeStyle: 'short' }).format(date);
  return t('settings.addedOn', { date: text });
}

// Message au singulier ou au pluriel (clé `<key>One` pour 1).
function _countMsg(key, count) {
  return count === 1 ? t(key + 'One') : t(key, { count: String(count) });
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
  if (del) { _askDeleteConfirm(del.closest('.content-mgr-item'), del.dataset.delFile); return; }
  const exp = e.target.closest('.content-mgr-export');
  if (exp && !exp.disabled) _exportSongbook(exp);
});

// ─── OPENLYRICS ─────────────────────────────────────────────────────────────

// Export : boîte d'enregistrement du système, puis une ligne dans le pied de
// la modale. L'archive contient un fichier OpenLyrics par chant.
async function _exportSongbook(btn) {
  const { exportFile: file, exportCode: code, exportLabel: label } = btn.dataset;
  const base = code && code !== label ? `${code} - ${label}` : label;
  const defaultPath = `${base} (OpenLyrics).zip`.replace(/[\\/:*?"<>|]/g, ' ');
  let dest;
  try {
    dest = await window.__TAURI__.dialog.save({
      defaultPath,
      filters: [{ name: 'OpenLyrics', extensions: ['zip'] }],
    });
  } catch (_) { return; }
  if (!dest) return;
  const span = btn.querySelector('span');
  btn.disabled = true;
  if (span) span.textContent = t('settings.exporting');
  _setContentStatus('', '');
  try {
    const count = await apiExportOpenLyrics(file, dest);
    _setContentStatus(_countMsg('settings.exported', count), 'ok');
  } catch (err) {
    _setContentStatus(t('settings.exportError', { err: String(err) }), 'error');
  } finally {
    btn.disabled = false;
    if (span) span.textContent = t('settings.export');
  }
}

// Import : une seule boîte, vide à l'ouverture. « Importer » reste inactif
// tant qu'aucun fichier n'est choisi, que le nom ou le code manque, ou qu'un
// recueil porte déjà ce nom ou ce code. L'import crée toujours un recueil.
const _olImport = { open: false, paths: [], books: [], busy: false };

async function openOpenLyricsImport() {
  const modal = document.getElementById('olImportModal');
  if (!modal) return;
  Object.assign(_olImport, { open: true, paths: [], books: [], busy: false });
  document.getElementById('olName').value = '';
  document.getElementById('olCode').value = '';
  _setOlStatus('', '');
  modal.hidden = false;
  _renderOpenLyricsImport();
  try { _olImport.books = await apiListSongbooks(); } catch (_) { _olImport.books = []; }
  _renderOpenLyricsImport();
}

function closeOpenLyricsImport() {
  const modal = document.getElementById('olImportModal');
  if (!modal || _olImport.busy) return;
  modal.hidden = true;
  _olImport.open = false;
  _olImport.paths = [];
}

function _setOlStatus(text, kind) {
  const el = document.getElementById('olStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-update-status' + (kind ? ' ' + kind : '');
}

// Nom ou code déjà pris (comparaison sans casse, comme côté Rust).
function _olConflicts() {
  const name = document.getElementById('olName').value.trim().toLowerCase();
  const code = document.getElementById('olCode').value.trim().toLowerCase();
  const byCode = code && _olImport.books.find(b => (b.code || '').toLowerCase() === code);
  return {
    name: !!name && _olImport.books.some(b => (b.name || '').toLowerCase() === name),
    // Code existant tel qu'il est écrit dans son recueil, pour le message.
    code: byCode ? byCode.code : '',
  };
}

function _renderOpenLyricsImport() {
  if (!_olImport.open) return;
  const nameInput = document.getElementById('olName');
  const codeInput = document.getElementById('olCode');
  const picked = document.getElementById('olPicked');
  const errorLine = document.getElementById('olError');
  const importBtn = document.getElementById('olImportBtn');
  const paths = _olImport.paths;
  picked.textContent = !paths.length ? t('openlyrics.nothingPicked')
    : paths.length === 1 ? paths[0].split(/[\\/]/).pop()
    : t('openlyrics.pickedMany', { count: String(paths.length) });
  picked.title = paths.length === 1 ? paths[0] : '';
  const taken = _olConflicts();
  nameInput.classList.toggle('error', taken.name);
  codeInput.classList.toggle('error', !!taken.code);
  const msg = taken.name && taken.code ? t('openlyrics.bothTaken')
    : taken.code ? t('openlyrics.codeTaken', { code: taken.code })
    : taken.name ? t('openlyrics.nameTaken', { name: nameInput.value.trim() })
    : '';
  errorLine.textContent = msg;
  errorLine.hidden = !msg;
  const span = importBtn.querySelector('span');
  if (span) span.textContent = t(_olImport.busy ? 'openlyrics.importing' : 'openlyrics.import');
  importBtn.disabled = _olImport.busy || !paths.length || !nameInput.value.trim()
    || !codeInput.value.trim() || taken.name || !!taken.code;
  document.getElementById('olPickBtn').disabled = _olImport.busy;
}

async function pickOpenLyricsFiles() {
  let selected;
  try {
    selected = await window.__TAURI__.dialog.open({
      multiple: true,
      filters: [{ name: 'OpenLyrics', extensions: ['xml', 'zip'] }],
    });
  } catch (_) { return; }
  if (!selected) return;
  _olImport.paths = Array.isArray(selected) ? selected : [selected];
  _setOlStatus('', '');
  _renderOpenLyricsImport();
}

async function runOpenLyricsImport() {
  const btn = document.getElementById('olImportBtn');
  if (!btn || btn.disabled) return;
  const name = document.getElementById('olName').value.trim();
  const code = document.getElementById('olCode').value.trim();
  _olImport.busy = true;
  _setOlStatus('', '');
  _renderOpenLyricsImport();
  let result;
  try {
    result = await apiImportOpenLyrics(_olImport.paths, name, code);
  } catch (err) {
    _setOlStatus(t('openlyrics.importError', { err: String(err) }), 'error');
    return;
  } finally {
    _olImport.busy = false;
    _renderOpenLyricsImport();
  }
  if (!result.imported) {
    _setOlStatus(t('openlyrics.noSongs'), 'error');
    return;
  }
  closeOpenLyricsImport();
  let msg = _countMsg('openlyrics.imported', result.imported);
  if (result.ignored) msg += ' ' + _countMsg('openlyrics.ignored', result.ignored);
  await refreshContentList();
  await _notifyContentChanged('songbooks');
  _setContentStatus(msg, 'ok');
}

document.getElementById('olImportModal')?.addEventListener('input', e => {
  if (e.target.closest('.ol-input')) _renderOpenLyricsImport();
});

document.getElementById('olImportModal')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('.ol-input')) {
    e.preventDefault();
    runOpenLyricsImport();
  }
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
  if (e.target.id === 'olImportModal') closeOpenLyricsImport();
  else if (e.target.id === 'contentModal') closeContentManager();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const importModal = document.getElementById('olImportModal');
  const modal = document.getElementById('contentModal');
  if (importModal && !importModal.hidden) {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeOpenLyricsImport();
  } else if (modal && !modal.hidden) {
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
