#!/usr/bin/env python3
"""Convertit une Bible au format OSIS XML en JSON compatible Verso.

Le JSON produit suit le schéma attendu par Verso (cf. examples/bible-abc.json) :

    {
      "bible_code": "BPC",
      "bible_name": "Version BPC",
      "bible_copyright": "…",        # optionnel, pour la mention de licence
      "books": [
        { "name": "Genèse", "chapters": [ [ "verset 1", "verset 2", … ], … ] },
        …
      ]
    }

Les versets OSIS sont délimités par des jalons `<verse sID=… />` / `<verse eID=… />`.
Le texte de chaque verset est reconstruit dans l'ordre du document ; les `<note>`
(notes de bas de page) et les `<title>` (titres de section/chapitre) sont ignorés,
seul le texte biblique est conservé.

Usage :
    python3 scripts/osis_to_verso.py entree.xml sortie.json \
        --code BPC --name "Version BPC" \
        --copyright "Bibles et Publications Chrétiennes – CC BY-NC-ND"
"""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET

# OSIS book id -> nom français utilisé par Verso (aligné sur bible-drb.json,
# pour que « Jean 3.16 » désigne le même livre quelle que soit la traduction).
OSIS_TO_FR = {
    "Gen": "Genèse", "Exod": "Exode", "Lev": "Lévitique", "Num": "Nombres",
    "Deut": "Deutéronome", "Josh": "Josué", "Judg": "Juges", "Ruth": "Ruth",
    "1Sam": "1 Samuel", "2Sam": "2 Samuel", "1Kgs": "1 Rois", "2Kgs": "2 Rois",
    "1Chr": "1 Chroniques", "2Chr": "2 Chroniques", "Ezra": "Esdras",
    "Neh": "Néhémie", "Esth": "Esther", "Job": "Job", "Ps": "Psaumes",
    "Prov": "Proverbes", "Eccl": "Ecclésiaste", "Song": "Cantique",
    "Isa": "Ésaïe", "Jer": "Jérémie", "Lam": "Lamentations", "Ezek": "Ézéchiel",
    "Dan": "Daniel", "Hos": "Osée", "Joel": "Joël", "Amos": "Amos",
    "Obad": "Abdias", "Jonah": "Jonas", "Mic": "Michée", "Nah": "Nahoum",
    "Hab": "Habacuc", "Zeph": "Sophonie", "Hag": "Aggée", "Zech": "Zacharie",
    "Mal": "Malachie", "Matt": "Matthieu", "Mark": "Marc", "Luke": "Luc",
    "John": "Jean", "Acts": "Actes", "Rom": "Romains", "1Cor": "1 Corinthiens",
    "2Cor": "2 Corinthiens", "Gal": "Galates", "Eph": "Éphésiens",
    "Phil": "Philippiens", "Col": "Colossiens", "1Thess": "1 Thessaloniciens",
    "2Thess": "2 Thessaloniciens", "1Tim": "1 Timothée", "2Tim": "2 Timothée",
    "Titus": "Tite", "Phlm": "Philémon", "Heb": "Hébreux", "Jas": "Jacques",
    "1Pet": "1 Pierre", "2Pet": "2 Pierre", "1John": "1 Jean", "2John": "2 Jean",
    "3John": "3 Jean", "Jude": "Jude", "Rev": "Apocalypse",
}

# Sous-arbres dont le contenu n'appartient pas au texte du verset.
SKIP_TAGS = {"note", "title"}


def local(tag):
    """Nom local d'une balise, sans le namespace OSIS."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def walk(elem, on_start, on_end, on_text):
    """Parcourt l'arbre en ordre document.

    Émet on_text(str) pour chaque fragment de texte, on_start(sID)/on_end(eID)
    aux jalons de verset. N'entre pas dans les sous-arbres note/title mais
    conserve leur `tail` (texte qui suit, qui fait partie du verset courant).
    """
    tag = local(elem.tag)

    if tag == "verse":
        sid = elem.get("sID")
        eid = elem.get("eID")
        if sid is not None:
            on_start(sid)
        if eid is not None:
            on_end(eid)
        if elem.tail:
            on_text(elem.tail)
        return

    if tag in SKIP_TAGS:
        # On saute le contenu (note de bas de page, titre) mais on garde le tail.
        if elem.tail:
            on_text(elem.tail)
        return

    if elem.text:
        on_text(elem.text)
    for child in elem:
        walk(child, on_start, on_end, on_text)
    if elem.tail:
        on_text(elem.tail)


def normalize(text):
    """Compacte les espaces et corrige les espaces parasites de ponctuation.

    - Espaces multiples/sauts de ligne compactés en une espace simple.
    - Espace(s) supprimée(s) avant une ponctuation qui n'en prend jamais en
      français : « , . ) ] … » (artefacts de la source, ex. « au shéol . »).
    - Espace supprimée juste après une parenthèse/crochet ouvrant.
    Les espaces avant « ; : ! ? » (typographie française légitime) sont conservées.
    """
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.\)\]…])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    return text


def sanitize(data):
    """Retire les balises parasites non fermées qui cassent la validité XML.

    Certaines exports OSIS (dont la source BPC) contiennent des balises inline
    orphelines (ex. `<pnodit>`) jamais refermées. On parse avec expat en suivant
    la pile ; à chaque erreur « mismatched tag » on retire du flux toutes les
    occurrences de la balise restée ouverte, puis on retente. Borné pour éviter
    toute boucle infinie.
    """
    import xml.parsers.expat as expat

    for _ in range(20):
        stack = []
        parser = expat.ParserCreate()
        parser.StartElementHandler = lambda name, attrs: stack.append(name)
        parser.EndElementHandler = lambda name: stack and stack.pop()
        try:
            parser.Parse(data, True)
            return data
        except expat.ExpatError:
            if not stack:
                raise
            bad = local(stack[-1])
            pattern = re.compile(
                (r"</?" + re.escape(bad) + r"(\s[^>]*)?/?>").encode("utf-8")
            )
            new_data = pattern.sub(b"", data)
            if new_data == data:
                raise
            print(f"Avertissement : balise parasite « {bad} » retirée.",
                  file=sys.stderr)
            data = new_data
    return data


def parse_verse_ref(osis_id):
    """'Gen.1.2' -> ('Gen', 1, 2). Gère les suffixes éventuels (Gen.1.2!a)."""
    core = osis_id.split("!", 1)[0]
    parts = core.split(".")
    book = parts[0]
    chap = int(parts[1])
    vers = int(parts[2])
    return book, chap, vers


def convert(xml_path):
    with open(xml_path, "rb") as f:
        data = sanitize(f.read())
    root = ET.fromstring(data)

    # Accumulateur : {(book, chap, verse): [fragments]} + ordre d'apparition.
    verses = {}
    order = []
    current = {"id": None}

    def on_start(sid):
        current["id"] = sid
        if sid not in verses:
            verses[sid] = []
            order.append(sid)

    def on_end(_eid):
        current["id"] = None

    def on_text(txt):
        vid = current["id"]
        if vid is not None:
            verses[vid].append(txt)

    for book_div in root.iter():
        if local(book_div.tag) == "div" and book_div.get("type") == "book":
            walk(book_div, on_start, on_end, on_text)

    # Reconstruit la structure livres -> chapitres -> versets.
    books = {}  # osis book id -> {chap -> {verse -> texte}}
    book_order = []
    for vid in order:
        book, chap, vnum = parse_verse_ref(vid)
        if book not in books:
            books[book] = {}
            book_order.append(book)
        books[book].setdefault(chap, {})[vnum] = normalize("".join(verses[vid]))

    out_books = []
    unknown = []
    for book in book_order:
        name = OSIS_TO_FR.get(book)
        if name is None:
            unknown.append(book)
            name = book
        chapters = []
        for chap in sorted(books[book]):
            vmap = books[book][chap]
            chapters.append([vmap[v] for v in sorted(vmap)])
        out_books.append({"name": name, "chapters": chapters})

    if unknown:
        print(f"Avertissement : livres OSIS non mappés : {unknown}", file=sys.stderr)

    return out_books


def main():
    ap = argparse.ArgumentParser(description="OSIS XML -> JSON Verso")
    ap.add_argument("input", help="fichier OSIS XML source")
    ap.add_argument("output", help="fichier JSON de sortie")
    ap.add_argument("--code", required=True, help="code court de la Bible (ex. BPC)")
    ap.add_argument("--name", required=True, help="nom lisible (ex. Version BPC)")
    ap.add_argument("--copyright", default=None,
                    help="mention de licence / copyright (optionnel)")
    args = ap.parse_args()

    books = convert(args.input)

    bible = {"bible_code": args.code, "bible_name": args.name}
    if args.copyright:
        bible["bible_copyright"] = args.copyright
    bible["books"] = books

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(bible, f, ensure_ascii=False, separators=(",", ":"))

    nb_ch = sum(len(b["chapters"]) for b in books)
    nb_v = sum(len(c) for b in books for c in b["chapters"])
    print(f"OK : {len(books)} livres, {nb_ch} chapitres, {nb_v} versets -> {args.output}")


if __name__ == "__main__":
    main()
