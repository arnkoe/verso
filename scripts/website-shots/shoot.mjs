#!/usr/bin/env node
// Regenerates the screenshots of website/img/ from the real Verso interface.
//
// The operator and projection pages of src/ are loaded in headless Chrome with
// mock-tauri.js standing in for the Rust back end (real bundled songbooks and
// Bibles), then driven like an operator would: search, select, project.
//
// Usage: node scripts/website-shots/shoot.mjs
// Needs Google Chrome and python3 (static server). No npm dependency.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'website/img');
const BUILD = join(HERE, 'build');
const PORT = 4191;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const MOCK = readFileSync(join(HERE, 'mock-tauri.js'), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Processes ──────────────────────────────────────────────────────────────

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'verso-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--hide-scrollbars', '--force-color-profile=srgb', '--no-first-run',
  '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

function cleanup() {
  chrome.kill();
  server.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', cleanup);

async function waitFor(fn, ms = 15000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (_) {}
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await sleep(100);
  }
}

// ─── DevTools protocol ──────────────────────────────────────────────────────

const portFile = join(profile, 'DevToolsActivePort');
const [devPort, devPath] = (await waitFor(() => existsSync(portFile) && readFileSync(portFile, 'utf8').trim(), 15000, 'Chrome'))
  .split('\n');
await waitFor(() => fetch(ORIGIN + '/package.json').then(r => r.ok), 10000, 'static server');

const ws = new WebSocket(`ws://127.0.0.1:${devPort}${devPath}`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
const eventWaiters = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method) {
    for (const w of [...eventWaiters]) {
      if (w.method === msg.method && w.sessionId === msg.sessionId) {
        eventWaiters.splice(eventWaiters.indexOf(w), 1);
        w.res(msg.params);
      }
    }
  }
};
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
const nextEvent = (method, sessionId) => new Promise(res => eventWaiters.push({ method, sessionId, res }));

async function openPage({ url, width, height, scale = 2, setup = '' }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  if (setup) await s('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  const loaded = nextEvent('Page.loadEventFired', sessionId);
  await s('Page.navigate', { url });
  await loaded;
  const page = {
    async eval(expr) {
      const r = await s('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, quality = 88) {
      await sleep(300);
      const { data } = await s('Page.captureScreenshot', { format: 'webp', quality });
      writeFileSync(join(OUT, file), Buffer.from(data, 'base64'));
      console.log('wrote website/img/' + file);
    },
    pdf: params => s('Page.printToPDF', params),
    close: () => send('Target.closeTarget', { targetId }),
  };
  return page;
}

// Helpers injected in the operator page before each scenario.
const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + fn); await sleep(50); }
  };
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const type = (el, text) => { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  // Native macOS window buttons, drawn over the overlay title bar like the real app.
  const lights = document.createElement('div');
  lights.style.cssText = 'position:fixed;top:5px;left:9px;display:flex;gap:8px;z-index:99999';
  for (const c of ['#ff5f57', '#febc2e', '#28c840']) {
    const d = document.createElement('i');
    d.style.cssText = 'width:12px;height:12px;border-radius:50%;background:' + c + ';box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18)';
    lights.appendChild(d);
  }
  document.body.appendChild(lights);
`;

const opSetup = (lang, extra = {}) =>
  `window.__SHOT__ = ${JSON.stringify({ version: VERSION, ...extra })};
   try { localStorage.setItem('verso.lang', ${JSON.stringify(lang)}); localStorage.setItem('verso.defaultBible', 'LSG'); } catch (_) {}
   ${MOCK}`;

const opPage = (lang, extra) => openPage({
  url: ORIGIN + '/src/operator.html', width: 1280, height: 820, setup: opSetup(lang, extra),
});

const slide = async (file, projection) => {
  const page = await openPage({
    url: ORIGIN + '/src/projection.html', width: 1600, height: 900, scale: 1,
    setup: `window.__SHOT__ = ${JSON.stringify({ projection })}; ${MOCK}`,
  });
  await page.eval(`
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 100 && !document.querySelector('#screen.active'); i++) await sleep(50);
    await sleep(400);`);
  await page.shot(file, 90);
  await page.close();
};

// ─── Shots ──────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
mkdirSync(BUILD, { recursive: true });

const LABELS = { fr: 'Annonces.pdf', en: 'Announcements.pdf' };
for (const lang of ['fr', 'en']) {
  const deck = await openPage({ url: `${ORIGIN}/scripts/website-shots/announcements.html?lang=${lang}`, width: 1600, height: 900, scale: 1 });
  await deck.eval('await document.fonts.ready;');
  const { data } = await deck.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(join(BUILD, `announcements-${lang}.pdf`), Buffer.from(data, 'base64'));
  await deck.close();
}

let songSlide, bibleSlides;
for (const lang of ['fr', 'en']) {
  const pdfs = [{ filename: LABELS[lang], url: `/scripts/website-shots/build/announcements-${lang}.pdf` }];

  // Songs: search by words, open "À toi la gloire", project the first verse.
  let page = await opPage(lang, { pdfs });
  songSlide = await page.eval(HELPERS + `
    const input = $('#songSearchInput');
    const hit = () => $$('#songList .content-item').find(e => e.textContent.includes('À toi la gloire'));
    await until(() => { type(input, 'toi la gloire'); return hit(); });
    hit().click();
    await until(() => $$('#verseList .strophe-item').length);
    $$('#verseList .strophe-item')[0].click();
    await until(() => $('#previewContent').textContent.trim());
    input.focus();
    return state.projection;`);
  await page.shot(`songs-${lang}.webp`);
  await page.close();

  // Bible: type a reference, Enter, project John 3:16.
  page = await opPage(lang, { pdfs });
  bibleSlides = await page.eval(HELPERS + `
    $('#tabBible').click();
    const input = $('#bibleSearchInput');
    // Typing once the books are loaded avoids stray chapter loads racing the click.
    await until(() => state.bibleCode && bibleBooksCache[state.bibleCode]);
    type(input, 'jean 3');
    await until(() => $('#bibleList .content-item'));
    press(input, 'Enter');
    await until(() => $$('#bibleVerseList .bible-verse-item').length > 15);
    await sleep(500);
    const v16 = () => $$('#bibleVerseList .bible-verse-item')[15];
    v16().click();
    await until(() => $('#previewContent').textContent.trim());
    const lsg = state.projection;
    $('#bibleTranslations [data-arg="DRB"]').click();
    await until(() => state.projection.bibleCode === 'DRB');
    const drb = state.projection;
    $('#bibleTranslations [data-arg="LSG"]').click();
    await until(() => state.projection.bibleCode === 'LSG');
    await sleep(300);
    v16().scrollIntoView({ block: 'center' });
    return { lsg, drb };`);
  await page.shot(`bible-${lang}.webp`);
  await page.close();

  // PDF: open the deck, project its first page.
  page = await opPage(lang, { pdfs });
  await page.eval(HELPERS + `
    $('#tabPdf').click();
    const item = await until(() => $('#pdfList .content-item'));
    item.click();
    const first = await until(() => $('#pdfPageList [data-action]'));
    await until(() => $('#pdfPageList canvas'));
    await sleep(800);
    first.click();
    await until(() => $('#previewContent canvas, #previewContent img'));
    await sleep(800);`);
  await page.shot(`pdf-${lang}.webp`);
  await page.close();
}

await slide('slide-song.webp', songSlide);
await slide('slide-bible-lsg.webp', bibleSlides.lsg);
await slide('slide-bible-drb.webp', bibleSlides.drb);

ws.close();
process.exit(0);
