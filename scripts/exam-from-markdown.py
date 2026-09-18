#!/usr/bin/env python3
"""Builds an exam's items, tasks and `exam` entity from a vault question paper.

Plan 0028 B2/B3. The two public exams are transcribed **verbatim** — the
source's wording and its option order both (0028 B2) — so they are parsed
rather than retyped: a parser cannot paraphrase, reorder or drop an option,
and the paper's own Loesungsschluessel table is then a second, independent
statement of every answer that this script asserts against.

    python3 scripts/exam-from-markdown.py <source.md> <authoring.json> <tree>

`authoring.json` is the hand-written half — ids, ruleset, attribution, the
per-question `explanation`/`why` and the lesson each question tests. It is
authoring material, not content: it lives outside the checkout directory
(`content.local/authoring/`) so no republish ever sees it.

Re-runnable by design: it overwrites the generated files each time, and the
only inputs are the paper and the authoring file, so an edit to either is one
re-run away from the tree. Nothing is read back out of the tree.

The source format (one `###` per question):

    ### 4 · Q-17-13-02 — K-Frage, 1 Punkt

    <stem, one paragraph>

    *Bitte ordnen Sie jede Antwort einer Kategorie zu. Kategorien: **A** / **B**.*

    - a) <option>

    > [!success]- Losung
    > - a) → **A**
"""

import json
import re
import sys
from pathlib import Path

HEADER = re.compile(r"^### (\d+) · (Q-[\d-]+) — ([APK])-Frage, (\d+) Punkte?$")
OPTION = re.compile(r"^- ([a-z])\) (.+)$")
CATEGORIES = re.compile(r"Kategorien: \*\*(.+?)\*\* / \*\*(.+?)\*\*")
MARKED = re.compile(r"\*\*([a-z])\)\*\*")
ASSIGNED = re.compile(r"^> - ([a-z])\) → \*\*(.+?)\*\*$")
KEY_ROW = re.compile(r"^\| (\d+) \| (Q-[\d-]+) \| ([APK]) \| (\d+) \| (.+?) \|$")


def parse_questions(text):
    """Every `###` block, in document order."""
    questions = []
    current = None
    for line in text.splitlines():
        header = HEADER.match(line)
        if header:
            number, qid, kind, points = header.groups()
            current = {
                "number": int(number),
                "qid": qid,
                "kind": kind,
                "points": int(points),
                "stem": [],
                "instructions": None,
                "options": [],
                "solution": [],
            }
            questions.append(current)
            continue
        if current is None:
            continue
        if line.startswith("## "):  # the Loesungsschluessel section ends the run
            current = None
            continue
        option = OPTION.match(line)
        if option:
            current["options"].append({"letter": option.group(1), "text": option.group(2)})
        elif line.startswith("> "):
            current["solution"].append(line)
        elif line.startswith("*") and line.endswith("*") and current["instructions"] is None:
            current["instructions"] = line.strip("*")
        elif line.strip() and not current["options"]:
            current["stem"].append(line.strip())
    return questions


def solution_of(question):
    """letter -> True/False for A/P; letter -> category string for K."""
    if question["kind"] == "K":
        assigned = {}
        for line in question["solution"]:
            row = ASSIGNED.match(line)
            if row:
                assigned[row.group(1)] = row.group(2)
        return assigned
    marked = set()
    for line in question["solution"]:
        if "Lösung" in line or "Losung" in line:
            continue
        marked.update(MARKED.findall(line))
    return {option["letter"]: option["letter"] in marked for option in question["options"]}


def parse_key(text):
    """The paper's own answer table — the independent second opinion."""
    key = {}
    for line in text.splitlines():
        row = KEY_ROW.match(line)
        if row:
            _, qid, kind, points, answer = row.groups()
            key[qid] = {"kind": kind, "points": int(points), "answer": answer.strip()}
    return key


def key_solution(entry, letters):
    if entry["kind"] == "K":
        assigned = {}
        for part in entry["answer"].split("·"):
            letter, _, category = part.strip().partition("=")
            assigned[letter.strip()] = category.strip()
        return assigned
    marked = {part.strip() for part in entry["answer"].split(",")}
    return {letter: letter in marked for letter in letters}


def check(questions, key):
    """Every disagreement between the callouts and the key table, plus the
    structural facts the paper states about itself."""
    errors = []
    if len(questions) != len(key):
        errors.append(f"{len(questions)} questions parsed, {len(key)} rows in the key table")
    for question in questions:
        qid = question["qid"]
        entry = key.get(qid)
        if entry is None:
            errors.append(f"{qid}: not in the key table")
            continue
        if entry["kind"] != question["kind"] or entry["points"] != question["points"]:
            errors.append(
                f"{qid}: header says {question['kind']}/{question['points']}, "
                f"key says {entry['kind']}/{entry['points']}"
            )
        letters = [option["letter"] for option in question["options"]]
        if letters != sorted(letters) or letters != [chr(ord("a") + i) for i in range(len(letters))]:
            errors.append(f"{qid}: options are not a, b, c, … ({letters})")
        mine, theirs = solution_of(question), key_solution(entry, letters)
        if mine != theirs:
            errors.append(f"{qid}: callout says {mine}, key table says {theirs}")
        if not question["stem"]:
            errors.append(f"{qid}: no stem")
        if question["instructions"] is None:
            errors.append(f"{qid}: no instruction line")
        if question["kind"] == "K" and not CATEGORIES.search(question["instructions"] or ""):
            errors.append(f"{qid}: K-Frage without categories in its instruction line")
        if question["kind"] == "A" and sum(1 for v in theirs.values() if v) != 1:
            errors.append(f"{qid}: A-Frage without exactly one correct option")
    return errors


def build(question, authoring, notes):
    """One question -> its item and its task, both exam-only."""
    qid = question["qid"]
    prefix = authoring["code"]
    slug = qid.lower()
    per_question = authoring["questions"].get(qid, {})
    solution = solution_of(question)
    is_assign = question["kind"] == "K"

    labels = None
    if is_assign:
        match = CATEGORIES.search(question["instructions"])
        labels = [match.group(1), match.group(2)]

    options = []
    for option in question["options"]:
        letter = option["letter"]
        correct = solution[letter] == labels[0] if is_assign else solution[letter]
        entry = {"text": option["text"], "correct": correct}
        why = per_question.get("why", {}).get(letter)
        if why:
            entry["why"] = why
        options.append(entry)

    payload = {"stem": " ".join(question["stem"]), "options": options}
    if labels is not None:
        payload["labels"] = labels
    explanation = per_question.get("explanation")
    if explanation:
        payload["explanation"] = explanation
    else:
        notes.append(f"{qid}: no explanation authored")
    if authoring.get("generated"):
        payload["generated"] = True
    elif explanation:
        # Only meaningful on a transcribed question, and only once there is
        # something of ours to mark (schema comment, `entities.ts`).
        payload["explanationGenerated"] = True

    item_id = f"{prefix}-item-{slug}"
    task_id = f"{prefix}-task-{slug}"
    item = {
        "id": item_id,
        "kind": "question",
        "payload": payload,
        "sourceRef": authoring["sourceRef"],
    }
    task = {
        "id": task_id,
        "type": "assign" if is_assign else "choice",
        "itemIds": [item_id],
        "instructions": question["instructions"],
    }
    return item, task


def write_all(entities, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for entity in entities:
        path = directory / f"{entity['id']}.json"
        path.write_text(json.dumps(entity, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    source, authoring_path, tree = (Path(argument) for argument in sys.argv[1:])
    text = source.read_text(encoding="utf-8")
    authoring = json.loads(authoring_path.read_text(encoding="utf-8"))

    questions = parse_questions(text)
    errors = check(questions, parse_key(text))
    if errors:
        print("\n".join(f"  {error}" for error in errors), file=sys.stderr)
        sys.exit(f"{len(errors)} disagreement(s) between the paper and its own key — nothing written")

    book_dir = tree / authoring["bookId"]
    # A lesson the Book does not have yet cannot be referenced (validator
    # class (ag)), so the mapping is authored in full and emitted as it
    # becomes true — phase A lands a lesson, this re-runs, the readiness
    # bucket lights up. Until then those questions bucket as "Other".
    lessons = {path.stem for path in (book_dir / "lessons").glob("*.json")}

    notes = []
    items, tasks, entries = [], [], []
    for question in questions:
        item, task = build(question, authoring, notes)
        items.append(item)
        tasks.append(task)
        entry = {"taskId": task["id"], "points": question["points"]}
        lesson = authoring["questions"].get(question["qid"], {}).get("lesson")
        if lesson is not None:
            lesson_id = f"{authoring['code']}-lesson-{lesson}"
            if lesson_id in lessons:
                entry["lessonId"] = lesson_id
            else:
                notes.append(f"{question['qid']}: {lesson_id} does not exist yet — no lessonId")
        else:
            notes.append(f"{question['qid']}: no lesson mapped")
        entries.append(entry)

    exam = {
        "id": authoring["examId"],
        "topicId": authoring["bookId"],
        "title": authoring["title"],
        "description": authoring["description"],
        "questions": entries,
        "ruleset": authoring["ruleset"],
    }

    write_all(items, book_dir / "items")
    write_all(tasks, book_dir / "tasks")
    write_all([exam], book_dir / "exams")

    if notes:
        print("\n".join(f"  {note}" for note in sorted(set(notes))))
    print(
        f"{len(questions)} questions, {sum(entry['points'] for entry in entries)} points"
        f" -> {book_dir}"
    )


if __name__ == "__main__":
    main()
