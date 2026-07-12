import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Phone verification needs TLS off localhost (see README "Install on your
// phone"); point these at a mkcert-generated pair to serve preview over https.
const httpsCert = process.env.PREVIEW_HTTPS_CERT;
const httpsKey = process.env.PREVIEW_HTTPS_KEY;

export default defineConfig({
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
        theme_color: "#2e7d32",
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
        globPatterns: ["**/*.{js,css,html,png,svg,wav,webmanifest}"],
      },
    }),
  ],
});
