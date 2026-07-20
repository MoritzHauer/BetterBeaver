import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "packages/schema",
      "packages/srs",
      "packages/engine",
      "apps/web",
    ],
  },
});
