# Verso

*[English](README.md)*

Verso est un logiciel pour projeter des chants et des textes de la Bible sur un grand écran ou un vidéoprojecteur pendant un culte.

Vous travaillez sur une fenêtre (la fenêtre **opérateur**, sur votre ordinateur) et ce que vous choisissez s'affiche sur une deuxième fenêtre, en plein écran, sur le vidéoprojecteur.

L'interface est disponible en **anglais** (par défaut) et en **français**. Vous pouvez changer de langue à tout moment depuis les Paramètres.

---

## Installer Verso

1. Allez sur la page des **versions** (« Releases ») du projet.
2. Téléchargez le fichier qui correspond à votre ordinateur :
   - **Windows** : le fichier dont le nom finit par `setup.exe`.
   - **Mac récent (puce Apple, depuis 2020)** : le fichier `.dmg` qui contient `aarch64`.
   - **Mac plus ancien (puce Intel)** : le fichier `.dmg` qui contient `x64`.

   Si vous ne savez pas quel Mac vous avez : menu Pomme  (en haut à gauche) → **À propos de ce Mac**. La ligne « Puce » ou « Processeur » vous le dit.

3. Ouvrez le fichier téléchargé et suivez les indications ci-dessous selon votre système.

> Au tout premier lancement, votre ordinateur va afficher un message qui fait peur. **C'est normal et ce n'est pas un virus.** Cela arrive parce que Verso est un petit logiciel gratuit qui n'a pas payé les certificats coûteux de Microsoft et d'Apple. Voici comment passer cette étape, une seule fois.

### Sur Windows

Quand vous lancez le fichier `setup.exe`, Windows peut afficher un **écran bleu** : « Windows a protégé votre ordinateur ».

Pour continuer :

1. Cliquez sur le petit texte **« Informations complémentaires »**.
2. Un bouton **« Exécuter quand même »** apparaît. Cliquez dessus.

L'installation se poursuit normalement. Vous n'aurez plus jamais à faire cela : les prochaines mises à jour s'installeront toutes seules.

### Sur Mac

1. Ouvrez le fichier `.dmg` que vous avez téléchargé.
2. Une fenêtre s'ouvre. **Glissez l'icône de Verso sur le dossier Applications** affiché à côté.
3. Si, en essayant d'ouvrir Verso, le Mac affiche « "Verso" est endommagé et ne peut pas être ouvert », il faut faire une petite manipulation, **une seule fois** :

   a. Ouvrez l'application **Terminal**. Pour la trouver : appuyez sur les touches **Cmd () + Espace**, tapez `Terminal`, puis appuyez sur **Entrée**.

   b. Dans la fenêtre noire qui s'ouvre, copiez-collez exactement la ligne suivante :

   ```
   xattr -dr com.apple.quarantine /Applications/Verso.app
   ```

   c. Appuyez sur **Entrée**. (Rien ne s'affiche : c'est bon signe.)

   d. Fermez le Terminal et ouvrez Verso normalement.

Vous n'aurez plus jamais à refaire cela : les prochaines mises à jour s'installeront toutes seules.

---

## Mettre à jour Verso

Vous n'avez rien à surveiller. À chaque démarrage, Verso regarde tout seul si une version plus récente existe.

Si c'est le cas, un petit **point** apparaît sur le bouton **« À propos »**. Cliquez sur ce bouton : un lien vous propose d'installer la mise à jour, puis Verso redémarre. C'est tout.

Vous pouvez aussi vérifier les mises à jour manuellement depuis **Paramètres → Mises à jour**.

---

## Vos chants, vos Bibles, vos documents

Verso range tout dans un dossier nommé **`Verso`**, à l'intérieur du dossier de données de l'application pour votre compte. Vous n'avez pas besoin d'en connaître l'emplacement exact : ouvrez les **Paramètres** (le bouton roue dentée de la barre d'outils), puis dans la rubrique **Contenus** cliquez sur **Ouvrir** à côté de « Dossier Verso » pour l'ouvrir directement.

À l'intérieur, vous trouverez :

- **`songbooks`** — vos recueils de chants (un fichier par recueil).
- **`bibles`** — vos traductions de la Bible (un fichier par traduction).
- **`pdf`** — les documents PDF que vous voulez projeter.
- **`images`** — les images que vous voulez projeter.

Pour ajouter vos propres PDF ou images, déposez simplement vos fichiers dans le dossier `pdf` ou `images`.

La première fois que vous lancez Verso, si le dossier est vide, Verso y dépose automatiquement quelques contenus gratuits pour commencer : les recueils **Reflets 4** et **Hymnes et Cantiques (révisés)**, et les Bibles **Darby** et **Louis Segond 1910**. Vous pouvez les garder, les modifier ou les supprimer comme vous voulez. Verso ne touche jamais à vos fichiers si vous en avez déjà mis.

Verso se souvient aussi de ce qui était projeté la dernière fois et le reprend à la réouverture.

---

## Se servir de Verso

La fenêtre opérateur a quatre onglets : **Chants**, **Bible**, **PDF** et **Images**.

Le principe est toujours le même : vous cherchez ce que vous voulez, vous le sélectionnez, et il s'affiche sur le vidéoprojecteur.

La recherche de chants est tolérante : elle ignore les accents et les apostrophes, accepte plusieurs mots, et matche aussi bien le numéro du chant que ses premiers mots (incipit).

### Modifier un chant

Quand un chant est ouvert, le bouton **Modifier** (en haut de la liste des strophes) ouvre une zone de texte où vous pouvez corriger les paroles directement dans l'application, sans toucher au fichier JSON. **Sauvegarder** enregistre les changements dans le recueil ; **Annuler** referme la zone sans rien modifier.

Le texte suit une mise en forme simple :

- Les strophes, refrains et autres sections sont séparés par une **ligne vide**.
- La **première ligne** d'un bloc indique son type, le plus simplement avec une lettre : `S` pour strophe, `R` pour refrain, `P` pour pont, `I` pour introduction, `O` pour final, `PC` pour pré-refrain. Ajoutez un numéro si besoin (`S2`).
- Sans type reconnu, le bloc est considéré comme une strophe et numéroté automatiquement : vous pouvez écrire les paroles sans aucune étiquette.
- Les lignes suivantes du bloc sont le texte projeté ; un simple retour à la ligne crée un nouveau vers.

Exemple :

```
S1
Première ligne de la strophe.
Deuxième ligne.

R
Texte du refrain.
```

Les noms complets fonctionnent aussi (`Strophe 1`, `Refrain`, `Pont`…) si vous préférez.

### Les raccourcis clavier qui font gagner du temps

Ces raccourcis fonctionnent dans la fenêtre opérateur (celle sur votre ordinateur).

**Changer d'onglet**

- **Tab** : passer à l'onglet suivant (Chants → Bible → PDF → Images).
- **Maj + Tab** : revenir à l'onglet précédent.

**Chercher**

- **/** (la touche slash) : aller directement dans le champ de recherche.
- **Flèches haut / bas** : se déplacer dans la liste des résultats.
- **Entrée** : valider le résultat sélectionné.

**Projeter et avancer**

- **Flèche bas** ou **flèche droite** : élément suivant (strophe suivante, verset suivant, page suivante).
- **Flèche haut** ou **flèche gauche** : élément précédent.
- **Entrée** : projeter l'élément suivant (ou le premier si rien n'est encore projeté).
- **Cmd () + Entrée** (macOS) ou **Ctrl + Entrée** : ouvrir la fenêtre de projection (comme le bouton **Projeter**), qu'un élément soit sélectionné ou non.
- **Échap** : effacer la projection (écran neutre).

**Dans la fenêtre de projection**

- **Échap** : fermer la fenêtre de projection.

### Paramètres

Le bouton **Paramètres** (roue dentée) de la barre d'outils ouvre un volet avec des rubriques :

- **Contenus** — gérez vos recueils, Bibles, PDF et images directement depuis les paramètres : pour chaque catégorie vous pouvez **Ajouter** des fichiers, **Gérer** les éléments existants et les **Supprimer**, sans quitter l'application. Vous pouvez aussi ouvrir le dossier Verso où se trouvent ces fichiers.
- **Langue** — changer la langue de l'interface.
- **Mises à jour** — vérifier manuellement une nouvelle version et l'installer.

Vous pouvez fermer les Paramètres en cliquant sur le fond ou en appuyant sur **Échap**.

---

## Pour aller plus loin (partie technique)

Cette section s'adresse aux personnes à l'aise avec les fichiers JSON ou le code. Vous n'en avez **pas besoin** pour utiliser Verso au quotidien.

### Ajouter un recueil de chants

Un recueil est un fichier rangé dans `songbooks`, nommé `songbook-<code>.json`, où `<code>` est le code du recueil (`songbook_code`) en minuscules, espaces remplacés par des tirets, accents et ponctuation supprimés. Pour un recueil dont le code est `ABC`, le fichier est `songbook-abc.json`. Verso régénère ce nom canonique à partir du code : vous n'avez pas à le respecter à la main.

Le fichier est un objet portant le nom du recueil une seule fois, puis la liste des chants :

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

- `songbook_code` — code du recueil, répété sur chaque fichier du recueil.
- `songbook_name` — nom lisible du recueil.
- `songs` — la liste des chants. Chaque chant a :
- `title` — titre affiché et recherché.
- `author` — texte, ou `null` si inconnu.
- `source_number` — numéro du chant dans le recueil (ou `null`).
- `verses` — liste **ordonnée** des couplets. Chaque couplet a :
  - `type` — type de section. Valeurs courantes : `"verse"`, `"chorus"`, `"bridge"`, `"intro"`, `"outro"`, `"prechorus"`. Absent → strophe. Les refrains sont étiquetés « Refrain » ; tout autre type est affiché comme une strophe.
  - `number` — numéro de strophe (facultatif).
  - `text` — le texte ; les sauts de ligne se notent `\n`.

Le format JSON n'autorise pas de vrai retour à la ligne à l'intérieur d'un texte : écrivez `\n` pour chaque saut de ligne dans `text`.

Un fichier complet est disponible dans [`examples/songbook-abc.json`](examples/songbook-abc.json) : vous pouvez le copier et le remplir avec vos chants.

### Ajouter une Bible

Une traduction est un fichier rangé dans `bibles`, nommé `bible-<code>.json`, où `<code>` est le code de la traduction (`bible_code`) en minuscules, espaces remplacés par des tirets, accents et ponctuation supprimés. Pour une traduction dont le code est `S21`, le fichier est `bible-s21.json`. Verso régénère ce nom canonique à partir du code : vous n'avez pas à le respecter à la main.

```json
{
  "bible_code": "S21",
  "bible_name": "Segond 21",
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

Un fichier complet est disponible dans [`examples/bible-abc.json`](examples/bible-abc.json) : vous pouvez le copier et le remplir avec votre traduction.

- `bible_code` — code de la traduction ; le nom du fichier en est dérivé.
- `bible_name` — *(optionnel)* nom lisible de la traduction (par exemple `Segond 21`) ; affiché dans l'opérateur et dans la gestion des contenus. À défaut, on retombe sur le code.
- `books` — liste **ordonnée** des livres.
  - `name` — nom du livre (utilisé pour la recherche de référence).
  - `chapters` — tableau de chapitres ; chaque chapitre est un tableau de versets (textes).
  - L'ordre fait foi : `chapters[0]` est le chapitre 1, et `chapters[0][0]` le verset 1.

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

### Structure du code

```
src/                       frontend (HTML/JS, pas d'étape de build)
  operator.html            fenêtre opérateur
  projection.html          fenêtre de projection
  assets/js/               logique opérateur, rendu, accès aux données
  assets/js/i18n.js        traductions de l'interface (anglais/français)
  vendor/pdfjs/            pdf.js embarqué localement

src-tauri/                 backend Rust
  src/lib.rs               commandes Tauri + fenêtres
  src/storage.rs           stockage fichiers + amorçage initial
  src/bible_search.rs      résolution de référence biblique
  resources/               recueils + Bibles libres de droits empaquetés (seed)
  tauri.conf.json          config (fenêtres, CSP, bundle)
```
