// Génère `dist/latest.json` à partir des bundles updater présents dans `dist/`.
//
// Le plugin tauri-updater (v2) interroge ce fichier et cherche la clé
// correspondant à sa plateforme (`darwin-aarch64`, `darwin-x86_64`,
// `windows-x86_64`). Pour chacune, il lui faut l'URL du bundle updater et la
// signature (contenu du `.sig` correspondant).
//
// Bundles attendus dans dist/ (cf. étape « Rassembler les bundles ») :
//   Verso_aarch64-apple-darwin.app.tar.gz(.sig)   -> darwin-aarch64
//   Verso_x86_64-apple-darwin.app.tar.gz(.sig)    -> darwin-x86_64
//   Verso_<version>_x64-setup.exe(.sig)           -> windows-x86_64

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const tag = process.env.TAG;
if (!tag) {
  console.error("TAG manquant (ex. v0.3.3).");
  process.exit(1);
}
const version = tag.replace(/^v/, "");
const repo = process.env.GITHUB_REPOSITORY || "arnkoe/verso";
const downloadBase = `https://github.com/${repo}/releases/download/${tag}`;

const files = readdirSync(DIST);

// Trouve un fichier par suffixe ; renvoie son nom (sans le dossier) ou null.
function find(pred) {
  return files.find(pred) ?? null;
}

const sig = (name) => readFileSync(join(DIST, `${name}.sig`), "utf8").trim();

const platforms = {};

// macOS Apple Silicon
const macArm = find((f) => f.includes("aarch64-apple-darwin") && f.endsWith(".app.tar.gz"));
if (macArm) {
  platforms["darwin-aarch64"] = {
    signature: sig(macArm),
    url: `${downloadBase}/${encodeURIComponent(macArm)}`,
  };
}

// macOS Intel
const macX64 = find((f) => f.includes("x86_64-apple-darwin") && f.endsWith(".app.tar.gz"));
if (macX64) {
  platforms["darwin-x86_64"] = {
    signature: sig(macX64),
    url: `${downloadBase}/${encodeURIComponent(macX64)}`,
  };
}

// Windows (installateur NSIS .exe)
const win = find((f) => f.endsWith("-setup.exe"));
if (win) {
  platforms["windows-x86_64"] = {
    signature: sig(win),
    url: `${downloadBase}/${encodeURIComponent(win)}`,
  };
}

const expected = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];
const missing = expected.filter((p) => !platforms[p]);
if (missing.length) {
  console.error(`Plateformes manquantes dans latest.json : ${missing.join(", ")}`);
  console.error(`Fichiers présents dans ${DIST} :\n  ${files.join("\n  ")}`);
  process.exit(1);
}

const latest = {
  version,
  notes: "Voir les notes de version sur la page GitHub de la release.",
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(join(DIST, "latest.json"), JSON.stringify(latest, null, 2));
console.log("latest.json généré :");
console.log(JSON.stringify(latest, null, 2));
