//! Synchronisation des recueils entre superutilisateurs via un dépôt Git de
//! données (https://github.com/arnkoe/verso-songbooks). Ce dépôt est aussi la
//! source des seeds du build (submodule `src-tauri/resources/songbooks`).
//!
//! Modèle « superutilisateur » : un poste participe à la sync uniquement s'il
//! possède un fichier `sync.json` dans son dossier de données. Les autres postes
//! éditent librement en local sans jamais publier.
//!
//! Stratégie de conflit : « dernier qui écrit gagne ». On ne tente aucune fusion
//! ligne à ligne : un `pull` écrase le clone local sur `origin/<branche>`, un
//! `push` ré-applique l'état local par-dessus la dernière version distante.
//!
//! Accès Git : on appelle le binaire `git` du système (pas de lib embarquée).
//! L'URL est en HTTPS et les identifiants sont gérés par le credential helper du
//! système (Git Credential Manager sous Windows, trousseau sous macOS) : l'app
//! ne stocke jamais de secret. `git` doit être présent dans le PATH.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// Les pulls et pushes utilisent le même clone Git. Leur travail s'exécute sur
/// des threads dédiés, mais leurs accès au dépôt doivent rester sérialisés.
static SYNC_LOCK: Mutex<()> = Mutex::new(());

/// Crée une `Command` qui n'ouvre pas de fenêtre console sur Windows. Sans le
/// flag `CREATE_NO_WINDOW`, chaque appel à `git`/`hostname` fait clignoter une
/// fenêtre `cmd` au démarrage en mode superutilisateur.
fn command(program: &str) -> Command {
    let cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = cmd;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        cmd
    }
}

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::storage::{self, AppState};

/// Configuration de sync, lue depuis `sync.json` dans le dossier de données.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// URL HTTPS du dépôt de données (ex. `https://github.com/arnkoe/verso-songbooks.git`).
    pub repo_url: String,
    /// Branche à synchroniser ; `main` par défaut.
    #[serde(default)]
    pub branch: Option<String>,
}

impl SyncConfig {
    fn branch(&self) -> &str {
        self.branch.as_deref().filter(|b| !b.is_empty()).unwrap_or("main")
    }
}

/// Chemin du fichier de configuration de sync.
fn config_path(app: &AppHandle) -> PathBuf {
    storage::data_dir(app).join("sync.json")
}

/// Clone local du dépôt de données, géré par l'app (distinct du dossier
/// `songbooks/` qui reste la source de vérité éditée par l'utilisateur).
fn clone_dir(app: &AppHandle) -> PathBuf {
    storage::data_dir(app).join("sync-repo")
}

/// Vrai si ce poste est configuré pour la synchronisation (présence de `sync.json`).
pub fn is_configured(app: &AppHandle) -> bool {
    config_path(app).exists()
}

/// Lit la configuration de sync. `None` si le fichier est absent (poste non
/// superutilisateur) ; `Err` si le fichier est présent mais illisible/malformé.
fn read_config(app: &AppHandle) -> Result<Option<SyncConfig>, String> {
    let path = config_path(app);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("Lecture de sync.json : {e}"))?;
    let cfg: SyncConfig =
        serde_json::from_slice(&bytes).map_err(|e| format!("sync.json invalide : {e}"))?;
    if cfg.repo_url.trim().is_empty() {
        return Err("sync.json : repo_url est vide".into());
    }
    Ok(Some(cfg))
}

fn require_config(app: &AppHandle) -> Result<SyncConfig, String> {
    read_config(app)?.ok_or_else(|| "Synchronisation non configurée (sync.json absent)".into())
}

/// Exécute une commande `git` dans `cwd` et renvoie sa sortie standard en cas de
/// succès, ou un message d'erreur incluant stderr en cas d'échec. Un message
/// dédié est renvoyé si `git` est introuvable dans le PATH.
fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = command("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "git est introuvable. Installez Git et vérifiez qu'il est dans le PATH.".to_string()
            } else {
                format!("Échec du lancement de git : {e}")
            }
        })?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("git {} a échoué : {}", args.join(" "), stderr.trim()))
    }
}

/// S'assure que le clone local existe et pointe sur la bonne URL. Clone si
/// absent, sinon recale juste l'URL du remote `origin` (au cas où elle change
/// dans `sync.json`).
fn ensure_clone(app: &AppHandle, cfg: &SyncConfig) -> Result<PathBuf, String> {
    let dir = clone_dir(app);
    if dir.join(".git").exists() {
        git(&dir, &["remote", "set-url", "origin", &cfg.repo_url])?;
        return Ok(dir);
    }
    // Pas encore cloné : on clone dans le dossier parent (data_dir) vers `sync-repo`.
    let parent = storage::data_dir(app);
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Chemin de clone invalide")?;
    // Si un dossier `sync-repo` existe sans `.git` (clone interrompu), on le purge.
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Nettoyage du clone : {e}"))?;
    }
    git(&parent, &["clone", &cfg.repo_url, name])?;
    Ok(dir)
}

/// Copie tous les `songbook-*.json` de `from` vers `to`, en supprimant d'abord
/// ceux présents dans `to` mais absents de `from` (un recueil retiré côté source
/// doit disparaître côté destination). Réutilise le critère de `storage`.
fn copy_songbooks(from: &Path, to: &Path) -> Result<usize, String> {
    let src_files = storage::songbook_files(from);
    let src_names: std::collections::HashSet<String> = src_files
        .iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
        .collect();

    // Supprime les recueils obsolètes côté destination.
    for path in storage::songbook_files(to) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(String::from)
            .unwrap_or_default();
        if !src_names.contains(&name) {
            fs::remove_file(&path).map_err(|e| format!("Suppression de {name} : {e}"))?;
        }
    }

    // Copie/écrase les recueils source.
    for path in &src_files {
        let name = path.file_name().ok_or("Nom de fichier invalide")?;
        fs::copy(path, to.join(name)).map_err(|e| format!("Copie de recueil : {e}"))?;
    }
    Ok(src_files.len())
}

/// Vérifie que les deux dossiers contiennent exactement les mêmes recueils.
/// Cette comparaison préserve la règle « le distant gagne » : même lorsque le
/// commit distant n'a pas changé, un fichier local modifié doit être remplacé.
fn songbooks_match(left: &Path, right: &Path) -> Result<bool, String> {
    let left_files = storage::songbook_files(left);
    let right_files = storage::songbook_files(right);
    if left_files.len() != right_files.len() {
        return Ok(false);
    }

    for (left_path, right_path) in left_files.iter().zip(&right_files) {
        if left_path.file_name() != right_path.file_name() {
            return Ok(false);
        }
        let left_bytes =
            fs::read(left_path).map_err(|e| format!("Lecture de {} : {e}", left_path.display()))?;
        let right_bytes = fs::read(right_path)
            .map_err(|e| format!("Lecture de {} : {e}", right_path.display()))?;
        if left_bytes != right_bytes {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Résultat d'un `pull` ou d'un `push`. `changed` distingue le cas courant
/// « rien de neuf » d'un vrai transfert. Au pull, l'interface ne doit
/// reconstruire ses listes que dans le second cas, sinon elle détruit
/// inutilement la sélection en cours ; au push, elle n'annonce que ce qui a
/// réellement été publié.
#[derive(Debug, Clone, Serialize)]
pub struct SyncOutcome {
    pub changed: bool,
    pub message: String,
}

/// Récupère la dernière version distante et l'applique au dossier de chants.
/// « Dernier qui écrit gagne » : si nécessaire, on aligne le clone sur
/// `origin/<branche>` par un reset dur (pas de fusion), puis on recopie les
/// recueils dans `songbooks/` et on invalide le cache mémoire.
pub fn pull(app: &AppHandle, state: &AppState) -> Result<SyncOutcome, String> {
    let _sync_guard = SYNC_LOCK
        .lock()
        .map_err(|_| "Verrou de synchronisation indisponible".to_string())?;
    let cfg = require_config(app)?;
    let dir = ensure_clone(app, &cfg)?;
    let branch = cfg.branch();
    let remote_ref = format!("origin/{branch}");
    let previous_head = git(&dir, &["rev-parse", "HEAD"])?;

    git(&dir, &["fetch", "origin", branch])?;
    let remote_head = git(&dir, &["rev-parse", &remote_ref])?;

    // Cas courant : le dépôt distant et les fichiers actifs sont déjà alignés.
    // On évite alors reset, copies, invalidation et relecture du cache des chants.
    if previous_head.trim() == remote_head.trim()
        && git(&dir, &["status", "--porcelain"])?.trim().is_empty()
        && songbooks_match(&dir, &storage::songbooks_dir(app))?
    {
        return Ok(SyncOutcome {
            changed: false,
            message: "Déjà à jour : aucun recueil à recharger.".into(),
        });
    }

    git(&dir, &["reset", "--hard", &remote_ref])?;

    let n = copy_songbooks(&dir, &storage::songbooks_dir(app))?;
    storage::invalidate_songs_cache(state);
    Ok(SyncOutcome {
        changed: true,
        message: format!("{n} recueil(s) récupéré(s)."),
    })
}

/// Publie l'état local des recueils vers le dépôt distant. « Dernier qui écrit
/// gagne » : on recale d'abord le clone sur la dernière version distante
/// (`fetch` + `reset --hard`), on y recopie les recueils locaux, puis on commite
/// et on pousse. Aucun blocage de conflit : le contenu local l'emporte.
pub fn push(app: &AppHandle) -> Result<SyncOutcome, String> {
    let _sync_guard = SYNC_LOCK
        .lock()
        .map_err(|_| "Verrou de synchronisation indisponible".to_string())?;
    let cfg = require_config(app)?;
    let dir = ensure_clone(app, &cfg)?;
    let branch = cfg.branch();

    // Repart de la dernière version distante pour minimiser le risque de rejet.
    git(&dir, &["fetch", "origin", branch])?;
    git(&dir, &["reset", "--hard", &format!("origin/{branch}")])?;

    // Applique l'état local par-dessus (le contenu local fait foi).
    copy_songbooks(&storage::songbooks_dir(app), &dir)?;

    git(&dir, &["add", "-A"])?;

    // Rien à publier : working tree propre après le add.
    let status = git(&dir, &["status", "--porcelain"])?;
    if status.trim().is_empty() {
        return Ok(SyncOutcome {
            changed: false,
            message: "Déjà à jour : aucune modification à publier.".into(),
        });
    }

    let host = hostname();
    let msg = format!("songbooks: update from {host}");
    git(&dir, &["commit", "-m", &msg])?;
    git(&dir, &["push", "origin", &format!("HEAD:{branch}")])?;
    Ok(SyncOutcome {
        changed: true,
        message: "Recueils publiés.".into(),
    })
}

/// Nom de la machine pour tracer l'origine d'un commit de publication. Best
/// effort multi-OS : variables d'environnement (Windows : `COMPUTERNAME`),
/// sinon la commande `hostname` (macOS/Linux ne renseignent pas `HOSTNAME` dans
/// l'environnement d'une app GUI), sinon `inconnu`.
fn hostname() -> String {
    if let Ok(name) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        if !name.trim().is_empty() {
            return name.trim().to_string();
        }
    }
    if let Ok(out) = command("hostname").output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    "inconnu".to_string()
}
