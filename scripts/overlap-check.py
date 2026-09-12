#!/usr/bin/env python3
"""Flag N-word runs shared between authored candidates and copyrighted sources.

Plan 0028 §3 "own-words rule": we must never republish the book's or the
Lehrplan's wording. This walks candidate JSON/Markdown files, builds N-gram
sets from the source corpora, and prints every run of N (default 8)
consecutive words a candidate shares with a source.

  python3 scripts/overlap-check.py --book <book.md> --lehrplan <lehrplan.txt> [--n 8] <candidate path>...
  python3 scripts/overlap-check.py --self-test

Exit codes: 0 no hits, 1 hits found (or self-test failed), 2 usage/IO error.
"""
import argparse
import json
import os
import re
import sys

HYPHEN_BREAK_RE = re.compile(r"(\w)-\n\s*(\w)")
GLOSSAR_HEADING_RE = re.compile(r"^## C Glossar\s*$")
SKIP_KEYS = {"id", "kind", "type", "sourceRef", "path", "audioRef", "imageRef"}


def _skip_key(key):
    return key in SKIP_KEYS or key.endswith("Id") or key.endswith("Ids")


def _join_hyphen(text):
    def repl(m):
        before, after = m.group(1), m.group(2)
        return before + after if after.islower() else m.group(0)

    return HYPHEN_BREAK_RE.sub(repl, text)


def tokenize(text):
    text = _join_hyphen(text)
    text = text.casefold()
    text = "".join(c if c.isalnum() else " " for c in text)
    tokens = []
    for tok in text.split():
        if any(c.isalpha() for c in tok):
            tok = tok.rstrip("0123456789")
        if tok:
            tokens.append(tok)
    return tokens


def _split_segments_with_offsets(line):
    """Split on runs of 2+ spaces, keeping each segment's start column."""
    segs = []
    pos = 0
    for m in re.finditer(r" {2,}", line):
        if m.start() > pos:
            segs.append((pos, line[pos : m.start()]))
        pos = m.end()
    if pos < len(line):
        segs.append((pos, line[pos:]))
    return segs


def extract_glossar_definitions(fence_lines):
    # ponytail: column offsets drift row to row, so this locates columns by
    # runs of 2+ spaces instead of slicing by character position. An extra
    # token before a definition can't break a run inside it, so the term is
    # never dropped. defcol (the definition column's start) comes from the
    # entry's own first continuation line, or carries forward from the last
    # entry that had one. Ceiling: a definition and its translation
    # separated by only a single space merge into one segment, leaking the
    # translation into the stream. A stray word can only break a run, never
    # fabricate one, so it's a false negative at worst.
    entries = []
    current = None
    for line in fence_lines:
        if line.startswith("Begriff"):
            continue
        segs = _split_segments_with_offsets(line)
        if not segs:
            continue
        if not line[0].isspace():
            current = {"entry_segs": segs, "cont_segs_list": []}
            entries.append(current)
        elif current is not None:
            current["cont_segs_list"].append(segs)

    kept = []
    running_defcol = None
    for entry in entries:
        cont_list = entry["cont_segs_list"]
        if cont_list:
            running_defcol = cont_list[0][0][0]
        defcol = running_defcol
        entry_segs = entry["entry_segs"]
        kept.append(entry_segs[0][1])  # segment 0 (term, or term+definition) always kept
        if len(entry_segs) > 1 and defcol is not None and entry_segs[1][0] <= defcol + 2:
            kept.append(entry_segs[1][1])
        for cseg in cont_list:
            kept.append(cseg[0][1])  # continuation line: first segment only
    return " ".join(kept)


def parse_book(text):
    """Split a book markdown text into (main_tokens, glossar_tokens, warning)."""
    lines = text.split("\n")
    heading_idx = next(
        (i for i, l in enumerate(lines) if GLOSSAR_HEADING_RE.match(l)), None
    )
    fence_start = fence_end = None
    if heading_idx is not None:
        fence_start = next(
            (i for i in range(heading_idx + 1, len(lines)) if lines[i].strip() == "```"),
            None,
        )
        if fence_start is not None:
            fence_end = next(
                (i for i in range(fence_start + 1, len(lines)) if lines[i].strip() == "```"),
                None,
            )
    if fence_start is None or fence_end is None:
        return tokenize(text), [], "warning: '## C Glossar' fence not found; treating whole file as main corpus"

    glossar_text = extract_glossar_definitions(lines[fence_start + 1 : fence_end])
    main_text = "\n".join(lines[:fence_start] + lines[fence_end + 1 :])
    return tokenize(main_text), tokenize(glossar_text), None


def collect_json_segments(obj):
    """Recursively collect (location, text) for every string not under a skipped key."""
    out = []

    def walk(o, loc):
        if isinstance(o, dict):
            for k, v in o.items():
                if _skip_key(k):
                    continue
                walk(v, f"{loc}/{k}" if loc else k)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{loc}/{i}" if loc else str(i))
        elif isinstance(o, str):
            out.append((loc, o))

    walk(obj, "")
    return out


def build_ngrams(tokens, n):
    if len(tokens) < n:
        return set()
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def find_runs(tokens, ngram_set, n):
    """Indices of every N-gram hit, merged into maximal (start, end) runs."""
    hits = [i for i in range(len(tokens) - n + 1) if tuple(tokens[i : i + n]) in ngram_set]
    runs = []
    cur_start = cur_end = None
    for i in hits:
        end = i + n - 1
        if cur_start is None:
            cur_start, cur_end = i, end
        elif i <= cur_end + 1:
            cur_end = max(cur_end, end)
        else:
            runs.append((cur_start, cur_end))
            cur_start, cur_end = i, end
    if cur_start is not None:
        runs.append((cur_start, cur_end))
    return runs


def find_candidate_files(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _dirs, names in os.walk(p):
                for name in sorted(names):
                    if name.endswith(".json") or name.endswith(".md"):
                        files.append(os.path.join(root, name))
        else:
            files.append(p)
    return files


def candidate_segments(path):
    if path.endswith(".json"):
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
        return collect_json_segments(obj)
    with open(path, encoding="utf-8") as f:
        return [("-", f.read())]


def check_candidates(paths, sources, n):
    hit_count = 0
    for path in find_candidate_files(paths):
        for loc, text in candidate_segments(path):
            tokens = tokenize(text)
            for label, ngram_set in sources.items():
                for start, end in find_runs(tokens, ngram_set, n):
                    run = tokens[start : end + 1]
                    print(f'{path}:{loc}: {label} ({len(run)} words): "{" ".join(run)}"')
                    hit_count += 1
    return hit_count


def self_test():
    failures = []

    # Fixture 1: the three real Architekturentscheidung Glossar lines (plan 0028 §3).
    book_fixture_1 = (
        "## C Glossar\n\n"
        "```\n"
        "Begriff      Erklärung/Definition                                               Übersetzung Quelle\n"
        "Architekturentscheidung Entscheidung, die nachhaltig oder grundlegend            Architectural\n"
        "                            Strukturen, Konzepte, Implementierung oder           Decision\n"
        "                            Ähnliches beeinflusst. Beispiel: Entscheidung über\n"
        "```\n"
    )
    _, glossar_tokens, _ = parse_book(book_fixture_1)
    glossar_ngrams = build_ngrams(glossar_tokens, 8)

    book_fixture_2 = (
        "Die Softwarearchitektur bestimmt maßgeblich die spätere Wartbarkeit1 und "
        "Erweiterbar-\nkeit eines komplexen Systems."
    )
    main_tokens_2, _, _ = parse_book(book_fixture_2)
    book_ngrams = build_ngrams(main_tokens_2, 8)
    candidate_clean = "Die Softwarearchitektur bestimmt maßgeblich die spätere Wartbarkeit und Erweiterbarkeit eines komplexen Systems."
    clean_tokens = tokenize(candidate_clean)

    # 1. Positive control, Glossar.
    try:
        candidate = {
            "payload": {
                "definition": "Entscheidung, die nachhaltig oder grundlegend Strukturen, Konzepte, Implementierung oder Ähnliches beeinflusst."
            }
        }
        (loc, text), = collect_json_segments(candidate)
        assert loc == "payload/definition"
        runs = find_runs(tokenize(text), glossar_ngrams, 8)
        assert runs, "expected a glossar hit on the verbatim Architekturentscheidung definition"
    except AssertionError as e:
        failures.append(f"1 glossar positive control: {e}")

    # 2. Positive control, book.
    try:
        runs = find_runs(clean_tokens, book_ngrams, 8)
        assert runs, "expected a book hit on the cleaned-up sentence"
    except AssertionError as e:
        failures.append(f"2 book positive control: {e}")

    # 3. Negative control.
    try:
        fresh = "Wartbarkeit und Softwarearchitektur zählen zu den zentralen Qualitätsmerkmalen in jedem modernen Projekt."
        fresh_tokens = tokenize(fresh)
        assert not find_runs(fresh_tokens, book_ngrams, 8), "fresh sentence should not match book"
        assert not find_runs(fresh_tokens, glossar_ngrams, 8), "fresh sentence should not match glossar"
    except AssertionError as e:
        failures.append(f"3 negative control: {e}")

    # 4. Key exclusion.
    try:
        excluded = {
            "id": candidate_clean,
            "sourceRef": candidate_clean,
            "conceptIds": [candidate_clean],
            "payload": {"note": "Ein neuer, unabhaengig formulierter Hinweistext ohne Ueberschneidung."},
        }
        segs = collect_json_segments(excluded)
        assert segs == [("payload/note", excluded["payload"]["note"])], f"expected only payload/note, got {segs}"
    except AssertionError as e:
        failures.append(f"4 key exclusion: {e}")

    # 5. Threshold.
    try:
        seven = tokenize(" ".join(clean_tokens[:7]))
        eight = tokenize(" ".join(clean_tokens[:8]))
        assert not find_runs(seven, book_ngrams, 8), "7-word overlap should not be flagged at n=8"
        assert find_runs(eight, book_ngrams, 8), "8-word overlap should be flagged at n=8"
    except AssertionError as e:
        failures.append(f"5 threshold: {e}")

    # 6. Double-space-separated entry (`Architekturmuster` style): the definition
    # column (segment 1) must survive when it lines up with the continuation
    # line's column, and the far-right translation column must not leak in.
    try:
        entry_line = (
            "Architekturmuster     Beschreibt die grundlegende Struktur eines Systems.      Architectural"
        )
        cont_line = (
            "                      oder eines Subsystems in wiederverwendbarer Form.       Pattern"
        )
        book_fixture_3 = (
            "## C Glossar\n\n"
            "```\n"
            "Begriff      Erklärung/Definition                                               Übersetzung Quelle\n"
            f"{entry_line}\n"
            f"{cont_line}\n"
            "```\n"
        )
        _, glossar_tokens_3, _ = parse_book(book_fixture_3)
        assert "architectural" not in glossar_tokens_3, "translation column should not leak into the stream"
        glossar_ngrams_3 = build_ngrams(glossar_tokens_3, 8)
        candidate_3 = "Beschreibt die grundlegende Struktur eines Systems oder eines"
        assert find_runs(tokenize(candidate_3), glossar_ngrams_3, 8), (
            "expected a glossar hit starting at the entry's own first definition word"
        )
    except AssertionError as e:
        failures.append(f"6 double-space glossar entry: {e}")

    if failures:
        for f in failures:
            print(f"self-test FAILED: {f}", file=sys.stderr)
        return 1
    print("self-test ok")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--book")
    ap.add_argument("--lehrplan")
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("candidates", nargs="*")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    if not args.book and not args.lehrplan:
        print("error: at least one of --book / --lehrplan is required", file=sys.stderr)
        return 2
    if not args.candidates:
        print("error: at least one candidate path is required", file=sys.stderr)
        return 2

    sources = {}
    try:
        if args.book:
            with open(args.book, encoding="utf-8") as f:
                book_text = f.read()
            main_tokens, glossar_tokens, warning = parse_book(book_text)
            if warning:
                print(warning, file=sys.stderr)
            sources["book"] = build_ngrams(main_tokens, args.n)
            sources["glossar"] = build_ngrams(glossar_tokens, args.n)
        if args.lehrplan:
            with open(args.lehrplan, encoding="utf-8") as f:
                lehrplan_text = f.read()
            sources["lehrplan"] = build_ngrams(tokenize(lehrplan_text), args.n)
    except OSError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    try:
        hit_count = check_candidates(args.candidates, sources, args.n)
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    print(f"{hit_count} overlap run(s) found")
    return 1 if hit_count else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
