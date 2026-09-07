#!/usr/bin/env python3
"""Merge examples*.json into a pulled Kyrgyz lexicon tree, keyed by headword.

  python3 scripts/merge-examples.py <tree>/lexicon/ky/entries

Re-runnable: a fresh `pull-book.ts` checkout can be re-merged without redoing
the authoring. Never overwrites an example that is already there.
"""
import json, glob, os, sys

entries_dir = sys.argv[1]
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "kyrgyz-examples")

mapping = {}
for f in sorted(glob.glob(os.path.join(here, "examples*.json"))):
    for k, v in json.load(open(f)).items():
        if k.startswith("_"):
            continue
        assert k not in mapping, f"duplicate headword {k}"
        mapping[k] = v

by_script = {}
for f in glob.glob(os.path.join(entries_dir, "*.json")):
    e = json.load(open(f))
    by_script[e["payload"]["script"].strip()] = (f, e)

written = skipped = 0
for head, ex in mapping.items():
    hit = by_script.get(head)
    if hit is None:
        print(f"  UNMATCHED headword: {head!r}")
        continue
    path, entry = hit
    p = entry["payload"]
    if "example" in p:
        skipped += 1
        continue
    p["example"] = {"text": ex["text"], "translation": ex["translation"]}
    if ex["src"] == "generated":
        p["exampleGenerated"] = True
    json.dump(entry, open(path, "w"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")
    written += 1

print(f"{written} written, {skipped} already had an example, {len(mapping)} in mapping")
