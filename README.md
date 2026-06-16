# Verso

Application de bureau pour projeter des chants et des textes bibliques pendant un culte. Une fenêtre opérateur pour piloter, une fenêtre de projection plein écran sur le vidéoprojecteur.

## Installation

Téléchargez la dernière version depuis la page des *releases* du dépôt (ou l'onglet **Actions**). Des bundles sont publiés pour Windows et macOS (Apple Silicon et Intel).

### Windows

- `Verso_x64-setup.exe` — installeur classique (recommandé).
- `Verso_x64_en-US.msi` — variante MSI.
- `Verso.exe` — version portable, sans installation.

### macOS

Téléchargez le `.dmg` correspondant à votre Mac (Apple Silicon ou Intel) et glissez **Verso** dans **Applications**.

L'application n'étant pas notarisée par Apple, macOS affiche au premier lancement « "Verso" est endommagé et ne peut pas être ouvert ». C'est normal. Pour débloquer (une seule fois), ouvrez le **Terminal** et exécutez :

```bash
xattr -dr com.apple.quarantine /Applications/Verso.app
```

Lancez ensuite Verso normalement. Les mises à jour suivantes s'installent sans cette étape.

## Mises à jour

Au démarrage, Verso vérifie en arrière-plan s'il existe une version plus récente. Le cas échéant, un point apparaît sur le bouton **À propos** et un lien dans le panneau correspondant permet d'installer la mise à jour puis de relancer l'application. Les bundles ne sont installés que si leur signature est valide.

## Vos données

Verso lit et écrit ses contenus dans le dossier **`Documents/Verso/`** :

- `songbooks/` — un fichier `.json` par recueil de chants (modifiable ; vos retouches de strophes y sont enregistrées).
- `bibles/` — une traduction par fichier `.json`.
- `pdf/` et `images/` — vos PDF et images à projeter.

Rien n'est livré avec l'application : vous déposez vous-même vos recueils, bibles, PDF et images dans ces sous-dossiers (créés automatiquement au premier lancement). Le bouton **« Dossier »** de la barre d'outils de l'opérateur ouvre directement la racine `Documents/Verso/` dans votre gestionnaire de fichiers.

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
  - `type` — `"S"` pour une strophe, `"R"` pour un refrain. Absent → strophe (`"S"`). Les refrains sont étiquetés « Refrain » ; tout autre type est affiché comme une strophe.
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

Des combinaisons avec `Alt` permettent de changer d'onglet, y compris depuis un champ de saisie. Elles se basent sur la position physique des touches (clavier AZERTY) : le modificateur change selon l'OS (`Ctrl` sous Windows, `Cmd` sous macOS) et, pour l'onglet Images, le caractère imprimé diffère (`!` sous Windows, `=` sous macOS) :

| Onglet  | Windows               | macOS                 |
| ------- | --------------------- | --------------------- |
| Chants  | `Ctrl` + `Alt` + `,`  | `Cmd` + `Opt` + `,`   |
| Bible   | `Ctrl` + `Alt` + `;`  | `Cmd` + `Opt` + `;`   |
| PDF     | `Ctrl` + `Alt` + `:`  | `Cmd` + `Opt` + `:`   |
| Images  | `Ctrl` + `Alt` + `!`  | `Cmd` + `Opt` + `=`   |

**Rechercher**

- `/` — placer le curseur dans le champ de recherche de l'onglet actif
- `↑` `↓` — déplacer la sélection dans la liste de résultats
- `Entrée` — valider le résultat sélectionné

**Projeter et naviguer**

- `↓` `→` — élément suivant (strophe, verset, page PDF)
- `↑` `←` — élément précédent
- `Entrée` — projeter l'élément suivant (ou le premier si rien n'est encore projeté)
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
