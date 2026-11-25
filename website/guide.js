(function () {
  "use strict";

  // The user guide is the repository README, fetched from GitHub on every
  // visit: a push to master shows up here without redeploying the site
  // (raw.githubusercontent.com caches files for 5 minutes).
  var REPO = "arnkoe/verso";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/master/";
  var BLOB = "https://github.com/" + REPO + "/blob/master/";
  var FILES = { fr: "README.fr.md", en: "README.md" };

  // Only the part of the README between these markers is shown. Without
  // them, the whole README is shown minus its title and language link.
  var START = "<!-- website:start -->";
  var END = "<!-- website:end -->";

  var EN = {
    "nav.download": "Download",
    "nav.docs": "User guide",
    "guide.toc": "Contents",
    "guide.title": "User guide",
    "guide.loading": "Loading the user guide…",
    "guide.error": "The user guide could not be loaded.",
    "guide.errorLink": "Read it on GitHub",
    "guide.more": "Adding a songbook or a Bible, contributing to the code:",
    "guide.tech": "technical section on GitHub",
    "footer.source": "Source code",
    "footer.releases": "Release notes",
    "footer.github": "This guide on GitHub"
  };
  var FR_EXTRA = {
    "guide.error": "Le mode d'emploi n'a pas pu être chargé.",
    "guide.errorLink": "Le lire sur GitHub"
  };
  var TITLES = { fr: "Mode d'emploi de Verso", en: "Verso user guide" };

  var FR = {};
  var lang = "fr";
  var cache = {};
  var request = 0;

  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    FR[el.getAttribute("data-i18n")] = el.innerHTML;
  });

  function t(key) {
    var dict = lang === "en" ? EN : FR;
    return dict[key] || FR_EXTRA[key] || FR[key] || key;
  }

  // As on index.html, a language picked on the page lasts for the visit only
  // (the starting language is chosen in guide.html <head>).
  function storageSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  // Same anchors as GitHub, so links to a section work on both.
  function slugger() {
    var seen = {};
    return function (text) {
      var base = text.trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
      var n = seen[base] || 0;
      seen[base] = n + 1;
      return n ? base + "-" + n : base;
    };
  }

  function extract(md) {
    var s = md.indexOf(START);
    var e = md.indexOf(END);
    var rest = e >= 0 ? md.slice(e + END.length) : "";
    var tech = /^## (.+)$/m.exec(rest);
    var body;
    if (s >= 0 && e > s) {
      body = md.slice(s + START.length, e);
    } else {
      body = md
        .replace(/^# .*\n/, "")
        .replace(/^\*\[[^\]]*\]\(README(\.fr)?\.md\)\*\s*$/m, "");
    }
    return { body: body, tech: tech ? slugger()(tech[1]) : "" };
  }

  function render(md) {
    var part = extract(md);
    var html = DOMPurify.sanitize(marked.parse(part.body));
    var box = document.getElementById("guide-body");
    box.innerHTML = html;

    // Relative links point into the repository.
    box.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!/^([a-z]+:|#)/i.test(href)) a.href = BLOB + href.replace(/^\.\//, "");
    });

    var slug = slugger();
    var toc = document.getElementById("toc");
    toc.innerHTML = "";
    box.querySelectorAll("h2, h3").forEach(function (h) {
      h.id = slug(h.textContent);
      var li = document.createElement("li");
      li.className = h.tagName === "H3" ? "sub" : "";
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      li.appendChild(a);
      toc.appendChild(li);
    });
    document.querySelector(".toc").hidden = !toc.children.length;

    var tech = document.getElementById("guide-tech");
    tech.href = BLOB + FILES[lang] + (part.tech ? "#" + part.tech : "");
    document.getElementById("guide-more").hidden = !part.tech;

    if (location.hash) {
      var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  function showError() {
    var box = document.getElementById("guide-body");
    box.innerHTML = "";
    var p = document.createElement("p");
    p.className = "guide-status";
    p.textContent = t("guide.error") + " ";
    var a = document.createElement("a");
    a.href = BLOB + FILES[lang];
    a.textContent = t("guide.errorLink");
    p.appendChild(a);
    box.appendChild(p);
    document.querySelector(".toc").hidden = true;
    document.getElementById("guide-more").hidden = true;
  }

  function load() {
    var mine = ++request;
    var file = FILES[lang];
    var done = function (md) { if (mine === request) render(md); };
    var fail = function () { if (mine === request) showError(); };

    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") return fail();
    if (cache[file]) return done(cache[file]);

    document.getElementById("guide-body").innerHTML =
      '<p class="guide-status">' + t("guide.loading") + "</p>";
    fetch(RAW + file)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (md) { cache[file] = md; done(md); })
      .catch(fail);
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
    document.getElementById("guide-source").href = BLOB + FILES[lang];
    document.title = TITLES[lang];
    load();
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
})();
