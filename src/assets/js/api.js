/**
 * api.js — couche d'accès aux données.
 *
 * Remplace les appels `fetch(../api/*.php)` de la version web par des commandes
 * Tauri (`invoke`). Expose les mêmes signatures logiques pour que operator.js et
 * projection-render.js restent quasi inchangés.
 *
 * Chargé avant utils.js / operator.js / projection-render.js.
 * `withGlobalTauri: true` expose l'API sur `window.__TAURI__`.
 */

const { invoke, convertFileSrc } = window.__TAURI__.core;
const tauriEvent = window.__TAURI__.event;

// ─── CHANTS ──────────────────────────────────────────────────────────────────

async function apiListSongs() {
  // Retourne [{id,title,author,source_book,source_number,verse_count}]
  return await invoke('list_songs');
}

async function apiGetSong(id) {
  return await invoke('get_song', { id });
}

async function apiUpdateSong(id, verses) {
  return await invoke('update_song', { id, verses });
}

// ─── BIBLE ───────────────────────────────────────────────────────────────────

async function apiListBibles() {
  // Liste des traductions présentes dans le dossier utilisateur.
  return await invoke('list_bibles');
}

async function apiBibleBooks(translation) {
  return await invoke('bible_books', { translation });
}

async function apiBibleSearch(q, translation) {
  // Retourne soit {verses, translation} soit {books, translation}.
  return await invoke('bible_search', { q, translation });
}

// ─── PDF & IMAGES ────────────────────────────────────────────────────────────

async function apiListPdfs() {
  return await invoke('list_pdfs'); // [{filename}]
}

async function apiListImages() {
  return await invoke('list_images');
}

async function apiRevealMediaDir(kind) {
  // Ouvre le dossier pdf/ ou images/ dans le gestionnaire de fichiers natif.
  return await invoke('reveal_media_dir', { kind });
}

/**
 * URL `asset://` utilisable dans <img src> ou pdf.js, pour un média stocké.
 * Met en cache pour éviter un aller-retour IPC à chaque rendu.
 */
const _mediaUrlCache = new Map();
async function mediaUrl(kind, filename) {
  const key = kind + '/' + filename;
  if (_mediaUrlCache.has(key)) return _mediaUrlCache.get(key);
  const path = await invoke('media_path', { kind, filename });
  const url = convertFileSrc(path);
  _mediaUrlCache.set(key, url);
  return url;
}

// ─── PROJECTION ──────────────────────────────────────────────────────────────

async function apiGetProjectionState() {
  return await invoke('get_projection_state');
}

async function apiSetProjectionState(payload) {
  return await invoke('set_projection_state', { payload });
}

async function apiListMonitors() {
  return await invoke('list_monitors');
}

async function apiOpenProjection(x, y, width, height, fullscreen) {
  return await invoke('open_projection', { x, y, width, height, fullscreen });
}

async function apiCloseProjection() {
  return await invoke('close_projection');
}
