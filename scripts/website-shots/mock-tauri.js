/*
 * Stand-in for window.__TAURI__ used only to take the website screenshots.
 * It answers the operator and projection pages with the real bundled
 * songbooks and Bibles (served over HTTP from the repository root), so the
 * captures show the real interface with real content. Injected by shoot.mjs
 * before any page script runs; window.__SHOT__ carries per-shot settings.
 */
(() => {
  const RES = '/src-tauri/resources/';
  const SONGBOOKS = ['songbook-hec.json', 'songbook-ref.json'];
  const BIBLES = ['bible-drb.json', 'bible-drr.json', 'bible-lsg.json'];
  const cfg = window.__SHOT__ || {};

  const getJson = url => fetch(url).then(r => {
    if (!r.ok) throw new Error(url + ': ' + r.status);
    return r.json();
  });

  let songsPromise = null;
  function songs() {
    if (!songsPromise) {
      songsPromise = Promise.all(SONGBOOKS.map(f => getJson(RES + 'songbooks/' + f))).then(books => {
        const list = [];
        const names = [];
        let id = 1;
        for (const b of books) {
          names.push({ code: b.songbook_code, name: b.songbook_name || b.songbook_code });
          for (const s of b.songs) list.push({ ...s, id: id++, songbook_code: b.songbook_code });
        }
        names.sort((a, b) => a.name.localeCompare(b.name));
        return { list, names };
      });
    }
    return songsPromise;
  }

  let biblesPromise = null;
  function bibles() {
    if (!biblesPromise) {
      biblesPromise = Promise.all(BIBLES.map(f => getJson(RES + 'bibles/' + f))).then(all => {
        const byCode = {};
        for (const b of all) byCode[b.bible_code] = b;
        return byCode;
      });
    }
    return biblesPromise;
  }

  let projection = cfg.projection || { type: 'blank' };
  const listeners = {};
  function emit(name, payload) {
    (listeners[name] || []).forEach(fn => fn({ event: name, payload }));
  }

  const commands = {
    async list_songs() {
      const { list } = await songs();
      return list.map(s => ({
        id: s.id,
        title: s.title,
        author: s.author || null,
        songbook_code: s.songbook_code,
        source_number: s.source_number ?? null,
        verse_count: s.verses.length,
        incipits: s.verses.map(v => (v.text.split('\n')[0] || '').trim()).filter(Boolean),
      }));
    },
    async get_song({ id }) {
      const { list } = await songs();
      const s = list.find(x => x.id === id);
      if (!s) throw 'Cantique introuvable';
      const { id: _omit, ...rest } = s;
      return rest;
    },
    async list_songbooks() { return (await songs()).names; },
    async list_bibles() {
      const all = await bibles();
      return Object.values(all)
        .map(b => ({ code: b.bible_code, name: b.bible_name || b.bible_code }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async bible_books({ bibleCode }) {
      const b = (await bibles())[bibleCode];
      return { bible_code: bibleCode, books: b.books.map(x => x.name) };
    },
    // The operator resolves references itself and asks for "<Book> <chapter>".
    async bible_search({ q, bibleCode }) {
      const b = (await bibles())[bibleCode];
      const m = /^(.*\S)\s+(\d+)$/.exec(q.trim());
      const book = m && b.books.find(x => x.name === m[1]);
      const chapter = book && book.chapters[Number(m[2]) - 1];
      if (!chapter) return { books: [], bible_code: bibleCode };
      return {
        verses: chapter.map((text, i) => ({ book: book.name, chapter: Number(m[2]), verse: i + 1, text })),
        bible_code: bibleCode,
        bible_copyright: b.bible_copyright || undefined,
      };
    },
    async list_pdfs() { return (cfg.pdfs || []).map(p => ({ filename: p.filename })); },
    async list_images() { return []; },
    async list_content() { return []; },
    async media_path({ kind, filename }) {
      const pdf = (cfg.pdfs || []).find(p => p.filename === filename);
      return pdf ? pdf.url : RES + kind + '/' + filename;
    },
    async get_projection_state() { return projection; },
    async set_projection_state({ payload }) {
      projection = payload;
      emit('projection-update', payload);
    },
    async list_monitors() { return []; },
    async app_version() { return cfg.version || '0.0.0'; },
    async simulated_update_version() { return null; },
    async sync_status() { return false; },
  };

  async function invoke(cmd, args) {
    const fn = commands[cmd];
    return fn ? fn(args || {}) : null;
  }

  const win = {
    close() {}, hide: async () => {}, show: async () => {}, setFocus: async () => {},
    isVisible: async () => true, onCloseRequested: async () => () => {},
  };

  window.__TAURI__ = {
    core: { invoke, convertFileSrc: path => path },
    event: {
      listen: async (name, fn) => {
        (listeners[name] = listeners[name] || []).push(fn);
        return () => { listeners[name] = listeners[name].filter(f => f !== fn); };
      },
      emit: async (name, payload) => emit(name, payload),
    },
    updater: { check: async () => null },
    process: { relaunch: async () => {} },
    window: { getCurrentWindow: () => win },
    webviewWindow: { getCurrentWebviewWindow: () => win },
    dialog: { open: async () => null },
  };
})();
