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
  isNoir: false,
  translation: null,
  searchCursor: 0,
};

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
  ['panelCantique', 'panelBible', 'panelPdf', 'panelImages'].forEach(p => {
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

async function loadSongCache() {
  if (songCache) return songCache;
  // Réutilise la promesse en cours et la réinitialise en cas d'échec
  // pour permettre une nouvelle tentative au prochain appel.
  if (!songCachePromise) {
    songCachePromise = apiListSongs()
      .then(s => { songCache = s; buildSongBookButtons(s); return s; })
      .catch(err => { songCachePromise = null; throw err; });
  }
  return songCachePromise;
}

// Ajoute un bouton de filtre par recueil distinct présent dans les chants
// (le bouton « Tous » fixe reste en tête).
function buildSongBookButtons(songs) {
  const wrap = document.getElementById('songBookFilter');
  const books = [...new Set(songs.map(s => s.source_book).filter(Boolean))].sort();
  wrap.querySelectorAll('.translation-btn[data-arg]:not([data-arg=""])').forEach(b => b.remove());
  for (const book of books) {
    const btn = document.createElement('button');
    btn.className = 'translation-btn';
    btn.dataset.action = 'selectSongBook';
    btn.dataset.arg = book;
    btn.textContent = book;
    wrap.appendChild(btn);
  }
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
    list.innerHTML = '<div class="search-empty">Chargement…</div>';
    try {
      await loadSongCache();
    } catch (err) {
      list.innerHTML = `<div class="search-empty">Erreur de chargement des chants : ${esc(String(err))}</div>`;
      return;
    }
    // L'utilisateur a pu continuer à taper pendant le chargement.
    if (e.target.value.trim() !== q) return;
  }
  searchSongs(q);
});

function searchSongs(q) {
  if (!songCache) return;
  const lower = q.toLowerCase();
  const num   = parseInt(q, 10);
  let hits  = songCache.filter(s =>
    s.title.toLowerCase().includes(lower) ||
    (s.author && s.author.toLowerCase().includes(lower)) ||
    (!isNaN(num) && s.source_number === num)
  );
  if (songBookFilter) hits = hits.filter(s => s.source_book === songBookFilter);
  const grouped = {};
  for (const s of hits) {
    const book = s.source_book ?? 'Autre';
    (grouped[book] = grouped[book] || []).push(s);
  }
  renderSongList(grouped);
}

function renderSongList(grouped) {
  const list = document.getElementById('songList');
  if (!Object.keys(grouped).length) {
    list.innerHTML = '<div class="search-empty">Aucun résultat</div>';
    return;
  }
  list.innerHTML = Object.entries(grouped).map(([book, items]) =>
    `<div class="source-group">${esc(book)}</div>` +
    items.map(s => `
      <div class="content-item" data-song-id="${s.id}" data-action="loadSong">
        <span class="item-number">${s.source_number ?? ''}</span>
        <span class="item-title">${esc(s.title)}</span>
        ${s.author ? `<span class="item-author">${esc(s.author)}</span>` : ''}
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
  const bookNames = { HEC: 'HYMNES ET CANTIQUES', Reflets: 'REFLETS' };
  const kicker = bookNames[song.source_book] || (song.source_book ?? '');
  const bookAbbr = { HEC: 'HEC', Reflets: 'REF' };
  const abbr = bookAbbr[song.source_book] || song.source_book;
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
    const typeLabel = verse.type === 'R' ? 'Refrain' : 'Strophe';
    const shortLabel = verse.type === 'R' ? 'R' : 'S' + (verse.number != null ? verse.number : '');
    const label = typeLabel + (verse.number != null ? ' ' + verse.number : '');
    const isLive = i === state.songVerse;
    return `<div class="strophe-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectVerse">
      <div class="strophe-number" data-short="${esc(shortLabel)}">${esc(label)}</div>
      <div class="strophe-text">${esc(verse.text)}</div>
      <div class="strophe-action">
        ${isLive ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : ''}
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
  state.isNoir = false;
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

// Construit les boutons de traduction à partir des bibles présentes dans le
// dossier utilisateur. Si aucune bible n'est trouvée, affiche un message.
async function initBibleTranslations() {
  const wrap = document.getElementById('bibleTranslations');
  let translations = [];
  try {
    translations = await apiListBibles();
  } catch (_) { /* dossier indisponible : liste vide */ }

  if (!translations.length) {
    wrap.innerHTML = '<span class="search-empty">Aucune bible. Déposez des fichiers JSON dans le dossier Verso.</span>';
    state.translation = null;
    return;
  }

  const saved = _savedDefaultBible();
  state.translation = translations.includes(saved) ? saved : translations[0];
  wrap.innerHTML = translations
    .map(t =>
      `<button class="translation-btn${t === state.translation ? ' active' : ''}" data-action="selectTranslation" data-arg="${esc(t)}">${esc(t)}</button>`)
    .join('');
  loadBibleBooks(state.translation);
}

initBibleTranslations();

function stripAccents(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
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

function resolveRef(q, books) {
  const m = q.match(/^(\d?\s*[A-Za-zÀ-ÿ]+\.?)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$/u);
  if (!m) return null;
  const bookRaw = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const vStart  = m[3] ? parseInt(m[3], 10) : null;
  const vEnd    = m[4] ? parseInt(m[4], 10) : vStart;

  const dm = bookRaw.match(/^(\d)\s*(.+)$/u);
  let candidates;
  if (dm) {
    candidates = findBooks(books, dm[1] + dm[2], true);
    if (!candidates.length) candidates = findBooks(books, dm[2], true);
  } else {
    candidates = findBooks(books, bookRaw, false);
  }
  if (!candidates.length) return null;
  if (candidates.length > 1) return { ambiguous: true, candidates, chapter, vStart, vEnd };
  return { book: candidates[0], chapter, vStart, vEnd };
}

let bibleReqSeq = 0;

function bibleRefAttr(book, chapter, vStart, vEnd) {
  return esc(JSON.stringify({ book, chapter, vStart, vEnd }));
}

document.getElementById('bibleSearchInput').addEventListener('input', async e => {
  const q = e.target.value.trim();
  const list = document.getElementById('bibleList');
  if (!q) { list.innerHTML = ''; return; }
  if (!state.translation) {
    list.innerHTML = '<div class="search-empty">Aucune bible disponible.</div>';
    return;
  }

  const books = await loadBibleBooks(state.translation);
  const ref   = resolveRef(q, books);

  if (ref) {
    const candidates = ref.ambiguous ? ref.candidates : [ref.book];
    const ntIdx = books.indexOf(NT_FIRST_BOOK);
    let html = '', lastTestament = null;
    for (const b of candidates.slice(0, 20)) {
      const testament = ntIdx >= 0 && books.indexOf(b) >= ntIdx ? 'NOUVEAU TESTAMENT' : 'ANCIEN TESTAMENT';
      if (testament !== lastTestament) {
        html += `<div class="source-group">${testament}</div>`;
        lastTestament = testament;
      }
      html += `<div class="content-item" data-bible-ref='${bibleRefAttr(b, ref.chapter, ref.vStart, ref.vEnd)}'><span class="item-title">${esc(`${b} ${ref.chapter}`)}</span></div>`;
    }
    list.innerHTML = html;
    if (candidates.length === 1) {
      list.querySelector('.content-item').classList.add('active');
      fetchBibleChapter({ book: candidates[0], chapter: ref.chapter, vStart: ref.vStart, vEnd: ref.vEnd });
    }
    return;
  }

  const matches = findBooks(books, q, false).slice(0, 20);
  if (!matches.length) { list.innerHTML = '<div class="search-empty">Aucun livre trouvé</div>'; return; }
  const ntIdx = books.indexOf(NT_FIRST_BOOK);
  let html = '', lastTestament = null;
  for (const b of matches) {
    const testament = ntIdx >= 0 && books.indexOf(b) >= ntIdx ? 'NOUVEAU TESTAMENT' : 'ANCIEN TESTAMENT';
    if (testament !== lastTestament) {
      html += `<div class="source-group">${testament}</div>`;
      lastTestament = testament;
    }
    html += `<div class="content-item" data-bible-ref='${bibleRefAttr(b, 1, null, null)}'><span class="item-title">${esc(b)}</span></div>`;
  }
  list.innerHTML = html;
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
  document.querySelectorAll('.translation-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.translation = t;
  _saveDefaultBible(t);
  await loadBibleBooks(t);
  document.getElementById('bibleSearchInput').dispatchEvent(new Event('input'));
}

async function fetchBibleChapter(ref) {
  const seq = ++bibleReqSeq;
  const q = ref.vStart
    ? `${ref.book} ${ref.chapter}:${ref.vStart}${ref.vEnd !== ref.vStart ? '-' + ref.vEnd : ''}`
    : `${ref.book} ${ref.chapter}`;
  let data;
  try {
    data = await apiBibleSearch(q, state.translation);
  } catch (err) {
    if (seq !== bibleReqSeq) return;
    document.getElementById('bibleList').innerHTML = `<div class="search-empty">${esc(String(err))}</div>`;
    return;
  }
  if (seq !== bibleReqSeq) return;
  if (!data.verses || !data.verses.length) return;

  state.bible = { verses: data.verses, translation: data.translation };
  state.bibleVerse = -1;

  const first = data.verses[0];
  const last  = data.verses[data.verses.length - 1];
  const title = first.verse === last.verse
    ? `${first.book} ${first.chapter}:${first.verse}`
    : `${first.book} ${first.chapter}:${first.verse}–${last.verse}`;
  const translationNames = { S21: 'SEGOND 21', BDS: 'BIBLE DU SEMEUR', NBS: 'NOUVELLE BIBLE SEGOND', DRB: 'DARBY' };
  document.getElementById('bibleHeader').style.display = '';
  markContentLoaded();
  document.getElementById('bibleTitle').textContent = title;
  document.getElementById('bibleSubtitle').textContent = 'TRADUCTION ' + (translationNames[data.translation] || data.translation);
  showPanel('panelBible');
  renderBibleVerses(data.verses);
}

function renderBibleVerses(verses) {
  const list = document.getElementById('bibleVerseList');
  list.innerHTML = verses.map((v, i) => {
    const isLive = i === state.bibleVerse;
    return `<div class="bible-verse-item${isLive ? ' active' : ''}" data-verse="${i}" data-action="projectBibleVerse">
      <span class="bible-verse-number" data-short="V${v.verse}">Verset ${v.verse}</span>
      <span class="bible-verse-text">${esc(v.text)}</span>
      <div class="strophe-action">
        ${isLive ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : ''}
      </div>
    </div>`;
  }).join('');
}

function projectBibleVerse(i) {
  const v = state.bible?.verses[i];
  if (!v) return;
  state.bibleVerse = i;
  state.isNoir = false;
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
  if (!files.length) { list.innerHTML = '<div class="search-empty">Aucun PDF dans le dossier</div>'; return; }
  list.innerHTML = files.map(f => `
    <div class="content-item" data-pdf-file="${esc(f.filename)}" data-action="selectPdf">
      <span class="item-title">${esc(f.filename)}</span>
    </div>
  `).join('');
}

document.getElementById('pdfSearchInput').addEventListener('input', e => {
  renderPdfList(filterMedia(pdfFiles, e.target.value));
});

// Ouvre le dossier des médias dans le gestionnaire de fichiers natif.
async function revealMediaDir(kind) {
  try { await apiRevealMediaDir(kind); }
  catch (err) { alert(String(err)); }
}

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
  document.getElementById('pdfPageList').innerHTML = '<div class="search-empty">Chargement…</div>';

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
  state.isNoir = false;
  clearProjectionModeButtons();

  document.querySelectorAll('#pdfPageList .pdf-page-item').forEach(el => {
    const live = parseInt(el.dataset.page) === page;
    el.classList.toggle('active', live);
    el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
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
  if (!files.length) { list.innerHTML = '<div class="search-empty">Aucune image dans le dossier</div>'; return; }
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
      <div class="strophe-action">${isLive ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : ''}</div>
    </div>
  `;
}

function projectImage() {
  if (!state.image) return;
  state.isNoir = false;
  clearProjectionModeButtons();

  document.querySelectorAll('#imagePreview .strophe-item').forEach(el => {
    const live = el.dataset.imagePreview === state.image.filename;
    el.classList.toggle('active', live);
    el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
  });

  project({ type: 'image', filename: state.image.filename });
}

// ─── BOUTON NOIR ─────────────────────────────────────────────────────────────

function toggleNoir() {
  if (state.isNoir) {
    state.isNoir = false;
    document.getElementById('btnModeRien').classList.remove('active');
    if (state.song && state.songVerse >= 0) {
      projectVerse(state.songVerse);
    } else {
      project({ type: 'blank' });
    }
  } else {
    state.isNoir = true;
    setProjectionMode('rien');
  }
}

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
  if (s.type === 'logo' || s.type === 'song' || s.type === 'bible') {
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
      _previewPdfCache.set(filename, doc);
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

function syncActiveItems(s) {
  if (!s) return;
  if (s.type === 'blank') {
    document.querySelectorAll('.strophe-item, .bible-verse-item, .pdf-page-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.strophe-action').forEach(el => { el.innerHTML = ''; });
  } else if (s.type === 'song') {
    document.querySelectorAll('#verseList .strophe-item').forEach(el => {
      const live = parseInt(el.dataset.verse) === s.verse;
      el.classList.toggle('active', live);
      el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
      if (live) el.scrollIntoView({ block: 'nearest' });
    });
  } else if (s.type === 'bible') {
    document.querySelectorAll('#bibleVerseList .bible-verse-item').forEach(el => {
      const live = parseInt(el.dataset.verse) === s.verse;
      el.classList.toggle('active', live);
      el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
      if (live) el.scrollIntoView({ block: 'nearest' });
    });
  } else if (s.type === 'pdf') {
    document.querySelectorAll('#pdfPageList .pdf-page-item').forEach(el => {
      const live = parseInt(el.dataset.page) === s.page;
      el.classList.toggle('active', live);
      el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
      if (live) el.scrollIntoView({ block: 'nearest' });
    });
  } else if (s.type === 'image') {
    document.querySelectorAll('#imagePreview .strophe-item').forEach(el => {
      const live = el.dataset.imagePreview === s.filename;
      el.classList.toggle('active', live);
      el.querySelector('.strophe-action').innerHTML = live ? '<span class="live-pill"><span class="dot"></span><span class="live-pill-text">En projection</span></span>' : '';
      if (live) el.scrollIntoView({ block: 'nearest' });
    });
  }
  state.isNoir = s.type === 'blank';
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

document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || !e.altKey) return;
  const shortcutMap = { 'Comma': 'bible', 'KeyM': 'cantiques', 'Period': 'pdf', 'Slash': 'images' };
  const tab = shortcutMap[e.code];
  if (!tab) return;
  e.preventDefault();
  activateTab(tab);
}, true);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const tabMap = { 'c': 'cantiques', 'b': 'bible', 'p': 'pdf', 'i': 'images' };
    const tab = tabMap[e.key];
    if (tab) {
      e.preventDefault();
      activateTab(tab);
      return;
    }
  }

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

  if (e.key === 'b' || e.key === 'B') {
    toggleNoir();
    return;
  }

  if (e.key === 'Escape') {
    state.songVerse = -1;
    state.bibleVerse = -1;
    state.pdfPage = -1;
    state.isNoir = false;
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
  if (!verses.length) { alert('Le chant doit avoir au moins une strophe.'); return; }

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
    alert('Erreur : ' + String(e));
    btn.disabled = false;
  }
}

// ─── PROJECTION : MULTI-ÉCRAN (Tauri) ────────────────────────────────────────

const PROJ_SCREEN_KEY = 'verso.projectionMonitor'; // {x,y,width,height,name}

function _savedScreen() {
  try { return JSON.parse(localStorage.getItem(PROJ_SCREEN_KEY) || 'null'); }
  catch (_) { return null; }
}

function _saveScreen(m) {
  localStorage.setItem(PROJ_SCREEN_KEY, JSON.stringify(m));
  _updateMonitorScreen(m);
}

function _updateMonitorScreen(m) {
  const el = document.getElementById('monitorScreen');
  const resEl = document.getElementById('monitorRes');
  if (!el) return;
  if (!m) {
    el.textContent = 'Aucun écran choisi';
    if (resEl) resEl.textContent = '';
    return;
  }
  const isPrimary = !m.x && !m.y;
  el.textContent = m.name || (isPrimary ? 'Écran principal' : `Écran ${m.width}×${m.height}`);
  if (resEl) resEl.textContent = `${m.width} × ${m.height}`;
}

async function openProjection() {
  let monitors;
  try { monitors = await apiListMonitors(); }
  catch (e) { alert('Impossible de lister les écrans : ' + String(e)); return; }

  if (!monitors.length) { alert('Aucun écran détecté.'); return; }

  let target = _savedScreen();
  if (target) {
    const match = monitors.find(m => m.x === target.x && m.y === target.y && m.width === target.width && m.height === target.height);
    if (!match) target = null;
  }
  if (!target) {
    const nonPrimary = monitors.find(m => !m.is_primary);
    target = nonPrimary || (monitors.length > 1 ? await _askScreenChoice(monitors) : monitors[0]);
    if (!target) return;
    _saveScreen(target);
  }

  // Toujours en plein écran sur l'écran cible (s'adapte à sa résolution).
  await apiOpenProjection(target.x, target.y, target.width, target.height, true);
}

async function pickProjectionScreen() {
  let monitors;
  try { monitors = await apiListMonitors(); }
  catch (e) { alert('Impossible de lister les écrans : ' + String(e)); return; }
  const choice = await _askScreenChoice(monitors);
  if (!choice) return;
  _saveScreen(choice);
  await apiOpenProjection(choice.x, choice.y, choice.width, choice.height, true);
}

function _askScreenChoice(monitors) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const box = document.createElement('div');
    box.className = 'screen-modal';
    box.innerHTML = `<h3 class="screen-modal__title">Choisir l'écran de projection</h3>
      <div id="screenChoices" class="screen-modal__list"></div>
      <div class="screen-modal__footer"><button id="screenCancel" class="hdr-btn">Annuler</button></div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const list = box.querySelector('#screenChoices');
    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'screen-modal__item';
      const label = m.name || `Écran ${i + 1}`;
      const primary = m.is_primary ? ' (principal)' : '';
      btn.innerHTML = `<strong>${esc(label)}${primary}</strong><span class="screen-modal__item-meta">${m.width}×${m.height} — position ${m.x},${m.y}</span>`;
      btn.onclick = () => { document.body.removeChild(overlay); resolve(m); };
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

(function _initProjectionUI() {
  _updateMonitorScreen(_savedScreen());
  document.getElementById('btnPickScreen').style.display = '';
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
