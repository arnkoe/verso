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
    "hero.title": "Project songs and Bible verses during worship.",
    "hero.lead": "You choose on your computer, the congregation sees the text in large type on the projector. Simple, free, no account or internet connection needed.",
    "dl.generic": "Download Verso",
    "dl.free": "Free · Windows and Mac",
    "dl.all": "All downloads",
    "dl.win": "10 and 11",
    "dl.macArm": "Apple chip (M1 and later)",
    "dl.macIntel": "Intel processor",
    "dl.whichMac": "Which Mac? Apple menu → About This Mac, “Chip” or “Processor” line.",
    "scene.songs": "Songs",
    "slide.1": "Your kingdom come,",
    "slide.2": "your will be done,",
    "slide.3": "on earth as it is in heaven.",
    "features.title": "What Verso does",
    "f.songs.t": "Songs",
    "f.songs.d": "Find a song by its number or first words, accents don't matter. Comes with the Reflets 4 and Hymnes et Cantiques songbooks.",
    "f.bible.t": "Bible",
    "f.bible.d": "Project a passage in a few keystrokes. Darby, revised Darby and Louis Segond 1910 are included, and you can add more.",
    "f.docs.t": "PDFs and images",
    "f.docs.d": "Drop your files into the Verso folder: announcements, posters or sheet music are shown like everything else.",
    "f.updates.t": "Always up to date",
    "f.updates.d": "Verso checks for a new version at startup and installs it by itself. Interface in English and French.",
    "install.title": "First launch",
    "install.lead": "The very first time, your computer will show a warning. This is normal and it is not a virus: Verso is free software without the paid certificates from Microsoft and Apple. You only do this once; later updates install by themselves.",
    "win.1": "Open the downloaded file (it ends with <code>setup.exe</code>).",
    "win.2": "If a blue screen says “Windows protected your PC”, click <strong>More info</strong>.",
    "win.3": "Click <strong>Run anyway</strong>. Installation continues normally.",
    "mac.1": "Open the <code>.dmg</code> file, then drag Verso into the <strong>Applications</strong> folder.",
    "mac.2": "If the Mac says “Verso is damaged”, open <strong>Terminal</strong> (Cmd + Space, type “Terminal”, Return).",
    "mac.3": "Paste this line, press Return, then open Verso normally:",
    "copy": "Copy",
    "copied": "Copied",
    "footer.source": "Source code",
    "footer.releases": "Release notes",
    "footer.docs": "User guide"
  };

  var FR_EXTRA = { copied: "Copié" };

  var LABELS = {
    fr: { win: "Télécharger pour Windows", macArm: "Télécharger pour Mac (puce Apple)", macIntel: "Télécharger pour Mac (Intel)" },
    en: { win: "Download for Windows", macArm: "Download for Mac (Apple chip)", macIntel: "Download for Mac (Intel)" }
  };

  var FR = {};
  var lang = "fr";
  var platform = detectPlatform();
  var release = null;

  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    FR[el.getAttribute("data-i18n")] = el.innerHTML;
  });

  function t(key) {
    var dict = lang === "en" ? EN : FR;
    return dict[key] || FR_EXTRA[key] || FR[key] || key;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function setLang(next) {
    lang = next === "en" ? "en" : "fr";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
    document.getElementById("doc-link").href =
      "https://github.com/" + REPO + "/blob/master/" + (lang === "en" ? "README.md" : "README.fr.md");
    document.title = lang === "en"
      ? "Verso: project songs and Bible verses during worship"
      : "Verso : projeter chants et Bible pendant le culte";
    renderDownloads();
  }

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
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

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = document.getElementById(btn.getAttribute("data-copy")).textContent;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = t("copied");
        setTimeout(function () { btn.textContent = t("copy"); }, 1600);
      });
    });
  });

  var saved = storageGet("verso-lang");
  var browserLang = (navigator.language || "fr").slice(0, 2).toLowerCase();
  setLang(saved || (browserLang === "fr" ? "fr" : "en"));
  loadRelease();
})();
