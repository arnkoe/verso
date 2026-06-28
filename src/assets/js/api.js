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

async function apiListSongbooks() {
  // Recueils présents : [{code, name}] (name = nom lisible, sinon code).
  return await invoke('list_songbooks');
}

// ─── BIBLE ───────────────────────────────────────────────────────────────────

async function apiListBibles() {
  // Traductions présentes : [{code, name}] (name = nom lisible, sinon code).
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

// ─── GESTION DES CONTENUS (modale Paramètres) ─────────────────────────────────

/** Liste les contenus d'un type pour la modale : [{filename, label}]. */
async function apiListContent(kind) {
  return await invoke('list_content', { kind });
}

/** Importe un fichier (chemin source absolu) dans le dossier du type. */
async function apiImportContent(kind, source) {
  return await invoke('import_content', { kind, source });
}

/** Supprime un contenu (par nom de fichier) du dossier du type. */
async function apiDeleteContent(kind, filename) {
  return await invoke('delete_content', { kind, filename });
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

async function apiOpenProjection(x, y, width, height) {
  return await invoke('open_projection', { x, y, width, height });
}

// ─── VERSION & MISE À JOUR ────────────────────────────────────────────────────
// Plugins exposés sur window.__TAURI__ grâce à `withGlobalTauri: true`.

/** Version courante de l'application (ex. "0.1.0"). */
async function apiAppVersion() {
  return await invoke('app_version');
}

/** Ouvre le dossier Verso (racine des données) dans le gestionnaire de fichiers. */
async function apiRevealVersoDir() {
  return await invoke('reveal_verso_dir');
}

/**
 * Vérifie en silence si une mise à jour est disponible.
 * Renvoie l'objet `update` (avec .version) si oui, sinon null. N'échoue jamais
 * bruyamment : une erreur réseau renvoie null (pas de mise à jour annoncée).
 */
async function apiCheckUpdate() {
  try {
    const update = await window.__TAURI__.updater.check();
    return update && update.available ? update : null;
  } catch (_) {
    return null;
  }
}

/** Télécharge, installe la mise à jour fournie, puis relance l'application. */
async function apiInstallUpdate(update) {
  await update.downloadAndInstall();
  await window.__TAURI__.process.relaunch();
}
