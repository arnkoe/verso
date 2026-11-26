# Verso

*[Français](README.fr.md)*

<!-- website:start -->

Verso projects songs and Bible texts onto a large screen or a video projector during a church service.

You work in the **operator** window on your computer; whatever you choose there appears full screen on the projector, in a second window.

The interface is available in **English** (the default) and **French**; you can switch language at any time in Settings.

---

## Installing Verso

The simplest way: go to **[verso.akurba.com](https://verso.akurba.com)** and click the download button, which picks the right file for your computer. Then skip to step 3.

You can also download the files from GitHub:

1. Go to the [**Releases** page](https://github.com/arnkoe/verso/releases/latest), then open the **Assets** section at the bottom of the latest release.
2. Download the file that matches your computer:
   - **Windows**: the file whose name ends in `setup.exe`.
   - **Recent Mac (Apple Silicon, since 2020)**: the `.dmg` file whose name contains `aarch64`.
   - **Older Mac (Intel chip)**: the `.dmg` file whose name contains `x64`.

   To find out which Mac you have: Apple menu  (top left) → **About This Mac**. The "Chip" or "Processor" line tells you.

3. Open the downloaded file, then follow the instructions below for your system.

> On Windows, an alarming warning appears the first time you run the installer. **This is normal: it is not a virus.** Verso is a small, free program that has not bought Microsoft's expensive certificate. You only have to get past it once.

### On Windows

When you run the `setup.exe` file, Windows may show a **blue window**: "Windows protected your PC".

To continue:

1. Click **"More info"**.
2. Click the **"Run anyway"** button that appears.

Installation then continues normally. You only need to do this once: later updates are installed from within Verso.

### On Mac

1. Open the downloaded `.dmg` file.
2. In the window that opens, **drag the Verso icon onto the Applications folder**.
3. Open Verso from the Applications folder. If macOS asks for confirmation because the app was downloaded from the Internet, click **Open**.

Verso is signed and checked by Apple. Later updates are installed from within Verso.

---

## Updating Verso

At startup, Verso quietly checks for a newer version. When one is available, an **Update available** link appears in the main window, below the empty-state message. It opens **Settings**, where the button in the **Updates** section installs the new version and restarts Verso; the update status is shown below that button.

You can also run the check yourself from that section.

---

## Your songs, Bibles and documents

Verso keeps everything in a folder named **`Verso`**, inside your account's application data. You don't need to know where it is: in **Settings** (`⌘,` on macOS, `Ctrl+,` elsewhere), under **Content**, click **Open** next to "Verso folder".

It contains four folders:

- **`songbooks`**: your song collections (one file per collection).
- **`bibles`**: your Bible translations (one file per translation).
- **`pdf`**: the PDF documents to project.
- **`images`**: the images to project.

To add PDFs or images, drop them into the `pdf` or `images` folder.

On first launch, if this folder is empty, Verso adds some free content to it:

- the **Reflets 4** and **Hymnes et Cantiques (révisés)** collections;
- the **Darby**, **Darby révisée** (Bibles et Publications Chrétiennes, CC BY-NC-ND 4.0) and **Louis Segond 1910** Bibles;
- two projection images, if no compatible image is present yet.

You can keep, edit or replace them. Images are added only on the first installation and never replace an existing image. If no readable Bible is left, Verso restores these three translations the next time it starts; as long as one remains, your files are left untouched. Bibles already present are recognized by their internal code, even if the file is not named `bible-<code>.json`.

When you reopen Verso, it brings back what was being projected last time.

---

## Using Verso

The operator window has four tabs: **Songs**, **Bible**, **PDF** and **Images**.

It works the same way everywhere: search for an item, select it, and it appears on the projector.

Below the projection preview, **Project** opens the projection window on the screen chosen in Settings, and **Hide** temporarily replaces its content with a white screen. Their shortcuts, **Cmd/Ctrl P** and **Cmd/Ctrl M**, are shown on the buttons. They also work when the projection window is active: **Cmd/Ctrl M** clears the screen without closing or minimizing the window, and **Cmd/Ctrl P** restores the last projected content.

Song search is forgiving: it ignores accents and apostrophes, accepts several words, and finds a song by its number as well as by its opening words (incipit).

### Editing a song

When a song is open, the **Edit** button (above the verse list) opens a text area for fixing the lyrics without touching the JSON file. **Save** writes the changes to the collection; **Cancel** closes the area without changing anything.

The text uses simple formatting:

- Verses, choruses and other sections are separated by a **blank line**.
- The **first line** of a block gives its type, in one or two letters: `V` for verse, `C` for chorus, `B` for bridge, `I` for intro, `O` for outro, `PC` for pre-chorus. Add a number when needed (`V2`).
- Without a recognised type, the block is treated as a verse and numbered automatically, so you can type the lyrics with no labels at all.
- The following lines are the projected text; each line break starts a new line.

Example:

```
V1
First line of the verse.
Second line.

C
Chorus text.
```

Full names (`Verse 1`, `Chorus`, `Bridge`…) work too.

### Keyboard shortcuts

Keyboard shortcuts let you switch tabs, search and project without the mouse. The full, always up-to-date list opens in a separate window from **Help → Keyboard Shortcuts**.

### Settings

Open Settings from **Verso → Settings…** (`⌘,`) on macOS, **File → Settings…** (`Ctrl+,`) on Windows, or the **Help** menu on Linux. They open in a separate window with four sections:

- **Projection**: the screen used for projection, chosen from the drop-down menu. The choice is remembered.
- **Content**: for each category (collections, Bibles, PDFs, images), you can **Add** files, **Manage** the existing items and **Delete** them. You can also open the Verso folder.
- **Language**: the interface language.
- **Updates**: the update status, the manual check and the installation of a new version.

The **Settings**, **Keyboard Shortcuts** and **About Verso** windows close with their close button or `Cmd/Ctrl W`; their dialogs close with **Esc**. They stay ready in the background, so they reopen instantly.

The **About Verso** window (**Help** menu, and **Verso** menu on macOS) shows the version, author and contact details, and also lets you check for and install updates.

Menus follow the language chosen in Settings.

<!-- website:end -->

---

## Going further (technical section)

This section is for people comfortable with JSON files or code. You do **not** need it for everyday use of Verso.

### Adding a song collection

A collection is a `songbook-<code>.json` file kept in `songbooks`. `<code>` is the collection code (`songbook_code`) in lowercase, without accents or punctuation, with spaces replaced by hyphens: for the code `ABC`, the file is `songbook-abc.json`. Verso restores this name from the code by itself, so you don't have to match it by hand.

The file holds the collection's code and name, then the list of songs:

```json
{
  "songbook_code": "ABC",
  "songbook_name": "My collection",
  "songs": [
    {
      "title": "Song title",
      "author": "Author or null",
      "source_number": 1,
      "verses": [
        { "type": "verse", "number": 1, "text": "Verse 1, line 1.\nLine 2." },
        { "type": "chorus", "text": "Chorus text." },
        { "type": "verse", "number": 2, "text": "Verse 2." }
      ]
    }
  ]
}
```

- `songbook_code`: the collection code; the file name is derived from it.
- `songbook_name`: the collection name.
- `songs`: the list of songs. Each song has:
  - `title`: the title, shown and used for search.
  - `author`: the author, or `null` if unknown. Shown at the bottom of the projection while a verse of the song is on screen.
  - `source_number`: the song's number in the collection (or `null`).
  - `verses`: the **ordered** list of the song's sections. Each section has:
    - `type`: section type. Common values: `"verse"`, `"chorus"`, `"bridge"`, `"intro"`, `"outro"`, `"prechorus"`; verse by default. Only choruses are labelled "Chorus": every other type is shown as a verse.
    - `number`: verse number (optional).
    - `text`: the lyrics. JSON does not allow a real line break inside a text value, so each line break is written `\n`.

[`examples/songbook-abc.json`](examples/songbook-abc.json) is a complete file you can copy and fill with your own songs.

### Adding a Bible

A translation is a `bible-<code>.json` file kept in `bibles`. `<code>` is the translation code (`bible_code`) in lowercase, without accents or punctuation, with spaces replaced by hyphens: for the code `S21`, the file is `bible-s21.json`. Verso restores this name from the code by itself, so you don't have to match it by hand.

```json
{
  "bible_code": "S21",
  "bible_name": "Segond 21",
  "bible_copyright": "Publisher — Translation, CC BY-NC-ND 4.0 license",
  "books": [
    {
      "name": "Genesis",
      "chapters": [
        [
          "In the beginning God created the heavens and the earth.",
          "The earth was without form and void, and darkness was over the deep.",
          "And God said, \"Let there be light,\" and there was light."
        ],
        [
          "First verse of chapter 2.",
          "Second verse of chapter 2."
        ]
      ]
    },
    {
      "name": "John",
      "chapters": [
        ["In the beginning was the Word, and the Word was with God, and the Word was God."]
      ]
    }
  ]
}
```

[`examples/bible-abc.json`](examples/bible-abc.json) is a complete file you can copy and fill with your translation.

- `bible_code`: the translation code; the file name is derived from it.
- `bible_name`: *(optional)* the translation name (for example `Segond 21`), shown in the operator window and in the content manager. The code is shown instead when it is absent.
- `bible_copyright`: *(optional)* the translation's credit (publisher, license), for licenses that require attribution (for example `CC BY-NC-ND`). Shown in the operator window when the translation is selected, and at the bottom of the projection while a verse is on screen.
- `books`: the **ordered** list of books.
  - `name`: the book name, used for reference search.
  - `chapters`: an array of chapters, each one an array of verses.
  - Numbering follows the order: `chapters[0]` is chapter 1, and `chapters[0][0]` is verse 1.

### Development

```bash
npm install
npm run dev      # run the app in dev mode
npm run build    # production build + installers
```

Rust tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The website user guide (https://verso.akurba.com/guide.html) is the part of this README between the `<!-- website:start -->` and `<!-- website:end -->` markers. The site reads it from GitHub on every visit, so editing that part and pushing it to `master` is enough to update it. See `website/README.md`.

### Code structure

```
src/                       frontend (HTML/JS, no build step)
  operator.html            operator window
  projection.html          projection window
  utility.html             Settings, Shortcuts and About windows
  assets/js/               operator logic, rendering, data access
  assets/js/utility.js     lightweight utility-window logic
  assets/js/i18n.js        interface translations (English/French)
  vendor/pdfjs/            pdf.js bundled locally

src-tauri/                 Rust backend
  src/lib.rs               Tauri commands + windows
  src/storage.rs           file storage + initial seeding
  src/bible_search.rs      Bible reference resolution
  resources/               bundled collections + Bibles + images (seed)
  tauri.conf.json          config (windows, CSP, bundle)
```
