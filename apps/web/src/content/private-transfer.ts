import { CONTENT_SCHEMA_VERSION } from "@betterbeaver/schema";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import type { PrivateBookRecord } from "./private-store";

/**
 * Export/import of a single private Book as a standalone `.bbbook` file
 * (plan 0017 §7, spec 0017-5 §1). Assets serialise as data URIs so the whole
 * file is one JSON document — no separate archive entries, no manual base64
 * handling on either side (`FileReader.readAsDataURL` / `fetch(dataUri)`).
 */
export interface PrivateBookExportFile {
  kind: "bb-private-book";
  formatVersion: number;
  schemaVersion: number;
  book: BookDocument;
  domain: DomainDocument;
  assets: Record<string, string>;
}

const PRIVATE_BOOK_KIND = "bb-private-book";

/**
 * Rejection rules 1-2 from spec 0017-5 §3: wrong `kind`, or a `schemaVersion`
 * newer than this app supports. Pure — no IndexedDB, no DOM — so it's the
 * one part of import worth unit-testing on its own. The remaining rules
 * (3: cross-Book validation against the user's already-added Books; 4:
 * replace-on-conflict; 5: commit) need live state and live in
 * `content/source.ts` / `SettingsScreen` instead.
 */
export function checkImportFileShape(
  parsed: unknown,
): { ok: true; file: PrivateBookExportFile } | { ok: false; error: string } {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "this file is not a JSON object" };
  }
  const p = parsed as Partial<PrivateBookExportFile>;
  if (p.kind !== PRIVATE_BOOK_KIND) {
    return { ok: false, error: "not a BetterBeaver private Book file" };
  }
  if (
    typeof p.schemaVersion !== "number" ||
    p.schemaVersion > CONTENT_SCHEMA_VERSION
  ) {
    // Mirrors the existing catalog skew check's posture (backend/publishCheck.ts).
    return {
      ok: false,
      error: "this Book needs a newer app — update the app first",
    };
  }
  return { ok: true, file: p as PrivateBookExportFile };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader"));
    reader.readAsDataURL(blob);
  });
}

async function dataUriToBlob(dataUri: string): Promise<Blob> {
  const response = await fetch(dataUri);
  return response.blob();
}

/** Title -> filename slug; falls back to `fallbackId` if the title slugifies
 * to nothing (spec 0017-5 §1). */
function slugifyTitle(title: string, fallbackId: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug !== "" ? slug : fallbackId;
}

// Raw (pre-validation) field readers — same "each file keeps its own tiny
// copy" convention as content/source.ts's and edit/types.ts's rawDomainId.
function rawTitle(book: BookDocument): string {
  return typeof (book.topic as { title?: unknown }).title === "string"
    ? (book.topic as { title: string }).title
    : "";
}

function rawBookId(book: BookDocument): string {
  return typeof (book.topic as { id?: unknown }).id === "string"
    ? (book.topic as { id: string }).id
    : "";
}

/**
 * One private Book as a serialisable payload — the body of a `.bbbook` file,
 * and also the per-Book unit the whole-app backup carries (`progress/backup.ts`).
 */
export async function privateBookExportFile(
  record: PrivateBookRecord,
): Promise<PrivateBookExportFile> {
  const assetEntries = await Promise.all(
    Object.entries(record.assets).map(
      async ([stem, blob]) => [stem, await blobToDataUri(blob)] as const,
    ),
  );
  return {
    kind: PRIVATE_BOOK_KIND,
    formatVersion: 1,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    book: record.book,
    domain: record.domain,
    assets: Object.fromEntries(assetEntries),
  };
}

/**
 * Builds the `.bbbook` file for one private Book and downloads it (spec
 * 0017-5 §1-2).
 *
 * ponytail: the whole file is one JSON string in memory — fine to roughly
 * 20 MB of assets. If a real Book outgrows that, switch to a zip archive
 * with separate asset entries and add the dependency then.
 */
export async function exportPrivateBook(
  record: PrivateBookRecord,
): Promise<void> {
  const file = await privateBookExportFile(record);
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugifyTitle(rawTitle(record.book), record.id)}.bbbook`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses and shape-checks an imported `.bbbook` file (rules 1-2), converting
 * its assets back to Blobs. Does NOT do the cross-Book validation (rule 3)
 * or the replace-on-conflict check (rule 4) — those need live state the
 * caller (SettingsScreen, via `ContentInit.importPrivateBook`) has and this
 * module doesn't.
 */
export async function parsePrivateBookImport(file: File): Promise<
  | {
      ok: true;
      bookId: string;
      book: BookDocument;
      domain: DomainDocument;
      assets: Record<string, Blob>;
    }
  | { ok: false; error: string }
> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: "this file could not be read as JSON" };
  }
  return readPrivateBookFile(parsed);
}

/** `parsePrivateBookImport` minus the file read — the backup restore path
 * already has the payload parsed out of the surrounding backup JSON. */
export async function readPrivateBookFile(parsed: unknown): Promise<
  | {
      ok: true;
      bookId: string;
      book: BookDocument;
      domain: DomainDocument;
      assets: Record<string, Blob>;
    }
  | { ok: false; error: string }
> {
  const shape = checkImportFileShape(parsed);
  if (!shape.ok) {
    return shape;
  }
  const bookId = rawBookId(shape.file.book);
  if (bookId === "") {
    return {
      ok: false,
      error: "this file has no Book id — it may be truncated or hand-edited",
    };
  }
  const assetEntries = await Promise.all(
    Object.entries(shape.file.assets ?? {}).map(
      async ([stem, dataUri]) => [stem, await dataUriToBlob(dataUri)] as const,
    ),
  );
  return {
    ok: true,
    bookId,
    book: shape.file.book,
    domain: shape.file.domain,
    assets: Object.fromEntries(assetEntries),
  };
}
