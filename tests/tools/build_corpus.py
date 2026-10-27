#!/usr/bin/env python3
"""Builds tests/fixtures/corpus.json, the shared EN/NL text corpus used by the Python and JS tests.

Invisible and ambiguous characters are built with chr() so they stay visible in this source, and the JSON
is written with ensure_ascii=True so they also stay visible (as escapes) in diffs of the fixture.

Run:  .venv/bin/python tests/tools/build_corpus.py
"""
from __future__ import annotations

import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parents[1] / "fixtures" / "corpus.json"

NBSP = chr(0x00A0)
SHY = chr(0x00AD)  # soft hyphen
ZWSP = chr(0x200B)
FF = chr(0x000C)  # form feed / page break
LIG_FI = chr(0xFB01)
LIG_FFI = chr(0xFB03)
LDQ, RDQ, RSQ = chr(0x201C), chr(0x201D), chr(0x2019)


def mojibake(text: str) -> str:
    """UTF-8 text mis-read as Windows-1252 (undefined cp1252 bytes map to the C1 control of the same value)."""
    undefined = {0x81, 0x8D, 0x8F, 0x90, 0x9D}
    return "".join(chr(b) if b in undefined else bytes([b]).decode("cp1252") for b in text.encode("utf-8"))


def messy_pdf_en() -> str:
    header = "THE LONG ROAD HOME"
    body = [
        "The morning light came slowly across the valley, touching the roofs of the",
        "village one by one. Marta stood at the window and watched the smoke rise from",
        "the chimneys, thinking about the letter that had arrived the night before.",
        "",
        "She had read it three times. The words did not change, but the meaning did,",
        "and by the time the kettle began to sing she knew what she had to do.",
        "",
        "\"We should leave before noon,\" she said to nobody in particular -- and then",
        "she laughed at herself... The house answered with silence.",
    ]
    page_numbers = ["12", "- 13 -", "Page 14 of 200", "iv", "15"]
    lines = ["Chapter 1", ""]
    for number in page_numbers:
        lines.append(header)
        lines.extend(body)
        lines.append("")
        lines.append(number)
        lines.append(FF)
    # artefacts that PDF/Word copy-paste produces
    lines.extend([
        f"She had made it to the o{LIG_FFI}ce at {LIG_FI}nally last, co{SHY}operating with the inter-",
        f"national staff.{NBSP}The {mojibake('café')} was closed and she didn{mojibake(RSQ)}t mind.",
        f"A hid{ZWSP}den zero-width space, a tab\tinside, trailing spaces   ",
        "Double  spaces here , and a space before punctuation !",
        "",
        "",
        "",
        "",
        "CHAPTER TWO",
        "Prologue",
        "Table of Contents",
    ])
    return "\n".join(lines)


def dutch_nl() -> str:
    return "\n".join([
        "# Hoofdstuk Een",
        "",
        "'Wat doe je daar?' vroeg Anna. 'Ik kijk naar 't water,' zei hij.",
        "",
        "'s Avonds liepen ze naar huis. Hij maakte foto's van zo'n oude brug -- prachtig...",
        "",
        "\"Dat is 'm niet,\" zei ze. \"Het is z'n broer.\"",
        "",
        "Hoofdstuk Twee",
        "",
        "Hoofdstuk Vier",
        "",
        "Proloog",
        "Inhoud",
    ])


def english_elisions() -> str:
    return "\n".join([
        "'Twas the night before, and 'cause of the storm they sat by the fire.",
        "He played rock 'n' roll in the '90s and said 'em all were wrong.",
        "\"Don't go,\" she said. \"It's 'bout time we stayed.\"",
        "He said 'hello' and she said \"goodbye\".",
        "Wait... what -- really---yes.",
    ])


def structure_en() -> str:
    return "\n".join([
        "# Part One",
        "",
        "# Chapter One",
        "",
        "Regular *italic* and **bold** and ***both*** text with `code`.",
        "Inline markers: [[u:underlined]] [[sc:small caps]] [[mono:mono]] [[sans:sans]].",
        "",
        "## A Subhead",
        "",
        "### Lower subhead",
        "",
        "> A quoted paragraph.",
        ">",
        "> Second quoted paragraph.",
        "",
        "***",
        "",
        "::: verse",
        "Roses are red",
        "Violets are blue",
        ":::",
        "",
        "::: note",
        "A note written by a character.",
        ":::",
        "",
        "---",
        "",
        "- bullet one",
        "  - nested bullet",
        "- bullet two",
        "",
        "1. first",
        "2. second",
        "",
        "- [x] done task",
        "- [ ] open task",
        "",
        "| Name | Value |",
        "|------|-------|",
        "| a    | 1     |",
        "| b    | 2     |",
        "",
        "```",
        "# not a heading",
        "```",
        "",
        "A [link](https://example.com) and ![image](https://example.com/x.png).",
        "",
        "Epilogue",
    ])


def structure_broken() -> str:
    return "\n".join([
        "# ",
        "",
        "Some text",
        "",
        "::: verse",
        "Never closed",
        "",
        "## Second",
        "",
        "# Chapter 3",
        "",
        "# Chapter 5",
        "",
        "# Chapter 6",
    ])


def chapter_candidates() -> str:
    return "\n".join([
        "Chapter 1",
        "Chapter Two",
        "Hoofdstuk 3",
        "Hoofdstuk Vier",
        "Part III",
        "Deel Twee",
        "Prologue",
        "Epilogue",
        "Acknowledgments",
        "Copyright",
        "Dedication",
        "Voorwoord",
        "Nawoord",
        "Just an ordinary sentence that is not a chapter.",
    ])


def mojibake_short() -> str:
    return f"{mojibake('café')} and {mojibake(LDQ)}quoted{mojibake(RDQ)} and {mojibake('naïve')} {mojibake(chr(0x2013))} dash"


def plain_prose_short() -> str:
    return "\n".join([
        "It was a quiet evening, and the lamps were lit",
        "along the harbour road. Nobody spoke.",
        "",
        "In the morning the boats were gone.",
    ])


CORPUS = {
    "messy_pdf_en": messy_pdf_en(),
    "dutch_nl": dutch_nl(),
    "english_elisions": english_elisions(),
    "structure_en": structure_en(),
    "structure_broken": structure_broken(),
    "chapter_candidates": chapter_candidates(),
    "mojibake_short": mojibake_short(),
    "plain_prose_short": plain_prose_short(),
}


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(CORPUS, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(CORPUS)} samples)")


if __name__ == "__main__":
    main()
