mod bible_search;
mod storage;
mod sync;

use std::fs;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::menu::{
    Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use bible_search::BibleSearchResult;
use storage::{AppState, Song, SongSummary, Verse};

#[derive(Default)]
struct UiState {
    /// Langue courante, nécessaire pour titrer correctement une fenêtre créée
    /// en arrière-plan après la traduction initiale du menu.
    french: std::sync::atomic::AtomicBool,
}

// ─── CHANTS ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_songs(app: AppHandle, state: tauri::State<AppState>) -> Result<Vec<SongSummary>, String> {
    storage::with_songs(&app, &state, |songs| {
        songs
            .iter()
            .map(|s| SongSummary {
                id: s.id,
                title: s.title.clone(),
                author: s.author.clone(),
                songbook_code: s.songbook_code.clone(),
                source_number: s.source_number,
                verse_count: s.verses.len(),
                incipits: s
                    .verses
                    .iter()
                    .filter_map(|v| v.text.lines().next())
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect(),
            })
            .collect()
    })
}

#[tauri::command]
fn get_song(app: AppHandle, state: tauri::State<AppState>, id: i64) -> Result<Song, String> {
    storage::with_songs(&app, &state, |songs| {
        songs.iter().find(|s| s.id == id).cloned()
    })?
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
    bible_code: String,
    books: Vec<String>,
}

#[tauri::command]
fn list_bibles(app: AppHandle) -> Vec<storage::ContentName> {
    storage::list_bibles_named(&app)
}

#[tauri::command]
fn list_songbooks(app: AppHandle) -> Vec<storage::ContentName> {
    storage::list_songbooks(&app)
}

#[tauri::command]
fn bible_books(
    app: AppHandle,
    state: tauri::State<AppState>,
    bible_code: String,
) -> Result<BooksResponse, String> {
    let bible = storage::load_bible(&app, &state, &bible_code)?;
    Ok(BooksResponse {
        bible_code,
        books: bible.books.iter().map(|b| b.name.clone()).collect(),
    })
}

#[tauri::command]
fn bible_search(
    app: AppHandle,
    state: tauri::State<AppState>,
    q: String,
    bible_code: String,
) -> Result<BibleSearchResult, String> {
    let bible = storage::load_bible(&app, &state, &bible_code)?;
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

// ─── GESTION DES CONTENUS (modale Paramètres) ─────────────────────────────────

/// Liste les contenus d'un type (`songbooks`, `bibles`, `pdf`, `images`) pour la
/// modale : nom de fichier + libellé affichable.
#[tauri::command]
fn list_content(app: AppHandle, kind: String) -> Result<Vec<storage::ContentEntry>, String> {
    storage::list_content(&app, &kind)
}

/// Importe un fichier (chemin source absolu) dans le dossier du type donné.
#[tauri::command]
fn import_content(
    app: AppHandle,
    state: tauri::State<AppState>,
    kind: String,
    source: String,
) -> Result<(), String> {
    storage::import_content(&app, &state, &kind, &source)
}

/// Supprime un contenu (par nom de fichier) du dossier du type donné.
#[tauri::command]
fn delete_content(
    app: AppHandle,
    state: tauri::State<AppState>,
    kind: String,
    filename: String,
) -> Result<(), String> {
    storage::delete_content(&app, &state, &kind, &filename)
}

// ─── SYNCHRONISATION ────────────────────────────────────────────────────────

/// Vrai si ce poste est configuré pour la synchronisation des recueils
/// (présence de `sync.json`). L'UI s'en sert pour afficher ou masquer le bloc
/// de synchronisation : seuls les superutilisateurs configurés le voient.
#[tauri::command]
fn sync_status(app: AppHandle) -> bool {
    sync::is_configured(&app)
}

/// Récupère la dernière version distante des recueils et l'applique localement
/// (invalide le cache). L'UI recharge ensuite la liste des chants.
#[tauri::command]
fn sync_pull(app: AppHandle, state: tauri::State<AppState>) -> Result<String, String> {
    sync::pull(&app, &state)
}

/// Publie l'état local des recueils vers le dépôt de données.
#[tauri::command]
fn sync_push(app: AppHandle) -> Result<String, String> {
    sync::push(&app)
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
    /// Vrai si l'écran est une dalle intégrée (laptop) sans nom de modèle
    /// exposé par l'OS : le front affiche alors « Écran intégré ».
    is_internal: bool,
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

/// Info écran résolue côté Windows pour un nom GDI donné.
#[cfg(target_os = "windows")]
#[derive(Default, Clone)]
struct WinMonitor {
    /// Nom lisible (marque/modèle issu de l'EDID), vide si indisponible.
    name: String,
    /// Vrai si la sortie est une dalle intégrée (laptop) : Windows ne fournit
    /// alors pas de `monitorFriendlyDeviceName`. Le front affiche « Écran
    /// intégré » plutôt que le repli numéroté.
    internal: bool,
}

/// Windows : map nom GDI ("\\.\DISPLAY<N>") -> info écran (nom lisible + interne).
///
/// tao renvoie sur Windows le nom GDI (`szDevice`, ex. "\\.\DISPLAY1"). Le nom
/// lisible (issu de l'EDID, ex. "DELL U2419H") n'est exposé que par l'API
/// DisplayConfig. On énumère les chemins d'affichage actifs ; pour chacun on
/// demande le nom source (`viewGdiDeviceName` == le `szDevice` de tao) puis le
/// nom cible (`monitorFriendlyDeviceName`), et on associe les deux. La jointure
/// se fait donc sur exactement la chaîne que tao a utilisée. Les dalles
/// intégrées (laptop) n'ont pas de nom convivial : on les repère via
/// `outputTechnology == INTERNAL` pour que le front affiche « Écran intégré ».
#[cfg(target_os = "windows")]
fn windows_names_by_gdi() -> std::collections::HashMap<String, WinMonitor> {
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL, DISPLAYCONFIG_PATH_INFO,
        DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::ERROR_SUCCESS;

    let mut map = std::collections::HashMap::new();

    let mut path_count: u32 = 0;
    let mut mode_count: u32 = 0;
    // SAFETY : appels FFI ; les pointeurs proviennent de vecteurs dimensionnés
    // par GetDisplayConfigBufferSizes juste avant.
    unsafe {
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != ERROR_SUCCESS
        {
            return map;
        }

        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];

        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        ) != ERROR_SUCCESS
        {
            return map;
        }

        for path in paths.iter().take(path_count as usize) {
            // Nom GDI de la source ("\\.\DISPLAY<N>").
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != ERROR_SUCCESS.0 as i32 {
                continue;
            }
            let gdi = wchar_to_string(&source.viewGdiDeviceName);
            let gdi = gdi.trim().to_string();
            if gdi.is_empty() {
                continue;
            }

            // Nom lisible de la cible (marque/modèle issus de l'EDID).
            let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            target.header.adapterId = path.targetInfo.adapterId;
            target.header.id = path.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut target.header) != ERROR_SUCCESS.0 as i32 {
                continue;
            }
            let friendly = wchar_to_string(&target.monitorFriendlyDeviceName);
            let friendly = friendly.trim().to_string();
            let internal = target.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL;
            map.insert(
                gdi,
                WinMonitor {
                    name: friendly,
                    internal,
                },
            );
        }
    }

    map
}

/// Convertit un tableau wchar terminé par NUL en String.
#[cfg(target_os = "windows")]
fn wchar_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
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

    #[cfg(target_os = "windows")]
    let names = windows_names_by_gdi();

    Ok(monitors
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary_pos.map_or(false, |p| p == *pos);
            let raw = m.name().cloned().unwrap_or_else(|| "Écran".into());

            // Sur macOS, remplace "Monitor #<N>" par le nom lisible si trouvé.
            #[cfg(target_os = "macos")]
            let (name, is_internal) = (
                parse_model_number(&raw)
                    .and_then(|n| names.get(&n).cloned())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(raw),
                false,
            );
            // Sur Windows, remplace le nom GDI ("\\.\DISPLAY<N>") par le nom
            // lisible (marque/modèle) si trouvé. Sinon, on renvoie une chaîne
            // vide plutôt que le nom GDI brut : le front affiche alors « Écran
            // intégré » (dalle laptop) ou le repli numéroté « Écran N ».
            #[cfg(target_os = "windows")]
            let (name, is_internal) = {
                let matched = names.get(raw.trim()).cloned().unwrap_or_default();
                (matched.name, matched.internal)
            };
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let (name, is_internal) = (raw, false);

            MonitorInfo {
                name,
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                is_primary,
                is_internal,
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

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ─── MENU & FENÊTRES SECONDAIRES ───────────────────────────────────────────

const APP_SUBMENU_ID: &str = "verso-app-menu";
const FILE_SUBMENU_ID: &str = "verso-file-menu";
const EDIT_SUBMENU_ID: &str = "verso-edit-menu";
const VIEW_SUBMENU_ID: &str = "verso-view-menu";
const MENU_SETTINGS: &str = "settings";
const MENU_SHORTCUTS: &str = "shortcuts";
const MENU_ABOUT: &str = "about-verso";
const MENU_ABOUT_HELP: &str = "about-verso-help";

/// Construit explicitement le menu natif pour que tous ses titres suivent la
/// langue choisie dans Verso. Les commandes système restent des éléments
/// prédéfinis Tauri et conservent donc leurs raccourcis et comportements natifs.
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Réglages…", true, Some("CmdOrCtrl+,"))?;
    let shortcuts = MenuItem::with_id(
        app,
        MENU_SHORTCUTS,
        "Raccourcis clavier",
        true,
        None::<&str>,
    )?;
    #[cfg(target_os = "macos")]
    let app_about =
        MenuItem::with_id(app, MENU_ABOUT, "À propos de Verso", true, None::<&str>)?;
    let help_about = MenuItem::with_id(
        app,
        MENU_ABOUT_HELP,
        "À propos de Verso",
        true,
        None::<&str>,
    )?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_id_and_items(
        app,
        APP_SUBMENU_ID,
        "Verso",
        true,
        &[
            &app_about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let file_menu = Submenu::with_id_and_items(
        app,
        FILE_SUBMENU_ID,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;

    #[cfg(target_os = "windows")]
    let file_menu = Submenu::with_id_and_items(
        app,
        FILE_SUBMENU_ID,
        "File",
        true,
        &[
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_id_and_items(
        app,
        EDIT_SUBMENU_ID,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let view_menu = Submenu::with_id_and_items(
        app,
        VIEW_SUBMENU_ID,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &help_about,
        ],
    )?;

    #[cfg(target_os = "windows")]
    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &help_about,
        ],
    )?;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let help_menu = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &help_about,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &app_menu,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            &file_menu,
            &edit_menu,
            #[cfg(target_os = "macos")]
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

#[derive(Clone, Copy)]
enum AuxiliaryKind {
    Settings,
    Shortcuts,
    About,
}

impl AuxiliaryKind {
    fn from_mode(mode: &str) -> Option<Self> {
        match mode {
            "settings" => Some(Self::Settings),
            "shortcuts" => Some(Self::Shortcuts),
            "about" => Some(Self::About),
            _ => None,
        }
    }

    fn mode(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::Shortcuts => "shortcuts",
            Self::About => "about",
        }
    }
}

struct AuxiliarySpec {
    title: &'static str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    resizable: bool,
}

fn auxiliary_spec(kind: AuxiliaryKind, french: bool) -> AuxiliarySpec {
    match kind {
        AuxiliaryKind::Settings => AuxiliarySpec {
            title: if french { "Réglages" } else { "Settings" },
            width: 680.0,
            height: 720.0,
            min_width: 560.0,
            min_height: 520.0,
            resizable: true,
        },
        AuxiliaryKind::Shortcuts => AuxiliarySpec {
            title: if french {
                "Raccourcis clavier"
            } else {
                "Keyboard Shortcuts"
            },
            width: 620.0,
            height: 720.0,
            min_width: 540.0,
            min_height: 480.0,
            resizable: true,
        },
        AuxiliaryKind::About => AuxiliarySpec {
            title: if french {
                "À propos de Verso"
            } else {
                "About Verso"
            },
            width: 440.0,
            height: 300.0,
            min_width: 440.0,
            min_height: 300.0,
            resizable: false,
        },
    }
}

/// Construit au plus une fois chaque fenêtre utilitaire. La page dédiée ne
/// charge aucun des contenus lourds de l'opérateur.
fn ensure_auxiliary_window(
    app: &AppHandle,
    kind: AuxiliaryKind,
    visible: bool,
) -> tauri::Result<tauri::WebviewWindow> {
    let label = kind.mode();
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }

    let french = app.state::<UiState>().french.load(Ordering::Relaxed);
    let spec = auxiliary_spec(kind, french);
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("utility.html?window={label}").into()),
    )
    .title(spec.title)
    .inner_size(spec.width, spec.height)
    .min_inner_size(spec.min_width, spec.min_height)
    .resizable(spec.resizable)
    .visible(visible)
    .focused(visible)
    .center()
    .build()
}

/// Préchauffe une fenêtre en arrière-plan après le chargement de l'opérateur.
#[tauri::command]
fn warm_auxiliary_window(app: AppHandle, mode: String) -> Result<(), String> {
    let kind = AuxiliaryKind::from_mode(&mode)
        .ok_or_else(|| format!("Fenêtre utilitaire inconnue : {mode}"))?;
    ensure_auxiliary_window(&app, kind, false)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Affiche une instance déjà préchauffée, ou la construit au premier usage si
/// l'utilisateur ouvre le menu avant la fin du préchauffage.
fn open_auxiliary_window(app: &AppHandle, kind: AuxiliaryKind) -> tauri::Result<()> {
    let window = ensure_auxiliary_window(app, kind, true)?;
    window.emit("utility-opened", kind.mode())?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

fn set_predefined_text(
    submenu: &Submenu<tauri::Wry>,
    position: usize,
    text: &str,
) -> Result<(), String> {
    if let Some(MenuItemKind::Predefined(item)) = submenu
        .items()
        .map_err(|e| e.to_string())?
        .into_iter()
        .nth(position)
    {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Aligne les commandes ajoutées au menu natif et les titres des fenêtres sur
/// la langue choisie dans l'interface web.
#[tauri::command]
fn set_menu_language(
    app: AppHandle,
    state: tauri::State<UiState>,
    lang: String,
) -> Result<(), String> {
    let french = lang == "fr";
    state.french.store(french, Ordering::Relaxed);
    let settings_text = if french {
        "Réglages…"
    } else {
        "Settings…"
    };
    let shortcuts_text = if french {
        "Raccourcis clavier"
    } else {
        "Keyboard Shortcuts"
    };
    let about_text = if french {
        "À propos de Verso"
    } else {
        "About Verso"
    };

    if let Some(menu) = app.menu() {
        let submenu_titles = [
            (FILE_SUBMENU_ID, if french { "Fichier" } else { "File" }),
            (EDIT_SUBMENU_ID, if french { "Édition" } else { "Edit" }),
            (
                VIEW_SUBMENU_ID,
                if french { "Présentation" } else { "View" },
            ),
            (
                WINDOW_SUBMENU_ID,
                if french { "Fenêtre" } else { "Window" },
            ),
            (HELP_SUBMENU_ID, if french { "Aide" } else { "Help" }),
        ];
        for (id, title) in submenu_titles {
            if let Some(MenuItemKind::Submenu(submenu)) = menu.get(id) {
                submenu.set_text(title).map_err(|e| e.to_string())?;
            }
        }

        for item in menu.items().map_err(|e| e.to_string())? {
            let MenuItemKind::Submenu(submenu) = item else {
                continue;
            };
            if let Some(MenuItemKind::MenuItem(item)) = submenu.get(MENU_SETTINGS) {
                item.set_text(settings_text).map_err(|e| e.to_string())?;
            }
            if let Some(MenuItemKind::MenuItem(item)) = submenu.get(MENU_SHORTCUTS) {
                item.set_text(shortcuts_text).map_err(|e| e.to_string())?;
            }
            if let Some(MenuItemKind::MenuItem(item)) = submenu.get(MENU_ABOUT) {
                item.set_text(about_text).map_err(|e| e.to_string())?;
            }
            if let Some(MenuItemKind::MenuItem(item)) = submenu.get(MENU_ABOUT_HELP) {
                item.set_text(about_text).map_err(|e| e.to_string())?;
            }
        }

        #[cfg(target_os = "macos")]
        if let Some(MenuItemKind::Submenu(app_menu)) = menu.get(APP_SUBMENU_ID) {
            set_predefined_text(&app_menu, 4, "Services")?;
            set_predefined_text(
                &app_menu,
                6,
                if french { "Masquer Verso" } else { "Hide Verso" },
            )?;
            set_predefined_text(
                &app_menu,
                7,
                if french { "Masquer les autres" } else { "Hide Others" },
            )?;
            set_predefined_text(
                &app_menu,
                8,
                if french { "Tout afficher" } else { "Show All" },
            )?;
            set_predefined_text(
                &app_menu,
                10,
                if french { "Quitter Verso" } else { "Quit Verso" },
            )?;
        }

        if let Some(MenuItemKind::Submenu(file_menu)) = menu.get(FILE_SUBMENU_ID) {
            #[cfg(target_os = "macos")]
            set_predefined_text(
                &file_menu,
                0,
                if french { "Fermer la fenêtre" } else { "Close Window" },
            )?;

            #[cfg(target_os = "windows")]
            {
                set_predefined_text(
                    &file_menu,
                    2,
                    if french { "Fermer la fenêtre" } else { "Close Window" },
                )?;
                set_predefined_text(
                    &file_menu,
                    3,
                    if french { "Quitter Verso" } else { "Exit Verso" },
                )?;
            }
        }

        if let Some(MenuItemKind::Submenu(edit_menu)) = menu.get(EDIT_SUBMENU_ID) {
            let labels = if french {
                [
                    (0, "Annuler"),
                    (1, "Rétablir"),
                    (3, "Couper"),
                    (4, "Copier"),
                    (5, "Coller"),
                    (6, "Tout sélectionner"),
                ]
            } else {
                [
                    (0, "Undo"),
                    (1, "Redo"),
                    (3, "Cut"),
                    (4, "Copy"),
                    (5, "Paste"),
                    (6, "Select All"),
                ]
            };
            for (position, label) in labels {
                set_predefined_text(&edit_menu, position, label)?;
            }
        }

        #[cfg(target_os = "macos")]
        if let Some(MenuItemKind::Submenu(view_menu)) = menu.get(VIEW_SUBMENU_ID) {
            set_predefined_text(
                &view_menu,
                0,
                if french {
                    "Activer le mode plein écran"
                } else {
                    "Enter Full Screen"
                },
            )?;
        }

        if let Some(MenuItemKind::Submenu(window_menu)) = menu.get(WINDOW_SUBMENU_ID) {
            set_predefined_text(
                &window_menu,
                0,
                if french { "Réduire" } else { "Minimize" },
            )?;
            set_predefined_text(
                &window_menu,
                1,
                if french {
                    #[cfg(target_os = "macos")]
                    {
                        "Zoom"
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        "Agrandir"
                    }
                } else {
                    #[cfg(target_os = "macos")]
                    {
                        "Zoom"
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        "Maximize"
                    }
                },
            )?;
            set_predefined_text(
                &window_menu,
                3,
                if french { "Fermer la fenêtre" } else { "Close Window" },
            )?;
        }
    }

    if let Some(window) = app.get_webview_window("settings") {
        window
            .set_title(if french { "Réglages" } else { "Settings" })
            .map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("shortcuts") {
        window
            .set_title(shortcuts_text)
            .map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("about") {
        window.set_title(about_text).map_err(|e| e.to_string())?;
    }

    app.emit("language-changed", &lang)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ─── ENTRÉE ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(UiState::default())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            if event.id() == MENU_SETTINGS {
                let _ = open_auxiliary_window(app, AuxiliaryKind::Settings);
            } else if event.id() == MENU_SHORTCUTS {
                let _ = open_auxiliary_window(app, AuxiliaryKind::Shortcuts);
            } else if event.id() == MENU_ABOUT || event.id() == MENU_ABOUT_HELP {
                let _ = open_auxiliary_window(app, AuxiliaryKind::About);
            }
        })
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
            list_songbooks,
            bible_books,
            bible_search,
            list_pdfs,
            list_images,
            list_content,
            import_content,
            delete_content,
            sync_status,
            sync_pull,
            sync_push,
            reveal_verso_dir,
            media_path,
            get_projection_state,
            set_projection_state,
            list_monitors,
            open_projection,
            app_version,
            set_menu_language,
            warm_auxiliary_window,
        ])
        // Les fenêtres utilitaires restent chargées quand l'utilisateur les
        // ferme : une réouverture n'est alors qu'un show(). La fermeture de
        // l'opérateur les détruit explicitement afin que l'application quitte.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "operator" {
                    for label in ["projection", "settings", "shortcuts", "about"] {
                        if let Some(other) = window.app_handle().get_webview_window(label) {
                            let _ = other.destroy();
                        }
                    }
                } else if matches!(window.label(), "settings" | "shortcuts" | "about") {
                    api.prevent_close();
                    let _ = window.emit("utility-closing", window.label());
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Verso");
}
