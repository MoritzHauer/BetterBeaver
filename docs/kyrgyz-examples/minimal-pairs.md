# Kyrgyz minimal-pair candidates — staged, NOT publishable yet

**Blocked on audio.** `pairPayloadSchema` (`packages/schema/src/entities.ts:225`)
requires `a.audioRef` and `b.audioRef`, both non-optional `slugSchema`. The
Kyrgyz Book has **zero** audio assets (0 of 167 book items, 0 of 232 lexicon
entries), and `source.ts:779` publishes a dangling `audioRef` as an error — so
minting stems for files that do not exist would break the publish, not stage it.
Browser TTS is no substitute: `getLexiconAssetUrl` resolves a stored file.

Record two clips per row, upload them via the editor's Assets manager, then turn
each row into a `pair` item and hang a `minimal-pair` task off the phonetics
unit ("Vowels" / "Consonants and Kyrgyz letters", which today have no exercise
beyond `recognize`).

## Group A — short vs long vowel (from the manual, "Make distinction", p. 23)

Source: `~/vault/sources/kyrgyz/Kyrgyz Language Manual/Kyrgyz Language Manual.md`
lines 755–880. The scan of this section is poor (Өө renders as `Θε`, `ə`); the
glosses below are corrected, and the four rows the manual prints verbatim are
marked where its gloss looked wrong.

| a                      | b                              | contrast                                                        | confidence                              |
| ---------------------- | ------------------------------ | --------------------------------------------------------------- | --------------------------------------- |
| ток — full, satiated   | тоок — hen                     | short **о** vs long **оо**                                      | high                                    |
| боз — grey             | бооз — pregnant (of livestock) | short **о** vs long **оо**                                      | high                                    |
| улуу — great           | уулу — his/her son             | where the long **уу** sits                                      | high                                    |
| оку — read!            | окуу — studying                | short final vs long **уу**                                      | high                                    |
| күң — female slave     | күү — tune, melody             | manual glosses күң as "күн - slave"; **verify**                 | medium                                  |
| ур — hit!              | ууру — thief                   | not strictly minimal (length + final vowel)                     | low                                     |
| күр / күүр, сүр / сүүр |                                | manual glosses ("strap"/"fry", "gray"/"suslic") look unreliable | low — **drop unless a native confirms** |

## Group B — both sides are already Book vocabulary

Better teaching value and cheaper to record: every word here is already a
lexicon entry the learner meets, so the pair reuses clips that are worth having
anyway.

| a              | b            | contrast                                 |
| -------------- | ------------ | ---------------------------------------- |
| суу — water    | суук — cold  | final **-к**                             |
| жаз — spring   | жай — summer | final **-з** vs **-й**                   |
| бир — one      | бер — give!  | **и** vs **е**                           |
| кыз — girl     | кыш — winter | final **-з** vs **-ш**                   |
| күн — day, sun | түн — night  | initial **к-** vs **т-**                 |
| ат* — horse    | эт — meat    | **а** vs **э** (*ат is not yet an entry) |

## Shape of the item, once audio exists

```json
{
  "id": "ky-<uuid>",
  "kind": "pair",
  "sourceRef": "<the phonetics resource id>",
  "payload": {
    "a": { "script": "суу", "audioRef": "<stem>" },
    "b": { "script": "суук", "audioRef": "<stem>" },
    "contrast": "суук ends in -к; суу does not."
  }
}
```

`pair` items feed `minimal-pair` and nothing else (validator class (o)), and the
task itself requires no asset — the audio lives on the two sides.
