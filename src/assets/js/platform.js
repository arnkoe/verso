// Expose la plateforme avant le premier rendu afin que les espacements réservés
// aux contrôles natifs ne soient appliqués que sur macOS.
(() => {
  const platform = navigator.platform || navigator.userAgent || '';
  document.documentElement.classList.toggle('platform-macos', /Mac/i.test(platform));
})();
