/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NOTE_ICONS } from "./noteIcons.js";

// Indirection matters here: Vite's dev-server plugin (active in apps/web's
// vitest project, unlike packages/engine's) specially rewrites the literal
// `new URL("...", import.meta.url)` call shape into an asset URL served
// over `http://localhost:3000/@fs/...`, which `fileURLToPath` then rejects
// ("must be of scheme file"). Reading `import.meta.url` into a variable
// first keeps this a plain filesystem-path resolution.
const here = import.meta.url;
const ICONS_DIR = fileURLToPath(new URL("../../public/art/icons", here));

describe("NOTE_ICONS", () => {
  it("matches apps/web/public/art/icons/ exactly — fails loudly when someone adds an icon", () => {
    const onDisk = readdirSync(ICONS_DIR)
      .filter((name) => name.endsWith(".png"))
      .map((name) => name.slice(0, -".png".length))
      .sort();

    // Compared without re-sorting NOTE_ICONS: it must already be in this
    // order (spec 0021-1 §1d), not merely contain the same names.
    expect(NOTE_ICONS).toEqual(onDisk);
  });
});
