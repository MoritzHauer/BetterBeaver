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
