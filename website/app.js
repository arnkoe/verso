(function () {
  "use strict";

  var REPO = "arnkoe/verso";
  var RELEASES_URL = "https://github.com/" + REPO + "/releases/latest";

  // Asset name patterns produced by .github/workflows/release.yml (tauri-action).
  var ASSETS = {
    win: /_x64-setup\.exe$/,
    macArm: /_aarch64\.dmg$/,
    macIntel: /_x64\.dmg$/
  };

  // French strings live in index.html; English overrides them.
  var EN = {
    "nav.download": "Download",
    "nav.docs": "User guide",
    "hero.title": "Project songs and verses without missing a beat.",
    "hero.lead": "Verso puts songs, Bible verses and PDFs on screen the moment you need them: nothing to prepare before the service, everything driven from the keyboard. Free on Windows and Mac, with no account and no Internet connection needed.",
    "dl.generic": "Download Verso",
    "dl.others": "Other systems",
    "stage.operator": "What you see",
    "stage.screen": "What the congregation sees",
    "alt.songs": "The Verso window: a search for “toi la gloire”, hymn 240 of Hymnes et Cantiques open, its first verse on screen.",
    "alt.slide": "The same verse shown in large type on the projection screen.",
    "prep.title": "Nothing to prepare beforehand",
    "prep.text": "There is nothing to prepare in Verso before the service. When someone suggests a song or quotes a verse, type its number or reference: it is on screen at once.",
    "prep.search": "To find a song, type its number or a few words from its title or the start of a verse; accents are optional. Press Return once to select a result in the search, and again to put the verse on screen.",
    "prep.t1": "A first hymn is suggested",
    "prep.t2": "A speaker quotes a verse from Romans 8",
    "prep.t3": "A second hymn is suggested",
    "prep.t4": "A communion picture needs to go up",
    "keys.shift": "Shift",
    "keys.title": "Everything from the keyboard",
    "keys.text": "Once a song or passage is open, the arrow keys step through the verses. To react faster during a service, your hands can stay on the keyboard: you can use the mouse, but you don't need to.",
    "keys.caption": "Main keyboard shortcuts",
    "keys.search": "Search",
    "keys.or": "or",
    "keys.then": "then",
    "keys.enter": "Return",
    "keys.pick": "Pick a result",
    "keys.next": "Next verse",
    "keys.prev": "Previous verse",
    "keys.tab": "Switch tab (songs, Bible, PDFs)",
    "keys.project": "Open the projection",
    "keys.clear": "Clear the screen",
    "bible.title": "Another translation, in one click",
    "bible.text": "The verse is up in Louis Segond, but the speaker is reading from Darby? Click Darby and the same verse appears in that translation. Nothing to look up again.",
    "bible.included": "Included: Darby, revised Darby and Louis Segond 1910. You can add your own.",
    "bible.after": "Another translation, one click away",
    "alt.bible": "John 3 open in Verso, verse 16 on screen, with the DRB, DRR and LSG buttons to switch translation.",
    "alt.lsg": "John 3:16 projected in Louis Segond 1910.",
    "alt.drb": "The same verse projected in Darby.",
    "pdf.title": "Your PDFs and images, fitted to the screen",
    "pdf.text": "Announcements, posters, sheet music: add the file to Verso and all its pages show up as thumbnails. Click a thumbnail, or use the arrow keys, to show that page on the projection screen. Same for images.",
    "alt.pdf": "A three-page announcements PDF open in Verso, its first page on screen.",
    "upd.s1": "When Verso opens, a link lets you know",
    "upd.link": "Update available",
    "upd.s2": "You click the link, then one button",
    "upd.button": "Install and restart",
    "upd.s3": "Verso restarts on the new version",
    "upd.done": "Verso is up to date",
    "speed.title": "Quick to install, easy to update",
    "speed.text": "Verso downloads and installs in moments. Once installed, it works without an Internet connection, which is only used to get new versions. When a new version is available, an “Update available” link appears when you open Verso: click it and follow the steps.",
    "dl.title": "Download Verso",
    "dl.free": "Free, for Windows (10 and 11) and Mac.",
    "dl.win": "10 and 11",
    "dl.macArm": "Apple chip (M1 and later)",
    "dl.macIntel": "Intel processor",
    "install.title": "First install",
    "install.lead": "The first time, Windows shows a warning. This is expected: Verso is free and does not have the paid Microsoft certificate. You only do this once; after that, updates install directly from within Verso.",
    "win.1": "Open the downloaded file (it ends with <code>setup.exe</code>).",
    "win.2": "If a blue window says “Windows protected your PC”, click <strong>More info</strong>.",
    "win.3": "Click <strong>Run anyway</strong>. Installation continues normally.",
    "mac.1": "Open the <code>.dmg</code> file, then drag Verso into the <strong>Applications</strong> folder.",
    "mac.2": "Open Verso from the Applications folder. If macOS asks you to confirm opening an app downloaded from the Internet, click <strong>Open</strong>.",
    "footer.source": "Source code",
    "footer.releases": "Release notes"
  };

  var LABELS = {
    fr: { win: "Télécharger pour Windows", macArm: "Télécharger pour Mac", macIntel: "Télécharger pour Mac (Intel)" },
    en: { win: "Download for Windows", macArm: "Download for Mac", macIntel: "Download for Mac (Intel)" }
  };

  var FR = {};
  var lang = "fr";
  var platform = detectPlatform();
  var release = null;

  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    FR[el.getAttribute("data-i18n")] = el.innerHTML;
  });
  document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
    FR[el.getAttribute("data-i18n-alt")] = el.getAttribute("alt");
  });

  // Same modifier key as the app shows: ⌘ on Mac, Ctrl elsewhere.
  if (/Mac/i.test(navigator.platform || navigator.userAgent || "")) {
    document.querySelectorAll("kbd[data-mod]").forEach(function (k) { k.textContent = "⌘"; });
  }

  function t(key) {
    var dict = lang === "en" ? EN : FR;
    return dict[key] || FR[key] || key;
  }

  // A language picked on the page lasts for the visit only: the next visit
  // starts again from the browser language (chosen in index.html <head>).
  function storageSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function setLang(next) {
    lang = next === "en" ? "en" : "fr";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
      el.setAttribute("alt", t(el.getAttribute("data-i18n-alt")));
    });
    // Screenshots of the app interface exist in both languages.
    document.querySelectorAll("img[data-shot]").forEach(function (img) {
      img.src = "img/" + img.getAttribute("data-shot") + "-" + lang + ".webp";
    });
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
    document.title = lang === "en"
      ? "Verso: project songs, Bible verses and PDFs during worship"
      : "Verso : projeter chants, Bible et PDF pendant le culte";
    renderDownloads();
  }

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
    // iPadOS Safari reports itself as a Mac; a touch screen gives it away.
    if (/Mac/i.test(p + ua) && navigator.maxTouchPoints > 1) return null;
    if (/Win/i.test(p) || /Windows/i.test(ua)) return "win";
    if (/Mac/i.test(p) || /Macintosh/i.test(ua)) return isIntelMac() ? "macIntel" : "macArm";
    return null;
  }

  // Browsers do not expose the CPU architecture of a Mac. The GPU name is the
  // best available hint: Intel Macs report an Intel (or AMD) GPU, Apple
  // Silicon reports "Apple M...". When unsure, assume Apple Silicon, which
  // every Mac sold since 2021 uses.
  function isIntelMac() {
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      var renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
      return /Intel|AMD|Radeon/i.test(renderer);
    } catch (e) {
      return false;
    }
  }

  function formatSize(bytes) {
    return (bytes / 1048576).toFixed(0) + (lang === "en" ? " MB" : " Mo");
  }

  function renderDownloads() {
    var urls = {};
    if (release) {
      release.assets.forEach(function (a) {
        Object.keys(ASSETS).forEach(function (k) {
          if (ASSETS[k].test(a.name)) urls[k] = a;
        });
      });
    }

    document.querySelectorAll("[data-asset]").forEach(function (link) {
      var key = link.getAttribute("data-asset");
      var asset = urls[key];
      link.href = asset ? asset.browser_download_url : RELEASES_URL;
      link.classList.toggle("recommended", key === platform);
      var size = document.querySelector('[data-size="' + key + '"]');
      size.textContent = asset ? formatSize(asset.size) : "";
    });

    var primary = document.getElementById("primary-download");
    var label = document.getElementById("primary-label");
    if (platform) {
      label.textContent = LABELS[lang][platform];
      primary.href = urls[platform] ? urls[platform].browser_download_url : RELEASES_URL;
    } else {
      label.innerHTML = t("dl.generic");
      primary.href = RELEASES_URL;
    }

    var v = document.getElementById("version-line");
    v.textContent = release ? "Version " + release.tag_name.replace(/^verso-v/, "") : "";
  }

  function loadRelease() {
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.assets)) {
          release = data;
          renderDownloads();
        }
      })
      .catch(function () { /* keep links to the releases page */ });
  }

  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = b.getAttribute("data-lang");
      storageSet("verso-lang", next);
      setLang(next);
    });
  });

  document.getElementById("year").textContent = new Date().getFullYear();
  setLang(document.documentElement.lang);
  loadRelease();
})();
