/**
 * operator.js — logique de l'opérateur (version Tauri).
 *
 * Adapté de la version web : les appels API PHP sont remplacés par les helpers
 * de api.js (invoke), le BroadcastChannel par l'event Tauri "projection-update",
 * et l'ouverture multi-écran par les commandes list_monitors / open_projection.
 */

// État global
const state = {
  activeTab: 'cantiques',
  song: null,
  songId: null,   // id de session du chant chargé (non sérialisé dans song)
  songVerse: -1,
  bible: null,
  bibleVerse: -1,
  pdf: null,
  pdfPage: -1,
  image: null,
  projection: null,
  bibleCode: null,
  searchCursor: 0,
};
let lastActiveProjection = null;

// Le libellé du bouton « Ouvrir le dossier Verso » dépend de la plateforme :
// « Finder » sur macOS, « explorateur » sur Windows. On remplace les clés i18n
// des éléments concernés avant applyI18n() pour que les changements de langue
// (qui réappliquent les clés) restent corrects.
(function localizeOpenVersoButton() {
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
  const isWin = /Win/i.test(navigator.platform || navigator.userAgent || '');
  if (!isMac && !isWin) return;
  const label = document.getElementById('btnOpenVersoDirLabel');
  const btn = document.getElementById('btnOpenVersoDir');
  if (label) {
    label.dataset.i18n = isMac ? 'settings.openInFinder' : 'settings.openInExplorer';
  }
  if (btn) {
    btn.dataset.i18nTitle = isMac
      ? 'settings.openVersoFinderTitle'
      : 'settings.openVersoExplorerTitle';
  }
})();

// Traduit l'interface statique selon la langue stockée (anglais par défaut),
// avant que le reste du script ne peuple les listes dynamiques.
applyI18n();
apiSetMenuLanguage(currentLang()).catch(() => {});

// Indicateur « en projection » affiché sur l'item live d'une liste.
// Le libellé (aria-label) dépend de la langue active, d'où la construction
// à la volée.
function livePill() {
  return `<span class="live-pill" role="img" aria-label="${esc(t('list.live'))}"></span>`;
}

// Marque/démarque un item de liste comme étant en projection (classe + pastille).
function setLive(el, isLive) {
  el.classList.toggle('active', isLive);
  const action = el.querySelector('.strophe-action');
  if (action) action.innerHTML = isLive ? livePill() : '';
}

// ─── PROJECTION API ──────────────────────────────────────────────────────────

function applyProjectionState(payload) {
  if (payload?.type && payload.type !== 'blank') {
    lastActiveProjection = payload;
  } else if (payload?.previous?.type && payload.previous.type !== 'blank') {
    lastActiveProjection = payload.previous;
  }
  state.projection = payload;
  updatePreview(payload);
  syncActiveItems(payload);
}

async function project(payload) {
  applyProjectionState(payload);
  // Persiste + émet vers la fenêtre projection (remplace BroadcastChannel).
  await apiSetProjectionState(payload);
}

// Une mise à jour peut aussi provenir des raccourcis de la fenêtre de projection.
// Dans ce cas, garde l'aperçu et les indicateurs « en projection » synchronisés.
tauriEvent.listen('projection-update', e => {
  if (JSON.stringify(e.payload) === JSON.stringify(state.projection)) return;
  applyProjectionState(e.payload);
});

// Les réglages vivent dans des WebViews légers et persistants. Leurs mutations
// sont diffusées explicitement afin que l'opérateur ne dépende pas d'un partage
// implicite de l'état JavaScript entre fenêtres.
tauriEvent.listen('language-changed', e => {
  if (e.payload !== currentLang()) setLang(e.payload, _retranslateDynamic);
});
tauriEvent.listen('content-changed', e => {
  _reloadMainAfterContent(e.payload);
});
tauriEvent.listen('projection-screen-changed', e => {
  try { localStorage.setItem(PROJ_SCREEN_KEY, JSON.stringify(e.payload)); } catch (_) {}
  _updateMonitorScreen(e.payload);
});

// ─── MISES À JOUR ───────────────────────────────────────────────────────────

async function checkUpdateOnStartup() {
  try {
    const update = await apiCheckUpdate();
    const link = document.getElementById('emptyStateUpdate');
    if (link) link.hidden = !update;
  } catch (err) {
    // Une indisponibilité réseau ne doit jamais perturber l'utilisation de
    // l'opérateur ni être présentée comme une version à jour.
    console.warn('Update check failed:', err);
  }
}

async function openUpdateSettings() {
  try { await apiShowAuxiliaryWindow('settings'); } catch (_) {}
}

// ─── TABS ───────────────────────────────────────────────────────────────────

function switchSideTab(tab) {
  state.activeTab = tab;
  TAB_ORDER.forEach(t => {
    document.getElementById('tab' + t[0].toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  // Déplace la pastille du contrôle segmenté sur l'onglet actif.
  document.querySelector('.tabs').style.setProperty('--seg-index', TAB_ORDER.indexOf(tab));
  document.getElementById('searchCantiques').style.display = tab === 'cantiques' ? '' : 'none';
  document.getElementById('searchBible').style.display     = tab === 'bible'     ? 'flex' : 'none';
  document.getElementById('listPdf').style.display         = tab === 'pdf'       ? 'flex' : 'none';
  document.getElementById('listImages').style.display      = tab === 'images'    ? 'flex' : 'none';

  const panel = tab === 'bible' ? 'panelBible'
              : tab === 'pdf' ? 'panelPdf'
              : tab === 'images' ? 'panelImages'
              : 'panelCantique';
  showPanel(panel);

  // Relit le dossier à l'ouverture de l'onglet : l'utilisateur dépose ses
  // fichiers directement dans pdf/ ou images/, sans import via l'interface.
  if (tab === 'pdf') loadPdfList();
  else if (tab === 'images') loadImageList();

  // Aligne le curseur clavier sur l'élément déjà chargé (classe .active) plutôt
  // que de le remettre en tête : sans ça, le curseur surlignerait le 1er résultat
  // en plus de l'élément actif au retour sur l'onglet.
  const active = searchListEl()?.querySelector('.content-item.active');
  const idx = active ? searchItems().indexOf(active) : -1;
  state.searchCursor = idx >= 0 ? idx : 0;
  updateSearchCursor();
}

function showPanel(id) {
  ['panelCantique', 'panelBible', 'panelPdf', 'panelImages'].forEach(p => {
    document.getElementById(p).classList.toggle('active', p === id);
  });
  updateEmptyState();
}

// Vrai si l'onglet de contenu actif a un élément sélectionné.
function activeTabHasContent() {
  return ({
    cantiques: () => !!state.song,
    bible:     () => !!state.bible,
    pdf:       () => !!state.pdf,
    images:    () => !!state.image,
  })[state.activeTab]?.() ?? false;
}

// L'empty state apparaît pour tout onglet sans contenu sélectionné, y compris
// après qu'un contenu a été chargé dans un autre onglet.
function updateEmptyState() {
  document.querySelector('.main').dataset.loaded = activeTabHasContent() ? 'true' : 'false';
}

// ─── CANTIQUES ───────────────────────────────────────────────────────────────

let songCache = null;

let songCachePromise = null;

// Map code de recueil → nom lisible (issu des données via `list_songbooks`).
// Sert à afficher les noms lisibles tout en filtrant/groupant par code.
const songbookNames = new Map();

function songbookName(code) {
  return (code && songbookNames.get(code)) || code || '';
}

async function loadSongbookNames() {
  try {
    const list = await apiListSongbooks();
    songbookNames.clear();
    for (const { code, name } of list) songbookNames.set(code, name);
  } catch (_) { /* liste indisponible : on retombe sur les codes */ }
}

async function loadSongCache() {
  if (songCache) return songCache;
  // Réutilise la promesse en cours et la réinitialise en cas d'échec
  // pour permettre une nouvelle tentative au prochain appel.
  if (!songCachePromise) {
    songCachePromise = Promise.all([apiListSongs(), loadSongbookNames()])
      .then(([s]) => { songCache = s; return s; })
      .catch(err => { songCachePromise = null; throw err; });
  }
  return songCachePromise;
}

loadSongCache().catch(() => {}); // préchargement, erreurs gérées à la recherche

function searchPrompt(key) {
  return `<div class="search-empty search-prompt" data-i18n="${key}">${esc(t(key))}</div>`;
}

document.getElementById('songSearchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  if (q.length < 1) {
    document.getElementById('songList').innerHTML = searchPrompt('search.songsEmpty');
    return;
  }
  if (!songCache) {
    const list = document.getElementById('songList');
    list.innerHTML = searchPrompt('list.loading');
    try {
      await loadSongCache();
    } catch (err) {
      list.innerHTML = `<div class="search-empty search-prompt">${esc(t('list.songsError', { err: String(err) }))}</div>`;
      return;
    }
    // L'utilisateur a pu continuer à taper pendant le chargement.
    if (e.target.value.trim() !== q) return;
  }
  searchSongs(q);
});

function searchSongs(q) {
  if (!songCache) return;
  const isNumeric = /^\d+$/.test(q.trim());
  const num       = isNumeric ? parseInt(q, 10) : NaN;
  // Recherche par phrase insensible aux accents : la requête (espaces normalisés)
  // doit apparaître telle quelle dans le titre OU dans la 1re ligne d'une strophe.
  // Chaque candidat est testé séparément pour éviter un match à cheval.
  const needle = foldAccents(q).replace(/\s+/g, ' ').trim();
  const norm = s => foldAccents(s).replace(/\s+/g, ' ').trim();
  let hits = isNumeric
    ? songCache.filter(s => s.source_number === num)
    : songCache.filter(s =>
        norm(s.title).includes(needle) ||
        (s.incipits || []).some(line => norm(line).includes(needle))
      );
  // Groupé par code de recueil ; le nom lisible est résolu au rendu.
  const grouped = {};
  for (const s of hits) {
    const book = s.songbook_code || '';
    (grouped[book] = grouped[book] || []).push(s);
  }
  renderSongList(grouped);
}

function renderSongList(grouped) {
  const list = document.getElementById('songList');
  if (!Object.keys(grouped).length) {
    list.innerHTML = searchPrompt('list.noResult');
    return;
  }
  list.innerHTML = Object.entries(grouped).map(([book, items]) =>
    items.map(s => `
      <div class="content-item" data-song-id="${s.id}" data-action="loadSong">
        <span class="item-source">${esc(book)}</span>
        <span class="item-number">${s.source_number ?? ''}</span>
        <span class="item-title">${esc(s.title)}</span>
      </div>
    `).join('')
  ).join('');
  markActiveSong();
}

// La liste des résultats est réécrite entièrement à chaque rendu : sans ce
// rappel, le chant chargé perdrait sa marque de sélection (le point vert) dès
// qu'un re-rendu survient hors clic, par exemple après une synchronisation des
// recueils. Seule source de vérité pour la classe `active`.
function markActiveSong() {
  document.querySelectorAll('#songList .content-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.songId) === state.songId);
  });
}

async function loadSong(id) {
  const song = await apiGetSong(id);
  state.song      = song;
  // L'id n'est pas sérialisé dans l'objet Song (skip_serializing côté Rust) :
  // on conserve donc l'id de session passé ici pour les opérations ultérieures
  // (sauvegarde). Sans ça, state.song.id serait undefined.
  state.songId    = id;
  state.songVerse = -1;

  markActiveSong();

  document.getElementById('songHeader').style.display = '';
  updateEmptyState();
  // Kicker = nom lisible du recueil (résolu via songbookNames) ; abrév = code.
  const kicker = songbookName(song.songbook_code);
  const abbr = song.songbook_code || '';
  const prefix = song.songbook_code && song.source_number ? `${abbr} ${song.source_number} – ` : '';
  document.getElementById('songSubtitle').textContent = kicker;
  document.getElementById('songTitle').textContent = prefix + song.title;

  showPanel('panelCantique');
  renderVerseList();
  exitEditMode();
}

function renderVerseList() {
  const song = state.song;
  if (!song) return;
  const verseList = document.getElementById('verseList');
  verseList.innerHTML = song.verses.map((verse, i) => {
    const shortLabel = verseShortLabel(verse.type, verse.number);
    const isLive = i === state.songVerse;
    return `<div class="list-item strophe-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectVerse">
      <div class="strophe-index">
        <div class="strophe-action">${isLive ? livePill() : ''}</div>
        <div class="strophe-number">${esc(shortLabel)}</div>
      </div>
      <div class="strophe-text">${esc(verse.text)}</div>
    </div>`;
  }).join('');
}

function projectVerse(i) {
  if (!state.song) return;
  state.songVerse = i;
  project({
    type: 'song',
    id: state.songId,
    verse: i,
    title: state.song.title,
    songbook_code: state.song.songbook_code,
    source_number: state.song.source_number,
    verseText: state.song.verses[i].text,
    verseLabels: state.song.verses.map(v => verseShortLabel(v.type, v.number)),
  });
}

// ─── BIBLE ───────────────────────────────────────────────────────────────────

const bibleBooksCache = {};

// Bible par défaut : mémorise la dernière traduction sélectionnée.
const DEFAULT_BIBLE_KEY = 'verso.defaultBible';

function _savedDefaultBible() {
  try { return localStorage.getItem(DEFAULT_BIBLE_KEY); }
  catch (_) { return null; }
}

function _saveDefaultBible(t) {
  try { localStorage.setItem(DEFAULT_BIBLE_KEY, t); }
  catch (_) { /* stockage indisponible */ }
}

async function loadBibleBooks(bibleCode) {
  if (bibleBooksCache[bibleCode]) return bibleBooksCache[bibleCode];
  const data = await apiBibleBooks(bibleCode);
  bibleBooksCache[bibleCode] = data.books || [];
  return bibleBooksCache[bibleCode];
}

// Map code de bible → nom lisible (issu des données via `list_bibles`).
const bibleNames = new Map();

function bibleName(code) {
  return (code && bibleNames.get(code)) || code || '';
}

// Traductions disponibles (bibles du dossier utilisateur), résolues au démarrage.
let bibleTranslationsList = [];

// Charge la liste des bibles présentes dans le dossier utilisateur et fixe la
// traduction par défaut. Les boutons de sélection ne sont rendus qu'à
// l'affichage d'un chapitre (voir renderBibleTranslations).
async function initBibleTranslations() {
  let translations = [];
  try {
    translations = await apiListBibles();
  } catch (_) { /* dossier indisponible : liste vide */ }

  bibleTranslationsList = translations;
  bibleNames.clear();
  for (const { code, name } of translations) bibleNames.set(code, name);

  if (!translations.length) {
    state.bibleCode = null;
    return;
  }

  const codes = translations.map(x => x.code);
  const saved = _savedDefaultBible();
  state.bibleCode = codes.includes(saved) ? saved : codes[0];
  loadBibleBooks(state.bibleCode);

  // Un chapitre est déjà affiché (rechargement après ajout/suppression de
  // bibles) : rafraîchit les boutons de traduction dans son en-tête.
  if (state.bible?.verses?.length) renderBibleTranslations();
}

// Rend les boutons de traduction dans l'en-tête du chapitre affiché, à côté du
// titre, et marque la traduction courante comme active.
function renderBibleTranslations() {
  const wrap = document.getElementById('bibleTranslations');
  wrap.innerHTML = bibleTranslationsList
    .map(({ code, name }) =>
      `<button class="filter-btn${code === state.bibleCode ? ' active' : ''}" data-action="selectBibleCode" data-arg="${esc(code)}" title="${esc(name)}">${esc(code)}</button>`)
    .join('');
  // Nombre de segments de la piste ; la pastille en fait un et se déplace par
  // multiples de sa largeur (voir le contrôle segmenté dans operator.css).
  wrap.style.setProperty('--seg-count', bibleTranslationsList.length || 1);
  setBibleSegIndex(bibleTranslationsList.findIndex(x => x.code === state.bibleCode));
}

// Déplace la pastille sur la traduction active. Un index hors liste (aucune
// traduction courante) la laisse au premier segment.
function setBibleSegIndex(i) {
  document.getElementById('bibleTranslations')
    .style.setProperty('--seg-index', Math.max(0, i));
}

initBibleTranslations();

// Retire les accents en conservant les espaces (pour la recherche multi-mots,
// titres de chants…). La variante `stripAccents` colle les espaces : adaptée aux
// références bibliques ("1 chr" → "1chr") mais pas aux titres.
function foldAccents(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // Unifie les apostrophes typographiques (’ ‘ ʼ) avec l'apostrophe droite.
    .replace(/[’‘ʼ]/g, "'");
}

function stripAccents(s) {
  return foldAccents(s).replace(/\s+/g, '');
}

function findBooks(books, needle, requiresLeadingDigit = false) {
  const n = stripAccents(needle);
  const exact = [], prefix = [], contains = [];
  for (const book of books) {
    const b = stripAccents(book);
    if (requiresLeadingDigit && !/^\d/.test(b)) continue;
    if (b === n) exact.push(book);
    else if (b.startsWith(n)) prefix.push(book);
    else if (b.includes(n)) contains.push(book);
  }
  if (exact.length)  return exact;
  if (prefix.length) return prefix;
  return contains;
}

// Résout une saisie « livre chapitre » (l'opérateur cible toujours un chapitre,
// jamais un verset précis ; un éventuel « :verset » est toléré mais ignoré).
function resolveRef(q, books) {
  const m = q.match(/^(\d?\s*[A-Za-zÀ-ÿ]+\.?)\s*(\d+)(?::\d+(?:-\d+)?)?$/u);
  if (!m) return null;
  const bookRaw = m[1].trim();
  const chapter = parseInt(m[2], 10);

  const dm = bookRaw.match(/^(\d)\s*(.+)$/u);
  let candidates;
  if (dm) {
    candidates = findBooks(books, dm[1] + dm[2], true);
    if (!candidates.length) candidates = findBooks(books, dm[2], true);
  } else {
    candidates = findBooks(books, bookRaw, false);
  }
  if (!candidates.length) return null;
  if (candidates.length > 1) return { ambiguous: true, candidates, chapter };
  return { book: candidates[0], chapter };
}

let bibleReqSeq = 0;
// Verset à reprojeter après un changement de traduction (null = aucun).
// On retient { num, text } : le numéro sert d'ancre, le texte permet de
// retrouver le bon verset quand la versification diffère entre traductions.
let reprojectBibleVerse = null;

// Ensemble de mots-outils français trop fréquents pour discriminer un verset.
const VERSE_STOPWORDS = new Set(
  'le la les un une des de du et a au aux en que qui ne se sa son ses ce cette ces il elle ils elles je tu nous vous on y pour par sur dans avec sans est sont fut'
    .split(' '));

// Tokens significatifs d'un verset (sans accents, sans ponctuation, sans
// mots-outils, sans mots d'une seule lettre).
function verseTokens(text) {
  return foldAccents(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !VERSE_STOPWORDS.has(w));
}

// Similarité de Jaccard entre deux ensembles de tokens (0 à 1).
function tokenSimilarity(aTokens, bSet) {
  if (!aTokens.length || !bSet.size) return 0;
  let inter = 0;
  const seen = new Set();
  for (const w of aTokens) {
    if (seen.has(w)) continue;
    seen.add(w);
    if (bSet.has(w)) inter++;
  }
  const union = seen.size + bSet.size - inter;
  return union ? inter / union : 0;
}

// Cherche dans `verses` l'index du verset le plus proche de `srcText`, en se
// limitant à une fenêtre autour de `num` (±SEARCH). Renvoie -1 si aucun verset
// ne dépasse le seuil de similarité. Sert à rattraper les décalages de
// versification entre traductions.
function bestVerseMatch(verses, num, srcText) {
  const WINDOW = 2;       // versets de part et d'autre du numéro d'origine
  const THRESHOLD = 0.1;  // similarité minimale pour accepter une correspondance
  const src = verseTokens(srcText);
  if (!src.length) return -1;
  let bestIdx = -1, bestScore = THRESHOLD;
  for (let i = 0; i < verses.length; i++) {
    if (Math.abs(verses[i].verse - num) > WINDOW) continue;
    const score = tokenSimilarity(src, new Set(verseTokens(verses[i].text)));
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function bibleRefAttr(book, chapter) {
  return esc(JSON.stringify({ book, chapter }));
}

// Construit la liste HTML des livres. `entry(book)` retourne
// l'objet { ref, title } d'un item (référence pour data-bible-ref + libellé affiché).
function renderBibleBookList(candidates, entry) {
  let html = '';
  for (const b of candidates.slice(0, 20)) {
    const { ref, title } = entry(b);
    html += `<div class="content-item" data-bible-ref='${ref}'><span class="item-title">${esc(title)}</span></div>`;
  }
  return html;
}

document.getElementById('bibleSearchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  const list = document.getElementById('bibleList');
  if (!q) { list.innerHTML = searchPrompt('search.bibleEmpty'); return; }
  if (!state.bibleCode) {
    list.innerHTML = searchPrompt('list.noBibleAvailable');
    return;
  }

  const books = await loadBibleBooks(state.bibleCode);
  const ref   = resolveRef(q, books);

  if (ref) {
    const candidates = ref.ambiguous ? ref.candidates : [ref.book];
    list.innerHTML = renderBibleBookList(candidates, b => ({
      ref: bibleRefAttr(b, ref.chapter),
      title: `${b} ${ref.chapter}`,
    }));
    if (candidates.length === 1) {
      list.querySelector('.content-item').classList.add('active');
      fetchBibleChapter({ book: candidates[0], chapter: ref.chapter });
    }
    return;
  }

  const matches = findBooks(books, q, false).slice(0, 20);
  if (!matches.length) { list.innerHTML = searchPrompt('list.noBook'); return; }
  list.innerHTML = renderBibleBookList(matches, b => ({
    ref: bibleRefAttr(b, 1),
    title: b,
  }));
});

document.getElementById('bibleList').addEventListener('click', e => {
  const refItem = e.target.closest('[data-bible-ref]');
  if (!refItem) return;
  const ref = JSON.parse(refItem.getAttribute('data-bible-ref'));
  document.querySelectorAll('#bibleList .content-item').forEach(el => el.classList.remove('active'));
  refItem.classList.add('active');
  fetchBibleChapter(ref);
});

async function selectBibleCode(btn, code) {
  document.querySelectorAll('#bibleTranslations .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  setBibleSegIndex(bibleTranslationsList.findIndex(x => x.code === code));
  state.bibleCode = code;
  _saveDefaultBible(code);
  await loadBibleBooks(code);

  // Aucun chapitre affiché : rien à recharger.
  const cur = state.bible?.verses[0];
  if (!cur) return;

  // On recharge le chapitre courant dans la nouvelle traduction depuis l'état
  // (state.bible), pas depuis le champ de recherche qui ne contient souvent
  // qu'un nom de livre. Si un verset est en projection, on mémorise son numéro
  // et son texte pour rebasculer dessus après le rechargement, même en cas de
  // versification différente (cf. fetchBibleChapter).
  const liveVerse = state.bible.verses[state.bibleVerse];
  reprojectBibleVerse =
    state.projection?.type === 'bible' && liveVerse
      ? { num: liveVerse.verse, text: liveVerse.text }
      : null;
  fetchBibleChapter({ book: cur.book, chapter: cur.chapter });
}

async function fetchBibleChapter(ref) {
  const seq = ++bibleReqSeq;
  const q = `${ref.book} ${ref.chapter}`;
  let data;
  try {
    data = await apiBibleSearch(q, state.bibleCode);
  } catch (err) {
    if (seq !== bibleReqSeq) return;
    reprojectBibleVerse = null;
    document.getElementById('bibleList').innerHTML = `<div class="search-empty search-prompt">${esc(String(err))}</div>`;
    return;
  }
  if (seq !== bibleReqSeq) return;
  if (!data.verses || !data.verses.length) { reprojectBibleVerse = null; return; }

  state.bible = { verses: data.verses, bibleCode: data.bible_code };
  state.bibleVerse = -1;

  const first = data.verses[0];
  const last  = data.verses[data.verses.length - 1];
  const title = first.verse === last.verse
    ? `${first.book} ${first.chapter}:${first.verse}`
    : `${first.book} ${first.chapter}:${first.verse}–${last.verse}`;
  // Sous-titre = nom lisible de la traduction (résolu via bibleNames), sinon le code.
  const translationLabel = bibleName(data.bible_code);
  document.getElementById('bibleHeader').style.display = '';
  updateEmptyState();
  document.getElementById('bibleTitle').textContent = title;
  // Crédit/licence de la traduction (champ bible_copyright du JSON, ex. CC
  // BY-NC-ND) accolé au libellé, dans le même style que le reste du kicker.
  let subtitle = 'Traduction ' + translationLabel;
  if (data.bible_copyright) subtitle += ' - ' + data.bible_copyright;
  document.getElementById('bibleSubtitle').textContent = subtitle;
  renderBibleTranslations();
  showPanel('panelBible');
  renderBibleVerses(data.verses);

  // Reprojection après changement de traduction. On vise le même numéro de
  // verset ; si la versification diffère (numéro absent, ou texte trop éloigné),
  // on cherche le verset le plus proche par similarité de texte. À défaut on
  // laisse l'ancien verset projeté.
  if (reprojectBibleVerse) {
    const { num, text } = reprojectBibleVerse;
    reprojectBibleVerse = null;
    const sameNumIdx = data.verses.findIndex(v => v.verse === num);
    // Si le verset au même numéro ressemble fortement à la source, on le garde
    // directement (cas aligné, fréquent) ; sinon on élargit la recherche.
    let idx = sameNumIdx;
    if (sameNumIdx >= 0) {
      const sim = tokenSimilarity(verseTokens(text), new Set(verseTokens(data.verses[sameNumIdx].text)));
      if (sim < 0.2) idx = bestVerseMatch(data.verses, num, text);
    } else {
      idx = bestVerseMatch(data.verses, num, text);
    }
    if (idx >= 0) projectBibleVerse(idx);
  }
}

function renderBibleVerses(verses) {
  const list = document.getElementById('bibleVerseList');
  list.innerHTML = verses.map((v, i) => {
    const isLive = i === state.bibleVerse;
    return `<div class="list-item bible-verse-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectBibleVerse">
      <div class="strophe-index">
        <div class="strophe-action">${isLive ? livePill() : ''}</div>
        <span class="bible-verse-number">${v.verse}</span>
      </div>
      <span class="bible-verse-text">${esc(v.text)}</span>
    </div>`;
  }).join('');
}

function projectBibleVerse(i) {
  const v = state.bible?.verses[i];
  if (!v) return;
  state.bibleVerse = i;
  project({
    type: 'bible',
    verse: i,
    bibleCode: state.bibleCode,
    reference: `${v.book} ${v.chapter}:${v.verse}`,
    text: v.text,
  });
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

let pdfFiles = [];

async function loadPdfList() {
  pdfFiles = (await apiListPdfs()) || [];
  renderPdfList(filterMedia(pdfFiles, document.getElementById('pdfSearchInput').value));
}

// Filtre une liste de médias [{filename}] par sous-chaîne (insensible à la casse).
function filterMedia(files, q) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return files;
  return files.filter(f => f.filename.toLowerCase().includes(needle));
}

function renderPdfList(files) {
  const list = document.getElementById('pdfList');
  if (!files.length) { list.innerHTML = searchPrompt('pdf.empty'); return; }
  list.innerHTML = files.map(f => `
    <div class="content-item" data-pdf-file="${esc(f.filename)}" data-action="selectPdf">
      <span class="item-title">${esc(f.filename)}</span>
    </div>
  `).join('');
}

document.getElementById('pdfSearchInput').addEventListener('input', e => {
  renderPdfList(filterMedia(pdfFiles, e.target.value));
});


function selectPdf(filename) {
  state.pdf = { filename, page_count: 0 };
  state.pdfPage = -1;

  document.querySelectorAll('#pdfList .content-item').forEach(el => {
    el.classList.toggle('active', el.dataset.pdfFile === filename);
  });

  document.getElementById('pdfHeader').style.display = '';
  updateEmptyState();
  document.getElementById('pdfTitle').textContent = filename;
  document.getElementById('pdfSubtitle').textContent = '…';
  showPanel('panelPdf');
  document.getElementById('pdfPageList').innerHTML = `<div class="search-empty">${esc(t('list.loading'))}</div>`;

  renderPdfThumbnails(filename);
}

function renderPdfPageList(filename, pageCount) {
  state.pdf.page_count = pageCount;
  document.getElementById('pdfSubtitle').textContent = `${pageCount} pages`;
  const list = document.getElementById('pdfPageList');
  list.innerHTML = Array.from({ length: pageCount }, (_, i) => `
    <div class="list-item pdf-page-item" data-page="${i+1}" data-action="projectPdfPage">
      <div class="strophe-index">
        <div class="strophe-action"></div>
        <div class="strophe-number">${i + 1}</div>
      </div>
      <div class="pdf-page-thumb" data-thumb-page="${i+1}">
        <div class="thumb-loading">…</div>
      </div>
    </div>
  `).join('');
}

let _pdfThumbToken = 0;
async function renderPdfThumbnails(filename) {
  const token = ++_pdfThumbToken;
  if (!window.pdfjsLib) return;
  try {
    const url = await mediaUrl('pdf', filename);
    const doc = await pdfjsLib.getDocument({ url }).promise;
    if (token !== _pdfThumbToken) { doc.destroy(); return; }
    const pageCount = doc.numPages;
    renderPdfPageList(filename, pageCount);
    for (let p = 1; p <= pageCount; p++) {
      if (token !== _pdfThumbToken) { doc.destroy(); return; }
      const thumb = document.querySelector(`#pdfPageList .pdf-page-thumb[data-thumb-page="${p}"]`);
      if (!thumb) continue;
      try {
        const page = await doc.getPage(p);
        const canvas = document.createElement('canvas');
        await _renderPdfPageToCanvas(page, canvas, 240);
        if (token !== _pdfThumbToken) { doc.destroy(); return; }
        thumb.innerHTML = '';
        thumb.appendChild(canvas);
      } catch (e) {
        thumb.innerHTML = '<div class="thumb-loading">—</div>';
      }
    }
    doc.destroy();
  } catch (e) {
    console.warn('PDF thumbnails failed:', e);
  }
}

function projectPdfPage(page) {
  if (!state.pdf) return;
  state.pdfPage = page;

  document.querySelectorAll('#pdfPageList .pdf-page-item').forEach(el => {
    setLive(el, parseInt(el.dataset.page) === page);
  });

  project({ type: 'pdf', filename: state.pdf.filename, page });
}

// ─── IMAGES ──────────────────────────────────────────────────────────────────

let imageFiles = [];

async function loadImageList() {
  imageFiles = (await apiListImages()) || [];
  renderImageList(filterMedia(imageFiles, document.getElementById('imageSearchInput').value));
}

function renderImageList(files) {
  const list = document.getElementById('imageList');
  if (!files.length) { list.innerHTML = searchPrompt('images.empty'); return; }
  list.innerHTML = files.map(f => `
    <div class="content-item" data-image-file="${esc(f.filename)}" data-action="selectImage">
      <span class="item-title">${esc(f.filename)}</span>
    </div>
  `).join('');
}

document.getElementById('imageSearchInput').addEventListener('input', e => {
  renderImageList(filterMedia(imageFiles, e.target.value));
});

async function selectImage(filename) {
  state.image = { filename };

  document.querySelectorAll('#imageList .content-item').forEach(el => {
    el.classList.toggle('active', el.dataset.imageFile === filename);
  });

  document.getElementById('imageHeader').style.display = '';
  updateEmptyState();
  document.getElementById('imageTitle').textContent = filename;
  document.getElementById('imageSubtitle').textContent = '…';
  showPanel('panelImages');

  const isLive = state.projection && state.projection.type === 'image' && state.projection.filename === filename;
  const url = await mediaUrl('images', filename);
  const preview = document.getElementById('imagePreview');
  preview.innerHTML = `
    <div class="list-item strophe-item image-page-item${isLive ? ' active' : ''}" data-image-preview="${esc(filename)}" data-action="projectImage">
      <div class="strophe-index">
        <div class="strophe-action">${isLive ? livePill() : ''}</div>
      </div>
      <img src="${esc(url)}" style="max-width:100%;max-height:400px;object-fit:contain;display:block;">
    </div>
  `;

  const img = preview.querySelector('img');
  const showDimensions = () => {
    if (state.image && state.image.filename === filename && img.naturalWidth) {
      document.getElementById('imageSubtitle').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    }
  };
  if (img.complete) showDimensions();
  else img.addEventListener('load', showDimensions, { once: true });
}

function projectImage() {
  if (!state.image) return;

  document.querySelectorAll('#imagePreview .strophe-item').forEach(el => {
    setLive(el, el.dataset.imagePreview === state.image.filename);
  });

  project({ type: 'image', filename: state.image.filename });
}

// ─── MASQUAGE DE LA PROJECTION ───────────────────────────────────────────────

function hideProjection() {
  project({ type: 'blank', ...(lastActiveProjection && { previous: lastActiveProjection }) });
}

// ─── PRÉVISUALISATION ────────────────────────────────────────────────────────

function updatePreview(s) {
  const el = document.getElementById('previewContent');
  el.classList.remove('preview-fullbleed');
  if (!s || s.type === 'blank') {
    el.innerHTML = '';
    scalePreview();
    return;
  }
  if (s.type === 'song' || s.type === 'bible') {
    renderProjectionContent(s, el);
    scalePreview();
    return;
  }
  if (s.type === 'pdf') {
    el.innerHTML = '';
    el.classList.add('preview-fullbleed');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    el.appendChild(canvas);
    renderPreviewPdf(canvas, s.filename, s.page);
    scalePreview();
    return;
  }
  if (s.type === 'image') {
    el.innerHTML = '';
    el.classList.add('preview-fullbleed');
    mediaUrl('images', s.filename).then(url => {
      el.innerHTML = `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:contain;display:block;">`;
    });
    scalePreview();
    return;
  }
  el.innerHTML = '';
  scalePreview();
}

const SLIDE_ASPECT = 16 / 9;
const SLIDE_REF_W = 1600;

function _targetSlideSize() {
  return { w: SLIDE_REF_W, h: SLIDE_REF_W / SLIDE_ASPECT };
}

function scalePreview() {
  const mon = document.getElementById('previewMonitor');
  const stage = document.getElementById('previewStage');
  if (!mon || !stage) return;
  const { w, h } = _targetSlideSize();
  stage.style.width  = w + 'px';
  stage.style.height = h + 'px';
  const scale = Math.min(mon.clientWidth / w, mon.clientHeight / h);
  const offsetX = (mon.clientWidth - w * scale) / 2;
  // Le contenu reste aligné en haut dans le retour projection. Le cadre 16/10
  // absorbe simplement l'espace restant sous le slide 16/9.
  stage.style.transform = `translate(${offsetX}px, 0) scale(${scale})`;
}

window.addEventListener('resize', scalePreview);
scalePreview();

const _previewPdfCache = new Map();
let _previewPdfSeq = 0;
async function renderPreviewPdf(canvas, filename, pageNum) {
  const seq = ++_previewPdfSeq;
  if (!window.pdfjsLib) return;
  try {
    const doc = await _loadPdfDoc(filename, _previewPdfCache);
    if (seq !== _previewPdfSeq) return;
    const page = await doc.getPage(pageNum);
    if (seq !== _previewPdfSeq) return;
    await _renderPdfPageToCanvas(page, canvas, 1470);
  } catch (e) {
    console.error('Preview PDF render failed', e);
  }
}

// Met à jour les items d'une liste : marque comme live celui qui matche et
// démarque les autres, puis fait défiler la sélection à vue. Le scroll est
// effectué après la mise à jour complète de la sélection (et en douceur) pour
// éviter que l'ancien verset reste visible pendant le défilement.
function syncList(selector, matchFn) {
  let target = null;
  document.querySelectorAll(selector).forEach(el => {
    const live = matchFn(el);
    setLive(el, live);
    if (live) target = el;
  });
  if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function syncActiveItems(s) {
  if (!s) return;
  if (s.type === 'blank') {
    document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.strophe-action').forEach(el => { el.innerHTML = ''; });
  } else if (s.type === 'song') {
    syncList('#verseList .strophe-item', el => parseInt(el.dataset.verse) === s.verse);
  } else if (s.type === 'bible') {
    syncList('#bibleVerseList .bible-verse-item', el => parseInt(el.dataset.verse) === s.verse);
  } else if (s.type === 'pdf') {
    syncList('#pdfPageList .pdf-page-item', el => parseInt(el.dataset.page) === s.page);
  } else if (s.type === 'image') {
    syncList('#imagePreview .strophe-item', el => el.dataset.imagePreview === s.filename);
  }
}

// ─── NAVIGATION CLAVIER DANS LES LISTES ──────────────────────────────────────

function searchListEl() {
  return ({
    cantiques: document.getElementById('songList'),
    bible:     document.getElementById('bibleList'),
    pdf:       document.getElementById('pdfList'),
    images:    document.getElementById('imageList'),
  })[state.activeTab] || null;
}

function searchItems() {
  const list = searchListEl();
  if (!list) return [];
  return Array.from(list.querySelectorAll('.content-item[data-action], .content-item[data-bible-ref]'));
}

function updateSearchCursor() {
  const items = searchItems();
  items.forEach((el, i) => el.classList.toggle('cursor', i === state.searchCursor));
  const el = items[state.searchCursor];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function moveSearchCursor(delta) {
  const items = searchItems();
  if (!items.length) return;
  state.searchCursor = Math.max(0, Math.min(items.length - 1, state.searchCursor + delta));
  updateSearchCursor();
}

function activateSearchCursor() {
  const items = searchItems();
  const el = items[state.searchCursor];
  if (!el) return;
  el.click();
}

['songList', 'bibleList', 'pdfList', 'imageList'].forEach(id => {
  const target = document.getElementById(id);
  if (!target) return;
  new MutationObserver(() => {
    state.searchCursor = 0;
    updateSearchCursor();
  }).observe(target, { childList: true });
  target.addEventListener('click', e => {
    const el = e.target.closest('.content-item[data-action], .content-item[data-bible-ref]');
    if (!el) return;
    const idx = searchItems().indexOf(el);
    if (idx >= 0) { state.searchCursor = idx; updateSearchCursor(); }
  });
});

['songSearchInput', 'bibleSearchInput', 'pdfSearchInput', 'imageSearchInput'].forEach(id => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchCursor(1); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); moveSearchCursor(-1); }
    else if (e.key === 'Enter')     { e.preventDefault(); activateSearchCursor(); input.blur(); }
  });
});

// ─── RACCOURCIS CLAVIER ───────────────────────────────────────────────────────

// Élément navigable de l'onglet actif, ou null si rien n'est sélectionné.
// Indices normalisés en base 0 ; current vaut -1 quand rien n'est projeté.
function navTarget() {
  if (state.activeTab === 'cantiques' && state.song) {
    return { current: state.songVerse, count: state.song.verses.length, project: projectVerse };
  }
  if (state.activeTab === 'bible' && state.bible) {
    return { current: state.bibleVerse, count: state.bible.verses.length, project: projectBibleVerse };
  }
  if (state.activeTab === 'pdf' && state.pdf) {
    // pdfPage est 1-indexé (−1 quand rien n'est projeté) ; on normalise en base 0.
    return { current: state.pdfPage < 1 ? -1 : state.pdfPage - 1, count: state.pdf.page_count, project: i => projectPdfPage(i + 1) };
  }
  if (state.activeTab === 'images' && state.image) {
    const projected = state.projection && state.projection.type === 'image'
      && state.projection.filename === state.image.filename;
    return { current: projected ? 0 : -1, count: 1, project: projectImage };
  }
  return null;
}

// Avance (step +1) ou recule (step -1) dans l'élément de l'onglet actif.
// Si rien n'est sélectionné, navigue dans la liste de résultats à la place.
// fromStart : si rien n'est encore projeté (current === -1), viser le premier
// élément au lieu de current + step (utilisé par Entrée).
function navMove(step, fromStart) {
  const t = navTarget();
  if (!t) {
    if (step > 0 && fromStart) activateSearchCursor();
    else moveSearchCursor(step);
    return;
  }
  const target = (fromStart && t.current === -1) ? 0 : t.current + step;
  if (target >= 0 && target < t.count) t.project(target);
}

function activateTab(tab) {
  if (tab === 'pdf' && state.activeTab === 'pdf' && state.pdf) {
    state.pdf = null;
    state.pdfPage = -1;
    document.getElementById('pdfHeader').style.display = 'none';
    document.getElementById('pdfPageList').innerHTML = '';
    document.querySelectorAll('#pdfList .content-item.active').forEach(el => el.classList.remove('active'));
  }
  if (tab === 'images' && state.activeTab === 'images' && state.image) {
    state.image = null;
    document.getElementById('imageHeader').style.display = 'none';
    document.getElementById('imagePreview').innerHTML = '';
    document.querySelectorAll('#imageList .content-item.active').forEach(el => el.classList.remove('active'));
  }
  switchSideTab(tab);
  const searchInput = tabSearchInput(tab);
  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }
}

// Champ de recherche associé à un onglet (null si l'onglet n'en a pas).
function tabSearchInput(tab) {
  return ({
    cantiques: document.getElementById('songSearchInput'),
    bible:     document.getElementById('bibleSearchInput'),
    pdf:       document.getElementById('pdfSearchInput'),
    images:    document.getElementById('imageSearchInput'),
  })[tab] || null;
}

// Tab / Maj+Tab fait défiler les onglets dans l'ordre visuel, y compris depuis un
// champ de saisie. C'est intercepté globalement (la navigation Tab entre champs
// est donc neutralisée dans la fenêtre opérateur, qui se pilote au clavier via
// les champs de recherche et les flèches).
const TAB_ORDER = ['cantiques', 'bible', 'pdf', 'images'];

document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  const i = TAB_ORDER.indexOf(state.activeTab);
  const next = (i + (e.shiftKey ? -1 : 1) + TAB_ORDER.length) % TAB_ORDER.length;
  activateTab(TAB_ORDER[next]);
}, true);

// Cmd/Ctrl+P ouvre la fenêtre de projection et réaffiche le dernier contenu si
// elle était masquée. Cmd/Ctrl+M la masque. Cmd/Ctrl+F place le focus dans le
// champ de recherche de l'onglet courant (équivalent de « / »). Ces raccourcis
// fonctionnent aussi depuis un champ de recherche (capture).
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'p' && key !== 'm' && key !== 'f') return;
  if (key === 'f') {
    const input = tabSearchInput(state.activeTab);
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }
  e.preventDefault();
  if (key === 'p') restoreAndOpenProjection();
  else hideProjection();
}, true);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === '/') {
    const input = tabSearchInput(state.activeTab);
    if (input) {
      e.preventDefault();
      input.focus();
      input.select();
    }
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    navMove(1, false);
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    navMove(-1, false);
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    navMove(1, true);
    return;
  }

});

// ─── ÉDITION DE STROPHES ─────────────────────────────────────────────────────

// Types de section canoniques (stockés tels quels dans les recueils). Le choix
// est international et indépendant de la langue : l'affichage est traduit, mais
// la donnée ne l'est pas.
const VERSE_TYPES = ['verse', 'chorus', 'bridge', 'intro', 'outro', 'prechorus'];

// Alias acceptés en saisie -> type canonique. Insensible à la casse. Couvre les
// lettres courtes (FR + EN) et les mots entiers, sans collision : `C` est
// réservé à Chorus (jamais Couplet), le couplet/strophe s'écrit `S`, `V`,
// « strophe », « couplet » ou « verse ».
const VERSE_TYPE_ALIASES = {
  v: 'verse', s: 'verse', verse: 'verse', strophe: 'verse', couplet: 'verse',
  c: 'chorus', r: 'chorus', chorus: 'chorus', refrain: 'chorus',
  b: 'bridge', p: 'bridge', bridge: 'bridge', pont: 'bridge',
  i: 'intro', intro: 'intro', introduction: 'intro',
  o: 'outro', outro: 'outro', final: 'outro', coda: 'outro',
  pc: 'prechorus', prechorus: 'prechorus', 'pre-chorus': 'prechorus',
  'pré-refrain': 'prechorus', 'pre-refrain': 'prechorus',
  'pré-r': 'prechorus', 'pre-r': 'prechorus',
};

// Normalise un type canonique : retombe sur `verse` pour toute valeur inconnue.
function canonVerseType(type) {
  return VERSE_TYPES.includes(type) ? type : 'verse';
}

// Libellé court traduit (badge dans la liste et la projection). Tiré d'une clé
// i18n dédiée par type, pour éviter les collisions d'initiales (ex. en français
// « Pont » et « Pré-refrain » commencent tous deux par P). Pour `verse`, on
// suffixe le numéro.
function verseShortLabel(type, number) {
  const canon = canonVerseType(type);
  const head = t('verse.short.' + canon);
  return canon === 'verse' && number != null ? head + number : head;
}

function versesToText(verses) {
  return verses.map(v => {
    return verseShortLabel(v.type, v.number) + '\n' + v.text;
  }).join('\n\n');
}

function textToVerses(text) {
  const blocks = text.trim().split(/\n{2,}/);
  // En-tête de bloc : un mot (lettres/accents/tiret) suivi d'un numéro
  // optionnel, ex. « Refrain », « Strophe 2 », « V1 », « PC ».
  const labelRe = /^([\p{L}-]+)\s*(\d*)$/u;
  const verses = [];
  let sNum = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length) continue;
    let type = 'verse', number = null, bodyLines = lines;
    const m = lines[0].trim().match(labelRe);
    const alias = m ? VERSE_TYPE_ALIASES[m[1].toLowerCase()] : undefined;
    if (alias) {
      type = alias;
      number = m[2] ? parseInt(m[2], 10) : null;
      bodyLines = lines.slice(1);
    }
    if (type === 'verse' && number === null) {
      sNum++;
      number = sNum;
    }
    const txt = bodyLines.join('\n').trim();
    if (!txt) continue;
    verses.push({ type, number, text: txt });
  }
  return verses;
}

function enterEditMode() {
  if (!state.song) return;
  if (document.getElementById('songEditArea')) return;

  const verseList = document.getElementById('verseList');
  verseList.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.id = 'songEditArea';
  wrap.innerHTML = `<textarea id="songEditTextarea" spellcheck="true">${esc(versesToText(state.song.verses))}</textarea>`;
  verseList.parentNode.insertBefore(wrap, verseList);
  document.getElementById('songEditTextarea').focus();

  document.getElementById('btnEditSong').style.display   = 'none';
  document.getElementById('btnCancelSong').style.display = '';
  document.getElementById('btnSaveSong').style.display   = '';
}

function exitEditMode() {
  const editArea = document.getElementById('songEditArea');
  if (editArea) editArea.remove();
  const btnEdit   = document.getElementById('btnEditSong');
  const btnCancel = document.getElementById('btnCancelSong');
  const btnSave   = document.getElementById('btnSaveSong');
  if (btnEdit)   btnEdit.style.display   = '';
  if (btnCancel) btnCancel.style.display = 'none';
  if (btnSave)   { btnSave.style.display = 'none'; btnSave.disabled = false; }
  if (state.song) renderVerseList();
}

async function saveSong() {
  const textarea = document.getElementById('songEditTextarea');
  if (!textarea) return;
  const verses = textToVerses(textarea.value);
  if (!verses.length) { alert(t('song.minOneVerse')); return; }

  const btn = document.getElementById('btnSaveSong');
  if (btn) btn.disabled = true;

  try {
    const id = state.songId;
    await apiUpdateSong(id, verses);
    state.song = null;
    // Invalide le cache liste (verse_count peut changer).
    songCache = null;
    await loadSongCache();
    await loadSong(id);
    // Publication automatique différée vers le dépôt partagé (no-op si le poste
    // n'est pas configuré pour la synchronisation). Non bloquant pour l'UI.
    _scheduleSyncPush();
  } catch (e) {
    alert(t('common.error', { err: String(e) }));
    if (btn) btn.disabled = false;
  }
}

// ─── PROJECTION : MULTI-ÉCRAN (Tauri) ────────────────────────────────────────

const PROJ_SCREEN_KEY = 'verso.projectionMonitor'; // {x,y,width,height,name}

// Verrou anti-réentrance : empêche les ouvertures concurrentes (double-clic,
// clic pendant la modale de choix d'écran) qui pourraient empiler des fenêtres.
let _openingProjection = false;

function _savedScreen() {
  try { return JSON.parse(localStorage.getItem(PROJ_SCREEN_KEY) || 'null'); }
  catch (_) { return null; }
}

function _saveScreen(m) {
  localStorage.setItem(PROJ_SCREEN_KEY, JSON.stringify(m));
  _updateMonitorScreen(m);
}

// Libellé d'un écran, identique dans le sélecteur et dans le retour projection.
// `index` (optionnel) sert au fallback « Écran N » quand l'OS ne fournit pas de nom.
function _screenLabel(m, index) {
  if (m.name) return m.name;
  // Dalle intégrée (laptop) : l'OS ne fournit pas de nom de modèle.
  if (m.is_internal) return t('screen.builtin');
  if (index != null) return t('screen.numbered', { n: index + 1 });
  return (!m.x && !m.y) ? t('screen.main') : t('screen.numbered', { n: `${m.width}×${m.height}` });
}

function _updateMonitorScreen(m) {
  const select = document.getElementById('screenSelect');
  if (!select) return;
  if (_screenSelectMonitors.length) {
    _renderScreenSelect(_screenSelectMonitors);
    return;
  }

  const option = document.createElement('option');
  option.value = '';
  option.textContent = m ? (m.label || _screenLabel(m)) : t('screen.none');
  select.replaceChildren(option);
}

let _screenSelectMonitors = [];

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

async function _refreshScreenSelect() {
  try {
    const monitors = await apiListMonitors();
    _renderScreenSelect(monitors);
  } catch (_) {
    _screenSelectMonitors = [];
    _updateMonitorScreen(_savedScreen());
  }
}

function selectProjectionScreen(index) {
  const i = Number(index);
  const monitor = _screenSelectMonitors[i];
  if (!monitor) return;
  _saveScreen({ ...monitor, label: _screenLabel(monitor, i) });
}

document.getElementById('screenSelect')?.addEventListener('change', e => {
  selectProjectionScreen(e.currentTarget.value);
});

async function openProjection() {
  if (_openingProjection) return;
  _openingProjection = true;
  try {
    let monitors;
    try { monitors = await apiListMonitors(); }
    catch (e) { alert(t('screen.listFailed', { err: String(e) })); return; }

    if (!monitors.length) { alert(t('screen.noneDetected')); return; }

    let target = _savedScreen();
    if (target) {
      const match = monitors.find(m => m.x === target.x && m.y === target.y && m.width === target.width && m.height === target.height);
      if (!match) target = null;
    }
    if (!target) {
      const nonPrimary = monitors.find(m => !m.is_primary);
      target = nonPrimary || (monitors.length > 1 ? await _askScreenChoice(monitors) : monitors[0]);
      if (!target) return;
      // Si le choix vient du sélecteur, target.label est déjà posé ; sinon on le
      // calcule avec l'index dans la liste pour rester cohérent avec la modale.
      if (!target.label) target = { ...target, label: _screenLabel(target, monitors.indexOf(target)) };
      _saveScreen(target);
    }

    // Toujours en plein écran sur l'écran cible (s'adapte à sa résolution).
    await apiOpenProjection(target.x, target.y, target.width, target.height);
  } finally {
    _openingProjection = false;
  }
}

async function restoreAndOpenProjection() {
  if (state.projection?.type === 'blank' && lastActiveProjection) {
    await project(lastActiveProjection);
  }
  await openProjection();
}

function _askScreenChoice(monitors) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'screen-modal-overlay';
    const box = document.createElement('div');
    box.className = 'screen-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'screenModalTitle');
    box.innerHTML = `<h3 class="screen-modal__title" id="screenModalTitle">${esc(t('screen.pickTitle'))}</h3>
      <div id="screenChoices" class="screen-modal__list"></div>
      <div class="screen-modal__footer"><button id="screenCancel" class="hdr-btn">${esc(t('common.cancel'))}</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let settled = false;
    const finish = choice => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(choice);
    };
    const onKeyDown = e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(null);
    });

    const list = box.querySelector('#screenChoices');
    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'screen-modal__item';
      const label = _screenLabel(m, i);
      const primary = m.is_primary ? t('screen.primary') : '';
      btn.innerHTML = `<strong>${esc(label)}${esc(primary)}</strong><span class="screen-modal__item-meta">${m.width}×${m.height} — ${esc(t('screen.position'))} ${m.x},${m.y}</span>`;
      // Mémorise le libellé exact pour le retour projection (_updateMonitorScreen).
      btn.onclick = () => finish({ ...m, label });
      list.appendChild(btn);
    });
    box.querySelector('#screenCancel').onclick = () => finish(null);
  });
}

// ─── INIT ────────────────────────────────────────────────────────────────────

loadPdfList();
loadImageList();

// Relit le dossier de l'onglet actif au retour sur la fenêtre (l'utilisateur
// a pu y déposer un fichier depuis le Finder).
window.addEventListener('focus', () => {
  if (state.activeTab === 'pdf') loadPdfList();
  else if (state.activeTab === 'images') loadImageList();
});

(async function _initProjectionUI() {
  const saved = _savedScreen();
  // Affiche d'abord la valeur stockée (instantané), puis la réconcilie avec la
  // liste live : un écran sauvegardé par une ancienne version peut contenir un
  // nom obsolète ("Monitor #<N>") que le back-end sait désormais résoudre en nom
  // lisible. On rejoue le même match par géométrie que openProjection().
  _updateMonitorScreen(saved);
  if (!saved) return;
  try {
    const monitors = await apiListMonitors();
    const live = monitors.find(m =>
      m.x === saved.x && m.y === saved.y && m.width === saved.width && m.height === saved.height);
    if (live && live.name && live.name !== saved.name) {
      const refreshed = { ...saved, name: live.name, label: live.name };
      _saveScreen(refreshed);
    }
  } catch (_) {}
})();

// Place le curseur dans le champ de recherche des chants au lancement.
(function _focusSongSearch() {
  document.getElementById('songSearchInput').focus();
})();

// Reprend le dernier état projeté pour refléter l'UI au lancement.
(async function _restoreProjection() {
  try {
    const s = await apiGetProjectionState();
    if (s && s.type) {
      applyProjectionState(s);
    }
  } catch (_) {}
})();

// Les fenêtres utilitaires notifient l'opérateur après une mutation de contenu.
// Seul le cache concerné est invalidé ou relu.
function _reloadMainAfterContent(kind) {
  if (kind === 'songbooks') {
    songCache = null;
    songCachePromise = null;
    loadSongCache().catch(() => {});
  } else if (kind === 'bibles') {
    initBibleTranslations();
  } else if (kind === 'pdf') {
    loadPdfList();
  } else if (kind === 'images') {
    loadImageList();
  }
}

function _retranslateDynamic() {
  if (state.song) renderVerseList();
  if (state.bible?.verses?.length) renderBibleTranslations();
  _updateMonitorScreen(_savedScreen());
}

// ─── SYNCHRONISATION DES RECUEILS (superutilisateurs) ──────────────────────────
// Synchronisation automatique, sans bouton : sur les postes configurés
// (sync.json présent), on récupère les recueils au lancement et on publie en
// arrière-plan, de façon différée et regroupée, après chaque sauvegarde de
// chant. Stratégie « dernier qui écrit gagne ». Les échecs (réseau, git absent,
// auth) sont silencieux : seul un point d'état discret dans la barre d'outils
// les signale, l'app restant pleinement utilisable en local.

let _syncEnabled = false;        // résolu une fois au démarrage via apiSyncStatus
let _syncPushTimer = null;
const SYNC_PUSH_DEBOUNCE_MS = 3000;
const SYNC_PULL_START_DELAY_MS = 2000;

// Met à jour l'indicateur textuel discret (ok | error). On n'affiche jamais
// d'état transitoire (la synchro est trop brève pour être lue). Masqué tant
// que le poste n'est pas un superutilisateur configuré. L'état « ok » s'efface
// tout seul après quelques secondes pour garder le pied propre ; « error » reste
// affiché jusqu'à la prochaine tentative.
let _syncOkHideTimer = null;
function _setSyncIndicator(state) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  clearTimeout(_syncOkHideTimer);
  el.hidden = !_syncEnabled || !state;
  el.className = 'sync-status' + (state ? ' ' + state : '');
  el.textContent = state ? t('sync.' + state) : '';
  if (state === 'ok') {
    _syncOkHideTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }
}

// Publication différée : regroupe les sauvegardes rapprochées en un seul push.
function _scheduleSyncPush() {
  if (!_syncEnabled) return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(_runSyncPush, SYNC_PUSH_DEBOUNCE_MS);
}

// N'annonce que ce qui a réellement été publié : une sauvegarde qui ramène le
// chant à son contenu distant ne produit aucun commit, et l'indicateur resterait
// alors un bruit sans information.
async function _runSyncPush() {
  try {
    const { changed } = await apiSyncPush();
    if (changed) _setSyncIndicator('ok');
  } catch (_) {
    _setSyncIndicator('error'); // silencieux, pas de pop-up
  }
}

// Après un pull qui a modifié les recueils, les identifiants de session sont
// recalculés côté Rust : celui du chant chargé est périmé et désignerait un
// autre chant (sélection marquée au mauvais endroit, sauvegarde écrasant le
// mauvais fichier). Le retrouve par son recueil et son numéro, à défaut par son
// titre. Si le chant a disparu du dépôt, on n'a plus d'id valide : `null` évite
// d'agir sur un homonyme, la sauvegarde échouera visiblement.
function _reresolveLoadedSongId() {
  if (!state.song || !songCache) return;
  const code = state.song.songbook_code || '';
  const num = state.song.source_number;
  const match = songCache.find(s =>
    (s.songbook_code || '') === code &&
    (num != null ? s.source_number === num : s.title === state.song.title)
  );
  state.songId = match ? match.id : null;
}

// Récupération au lancement : le distant gagne toujours. En arrière-plan, sans
// bloquer le préchargement local ; au succès on rafraîchit la liste des chants.
// Le rechargement n'a lieu que si le distant a réellement apporté quelque chose :
// dans le cas courant (rien de neuf), reconstruire la liste ne ferait que
// détruire la sélection en cours pendant que l'utilisateur travaille.
async function _runSyncPullOnLaunch() {
  try {
    const { changed } = await apiSyncPull();
    if (!changed) return;
    songCache = null;
    songCachePromise = null;
    await loadSongCache();
    // Le pull peut réordonner ou remplacer les recueils. Leurs identifiants
    // de session sont alors recalculés côté Rust : une liste déjà affichée
    // conserverait sinon des data-song-id périmés et un clic aboutirait à un
    // panneau vide. Reconstruit immédiatement les résultats visibles.
    _reresolveLoadedSongId();
    const input = document.getElementById('songSearchInput');
    const q = input?.value.trim() || '';
    if (q) searchSongs(q);
    else document.getElementById('songList').innerHTML = searchPrompt('search.songsEmpty');
    _setSyncIndicator('ok');
  } catch (_) {
    _setSyncIndicator('error'); // silencieux
  }
}

// Laisse l'interface et ses fenêtres auxiliaires finir leur initialisation,
// puis lance le pull lorsque la WebView est au repos. Le timeout de
// requestIdleCallback garantit que la synchronisation démarre même si le poste
// reste continuellement occupé.
function _scheduleSyncPullOnLaunch() {
  setTimeout(() => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => _runSyncPullOnLaunch(), { timeout: 2000 });
    } else {
      _runSyncPullOnLaunch();
    }
  }, SYNC_PULL_START_DELAY_MS);
}

(async function _initSync() {
  try {
    _syncEnabled = await apiSyncStatus();
  } catch (_) {
    _syncEnabled = false;
  }
  if (!_syncEnabled) return;
  _scheduleSyncPullOnLaunch();
})();

// ─── DELEGATION DES CLICS (remplace les onclick inline bloqués par la CSP) ─────
// En build de production, Tauri injecte un nonce dans la CSP script-src, ce qui
// fait ignorer 'unsafe-inline' et désactive les gestionnaires inline (onclick).
// On relie donc les boutons via data-action / data-arg.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const fn = window[action];
  if (typeof fn !== 'function') return;
  const d = el.dataset;

  switch (action) {
    // Cette fonction attend l'élément cliqué en premier argument.
    case 'selectBibleCode':
      fn(el, d.arg);
      return;
    case 'projectVerse':
    case 'projectBibleVerse':
      fn(Number(d.verse));
      return;
    case 'projectPdfPage':
      fn(Number(d.page));
      return;
    case 'selectPdf':
      fn(d.pdfFile);
      return;
    case 'selectImage':
      fn(d.imageFile);
      return;
    default:
      // loadSong (data-song-id), boutons d'en-tête (data-arg) ou sans argument.
      if (d.songId !== undefined) fn(Number(d.songId));
      else if (d.arg !== undefined) fn(d.arg);
      else fn();
  }
});

// Prépare les trois petites fenêtres une par une, lorsque le navigateur est au
// repos. Le lancement de l'opérateur reste prioritaire et chaque ouverture de
// menu devient ensuite un simple affichage de fenêtre déjà chargée.
function _scheduleAuxiliaryWarmup(modes, index = 0) {
  if (index >= modes.length) return;
  const warm = async () => {
    try { await apiWarmAuxiliaryWindow(modes[index]); } catch (_) {}
    setTimeout(() => _scheduleAuxiliaryWarmup(modes, index + 1), 200);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2000 });
  else setTimeout(warm, 250);
}

// La vérification ne dépend pas de l'événement `load` : celui-ci attend toutes
// les ressources de la page et peut retarder indéfiniment l'indicateur. Le DOM
// utile est déjà prêt puisque ce script est chargé à la fin de <body>.
checkUpdateOnStartup();

window.addEventListener('load', () => {
  setTimeout(() => _scheduleAuxiliaryWarmup(['settings', 'shortcuts', 'about']), 500);
}, { once: true });
