import { describe, it, expect, vi } from "vitest";
import { slugPattern } from "@betterbeaver/schema";
import { assetFolder, buildObjectName, parseObjectName } from "./storage";

describe("assetFolder", () => {
  it("buckets image/* as img", () => {
    expect(assetFolder("image/png")).toBe("img");
  });

  it("buckets everything else as audio", () => {
    expect(assetFolder("audio/wav")).toBe("audio");
  });

  it("falls back to audio for an empty or unknown MIME", () => {
    expect(assetFolder("")).toBe("audio");
    expect(assetFolder("application/octet-stream")).toBe("audio");
  });
});

describe("buildObjectName / parseObjectName round-trip", () => {
  const stem = "ky-a1b2c3d4";

  it("round-trips a plain name", () => {
    const objectName = buildObjectName(stem, "salam.mp3");
    expect(parseObjectName(objectName).stem).toBe(stem);
  });

  it("round-trips a name with spaces and '#'", () => {
    const objectName = buildObjectName(stem, "my song #1.mp3");
    expect(parseObjectName(objectName).stem).toBe(stem);
  });

  it("round-trips a name containing its own '__'", () => {
    const objectName = buildObjectName(stem, "sa__lam.mp3");
    expect(parseObjectName(objectName).stem).toBe(stem);
  });

  it("round-trips a name that sanitises to nothing", () => {
    const objectName = buildObjectName(stem, "");
    expect(parseObjectName(objectName).stem).toBe(stem);
  });
});

// Records every path handed to the mocked `upload()` call below.
const uploadedPaths: string[] = [];

vi.mock("./supabase", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploadedPaths.push(path);
          return Promise.resolve({ data: { path }, error: null });
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://example.test/storage/v1/object/public/assets/${path}`,
          },
        }),
      }),
    },
  }),
}));

describe("uploadAsset's generated stem", () => {
  // Exercises the actual shipped stem generation (not a copy of the
  // formula) via a mocked Supabase client, so this fails if `uploadAsset`
  // ever starts deriving the stem from the filename instead — the exact
  // rule spec 0012-C §1 calls load-bearing.
  it("matches slugPattern and is prefixed by the book code, over many uploads", async () => {
    const { uploadAsset } = await import("./storage");
    for (const bookCode of ["ky", "en-basic", "demo"]) {
      for (let i = 0; i < 5; i++) {
        const file = new File(["hi"], "salam.mp3", { type: "audio/mpeg" });
        const asset = await uploadAsset("topic:demo", bookCode, file);
        expect(asset.stem).toMatch(slugPattern);
        expect(asset.stem.startsWith(`${bookCode}-`)).toBe(true);
        expect(uploadedPaths.at(-1)).toBe(
          `topic/demo/audio/${asset.stem}__salam.mp3`,
        );
      }
    }
  });
});
