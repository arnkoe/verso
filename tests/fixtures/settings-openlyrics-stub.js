// API Tauri simulée pour la fixture settings-openlyrics.html : données
// déterministes, aucun accès fichier. Chaque appel est noté dans
// window.__fixtureCalls pour les vérifications.
(() => {
  const lang = new URLSearchParams(location.search).get('lang');
  if (lang) try { localStorage.setItem('verso.lang', lang); } catch (_) {}

  const books = [
    { filename: 'songbook-hec.json', label: "J'aime l'Éternel", code: 'HEC', added_at: '2025-09-14T08:02:00Z' },
    { filename: 'songbook-mr.json', label: 'Mon recueil', code: 'MR', added_at: '2026-03-03T17:47:00Z' },
  ];
  const calls = [];
  window.__fixtureCalls = calls;
  window.__fixtureFail = { import: false, export: false };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const handlers = {
    list_content: ({ kind }) => (kind === 'songbooks' ? books.slice() : []),
    list_songbooks: () => books.map(b => ({ code: b.code, name: b.label })),
    async import_openlyrics({ name, code }) {
      await wait(300);
      if (window.__fixtureFail.import) throw 'Écriture : permission refusée';
      books.push({ filename: `songbook-${code.toLowerCase()}.json`, label: name, code, added_at: '2026-11-26T14:20:00Z' });
      return { imported: 128, ignored: 3 };
    },
    async export_openlyrics() {
      await wait(300);
      if (window.__fixtureFail.export) throw 'Écriture : impossible d\'écrire dans ce dossier';
      return 412;
    },
    list_monitors: () => [],
    app_version: () => '0.7.0',
    sync_status: () => false,
  };

  window.__TAURI__ = {
    core: {
      async invoke(cmd, args) {
        calls.push({ cmd, args });
        const h = handlers[cmd];
        return h ? h(args || {}) : null;
      },
      convertFileSrc: p => p,
    },
    event: { listen: async () => () => {}, emit: async () => {} },
    dialog: {
      async open(opts) { calls.push({ cmd: 'dialog.open', args: opts }); return ['/Users/demo/Cantiques-ALF.zip']; },
      async save(opts) { calls.push({ cmd: 'dialog.save', args: opts }); return '/Users/demo/export.zip'; },
    },
    window: { getCurrentWindow: () => ({ isVisible: async () => false }) },
    updater: { check: async () => null },
    process: { relaunch: async () => {} },
  };
})();
