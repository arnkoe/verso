/**
 * projection.js — logique de la fenêtre de projection.
 *
 * Externalisé depuis projection.html : la CSP du build (nonce injecté par Tauri)
 * bloque les scripts inline.
 */

let currentState = null;
const screen = document.getElementById('screen');

// ─── MISE À L'ÉCHELLE DU SLIDE ──────────────────────────────────────────────
const ROOT_STYLE = getComputedStyle(document.documentElement);
const REF_W = parseFloat(ROOT_STYLE.getPropertyValue('--ref-w')) || 1600;
const REF_H = parseFloat(ROOT_STYLE.getPropertyValue('--ref-h')) || 900;
function fitScreen() {
  const scale = Math.min(window.innerWidth / REF_W, window.innerHeight / REF_H);
  document.documentElement.style.setProperty('--fit', scale);
}
window.addEventListener('resize', fitScreen);
fitScreen();

function applyState(state) {
  if (JSON.stringify(state) === JSON.stringify(currentState)) return;
  currentState = state;
  renderProjectionContent(state, screen);
}

// Échap ferme la fenêtre de projection.
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.__TAURI__.window.getCurrentWindow().close();
  }
});

// Event Tauri émis par l'opérateur (remplace BroadcastChannel).
tauriEvent.listen('projection-update', e => applyState(e.payload));

// État initial : reprend le dernier état persisté.
(async function _init() {
  try {
    const s = await apiGetProjectionState();
    if (s) applyState(s);
  } catch (_) {}
})();
