"""Preflight checks that depend on the manuscript language and on typography."""
from __future__ import annotations


def issue(result, code):
    return next((i for i in result["issues"] if i["code"] == code), None)


def test_wrong_apostrophes_are_reported_for_dutch(mw):
    text = "# Hoofdstuk 1\n\n‘s Avonds ging hij naar ‘t huis.\n"
    result = mw.preflight(text, {"title": "T", "author": "A", "language": "nl"})
    found = issue(result, "wrong-apostrophe")
    assert found and found["count"] == 2 and "Repair apostrophes" in found["message"]
    assert {"label": "Language profile", "value": "nl"} in result["info"]


def test_other_languages_get_no_elision_guesses(mw):
    text = "# Titel\n\n‘t huis en ‘s avonds en de ‘90s.\n"
    result = mw.preflight(text, {"title": "T", "author": "A", "language": "fr"})
    assert issue(result, "wrong-apostrophe")["count"] == 1  # only the decade


def test_no_language_means_english_rules_without_a_profile_line(mw):
    result = mw.preflight("# T\n\ntext ‘t huis\n", {"title": "T", "author": "A"})
    assert issue(result, "wrong-apostrophe")["count"] == 1
    assert not any(i["label"] == "Language profile" for i in result["info"])


def test_mixed_and_straight_quotes(mw):
    mixed = mw.preflight('# T\n\n"straight" and “curly”\n', {"title": "T", "author": "A"})
    assert issue(mixed, "mixed-quotes")["level"] == "warning"
    only_straight = mw.preflight("# T\n\n" + 'He said "hi" to her. ' * 6, {"title": "T", "author": "A"})
    assert issue(only_straight, "straight-quotes")["level"] == "info"
    assert issue(only_straight, "mixed-quotes") is None
    clean = mw.preflight("# T\n\n“curly” only\n", {"title": "T", "author": "A"})
    assert issue(clean, "mixed-quotes") is None and issue(clean, "straight-quotes") is None


def test_dutch_front_and_back_matter_is_recognised_as_candidates(mw):
    text = "Proloog\n\nTekst.\n\nBijlage 2\n\nColofon\n\nInhoudsopgave\n"
    result = mw.preflight(text, {"title": "T", "author": "A", "language": "nl"})
    assert issue(result, "chapter-candidates")["count"] == 4


def test_ignored_candidates_are_not_reported(mw):
    text = "Prologue\n\nChapter 3\n\nText.\n"
    meta = {"title": "T", "author": "A"}
    assert issue(mw.preflight(text, meta), "chapter-candidates")["count"] == 2
    some = mw.preflight(text, meta, ["  PROLOGUE "])
    assert issue(some, "chapter-candidates")["count"] == 1
    assert issue(mw.preflight(text, meta, ["prologue", "chapter 3"]), "chapter-candidates") is None
    assert issue(mw.preflight(text, meta, [None, 5, "prologue"]), "chapter-candidates")["count"] == 1  # junk entries are ignored


def test_preflight_endpoint_passes_the_ignore_list(server):
    status, _h, body = server.request("POST", "/api/preflight", body={"text": "Prologue\n\ntext", "metadata": {"title": "T", "author": "A"}, "ignored_candidates": ["prologue"]})
    import json

    assert status == 200 and "chapter-candidates" not in {i["code"] for i in json.loads(body)["issues"]}
