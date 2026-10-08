#!/usr/bin/env python3
"""Puts a checked-out Book's cards through a blind test, so a vague card goes
to a rewrite list instead of to learners.

    python3 scripts/card-check.py content.local/softwarearchitektur [--model haiku]

Exit 0 means every card passed. Any other exit prints the rewrite list and the
flag rate (flagged / tested), which is the number to watch per authoring batch.

Two passes, cheapest first:

1. Script checks (no LLM): does the front give the answer away? A concept's
   term inside its definition, a lexeme's word inside its gloss, a cloze
   answer elsewhere in its sentence, a correct option's text inside its
   question stem (all whole-word). Definitions over 25 words are flagged too
   (content-practices §2).
2. Blind test: a second model sees only the front, never the back.
   - lexeme/concept: the gloss or definition, against the unit's sibling
     terms — exactly what `matching` and `recognize` show. It names the term
     or says AMBIGUOUS.
   - question: the stem, options and the unit's notes, without the answer
     key. A question someone who read the unit can't answer is a bad
     question (content-practices §5).
   - cloze sentence: the sentence with the gap, plus its translation.
   AMBIGUOUS or a wrong answer flags the card.

Results are cached by prompt in <tree>/.card-check-cache.json, so a rerun only
tests the cards that changed. The model runs through `claude -p`, which needs
no API key.
"""

import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
from pathlib import Path

CLOZE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}")

SYSTEM = (
    "You answer study cards blind, from the front only. Never guess between "
    "plausible answers: if more than one answer could be correct, say "
    "AMBIGUOUS. Reply with JSON only, no prose, no code fence."
)


def contains_word(haystack: str, needle: str) -> bool:
    needle = needle.strip()
    if not needle:
        return False
    return re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack, re.I) is not None


def load_dir(d: Path) -> dict[str, dict]:
    return {f.stem: json.loads(f.read_text()) for f in sorted(d.glob("*.json"))} if d.is_dir() else {}


def script_checks(item: dict) -> list[str]:
    p, kind = item["payload"], item["kind"]
    out = []
    if kind == "concept":
        if contains_word(p["definition"], p["term"]):
            out.append("the definition contains the term")
        if len(p["definition"].split()) > 25:
            out.append(f"the definition is {len(p['definition'].split())} words (aim ≤ 25)")
    elif kind == "lexeme":
        if contains_word(p["gloss"], p["script"]):
            out.append("the gloss contains the word")
    elif kind == "sentence":
        for answer in CLOZE.findall(p["text"]):
            if contains_word(CLOZE.sub("___", p["text"]), answer):
                out.append(f"cloze answer «{answer}» also appears outside the gap")
    elif kind == "question":
        for o in p["options"]:
            if o["correct"] and not p.get("labels") and contains_word(p["stem"], o["text"]):
                out.append(f"the stem contains the correct option «{o['text']}»")
    return out


def ask(prompt: str, model: str, cache: dict) -> dict:
    key = hashlib.sha256(f"{model}\n{prompt}".encode()).hexdigest()
    if key not in cache:
        r = subprocess.run(
            ["claude", "-p", "--model", model, "--tools", "", "--no-session-persistence",
             "--strict-mcp-config", "--setting-sources", "", "--system-prompt", SYSTEM],
            input=prompt, capture_output=True, text=True, check=True,
        )
        text = r.stdout.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        cache[key] = json.loads(text)
    return cache[key]


def front_and_answer(item: dict) -> tuple[str, str] | None:
    p = item["payload"]
    if item["kind"] == "concept":
        return p["definition"], p["term"]
    if item["kind"] == "lexeme":
        return p["gloss"], p["script"]
    return None


def blind_matching(items: list[dict], model: str, cache: dict) -> dict[str, str]:
    """One call per unit: every gloss/definition against the unit's terms."""
    cards = [(i["id"], *fa) for i in items if (fa := front_and_answer(i))]
    if len(cards) < 2:
        return {}
    terms = [a for _, _, a in cards]
    random.Random(0).shuffle(terms)
    # ponytail: one call per unit means the model could solve by elimination
    # and miss a duplicate; per-card calls if that ever lets one through.
    prompt = (
        f"Terms: {json.dumps(terms, ensure_ascii=False)}\n\n"
        "For each description below, judge it on its own: which ONE term does it "
        "describe? If two or more terms fit it, answer AMBIGUOUS.\n\n"
        + "\n".join(f"{n}. {front}" for n, (_, front, _) in enumerate(cards, 1))
        + '\n\nReply as {"1": "<term or AMBIGUOUS>", "2": ...}'
    )
    reply = ask(prompt, model, cache)
    out = {}
    for n, (item_id, front, answer) in enumerate(cards, 1):
        got = str(reply.get(str(n), "")).strip()
        if got.casefold() != answer.strip().casefold():
            out[item_id] = f"blind test answered «{got}», expected «{answer}» for: {front}"
    return out


def blind_question(item: dict, notes: str, model: str, cache: dict) -> str | None:
    p = item["payload"]
    opts = "\n".join(f"{n}. {o['text']}" for n, o in enumerate(p["options"], 1))
    if p.get("labels"):
        a, b = p["labels"]
        expected = {str(n): (a if o["correct"] else b) for n, o in enumerate(p["options"], 1)}
        task = f'Assign every statement to «{a}» or «{b}». Reply as {{"1": "<label or AMBIGUOUS>", ...}}'
    else:
        picks = sum(o["correct"] for o in p["options"])
        expected = {"correct": sorted(n for n, o in enumerate(p["options"], 1) if o["correct"])}
        task = f'Pick exactly {picks} option(s). Reply as {{"correct": [<numbers>]}} or {{"correct": "AMBIGUOUS"}}'
    prompt = (
        f"Answer using only what this study text teaches:\n\n<text>\n{notes}\n</text>\n\n"
        f"Question: {p['stem']}\n{opts}\n\n{task}"
    )
    reply = ask(prompt, model, cache)
    if p.get("labels"):
        wrong = [n for n, want in expected.items() if str(reply.get(n, "")).strip() != want]
        return f"rows {', '.join(wrong)} answered differently: {reply}" if wrong else None
    got = reply.get("correct")
    if not isinstance(got, list) or sorted(int(x) for x in got) != expected["correct"]:
        return f"blind test picked {got}, expected {expected['correct']}"
    return None


def blind_cloze(item: dict, model: str, cache: dict) -> str | None:
    p = item["payload"]
    answers = CLOZE.findall(p["text"])
    if not answers:
        return None
    gapped = CLOZE.sub("___", p["text"])
    prompt = (
        f"Sentence: {gapped}\nTranslation: {p['translation']}\n\n"
        'Fill each ___ in order. Reply as {"answers": [...]} or {"answers": "AMBIGUOUS"}'
    )
    got = ask(prompt, model, cache).get("answers")
    if not isinstance(got, list) or [g.strip().casefold() for g in got] != [a.casefold() for a in answers]:
        return f"blind test filled {got}, expected {answers}: {gapped}"
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tree", type=Path)
    ap.add_argument("--model", default="haiku")
    args = ap.parse_args()

    items: dict[str, dict] = {}
    for d in args.tree.glob("lexicon/*/entries"):
        items |= load_dir(d)
    units: list[dict] = []
    notes: dict[str, str] = {}
    for book in (p.parent for p in args.tree.glob("*/topic.json")):
        items |= load_dir(book / "items")
        units += load_dir(book / "units").values()
        notes |= {f.stem: f.read_text() for f in (book / "notes").glob("*.md")}

    cache_file = args.tree / ".card-check-cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    flagged: dict[str, list[str]] = {}
    tested: set[str] = set()

    def flag(item_id: str, why: str | None) -> None:
        tested.add(item_id)
        if why:
            flagged.setdefault(item_id, []).append(why)

    try:
        for unit in units:
            unit_items = [items[i] for i in unit["itemIds"] if i in items]
            unit_notes = "\n\n".join(t for stem, t in notes.items() if any(n.endswith(stem) for n in unit["noteIds"]))
            for item in unit_items:
                for why in script_checks(item):
                    flag(item["id"], why)
            matching = blind_matching(unit_items, args.model, cache)
            for item in unit_items:
                if item["kind"] in ("concept", "lexeme"):
                    flag(item["id"], matching.get(item["id"]))
                elif item["kind"] == "question":
                    flag(item["id"], blind_question(item, unit_notes, args.model, cache))
                elif item["kind"] == "sentence" and CLOZE.search(item["payload"]["text"]):
                    flag(item["id"], blind_cloze(item, args.model, cache))
            print(f"{unit['id']}: {len(unit_items)} items", file=sys.stderr)
    finally:
        cache_file.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    for item_id, whys in sorted(flagged.items()):
        print(f"\n{item_id}")
        for why in whys:
            print(f"  - {why}")
    rate = len(flagged) / len(tested) if tested else 0
    print(f"\nflagged {len(flagged)} of {len(tested)} cards ({rate:.0%})")
    sys.exit(1 if flagged else 0)


if __name__ == "__main__":
    main()
