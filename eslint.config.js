import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Type-aware rules do nothing at all without a project service — they
    // fail open, silently. `pnpm lint:types-fire` plants a floating promise
    // and asserts this config still catches it.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Every hit is an object-literal method closing over locals, never
      // using `this` (`content/source.ts`'s `archiveBook` and friends), so
      // passing them as callbacks is safe and the rule only fires noise.
      "@typescript-eslint/unbound-method": "off",
      // Style, not a bug class: flags `async` test helpers that happen not
      // to await. Not worth 14 edits.
      "@typescript-eslint/require-await": "off",
      // React's onClick/onChange are typed `void`, so `onClick={() => save()}`
      // on an async `save` is the normal idiom and the rule fires on all 9
      // SessionScreen grade buttons. Exempted as accepted React practice —
      // but note the promise there is the arrow's *return value*, not a
      // statement, so no-floating-promises does NOT cover it: a rejection in
      // those handlers is genuinely unguarded. Listed in STATUS.md item 8
      // alongside the effect-level sites.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // Real, and not yet fixed: 10 `asyncRead().then(setState)` effects with
      // no rejection handler, so an IndexedDB failure leaves the UI silently
      // stuck. Same family as the boot-loop crash in design.md. Warn rather
      // than error because each fix needs its own error-surfacing decision —
      // tracked in STATUS.md's handoff backlog, not left to rot here.
      "@typescript-eslint/no-floating-promises": "warn",
    },
  },
  {
    // The editor works on `Entity = Record<string, unknown>` on purpose — a
    // draft mid-edit may be invalid, and zod gates at publish instead. These
    // three rules only restate that decision, so they are noise here. Tests
    // are included for a different reason: they build deliberately-partial
    // fixtures that no production code path would ever construct.
    files: ["apps/web/src/screens/edit/**", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    // Config files and scripts sit outside every tsconfig's `include`.
    files: ["**/*.config.{js,ts}", "scripts/**"],
    ...tseslint.configs.disableTypeChecked,
  },
);
