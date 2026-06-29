//! Stockage fichiers : tout l'état applicatif vit dans le dossier de données de
//! l'app (app data dir). Pas de base SQLite. Au premier lancement, des recueils et
//! bibles libres de droits empaquetés dans le build sont déposés dans le dossier
//! de données (voir `seed_defaults`) ; ensuite l'utilisateur les édite/complète
//! librement.
//!
//! Arborescence (sous app_data_dir) :
//!   songbooks/songbook-<recueil>.json — un fichier par recueil (déposés/édités par l'utilisateur)
//!   bibles/bible-<traduction>.json — une bible par traduction (déposées par l'utilisateur)
//!   projection_state.json   — dernier état projeté (repris à l'ouverture de la projection)
//!   pdf/<fichier>           — PDFs déposés par l'utilisateur
//!   images/<fichier>        — images déposées par l'utilisateur
//!
//! Les bibles sont en lecture seule pour l'app : elles sont lues à la demande
//! depuis le dossier `bibles/` et mises en cache mémoire.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

// ─── Modèles ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verse {
    #[serde(rename = "type", default = "default_verse_type")]
    pub vtype: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<i64>,
    pub text: String,
}

/// Type de section par défaut (strophe) si le champ `type` est absent du JSON,
/// pour éviter qu'une seule section mal formée n'empêche le parsing de tout le recueil.
fn default_verse_type() -> String {
    "verse".to_string()
}

/// Normalise un code de type de section vers la forme canonique internationale
/// (`verse`, `chorus`, `bridge`, `intro`, `outro`, `prechorus`). Accepte aussi
/// les anciens codes français (`S`, `R`, `P`, `I`, `O`) des recueils existants
/// ainsi que les alias longs FR/EN, pour une lecture rétrocompatible. Tout code
/// inconnu retombe sur `verse`.
pub fn canonical_vtype(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "v" | "s" | "verse" | "strophe" | "couplet" => "verse",
        "c" | "r" | "chorus" | "refrain" => "chorus",
        "b" | "p" | "bridge" | "pont" => "bridge",
        "i" | "intro" | "introduction" => "intro",
        "o" | "outro" | "final" | "coda" => "outro",
        "pc" | "prechorus" | "pre-chorus" | "pré-refrain" | "pre-refrain" => "prechorus",
        _ => "verse",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    /// Identifiant de session : assigné séquentiellement à la lecture des
    /// recueils (`read_songbook_files`), il n'est ni lu ni écrit dans les
    /// fichiers. Sert uniquement de clé de lookup en mémoire pour
    /// `get_song`/`update_song`. Les recueils déposés par l'utilisateur n'ont
    /// donc pas à fournir d'`id` ; un champ `id` présent dans un ancien fichier
    /// est ignoré.
    #[serde(default, skip_serializing)]
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub songbook_code: Option<String>,
    #[serde(default)]
    pub source_number: Option<i64>,
    pub verses: Vec<Verse>,
}

/// Fichier de recueil : enveloppe portant le nom lisible une seule fois, plus
/// la liste des chants. Le code (`songbook_code`) et le nom
/// (`songbook_name`) sont propagés sur chaque `Song` à la lecture pour rester
/// disponibles à plat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Songbook {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub songbook_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub songbook_name: Option<String>,
    pub songs: Vec<Song>,
}

/// Vue allégée pour la liste de recherche (sans le corps des strophes).
#[derive(Debug, Clone, Serialize)]
pub struct SongSummary {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub songbook_code: Option<String>,
    pub source_number: Option<i64>,
    pub verse_count: usize,
    /// Première ligne de chaque couplet (incipits), pour la recherche.
    pub incipits: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleBook {
    pub name: String,
    /// chapters[c] = versets du chapitre c+1 ; chapters[c][v] = verset v+1.
    pub chapters: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bible {
    pub bible_code: String,
    /// Nom lisible de la traduction (ex. « Bible du Semeur »). Optionnel ; à
    /// défaut on retombe sur le code `bible_code`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bible_name: Option<String>,
    pub books: Vec<BibleBook>,
}

// ─── État partagé ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AppState {
    /// Cache des bibles déjà chargées en mémoire (clé = code de bible).
    pub bibles: Mutex<std::collections::HashMap<String, Bible>>,
    /// Cache du recueil de chants.
    pub songs: Mutex<Option<Vec<Song>>>,
}

// ─── Chemins ────────────────────────────────────────────────────────────────

/// Dossier de données : un répertoire « Verso » sous le dossier de données de
/// l'app (app data dir). On évite délibérément les Documents de l'utilisateur :
/// sous macOS ils sont protégés par TCC et provoquent des demandes d'autorisation
/// répétées tant que l'app n'a pas une signature stable. L'utilisateur ouvre ce
/// dossier via le bouton dédié (commande `reveal_verso_dir`).
pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("dossier de données indisponible")
        .join("Verso");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Dossier contenant un fichier JSON par recueil de chants.
fn songbooks_dir(app: &AppHandle) -> PathBuf {
    let dir = data_dir(app).join("songbooks");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Dossier contenant un fichier JSON par traduction de bible (déposé par l'utilisateur).
fn bibles_dir(app: &AppHandle) -> PathBuf {
    let dir = data_dir(app).join("bibles");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Nom de recueil → slug ASCII utilisé dans le nom de fichier `songbook-<slug>.json`.
/// Doit rester cohérent avec le découpage des ressources empaquetées.
fn book_slug(book: &str) -> String {
    let mut s = String::new();
    for c in book.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if c == ' ' || c == '-' || c == '_' {
            s.push('-');
        }
        // tout autre caractère (accents, ponctuation) est ignoré
    }
    if s.is_empty() {
        "sans-recueil".to_string()
    } else {
        s
    }
}

/// Code de bible → slug ASCII utilisé dans le nom de fichier `bible-<slug>.json`.
/// Même normalisation que `book_slug`, avec un repli neutre.
fn bible_slug(code: &str) -> String {
    let mut s = String::new();
    for c in code.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if c == ' ' || c == '-' || c == '_' {
            s.push('-');
        }
    }
    if s.is_empty() {
        "sans-bible".to_string()
    } else {
        s
    }
}

/// Étiquette de recueil pour un chant (vide → groupe « Sans recueil »).
fn song_book(s: &Song) -> &str {
    s.songbook_code.as_deref().filter(|s| !s.is_empty()).unwrap_or("Sans recueil")
}

fn projection_state_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("projection_state.json")
}

/// Dossier des médias d'un type donné, au même niveau que `songbooks/` et
/// `bibles/`. L'utilisateur y dépose ses fichiers directement (pas d'import via
/// l'interface).
pub fn media_dir(app: &AppHandle, kind: &str) -> PathBuf {
    let dir = data_dir(app).join(kind);
    let _ = fs::create_dir_all(&dir);
    dir
}

// ─── Seed initial ─────────────────────────────────────────────────────────────

/// Recueils et bibles libres de droits empaquetés dans le build, copiés dans le
/// dossier de données au premier lancement. Le chemin source est relatif au
/// dossier `resources/` du bundle ; la destination est relative à `data_dir`.
const SEED_FILES: &[(&str, &str)] = &[
    ("resources/songbooks/songbook-ref.json", "songbooks/songbook-ref.json"),
    ("resources/songbooks/songbook-hec.json", "songbooks/songbook-hec.json"),
    ("resources/bibles/bible-drb.json", "bibles/bible-drb.json"),
    ("resources/bibles/bible-lsg.json", "bibles/bible-lsg.json"),
];

/// Vrai si le dossier de données contient déjà au moins un recueil ou une bible,
/// signe d'une installation existante (utilisateur antérieur à cette
/// fonctionnalité) qu'il ne faut surtout pas réamorcer.
fn has_existing_data(app: &AppHandle) -> bool {
    !songbook_files(&songbooks_dir(app)).is_empty() || !list_bibles(app).is_empty()
}

/// Copie les recueils et bibles libres de droits empaquetés dans le dossier de
/// données, une seule fois (au premier lancement). Ne fait rien si un marqueur
/// `.seeded` est présent, ou si le dossier contient déjà des recueils/bibles
/// (installation existante) : on évite ainsi d'écraser ou de compléter les
/// données de l'utilisateur. Par sécurité, les fichiers déjà présents ne sont de
/// toute façon jamais écrasés.
pub fn seed_defaults(app: &AppHandle) {
    let marker = data_dir(app).join(".seeded");
    if marker.exists() {
        return;
    }

    // S'assure que les dossiers cibles existent.
    let _ = songbooks_dir(app);
    let _ = bibles_dir(app);

    // Installation existante : on pose le marqueur et on n'amorce rien.
    if has_existing_data(app) {
        let _ = fs::write(&marker, b"");
        return;
    }

    for (res, dest_rel) in SEED_FILES {
        let dest = data_dir(app).join(dest_rel);
        if dest.exists() {
            continue;
        }
        let Ok(src) = app.path().resolve(res, BaseDirectory::Resource) else {
            continue;
        };
        let _ = fs::copy(&src, &dest);
    }

    let _ = fs::write(&marker, b"");
}

// ─── Chants ─────────────────────────────────────────────────────────────────

/// Vrai pour les fichiers cachés (commençant par `.`), notamment les fichiers
/// AppleDouble `._*` créés par macOS, qui ne doivent jamais être traités comme
/// des recueils ou des bibles réels.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Liste les fichiers `<prefix>*.json` d'un dossier, triés par nom.
fn prefixed_json_files(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| !is_hidden(n) && n.starts_with(prefix) && n.ends_with(".json"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Liste les fichiers `songbook-*.json` d'un dossier, triés par nom.
fn songbook_files(dir: &Path) -> Vec<PathBuf> {
    prefixed_json_files(dir, "songbook-")
}

/// Parse un fichier de recueil en acceptant deux formats : le format wrapper
/// actuel (`{ songbook_code, songbook_name, songs: [...] }`) et l'ancien
/// format (tableau de chants nu) encore présent dans les installations
/// existantes.
fn parse_songbook(bytes: &[u8]) -> Result<Songbook, serde_json::Error> {
    match serde_json::from_slice::<Songbook>(bytes) {
        Ok(book) => Ok(book),
        Err(_) => serde_json::from_slice::<Vec<Song>>(bytes).map(|songs| Songbook {
            songbook_code: None,
            songbook_name: None,
            songs,
        }),
    }
}

fn read_songbook_files(files: &[PathBuf]) -> Result<Vec<Song>, String> {
    let mut songs: Vec<Song> = Vec::new();
    // Compteur d'id de session. Les fichiers sont lus dans un ordre déterministe
    // (`songbook_files` trie), donc la même installation reproduit les mêmes id à
    // chaque chargement, ce qui suffit à la stabilité intra-session attendue par
    // `get_song`/`update_song`. Aucun id n'est attendu dans les fichiers.
    let mut next_id: i64 = 0;
    for path in files {
        let bytes = fs::read(path).map_err(|e| format!("Lecture {} : {e}", path.display()))?;
        let book: Songbook =
            parse_songbook(&bytes).map_err(|e| format!("Parse {} : {e}", path.display()))?;
        // Propage le code du recueil (wrapper) vers chaque chant qui ne le porte
        // pas, pour que le filtrage/groupement par code fonctionne. Le nom
        // lisible n'est pas propagé : il se résout via `list_songbooks`.
        for mut s in book.songs {
            s.id = next_id;
            next_id += 1;
            if s.songbook_code.is_none() {
                s.songbook_code = book.songbook_code.clone();
            }
            // Normalise les types de section en mémoire : les anciens codes
            // français restent lisibles même si le fichier n'a pas été migré.
            for v in &mut s.verses {
                v.vtype = canonical_vtype(&v.vtype).to_string();
            }
            songs.push(s);
        }
    }
    Ok(songs)
}

/// Migration de masse : réécrit chaque fichier de recueil dont au moins une
/// section utilise encore un ancien code de type, en le convertissant vers la
/// forme canonique internationale. Les fichiers déjà canoniques ne sont pas
/// touchés. Appelée une fois au démarrage ; les erreurs ponctuelles sont
/// ignorées pour ne jamais empêcher le lancement de l'application.
pub fn migrate_vtypes(app: &AppHandle) {
    let dir = songbooks_dir(app);
    for path in songbook_files(&dir) {
        let Ok(bytes) = fs::read(&path) else { continue };
        let Ok(mut book) = parse_songbook(&bytes) else {
            continue;
        };
        let mut changed = false;
        for song in &mut book.songs {
            for v in &mut song.verses {
                let canon = canonical_vtype(&v.vtype);
                if v.vtype != canon {
                    v.vtype = canon.to_string();
                    changed = true;
                }
            }
        }
        if changed {
            if let Ok(json) = serde_json::to_vec(&book) {
                let _ = write_atomic(&path, &json);
            }
        }
    }
}

pub fn load_songs(app: &AppHandle, state: &AppState) -> Result<Vec<Song>, String> {
    {
        let cache = state.songs.lock().unwrap();
        if let Some(s) = cache.as_ref() {
            return Ok(s.clone());
        }
    }

    // Lecture du dossier `songbooks/` : un fichier par recueil.
    let dir = songbooks_dir(app);
    let files = songbook_files(&dir);
    let songs = read_songbook_files(&files)?;

    *state.songs.lock().unwrap() = Some(songs.clone());
    Ok(songs)
}

pub fn save_songs(app: &AppHandle, state: &AppState, songs: &[Song]) -> Result<(), String> {
    let dir = songbooks_dir(app);

    // Regroupe les chants par recueil, en conservant l'ordre d'arrivée.
    let mut by_book: std::collections::BTreeMap<String, Vec<&Song>> =
        std::collections::BTreeMap::new();
    for s in songs {
        by_book.entry(book_slug(song_book(s))).or_default().push(s);
    }

    // Réécrit chaque fichier de recueil présent, au format wrapper : le code et
    // le nom lisible du recueil en tête, puis les chants. Le nom lisible n'est
    // pas porté par les chants : on le préserve en relisant le wrapper existant.
    let mut written: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (slug, items) in &by_book {
        let fname = format!("songbook-{slug}.json");
        let path = dir.join(&fname);
        let code = items
            .iter()
            .find_map(|s| s.songbook_code.clone())
            .filter(|s| !s.is_empty());
        let existing_name = fs::read(&path)
            .ok()
            .and_then(|b| parse_songbook(&b).ok())
            .and_then(|b| b.songbook_name)
            .filter(|s| !s.is_empty());
        let book = Songbook {
            songbook_code: code,
            songbook_name: existing_name,
            songs: items.iter().map(|s| (*s).clone()).collect(),
        };
        let json = serde_json::to_vec(&book).map_err(|e| format!("Sérialisation : {e}"))?;
        write_atomic(&path, &json)?;
        written.insert(fname);
    }

    // Supprime les fichiers de recueils désormais vides (recueil entièrement vidé).
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("songbook-") && name.ends_with(".json") && !written.contains(&name)
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    *state.songs.lock().unwrap() = Some(songs.to_vec());
    Ok(())
}

// ─── Bibles ─────────────────────────────────────────────────────────────────

pub fn load_bible(app: &AppHandle, state: &AppState, bible_code: &str) -> Result<Bible, String> {
    {
        let cache = state.bibles.lock().unwrap();
        if let Some(b) = cache.get(bible_code) {
            return Ok(b.clone());
        }
    }
    // Nom de fichier canonique `bible-<slug>.json`, cohérent avec les recueils.
    let path = bibles_dir(app).join(format!("bible-{}.json", bible_slug(bible_code)));
    let bytes = fs::read(&path).map_err(|_| format!("Bible « {bible_code} » introuvable"))?;
    let bible: Bible =
        serde_json::from_slice(&bytes).map_err(|e| format!("Parse {bible_code} : {e}"))?;
    state
        .bibles
        .lock()
        .unwrap()
        .insert(bible_code.to_string(), bible.clone());
    Ok(bible)
}

/// Liste les codes des traductions de bible présentes dans le dossier `bibles/`,
/// triés alphabétiquement. Le code provient du champ `bible_code` du fichier (le
/// nom de fichier `bible-<slug>.json` n'est qu'un identifiant cosmétique).
pub fn list_bibles(app: &AppHandle) -> Vec<String> {
    let dir = bibles_dir(app);
    let mut out: Vec<String> = bible_files(&dir)
        .iter()
        .filter_map(|p| bible_code(p))
        .collect();
    out.sort();
    out
}

// ─── Gestion des contenus (ajout / suppression depuis la modale) ─────────────

/// Type de contenu géré par la modale Paramètres → (sous-dossier, extensions
/// autorisées). `songbooks` et `bibles` sont des JSON ; `pdf` et `images` sont
/// des fichiers loose.
fn content_kind(kind: &str) -> Option<(&'static str, &'static [&'static str])> {
    match kind {
        "songbooks" => Some(("songbooks", &[".json"])),
        "bibles" => Some(("bibles", &[".json"])),
        "pdf" => Some(("pdf", &[".pdf"])),
        "images" => Some(("images", &[".jpg", ".jpeg", ".png", ".webp"])),
        _ => None,
    }
}

/// Dossier cible d'un type de contenu (créé au besoin).
fn content_dir(app: &AppHandle, kind: &str) -> PathBuf {
    let dir = data_dir(app).join(kind);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Vide les caches mémoire impactés par un changement de contenu, pour que les
/// listes reflètent l'ajout/suppression au prochain accès.
fn invalidate_caches(state: &AppState, kind: &str) {
    match kind {
        "songbooks" => *state.songs.lock().unwrap() = None,
        "bibles" => state.bibles.lock().unwrap().clear(),
        _ => {}
    }
}

/// Description d'un contenu listé dans la modale.
#[derive(Debug, Clone, Serialize)]
pub struct ContentEntry {
    /// Nom de fichier (identifiant pour la suppression).
    pub filename: String,
    /// Libellé affiché (recueil : nom lisible ; bible : traduction ; sinon le nom).
    pub label: String,
}

/// Liste les contenus d'un type donné pour la modale (triés par libellé).
pub fn list_content(app: &AppHandle, kind: &str) -> Result<Vec<ContentEntry>, String> {
    let (sub, exts) = content_kind(kind).ok_or("Type de contenu invalide")?;
    let dir = content_dir(app, sub);
    let mut out: Vec<ContentEntry> = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_hidden(&name) {
                continue;
            }
            let lower = name.to_lowercase();
            if !exts.iter().any(|e| lower.ends_with(e)) {
                continue;
            }
            let label = match kind {
                "songbooks" => songbook_label(&entry.path()).unwrap_or_else(|| name.clone()),
                "bibles" => bible_label(&entry.path())
                    .or_else(|| bible_code(&entry.path()))
                    .unwrap_or_else(|| name.strip_suffix(".json").unwrap_or(&name).to_string()),
                _ => name.clone(),
            };
            out.push(ContentEntry { filename: name, label });
        }
    }
    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(out)
}

/// Nom lisible d'un recueil : `songbook_name` du wrapper si présent, sinon le
/// code `songbook_code`.
fn songbook_label(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let book = parse_songbook(&bytes).ok()?;
    book.songbook_name
        .or_else(|| book.songbook_code.clone())
        .or_else(|| book.songs.first().and_then(|s| s.songbook_code.clone()))
        .filter(|s| !s.is_empty())
}

/// Nom lisible d'une bible : champ `bible_name` du fichier si présent.
fn bible_label(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let bible: Bible = serde_json::from_slice(&bytes).ok()?;
    bible.bible_name.filter(|s| !s.is_empty())
}

/// Code interne d'une bible (`bible_code` du fichier).
fn bible_code(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let bible: Bible = serde_json::from_slice(&bytes).ok()?;
    Some(bible.bible_code).filter(|s| !s.is_empty())
}

/// Liste les fichiers `bible-*.json` d'un dossier, triés par nom.
fn bible_files(dir: &Path) -> Vec<PathBuf> {
    prefixed_json_files(dir, "bible-")
}

/// Code interne d'un recueil (`songbook_code` du wrapper, ou du premier chant).
fn songbook_code(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let book = parse_songbook(&bytes).ok()?;
    book.songbook_code
        .or_else(|| book.songs.first().and_then(|s| s.songbook_code.clone()))
        .filter(|s| !s.is_empty())
}

/// Code et nom lisible d'un contenu, pour la résolution côté front (filtres,
/// en-têtes, boutons). `name` retombe sur `code` si aucun nom lisible.
#[derive(Debug, Clone, Serialize)]
pub struct ContentName {
    pub code: String,
    pub name: String,
}

/// Recueils présents : `{ code, nom lisible }`, triés par nom.
pub fn list_songbooks(app: &AppHandle) -> Vec<ContentName> {
    let dir = songbooks_dir(app);
    let mut out: Vec<ContentName> = songbook_files(&dir)
        .into_iter()
        .filter_map(|p| {
            let code = songbook_code(&p)?;
            let name = songbook_label(&p).unwrap_or_else(|| code.clone());
            Some(ContentName { code, name })
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Traductions de bible présentes : `{ code, nom lisible }`, triées par nom. Le
/// code provient du champ `bible_code` du fichier, le nom lisible de `bible_name`.
pub fn list_bibles_named(app: &AppHandle) -> Vec<ContentName> {
    let dir = bibles_dir(app);
    let mut out: Vec<ContentName> = bible_files(&dir)
        .into_iter()
        .filter_map(|p| {
            let code = bible_code(&p)?;
            let name = bible_label(&p).unwrap_or_else(|| code.clone());
            Some(ContentName { code, name })
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Importe un fichier (chemin source absolu) dans le sous-dossier du type donné.
/// L'extension doit correspondre au type. Le nom de fichier est assaini ; pour
/// les recueils et les bibles, on génère un nom canonique `songbook-<slug>.json`
/// ou `bible-<slug>.json` d'après le contenu du fichier.
pub fn import_content(
    app: &AppHandle,
    state: &AppState,
    kind: &str,
    source: &str,
) -> Result<(), String> {
    let (sub, exts) = content_kind(kind).ok_or("Type de contenu invalide")?;
    let src = Path::new(source);
    let orig = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Chemin source invalide")?;
    let lower = orig.to_lowercase();
    if !exts.iter().any(|e| lower.ends_with(e)) {
        return Err("Extension de fichier non autorisée".into());
    }

    let dest_name = match kind {
        "songbooks" => {
            // Nom canonique d'après le recueil contenu dans le fichier (cohérent
            // avec le découpage des ressources et `save_songs`).
            let bytes = fs::read(src).map_err(|e| format!("Lecture : {e}"))?;
            let book: Songbook =
                serde_json::from_slice(&bytes).map_err(|e| format!("Recueil invalide : {e}"))?;
            let code = book
                .songbook_code
                .as_deref()
                .or_else(|| book.songs.first().and_then(|s| s.songbook_code.as_deref()))
                .filter(|s| !s.is_empty())
                .unwrap_or("sans-recueil");
            format!("songbook-{}.json", book_slug(code))
        }
        "bibles" => {
            // Nom canonique d'après le code de bible contenu dans le fichier ; le
            // parse valide aussi la structure (évite une traduction illisible).
            let bytes = fs::read(src).map_err(|e| format!("Lecture : {e}"))?;
            let bible: Bible =
                serde_json::from_slice(&bytes).map_err(|e| format!("Bible invalide : {e}"))?;
            format!("bible-{}.json", bible_slug(&bible.bible_code))
        }
        _ => sanitize_filename(orig).ok_or("Nom de fichier invalide")?,
    };

    let dest = content_dir(app, sub).join(&dest_name);
    fs::copy(src, &dest).map_err(|e| format!("Copie : {e}"))?;
    invalidate_caches(state, kind);
    Ok(())
}

/// Supprime un contenu de son sous-dossier (nom de fichier assaini).
pub fn delete_content(
    app: &AppHandle,
    state: &AppState,
    kind: &str,
    filename: &str,
) -> Result<(), String> {
    let (sub, _) = content_kind(kind).ok_or("Type de contenu invalide")?;
    let name = sanitize_filename(filename).ok_or("Nom de fichier invalide")?;
    let path = content_dir(app, sub).join(&name);
    if !path.exists() {
        return Err("Fichier introuvable".into());
    }
    // Soft delete : on archive le fichier en .bak plutôt que de le supprimer,
    // pour pouvoir le restaurer en cas d'erreur.
    let mut backup = path.clone();
    let backup_name = format!(
        "{}.bak",
        path.file_name().and_then(|n| n.to_str()).unwrap_or(&name)
    );
    backup.set_file_name(&backup_name);
    fs::rename(&path, &backup).map_err(|e| format!("Suppression : {e}"))?;
    invalidate_caches(state, kind);
    Ok(())
}

// ─── État de projection ─────────────────────────────────────────────────────

pub fn read_projection_state(app: &AppHandle) -> serde_json::Value {
    let path = projection_state_path(app);
    fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(serde_json::Value::Null)
}

pub fn write_projection_state(app: &AppHandle, state: &serde_json::Value) -> Result<(), String> {
    let path = projection_state_path(app);
    let json = serde_json::to_vec(state).map_err(|e| format!("Sérialisation état : {e}"))?;
    write_atomic(&path, &json)
}

// ─── Helpers fichiers ───────────────────────────────────────────────────────

/// Écriture atomique : écrit dans un fichier temporaire puis renomme.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Écriture : {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Renommage : {e}"))?;
    Ok(())
}

/// Empêche les noms de fichiers d'échapper le dossier (path traversal).
pub fn sanitize_filename(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_str()?.to_string();
    if base.is_empty() || base == "." || base == ".." {
        return None;
    }
    Some(base)
}
