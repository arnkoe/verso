// Configure le worker pdf.js. Externalisé car la CSP du build (nonce injecté
// par Tauri) bloque les scripts inline.
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
}
