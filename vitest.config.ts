import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      "packages/schema",
      "packages/srs",
      "packages/engine",
      "apps/web",
      {
        // Real-browser checks. Own project because they need node, not the
        // jsdom + DOM-shim setup every other suite runs under.
        test: {
          name: "e2e",
          root: "apps/web",
          environment: "node",
          include: ["src/**/*.e2e.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
