import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BookDocument,
  type DomainDocument,
  contentIdOf,
  domainSchema,
} from "@betterbeaver/schema";
import {
  createDocumentContentSource,
  upsertDomainEntry,
} from "@betterbeaver/engine";
import {
  privateAssetStems,
  registerPrivateAssets,
} from "../../content/private-assets";
import { newPrivateId } from "../../content/private-ids";
import {
  putPrivateBook,
  readPrivateBook,
  readPrivateBooks,
} from "../../content/private-store";
import { AssetsManager, assetKind, type AssetView } from "./AssetsManager";
import { BookEditor } from "./BookEditor";
import { DomainEditor } from "./DomainEditor";
import {
  type EditTarget,
  type Entity,
  type View,
  firstResourceId,
  initialView,
  rawPrivateDomainId,
  upView,
} from "./types";

/** On-device editing for a private Book (plan 0017 §3): no account, no
 * network, no draft/published distinction — every edit autosaves straight
 * into the private store (`content/private-store.ts`) on the same
 * debounce/flush idiom the maintainer path uses for its localStorage
 * autosave. Unlike the other two shells, this one owns BOTH of the Book's
 * documents (its topic and the Domain it exclusively owns, plan 0017
 * decision 2) and toggles which one `BookEditor`/`DomainEditor` renders via
 * `editingDomain` — a private Book has no catalog list to reach its Domain
 * from otherwise, so the book root view grows a link to it (plan 0017 §3's
 * "a link/tab on the root view is enough"). */
export function PrivateEditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const bookId = contentIdOf(docId);
  const [book, setBook] = useState<BookDocument | null>(null);
  const [domain, setDomain] = useState<DomainDocument | null>(null);
  const [assets, setAssets] = useState<Record<string, Blob>>({});
  const [view, setView] = useState<View>(() => initialView(target));
  // An entry target only makes sense against the Domain side of this Book
  // (`initialView` turns it into `{v:"entry"}`, which only `DomainEditor`
  // renders), so a deep link to one opens there rather than on the Book
  // root with an invisible view selected. The session ✎ is the caller that
  // produces these: a private Book's lexeme question routes here, since a
  // private Book's Domain has no document of its own to open.
  const [editingDomain, setEditingDomain] = useState(
    target?.entryId !== undefined,
  );
  const [editingAssets, setEditingAssets] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const dirtyRef = useRef(false);
  const bookRef = useRef<BookDocument | null>(null);
  const domainRef = useRef<DomainDocument | null>(null);
  const assetsRef = useRef<Record<string, Blob>>({});
  bookRef.current = book;
  domainRef.current = domain;
  assetsRef.current = assets;
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(
    new Map(),
  );

  // One object URL per current stem, for the Assets manager (moved here from
  // `AssetsManager` by spec 0012-C §3, which no longer holds blobs at all).
  // The cleanup revokes exactly what this run's setup created, and runs both
  // on the next `assets` change and on unmount (plan 0017 §4: "Revoke those
  // URLs on unmount") — a plain effect+cleanup pair rather than manual
  // prev/next diffing, so it stays correct under StrictMode's double-invoke
  // too.
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const [stem, blob] of Object.entries(assets)) {
      urls.set(stem, URL.createObjectURL(blob));
    }
    setPreviewUrls(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assets]);

  useEffect(() => {
    // Cannot reject: `private-store.ts`'s `readPrivateBook` is try/catch ->
    // `undefined`.
    void readPrivateBook(bookId).then((record) => {
      if (record === undefined) {
        setLoadError("this private book no longer exists on this device");
        return;
      }
      setBook(record.book);
      setDomain(record.domain);
      setAssets(record.assets);
    });
  }, [bookId]);

  // Same debounce + unmount-flush idiom as the maintainer path's localStorage
  // autosave, writing straight to the private store instead — there is no
  // server draft to sync to, so no separate Sync action. Unlike that
  // localStorage write, `putPrivateBook` opens an IndexedDB transaction and
  // can't be awaited from `beforeunload` (the page is already tearing down),
  // so the tab-close path is best-effort: `visibilitychange` fires earlier
  // and more reliably (especially on mobile, where `beforeunload` may not
  // fire at all) and is registered alongside it; worst case is losing up to
  // the 400ms debounce window's edit.
  useEffect(() => {
    const flush = () => {
      if (
        dirtyRef.current &&
        bookRef.current !== null &&
        domainRef.current !== null
      ) {
        putPrivateBook({
          id: bookId,
          book: bookRef.current,
          domain: domainRef.current,
          assets: assetsRef.current,
        }).catch(() => {
          // Exit-time write; there is no UI left to show the failure on.
        });
        dirtyRef.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [bookId]);

  // Debounced autosave (same 400ms pattern as the maintainer path). Reads
  // the refs, not the closed-over `book`/`domain`/`assets`, when the timer
  // fires: the Assets manager (plan 0017 §4) writes straight through
  // `putPrivateBook` outside this debounce, and if that write's `await`
  // straddles this timer firing, a closure-captured `assets` would be
  // stale — overwriting the just-added/deleted asset with the pre-change
  // map. The refs are current as of the timer's actual fire time instead.
  useEffect(() => {
    if (!dirtyRef.current || book === null || domain === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      putPrivateBook({
        id: bookId,
        book: bookRef.current ?? book,
        domain: domainRef.current ?? domain,
        assets: assetsRef.current,
      }).then(
        () => {
          dirtyRef.current = false;
          setSaveState("saved");
        },
        () => setSaveState("error"),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [book, domain, assets, bookId]);

  const changeBook = (next: BookDocument) => {
    dirtyRef.current = true;
    setBook(next);
  };
  const changeDomain = (next: DomainDocument) => {
    dirtyRef.current = true;
    setDomain(next);
  };

  // Inline validation only (plan 0017 §3): a half-built private Book is a
  // normal intermediate state, so this never gates the autosave above —
  // it only surfaces the same `validateContent` errors the maintainer editor
  // shows before publish. A private Book stands alone (it owns its Domain
  // exclusively, plan 0017 decision 2), so — unlike `validateForPublish` —
  // there is no wider catalog to assemble it against and no backend call.
  const validationErrors = useMemo(() => {
    if (book === null || domain === null) {
      return [];
    }
    const domainId = rawPrivateDomainId(book);
    const built = createDocumentContentSource(
      new Map([[bookId, book]]),
      domainId === "" ? new Map() : new Map([[domainId, domain]]),
      privateAssetStems(),
    );
    return built.broken.find((b) => b.bookId === bookId)?.errors ?? [];
    // `assets` isn't read directly here, but adding/deleting one re-runs
    // `registerPrivateAssets` (below, in `writeThrough`) before this
    // component's own state updates, so it's the signal this memo needs to
    // re-check dangling audioRef/imageRef against the fresh overlay in
    // `privateAssetStems()`.
  }, [book, domain, bookId, assets]);

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (book === null || domain === null) {
    return <main>Loading…</main>;
  }
  // Rebound to plain (never-null) consts: a nested function declaration
  // below closes over these, and TS narrowing from the guard above doesn't
  // reach into a nested function body — only a const whose own type was
  // already narrowed at assignment does.
  const currentBook: BookDocument = book;
  const currentDomain: DomainDocument = domain;

  // Parsed once per render for `BookEditor`'s lexicon prop group (spec
  // 0021-3 §5) — `DomainDocument.domain` is `unknown` at rest (a private
  // Book's own domain document, same as any other), so a fresh/half-edited
  // one that fails `domainSchema` just means the lexicon sheet stays off
  // this render, same best-effort degrade `domainEntries`/`assets` already
  // use elsewhere in this file.
  const domainEntityResult = domainSchema.safeParse(currentDomain.domain);
  const domainEntity = domainEntityResult.success
    ? domainEntityResult.data
    : undefined;

  const bookCode =
    typeof (currentBook.topic as Entity).code === "string"
      ? ((currentBook.topic as Entity).code as string)
      : "";

  /** Persists the full record, then re-registers the runtime overlay
   * (`content/private-assets.ts`) before updating this component's own
   * `assets` state — an asset added or removed mid-session is otherwise
   * invisible to `registerPrivateAssets` until reload (plan 0017 §4 point
   * 3). Ordered before `setAssets` so the dangling-ref check above
   * re-renders against the fresh overlay, not the stale one. Moved here
   * (from `AssetsManager`) by spec 0012-C §3: the manager now only ever
   * sees a plain `onAdd`/`onDelete` pair. */
  async function writeThrough(nextAssets: Record<string, Blob>) {
    await putPrivateBook({
      id: bookId,
      book: currentBook,
      domain: currentDomain,
      assets: nextAssets,
    });
    registerPrivateAssets(await readPrivateBooks());
    setAssets(nextAssets);
  }

  async function handleAssetAdd(file: File) {
    // Never the filename (plan 0017 §4 point 2): filenames contain spaces
    // and other characters `slugPattern` rejects, so the stem is always
    // generated, never derived from what the author picked.
    const stem = `${bookCode}-${newPrivateId()}`;
    await writeThrough({ ...assets, [stem]: file });
  }

  async function handleAssetDelete(stem: string) {
    const next = { ...assets };
    delete next[stem];
    await writeThrough(next);
  }

  // `AssetView[]` built from the blobs + this render's object URLs (spec
  // 0012-C §3). Every stem is always included, matching the old per-card
  // rendering exactly: the card (name, size, stem field, delete button) used
  // to render unconditionally, gating only the `<img>`/`<audio>` element on
  // `previewUrls.get(stem)` being ready. Filtering the *whole card* out
  // until the URL is ready would be a real behaviour change (a Book with
  // assets briefly reads "No assets yet." on entry/after an add) — so an
  // unready stem instead gets `url: ""`, and `AssetsManager` gates the media
  // element on that, same as before.
  const assetViews: AssetView[] = Object.entries(assets).map(
    ([stem, blob]) => ({
      stem,
      name: blob instanceof File ? blob.name : stem,
      kind: assetKind(blob),
      size: blob.size,
      url: previewUrls.get(stem) ?? "",
    }),
  );

  function goUp() {
    if (view.v !== "root") {
      setView(upView(view));
      return;
    }
    if (editingDomain) {
      setEditingDomain(false);
      return;
    }
    if (editingAssets) {
      setEditingAssets(false);
    }
  }

  return (
    <main className="editor">
      <header className="screen-header">
        <button className="plain" onClick={onBack} title="Back to learning">
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back to learning"
          />
        </button>
        {(view.v !== "root" || editingDomain || editingAssets) && (
          <button className="plain" onClick={goUp} title="Up one level">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_N.png`}
              alt="Up one level"
            />
          </button>
        )}
        <h1>{docId}</h1>
      </header>
      <p className="status">
        {saveState === "saving"
          ? "saving…"
          : saveState === "error"
            ? "local save failed — storage may be full"
            : "saved on this device"}
      </p>
      {!editingDomain && !editingAssets && view.v === "root" && (
        <p>
          <button
            className="plain"
            onClick={() => {
              setEditingDomain(true);
              setView({ v: "root" });
            }}
          >
            Edit this Book's lexicon (Domain) →
          </button>
        </p>
      )}
      {!editingDomain && !editingAssets && view.v === "root" && (
        <p>
          <button
            className="plain"
            onClick={() => {
              setEditingAssets(true);
              setView({ v: "root" });
            }}
          >
            Manage assets →
          </button>
        </p>
      )}
      {editingAssets ? (
        <AssetsManager
          book={book}
          domain={domain}
          bookId={bookId}
          assets={assetViews}
          onAdd={handleAssetAdd}
          onDelete={handleAssetDelete}
        />
      ) : editingDomain ? (
        <DomainEditor
          doc={domain}
          view={view}
          setView={setView}
          onChange={changeDomain}
        />
      ) : (
        <BookEditor
          doc={book}
          view={view}
          setView={setView}
          onChange={changeBook}
          hideCoverArt
          domainEntries={domain.entries}
          domain={domainEntity}
          domainCode={domainEntity?.code ?? ""}
          sourceRef={firstResourceId(currentBook)}
          onAddEntry={(entry) =>
            changeDomain(upsertDomainEntry(currentDomain, entry))
          }
          // Images only: a figure's stem validates against `imageStemSet`,
          // so offering an audio stem in the `+ image` picker would author a
          // guaranteed `dangling imageRef` (spec 0021-2 §2d).
          assets={assetViews.filter((asset) => asset.kind === "image")}
          onUploadAsset={handleAssetAdd}
        />
      )}
      {validationErrors.length > 0 && (
        <div className="editor-publish card">
          <ul className="error-text">
            {validationErrors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {validationErrors.length > 20 && (
              <li>…and {validationErrors.length - 20} more</li>
            )}
          </ul>
        </div>
      )}
    </main>
  );
}
