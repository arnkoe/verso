# Verso

Application de bureau pour projeter des chants et des textes bibliques pendant un culte. Une fenêtre opérateur pour piloter, une fenêtre de projection plein écran sur le vidéoprojecteur.

## Installation

Téléchargez la dernière version Windows depuis l'onglet **Actions** du dépôt (ou la page des *releases*), puis lancez l'installeur :

- `Verso_x64-setup.exe` — installeur classique (recommandé).
- `Verso_x64_en-US.msi` — variante MSI.
- `Verso.exe` — version portable, sans installation.

## Vos données

Verso lit et écrit ses contenus dans le dossier **`Documents/Verso/`** :

- `songbooks/` — un fichier `.json` par recueil de chants (modifiable ; vos retouches de strophes y sont enregistrées).
- `bibles/` — une traduction par fichier `.json`.
- `pdf/` et `images/` — vos PDF et images à projeter.

Rien n'est livré avec l'application : vous déposez vous-même vos recueils, bibles, PDF et images dans ce dossier. Les onglets PDF et Images proposent un bouton **« Dossier »** pour l'ouvrir directement.

L'état de la dernière projection est conservé et repris à la réouverture.

## Utilisation

L'opérateur dispose de quatre onglets : **Chants**, **Bible**, **PDF**, **Images**. On recherche, on sélectionne, et le contenu s'affiche sur la fenêtre de projection envoyée en plein écran sur l'écran secondaire.

### Raccourcis clavier

- `c` / `b` / `p` / `i` — onglets Chants / Bible / PDF / Images
- `/` — chercher dans l'onglet actif
- `↑` `↓` `←` `→` `Entrée` — naviguer et projeter (strophe, verset, page)
- `b` — écran noir (masquer la projection)
- `Échap` — masquer la projection

## Développement

```bash
npm install
npm run dev      # lance l'app en mode dev
npm run build    # build de production + installeurs
```

Tests Rust :

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### Structure

```
src/                       frontend (HTML/JS, pas d'étape de build)
  operator.html            fenêtre opérateur
  projection.html          fenêtre de projection
  assets/js/               logique opérateur, rendu, accès aux données
  vendor/pdfjs/            pdf.js embarqué localement

src-tauri/                 backend Rust
  src/lib.rs               commandes Tauri + fenêtres
  src/storage.rs           stockage fichiers
  src/bible_search.rs      résolution de référence biblique
  tauri.conf.json          config (fenêtres, CSP, bundle)
```
