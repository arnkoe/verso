# Verso

*[Français](README.fr.md)*

Verso is software for projecting songs and Bible texts onto a large screen or a video projector during a church service.

You work in one window (the **operator** window, on your computer) and what you choose appears in a second window, full screen, on the projector.

The interface is available in **English** (the default) and **French**. You can switch language at any time from the Settings.

---

## Installing Verso

1. Go to the project's **Releases** page.
2. Download the file that matches your computer:
   - **Windows**: the file whose name ends in `setup.exe`.
   - **Recent Mac (Apple Silicon, since 2020)**: the `.dmg` file that contains `aarch64`.
   - **Older Mac (Intel chip)**: the `.dmg` file that contains `x64`.

   If you are not sure which Mac you have: Apple menu  (top left) → **About This Mac**. The "Chip" or "Processor" line tells you.

3. Open the downloaded file and follow the instructions below for your system.

> The very first time you launch it, your computer will show a scary-looking message. **This is normal and it is not a virus.** It happens because Verso is a small, free program that has not paid for the expensive Microsoft and Apple certificates. Here is how to get past this step, once.

### On Windows

When you run the `setup.exe` file, Windows may show a **blue screen**: "Windows protected your PC".

To continue:

1. Click the small text **"More info"**.
2. A **"Run anyway"** button appears. Click it.

Installation continues normally. You will never have to do this again: future updates install by themselves.

### On Mac

1. Open the `.dmg` file you downloaded.
2. A window opens. **Drag the Verso icon onto the Applications folder** shown next to it.
3. If, when you try to open Verso, the Mac says "Verso" is damaged and can't be opened", you need a small one-time fix:

   a. Open the **Terminal** app. To find it: press **Cmd () + Space**, type `Terminal`, then press **Enter**.

   b. In the black window that opens, copy and paste exactly the following line:

   ```
   xattr -dr com.apple.quarantine /Applications/Verso.app
   ```

   c. Press **Enter**. (Nothing is displayed: that's a good sign.)

   d. Close the Terminal and open Verso normally.

You will never have to do this again: future updates install by themselves.

---

## Updating Verso

You have nothing to monitor. Every time it starts, Verso checks on its own whether a newer version exists.

If one is available, a small **dot** appears on the **"About"** button. Click that button: a link offers to install the update, then Verso restarts. That's all.

You can also check for updates manually from **Settings → Updates**.

---

## Your songs, bibles and documents

Verso keeps everything in a folder named **`Verso`** inside the application data folder for your account. You don't need to know its exact location: open **Settings** (the gear button in the toolbar), then under **Content** click **Open** next to "Verso folder" to open it directly.

Inside, you will find:

- **`songbooks`** — your song collections (one file per collection).
- **`bibles`** — your Bible translations (one file per translation).
- **`pdf`** — the PDF documents you want to project.
- **`images`** — the images you want to project.

To add your own PDFs or images, simply drop your files into the `pdf` or `images` folder.

The first time you launch Verso, if the folder is empty, Verso automatically adds some free content to get you started: the **Reflets** and **HEC** collections, and the **Darby** and **Louis Segond** bibles. You can keep, edit or delete them as you wish. Verso never touches your files if you have already added some.

Verso also remembers what was being projected last time and brings it back when you reopen it.

---

## Using Verso

The operator window has four tabs: **Songs**, **Bible**, **PDF** and **Images**.

The principle is always the same: you search for what you want, you select it, and it appears on the projector.

Song search is forgiving: it ignores accents and apostrophes, accepts several words, and matches both the song number and the opening words (incipit).

### The keyboard shortcuts that save time

These shortcuts work in the operator window (the one on your computer).

**Switching tabs**

- **Tab**: move to the next tab (Songs → Bible → PDF → Images).
- **Shift + Tab**: go back to the previous tab.

**Searching**

- **/** (the slash key): jump straight to the search field.
- **Up / Down arrows**: move through the list of results.
- **Enter**: confirm the selected result.

**Projecting and moving forward**

- **Down arrow** or **right arrow**: next item (next verse, next Bible verse, next page).
- **Up arrow** or **left arrow**: previous item.
- **Enter**: project the next item (or the first one if nothing is projected yet).
- **Esc**: clear the projection (blank screen).

**In the projection window**

- **Esc**: close the projection window.

### Settings

The **Settings** button (gear icon) in the toolbar opens a panel with sections:

- **Content** — open the Verso folder where your collections, bibles and media live.
- **Language** — switch the interface between English and French.
- **Updates** — check manually for a new version and install it.

You can close Settings by clicking the background or pressing **Esc**.

---

## Going further (technical section)

This section is for people comfortable with JSON files or code. You do **not** need it for everyday use of Verso.

### Adding a song collection

A collection is a file kept in `songbooks`, whose name starts with `songbook-` and ends with `.json` (for example `songbook-mycollection.json`).

The file is an object carrying the collection name once, then the list of songs:

```json
{
  "songbook_code": "MR",
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

- `songbook_code` — collection code, repeated on every file of the collection.
- `songbook_name` — the collection's human-readable name.
- `songs` — the list of songs. Each song has:
- `title` — title shown and searched.
- `author` — text, or `null` if unknown.
- `source_number` — the song's number within the collection (or `null`).
- `verses` — the **ordered** list of stanzas. Each stanza has:
  - `type` — section type. Common values: `"verse"`, `"chorus"`, `"bridge"`, `"intro"`, `"outro"`, `"prechorus"`. Absent → verse. Choruses are labelled "Chorus"; any other type is shown as a verse.
  - `number` — stanza number (optional).
  - `text` — the text; line breaks are written `\n`.

JSON does not allow a real line break inside a text value: write `\n` for each line break in `text`.

A complete file is available in [`examples/songbook-exemple.json`](examples/songbook-exemple.json): you can copy it and fill it with your own songs.

### Adding a bible

A translation is a file kept in `bibles`, whose name starts with `bible-` and ends with `.json` (for example `bible-s21.json`).

```json
{
  "bible_code": "S21",
  "bible_name": "Segond 21",
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

A complete file is available in [`examples/bible-exemple.json`](examples/bible-exemple.json): you can copy it and fill it with your translation.

- `bible_code` — the translation code (ideally identical to the file name).
- `bible_name` — *(optional)* the readable translation name (for example `Segond 21`); shown in the operator and in the content manager. Falls back to the code if absent.
- `books` — the **ordered** list of books.
  - `name` — the book name (used for reference search).
  - `chapters` — an array of chapters; each chapter is an array of verses (texts).
  - Order is authoritative: `chapters[0]` is chapter 1, and `chapters[0][0]` is verse 1.

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

### Code structure

```
src/                       frontend (HTML/JS, no build step)
  operator.html            operator window
  projection.html          projection window
  assets/js/               operator logic, rendering, data access
  assets/js/i18n.js        interface translations (English/French)
  vendor/pdfjs/            pdf.js bundled locally

src-tauri/                 Rust backend
  src/lib.rs               Tauri commands + windows
  src/storage.rs           file storage + initial seeding
  src/bible_search.rs      Bible reference resolution
  resources/               royalty-free collections + bibles bundled (seed)
  tauri.conf.json          config (windows, CSP, bundle)
```
