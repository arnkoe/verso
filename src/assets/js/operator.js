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
  songVerse: -1,
  bible: null,
  bibleVerse: -1,
  pdf: null,
  pdfPage: -1,
  image: null,
  projection: null,
  projectionMode: 'textes',
  translation: null,
  searchCursor: 0,
};

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

// Pastille « En projection » affichée sur l'item live d'une liste.
// Construite à la volée car le libellé dépend de la langue active.
function livePill() {
  return `<span class="live-pill"><span class="dot"></span><span class="live-pill-text">${esc(t('list.live'))}</span></span>`;
}

// Marque/démarque un item de liste comme étant en projection (classe + pastille).
function setLive(el, isLive) {
  el.classList.toggle('active', isLive);
  const action = el.querySelector('.strophe-action');
  if (action) action.innerHTML = isLive ? livePill() : '';
}

// ─── PROJECTION API ──────────────────────────────────────────────────────────

async function project(payload) {
  state.projection = payload;
  updatePreview(payload);
  syncActiveItems(payload);
  // Persiste + émet vers la fenêtre projection (remplace BroadcastChannel).
  await apiSetProjectionState(payload);
}

// ─── TABS ───────────────────────────────────────────────────────────────────

function switchSideTab(tab) {
  state.activeTab = tab;
  ['cantiques', 'bible', 'pdf', 'images'].forEach(t => {
    document.getElementById('tab' + t[0].toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
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

  state.searchCursor = 0;
  updateSearchCursor();
}

function showPanel(id) {
  ['panelCantique', 'panelBible', 'panelPdf', 'panelImages', 'panelHelp', 'panelAbout', 'panelSettings'].forEach(p => {
    document.getElementById(p).classList.toggle('active', p === id);
  });
}

function markContentLoaded() {
  document.querySelector('.main').dataset.loaded = 'true';
}

// ─── CANTIQUES ───────────────────────────────────────────────────────────────

let songCache = null;
let songBookFilter = '';

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
      .then(([s]) => { songCache = s; buildSongBookButtons(s); return s; })
      .catch(err => { songCachePromise = null; throw err; });
  }
  return songCachePromise;
}

// Ajoute un bouton de filtre par recueil distinct présent dans les chants
// (le bouton « Tous » fixe reste en tête).
function buildSongBookButtons(songs) {
  const wrap = document.getElementById('songBookFilter');
  // Le filtre se fait sur le code (source_book) ; le bouton affiche le code,
  // le nom lisible résolu via `songbookNames` servant d'infobulle.
  const books = [...new Set(songs.map(s => s.source_book).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  wrap.querySelectorAll('.translation-btn[data-arg]:not([data-arg=""])').forEach(b => b.remove());
  for (const book of books) {
    const btn = document.createElement('button');
    btn.className = 'translation-btn';
    btn.dataset.action = 'selectSongBook';
    btn.dataset.arg = book;
    btn.textContent = book;
    btn.title = songbookName(book);
    wrap.appendChild(btn);
  }
  // S'assure que le filtre courant (« Tous » par défaut) reste visuellement sélectionné.
  wrap.querySelectorAll('.translation-btn').forEach(b => b.classList.toggle('active', b.dataset.arg === songBookFilter));
}

loadSongCache().catch(() => {}); // préchargement, erreurs gérées à la recherche

function selectSongBook(btn, book) {
  document.querySelectorAll('#songBookFilter .translation-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  songBookFilter = book;
  const q = document.getElementById('songSearchInput').value.trim();
  if (q.length >= 1) searchSongs(q);
}

document.getElementById('songSearchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  if (q.length < 1) {
    document.getElementById('songList').innerHTML = '';
    return;
  }
  if (!songCache) {
    const list = document.getElementById('songList');
    list.innerHTML = `<div class="search-empty">${esc(t('list.loading'))}</div>`;
    try {
      await loadSongCache();
    } catch (err) {
      list.innerHTML = `<div class="search-empty">${esc(t('list.songsError', { err: String(err) }))}</div>`;
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
  if (songBookFilter) hits = hits.filter(s => s.source_book === songBookFilter);
  // Groupé par code de recueil ; le nom lisible est résolu au rendu.
  const grouped = {};
  for (const s of hits) {
    const book = s.source_book || '';
    (grouped[book] = grouped[book] || []).push(s);
  }
  renderSongList(grouped);
}

function renderSongList(grouped) {
  const list = document.getElementById('songList');
  if (!Object.keys(grouped).length) {
    list.innerHTML = `<div class="search-empty">${esc(t('list.noResult'))}</div>`;
    return;
  }
  list.innerHTML = Object.entries(grouped).map(([book, items]) =>
    `<div class="source-group">${esc(book ? songbookName(book) : t('book.other'))}</div>` +
    items.map(s => `
      <div class="content-item" data-song-id="${s.id}" data-action="loadSong">
        <span class="item-number">${s.source_number ?? ''}</span>
        <span class="item-title">${esc(s.title)}</span>
      </div>
    `).join('')
  ).join('');
}

async function loadSong(id) {
  const song = await apiGetSong(id);
  state.song      = song;
  state.songVerse = -1;

  document.querySelectorAll('#songList .content-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.songId) === id);
  });

  document.getElementById('songHeader').style.display = '';
  markContentLoaded();
  // Kicker = nom lisible du recueil (résolu via songbookNames) ; abrév = code.
  const kicker = songbookName(song.source_book).toUpperCase();
  const abbr = song.source_book || '';
  const prefix = song.source_book && song.source_number ? `${abbr} ${song.source_number} – ` : '';
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
    const typeLabel = verse.type === 'R' ? t('verse.refrain') : t('verse.strophe');
    const shortLabel = verse.type === 'R' ? 'R' : 'S' + (verse.number != null ? verse.number : '');
    const label = typeLabel + (verse.number != null ? ' ' + verse.number : '');
    const isLive = i === state.songVerse;
    return `<div class="strophe-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectVerse">
      <div class="strophe-number" data-short="${esc(shortLabel)}">${esc(label)}</div>
      <div class="strophe-text">${esc(verse.text)}</div>
      <div class="strophe-action">
        ${isLive ? livePill() : ''}
      </div>
    </div>`;
  }).join('');
}

function clearProjectionModeButtons() {
  state.projectionMode = null;
  document.getElementById('btnModeRien').classList.remove('active');
}

function projectVerse(i) {
  if (!state.song) return;
  state.songVerse = i;
  clearProjectionModeButtons();
  project({
    type: 'song',
    id: state.song.id,
    verse: i,
    title: state.song.title,
    source_book: state.song.source_book,
    source_number: state.song.source_number,
    verseText: state.song.verses[i].text,
    verseLabels: state.song.verses.map(v => v.type + (v.number != null ? v.number : '')),
  });
}

// ─── BIBLE ───────────────────────────────────────────────────────────────────

const NT_FIRST_BOOK = 'Matthieu';
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

async function loadBibleBooks(translation) {
  if (bibleBooksCache[translation]) return bibleBooksCache[translation];
  const data = await apiBibleBooks(translation);
  bibleBooksCache[translation] = data.books || [];
  return bibleBooksCache[translation];
}

// Map code de traduction → nom lisible (issu des données via `list_bibles`).
const bibleNames = new Map();

function bibleName(code) {
  return (code && bibleNames.get(code)) || code || '';
}

// Construit les boutons de traduction à partir des bibles présentes dans le
// dossier utilisateur. Si aucune bible n'est trouvée, affiche un message.
async function initBibleTranslations() {
  const wrap = document.getElementById('bibleTranslations');
  let translations = [];
  try {
    translations = await apiListBibles();
  } catch (_) { /* dossier indisponible : liste vide */ }

  bibleNames.clear();
  for (const { code, name } of translations) bibleNames.set(code, name);

  if (!translations.length) {
    wrap.innerHTML = `<span class="search-empty">${esc(t('list.noBible'))}</span>`;
    state.translation = null;
    return;
  }

  const codes = translations.map(x => x.code);
  const saved = _savedDefaultBible();
  state.translation = codes.includes(saved) ? saved : codes[0];
  wrap.innerHTML = translations
    .map(({ code, name }) =>
      `<button class="translation-btn${code === state.translation ? ' active' : ''}" data-action="selectTranslation" data-arg="${esc(code)}" title="${esc(name)}">${esc(code)}</button>`)
    .join('');
  loadBibleBooks(state.translation);
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
  const THRESHOLD = 0.2;  // similarité minimale pour accepter une correspondance
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

// Construit la liste HTML des livres groupés par testament. `entry(book)` retourne
// l'objet { ref, title } d'un item (référence pour data-bible-ref + libellé affiché).
function renderBibleBookList(books, candidates, entry) {
  const ntIdx = books.indexOf(NT_FIRST_BOOK);
  let html = '', lastTestament = null;
  for (const b of candidates.slice(0, 20)) {
    const testament = ntIdx >= 0 && books.indexOf(b) >= ntIdx ? 'NOUVEAU TESTAMENT' : 'ANCIEN TESTAMENT';
    if (testament !== lastTestament) {
      html += `<div class="source-group">${testament}</div>`;
      lastTestament = testament;
    }
    const { ref, title } = entry(b);
    html += `<div class="content-item" data-bible-ref='${ref}'><span class="item-title">${esc(title)}</span></div>`;
  }
  return html;
}

document.getElementById('bibleSearchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  const list = document.getElementById('bibleList');
  if (!q) { list.innerHTML = ''; return; }
  if (!state.translation) {
    list.innerHTML = `<div class="search-empty">${esc(t('list.noBibleAvailable'))}</div>`;
    return;
  }

  const books = await loadBibleBooks(state.translation);
  const ref   = resolveRef(q, books);

  if (ref) {
    const candidates = ref.ambiguous ? ref.candidates : [ref.book];
    list.innerHTML = renderBibleBookList(books, candidates, b => ({
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
  if (!matches.length) { list.innerHTML = `<div class="search-empty">${esc(t('list.noBook'))}</div>`; return; }
  list.innerHTML = renderBibleBookList(books, matches, b => ({
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

async function selectTranslation(btn, t) {
  document.querySelectorAll('#bibleTranslations .translation-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.translation = t;
  _saveDefaultBible(t);
  await loadBibleBooks(t);

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
    data = await apiBibleSearch(q, state.translation);
  } catch (err) {
    if (seq !== bibleReqSeq) return;
    reprojectBibleVerse = null;
    document.getElementById('bibleList').innerHTML = `<div class="search-empty">${esc(String(err))}</div>`;
    return;
  }
  if (seq !== bibleReqSeq) return;
  if (!data.verses || !data.verses.length) { reprojectBibleVerse = null; return; }

  state.bible = { verses: data.verses, translation: data.translation };
  state.bibleVerse = -1;

  const first = data.verses[0];
  const last  = data.verses[data.verses.length - 1];
  const title = first.verse === last.verse
    ? `${first.book} ${first.chapter}:${first.verse}`
    : `${first.book} ${first.chapter}:${first.verse}–${last.verse}`;
  // Sous-titre = nom lisible de la traduction (résolu via bibleNames), sinon le code.
  const translationLabel = bibleName(data.translation).toUpperCase();
  document.getElementById('bibleHeader').style.display = '';
  markContentLoaded();
  document.getElementById('bibleTitle').textContent = title;
  document.getElementById('bibleSubtitle').textContent = 'TRADUCTION ' + translationLabel;
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
      if (sim < 0.34) idx = bestVerseMatch(data.verses, num, text);
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
    return `<div class="bible-verse-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectBibleVerse">
      <span class="bible-verse-number" data-short="V${v.verse}">Verset ${v.verse}</span>
      <span class="bible-verse-text">${esc(v.text)}</span>
      <div class="strophe-action">
        ${isLive ? livePill() : ''}
      </div>
    </div>`;
  }).join('');
}

function projectBibleVerse(i) {
  const v = state.bible?.verses[i];
  if (!v) return;
  state.bibleVerse = i;
  clearProjectionModeButtons();
  project({
    type: 'bible',
    verse: i,
    translation: state.translation,
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
  if (!files.length) { list.innerHTML = `<div class="search-empty">${esc(t('pdf.empty'))}</div>`; return; }
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
  markContentLoaded();
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
    <div class="pdf-page-item" data-page="${i+1}" data-action="projectPdfPage">
      <div class="strophe-number" data-short="P${i + 1}">Page ${i + 1}</div>
      <div class="pdf-page-thumb" data-thumb-page="${i+1}">
        <div class="thumb-loading">…</div>
      </div>
      <div class="strophe-action"></div>
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
        const baseVp = page.getViewport({ scale: 1 });
        const targetW = 240;
        const scale = targetW / baseVp.width;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
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
  clearProjectionModeButtons();

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
  if (!files.length) { list.innerHTML = `<div class="search-empty">${esc(t('images.empty'))}</div>`; return; }
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
  markContentLoaded();
  document.getElementById('imageTitle').textContent = filename;
  showPanel('panelImages');

  const isLive = state.projection && state.projection.type === 'image' && state.projection.filename === filename;
  const url = await mediaUrl('images', filename);
  const preview = document.getElementById('imagePreview');
  preview.innerHTML = `
    <div class="strophe-item image-page-item${isLive ? ' active' : ''}" data-image-preview="${esc(filename)}" data-action="projectImage">
      <div class="strophe-number">Image</div>
      <img src="${esc(url)}" style="max-width:100%;max-height:400px;object-fit:contain;display:block;">
      <div class="strophe-action">${isLive ? livePill() : ''}</div>
    </div>
  `;
}

function projectImage() {
  if (!state.image) return;
  clearProjectionModeButtons();

  document.querySelectorAll('#imagePreview .strophe-item').forEach(el => {
    setLive(el, el.dataset.imagePreview === state.image.filename);
  });

  project({ type: 'image', filename: state.image.filename });
}

// ─── BOUTON NOIR ─────────────────────────────────────────────────────────────

function setProjectionMode(mode) {
  state.projectionMode = mode;
  document.getElementById('btnModeRien').classList.toggle('active', mode === 'rien');
  if (mode === 'rien') {
    project({ type: 'blank' });
  }
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
  const scale = mon.clientHeight / h;
  const offsetX = (mon.clientWidth - w * scale) / 2;
  stage.style.transform = `translateX(${offsetX}px) scale(${scale})`;
}

window.addEventListener('resize', scalePreview);
scalePreview();

const _previewPdfCache = new Map();
let _previewPdfSeq = 0;
async function renderPreviewPdf(canvas, filename, pageNum) {
  const seq = ++_previewPdfSeq;
  if (!window.pdfjsLib) return;
  try {
    let doc = _previewPdfCache.get(filename);
    if (!doc) {
      const url = await mediaUrl('pdf', filename);
      doc = await pdfjsLib.getDocument({ url }).promise;
      _cachePdfDoc(_previewPdfCache, filename, doc);
    }
    if (seq !== _previewPdfSeq) return;
    const page = await doc.getPage(pageNum);
    if (seq !== _previewPdfSeq) return;
    const base = page.getViewport({ scale: 1 });
    const scale = 1470 / base.width;
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (e) {
    console.error('Preview PDF render failed', e);
  }
}

// Met à jour les items d'une liste : marque comme live celui qui matche, le fait
// défiler à vue, et démarque les autres.
function syncList(selector, matchFn) {
  document.querySelectorAll(selector).forEach(el => {
    const live = matchFn(el);
    setLive(el, live);
    if (live) el.scrollIntoView({ block: 'nearest' });
  });
}

function syncActiveItems(s) {
  if (!s) return;
  if (s.type === 'blank') {
    document.querySelectorAll('.strophe-item, .bible-verse-item, .pdf-page-item').forEach(el => el.classList.remove('active'));
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
  state.projectionMode = s.type === 'blank' ? 'rien' : null;
  document.getElementById('btnModeRien').classList.toggle('active', state.projectionMode === 'rien');
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
    if (state.activeTab === 'cantiques' && state.song) {
      const next = state.songVerse + 1;
      if (next < state.song.verses.length) projectVerse(next);
    } else if (state.activeTab === 'bible' && state.bible) {
      const next = state.bibleVerse + 1;
      if (next < state.bible.verses.length) projectBibleVerse(next);
    } else if (state.activeTab === 'pdf' && state.pdf) {
      const next = Math.max(1, state.pdfPage + 1);
      if (next <= state.pdf.page_count) projectPdfPage(next);
    } else if (state.activeTab === 'images' && state.image) {
      if (!state.projection || state.projection.type !== 'image' || state.projection.filename !== state.image.filename) {
        projectImage();
      }
    } else if (state.activeTab === 'pdf' || state.activeTab === 'images') {
      moveSearchCursor(1);
    }
    return;
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    if (state.activeTab === 'cantiques' && state.song) {
      const prev = state.songVerse - 1;
      if (prev >= 0) projectVerse(prev);
    } else if (state.activeTab === 'bible' && state.bible) {
      const prev = state.bibleVerse - 1;
      if (prev >= 0) projectBibleVerse(prev);
    } else if (state.activeTab === 'pdf' && state.pdf) {
      const prev = state.pdfPage - 1;
      if (prev >= 1) projectPdfPage(prev);
    } else if (state.activeTab === 'images' && state.image) {
      // une seule image à la fois
    } else if (state.activeTab === 'pdf' || state.activeTab === 'images') {
      moveSearchCursor(-1);
    }
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.activeTab === 'cantiques' && state.song) {
      const next = state.songVerse === -1 ? 0 : state.songVerse + 1;
      if (next < state.song.verses.length) projectVerse(next);
    } else if (state.activeTab === 'bible' && state.bible) {
      const next = state.bibleVerse === -1 ? 0 : state.bibleVerse + 1;
      if (next < state.bible.verses.length) projectBibleVerse(next);
    } else if (state.activeTab === 'pdf' || state.activeTab === 'images') {
      activateSearchCursor();
    }
    return;
  }

  if (e.key === 'Escape') {
    state.songVerse = -1;
    state.bibleVerse = -1;
    state.pdfPage = -1;
    document.querySelectorAll('.strophe-item, .bible-verse-item').forEach(el => el.classList.remove('active'));
    project({ type: 'blank' });
    return;
  }
});

// ─── ÉDITION DE STROPHES ─────────────────────────────────────────────────────

function versesToText(verses) {
  return verses.map(v => {
    const label = v.type + (v.number != null ? v.number : '');
    return label + '\n' + v.text;
  }).join('\n\n');
}

function textToVerses(text) {
  const blocks = text.trim().split(/\n{2,}/);
  const labelRe = /^([SRPIO])(\d*)$/i;
  const verses = [];
  let sNum = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length) continue;
    let type = 'S', number = null, bodyLines = lines;
    const m = lines[0].trim().match(labelRe);
    if (m) {
      type = m[1].toUpperCase();
      number = m[2] ? parseInt(m[2], 10) : null;
      bodyLines = lines.slice(1);
    }
    if (type === 'S' && number === null) {
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
  btn.disabled = true;

  try {
    await apiUpdateSong(state.song.id, verses);
    const id = state.song.id;
    state.song = null;
    // Invalide le cache liste (verse_count peut changer).
    songCache = null;
    await loadSongCache();
    await loadSong(id);
  } catch (e) {
    alert(t('common.error', { err: String(e) }));
    btn.disabled = false;
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
  if (index != null) return t('screen.numbered', { n: index + 1 });
  return (!m.x && !m.y) ? t('screen.main') : t('screen.numbered', { n: `${m.width}×${m.height}` });
}

function _updateMonitorScreen(m) {
  const el = document.getElementById('monitorScreen');
  const resEl = document.getElementById('monitorRes');
  if (!el) return;
  if (!m) {
    el.textContent = t('screen.none');
    if (resEl) resEl.textContent = '';
    return;
  }
  // Réutilise le libellé exact choisi dans le sélecteur (cf. _screenLabel),
  // pour que le nom affiché ici corresponde à celui de la modale de choix.
  el.textContent = m.label || _screenLabel(m);
  if (resEl) resEl.textContent = `${m.width} × ${m.height}`;
}

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

async function pickProjectionScreen() {
  if (_openingProjection) return;
  _openingProjection = true;
  try {
    let monitors;
    try { monitors = await apiListMonitors(); }
    catch (e) { alert(t('screen.listFailed', { err: String(e) })); return; }
    const choice = await _askScreenChoice(monitors);
    if (!choice) return;
    _saveScreen(choice);
    await apiOpenProjection(choice.x, choice.y, choice.width, choice.height);
  } finally {
    _openingProjection = false;
  }
}

function _askScreenChoice(monitors) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const box = document.createElement('div');
    box.className = 'screen-modal';
    box.innerHTML = `<h3 class="screen-modal__title">${esc(t('screen.pickTitle'))}</h3>
      <div id="screenChoices" class="screen-modal__list"></div>
      <div class="screen-modal__footer"><button id="screenCancel" class="hdr-btn">${esc(t('common.cancel'))}</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const list = box.querySelector('#screenChoices');
    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'screen-modal__item';
      const label = _screenLabel(m, i);
      const primary = m.is_primary ? t('screen.primary') : '';
      btn.innerHTML = `<strong>${esc(label)}${esc(primary)}</strong><span class="screen-modal__item-meta">${m.width}×${m.height} — ${esc(t('screen.position'))} ${m.x},${m.y}</span>`;
      // Mémorise le libellé exact pour le retour projection (_updateMonitorScreen).
      btn.onclick = () => { document.body.removeChild(overlay); resolve({ ...m, label }); };
      list.appendChild(btn);
    });
    box.querySelector('#screenCancel').onclick = () => { document.body.removeChild(overlay); resolve(null); };
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
  document.getElementById('btnPickScreen').style.display = '';
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
      state.projection = s;
      updatePreview(s);
      syncActiveItems(s);
    }
  } catch (_) {}
})();

// ─── OUTILS : DOSSIER, AIDE, À PROPOS ──────────────────────────────────────────

/** Ouvre le dossier Verso (racine des données) dans le gestionnaire de fichiers. */
async function openVersoDir() {
  try { await apiRevealVersoDir(); } catch (_) {}
}

/** Affiche le panneau d'aide (raccourcis) au centre de la zone principale. */
function showHelp() {
  markContentLoaded();
  showPanel('panelHelp');
}

/** Affiche le panneau « À propos » au centre de la zone principale. */
function showAbout() {
  markContentLoaded();
  showPanel('panelAbout');
}

// ─── VERSION & MISE À JOUR ─────────────────────────────────────────────────────
// Vérification silencieuse au lancement. Si une mise à jour existe : un point
// rouge sur le bouton « À propos », et un lien cliquable dans le panneau À propos
// pour l'installer et relancer. En cas d'échec réseau, rien ne change.

// ─── PARAMÈTRES (modale) ────────────────────────────────────────────────────────
// Superposition dans la fenêtre opérateur (pas une fenêtre OS séparée) : volet de
// rubriques à gauche, fermeture au clic sur le fond ou avec Échap.

// Affiche le panneau Paramètres dans la zone principale (comme Aide/À propos).
function openSettings() {
  markContentLoaded();
  showPanel('panelSettings');
  _resetUpdateCheck();
  _syncLangToggle();
}

// Aligne le menu déroulant de langue sur la langue courante : libellé du bouton
// et coche de l'option active.
function _syncLangToggle() {
  const cur = currentLang();
  const menu = document.getElementById('langMenu');
  if (!menu) return;
  let label = '';
  menu.querySelectorAll('.dropdown-option').forEach(opt => {
    const active = opt.dataset.arg === cur;
    opt.classList.toggle('selected', active);
    opt.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) label = opt.querySelector('.dropdown-option-label').textContent;
  });
  const value = document.getElementById('langValue');
  if (value && label) value.textContent = label;
}

function _closeLangMenu() {
  const menu = document.getElementById('langMenu');
  const trigger = document.getElementById('langTrigger');
  if (menu) menu.hidden = true;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function toggleLangMenu() {
  const menu = document.getElementById('langMenu');
  const trigger = document.getElementById('langTrigger');
  if (!menu) return;
  const open = menu.hidden;
  menu.hidden = !open;
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Action d'une option de langue : applique, persiste, ferme le menu et
// reconstruit les contenus dynamiques (libellés traduits à la volée).
function setUiLang(lang) {
  _closeLangMenu();
  setLang(lang, () => {
    _syncLangToggle();
    _retranslateDynamic();
  });
}

// Ferme le menu de langue au clic extérieur et avec Échap.
document.addEventListener('click', e => {
  if (!e.target.closest('#langDropdown')) _closeLangMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') _closeLangMenu();
}, true);

// Recompose les contenus générés par JS qui dépendent de la langue : strophes,
// boutons de statut de mise à jour et libellé d'écran. Les listes de recherche
// se reconstruisent à la frappe suivante.
function _retranslateDynamic() {
  if (state.song) renderVerseList();
  _resetUpdateCheck();
  _updateMonitorScreen(_savedScreen());
}

// ─── GESTION DES CONTENUS (modale dédiée par type) ────────────────────────────
// Quatre types : recueils (songbooks), bibles, pdf, images. Le panneau Paramètres
// ouvre, pour chaque type, une modale unique réutilisée (liste + ajout + drop +
// suppression avec confirmation en ligne). Après chaque changement, on recharge
// la liste de la modale ET la liste correspondante de l'interface principale.

const CONTENT_KINDS = ['songbooks', 'bibles', 'pdf', 'images'];

// Extensions proposées par le sélecteur natif, par type.
const CONTENT_FILTERS = {
  songbooks: { name: 'Recueils', extensions: ['json'] },
  bibles:    { name: 'Bibles',   extensions: ['json'] },
  pdf:       { name: 'PDF',      extensions: ['pdf'] },
  images:    { name: 'Images',   extensions: ['jpg', 'jpeg', 'png', 'webp'] },
};

// Clé i18n du titre de la modale selon le type.
const CONTENT_TITLE_KEY = {
  songbooks: 'settings.songbooks',
  bibles:    'settings.bibles',
  pdf:       'settings.pdfs',
  images:    'settings.images',
};

// Type actuellement géré par la modale (null = fermée).
let _contentKind = null;

function _setContentStatus(text, kind) {
  const el = document.getElementById('contentStatus');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'settings-update-status' + (kind ? ' ' + kind : '');
}

// Ouvre la modale de gestion pour un type donné (bouton « Gérer »).
async function manageContent(kind) {
  if (!CONTENT_KINDS.includes(kind)) return;
  _contentKind = kind;
  const modal = document.getElementById('contentModal');
  if (!modal) return;
  document.getElementById('contentModalTitle').textContent = t(CONTENT_TITLE_KEY[kind]);
  _setContentStatus('', '');
  await refreshContentList();
  modal.hidden = false;
}

function closeContentManager() {
  const modal = document.getElementById('contentModal');
  if (modal) modal.hidden = true;
  _contentKind = null;
}

// Recharge la liste affichée dans la modale (type courant).
async function refreshContentList() {
  const ul = document.getElementById('contentModalList');
  if (!ul || !_contentKind) return;
  const kind = _contentKind;
  let items;
  try {
    items = await apiListContent(kind);
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>${esc(t('settings.delete'))}</span>
        </button>
      </span>
    </li>`).join('');
}

// Recharge la liste de l'interface principale impactée par le type courant.
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

// Importe une liste de chemins source pour le type courant.
async function _importPaths(paths) {
  const kind = _contentKind;
  if (!kind || !paths || !paths.length) return;
  let ok = 0;
  let lastErr = '';
  for (const p of paths) {
    try { await apiImportContent(kind, p); ok++; }
    catch (err) { lastErr = String(err); }
  }
  if (ok) {
    await refreshContentList();
    _reloadMainAfterContent(kind);
  }
  if (lastErr && ok < paths.length) {
    _setContentStatus(t('settings.importError', { err: lastErr }), 'error');
  } else if (ok) {
    _setContentStatus(t('settings.imported', { count: String(ok) }), 'ok');
  }
}

// Bouton « Ajouter » de la modale : ouvre le sélecteur de fichiers natif.
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
  const paths = Array.isArray(selected) ? selected : [selected];
  await _importPaths(paths);
}

// Suppression effective d'un contenu (après confirmation en ligne).
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
  _reloadMainAfterContent(kind);
  _setContentStatus('', '');
}

// Affiche la confirmation en ligne sur une entrée. Pour éviter toute suppression
// accidentelle, l'opérateur doit saisir le mot de confirmation au clavier : le
// bouton Supprimer reste désactivé tant que le texte saisi ne correspond pas.
function _askDeleteConfirm(item, filename) {
  if (item.querySelector('.content-mgr-confirm')) return; // déjà en confirmation
  const actions = item.querySelector('.content-mgr-actions');
  if (!actions) return;
  const word = t('settings.deleteConfirmWord');
  actions.innerHTML = `
    <span class="content-mgr-confirm">
      <span class="content-mgr-confirm-btns">
        <button class="hdr-btn content-mgr-cancel" data-confirm="cancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          <span>${esc(t('common.cancel'))}</span>
        </button>
        <button class="hdr-btn content-mgr-confirm-del" data-confirm="delete" data-del-file="${esc(filename)}" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>${esc(t('settings.delete'))}</span>
        </button>
      </span>
      <span class="content-mgr-confirm-hint">${esc(t('settings.deleteConfirmPrompt', { word }))}</span>
      <input type="text" class="content-mgr-confirm-input" data-confirm-word="${esc(word)}"
        placeholder="${esc(word)}"
        autocomplete="off" autocapitalize="characters" spellcheck="false" />
    </span>`;
  actions.querySelector('.content-mgr-confirm-input')?.focus();
}

// Délégation des clics dans la liste : corbeille → confirmation, puis Annuler /
// Supprimer.
// Le mot de confirmation correspond-il (sans tenir compte de la casse ni des
// espaces) au mot attendu ? Conditionne l'activation du bouton Supprimer.
function _confirmMatches(input) {
  if (!input) return false;
  const expected = (input.dataset.confirmWord || '').trim().toLowerCase();
  return input.value.trim().toLowerCase() === expected && expected !== '';
}

const _contentModalList = document.getElementById('contentModalList');

_contentModalList?.addEventListener('click', e => {
  const cancel = e.target.closest('[data-confirm="cancel"]');
  if (cancel) { refreshContentList(); return; }
  const confirm = e.target.closest('[data-confirm="delete"]');
  if (confirm) {
    if (confirm.disabled) return;
    _deleteContent(confirm.dataset.delFile);
    return;
  }
  const del = e.target.closest('.content-mgr-del');
  if (del) {
    _askDeleteConfirm(del.closest('.content-mgr-item'), del.dataset.delFile);
  }
});

// Active le bouton Supprimer dès que le mot saisi correspond.
_contentModalList?.addEventListener('input', e => {
  const input = e.target.closest('.content-mgr-confirm-input');
  if (!input) return;
  const btn = input.closest('.content-mgr-confirm')?.querySelector('[data-confirm="delete"]');
  if (btn) btn.disabled = !_confirmMatches(input);
});

// Entrée valide la suppression si le mot correspond ; Échap annule.
_contentModalList?.addEventListener('keydown', e => {
  const input = e.target.closest('.content-mgr-confirm-input');
  if (!input) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (_confirmMatches(input)) {
      const btn = input.closest('.content-mgr-confirm')?.querySelector('[data-confirm="delete"]');
      if (btn) _deleteContent(btn.dataset.delFile);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    refreshContentList();
  }
});

// Fermeture de la modale de contenu au clic sur le fond et avec Échap.
document.addEventListener('click', e => {
  if (e.target.id === 'contentModal') closeContentManager();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('contentModal');
    if (modal && !modal.hidden) { e.stopPropagation(); closeContentManager(); }
  }
}, true);

// ─── VÉRIFICATION MANUELLE DES MISES À JOUR (depuis la modale) ──────────────────

function _setUpdateStatus(text, kind) {
  const el = document.getElementById('settingsUpdateStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'settings-update-status' + (kind ? ' ' + kind : '');
}

function _resetUpdateCheck() {
  const btn = document.getElementById('btnCheckUpdate');
  if (btn) {
    btn.dataset.action = 'checkUpdate';
    btn.disabled = false;
    btn.querySelector('.settings-btn-label').textContent = t('settings.checkNow');
  }
  _setUpdateStatus('', '');
}

async function checkUpdate() {
  const btn = document.getElementById('btnCheckUpdate');
  if (btn) btn.disabled = true;
  _setUpdateStatus(t('update.checking'));
  try {
    const update = await apiCheckUpdate();
    if (!update) {
      _setUpdateStatus(t('update.upToDate'), 'ok');
      if (btn) btn.disabled = false;
      return;
    }
    _pendingUpdate = update;
    _setUpdateStatus(
      update.version
        ? t('update.availableVersion', { version: update.version })
        : t('update.available'),
      'available'
    );
    if (btn) {
      btn.dataset.action = 'installUpdate';
      btn.disabled = false;
      btn.querySelector('.settings-btn-label').textContent = t('settings.installRestart');
    }
  } catch (_) {
    _setUpdateStatus(t('update.checkFailed'), 'error');
    if (btn) btn.disabled = false;
  }
}

let _pendingUpdate = null;

async function installUpdate() {
  if (!_pendingUpdate) return;
  // Deux points d'entrée : le lien du panneau « À propos » et le bouton de la modale.
  const link = document.getElementById('aboutUpdateLink');
  const btn = document.getElementById('btnCheckUpdate');
  if (link) { link.textContent = t('update.installing'); link.disabled = true; }
  if (btn) btn.disabled = true;
  _setUpdateStatus(t('update.installing'));
  try {
    await apiInstallUpdate(_pendingUpdate);
    // relaunch() redémarre l'app ; le code ci-dessous n'est normalement pas atteint.
  } catch (_) {
    if (link) { link.textContent = t('update.installRetry'); link.disabled = false; }
    if (btn) btn.disabled = false;
    _setUpdateStatus(t('update.installFailed'), 'error');
  }
}

(async function _initAbout() {
  document.getElementById('aboutYear').textContent = new Date().getFullYear();
  try {
    const v = await apiAppVersion();
    document.getElementById('aboutVersion').textContent = v;
  } catch (_) {}

  const update = await apiCheckUpdate();
  if (!update) return;
  _pendingUpdate = update;
  document.getElementById('aboutBadge').hidden = false;
  const wrap = document.getElementById('aboutUpdate');
  const link = document.getElementById('aboutUpdateLink');
  if (link) link.textContent = update.version
    ? t('update.updateTo', { version: update.version })
    : t('update.update');
  if (wrap) wrap.hidden = false;
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
    // Ces deux fonctions attendent l'élément cliqué en premier argument.
    case 'selectSongBook':
    case 'selectTranslation':
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
