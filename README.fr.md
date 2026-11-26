# Verso

*[English](README.md)*

<!-- website:start -->

Verso projette des chants et des textes de la Bible sur un grand écran ou un vidéoprojecteur pendant un culte.

Vous travaillez dans la fenêtre **opérateur**, sur votre ordinateur ; ce que vous y choisissez s'affiche en plein écran sur le vidéoprojecteur, dans une seconde fenêtre.

L'interface existe en **anglais** (par défaut) et en **français** ; vous pouvez changer de langue à tout moment dans les Réglages.

---

## Installer Verso

Le plus simple : allez sur **[verso.akurba.com](https://verso.akurba.com)** et cliquez sur le bouton de téléchargement, qui choisit le bon fichier pour votre ordinateur. Passez ensuite directement à l'étape 3.

Vous pouvez aussi télécharger les fichiers depuis GitHub :

1. Allez sur la [page des **versions** (« Releases »)](https://github.com/arnkoe/verso/releases/latest), puis ouvrez la section **Assets** en bas de la dernière version.
2. Téléchargez le fichier qui correspond à votre ordinateur :
   - **Windows** : le fichier dont le nom finit par `setup.exe`.
   - **Mac récent (puce Apple, depuis 2020)** : le fichier `.dmg` dont le nom contient `aarch64`.
   - **Mac plus ancien (puce Intel)** : le fichier `.dmg` dont le nom contient `x64`.

   Pour savoir quel Mac vous avez : menu Pomme  (en haut à gauche) → **À propos de ce Mac**. La ligne « Puce » ou « Processeur » l'indique.

3. Ouvrez le fichier téléchargé, puis suivez les indications ci-dessous pour votre système.

> Sur Windows, un avertissement inquiétant s'affiche au premier lancement de l'installateur. **C'est normal : ce n'est pas un virus.** Verso est un petit logiciel gratuit, qui n'a pas acheté le coûteux certificat de Microsoft. Cette étape ne se présente qu'une fois.

### Sur Windows

Quand vous lancez le fichier `setup.exe`, Windows peut afficher une **fenêtre bleue** : « Windows a protégé votre ordinateur ».

Pour continuer :

1. Cliquez sur **« Informations complémentaires »**.
2. Cliquez sur le bouton **« Exécuter quand même »** qui apparaît.

L'installation se poursuit alors normalement. Cette manipulation n'est à faire qu'une fois : les mises à jour s'installent ensuite depuis Verso.

### Sur Mac

1. Ouvrez le fichier `.dmg` téléchargé.
2. Dans la fenêtre qui s'ouvre, **glissez l'icône de Verso sur le dossier Applications**.
3. Ouvrez Verso depuis le dossier Applications. Si macOS demande une confirmation parce que l'app a été téléchargée sur Internet, cliquez sur **Ouvrir**.

Verso est signé et vérifié par Apple. Les mises à jour s'installent ensuite depuis Verso.

---

## Mettre à jour Verso

Au démarrage, Verso vérifie discrètement s'il existe une version plus récente. Si c'est le cas, un lien **Mise à jour disponible** apparaît dans la fenêtre principale, sous le message de la page vide. Il ouvre les **Réglages**, où le bouton de la rubrique **Mises à jour** installe la nouvelle version et redémarre Verso ; l'état de la mise à jour s'affiche sous ce bouton.

Vous pouvez aussi lancer la vérification vous-même depuis cette rubrique.

---

## Vos chants, vos Bibles, vos documents

Verso range tout dans un dossier nommé **`Verso`**, parmi les données d'application de votre compte. Inutile d'en connaître l'emplacement : dans les **Réglages** (`⌘,` sur macOS, `Ctrl+,` ailleurs), rubrique **Contenus**, cliquez sur **Ouvrir** à côté de « Dossier Verso ».

Il contient quatre dossiers :

- **`songbooks`** : vos recueils de chants (un fichier par recueil).
- **`bibles`** : vos traductions de la Bible (un fichier par traduction).
- **`pdf`** : les documents PDF à projeter.
- **`images`** : les images à projeter.

Pour ajouter des PDF ou des images, déposez-les dans le dossier `pdf` ou `images`.

Au premier lancement, si ce dossier est vide, Verso y dépose quelques contenus gratuits :

- les recueils **Reflets 4** et **Hymnes et Cantiques (révisés)** ;
- les Bibles **Darby**, **Darby révisée** (Bibles et Publications Chrétiennes, CC BY-NC-ND 4.0) et **Louis Segond 1910** ;
- deux images de projection, s'il n'y a encore aucune image compatible.

Vous pouvez les garder, les modifier ou les remplacer. Les images ne sont ajoutées qu'à la première installation et ne remplacent jamais une image existante. Si plus aucune Bible n'est lisible, Verso restaure ces trois traductions au démarrage suivant ; tant qu'il en reste une, vos fichiers ne sont pas modifiés. Les Bibles déjà présentes sont reconnues à leur code interne, même si le fichier ne s'appelle pas `bible-<code>.json`.

À la réouverture, Verso reprend ce qui était projeté la dernière fois.

---

## Se servir de Verso

La fenêtre opérateur a quatre onglets : **Chants**, **Bible**, **PDF** et **Images**.

Le principe est le même partout : cherchez un contenu, sélectionnez-le, et il s'affiche sur le vidéoprojecteur.

Sous l'aperçu de la projection, **Projeter** ouvre la fenêtre de projection sur l'écran choisi dans les Réglages, et **Masquer** remplace temporairement son contenu par un écran blanc. Leurs raccourcis, **Cmd/Ctrl P** et **Cmd/Ctrl M**, sont rappelés sur les boutons. Ils fonctionnent aussi quand la fenêtre de projection est active : **Cmd/Ctrl M** vide l'écran sans fermer ni réduire la fenêtre, **Cmd/Ctrl P** réaffiche le dernier contenu projeté.

La recherche de chants est tolérante : elle ignore les accents et les apostrophes, accepte plusieurs mots, et trouve un chant par son numéro comme par ses premiers mots (incipit).

### Modifier un chant

Quand un chant est ouvert, le bouton **Modifier** (au-dessus de la liste des strophes) ouvre une zone de texte pour corriger les paroles sans toucher au fichier JSON. **Sauvegarder** enregistre les changements dans le recueil ; **Annuler** referme la zone sans rien modifier.

Le texte suit une mise en forme simple :

- Les strophes, refrains et autres sections sont séparés par une **ligne vide**.
- La **première ligne** d'un bloc indique son type, en une ou deux lettres : `S` pour strophe, `R` pour refrain, `P` pour pont, `I` pour introduction, `O` pour final, `PC` pour pré-refrain. Ajoutez un numéro si besoin (`S2`).
- Sans type reconnu, le bloc est traité comme une strophe et numéroté automatiquement : vous pouvez donc saisir les paroles sans aucune étiquette.
- Les lignes suivantes forment le texte projeté ; chaque retour à la ligne commence un nouveau vers.

Exemple :

```
S1
Première ligne de la strophe.
Deuxième ligne.

R
Texte du refrain.
```

Les noms complets (`Strophe 1`, `Refrain`, `Pont`…) fonctionnent aussi.

### Raccourcis clavier

Des raccourcis clavier permettent de changer d'onglet, de chercher et de projeter sans la souris. La liste complète, toujours à jour, s'ouvre dans une fenêtre séparée par **Aide → Raccourcis clavier**.

### Réglages

Ouvrez les Réglages par **Verso → Réglages…** (`⌘,`) sur macOS, **Fichier → Réglages…** (`Ctrl+,`) sous Windows, ou le menu **Aide** sous Linux. Ils s'ouvrent dans une fenêtre séparée, avec quatre rubriques :

- **Projection** : l'écran utilisé pour la projection, à choisir dans la liste déroulante. Ce choix est mémorisé.
- **Contenus** : pour chaque catégorie (recueils, Bibles, PDF, images), vous pouvez **Ajouter** des fichiers, **Gérer** les éléments existants et les **Supprimer**. Vous pouvez aussi ouvrir le dossier Verso.
- **Langue** : la langue de l'interface.
- **Mises à jour** : l'état de la mise à jour, la vérification manuelle et l'installation d'une nouvelle version.

Les fenêtres **Réglages**, **Raccourcis clavier** et **À propos de Verso** se ferment avec leur bouton de fermeture ou `Cmd/Ctrl W` ; leurs boîtes de dialogue se ferment avec **Échap**. Elles restent prêtes en arrière-plan et se rouvrent donc instantanément.

La fenêtre **À propos de Verso** (menu **Aide**, et menu **Verso** sur macOS) indique la version, l'auteur et le contact, et permet aussi de vérifier et d'installer les mises à jour.

Les menus suivent la langue choisie dans les Réglages.

<!-- website:end -->

---

## Pour aller plus loin (partie technique)

Cette section s'adresse aux personnes à l'aise avec les fichiers JSON ou le code. Vous n'en avez **pas besoin** pour utiliser Verso au quotidien.

### Ajouter un recueil de chants

Un recueil est un fichier `songbook-<code>.json` rangé dans `songbooks`. `<code>` est le code du recueil (`songbook_code`) en minuscules, sans accents ni ponctuation, les espaces remplacés par des tirets : pour le code `ABC`, le fichier est `songbook-abc.json`. Verso rétablit lui-même ce nom à partir du code : inutile de le respecter à la main.

Le fichier contient le code et le nom du recueil, puis la liste des chants :

```json
{
  "songbook_code": "ABC",
  "songbook_name": "Mon recueil",
  "songs": [
    {
      "title": "Titre du chant",
      "author": "Auteur ou null",
      "source_number": 1,
      "verses": [
        { "type": "verse", "number": 1, "text": "Strophe 1, ligne 1.\nLigne 2." },
        { "type": "chorus", "text": "Texte du refrain." },
        { "type": "verse", "number": 2, "text": "Strophe 2." }
      ]
    }
  ]
}
```

- `songbook_code` : code du recueil ; le nom du fichier en est dérivé.
- `songbook_name` : nom du recueil.
- `songs` : liste des chants. Chaque chant a :
  - `title` : titre, affiché et utilisé pour la recherche.
  - `author` : auteur, ou `null` s'il est inconnu. Affiché au bas de la projection tant qu'une strophe du chant est à l'écran.
  - `source_number` : numéro du chant dans le recueil (ou `null`).
  - `verses` : liste **ordonnée** des sections du chant. Chaque section a :
    - `type` : type de section. Valeurs courantes : `"verse"`, `"chorus"`, `"bridge"`, `"intro"`, `"outro"`, `"prechorus"` ; strophe par défaut. Seuls les refrains sont étiquetés « Refrain » : les autres types s'affichent comme des strophes.
    - `number` : numéro de strophe (facultatif).
    - `text` : les paroles. JSON n'acceptant pas de vrai retour à la ligne dans un texte, chaque saut de ligne s'écrit `\n`.

[`examples/songbook-abc.json`](examples/songbook-abc.json) est un fichier complet, à copier puis à remplir avec vos chants.

### Ajouter une Bible

Une traduction est un fichier `bible-<code>.json` rangé dans `bibles`. `<code>` est le code de la traduction (`bible_code`) en minuscules, sans accents ni ponctuation, les espaces remplacés par des tirets : pour le code `S21`, le fichier est `bible-s21.json`. Verso rétablit lui-même ce nom à partir du code : inutile de le respecter à la main.

```json
{
  "bible_code": "S21",
  "bible_name": "Segond 21",
  "bible_copyright": "Éditeur — Traduction, licence CC BY-NC-ND 4.0",
  "books": [
    {
      "name": "Genèse",
      "chapters": [
        [
          "Au commencement, Dieu créa le ciel et la terre.",
          "La terre était informe et vide ; les ténèbres couvraient l'abîme.",
          "Dieu dit : « Que la lumière soit ! » et la lumière fut."
        ],
        [
          "Premier verset du chapitre 2.",
          "Deuxième verset du chapitre 2."
        ]
      ]
    },
    {
      "name": "Jean",
      "chapters": [
        ["Au commencement était la Parole, et la Parole était avec Dieu, et la Parole était Dieu."]
      ]
    }
  ]
}
```

[`examples/bible-abc.json`](examples/bible-abc.json) est un fichier complet, à copier puis à remplir avec votre traduction.

- `bible_code` : code de la traduction ; le nom du fichier en est dérivé.
- `bible_name` : *(optionnel)* nom de la traduction (par exemple `Segond 21`), affiché dans la fenêtre opérateur et dans la gestion des contenus. S'il est absent, le code est affiché à la place.
- `bible_copyright` : *(optionnel)* crédit de la traduction (éditeur, licence), pour les licences qui exigent l'attribution (par exemple `CC BY-NC-ND`). Affiché dans la fenêtre opérateur quand la traduction est sélectionnée, et au bas de la projection tant qu'un verset est à l'écran.
- `books` : liste **ordonnée** des livres.
  - `name` : nom du livre, utilisé pour la recherche par référence.
  - `chapters` : tableau des chapitres, chacun étant un tableau de versets.
  - La numérotation suit l'ordre : `chapters[0]` est le chapitre 1, et `chapters[0][0]` le verset 1.

### Développement

```bash
npm install
npm run dev      # lance l'app en mode dev
npm run build    # build de production + installeurs
```

Tests Rust :

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Le mode d'emploi du site (https://verso.akurba.com/guide.html) reprend le texte de ce README situé entre les marqueurs `<!-- website:start -->` et `<!-- website:end -->`. Le site le relit depuis GitHub à chaque visite : il suffit de modifier ce passage et de le pousser sur `master`. Voir `website/README.md`.

### Structure du code

```
src/                       frontend (HTML/JS, pas d'étape de build)
  operator.html            fenêtre opérateur
  projection.html          fenêtre de projection
  utility.html             fenêtres Réglages, Raccourcis et À propos
  assets/js/               logique opérateur, rendu, accès aux données
  assets/js/utility.js     logique légère des fenêtres utilitaires
  assets/js/i18n.js        traductions de l'interface (anglais/français)
  vendor/pdfjs/            pdf.js embarqué localement

src-tauri/                 backend Rust
  src/lib.rs               commandes Tauri + fenêtres
  src/storage.rs           stockage fichiers + amorçage initial
  src/bible_search.rs      résolution de référence biblique
  resources/               recueils + Bibles + images empaquetés (seed)
  tauri.conf.json          config (fenêtres, CSP, bundle)
```
