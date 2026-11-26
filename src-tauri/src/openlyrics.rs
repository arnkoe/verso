//! Passerelle OpenLyrics (format 0.9, https://docs.openlyrics.org) : lecture de
//! fichiers `.xml` (un chant par fichier, éventuellement réunis dans une archive
//! `.zip`) vers le modèle de Verso, et écriture d'un recueil en archive `.zip`
//! d'un fichier OpenLyrics par chant. Le JSON de Verso reste le format interne :
//! ce module ne touche à aucun fichier de l'app, `storage` s'en charge.
//!
//! Règles (validées avec l'utilisateur) :
//! - un seul recueil de destination, première langue seulement ;
//! - `<verseOrder>` suivi à l'import (une section répétée est recopiée, comme
//!   dans les recueils existants) ; sans `<verseOrder>`, ordre du fichier ;
//! - numéro (`source_number`) repris de `<songbook entry>` seulement si c'est un
//!   entier libre ; sinon chant sans numéro ;
//! - accords, commentaires et propriétés non gérées (thèmes, tonalité…) retirés ;
//! - à l'export, `<verseOrder>` est écrit et une section répétée ne l'est qu'une fois.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use roxmltree::Node;

use crate::storage::{Song, Verse};

const NS: &str = "http://openlyrics.info/namespace/2009/song";

/// Taille maximale lue pour un fichier OpenLyrics (un chant pèse quelques Ko) :
/// protège contre une archive piégée qui se décompresserait à l'infini.
const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;

/// Chant lu dans un fichier OpenLyrics, avant rattachement au recueil.
#[derive(Debug, Clone)]
pub struct ParsedSong {
    pub title: String,
    pub authors: Vec<String>,
    pub copyright: Option<String>,
    pub ccli: Option<u64>,
    /// `<songbook name entry>` dans l'ordre du fichier.
    pub songbooks: Vec<(String, Option<String>)>,
    /// Sections déjà ordonnées (verseOrder suivi), première langue seulement.
    pub verses: Vec<Verse>,
}

/// Fichier source à analyser : nom (pour le tri) et contenu brut.
pub struct SourceDoc {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Résultat d'une conversion : chants prêts à écrire et fichiers ignorés
/// (XML illisible ou qui n'est pas un chant OpenLyrics).
pub struct Converted {
    pub songs: Vec<Song>,
    pub ignored: usize,
}

// ─── Lecture ────────────────────────────────────────────────────────────────

fn is_el(n: &Node, name: &str) -> bool {
    n.is_element()
        && n.tag_name().name() == name
        && matches!(n.tag_name().namespace(), None | Some(NS))
}

fn child<'a, 'i>(n: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    n.children().find(|c| is_el(c, name))
}

fn children<'a, 'i>(n: Node<'a, 'i>, name: &'a str) -> impl Iterator<Item = Node<'a, 'i>> + 'a {
    n.children().filter(move |c| is_el(c, name))
}

/// Texte d'un élément simple (titre, auteur…), espaces normalisés.
fn plain_text(n: Node) -> String {
    let raw: String = n
        .descendants()
        .filter(|d| d.is_text())
        .filter_map(|d| d.text())
        .collect();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Décode le contenu d'un fichier : UTF-8 (BOM toléré) ou UTF-16 avec BOM.
fn decode(bytes: &[u8]) -> Option<String> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(rest.to_vec()).ok();
    }
    let utf16 = |rest: &[u8], le: bool| {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        String::from_utf16(&units).ok()
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, true);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, false);
    }
    String::from_utf8(bytes.to_vec()).ok()
}

/// Ajoute le texte d'un nœud `<lines>` (ou d'un descendant) au tampon. Les
/// sauts de ligne sont donnés par `<br/>` ; les accords (`<chord>`, qui peuvent
/// envelopper des paroles en 0.9) et les balises de mise en forme (`<tag>`)
/// sont traversés pour garder les paroles, les `<comment>` sont retirés.
fn collect_lines(n: Node, has_br: bool, buf: &mut String) {
    for c in n.children() {
        if c.is_text() {
            let t = c.text().unwrap_or("");
            if has_br {
                // Avec des <br/>, un retour à la ligne brut et l'indentation qui
                // le suit ne sont que de la mise en page du fichier (XML
                // indenté) : ils valent une espace. Les suites d'espaces sans
                // retour à la ligne (alignement voulu) sont gardées.
                buf.push_str(&collapse_newline_runs(t));
            } else {
                buf.extend(t.chars().filter(|&ch| ch != '\r'));
            }
        } else if c.is_element() {
            match c.tag_name().name() {
                "br" => buf.push('\n'),
                "comment" => {}
                _ => collect_lines(c, has_br, buf),
            }
        }
    }
}

/// Remplace chaque suite de blancs contenant un retour à la ligne par une
/// seule espace ; les autres caractères sont gardés tels quels.
fn collapse_newline_runs(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    let mut run = String::new();
    for ch in t.chars() {
        if ch.is_whitespace() {
            run.push(ch);
            continue;
        }
        if !run.is_empty() {
            if run.contains(['\n', '\r']) {
                out.push(' ');
            } else {
                out.push_str(&run);
            }
            run.clear();
        }
        out.push(ch);
    }
    if run.contains(['\n', '\r']) {
        out.push(' ');
    } else {
        out.push_str(&run);
    }
    out
}

/// Texte d'un `<lines>` : une ligne par `<br/>`. Un fichier sans aucun `<br/>`
/// qui passe à la ligne dans le texte (export non conforme) garde ses lignes.
fn lines_text(lines: Node) -> String {
    let has_br = lines.descendants().any(|d| d.is_element() && d.tag_name().name() == "br");
    let mut buf = String::new();
    collect_lines(lines, has_br, &mut buf);
    buf.split('\n')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Type et numéro Verso d'un nom de section OpenLyrics (`v1`, `c`, `p2`, `e`…).
/// Les noms libres de la version 0.8 (`chorus`, `bridge`…) sont rattachés par
/// leur initiale ; une initiale inconnue donne `other`.
pub fn verse_kind(name: &str) -> (&'static str, Option<i64>) {
    let lower = name.trim().to_lowercase();
    let mut chars = lower.chars();
    let vtype = match chars.next() {
        Some('v') => "verse",
        Some('c') => "chorus",
        Some('p') => "prechorus",
        Some('b') => "bridge",
        Some('i') => "intro",
        Some('e') => "outro",
        Some('m') => "middle",
        Some('s') => "solo",
        _ => "other",
    };
    let number = if vtype == "verse" {
        let digits: String = chars.take_while(|c| c.is_ascii_digit()).collect();
        digits.parse::<i64>().ok().filter(|n| *n > 0)
    } else {
        None
    };
    (vtype, number)
}

/// Lit un chant OpenLyrics. Erreur si le XML est illisible ou si ce n'est pas
/// un chant (racine `<song>`, un titre et au moins une section non vide).
pub fn parse_song(xml: &str) -> Result<ParsedSong, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("XML illisible : {e}"))?;
    let root = doc.root_element();
    if !is_el(&root, "song") {
        return Err("Ce n'est pas un chant OpenLyrics.".into());
    }
    let props = child(root, "properties");

    let title = props
        .and_then(|p| child(p, "titles"))
        .into_iter()
        .flat_map(|t| children(t, "title"))
        .map(plain_text)
        .find(|t| !t.is_empty())
        .ok_or("Chant sans titre.")?;

    let mut authors: Vec<String> = Vec::new();
    for a in props
        .and_then(|p| child(p, "authors"))
        .into_iter()
        .flat_map(|a| children(a, "author"))
    {
        let name = plain_text(a);
        if !name.is_empty() && !authors.contains(&name) {
            authors.push(name);
        }
    }

    let copyright = props.and_then(|p| child(p, "copyright")).map(plain_text).and_then(non_empty);
    let ccli = props
        .and_then(|p| child(p, "ccliNo"))
        .map(plain_text)
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|n| *n > 0);

    let songbooks = props
        .and_then(|p| child(p, "songbooks"))
        .into_iter()
        .flat_map(|s| children(s, "songbook"))
        .filter_map(|s| {
            let name = s.attribute("name")?.trim().to_string();
            let entry = s.attribute("entry").map(|e| e.trim().to_string());
            Some((name, entry))
        })
        .collect();

    let order: Vec<String> = props
        .and_then(|p| child(p, "verseOrder"))
        .map(plain_text)
        .map(|s| s.split_whitespace().map(|t| t.to_lowercase()).collect())
        .unwrap_or_default();

    // Sections de la première langue rencontrée (lang + translit du premier
    // <verse>) : un fichier multilingue répète chaque section par langue.
    let all: Vec<Node> = child(root, "lyrics")
        .into_iter()
        .flat_map(|l| children(l, "verse"))
        .collect();
    let first_lang = all.first().map(|v| (v.attribute("lang"), v.attribute("translit")));
    let mut sections: Vec<(String, Verse)> = Vec::new();
    for v in all {
        if Some((v.attribute("lang"), v.attribute("translit"))) != first_lang {
            continue;
        }
        let text = children(v, "lines")
            .map(lines_text)
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if text.is_empty() {
            continue;
        }
        let name = v.attribute("name").unwrap_or("").trim().to_lowercase();
        let (vtype, number) = verse_kind(&name);
        sections.push((name, Verse { vtype: vtype.to_string(), number, text }));
    }
    if sections.is_empty() {
        return Err("Chant sans paroles.".into());
    }

    let verses = apply_order(&sections, &order);
    Ok(ParsedSong { title, authors, copyright, ccli, songbooks, verses })
}

/// Applique `<verseOrder>` : chaque nom cité ajoute la section correspondante,
/// répétitions comprises. Un nom sans section exacte reprend ses parties
/// (`v1` → `v1a`, `v1b`) ; un nom inconnu (instrument…) est ignoré. Sans ordre
/// exploitable, l'ordre du fichier est gardé tel quel.
fn apply_order(sections: &[(String, Verse)], order: &[String]) -> Vec<Verse> {
    let mut out: Vec<Verse> = Vec::new();
    for token in order {
        let exact: Vec<&Verse> = sections.iter().filter(|(n, _)| n == token).map(|(_, v)| v).collect();
        if !exact.is_empty() {
            out.extend(exact.into_iter().cloned());
            continue;
        }
        out.extend(
            sections
                .iter()
                .filter(|(n, _)| {
                    n.strip_prefix(token.as_str())
                        .map(|rest| rest.len() == 1 && rest.chars().all(|c| c.is_ascii_lowercase()))
                        .unwrap_or(false)
                })
                .map(|(_, v)| v.clone()),
        );
    }
    if out.is_empty() {
        sections.iter().map(|(_, v)| v.clone()).collect()
    } else {
        out
    }
}

/// Numéro libre d'une entrée de recueil : entier positif sans autre caractère.
fn entry_number(entry: Option<&str>) -> Option<i64> {
    let e = entry?.trim();
    if e.is_empty() || !e.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    e.parse::<i64>().ok().filter(|n| *n > 0)
}

/// Convertit les fichiers lus en chants du recueil `code`. Le numéro vient du
/// `<songbook>` portant le nom du recueil de destination, sinon du premier ; un
/// numéro déjà pris par un chant précédent de l'import est abandonné.
pub fn convert(docs: Vec<SourceDoc>, book_name: &str, code: &str) -> Converted {
    let mut docs = docs;
    docs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let wanted = book_name.trim().to_lowercase();
    let mut used: HashSet<i64> = HashSet::new();
    let mut songs: Vec<Song> = Vec::new();
    let mut ignored = 0;
    for doc in docs {
        let Some(parsed) = decode(&doc.bytes).and_then(|xml| parse_song(&xml).ok()) else {
            ignored += 1;
            continue;
        };
        let book = parsed
            .songbooks
            .iter()
            .find(|(n, _)| n.to_lowercase() == wanted)
            .or_else(|| parsed.songbooks.first());
        let number = entry_number(book.and_then(|(_, e)| e.as_deref())).filter(|n| used.insert(*n));
        songs.push(Song {
            id: 0,
            title: parsed.title,
            author: non_empty(parsed.authors.join(", ")),
            copyright: parsed.copyright,
            ccli: parsed.ccli,
            songbook_code: Some(code.to_string()),
            source_number: number,
            verses: parsed.verses,
        });
    }
    // Chants numérotés d'abord, dans l'ordre des numéros ; les autres ensuite,
    // dans l'ordre des fichiers (tri stable).
    songs.sort_by_key(|s| (s.source_number.is_none(), s.source_number));
    Converted { songs, ignored }
}

/// Lit les fichiers choisis : `.zip` (toutes les entrées `.xml`, sous-dossiers
/// compris) ou fichier XML direct.
pub fn read_sources(paths: &[String]) -> Result<Vec<SourceDoc>, String> {
    let mut out = Vec::new();
    for p in paths {
        let path = Path::new(p);
        let display = path.file_name().and_then(|n| n.to_str()).unwrap_or(p).to_string();
        let is_zip = display.to_lowercase().ends_with(".zip");
        let file = fs::File::open(path).map_err(|e| format!("Lecture de {display} : {e}"))?;
        if is_zip {
            read_zip(file, &display, &mut out)?;
        } else {
            let mut bytes = Vec::new();
            file.take(MAX_XML_BYTES)
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Lecture de {display} : {e}"))?;
            out.push(SourceDoc { name: p.clone(), bytes });
        }
    }
    Ok(out)
}

fn read_zip<R: Read + std::io::Seek>(reader: R, display: &str, out: &mut Vec<SourceDoc>) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("Archive {display} illisible : {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Archive {display} illisible : {e}"))?;
        let name = entry.name().to_string();
        let hidden = name
            .split(['/', '\\'])
            .any(|part| part.starts_with('.') || part == "__MACOSX");
        if entry.is_dir() || hidden || !name.to_lowercase().ends_with(".xml") {
            continue;
        }
        let mut bytes = Vec::new();
        if (&mut entry).take(MAX_XML_BYTES).read_to_end(&mut bytes).is_err() {
            // Entrée corrompue : comptée comme fichier ignoré à la conversion.
            bytes.clear();
        }
        out.push(SourceDoc { name: format!("{display}/{name}"), bytes });
    }
    Ok(())
}

// ─── Écriture ───────────────────────────────────────────────────────────────

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // Caractères de contrôle interdits en XML 1.0 (hors tab/LF/CR).
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => o.push(c),
        }
    }
    o
}

/// Initiale OpenLyrics d'un type Verso. `middle` et `solo` n'existent en 0.9
/// que comme noms de parties instrumentales (`<instrument>`, sans paroles) : le
/// schéma les refuse pour `<verse>`, ils sont donc écrits en `o` (other).
fn type_prefix(vtype: &str) -> char {
    match crate::storage::canonical_vtype(vtype) {
        "verse" => 'v',
        "chorus" => 'c',
        "prechorus" => 'p',
        "bridge" => 'b',
        "intro" => 'i',
        "outro" => 'e',
        _ => 'o',
    }
}

/// Noms OpenLyrics des sections d'un chant : une section identique (même type,
/// même numéro de strophe, même texte) réutilise le nom de la première. Les
/// strophes gardent leur numéro (`v1`, `v2`…) ; pour les autres types, une seule
/// section distincte s'écrit sans numéro (`c`), plusieurs sont numérotées
/// (`c1`, `c2`), conformément au motif du schéma 0.9.
fn section_names(verses: &[Verse]) -> (Vec<String>, Vec<(String, usize)>) {
    let key = |v: &Verse| {
        let p = type_prefix(&v.vtype);
        let n = if p == 'v' { v.number } else { None };
        (p, n, v.text.clone())
    };
    // Sections distinctes par initiale, dans l'ordre d'apparition.
    let mut distinct: Vec<((char, Option<i64>, String), usize)> = Vec::new();
    for (i, v) in verses.iter().enumerate() {
        let k = key(v);
        if !distinct.iter().any(|(d, _)| *d == k) {
            distinct.push((k, i));
        }
    }
    let mut per_prefix: HashMap<char, usize> = HashMap::new();
    for ((p, _, _), _) in &distinct {
        *per_prefix.entry(*p).or_default() += 1;
    }
    let mut taken: HashSet<String> = HashSet::new();
    let mut counters: HashMap<char, i64> = HashMap::new();
    let mut names: HashMap<(char, Option<i64>, String), String> = HashMap::new();
    let mut unique: Vec<(String, usize)> = Vec::new();
    for (k, first) in &distinct {
        let (p, n, _) = k;
        let name = if *p == 'v' {
            match n.map(|n| format!("v{n}")).filter(|c| !taken.contains(c)) {
                Some(c) => c,
                None => {
                    let mut i = 1;
                    while taken.contains(&format!("v{i}")) {
                        i += 1;
                    }
                    format!("v{i}")
                }
            }
        } else if per_prefix[p] == 1 {
            p.to_string()
        } else {
            let c = counters.entry(*p).or_default();
            *c += 1;
            format!("{p}{c}")
        };
        taken.insert(name.clone());
        names.insert(k.clone(), name.clone());
        unique.push((name, *first));
    }
    let order = verses.iter().map(|v| names[&key(v)].clone()).collect();
    (order, unique)
}

/// Écrit un chant au format OpenLyrics 0.9. `generator` renseigne `createdIn`
/// et `modifiedIn` (« Verso 0.7.0 »), `modified` la date `xs:dateTime`.
pub fn song_to_xml(song: &Song, book_name: &str, generator: &str, modified: &str) -> String {
    let (order, unique) = section_names(&song.verses);
    let mut x = String::new();
    x.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    x.push_str(&format!(
        "<song xmlns=\"{NS}\" version=\"0.9\" createdIn=\"{g}\" modifiedIn=\"{g}\" modifiedDate=\"{m}\">\n",
        g = esc(generator),
        m = esc(modified)
    ));
    x.push_str("  <properties>\n");
    x.push_str(&format!("    <titles>\n      <title>{}</title>\n    </titles>\n", esc(song.title.trim())));
    if let Some(a) = song.author.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        x.push_str(&format!("    <authors>\n      <author>{}</author>\n    </authors>\n", esc(a)));
    }
    if let Some(c) = song.copyright.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        x.push_str(&format!("    <copyright>{}</copyright>\n", esc(c)));
    }
    if let Some(n) = song.ccli.filter(|n| *n > 0) {
        x.push_str(&format!("    <ccliNo>{n}</ccliNo>\n"));
    }
    x.push_str(&format!("    <verseOrder>{}</verseOrder>\n", order.join(" ")));
    let entry = song
        .source_number
        .map(|n| format!(" entry=\"{n}\""))
        .unwrap_or_default();
    x.push_str(&format!(
        "    <songbooks>\n      <songbook name=\"{}\"{entry}/>\n    </songbooks>\n",
        esc(book_name.trim())
    ));
    x.push_str("  </properties>\n  <lyrics>\n");
    for (name, i) in unique {
        let lines: Vec<String> = song.verses[i]
            .text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(esc)
            .collect();
        x.push_str(&format!(
            "    <verse name=\"{name}\">\n      <lines>{}</lines>\n    </verse>\n",
            lines.join("<br/>")
        ));
    }
    x.push_str("  </lyrics>\n</song>\n");
    x
}

/// Nom de fichier d'un chant dans l'archive (« 27 - Gloire à ton nom.xml »),
/// sans caractère interdit sous Windows ou macOS, unique dans l'archive.
fn entry_filename(song: &Song, used: &mut HashSet<String>) -> String {
    let title: String = song
        .title
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { ' ' } else { c })
        .collect();
    let mut title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    title = title.trim_matches(['.', ' ']).chars().take(100).collect();
    if title.is_empty() {
        title = "Song".into();
    }
    let base = match song.source_number {
        Some(n) => format!("{n} - {title}"),
        None => title,
    };
    let mut name = format!("{base}.xml");
    let mut i = 2;
    while !used.insert(name.to_lowercase()) {
        name = format!("{base} ({i}).xml");
        i += 1;
    }
    name
}

/// Archive `.zip` d'un fichier OpenLyrics par chant, construite en mémoire.
pub fn songbook_zip(songs: &[Song], book_name: &str, generator: &str, modified: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut used = HashSet::new();
    for song in songs {
        let name = entry_filename(song, &mut used);
        zip.start_file(name, opts).map_err(|e| format!("Archive : {e}"))?;
        zip.write_all(song_to_xml(song, book_name, generator, modified).as_bytes())
            .map_err(|e| format!("Archive : {e}"))?;
    }
    let cursor = zip.finish().map_err(|e| format!("Archive : {e}"))?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AMAZING: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
  <properties>
    <titles>
      <title>Gloire à ton nom</title>
      <title lang="en">Glory to your name</title>
    </titles>
    <authors>
      <author type="words">Jean Martin</author>
      <author type="music">Paul Durand</author>
      <author type="music">Jean Martin</author>
    </authors>
    <copyright>2001 Éditions &amp; Co</copyright>
    <ccliNo>4639462</ccliNo>
    <verseOrder>v1 c v2 c</verseOrder>
    <songbooks>
      <songbook name="Autre recueil" entry="12"/>
      <songbook name="Sur les ailes de la foi" entry="27"/>
    </songbooks>
    <themes><theme>Louange</theme></themes>
    <key>G</key>
  </properties>
  <lyrics>
    <verse name="v1">
      <lines>
        <chord root="G"/>Première ligne<br/>
        <chord root="D">deuxi</chord>ème ligne
      </lines>
    </verse>
    <verse name="c">
      <lines>Refrain un<br/>Refrain <comment>bis</comment>deux</lines>
    </verse>
    <verse name="v2">
      <lines>Seconde strophe</lines>
      <lines part="men">suite</lines>
    </verse>
  </lyrics>
</song>"#;

    #[test]
    fn parses_fields_and_follows_verse_order() {
        let s = parse_song(AMAZING).unwrap();
        assert_eq!(s.title, "Gloire à ton nom");
        assert_eq!(s.authors, vec!["Jean Martin", "Paul Durand"]);
        assert_eq!(s.copyright.as_deref(), Some("2001 Éditions & Co"));
        assert_eq!(s.ccli, Some(4639462));
        let kinds: Vec<(&str, Option<i64>)> = s.verses.iter().map(|v| (v.vtype.as_str(), v.number)).collect();
        assert_eq!(
            kinds,
            vec![("verse", Some(1)), ("chorus", None), ("verse", Some(2)), ("chorus", None)]
        );
        assert_eq!(s.verses[0].text, "Première ligne\ndeuxième ligne");
        assert_eq!(s.verses[1].text, "Refrain un\nRefrain deux");
        assert_eq!(s.verses[2].text, "Seconde strophe\nsuite");
        assert_eq!(s.verses[3].text, s.verses[1].text);
    }

    #[test]
    fn without_verse_order_keeps_file_order_once() {
        let xml = r#"<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
          <properties><titles><title>T</title></titles></properties>
          <lyrics>
            <verse name="c"><lines>R</lines></verse>
            <verse name="v1"><lines>A</lines></verse>
            <verse name="o"><lines>O</lines></verse>
            <verse name="e"><lines>E</lines></verse>
            <verse name="p1"><lines>P</lines></verse>
          </lyrics></song>"#;
        let s = parse_song(xml).unwrap();
        let types: Vec<&str> = s.verses.iter().map(|v| v.vtype.as_str()).collect();
        assert_eq!(types, vec!["chorus", "verse", "other", "outro", "prechorus"]);
    }

    #[test]
    fn verse_order_parts_and_unknown_names() {
        let xml = r#"<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
          <properties><titles><title>T</title></titles><verseOrder>i1 v1 m1 c</verseOrder></properties>
          <lyrics>
            <verse name="v1a"><lines>A</lines></verse>
            <verse name="v1b"><lines>B</lines></verse>
            <verse name="c"><lines>R</lines></verse>
          </lyrics></song>"#;
        let s = parse_song(xml).unwrap();
        let texts: Vec<&str> = s.verses.iter().map(|v| v.text.as_str()).collect();
        assert_eq!(texts, vec!["A", "B", "R"]);
    }

    #[test]
    fn keeps_first_language_only() {
        let xml = r#"<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
          <properties><titles><title>T</title></titles></properties>
          <lyrics>
            <verse name="v1" lang="fr"><lines>Un</lines></verse>
            <verse name="v1" lang="en"><lines>One</lines></verse>
            <verse name="v2" lang="fr"><lines>Deux</lines></verse>
          </lyrics></song>"#;
        let s = parse_song(xml).unwrap();
        let texts: Vec<&str> = s.verses.iter().map(|v| v.text.as_str()).collect();
        assert_eq!(texts, vec!["Un", "Deux"]);
    }

    #[test]
    fn lines_without_br_keep_raw_line_breaks() {
        let xml = "<song xmlns=\"http://openlyrics.info/namespace/2009/song\" version=\"0.9\">\
          <properties><titles><title>T</title></titles></properties>\
          <lyrics><verse name=\"v1\"><lines>\n  Ligne un\n  Ligne deux\n</lines></verse></lyrics></song>";
        assert_eq!(parse_song(xml).unwrap().verses[0].text, "Ligne un\nLigne deux");
    }

    #[test]
    fn rejects_non_songs() {
        assert!(parse_song("<notes/>").is_err());
        assert!(parse_song("<song><properties").is_err());
        assert!(parse_song(r#"<song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>T</title></titles></properties><lyrics/></song>"#).is_err());
    }

    fn doc(name: &str, title: &str, books: &str) -> SourceDoc {
        let xml = format!(
            r#"<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
              <properties><titles><title>{title}</title></titles><songbooks>{books}</songbooks></properties>
              <lyrics><verse name="v1"><lines>x</lines></verse></lyrics></song>"#
        );
        SourceDoc { name: name.into(), bytes: xml.into_bytes() }
    }

    #[test]
    fn numbers_only_free_integers() {
        let docs = vec![
            doc("a.xml", "A", r#"<songbook name="ALF" entry="27"/>"#),
            doc("b.xml", "B", r#"<songbook name="ALF" entry="27"/>"#),
            doc("c.xml", "C", r#"<songbook name="ALF" entry="153b"/>"#),
            doc("d.xml", "D", r#"<songbook name="ALF"/>"#),
            doc("e.xml", "E", r#"<songbook name="Autre" entry="3"/><songbook name="alf" entry="4"/>"#),
            SourceDoc { name: "f.xml".into(), bytes: b"<oops".to_vec() },
            SourceDoc { name: "g.xml".into(), bytes: b"<notes/>".to_vec() },
        ];
        let out = convert(docs, "ALF", "ALF");
        assert_eq!(out.ignored, 2);
        let got: Vec<(&str, Option<i64>)> =
            out.songs.iter().map(|s| (s.title.as_str(), s.source_number)).collect();
        assert_eq!(
            got,
            vec![("E", Some(4)), ("A", Some(27)), ("B", None), ("C", None), ("D", None)]
        );
        assert!(out.songs.iter().all(|s| s.songbook_code.as_deref() == Some("ALF")));
    }

    fn verse(t: &str, n: Option<i64>, text: &str) -> Verse {
        Verse { vtype: t.into(), number: n, text: text.into() }
    }

    #[test]
    fn export_writes_repeated_sections_once_and_round_trips() {
        let song = Song {
            id: 0,
            title: "Gloire <à> ton nom".into(),
            author: Some("Jean Martin, Paul Durand".into()),
            copyright: Some("2001 Éditions & Co".into()),
            ccli: Some(4639462),
            songbook_code: Some("ALF".into()),
            source_number: Some(27),
            verses: vec![
                verse("verse", Some(1), "Un\ndeux"),
                verse("chorus", None, "Refrain"),
                verse("verse", Some(2), "Trois"),
                verse("chorus", None, "Refrain"),
                verse("middle", None, "Milieu"),
                verse("outro", None, "Fin"),
            ],
        };
        let xml = song_to_xml(&song, "Sur les ailes de la foi", "Verso 0.7.0", "2026-11-26T15:20:00+01:00");
        assert!(xml.contains("<verseOrder>v1 c v2 c o e</verseOrder>"));
        assert_eq!(xml.matches("<verse name=").count(), 5);
        assert!(xml.contains(r#"<songbook name="Sur les ailes de la foi" entry="27"/>"#));
        assert!(xml.contains("<lines>Un<br/>deux</lines>"));

        let back = parse_song(&xml).unwrap();
        assert_eq!(back.title, song.title);
        assert_eq!(back.authors, vec!["Jean Martin, Paul Durand"]);
        assert_eq!(back.copyright, song.copyright);
        assert_eq!(back.ccli, song.ccli);
        assert_eq!(back.songbooks, vec![("Sur les ailes de la foi".to_string(), Some("27".to_string()))]);
        let texts: Vec<&str> = back.verses.iter().map(|v| v.text.as_str()).collect();
        assert_eq!(texts, vec!["Un\ndeux", "Refrain", "Trois", "Refrain", "Milieu", "Fin"]);
        assert_eq!(back.verses[4].vtype, "other");
    }

    #[test]
    fn export_numbers_distinct_sections_of_one_type() {
        let verses = vec![
            verse("chorus", None, "R1"),
            verse("verse", None, "A"),
            verse("chorus", None, "R2"),
            verse("verse", Some(1), "B"),
        ];
        let (order, unique) = section_names(&verses);
        assert_eq!(order, vec!["c1", "v1", "c2", "v2"]);
        assert_eq!(unique.len(), 4);
    }

    #[test]
    fn zip_round_trip_through_reader() {
        let song = |t: &str, n: Option<i64>| Song {
            id: 0,
            title: t.into(),
            author: None,
            copyright: None,
            ccli: None,
            songbook_code: Some("ALF".into()),
            source_number: n,
            verses: vec![verse("verse", Some(1), "x")],
        };
        let songs = vec![song("A/B", Some(1)), song("A/B", Some(1)), song("C", None)];
        let bytes = songbook_zip(&songs, "ALF", "Verso", "2026-11-26T15:20:00Z").unwrap();
        let mut docs = Vec::new();
        read_zip(Cursor::new(bytes), "x.zip", &mut docs).unwrap();
        let mut names: Vec<&str> = docs.iter().map(|d| d.name.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["x.zip/1 - A B (2).xml", "x.zip/1 - A B.xml", "x.zip/C.xml"]);
        let out = convert(docs, "ALF", "ALF");
        assert_eq!(out.ignored, 0);
        assert_eq!(out.songs.len(), 3);
    }

    fn manifest_path(rel: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
    }

    #[test]
    fn example_file_matches_the_documented_mapping() {
        let xml = fs::read_to_string(manifest_path("../examples/openlyrics-abc.xml")).unwrap();
        let out = convert(vec![SourceDoc { name: "x.xml".into(), bytes: xml.into_bytes() }], "Mon recueil", "ABC");
        let s = &out.songs[0];
        assert_eq!(s.source_number, Some(1));
        assert_eq!(s.ccli, Some(1234567));
        assert_eq!(s.copyright.as_deref(), Some("© 2001 Éditeur (facultatif)"));
        let types: Vec<&str> = s.verses.iter().map(|v| v.vtype.as_str()).collect();
        assert_eq!(types, vec!["verse", "chorus", "verse", "chorus", "bridge"]);
    }

    /// Export puis réimport de recueils réels (l'exemple documenté, et les
    /// recueils empaquetés quand le sous-module est présent) : titres, numéros,
    /// auteurs et suite des sections (type + texte) sont conservés.
    #[test]
    fn songbooks_round_trip_through_openlyrics() {
        let mut files = vec![manifest_path("../examples/songbook-abc.json")];
        files.extend(crate::storage::songbook_files(&manifest_path("resources/songbooks")));
        for file in files {
            let book: crate::storage::Songbook =
                serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
            let name = book.songbook_name.clone().unwrap_or_default();
            let songs: Vec<Song> = book
                .songs
                .into_iter()
                .map(|mut s| {
                    for v in &mut s.verses {
                        v.vtype = crate::storage::canonical_vtype(&v.vtype).to_string();
                    }
                    s
                })
                .collect();
            let zip = songbook_zip(&songs, &name, "Verso", "2026-11-26T15:20:00Z").unwrap();
            let mut docs = Vec::new();
            read_zip(Cursor::new(zip), "x.zip", &mut docs).unwrap();
            let back = convert(docs, &name, "X");
            assert_eq!(back.ignored, 0, "{}", file.display());
            assert_eq!(back.songs.len(), songs.len(), "{}", file.display());
            let sig = |s: &Song| {
                let verses: Vec<(String, String)> = s
                    .verses
                    .iter()
                    .map(|v| (v.vtype.clone(), v.text.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")))
                    .collect();
                (s.source_number, s.title.trim().to_string(), s.author.clone().filter(|a| !a.trim().is_empty()), verses)
            };
            let mut want: Vec<_> = songs.iter().map(sig).collect();
            let mut got: Vec<_> = back.songs.iter().map(sig).collect();
            want.sort();
            got.sort();
            for (w, g) in want.iter().zip(&got) {
                assert_eq!(w, g, "{}", file.display());
            }
        }
    }
}
