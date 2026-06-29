/**
 * projection-render.js — rendu partagé du contenu de projection (version Tauri).
 *
 * Identique à la version web pour les chants/bible/logo. Les médias (PDF, image)
 * passent par `mediaUrl(kind, filename)` (asset:// Tauri) au lieu des URLs PHP.
 *
 * Dépendances globales : esc (utils.js), mediaUrl (api.js), pdfjsLib (vendor).
 */

function renderProjectionContent(state, container) {
  const isActive = state && state.type && state.type !== 'blank';

  if (!isActive) {
    container.classList.remove('active', 'media-mode');
    container.innerHTML = '';
    return;
  }

  container.classList.add('active');
  container.classList.toggle('media-mode', state.type === 'pdf' || state.type === 'image');
  container.innerHTML = '';

  if (state.type === 'song') {
    const div = document.createElement('div');
    div.className = 'content-text';
    const bookPart = [state.songbook_code, state.source_number ?? ''].filter(Boolean).join(' ');
    const labels = state.verseLabels && state.verseLabels.length
      ? state.verseLabels
      : [String(state.verse + 1)];
    const labelsHtml = labels.map((l, i) =>
      i === state.verse
        ? `<span class="reference-current">${esc(l)}</span>`
        : esc(l)
    ).join(' ');
    const headerBase = [bookPart, state.title].filter(Boolean).map(esc).join(' — ');
    div.innerHTML = `
      <div class="verse-text"><div class="verse-inner">${esc(state.verseText || '')}</div></div>
      <div class="reference">${headerBase}${headerBase ? ' — ' : ''}${labelsHtml}</div>`;
    container.appendChild(div);
    scheduleFit(div.querySelector('.verse-text'), div.querySelector('.verse-inner'), '--song-font-size');
    return;
  }

  if (state.type === 'bible') {
    const div = document.createElement('div');
    div.className = 'content-text';
    div.innerHTML = `
      <div class="bible-text"><div class="bible-inner">${esc(state.text || '')}</div></div>
      <div class="reference">${esc(state.reference || '')} (traduction ${esc(state.translation || '')})</div>`;
    container.appendChild(div);
    scheduleFit(div.querySelector('.bible-text'), div.querySelector('.bible-inner'), '--bible-font-size');
    return;
  }

  if (state.type === 'pdf') {
    const canvas = document.createElement('canvas');
    canvas.className = 'proj-pdf';
    container.appendChild(canvas);
    renderPdfPage(canvas, state.filename, state.page);
    return;
  }

  if (state.type === 'image') {
    const img = document.createElement('img');
    img.className = 'proj-image';
    mediaUrl('images', state.filename).then(url => { img.src = url; });
    container.appendChild(img);
    return;
  }
}

/**
 * Ajuste la taille de police du corps pour qu'il tienne dans le slide. Réduit la
 * police par dichotomie tant que le contenu déborde de la zone disponible.
 */
/**
 * Lance fitBodyText immédiatement puis le rejoue sur la frame suivante.
 *
 * Le rejeu couvre le cas (observé dans la WebView Tauri) où la requête de
 * conteneur (`container-type: size` sur #screen) n'est pas encore résolue au
 * moment du rendu : `getComputedStyle().fontSize` renverrait alors une base cqh
 * fausse (résolue contre le viewport), ce qui empêcherait toute réduction. Une
 * fois la mise en page établie, le second passage corrige la taille.
 */
function scheduleFit(box, inner, varName) {
  fitBodyText(box, inner, varName);
  requestAnimationFrame(() => fitBodyText(box, inner, varName));
}

/** Hauteur du conteneur de requête (élément avec container-type) le plus proche. */
function queryContainerHeight(el) {
  for (let n = el; n; n = n.parentElement) {
    if (getComputedStyle(n).containerType === 'size') return n.clientHeight;
  }
  return 0;
}

function fitBodyText(box, inner, varName) {
  if (!box || !inner) return;
  box.style.removeProperty(varName);
  let base = parseFloat(getComputedStyle(box).fontSize);
  // Plafond calculé directement depuis le conteneur de requête (8cqh = 8 % de sa
  // hauteur). Garde-fou contre une résolution cqh fautive de la WebView : la base
  // ne peut jamais excéder la valeur attendue à l'échelle du slide.
  const qh = queryContainerHeight(box);
  if (qh > 0) base = Math.min(base || Infinity, qh * 0.08);
  if (!base || base <= 0 || !isFinite(base)) return;
  if (box.clientWidth <= 0 || box.clientHeight <= 0) return;
  box.style.setProperty(varName, base + 'px');

  const fits = () =>
    inner.scrollWidth <= box.clientWidth + 1 && inner.scrollHeight <= box.clientHeight + 1;

  if (fits()) return;

  let lo = 1, hi = base, best = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    box.style.setProperty(varName, mid + 'px');
    if (fits()) { best = mid; lo = mid; } else { hi = mid; }
  }
  box.style.setProperty(varName, best + 'px');
}

// Cache borné de documents PDF décodés. Chaque PDFDocumentProxy retient ses
// buffers en mémoire ; on garde au plus PDF_CACHE_MAX docs (LRU) et on détruit
// le plus ancien à l'éviction pour éviter une croissance illimitée.
const PDF_CACHE_MAX = 3;
const _pdfDocCache = new Map();

function _cachePdfDoc(cache, key, doc) {
  cache.set(key, doc);
  while (cache.size > PDF_CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    const old = cache.get(oldestKey);
    cache.delete(oldestKey);
    try { old.destroy(); } catch (_) {}
  }
}

let _pdfRenderSeq = 0;

async function renderPdfPage(canvas, filename, pageNum) {
  const seq = ++_pdfRenderSeq;
  let waited = 0;
  while (!window.pdfjsLib && waited < 5000) {
    await new Promise(r => setTimeout(r, 50));
    waited += 50;
    if (seq !== _pdfRenderSeq) return;
  }
  if (!window.pdfjsLib) return;
  try {
    let doc = _pdfDocCache.get(filename);
    if (!doc) {
      const url = await mediaUrl('pdf', filename);
      doc = await pdfjsLib.getDocument({ url }).promise;
      _cachePdfDoc(_pdfDocCache, filename, doc);
    }
    if (seq !== _pdfRenderSeq) return;
    const page = await doc.getPage(pageNum);
    if (seq !== _pdfRenderSeq) return;

    const base = page.getViewport({ scale: 1 });
    const targetWidth = Math.max(window.screen.width, 1920) * (window.devicePixelRatio || 1);
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width  = '';
    canvas.style.height = '';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  } catch (e) {
    console.error('PDF render failed', e);
  }
}
