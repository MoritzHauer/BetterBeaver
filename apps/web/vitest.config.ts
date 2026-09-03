import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Real-browser suites run in the root config's "e2e" project instead.
    exclude: [...configDefaults.exclude, "**/*.e2e.test.ts"],
  },
});
