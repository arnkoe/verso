/**
 * projection.js — logique de la fenêtre de projection.
 *
 * Externalisé depuis projection.html : la CSP du build (nonce injecté par Tauri)
 * bloque les scripts inline.
 */

let currentState = null;
let lastActiveState = null;
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
  if (state?.type && state.type !== 'blank') {
    lastActiveState = state;
  } else if (state?.previous?.type && state.previous.type !== 'blank') {
    lastActiveState = state.previous;
  }
  if (JSON.stringify(state) === JSON.stringify(currentState)) return;
  currentState = state;
  renderProjectionContent(state, screen);
}

// Échap ferme la fenêtre de projection. Cmd/Ctrl+M masque son contenu sans la
// fermer ; Cmd/Ctrl+P réaffiche le dernier contenu projeté.
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.__TAURI__.window.getCurrentWindow().close();
    return;
  }

  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'm' && key !== 'p') return;
  e.preventDefault();

  if (key === 'm') {
    const blank = { type: 'blank', ...(lastActiveState && { previous: lastActiveState }) };
    applyState(blank);
    apiSetProjectionState(blank).catch(err => console.warn('Failed to clear projection:', err));
  } else if (lastActiveState) {
    applyState(lastActiveState);
    apiSetProjectionState(lastActiveState).catch(err => console.warn('Failed to restore projection:', err));
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
