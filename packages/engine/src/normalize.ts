/**
 * Normalizes typed input for cloze/dictation answer checking, applied to
 * both the learner's answer and the target (pinned rule, plan 0002):
 * Unicode NFC, lowercase, strip apostrophes (`'` and `’`), replace every
 * other Unicode punctuation character with a space, then trim and collapse
 * internal whitespace runs to one space. So `don't` -> `dont` while
 * `well-known` -> `well known` (a blanket strip would glue hyphenated words
 * and fail faithful dictation answers).
 */
export function normalizeTypedInput(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/\p{P}/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes a single tapped word token for tap-to-lookup matching (plan
 * 0006, pinned): Unicode NFC, lowercase, then trim punctuation from the
 * edges only — unlike `normalizeTypedInput`, this never touches interior
 * characters (a hyphenated or apostrophe'd word must stay one token), so
 * entry script `"Салам!"` and tapped token `"Салам"` both normalize to
 * `"салам"`.
 */
export function normalizeToken(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/^\p{P}+/gu, "")
    .replace(/\p{P}+$/gu, "");
}
