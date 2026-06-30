mod bible_search;
mod storage;
mod sync;

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

/// Windows : map nom GDI ("\\.\DISPLAY<N>") -> nom lisible (marque/modèle).
///
/// tao renvoie sur Windows le nom GDI (`szDevice`, ex. "\\.\DISPLAY1"). Le nom
/// lisible (issu de l'EDID, ex. "DELL U2419H") n'est exposé que par l'API
/// DisplayConfig. On énumère les chemins d'affichage actifs ; pour chacun on
/// demande le nom source (`viewGdiDeviceName` == le `szDevice` de tao) puis le
/// nom cible (`monitorFriendlyDeviceName`), et on associe les deux. La jointure
/// se fait donc sur exactement la chaîne que tao a utilisée.
#[cfg(target_os = "windows")]
fn windows_names_by_gdi() -> std::collections::HashMap<String, String> {
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
        DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
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
            if !friendly.is_empty() {
                map.insert(gdi, friendly);
            }
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
            let name = parse_model_number(&raw)
                .and_then(|n| names.get(&n).cloned())
                .filter(|s| !s.is_empty())
                .unwrap_or(raw);
            // Sur Windows, remplace le nom GDI ("\\.\DISPLAY<N>") par le nom
            // lisible (marque/modèle) si trouvé.
            #[cfg(target_os = "windows")]
            let name = names.get(&raw).cloned().unwrap_or(raw);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Migration ponctuelle : recopie le contenu des anciennes versions
            // (Documents/Verso) vers le dossier de données actuel, avant tout
            // amorçage, pour que seed_defaults voie les données existantes.
            storage::migrate_from_documents(app.handle());
            // Premier lancement : dépose les recueils et bibles libres de droits
            // empaquetés dans le dossier de données de l'utilisateur.
            storage::seed_defaults(app.handle());
            // Migre une fois les anciens codes de section français (S/R/P/I/O)
            // vers la forme canonique internationale (verse/chorus/bridge...).
            storage::migrate_vtypes(app.handle());
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
