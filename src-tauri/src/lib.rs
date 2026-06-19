mod bible_search;
mod storage;

use std::fs;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use bible_search::BibleSearchResult;
use storage::{AppState, Song, SongSummary, Verse};

// ─── CHANTS ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_songs(app: AppHandle, state: tauri::State<AppState>) -> Result<Vec<SongSummary>, String> {
    let songs = storage::load_songs(&app, &state)?;
    Ok(songs
        .iter()
        .map(|s| SongSummary {
            id: s.id,
            title: s.title.clone(),
            author: s.author.clone(),
            source_book: s.source_book.clone(),
            source_number: s.source_number,
            verse_count: s.verses.len(),
        })
        .collect())
}

#[tauri::command]
fn get_song(app: AppHandle, state: tauri::State<AppState>, id: i64) -> Result<Song, String> {
    let songs = storage::load_songs(&app, &state)?;
    songs
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Cantique introuvable".into())
}

#[tauri::command]
fn update_song(
    app: AppHandle,
    state: tauri::State<AppState>,
    id: i64,
    verses: Vec<Verse>,
) -> Result<Song, String> {
    if verses.is_empty() {
        return Err("Le chant doit avoir au moins une strophe.".into());
    }
    let mut songs = storage::load_songs(&app, &state)?;
    let song = songs
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| "Cantique introuvable".to_string())?;
    song.verses = verses;
    let updated = song.clone();
    storage::save_songs(&app, &state, &songs)?;
    Ok(updated)
}

// ─── BIBLE ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct BooksResponse {
    translation: String,
    books: Vec<String>,
}

#[tauri::command]
fn list_bibles(app: AppHandle) -> Vec<String> {
    storage::list_bibles(&app)
}

#[tauri::command]
fn bible_books(
    app: AppHandle,
    state: tauri::State<AppState>,
    translation: String,
) -> Result<BooksResponse, String> {
    let bible = storage::load_bible(&app, &state, &translation)?;
    Ok(BooksResponse {
        translation,
        books: bible.books.iter().map(|b| b.name.clone()).collect(),
    })
}

#[tauri::command]
fn bible_search(
    app: AppHandle,
    state: tauri::State<AppState>,
    q: String,
    translation: String,
) -> Result<BibleSearchResult, String> {
    let bible = storage::load_bible(&app, &state, &translation)?;
    bible_search::search(&bible, &q)
}

// ─── PDF & IMAGES ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct FileEntry {
    filename: String,
}

fn list_uploads(app: &AppHandle, kind: &str, exts: &[&str]) -> Vec<FileEntry> {
    let dir = storage::media_dir(app, kind);
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ext_ok = exts.iter().any(|e| name.to_lowercase().ends_with(e));
            if ext_ok {
                out.push(FileEntry { filename: name });
            }
        }
    }
    out.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    out
}

#[tauri::command]
fn list_pdfs(app: AppHandle) -> Vec<FileEntry> {
    list_uploads(&app, "pdf", &[".pdf"])
}

#[tauri::command]
fn list_images(app: AppHandle) -> Vec<FileEntry> {
    list_uploads(&app, "images", &[".jpg", ".jpeg", ".png", ".webp"])
}

/// Ouvre un dossier dans le gestionnaire de fichiers natif.
fn open_dir(path: &std::path::Path) -> Result<(), String> {
    let path = path.as_os_str();

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(path);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path);
        c
    };

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Ouverture du dossier échouée : {e}"))
}

/// Ouvre le dossier Verso (racine des données : recueils, bibles, médias) dans
/// le gestionnaire de fichiers natif.
#[tauri::command]
fn reveal_verso_dir(app: AppHandle) -> Result<(), String> {
    open_dir(&storage::data_dir(&app))
}

/// Chemin absolu d'un média, pour `convertFileSrc` (asset:// protocol).
#[tauri::command]
fn media_path(app: AppHandle, kind: String, filename: String) -> Result<String, String> {
    if kind != "pdf" && kind != "images" {
        return Err("Type de média invalide".into());
    }
    let name = storage::sanitize_filename(&filename).ok_or("Nom invalide")?;
    let exts: &[&str] = match kind.as_str() {
        "pdf" => &[".pdf"],
        _ => &[".jpg", ".jpeg", ".png", ".webp"],
    };
    let lower = name.to_lowercase();
    if !exts.iter().any(|e| lower.ends_with(e)) {
        return Err("Extension de fichier non autorisée".into());
    }
    let path = storage::media_dir(&app, &kind).join(name);
    if !path.exists() {
        return Err("Fichier introuvable".into());
    }
    Ok(path.to_string_lossy().to_string())
}

// ─── PROJECTION ─────────────────────────────────────────────────────────────

/// État de projection : lu par la fenêtre projection à son ouverture (reprise).
#[tauri::command]
fn get_projection_state(app: AppHandle) -> serde_json::Value {
    storage::read_projection_state(&app)
}

/// Pousse un nouvel état : persiste sur disque + émet l'event vers la projection.
/// Remplace le BroadcastChannel de la version web.
#[tauri::command]
fn set_projection_state(app: AppHandle, payload: serde_json::Value) -> Result<(), String> {
    storage::write_projection_state(&app, &payload)?;
    // Émet vers toutes les fenêtres (la projection écoute "projection-update").
    app.emit("projection-update", &payload)
        .map_err(|e| format!("Émission event : {e}"))?;
    Ok(())
}

#[derive(Serialize, Clone)]
struct MonitorInfo {
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
    scale: f64,
}

/// macOS : map `model_number` -> nom lisible (marque/modèle) via NSScreen.
///
/// tao (le backend fenêtre de Tauri) ne nous transmet que la chaîne
/// "Monitor #<N>", où N = `CGDisplayModelNumber(displayID)` (cf. tao
/// platform_impl/macos/monitor.rs). Tauri jette le `CGDirectDisplayID`, donc on
/// ne peut pas joindre par l'ID. On recompose ici, pour chaque NSScreen, le même
/// N (NSScreen -> NSScreenNumber = displayID -> CGDisplayModelNumber) et on
/// l'associe au `localizedName`. La jointure utilise donc exactement la valeur
/// que tao a utilisée pour fabriquer la chaîne : elle ne peut pas diverger.
/// Doit s'exécuter sur le thread principal (NSScreen.screens l'exige).
#[cfg(target_os = "macos")]
fn macos_names_by_model(app: &AppHandle) -> std::collections::HashMap<u32, String> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();
    // run_on_main_thread garantit l'accès UI thread-safe.
    let _ = app.run_on_main_thread(move || {
        use objc2_app_kit::NSScreen;
        use objc2_core_graphics::CGDisplayModelNumber;
        use objc2_foundation::{ns_string, MainThreadMarker, NSNumber};

        let mut map = std::collections::HashMap::new();
        // run_on_main_thread nous place bien sur le thread principal.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        for screen in NSScreen::screens(mtm).iter() {
            let desc = screen.deviceDescription();
            let Some(obj) = desc.objectForKey(ns_string!("NSScreenNumber")) else {
                continue;
            };
            let Ok(num) = obj.downcast::<NSNumber>() else { continue };
            let display_id = num.unsignedIntValue();
            // Même calcul que tao pour reconstruire le "Monitor #<N>".
            let model = CGDisplayModelNumber(display_id);
            map.insert(model, screen.localizedName().to_string());
        }
        let _ = tx.send(map);
    });
    rx.recv().unwrap_or_default()
}

/// Extrait le model_number du nom tao ("Monitor #<N>").
#[cfg(target_os = "macos")]
fn parse_model_number(tao_name: &str) -> Option<u32> {
    tao_name.rsplit('#').next()?.trim().parse().ok()
}

/// Liste les écrans disponibles (remplace getScreenDetails du web).
#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let win = app
        .get_webview_window("operator")
        .ok_or("Fenêtre opérateur introuvable")?;
    let monitors = win.available_monitors().map_err(|e| e.to_string())?;
    let primary = win.primary_monitor().map_err(|e| e.to_string())?;
    let primary_pos = primary.as_ref().map(|m| *m.position());

    #[cfg(target_os = "macos")]
    let names = macos_names_by_model(&app);

    Ok(monitors
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary_pos.map_or(false, |p| p == *pos);
            let raw = m.name().cloned().unwrap_or_else(|| "Écran".into());

            // Sur macOS, remplace "Monitor #<N>" par le nom lisible si trouvé.
            #[cfg(target_os = "macos")]
            let name = parse_model_number(&raw)
                .and_then(|n| names.get(&n).cloned())
                .filter(|s| !s.is_empty())
                .unwrap_or(raw);
            #[cfg(not(target_os = "macos"))]
            let name = raw;

            MonitorInfo {
                name,
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                is_primary,
                scale: m.scale_factor(),
            }
        })
        .collect())
}

/// Ouvre (ou recrée) la fenêtre de projection sur un écran donné, en plein écran.
/// `x`/`y` sont la position physique du coin haut-gauche de l'écran cible.
#[tauri::command]
async fn open_projection(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    use tauri::{PhysicalPosition, PhysicalSize};

    // Toujours en plein écran « sans bordure » (voir ci-dessous).
    // Si une projection existe déjà sur l'écran cible, on la réutilise : cela
    // évite la course entre close() (asynchrone côté OS) et build() qui peut
    // laisser une fenêtre fantôme ou échouer car le label « projection » est
    // déjà pris. En revanche, déplacer une fenêtre borderless plein-écran vers
    // un AUTRE écran est peu fiable sur macOS (la fenêtre reste collée à son
    // écran d'origine) : dans ce cas on ferme et on recrée sur le bon écran.
    if let Some(existing) = app.get_webview_window("projection") {
        let same_screen = existing
            .outer_position()
            .map(|p| p.x == x && p.y == y)
            .unwrap_or(false);
        if same_screen {
            let _ = existing.set_size(PhysicalSize::new(width, height));
            let _ = existing.set_focus();
            return Ok(());
        }
        let _ = existing.close();
        // Laisse l'OS détruire la fenêtre avant de réutiliser le label.
        for _ in 0..50 {
            if app.get_webview_window("projection").is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    let win = WebviewWindowBuilder::new(
        &app,
        "projection",
        WebviewUrl::App("projection.html".into()),
    )
    .title("Verso — Projection")
    .position(x as f64, y as f64)
    .inner_size(width as f64, height as f64)
    .decorations(false)
    .resizable(false)
    .build()
    .map_err(|e| format!("Création fenêtre projection : {e}"))?;

    // Plein écran « sans bordure » : on couvre exactement l'écran cible (position et
    // taille en pixels PHYSIQUES) au lieu du plein écran natif macOS. Le plein écran
    // natif crée un espace dédié et intercepte Échap (sortie de plein écran) avant le
    // JS ; en mode sans bordure, Échap déclenche bien la fermeture côté projection.
    // (set_position/set_size répétés : certains WM ignorent la valeur au build.)
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_size(PhysicalSize::new(width, height));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_focus();
    Ok(())
}

// ─── VERSION ────────────────────────────────────────────────────────────────

/// Version courante de l'application (affichée en bas à droite de l'opérateur).
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ─── ENTRÉE ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            // Premier lancement : dépose les recueils et bibles libres de droits
            // empaquetés dans le dossier de données de l'utilisateur.
            storage::seed_defaults(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_songs,
            get_song,
            update_song,
            list_bibles,
            bible_books,
            bible_search,
            list_pdfs,
            list_images,
            reveal_verso_dir,
            media_path,
            get_projection_state,
            set_projection_state,
            list_monitors,
            open_projection,
            app_version,
        ])
        // Fermer la fenêtre opérateur ferme aussi la projection : on évite une
        // projection « zombie » qui survivrait au processus et donnerait une
        // seconde fenêtre au prochain lancement de l'application.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && window.label() == "operator"
            {
                if let Some(proj) = window.app_handle().get_webview_window("projection") {
                    let _ = proj.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Verso");
}
