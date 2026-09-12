# Plan 0028: The software architecture Books

Status: **drafted** · Owner: Moe · Date: 2026-09-10 · One adversarial review round (14 findings, all addressed in this revision) · Prerequisites: none for the teaching track (§5 phase A); [plan 0027](0027-authored-questions-and-exam-mode.md)'s shipped slices 1-6 and its schema-3 bump for the question track (phase B), both **done**; its **2026-09-11 amendment** (§§10-12: the exercise allow-list, the Book practice depth, and the Check) for the `exercises`/`practiceDepth` values in §4 and for questions to play as designed — that port is in flight on `claude/exam-mode-amendment`. The §6 hand-backs are closed in 0027 §3a and §6. Seven owner decisions this session (§1).

## Purpose

Turn the software-architecture material in the owner's vault (`~/vault/sources/software-architecture/`) into BetterBeaver content:

- a **public German teaching Book** covering the iSAQB CPSA-F curriculum, carrying the official iSAQB mock exam and the model-written practice exam;
- a **private Book** holding the textbook's own sample questions.

This is a content plan on rails 0027 already laid down. It designs no schema, no engine and no UI. Where it touches machinery, it names the gap and hands it to the plan that owns it (§6).

## Sources

| Source | Size | Licence |
| --- | --- | --- |
| *Basiswissen für Softwarearchitekten* (Gharbi/Koschel/Rausch/Starke, 6. Aufl. 2025), vault file `Basiswissen für Softwarearchitekten/…md` | 4980 lines, 86 figures. Contents: chapters 1–7; Anhang A (**13 distinct sample questions**: 3 A / 3 K / 7 P); B (abbreviations); C (Glossar, ~116 rows); D (bibliography) | Bought copy, converted for personal use. **No redistribution grant.** |
| iSAQB CPSA-F Beispielprüfung, Dokumentversion 2026.2, vault file `iSAQB CPSA-F Beispielprüfung.md` | 38 questions (4 A / 21 P / 13 K), 52 points | May be passed on **free of charge** for exam preparation, **provided iSAQB® e.V. is named as source and copyright holder**. Use in a real exam is forbidden. |
| Übungsprüfung (KI-generiert), vault file `Übungsprüfung Softwarearchitektur (KI-generiert).md` | 38 questions, 52 points, same ruleset; each question names the book section it tests | Ours. Model-written, unreviewed, calibrated against nothing. |
| iSAQB Lehrplan CPSA-F 2025.1-rev2-DE (linked from the vault index, **not** in the vault) | 6 chapters, **38** learning objectives (LZ 01-01 … 06-02); their ids and R-levels are in §4a | **Checked 2026-09-10** against the PDF's own page 1: © iSAQB e.V. A working copy on your own computer is permitted when pursuing the certificate. Redistribution or any wider use needs a separate licence (info@isaqb.org). |

The Lehrplan result closes the obvious shortcut: the curriculum is **not** a freely reusable spine. Neither the textbook nor the Lehrplan may be reproduced in a public Book. The Lehrplan's LZ ids, and which topics it covers, are facts that may be referenced. Its wording may not, and that includes the LZ titles.

**The Anhang A extraction is lossy.** The markdown has 15 `X-Frage` labels, but only 13 questions:
- the "Definitionen" A-question appears twice;
- the "Kopplung" K-question is split across two blocks;
- one block lost an option, which survived only in an inline line;
- the DRY question's options spilled into the surrounding prose.

Transcription for B4 therefore works from the **printed book**, not the vault file.

## 1. Owner decisions (2026-09-10)

| # | Decision | Consequence |
| --- | --- | --- |
| 1 | The teaching content is **public, in our own words** | Every note and concept is written fresh (§3). The textbook and the Lehrplan appear only as reading pointers, never as text. Roughly twice the effort of following the book; accepted. |
| 2 | Content language is **German** | The domain's `glossLanguage` is `de`. No translation step. |
| 3 | **Include everything**: chapter 7 (Werkzeuge) and the R3 objectives | L9 exists at all. Units whose LZs are **all** R3 carry "(R3, nicht prüfungsrelevant)" in their `goal` (§4a says which), so a learner short on time can skip them with the existing unlock-skip sheet. The book's "EXKURS" label is **not** the same thing as R3; only §4a decides. |
| 4 | The **AI practice exam ships publicly**, badged | It goes in the same public Book as the official exam, and every question carries `generated: true`. This answers 0027's second open question. |
| 5 | Book title: **"iSAQB Software architecture Foundation Level (CPSA-F)"** | The title leads with the marks, so the §2 non-affiliation line in the description is mandatory, not optional. |
| 6 | **Label** pure-R3 units "nicht prüfungsrelevant" | Applies to the five units §4 marks R3. |
| 7 | The description **discloses AI assistance** | §2 fixes the wording. |

## 2. The Books and where each goes

This adds a fourth row, the teaching content, to 0027 §8's licence table. The other three rows are 0027's, here with their concrete home.

| Content | Destination | Book |
| --- | --- | --- |
| Teaching lessons (own words, keyed to LZ ids) | **Public Library** | `softwarearchitektur` |
| iSAQB Beispielprüfung (verbatim, attributed) | **Public Library** | same Book, exam 1 |
| KI-generierte Übungsprüfung (`generated: true`) | **Public Library** | same Book, exam 2 |
| Anhang A (13 textbook questions, verbatim) | **Private**, `.bbbook` import only | a separate private Book owned by the owner |

**One public Book, not three.** 0027 §3 makes an exam a sibling of a lesson, so the exams sit after the lessons. Splitting them into separate Books would duplicate the domain and give the same concepts two independent SRS states.

**Attribution lives in two learner-visible places:** the Book `description`, and the official exam's `description`. The review found that `resource` titles and `sourceRef`s render only on editor screens, so they are not an attribution site and not a citation a learner ever sees. 0027 §6's exam intro screen does not list the description among what it shows, so §6 hands that back.

**Trademarks and affiliation.** iSAQB® and CPSA-F® are registered marks. The Book may name the exam it prepares for, but must not look endorsed. The title is the owner's (decision 5): **"iSAQB Software architecture Foundation Level (CPSA-F)"**. Because it leads with the marks, the description must open with two sentences, and neither may be dropped:
- *"Unabhängige Lernhilfe, nicht vom iSAQB® e.V. herausgegeben, geprüft oder anerkannt."*
- *"Die Lerninhalte wurden mit KI-Unterstützung verfasst und nicht von iSAQB-Trainer:innen geprüft."* (decision 7)

**Free of charge.** Exam 1's licence allows passing it on only free of charge. The Library is free today. If BetterBeaver ever charges for Books, this exam stays free or leaves.

**Codes and ids.**
- Book `softwarearchitektur`; `book.code` and domain code both `sa`. This is legal: class (c) prefixes lesson/unit/task/resource ids with the book code and entry ids with the domain code, and the demo Book uses `dx` for both.
- Domain: `kind: "general"`, `glossLanguage: "de"`, `readAloudLang: "de-DE"`.
- Id patterns:
  - lessons `sa-lesson-<n>`;
  - units `sa-unit-<n>-<m>`;
  - tasks `sa-task-<n>-<m>-<type>[-<k>]`;
  - resources `sa-resource-<name>`;
  - concepts `sa-<term>`, one family per lesson.
- Slugs transliterate umlauts (`sa-kohaesion`); titles and text keep them.

## 3. The own-words rule

This rule is what makes decision 1 true, so it is a checklist step, not a hope.

- **Structure is free, expression is not.** The layout follows the curriculum's topics and may mirror the book's order. Every word learners see is written by us:
  - notes;
  - `definition` and `example` fields;
  - unit and lesson `title`/`goal`;
  - task `instructions`;
  - Book and exam `description`s.
- **Write from understanding, not from the page.** Read the section, then write with it closed. Nothing may be copied or closely paraphrased from the book, the Glossar or the Lehrplan. That includes the book's *Lernkontrolle* lists, which reproduce Lehrplan text, and the LZ titles.
- **Goals cite LZ ids, never LZ titles.** Example: "Kopplung und Kohäsion bewerten (LZ 03-04, 03-06)". An 8-word check cannot catch a copied 5-word title, so this rule does it instead.
- **Examples are invented.** The book's running examples (CoCoME) and its 86 figures are not reproduced. Established public material may be named and explained freely: named patterns, SOLID, the ISO 25010 characteristic names, ATAM, arc42, C4, 4+1.
- **Structural paraphrase is a risk too.** Reproducing the book's *selection and arrangement*, for example its nine documentation rules of 5.7 as a nine-item list, can infringe even with fresh wording. Where the book has an enumerated list of its own making, teach the idea in our own structure. Lists that are the field's common property (SOLID, the ISO 25010 characteristics) are exempt.
- **Definitions are short:** one sentence, aimed at ≤ 25 words. `recognize` and `matching` show the whole `definition` as an answer option (`entities.ts:408-409, 450-451`), so long definitions make a four-option MCQ unreadable. Depth goes in the unit's note.
- **Mechanical check** (`scripts/overlap-check.py`, written in step A1). It flags any run of **8 or more consecutive words** shared between a candidate and a source, after case-folding and punctuation stripping. It exits non-zero on any hit.
  - **Candidates:** every free-text field listed above, not only notes.
  - **Source normalisation** is what keeps it from failing open:
    - strip footnote digits glued to words (`setzen1` → `setzen`);
    - extract the Glossar's *Erklärung* column as its own corpus, without the interleaved *Übersetzung*/*Quelle* columns, whose English words otherwise break every run;
    - treat the Lehrplan as the owner's local `pdftotext` extraction. The Lehrplan's terms permit that working copy; it is never committed.
  - **Self-check with a positive control:** a verbatim Glossar definition and a verbatim book sentence must both be flagged, and a fresh sentence must not.
  - **Threshold:** 8 words, not 3, because technical terms legitimately recur.
- **The AI exam gets the same check** before it ships publicly (B3), plus a read for structural paraphrase. It was written from the book and tests the book's own selections. What survives that review is **residual risk, recorded here and accepted with decision 4**.

## 4. Decomposition

Line ranges refer to the vault's book file. Unit sizing follows `/ingest` step 1: one 5–15 minute session, ~7–13 concepts, ≤ 10 tasks, ≤ 3 notes.

| Lesson | Book § (lines) | LZ | Units (working titles; **R3** = all its LZs are R3) |
| --- | --- | --- | --- |
| L0 Die Prüfung | 1.2–1.3 (71–138) | — | 1. What the certificate is, R1/R2/R3, the A/P/K question types and how they score. Facts only, own words. |
| L1 Grundlagen | 2 (187–651) | 01-01…01-06 | 1. Softwareintensive Systeme (2.2) · 2. Bausteine, Schnittstellen, Konfigurationen (2.3.1–2.3.2) · 3. Beschreibung, Ebenen, Umgebung, Nutzen (2.3.3–2.3.6) · 4. Entwurf aus der Vogelperspektive, die Rolle (2.4) |
| L2 Anforderungen und Randbedingungen | 3 (652–972) | 02-01…02-05 | 1. Stakeholder, Einflussfaktoren (3.2) · 2. Qualitätsmodelle, ISO 25010, Taktiken (3.3) · 3. Szenarien (3.4) |
| L3 Vorgehen und Prinzipien | 4.2–4.3 (1000–1241) | 03-02, 03-03, 03-04, 03-05 | 1. Vorgehen beim Entwurf (4.2) · 2. Top-down/bottom-up, Zerlegung, KISS, SoC (4.3.1–4.3.2) · 3. Integrität, Fehler erwarten, Information Hiding, Refactoring (4.3.3–4.3.6) |
| L4 Entwicklungsansätze, Entwurfstechniken | 4.4–4.5 (1242–1631) | 03-01, 03-04, 03-06, 03-07 | 1. DDD (4.4.1) · 2. Globale Analyse, Evolutionäre Architektur, MDA, Referenzarchitekturen (4.4.2–4.4.5) · 3. Kopplung, Kohäsion, SOLID, Zyklen (4.5) |
| L5 Muster | 4.6–4.7 (1632–2043) | 03-08, 03-09, 03-12 | 1. DI, MVC/MVP/PAC (4.6.1–4.6.2) · 2. Schichten, Pipes and Filters, Blackboard (4.6.3) · 3. Verteilte Systeme: Broker, SOA, Microservices (4.6.4; LZ 03-08 **and** 03-12) · 4. Entwurfsmuster I (4.7.1–4.7.6) **R3** · 5. Entwurfsmuster II (4.7.7–4.7.12) **R3** |
| L6 Daten, Querschnitt, Betrieb | 4.8–4.9 (2044–2194), 5.4 (3070–3134) | 01-07, 03-10, 03-11 | 1. Daten und Datenmodelle (4.8) · 2. Querschnittskonzepte: Fehlerbehandlung, Sicherheit (5.4) · 3. Deployment, Betrieb, DevOps (4.9) **R3** |
| L7 Beschreibung und Kommunikation | 5.2–5.3, 5.5–5.8 (2286–3069, 3135–3381) | 04-01…04-03, 04-05…04-09 | 1. Sichten, UML, Schablonen (5.3.1–5.3.3) · 2. Kontext- und Bausteinsicht (5.3.4–5.3.5) · 3. Laufzeit- und Verteilungssicht, Verfeinerung (5.3.6–5.3.9) · 4. Architektur und Implementierung, Dokumenttypen, ADRs (5.5–5.6) · 5. Praxisregeln, 4+1, SAGA (5.7–5.8) |
| L8 Analyse und Bewertung | 6 (3418–3691) | 05-01…05-03 | 1. Qualitative/quantitative Bewertung, Metriken, Goodhart (6.2) · 2. Durchstich, Prototyp (6.3) · 3. ATAM (6.4) |
| L9 Werkzeuge | 7 (3692–3976) | 04-09 | 1. Kosten, Lizenzen, Anforderungs- und Modellierungswerkzeuge (7.1–7.3) **R3** · 2. Analyse-, Versions-, Test- und Dokumentationswerkzeuge (7.4–7.9) **R3** |

That makes **10 lessons and 32 units**, at roughly 8–10 concepts per unit: **~280–330 concepts** in the `sa` lexicon.

Placement calls:

- **5.4 moves into L6**, next to LZ 03-10. The Lehrplan files cross-cutting concepts under design, and the exam's questions on them (Beispielprüfung Q3) test design reasoning.
- **CoCoME (5.2) is not reproduced** (§3). L7's view units use invented examples.
- **Lehrplan chapter 6** (LZ 06-01/06-02, both R3) has no unit of its own: its "trace requirements to a solution in a worked example" is covered by L7's views and L8's ATAM unit.
- **LZ 04-04** reads "Lernziel nicht gefunden" in both the Lehrplan and the book (a placeholder). Nothing maps to it.

**The Glossar and abbreviations are checklists, not sources.** They say which terms the book considers core. Each term a unit uses becomes an `sa-` concept with a fresh one-sentence definition (§3). Terms no unit uses are skipped.

**Tasks per unit (phase A, today's task types):**
- `recall` over the unit's concepts (term → definition);
- `recognize` (needs ≥ 4 concepts in the unit, which every unit clears);
- `matching` over term ↔ definition, **2–5 items per task** (validator class (p), `validate.ts:504-510`).

The progression engine derives the rest of the ladder from these, including `recognize-produce` at 4, `recall` at 8 and `write` at 9. **Amended 2026-09-11** ([learning-format review](../learning-format-review-2026-09-11.md), [0027 §10–11](0027-authored-questions-and-exam-mode.md)): two of those are wrong for this Book. `write` makes the learner type labels like "Standpunkt (Viewpoint)", and `recognize-produce` asks for a term from its definition, which the exam never does. So the `sa` domain declares `exercises: ["matching", "recognize", "recall"]`, and a concept's life becomes board → MCQ → spaced flashcard. The Book declares `practiceDepth: "fast"` (one correct answer per concept per session; a learner's explicit Settings choice still wins). Both fields are additive, need no schema bump, and are set once 0027 steps 1–2 land. The earlier claim here that 0027's `assign` fills a concept's empty level 3 was wrong: a concept is never asked as `assign`, and questions no longer enter the drill at all (0027 §2a, §12).

### 4a. Learning objectives and R-levels (from the owner's local Lehrplan copy; ids and levels only)

| LZ | R | LZ | R | LZ | R | LZ | R |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-01 | R1 | 02-03 | R1 | 03-07 | R1–R3 | 04-04 | R3 |
| 01-02 | R1 | 02-04 | R1–R3 | 03-08 | R1, R3 | 04-05 | R1 |
| 01-03 | R3 | 02-05 | R1 | 03-09 | R3 | 04-06 | R1 |
| 01-04 | R1 | 03-01 | R1 | 03-10 | R1 | 04-07 | R2 |
| 01-05 | R3 | 03-02 | R1 | 03-11 | R3 | 04-08 | R1–R2 |
| 01-06 | R1 | 03-03 | R1, R3 | 03-12 | R3 | 04-09 | R3 |
| 01-07 | R2 | 03-04 | R1–R3 | 04-01 | R1 | 05-01 | R1 |
| 02-01 | R1, R3 | 03-05 | R1, R2 | 04-02 | R1–R3 | 05-02 | R1, R3 |
| 02-02 | R1–R3 | 03-06 | R1 | 04-03 | R2–R3 | 05-03 | R2 |
| | | | | | | 06-01, 06-02 | R3 |

The pure-R3 objectives are 01-03, 01-05, 03-09, 03-11, 03-12, 04-04, 04-09, 06-01 and 06-02. A unit is marked R3 only when every LZ it serves is on that list. L5 unit 3 also serves 03-08 (R1), so it stays unmarked.

## 5. Order of work

**Working tree:** `scratch.local/softwarearchitektur/`, git-ignored by the repo's `*.local` rule, is the Book's working copy across runs. It is never the repo's `content/` (plan 0015 decision 10), and it is never committed. The backend's `versions` table is its history, and every republish is its backup.

**Credentials:** the owner's **service key** is needed to republish. It is also needed to `pull-book.ts` the Book while it is unlisted, because `documents_select` is maintainer-only and the anon catalog path sees listed rows only. While the working tree exists, no pull is needed. After listing, pull (into an **empty** directory; `pull-book.ts` refuses a non-empty one) before each run, since in-app edits may have landed. If the owner runs these scripts by hand, each run starts and ends with them.

### Phase A — teaching Book (not blocked; `/author` + `/ingest`, never `/delegate`)

- **A1. Tooling and checklist.**
  1. Add a **"Scratch-tree Books (general domain)"** section to `.claude/skills/ingest/SKILL.md`. It **replaces** steps 0, 5, 6 and 7 for Books that must not live in `content/`; steps 1–4 keep their sizing rules with concepts in place of lexemes:
     - **Step 0:** work in the persistent working tree; `pull-book.ts` only as described above.
     - **Step 2:** textbook section → one-sentence `concept` entries, deduped against the `sa` lexicon.
     - **Step 3:** section → note; no `sentence` items, see §6.
     - **Step 5:** wire lessons, units and `book.lessonIds` in the working tree.
     - **Step 6:** run `BB_CONTENT_DIR=scratch.local/softwarearchitektur corepack pnpm exec vitest run packages/schema/src/content.test.ts`, then the overlap check, then the browser pass (A-review below).
     - **Step 7:** `republish-content.ts` with the same `BB_CONTENT_DIR`, **no commit**, then one line in this plan's implementation log.

     It also carries §3 and points at §4 for line ranges.
  2. Write `scripts/overlap-check.py` per §3, including its assert-based self-check with the positive control.
  3. Write `scripts/pack-bbbook.ts`. It reads a scratch tree with `content-fs.ts`'s `loadContentDocuments`, which returns exactly the `BookDocument`/`DomainDocument` pair `PrivateBookExportFile` declares (`private-transfer.ts:12-19`). It then writes `{ kind: "bb-private-book", formatVersion: 1, schemaVersion: CONTENT_SCHEMA_VERSION, book, domain, assets: {} }`. It serves both the A-review path and B4.
  4. **Dry run = A2's own L0 tree.** The demo tree can't serve as a dry run: every fresh profile pre-adds the onboarding Book under the same ids, and the demo Book has assets the packer deliberately refuses. So the first A-review, on the small L0 scaffold, is the dry run. The import path has so far only been exercised on files the app exported itself. Nothing found in the import code requires UUID ids; the UUID mentions in `source.ts` are comments about the in-app create path.
     - **If that first import fails**, the fallback is a one-line change to this plan, not a redesign: list the Book right after A2 and do every browser pass through the Library.

  All of A1 fits in one session.
- **A-review (the browser pass for every unit).** A Book fresh from `republish-content.ts` is unlisted, and the app cannot open an unlisted Book it has never had on the device: the Library reads the listed-only catalog, and the author screen's open button falls back to the Library. So the pass does not go through the backend:
  1. `pack-bbbook.ts` the working tree;
  2. import it through Settings as a private Book in a **fresh browser profile** (the `apps/web:verify` Playwright recipe);
  3. do one practice session per new unit.

  A fresh profile has no Library copy to collide with. On a real device, delete the review copy before adding the Library Book, because the boot-time collision rule keeps the earliest-added Book.
- **A2. Scaffold:** the Book (title, icon, description with the affiliation disclaimer, per §2), the `sa` domain, the textbook and Lehrplan resources, and L0. Validate, review, republish. The owner answers the two open questions below at this step.
- **A3–A11. One lesson per `/ingest` run**, in table order L1 … L9, each through the scratch-tree section above.
- **Listing:** after L2 ships, the owner lists the Book with the README's SQL step (`update public.documents set listed = true where id = '<doc id>';`, `supabase/README.md`). `set_listed` needs a signed-in admin, which the SQL editor is not. Learners get later lessons through the opt-in per-Book update.

### Phase B — questions and exams (blocked)

0027's slices 1-6 and the schema-3 bump are shipped, so B1 (authored unit questions) is unblocked and its first pass is live. B2-B4 additionally want 0027's amendment deployed, so that questions are checked rather than drilled.

- **B1. Authored practice questions per unit.** A handful of our own `choice`/`assign` questions per unit (§3 applies), in that unit's tasks, following 0027's authoring rule: the affirmative label goes first. They are answered on the unit's **Check** page, once, and then spaced by Daily Review; they are never drilled (0027 §12). Each carries an `explanation`, plus a `why` on every option whose distractor targets a specific misconception (0027 §1).
- **B2. Exam 1, the iSAQB Beispielprüfung.**
  - 38 `question` items, transcribed **verbatim**, **including the source's label order**. Where that differs from 0027's affirmative-first rule, the source wins, because reordering would modify a text we claim to reproduce.
  - **Exam-only**: the tasks sit in no unit (0027 §3a), so the questions stay unseen until the learner has taken the exam.
  - **Explanations are model-written** (owner decision, 2026-09-11, [review](../learning-format-review-2026-09-11.md) §6.3): an `explanation` per question and a `why` per option, in our own words, with `explanationGenerated: true` on every question. §3's overlap check applies to them like any other free text. The source has answer keys only, so the explanations carry no licence problem.
  - Each entry carries the `lessonId` of the lesson it tests, for 0027 §6's readiness per lesson.
  - Points per the source.
  - Ruleset `{ passPercent: 60, timeLimitMinutes: 75, partialCredit: true, negativeMarking: true }` (0027 §3).
  - Attribution per §2.
- **B3. Exam 2, the KI-Übungsprüfung.** Same shape, with every question `generated: true`. Overlap check and structural-paraphrase read first (§3). The Book description repeats the vault file's warning: model-written, unreviewed, and a score here predicts nothing about the real exam.
- **B4. Private Anhang A Book.**
  - Contents: the 13 distinct questions, transcribed from the **printed book**. Where one duplicates an exam-1 question (at least the "Definitionen" and "Begriff" questions, which correspond to Beispielprüfung Q1/Q2), drop it rather than drill the same item in two Books with two SRS states.
  - Structure: its own domain (0017 decision 2) and UUID ids (0017 decision 4).
  - Format: a practice unit, not an exam. Anhang A gives no ruleset or time limit, and inventing one would claim a calibration the source never made.
  - Delivery: authored as JSON, packed with `pack-bbbook.ts`, and imported through Settings on the owner's device.
  - Neither the file nor its scratch tree is ever committed or uploaded.

## 6. Gaps this plan hands back

**Gaps 1 and 2 closed 2026-09-11** by 0027's amendment. Gap 1: exam-only tasks sit in no unit and are owned by the exam's reference; they reach Daily Review only once the report's practice session has given them SRS state (0027 §3a). Gap 2: the intro renders the description in full (0027 §6). Gap 3 stands. The text below is kept as the requirement 0027 answered.

1. **0027 must decide unit ownership for exam-only questions.**
   - **Why it's required:** class (d) (`validate.ts:387`, `414-418`) orphans every book-owned item and task that no unit owns, and 0027 §7 (ae) does not exempt exam material. 0027 line 44 implicitly assumes exam tasks sit in unit `taskIds`.
   - **Why the obvious layouts fail:** putting exam questions in any unit spoils the exam three ways:
     - Practice drills them;
     - each question is its own scheduling unit, so Daily Review serves it (0027 §5);
     - 0026's amended §3 makes a `question` item playable with no authored task at all, so moving only the *tasks* out of units does not help.
   - **The requirement handed to 0027, as an amendment before its slice 1:** exam-only questions (items and their tasks) are exempt from unit ownership, and are neither reviewed nor constructed until the learner has submitted that exam. Whether an exam owns them directly or a flag exempts them is 0027's design.
2. **0027's exam intro screen must render the exam's `description`.** For exam 1 the description carries a licence condition (§2). 0027 §6 lists what the intro shows, and the description is not on the list.
3. **`sentence` items need a `translation`** (`entities.ts:238-242`), which a German-only general Book has no use for. So phase A authors no `sentence` items and uses no `cloze`/`scramble`/`build`. If key-statement cloze turns out to be wanted, an optional `translation` for general domains is a schema question for its own plan.

## Non-goals

- No schema, engine or UI changes; §6 hands those to their owners. The three A1 scripts are authoring tools.
- No reproduction of textbook or Lehrplan text, figures, examples or structure anywhere public (§3).
- No English edition.
- No exam over the teaching units' own questions (0027 non-goal: no exam generation).
- No exams inside the unlock chain (0027 non-goal).

## Docs

- `docs/STATUS.md`: a `0028` row in the Plans table on drafting. The backlog gains one content entry when phase A starts.
- `docs/design.md`: no rows on drafting (0012 asset-pipeline precedent). The own-words rule and the scratch-tree authoring path graduate to the decision table when L0 ships.
- `~/vault/sources/software-architecture/index.md`: one line linking this plan, per the vault's "link, never copy" rule. Done on drafting.

## Done-criteria

- **Phase A:**
  - The `softwarearchitektur` Book is listed in the Library with all 10 lessons and their 32 units.
  - The implementation log below has one line per unit: date, `overlap-check` exit 0, scratch-tree validation green, and the browser pass done.
  - The Book description carries the affiliation disclaimer.
- **Phase B:**
  - Both public exams run end to end in the browser per 0027's verification pass.
  - The official exam's attribution shows on the Book card and on the exam intro screen.
  - No exam question appears in a unit's Check, Practice or Daily Review until the learner has taken that exam's "practise what you missed" session (0027 §3a).
  - The Anhang A Book imports from its `.bbbook` on the owner's device.
  - No Anhang A `.bbbook` or scratch tree is committed to either repo or uploaded to the backend.

## Implementation log

One line per unit as it ships: `L<n>.<m> · date · overlap 0 · validate green · browser ✓`.

- **A1 done 2026-09-10.** `scripts/overlap-check.py` (self-test with Glossar and book positive controls; on the real sources it flags verbatim Glossar and chapter text and passes a fresh sentence) and `scripts/pack-bbbook.ts`. `/ingest` has its "Scratch-tree Books" section. The Glossar rule changed during implementation: terms are kept in the stream, because in 30 of 117 entry rows term and definition are separated by a single space.
- **Dry run passed 2026-09-10:** the packed L0 tree imported into a fresh profile with no errors, so the Library-listing fallback is not needed.
- L0.1 · 2026-09-10 · overlap 0 · validate green · browser ✓ (13 steps, 3 matching boards, 10 MCQs) · **not yet republished**
- L1.1 · 2026-09-11 · overlap 0 · validate green · browser ✓ (10 concepts; 12 steps) · **not yet republished**
- L1.2 · 2026-09-11 · overlap 0 · validate green · browser ✓ (10 concepts; 16 steps) · **not yet republished**
- L1.3 · 2026-09-11 · overlap 0 · validate green · browser ✓ (10 concepts; 10 steps) · **not yet republished**
- L1.4 · 2026-09-11 · overlap 0 · validate green · browser ✓ (13 concepts; 13 steps) · **not yet republished**
- Owner, 2026-09-11: nothing goes into the repo; the Book lives in the backend, with `scratch.local/softwarearchitektur/` as the working copy.
- **B1 for L0 and L1 authored and shipped 2026-09-12** (owner-approved; `republish-content.ts` put `topic:softwarearchitektur` and `domain:sa` at version 2, **schema 3**, still listed). Per unit three questions — two `choice` (one multi-answer, one single-answer) plus one `assign` of 3–4 rows — each with an `explanation`, a `why` on every misleading option, and `generated: true`; 15 in total, in one `choice` and one `assign` task per unit. The `sa` domain now declares `exercises: ["matching", "recognize", "recall"]` and the Book `practiceDepth: "fast"` (0027 §§10–11). **Content review in the same pass:** two matching boards had only 2 pairs, where clearing one hands over the other, so they were merged into their neighbours (L1.3 → 5 + 5, L1.4 → 5 + 3 + 5); the rest of L0/L1 needed no change. Verified: validator green, `overlap-check` exit 0 over the new questions, and a 16/16 browser pass on the packed `.bbbook` in a fresh profile (`scratch.local/verify-sa.mjs`) — every unit's Check page reads "3 questions", the explanation, `why` and KI-generiert badge render, the `assign` rows carry their authored labels, and the drill asks neither a question nor a typed answer. The reasoning behind these shapes is now [docs/content-practices.md](../content-practices.md), linked from `/ingest`.
- **Shipped 2026-09-11 (owner-approved):** `republish-content.ts` inserted `topic:softwarearchitektur` and `domain:sa` at version 1, schema 2, **unlisted**. L0 and L1 are in the backend; the "not yet republished" marks above are resolved. **Listed 2026-09-11** on the owner's call, after L1 rather than L2: `listed = true` on both documents via the service key, confirmed through the anon `catalog` view. From here each lesson reaches learners as an opt-in per-Book update.

## Open questions (owner, at step A2)

- **Icon.** `BOOK_ICONS` is a fixed enum. Title, R3 label and AI disclosure were settled 2026-09-10 (decisions 5–7).
