//! Recherche biblique — portage de api/bible/search.php.
//! Résout une référence ("Jean 3:16", "rom3", "1jean3:16-20") ou liste les livres
//! dont le nom contient la requête.

use serde::Serialize;

use crate::storage::Bible;

#[derive(Debug, Serialize)]
pub struct BibleVerse {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum BibleSearchResult {
    Verses {
        verses: Vec<BibleVerse>,
        translation: String,
    },
    Books {
        books: Vec<String>,
        translation: String,
    },
}

/// Normalise : minuscule, sans accents, sans espaces (pour que "1chr" matche "1 Chroniques").
fn strip_accents(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.to_lowercase().chars() {
        let mapped = match ch {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'ē' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
            'ý' | 'ÿ' => 'y',
            c if c.is_whitespace() => continue,
            c => c,
        };
        out.push(mapped);
    }
    out
}

/// Cherche les livres dont le nom normalisé matche `needle`.
/// Priorité : égalité exacte > préfixe > contient.
fn find_books(
    bible: &Bible,
    needle: &str,
    requires_leading_digit: bool,
) -> Vec<String> {
    let n = strip_accents(needle);
    let (mut exact, mut prefix, mut contains) = (vec![], vec![], vec![]);
    for book in &bible.books {
        let b = strip_accents(&book.name);
        if requires_leading_digit && !b.chars().next().map_or(false, |c| c.is_ascii_digit()) {
            continue;
        }
        if b == n {
            exact.push(book.name.clone());
        } else if b.starts_with(&n) {
            prefix.push(book.name.clone());
        } else if b.contains(&n) {
            contains.push(book.name.clone());
        }
    }
    if !exact.is_empty() {
        return exact;
    }
    if !prefix.is_empty() {
        return prefix;
    }
    contains
}

struct ParsedRef {
    book_raw: String,
    chapter: i64,
    v_start: Option<i64>,
    v_end: Option<i64>,
}

/// Parse une référence type "1 Jean 3:16-20". Retourne None si pas une référence.
fn parse_ref(q: &str) -> Option<ParsedRef> {
    // Equivalent du regex PHP : ^(\d?\s*[A-Za-zÀ-ÿ]+\.?)\s*(\d+)(?::(\d+)(?:-(\d+))?)?$
    let chars: Vec<char> = q.trim().chars().collect();
    let mut i = 0;
    let n = chars.len();
    if n == 0 {
        return None;
    }

    // book_raw : un chiffre optionnel, espaces, puis lettres (avec accents), point optionnel.
    let start = i;
    if chars[i].is_ascii_digit() {
        i += 1;
    }
    while i < n && chars[i].is_whitespace() {
        i += 1;
    }
    let letters_start = i;
    while i < n && (chars[i].is_alphabetic()) {
        i += 1;
    }
    if i == letters_start {
        return None; // aucune lettre → pas un nom de livre
    }
    if i < n && chars[i] == '.' {
        i += 1;
    }
    let book_raw: String = chars[start..i].iter().collect::<String>().trim().to_string();

    while i < n && chars[i].is_whitespace() {
        i += 1;
    }

    // chapitre (obligatoire)
    let ch_start = i;
    while i < n && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == ch_start {
        return None;
    }
    let chapter: i64 = chars[ch_start..i].iter().collect::<String>().parse().ok()?;

    let mut v_start = None;
    let mut v_end = None;

    if i < n && chars[i] == ':' {
        i += 1;
        let vs = i;
        while i < n && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i == vs {
            return None;
        }
        let s: i64 = chars[vs..i].iter().collect::<String>().parse().ok()?;
        v_start = Some(s);
        v_end = Some(s);
        if i < n && chars[i] == '-' {
            i += 1;
            let ve = i;
            while i < n && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i == ve {
                return None;
            }
            v_end = Some(chars[ve..i].iter().collect::<String>().parse().ok()?);
        }
    }

    if i != n {
        return None; // caractères en trop → pas une référence propre
    }

    Some(ParsedRef {
        book_raw,
        chapter,
        v_start,
        v_end,
    })
}

fn collect_verses(
    bible: &Bible,
    candidates: &[String],
    chapter: i64,
    v_start: Option<i64>,
    v_end: Option<i64>,
) -> Vec<BibleVerse> {
    let mut out = vec![];
    for cand in candidates {
        let Some(book) = bible.books.iter().find(|b| &b.name == cand) else {
            continue;
        };
        let ch_idx = (chapter - 1) as usize;
        let Some(verses) = book.chapters.get(ch_idx) else {
            continue;
        };
        match (v_start, v_end) {
            (Some(vs), Some(ve)) => {
                for v in vs..=ve {
                    if let Some(text) = verses.get((v - 1) as usize) {
                        out.push(BibleVerse {
                            book: book.name.clone(),
                            chapter,
                            verse: v,
                            text: text.clone(),
                        });
                    }
                }
            }
            _ => {
                for (idx, text) in verses.iter().enumerate().take(200) {
                    out.push(BibleVerse {
                        book: book.name.clone(),
                        chapter,
                        verse: (idx + 1) as i64,
                        text: text.clone(),
                    });
                }
            }
        }
    }
    out
}

/// Point d'entrée : reproduit la logique de search.php.
pub fn search(bible: &Bible, q: &str) -> Result<BibleSearchResult, String> {
    let q = q.trim();
    if q.is_empty() {
        return Err("q (référence) requis".into());
    }

    if let Some(r) = parse_ref(q) {
        // "1chr" → chiffre initial + nom ; "jean" → nom seul.
        let book_raw = &r.book_raw;
        let candidates = if let Some(first) = book_raw.chars().next().filter(|c| c.is_ascii_digit())
        {
            let rest: String = book_raw.chars().skip(1).collect();
            let rest = rest.trim();
            let with_digit = find_books(bible, &format!("{first}{rest}"), true);
            if with_digit.is_empty() {
                find_books(bible, rest, true)
            } else {
                with_digit
            }
        } else {
            find_books(bible, book_raw, false)
        };

        if candidates.is_empty() {
            return Err("Référence introuvable".into());
        }

        let verses = collect_verses(bible, &candidates, r.chapter, r.v_start, r.v_end);
        if verses.is_empty() {
            return Err("Référence introuvable".into());
        }
        return Ok(BibleSearchResult::Verses {
            verses,
            translation: bible.translation.clone(),
        });
    }

    // Recherche par nom de livre.
    let mut books = find_books(bible, q, false);
    books.sort();
    books.truncate(20);
    Ok(BibleSearchResult::Books {
        books,
        translation: bible.translation.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::BibleBook;

    fn fixture() -> Bible {
        Bible {
            translation: "TST".into(),
            books: vec![
                BibleBook {
                    name: "Genèse".into(),
                    chapters: vec![vec!["Au commencement…".into(), "La terre…".into()]],
                },
                BibleBook {
                    name: "1 Chroniques".into(),
                    chapters: vec![vec!["Adam…".into()]],
                },
                BibleBook {
                    name: "Jean".into(),
                    chapters: vec![
                        vec![],
                        vec![],
                        vec![
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            String::new(),
                            "Car Dieu a tant aimé le monde…".into(),
                        ],
                    ],
                },
            ],
        }
    }

    #[test]
    fn resolves_single_verse() {
        let b = fixture();
        match search(&b, "Jean 3:16").unwrap() {
            BibleSearchResult::Verses { verses, .. } => {
                assert_eq!(verses.len(), 1);
                assert_eq!(verses[0].verse, 16);
                assert!(verses[0].text.contains("aimé"));
            }
            _ => panic!("attendu des versets"),
        }
    }

    #[test]
    fn leading_digit_book() {
        let b = fixture();
        match search(&b, "1chr1").unwrap() {
            BibleSearchResult::Verses { verses, .. } => {
                assert_eq!(verses[0].book, "1 Chroniques");
            }
            _ => panic!("attendu des versets"),
        }
    }

    #[test]
    fn accent_insensitive_book_list() {
        let b = fixture();
        match search(&b, "genese").unwrap() {
            BibleSearchResult::Books { books, .. } => {
                assert!(books.contains(&"Genèse".to_string()));
            }
            _ => panic!("attendu une liste de livres"),
        }
    }

    #[test]
    fn whole_chapter() {
        let b = fixture();
        match search(&b, "Genèse 1").unwrap() {
            BibleSearchResult::Verses { verses, .. } => assert_eq!(verses.len(), 2),
            _ => panic!("attendu des versets"),
        }
    }
}
