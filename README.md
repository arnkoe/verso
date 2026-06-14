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

### Format d'un recueil de chants

Un recueil est un fichier `songbooks/songbook-<nom>.json` (le nom de fichier doit commencer par `songbook-`) contenant un **tableau** de chants. Des exemples complets sont dans le dossier [`examples/`](examples/).

```json
[
  {
    "id": 1,
    "title": "Titre du chant",
    "author": "Auteur ou null",
    "source_book": "Mon recueil",
    "source_number": 1,
    "verses": [
      { "type": "S", "number": 1, "text": "Strophe 1, ligne 1.\nLigne 2." },
      { "type": "R", "text": "Texte du refrain." },
      { "type": "S", "number": 2, "text": "Strophe 2." }
    ]
  }
]
```

- `id` — entier **unique** dans le recueil (identifiant interne).
- `title` — titre affiché et recherché.
- `author` — chaîne ou `null` si inconnu.
- `source_book` — nom du recueil ; sert à grouper les chants dans la recherche.
- `source_number` — numéro du chant dans le recueil (ou `null`).
- `verses` — liste **ordonnée** des couplets. Chaque couplet a :
  - `type` — `"S"` strophe, `"R"` refrain, `"P"` pont, `"I"` intro, `"O"` final. Absent → strophe (`"S"`).
  - `number` — numéro de strophe (facultatif).
  - `text` — le texte ; les sauts de ligne se notent `\n`.

Le JSON n'autorise pas de vrai retour à la ligne à l'intérieur d'une chaîne : écrivez `\n` pour chaque saut de ligne dans `text`.

### Format d'une bible

Une traduction est un fichier `bibles/<code>.json` (ex. `S21.json`). Voir [`examples/bible-exemple.json`](examples/bible-exemple.json).

```json
{
  "translation": "S21",
  "books": [
    {
      "name": "Genèse",
      "chapters": [
        ["Genèse 1.1", "Genèse 1.2", "Genèse 1.3"],
        ["Genèse 2.1", "Genèse 2.2"]
      ]
    }
  ]
}
```

- `translation` — code de la traduction (idéalement identique au nom du fichier).
- `books` — liste **ordonnée** des livres.
  - `name` — nom du livre (utilisé pour la recherche de référence).
  - `chapters` — tableau de chapitres ; chaque chapitre est un tableau de versets (chaînes).
  - L'ordre fait foi : `chapters[0]` est le chapitre 1, et `chapters[0][0]` le verset 1.

## Utilisation

L'opérateur dispose de quatre onglets : **Chants**, **Bible**, **PDF**, **Images**. On recherche, on sélectionne, et le contenu s'affiche sur la fenêtre de projection envoyée en plein écran sur l'écran secondaire.

### Raccourcis clavier

Les raccourcis ci-dessous valent dans la fenêtre **opérateur** (sauf quand un champ de saisie a le focus, où seules les flèches de la recherche s'appliquent).

**Changer d'onglet**

- `c` — onglet Chants
- `b` — onglet Bible
- `p` — onglet PDF
- `i` — onglet Images
- `Ctrl`/`Cmd` + `Alt` + `M` — Chants (fonctionne même depuis un champ de saisie)
- `Ctrl`/`Cmd` + `Alt` + `,` — Bible (idem)
- `Ctrl`/`Cmd` + `Alt` + `.` — PDF (idem)
- `Ctrl`/`Cmd` + `Alt` + `/` — Images (idem)

**Rechercher**

- `/` — placer le curseur dans le champ de recherche de l'onglet actif
- `↑` `↓` — déplacer la sélection dans la liste de résultats
- `Entrée` — valider le résultat sélectionné

**Projeter et naviguer**

- `↓` `→` — élément suivant (strophe, verset, page PDF)
- `↑` `←` — élément précédent
- `Entrée` — projeter l'élément suivant (ou le premier si rien n'est encore projeté)
- `b` — écran noir : masquer/réafficher la projection
- `Échap` — vider la projection (retour à l'écran neutre)

**Fenêtre de projection**

- `Échap` — fermer la fenêtre de projection

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
