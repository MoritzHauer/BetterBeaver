import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Build stamp for the About screen. `package.json` is the single source of
// truth for the version (docs/design.md, "Versioning"); the commit is what
// tells an installed PWA's owner which build their service worker is actually
// running, which the version alone can't — several builds share one version.
// Read here rather than imported from `src`: `tsconfig.json` roots the app at
// `src/`, so the manifest is out of the program. `src/version.ts` falls back
// when these are absent (vitest has its own config and defines neither).
const pkgVersion: unknown = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url), "utf8"),
).version;
const commit = process.env.GITHUB_SHA ?? "";

// Phone verification needs TLS off localhost (see README "Install on your
// phone"); point these at a mkcert-generated pair to serve preview over https.
const httpsCert = process.env.PREVIEW_HTTPS_CERT;
const httpsKey = process.env.PREVIEW_HTTPS_KEY;

export default defineConfig({
  // Custom domain serves the repo at its root; CI sets BASE_PATH (deploy.yml).
  base: process.env.BASE_PATH,
  define: {
    __APP_VERSION__: JSON.stringify(
      typeof pkgVersion === "string" ? pkgVersion : "unknown",
    ),
    __APP_COMMIT__: JSON.stringify(commit.slice(0, 7)),
  },
  preview:
    httpsCert !== undefined && httpsKey !== undefined
      ? {
          https: { cert: readFileSync(httpsCert), key: readFileSync(httpsKey) },
        }
      : {},
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "BetterBeaver",
        short_name: "BetterBeaver",
        description: "Spaced-repetition learning, offline-first.",
        theme_color: "#e08820",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Extension list must cover every type emitted from content/*/assets
        // (open-ended globs in src/content/bundled.ts) or new assets silently
        // drop out of the offline precache — extend both together (plan 0002).
        // Workbox also skips files over 2 MiB by default; raise
        // maximumFileSizeToCacheInBytes when content audio grows past that.
        globPatterns: ["**/*.{js,css,html,png,svg,wav,woff2,webmanifest}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
});
