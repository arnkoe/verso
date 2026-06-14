//! Stockage fichiers : tout l'état applicatif vit dans le dossier de données de
//! l'app (app data dir). Pas de base SQLite. Aucune donnée n'est empaquetée dans
//! le build : recueils et bibles sont fournis par l'utilisateur dans son dossier
//! de données.
//!
//! Arborescence (sous app_data_dir) :
//!   songbooks/songbook-<recueil>.json — un fichier par recueil (déposés/édités par l'utilisateur)
//!   bibles/<traduction>.json — une bible par traduction (déposées par l'utilisateur)
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

/// Type de couplet par défaut (strophe) si le champ `type` est absent du JSON,
/// pour éviter qu'un seul couplet mal formé n'empêche le parsing de tout le recueil.
fn default_verse_type() -> String {
    "S".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub source_book: Option<String>,
    #[serde(default)]
    pub source_number: Option<i64>,
    pub verses: Vec<Verse>,
}

/// Vue allégée pour la liste de recherche (sans le corps des strophes).
#[derive(Debug, Clone, Serialize)]
pub struct SongSummary {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub source_book: Option<String>,
    pub source_number: Option<i64>,
    pub verse_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleBook {
    pub name: String,
    /// chapters[c] = versets du chapitre c+1 ; chapters[c][v] = verset v+1.
    pub chapters: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bible {
    pub translation: String,
    pub books: Vec<BibleBook>,
}

// ─── État partagé ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AppState {
    /// Cache des bibles déjà chargées en mémoire (clé = traduction).
    pub bibles: Mutex<std::collections::HashMap<String, Bible>>,
    /// Cache du recueil de chants.
    pub songs: Mutex<Option<Vec<Song>>>,
}

// ─── Chemins ────────────────────────────────────────────────────────────────

/// Dossier de données : un répertoire « Verso » dans les Documents de l'utilisateur,
/// pour qu'il puisse y déposer/éditer recueils et bibles facilement. Repli sur le
/// dossier de données de l'app si les Documents sont indisponibles.
pub fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .document_dir()
        .map(|d| d.join("Verso"))
        .or_else(|_| app.path().app_data_dir())
        .expect("dossier de données indisponible");
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

/// Étiquette de recueil pour un chant (vide → groupe « Sans recueil »).
fn song_book(s: &Song) -> &str {
    s.source_book.as_deref().filter(|s| !s.is_empty()).unwrap_or("Sans recueil")
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

// ─── Chants ─────────────────────────────────────────────────────────────────

/// Liste les fichiers `<prefix>-*.json` d'un dossier, triés par nom.
fn songbook_files(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with(prefix) && n.ends_with(".json"))
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

fn read_songbook_files(files: &[PathBuf]) -> Result<Vec<Song>, String> {
    let mut songs: Vec<Song> = Vec::new();
    for path in files {
        let bytes = fs::read(path).map_err(|e| format!("Lecture {} : {e}", path.display()))?;
        let part: Vec<Song> =
            serde_json::from_slice(&bytes).map_err(|e| format!("Parse {} : {e}", path.display()))?;
        songs.extend(part);
    }
    Ok(songs)
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
    let files = songbook_files(&dir, "songbook-");
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

    // Réécrit chaque fichier de recueil présent.
    let mut written: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (slug, items) in &by_book {
        let fname = format!("songbook-{slug}.json");
        let path = dir.join(&fname);
        let json = serde_json::to_vec(items).map_err(|e| format!("Sérialisation : {e}"))?;
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

pub fn load_bible(app: &AppHandle, state: &AppState, translation: &str) -> Result<Bible, String> {
    {
        let cache = state.bibles.lock().unwrap();
        if let Some(b) = cache.get(translation) {
            return Ok(b.clone());
        }
    }
    // Nom de fichier sécurisé : la traduction sert directement de nom de fichier.
    let fname = sanitize_filename(translation)
        .ok_or_else(|| format!("Traduction « {translation} » invalide"))?;
    let path = bibles_dir(app).join(format!("{fname}.json"));
    let bytes = fs::read(&path).map_err(|_| format!("Traduction « {translation} » introuvable"))?;
    let bible: Bible =
        serde_json::from_slice(&bytes).map_err(|e| format!("Parse {translation} : {e}"))?;
    state
        .bibles
        .lock()
        .unwrap()
        .insert(translation.to_string(), bible.clone());
    Ok(bible)
}

/// Liste les traductions de bible présentes dans le dossier `bibles/`
/// (nom de fichier sans l'extension `.json`), triées alphabétiquement.
pub fn list_bibles(app: &AppHandle) -> Vec<String> {
    let dir = bibles_dir(app);
    let mut out: Vec<String> = fs::read_dir(&dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.strip_suffix(".json").map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
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
