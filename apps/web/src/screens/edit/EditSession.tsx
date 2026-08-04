import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  type BookDocument,
  CONTENT_SCHEMA_VERSION,
  type DomainDocument,
  documentId,
  domainSchema,
} from "@betterbeaver/schema";
import {
  type AssetStems,
  diffDomainDocument,
  documentProblems,
  draftContent,
  upsertDomainEntry,
} from "@betterbeaver/engine";
import { validateForPublish } from "../../backend/publishCheck";
import {
  type RemoteAsset,
  deleteAsset,
  listDocumentAssets,
  uploadAsset,
} from "../../backend/storage";
import {
  type AuthorDoc,
  type CatalogEntry,
  type Proposal,
  listOpenProposals,
  loadCatalogEntry,
  loadDocument,
  publishDocument,
  saveDraft,
  submitProposal,
} from "../../backend/supabase";
import { allAssetStems, mergeAssetStems } from "../../content/bundled";
import { registerPrivateAssets } from "../../content/private-assets";
import { newPrivateId } from "../../content/private-ids";
import {
  putPrivateBook,
  readPrivateBook,
  readPrivateBooks,
} from "../../content/private-store";
import { FeedbackPanel } from "../../components/FeedbackPanel";
import {
  AssetsManager,
  assetKind,
  assetReferences,
  type AssetView,
} from "./AssetsManager";
import { BookEditor } from "./BookEditor";
import { DomainEditor } from "./DomainEditor";
import { EditMenu, type EditPanel } from "./EditMenu";
import { ProposalReview, emptyDocFor } from "./ProposalReview";
import {
  type EditMode,
  EditSessionProvider,
  type EditSessionValue,
  type PublishState,
  type SaveState,
} from "./EditSessionContext";
import {
  type AnyDoc,
  type Entity,
  type StoredProposal,
  type View,
  draftKey,
  firstResourceId,
  proposalKey,
  rawPrivateDomainId,
  upView,
} from "./types";

/** Stand-ins for a document that has not loaded. `emptyDocFor` is the one
 * copy of these literals (see `ProposalReview`); the cast narrows its union
 * to the slot it is standing in for. Never `{} as BookDocument`: a stand-in
 * missing `notes` crashed `assetReferences` the moment it grew a note scan
 * (spec 0021-2 §2e). */
const EMPTY_BOOK = emptyDocFor("topic") as BookDocument;
const EMPTY_DOMAIN = emptyDocFor("domain") as DomainDocument;

const codeOf = (entity: unknown): string => {
  const code = (entity as Entity | undefined)?.code;
  return typeof code === "string" ? code : "";
};

/** True when a working document differs from what publishing would replace
 * — the only "did this change?" test that survives a page reload, since a
 * resumed local draft is a change nobody typed this session. */
function differs(doc: AnyDoc | null, base: unknown): boolean {
  return doc !== null && JSON.stringify(doc) !== JSON.stringify(base ?? null);
}

// ---------------------------------------------------------------------------
// One server-backed document (maintain or propose)
// ---------------------------------------------------------------------------

type LocalChoice =
  | { s: "none" }
  | { s: "offer-resume"; local: AnyDoc }
  | { s: "offer-stale"; localBaseVersion: number };

interface ServerSlot {
  docId: string;
  kind: "topic" | "domain";
  doc: AnyDoc | null;
  published: AnyDoc | null;
  publishedVersion: number;
  hasDraft: boolean;
  change: (next: AnyDoc) => void;
  readOnly: boolean;
  loadError: string | null;
  saveState: SaveState;
  syncState: "synced" | "unsynced" | "syncing" | "error";
  localChoice: LocalChoice;
  resumeLocal: (local: AnyDoc) => void;
  startOver: () => void;
  sync: () => Promise<void>;
  publishSlot: () => Promise<void>;
  submitSlot: (note: string) => Promise<void>;
  discardDraft: (() => Promise<void>) | null;
  reload: () => Promise<void>;
  assets: RemoteAsset[];
  refreshAssets: () => void;
}

/**
 * `MaintainEditScreen`'s and `ProposeEditScreen`'s lifecycles for ONE
 * document, as branches on `mode` rather than two components. Every
 * behaviour here is carried across from those files unchanged — the
 * local-draft-wins rule, the unmount + `beforeunload` flush, the 400 ms
 * debounce, the `baseVersion` staleness check, the post-publish reload
 * order. They are load-bearing and were each fixed in response to a real
 * bug (spec 0021-5 §1a).
 *
 * `enabled` is false outside edit mode and for the lexicon slot until the
 * Book has loaded and named it — every effect returns early, so a learner
 * navigating with this hook mounted does no I/O and commits no state.
 */
function useServerSlot(
  docId: string,
  mode: "maintain" | "propose",
  enabled: boolean,
): ServerSlot {
  const [record, setRecord] = useState<AuthorDoc | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [working, setWorking] = useState<AnyDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [syncState, setSyncState] = useState<
    "synced" | "unsynced" | "syncing" | "error"
  >("synced");
  const [localChoice, setLocalChoice] = useState<LocalChoice>({ s: "none" });
  const [assets, setAssets] = useState<RemoteAsset[]>([]);
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  const entryRef = useRef<CatalogEntry | null>(null);
  workingRef.current = working;
  entryRef.current = entry;

  const key = mode === "maintain" ? draftKey(docId) : proposalKey(docId);
  // Read from the refs, never the closed-over state: the flush below runs
  // from `beforeunload` and from cleanup, both outside this render's scope.
  const serialize = (): string | null => {
    const doc = workingRef.current;
    if (doc === null) {
      return null;
    }
    if (mode === "maintain") {
      return JSON.stringify(doc);
    }
    // `baseVersion` travels with the doc so a stale local copy can be told
    // apart from a resumable one on the next load.
    const base = entryRef.current;
    return base === null
      ? null
      : JSON.stringify({
          baseVersion: base.published_version,
          doc,
        } satisfies StoredProposal);
  };

  // Local-first (plan 0012 §7 amended): every edit lands in localStorage;
  // the backend sees it only through the explicit Sync/Publish actions. A
  // pending debounced write must survive leaving edit mode or closing the
  // tab, so flush it on both.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const flush = () => {
      if (!dirtyRef.current) {
        return;
      }
      const value = serialize();
      if (value === null) {
        return;
      }
      try {
        localStorage.setItem(key, value);
        dirtyRef.current = false;
      } catch {
        // Exit-time write; there is no UI left to show the failure on.
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
    // `serialize`/`key` are deliberately not deps: both are recomputed every
    // render from these three, and listing them would re-register (and
    // flush) the listener on every keystroke.
  }, [docId, mode, enabled]);

  useEffect(() => {
    // Drop the previous document before loading the next one. This hook
    // outlives any single session (App keeps it mounted through every
    // navigation), so without the reset, editing Book A, leaving, then
    // editing Book B would render A's draft on B's screens until B's load
    // resolved. Ordered after the flush above, which runs in the previous
    // effect's cleanup.
    setRecord(null);
    setEntry(null);
    setWorking(null);
    setLoadError(null);
    setLocalChoice({ s: "none" });
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const fail = (e: unknown) => {
      if (!cancelled) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    };
    if (mode === "maintain") {
      loadDocument(docId).then((doc) => {
        if (cancelled) {
          return;
        }
        setRecord(doc);
        // A local draft always wins over the server copy: it is the
        // author's newest work, possibly written offline.
        const local = localStorage.getItem(draftKey(docId));
        if (local !== null) {
          try {
            setWorking(JSON.parse(local) as AnyDoc);
            setSyncState("unsynced");
            return;
          } catch {
            localStorage.removeItem(draftKey(docId));
          }
        }
        setWorking(doc.draft ?? doc.published);
      }, fail);
    } else {
      loadCatalogEntry(docId).then((loaded) => {
        if (cancelled) {
          return;
        }
        if (loaded === null) {
          setLoadError("this document isn't published/listed");
          return;
        }
        setEntry(loaded);
        const raw = localStorage.getItem(proposalKey(docId));
        if (raw !== null) {
          try {
            const stored = JSON.parse(raw) as StoredProposal;
            setLocalChoice(
              stored.baseVersion === loaded.published_version
                ? { s: "offer-resume", local: stored.doc }
                : { s: "offer-stale", localBaseVersion: stored.baseVersion },
            );
            return;
          } catch {
            localStorage.removeItem(proposalKey(docId));
          }
        }
        setWorking(loaded.published);
      }, fail);
    }
    return () => {
      cancelled = true;
    };
  }, [docId, mode, enabled]);

  // Draft autosave to localStorage, debounced.
  useEffect(() => {
    if (!enabled || !dirtyRef.current || working === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      const value = serialize();
      if (value === null) {
        return;
      }
      try {
        localStorage.setItem(key, value);
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
    // See the flush effect: `serialize`/`key` are derived from these deps.
  }, [working, docId, mode, enabled, entry]);

  // This document's Storage assets (spec 0012-C §4). Best-effort: a listing
  // failure leaves the Assets panel empty rather than blocking the session.
  // Maintain only — a proposer has no Storage write path and RLS shows them
  // no listing either.
  const refreshAssets = useCallback(() => {
    if (!enabled || mode !== "maintain") {
      return;
    }
    listDocumentAssets(docId).then(setAssets, () => setAssets([]));
  }, [docId, mode, enabled]);
  useEffect(refreshAssets, [refreshAssets]);

  // Open proposals are a maintainer concern only, and live on the session
  // (see `useEditSessionState`) rather than here — they key on the Book.

  const kind: "topic" | "domain" =
    record?.kind ??
    entry?.kind ??
    (docId.startsWith("domain:") ? "domain" : "topic");
  const schemaVersion = record?.schema_version ?? entry?.schema_version ?? 0;
  const readOnly = schemaVersion > CONTENT_SCHEMA_VERSION;
  const published =
    mode === "maintain"
      ? (record?.published ?? null)
      : (entry?.published ?? null);

  const change = (next: AnyDoc) => {
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    setSyncState("unsynced");
    setWorking(next);
  };

  async function sync() {
    if (workingRef.current === null) {
      return;
    }
    localStorage.setItem(draftKey(docId), JSON.stringify(workingRef.current));
    dirtyRef.current = false;
    setSyncState("syncing");
    try {
      await saveDraft(docId, workingRef.current);
      localStorage.removeItem(draftKey(docId));
      setSyncState("synced");
    } catch {
      setSyncState("error");
    }
  }

  async function reload() {
    const reloaded = await loadDocument(docId);
    setRecord(reloaded);
    setWorking(reloaded.draft ?? reloaded.published);
    dirtyRef.current = false;
    // Publishing pushed the local work to the server — the local copy is no
    // longer ahead of it. Same clear on accepting a proposal, which writes
    // `documents.draft` server-side and would otherwise be shadowed by this
    // key on the next load.
    localStorage.removeItem(draftKey(docId));
    setSyncState("synced");
  }

  async function publishSlot() {
    const doc = workingRef.current;
    if (doc === null || record === null) {
      return;
    }
    await publishDocument(
      docId,
      record.published_version,
      doc,
      CONTENT_SCHEMA_VERSION,
    );
    await reload();
  }

  async function submitSlot(note: string) {
    const doc = workingRef.current;
    if (doc === null || entry === null) {
      return;
    }
    await submitProposal(docId, entry.published_version, doc, note);
    localStorage.removeItem(proposalKey(docId));
    dirtyRef.current = false;
  }

  async function discardDraft() {
    if (record === null || record.published === null) {
      return;
    }
    await saveDraft(docId, null);
    dirtyRef.current = false;
    localStorage.removeItem(draftKey(docId));
    setSyncState("synced");
    setWorking(record.published);
    setSaveState("saved");
  }

  return {
    docId,
    kind,
    doc: working,
    published,
    publishedVersion:
      record?.published_version ?? entry?.published_version ?? 0,
    hasDraft: record?.draft != null,
    change,
    readOnly,
    loadError,
    saveState,
    syncState,
    localChoice,
    resumeLocal: (local: AnyDoc) => {
      setWorking(local);
      setLocalChoice({ s: "none" });
      // Resuming re-adopts what is already on disk; nothing is pending.
      dirtyRef.current = false;
    },
    startOver: () => {
      localStorage.removeItem(proposalKey(docId));
      if (entry !== null) {
        setWorking(entry.published);
      }
      setLocalChoice({ s: "none" });
      dirtyRef.current = false;
    },
    sync,
    publishSlot,
    submitSlot,
    discardDraft:
      mode === "maintain" && record?.published != null ? discardDraft : null,
    reload,
    assets,
    refreshAssets,
  };
}

// ---------------------------------------------------------------------------
// A private Book: both documents and its blobs, from one store record
// ---------------------------------------------------------------------------

interface PrivateDocs {
  book: BookDocument | null;
  domain: DomainDocument | null;
  loadError: string | null;
  saveState: SaveState;
  changeBook: (next: BookDocument) => void;
  changeDomain: (next: DomainDocument) => void;
  assets: AssetView[];
  addAsset: (file: File) => Promise<void>;
  deleteAsset: (stem: string) => Promise<void>;
}

/** `PrivateEditScreen`'s lifecycle, unchanged (plan 0017 §3): no account, no
 * network, no draft/published distinction — every edit autosaves straight
 * into the private store on the same debounce/flush idiom the maintainer
 * path uses for its localStorage autosave. */
function usePrivateDocs(bookId: string, enabled: boolean): PrivateDocs {
  const [book, setBook] = useState<BookDocument | null>(null);
  const [domain, setDomain] = useState<DomainDocument | null>(null);
  const [blobs, setBlobs] = useState<Record<string, Blob>>({});
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(
    new Map(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const dirtyRef = useRef(false);
  const bookRef = useRef<BookDocument | null>(null);
  const domainRef = useRef<DomainDocument | null>(null);
  const blobsRef = useRef<Record<string, Blob>>({});
  bookRef.current = book;
  domainRef.current = domain;
  blobsRef.current = blobs;

  // One object URL per current stem, for the Assets panel. The cleanup
  // revokes exactly what this run's setup created, so it stays correct under
  // StrictMode's double-invoke too (plan 0017 §4).
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const urls = new Map<string, string>();
    for (const [stem, blob] of Object.entries(blobs)) {
      urls.set(stem, URL.createObjectURL(blob));
    }
    setPreviewUrls(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [blobs, enabled]);

  useEffect(() => {
    // Same reset as the server slot's load: this hook outlives any single
    // session, so the previous Book's documents must not survive into the
    // next one's session.
    setBook(null);
    setDomain(null);
    setBlobs({});
    setLoadError(null);
    if (!enabled) {
      return;
    }
    let cancelled = false;
    // Cannot reject: `private-store.ts`'s `readPrivateBook` is try/catch ->
    // `undefined`.
    void readPrivateBook(bookId).then((record) => {
      if (cancelled) {
        return;
      }
      if (record === undefined) {
        setLoadError("this private book no longer exists on this device");
        return;
      }
      setBook(record.book);
      setDomain(record.domain);
      setBlobs(record.assets);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, enabled]);

  // Unlike the localStorage write above, `putPrivateBook` opens an IndexedDB
  // transaction and can't be awaited from `beforeunload` (the page is
  // already tearing down), so the tab-close path is best-effort:
  // `visibilitychange` fires earlier and more reliably (especially on
  // mobile) and is registered alongside it.
  useEffect(() => {
    if (!enabled) {
      return;
    }
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
          assets: blobsRef.current,
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
  }, [bookId, enabled]);

  // Reads the refs, not the closed-over state, when the timer fires: an
  // asset write goes through `putPrivateBook` outside this debounce, and if
  // that write's `await` straddles this timer, a closure-captured map would
  // overwrite the just-added asset with the pre-change one.
  useEffect(() => {
    if (!enabled || !dirtyRef.current || book === null || domain === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      putPrivateBook({
        id: bookId,
        book: bookRef.current ?? book,
        domain: domainRef.current ?? domain,
        assets: blobsRef.current,
      }).then(
        () => {
          dirtyRef.current = false;
          setSaveState("saved");
        },
        () => setSaveState("error"),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [book, domain, blobs, bookId, enabled]);

  /** Persists the full record, then re-registers the runtime overlay before
   * updating this hook's own state — an asset added or removed mid-session
   * is otherwise invisible to `registerPrivateAssets` until reload (plan
   * 0017 §4 point 3). Ordered before `setBlobs` so the problem markers
   * re-render against the fresh overlay, not the stale one. */
  async function writeThrough(nextAssets: Record<string, Blob>) {
    if (bookRef.current === null || domainRef.current === null) {
      return;
    }
    await putPrivateBook({
      id: bookId,
      book: bookRef.current,
      domain: domainRef.current,
      assets: nextAssets,
    });
    registerPrivateAssets(await readPrivateBooks());
    setBlobs(nextAssets);
  }

  return {
    book,
    domain,
    loadError,
    saveState,
    changeBook: (next) => {
      dirtyRef.current = true;
      setBook(next);
    },
    changeDomain: (next) => {
      dirtyRef.current = true;
      setDomain(next);
    },
    // Every stem is always included, even before its object URL exists:
    // filtering the whole card out until then would make a Book with assets
    // briefly read "No assets yet." on entry (spec 0012-C §3).
    assets: Object.entries(blobs).map(([stem, blob]) => ({
      stem,
      name: blob instanceof File ? blob.name : stem,
      kind: assetKind(blob),
      size: blob.size,
      url: previewUrls.get(stem) ?? "",
    })),
    addAsset: async (file: File) => {
      // Never the filename (plan 0017 §4 point 2): filenames contain
      // characters `slugPattern` rejects, so the stem is always generated.
      const stem = `${codeOf(bookRef.current?.topic)}-${newPrivateId()}`;
      await writeThrough({ ...blobsRef.current, [stem]: file });
    },
    deleteAsset: async (stem: string) => {
      const next = { ...blobsRef.current };
      delete next[stem];
      await writeThrough(next);
    },
  };
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export interface EditSessionState {
  /** `null` until the Book document is in hand; App then keeps rendering
   * published content, and `useEditSession()` consumers see no session. */
  value: EditSessionValue | null;
  mode: EditMode;
  bookDocId: string;
  loadError: string | null;
  /** Both working documents, for the transitional form tree and the panels. */
  book: BookDocument | null;
  domain: DomainDocument | null;
  publishedBook: BookDocument;
  publishedDomain: DomainDocument;
  bookSlot: ServerSlot;
  domainSlot: ServerSlot;
  localChoice: LocalChoice;
  resumeLocal: (local: AnyDoc) => void;
  startOver: () => void;
  syncState: "synced" | "unsynced" | "syncing" | "error";
  sync: (() => Promise<void>) | null;
  discardDraft: (() => Promise<void>) | null;
  runPublish: (note: string) => Promise<void>;
  publishState: PublishState;
  proposals: Proposal[] | null;
  refreshProposals: () => void;
  onProposalDecided: (accepted: boolean) => Promise<void>;
  deleteAsset: ((stem: string) => Promise<void>) | null;
  deleteBlockedBy: ((stem: string) => string[]) | null;
  onAddEntry: ((entry: Entity) => void) | null;
}

/**
 * The whole document lifecycle for one Book **and its lexicon**, in all
 * three modes (spec 0021-5 §1). Called by `App` rather than by the
 * `EditSession` component below, because §2d needs the drafted `content` at
 * App's own content-resolution point — a provider mounted inside the screen
 * branch is below it and could not reach it.
 *
 * `enabled` is the `editing` route flag: false, and every effect returns
 * early, so a learner pays nothing for this hook being mounted.
 */
export function useEditSessionState(args: {
  bookId: string;
  mode: EditMode;
  enabled: boolean;
  /** App's `editModeFor` — resolves the *lexicon's* own mode, which is not
   * the Book's (§1b): a user can maintain the Book and not its lexicon. */
  resolveMode: (docId: string) => "maintain" | "propose";
}): EditSessionState {
  const { bookId, mode, enabled, resolveMode } = args;
  const bookDocId = documentId("topic", bookId);
  const server = mode !== "private" && enabled;
  const serverMode = mode === "private" ? "maintain" : mode;

  const priv = usePrivateDocs(bookId, mode === "private" && enabled);
  const bookSlot = useServerSlot(bookDocId, serverMode, server);

  const book =
    mode === "private" ? priv.book : (bookSlot.doc as BookDocument | null);
  // The lexicon's id is not known until the Book is in hand, so its slot
  // stays disabled until then — its draft key, dirty flag, autosave and
  // flush all key on an id that starts out "".
  const domainId = book !== null ? rawPrivateDomainId(book) : "";
  const domainDocId = domainId === "" ? "" : documentId("domain", domainId);
  const domainMode = domainDocId === "" ? "maintain" : resolveMode(domainDocId);
  const domainSlot = useServerSlot(
    domainDocId,
    domainMode,
    server && domainDocId !== "",
  );
  const domain =
    mode === "private"
      ? priv.domain
      : (domainSlot.doc as DomainDocument | null);

  const [publishState, setPublishState] = useState<PublishState>({ s: "idle" });
  const [proposals, setProposals] = useState<Proposal[] | null>(null);

  const refreshProposals = useCallback(() => {
    if (!server || mode !== "maintain") {
      return;
    }
    listOpenProposals(bookDocId).then(setProposals, () => setProposals([]));
  }, [bookDocId, mode, server]);
  useEffect(refreshProposals, [refreshProposals]);

  const changeBook = (next: BookDocument) => {
    setPublishState({ s: "idle" });
    if (mode === "private") {
      priv.changeBook(next);
    } else {
      bookSlot.change(next);
    }
  };
  const changeDomain = (next: DomainDocument) => {
    setPublishState({ s: "idle" });
    if (mode === "private") {
      priv.changeDomain(next);
    } else {
      domainSlot.change(next);
    }
  };

  // The live asset inventory, merged over the boot-time overlay. Merging
  // matters (plan 0021 §10): `registerRemoteAssets` populates that overlay
  // from *cached* documents at boot, so a file uploaded for an unpublished
  // draft is not in it and every reference to it would read as dangling.
  const remoteAssets = mode === "private" ? [] : bookSlot.assets;
  const remoteLexiconAssets = mode === "private" ? [] : domainSlot.assets;
  const assetStems: AssetStems = useMemo(() => {
    const base = allAssetStems();
    if (mode === "private") {
      // `privateAssetStems()` is already inside `allAssetStems()` and is
      // re-registered on every write-through, so it is live by construction.
      return base;
    }
    const add = (
      into: Map<string, string[]>,
      id: string,
      kind: "audio" | "img",
      list: RemoteAsset[],
    ) => {
      const stems = list.filter((a) => a.kind === kind).map((a) => a.stem);
      if (id === "" || stems.length === 0) {
        return into;
      }
      const next = new Map(into);
      next.set(id, [...new Set([...(into.get(id) ?? []), ...stems])]);
      return next;
    };
    return mergeAssetStems(base, {
      audioByBook: add(new Map(), bookId, "audio", remoteAssets),
      imageByBook: add(new Map(), bookId, "img", remoteAssets),
      audioByDomain: add(new Map(), domainId, "audio", remoteLexiconAssets),
      imageByDomain: add(new Map(), domainId, "img", remoteLexiconAssets),
    });
  }, [mode, bookId, domainId, remoteAssets, remoteLexiconAssets]);

  const assetViews: AssetView[] =
    mode === "private"
      ? priv.assets
      : remoteAssets.map((asset) => ({
          stem: asset.stem,
          name: asset.name,
          kind: asset.kind === "img" ? "image" : "audio",
          // `list()`'s `metadata.size` isn't guaranteed present (spec
          // 0012-B §3), so an unreported size shows as 0 B rather than
          // losing the card.
          size: asset.size ?? 0,
          url: asset.url,
        }));

  const publishedBook =
    (bookSlot.published as BookDocument | null) ?? EMPTY_BOOK;
  const publishedDomain =
    (domainSlot.published as DomainDocument | null) ?? EMPTY_DOMAIN;

  const readOnly = bookSlot.readOnly;
  // Plan decision 12: a Book pointing at a lexicon this user does not
  // maintain renders its words read-only. A lexicon that failed to load is
  // read-only for the same reason it is unpublishable — writing to the empty
  // stand-in would clobber it. The schema-skew guard is per document (§1a),
  // so a lexicon written by a newer build stays read-only even when the Book
  // this build does understand is not.
  const canEditLexicon =
    mode === "private" ||
    (domainMode !== "propose" && domain !== null && !domainSlot.readOnly);

  const drafted = useMemo(() => {
    if (!enabled || book === null) {
      return null;
    }
    const withDomain = domain ?? EMPTY_DOMAIN;
    const { content } = draftContent(book, withDomain, assetStems);
    const { all, byEntity } = documentProblems(book, withDomain, assetStems);
    return { content, problems: all, problemsByEntity: byEntity };
  }, [enabled, book, domain, assetStems]);

  const uploadFile =
    mode === "private"
      ? priv.addAsset
      : mode === "maintain"
        ? async (file: File) => {
            await uploadAsset(bookDocId, codeOf(book?.topic), file);
            bookSlot.refreshAssets();
          }
        : undefined;

  const value: EditSessionValue | null =
    book === null || drafted === null
      ? null
      : {
          mode,
          book,
          domain: domain ?? EMPTY_DOMAIN,
          changeBook,
          changeDomain,
          content: drafted.content,
          noteMarkdown: (stem: string) =>
            book.notes.find((note) => note.stem === stem)?.markdown,
          problems: drafted.problems,
          problemsByEntity: drafted.problemsByEntity,
          readOnly,
          canEditLexicon,
          assets: assetViews,
          uploadAsset: readOnly ? undefined : uploadFile,
          save: mode === "private" ? priv.saveState : bookSlot.saveState,
          publish: publishState,
        };

  /** One Publish covering both documents (§1d). Book first, then lexicon: if
   * the lexicon fails, the Book is already out and the failure is reported
   * honestly — the reverse order would leave content referencing entries
   * learners cannot see. The words "domain" and "lexicon document" appear
   * nowhere in the result copy. */
  async function runPublish(note: string) {
    if (mode === "private" || book === null) {
      return;
    }
    const bookChanged = differs(bookSlot.doc, bookSlot.published);
    const domainChanged =
      domainDocId !== "" && differs(domainSlot.doc, domainSlot.published);
    if (!bookChanged && !domainChanged) {
      setPublishState({ s: "errors", errors: ["Nothing has changed yet."] });
      return;
    }
    const targets = [
      ...(bookChanged ? [bookSlot] : []),
      ...(domainChanged ? [domainSlot] : []),
    ];
    setPublishState({ s: "checking" });
    const errors: string[] = [];
    for (const slot of targets) {
      if (slot.doc !== null) {
        errors.push(
          ...(await validateForPublish(slot.docId, slot.kind, slot.doc)),
        );
      }
    }
    if (errors.length > 0) {
      setPublishState({ s: "errors", errors });
      return;
    }
    setPublishState({ s: "publishing" });
    // Counted before the submit clears the working copy.
    const wordChanges = domainChanged
      ? (() => {
          const diff = diffDomainDocument(
            publishedDomain,
            (domainSlot.doc as DomainDocument | null) ?? EMPTY_DOMAIN,
          ).entries;
          return diff.added.length + diff.removed.length + diff.changed.length;
        })()
      : 0;
    try {
      for (const slot of targets) {
        const slotMode = slot === domainSlot ? domainMode : mode;
        if (slotMode === "maintain") {
          await slot.publishSlot();
        } else {
          await slot.submitSlot(note);
        }
      }
      setPublishState({ s: "done", message: publishMessage(wordChanges) });
    } catch (e) {
      setPublishState({
        s: "errors",
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  function publishMessage(wordChanges: number): string {
    if (mode === "propose") {
      return "Suggested — the maintainer will review it.";
    }
    if (domainMode === "propose" && wordChanges > 0) {
      return `Published. ${wordChanges} word change${wordChanges === 1 ? "" : "s"} ${wordChanges === 1 ? "was" : "were"} sent for review.`;
    }
    return "Published — learners will be offered it.";
  }

  /** Accepting a proposal writes `documents.draft` server-side (plan 0012 §5
   * point 9); the maintainer's own localStorage draft otherwise always wins
   * on load and would shadow it. */
  async function onProposalDecided(accepted: boolean) {
    if (accepted) {
      await bookSlot.reload();
    }
    refreshProposals();
  }

  return {
    value,
    mode,
    bookDocId,
    loadError: mode === "private" ? priv.loadError : bookSlot.loadError,
    book,
    domain,
    publishedBook,
    publishedDomain,
    bookSlot,
    domainSlot,
    localChoice: bookSlot.localChoice,
    resumeLocal: bookSlot.resumeLocal,
    startOver: bookSlot.startOver,
    syncState: bookSlot.syncState,
    sync: mode === "maintain" && !readOnly ? bookSlot.sync : null,
    discardDraft: readOnly ? null : bookSlot.discardDraft,
    runPublish,
    publishState,
    proposals,
    refreshProposals,
    onProposalDecided,
    deleteAsset:
      mode === "private"
        ? priv.deleteAsset
        : mode === "maintain"
          ? async (stem: string) => {
              const asset = bookSlot.assets.find((a) => a.stem === stem);
              if (asset !== undefined) {
                await deleteAsset(asset.path);
              }
              bookSlot.refreshAssets();
            }
          : null,
    // Present only in maintain mode (spec 0012-C §2/§8): a published object
    // that another learner's Add would 404 on must not be deletable.
    deleteBlockedBy:
      mode === "maintain"
        ? (stem: string) =>
            assetReferences(publishedBook, publishedDomain, stem)
        : null,
    onAddEntry:
      canEditLexicon && domain !== null
        ? (entry: Entity) => changeDomain(upsertDomainEntry(domain, entry))
        : null,
  };
}

// ---------------------------------------------------------------------------
// The provider component
// ---------------------------------------------------------------------------

/**
 * Wraps the learner screens in edit mode (spec 0021-5 §1). Edit mode is a
 * flag on the `book`/`lesson`/`unit` routes, not a destination, so `children`
 * is the very screen the author was reading — navigating between them keeps
 * `editing`, and entering it never moves you.
 *
 * Until slices 6-7 make those screens editable in place, the editing surface
 * is `EditScreen`'s existing form tree, rendered here as a panel over the
 * children (§0: both editors coexist; nothing is deleted before slice 11).
 * `ProposalReview` and `AssetsManager` are rehomed here unchanged.
 */
export function EditSession({
  session,
  onExit,
  children,
}: {
  session: EditSessionState;
  onExit: () => void;
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<EditPanel>(null);
  const [view, setView] = useState<View>({ v: "root" });
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const { value, mode, bookDocId, book, domain, bookSlot, localChoice } =
    session;

  // The edit bar is fixed to the bottom edge, which the Unit trail's
  // Practice bar already owns — a plain overlay hid its button entirely.
  // The class is what lets `styles.css` lift anything else fixed down there
  // by exactly the bar's height, for this session's lifetime only.
  useEffect(() => {
    document.body.classList.add("bb-editing");
    return () => document.body.classList.remove("bb-editing");
  }, []);

  const closePanel = () => {
    setPanel(null);
    setReviewing(null);
    setView({ v: "root" });
  };

  if (session.loadError !== null) {
    return (
      <main>
        <p className="error-text">{session.loadError}</p>
        <button onClick={onExit}>Back</button>
      </main>
    );
  }

  // Propose mode's resume/stale prompt: a local suggestion based on a
  // version that has since moved cannot be resumed (plan 0012 §5).
  if (localChoice.s !== "none") {
    return (
      <main>
        <header className="screen-header">
          <button className="plain" onClick={onExit} title="Back to learning">
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
              alt="Back to learning"
            />
          </button>
          <h1>Your saved suggestion</h1>
        </header>
        {localChoice.s === "offer-resume" ? (
          <div className="card">
            <p>You have a saved suggestion for the current version.</p>
            <button
              className="primary"
              onClick={() => session.resumeLocal(localChoice.local)}
            >
              Resume your suggestion
            </button>
            <button className="plain danger" onClick={session.startOver}>
              Start over
            </button>
          </div>
        ) : (
          <div className="card">
            <p>
              Your saved suggestion was based on version{" "}
              {localChoice.localBaseVersion}; the current version is{" "}
              {bookSlot.publishedVersion}.
            </p>
            <button className="plain danger" onClick={session.startOver}>
              Start over
            </button>
          </div>
        )}
      </main>
    );
  }

  const reviewed =
    reviewing === null
      ? null
      : (session.proposals?.find((p) => p.id === reviewing) ?? null);

  let body: ReactNode = children;
  if (panel === "assets") {
    body = (
      <main className="editor">
        {/* Which pair of documents depends on the mode, and it is not
            cosmetic. Maintain blocks a delete against the *published* pair
            (spec 0012-C §4: a published object another learner's Add would
            404 on). Private has no published copy and warns against the
            *working* pair instead — handed the empty stand-ins it finds no
            references and deletes in silence, which is exactly what plan
            0017 §4 ("the author should hear that before it happens, not
            after") forbids. Verified in a browser both ways. */}
        <AssetsManager
          book={
            mode === "private" ? (book ?? EMPTY_BOOK) : session.publishedBook
          }
          domain={
            mode === "private"
              ? (domain ?? EMPTY_DOMAIN)
              : session.publishedDomain
          }
          bookId={bookDocId}
          assets={value?.assets ?? []}
          onAdd={value?.uploadAsset ?? (() => Promise.resolve())}
          onDelete={session.deleteAsset ?? (() => Promise.resolve())}
          {...(session.deleteBlockedBy !== null
            ? { deleteBlockedBy: session.deleteBlockedBy }
            : {})}
        />
      </main>
    );
  } else if (panel === "feedback") {
    body = (
      <main className="editor">
        <FeedbackPanel docId={bookDocId} />
      </main>
    );
  } else if (panel === "proposals") {
    body = (
      <main className="editor">
        {reviewed !== null ? (
          <ProposalReview
            docId={bookDocId}
            kind="topic"
            publishedVersion={bookSlot.publishedVersion}
            hasDraft={bookSlot.hasDraft}
            proposal={reviewed}
            onBack={() => setReviewing(null)}
            onAccepted={() => {
              void session.onProposalDecided(true);
              closePanel();
            }}
            onRejected={() => {
              void session.onProposalDecided(false);
              closePanel();
            }}
          />
        ) : (
          <ul className="card-list">
            {(session.proposals ?? []).map((proposal) => (
              <li key={proposal.id} className="card">
                <p>{proposal.note ?? "(no note)"}</p>
                <button
                  className="plain"
                  onClick={() => setReviewing(proposal.id)}
                >
                  Review
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  } else if (panel === "forms" && book !== null) {
    // ponytail: the transitional editing surface. Slices 6-8 move these
    // fields onto the learner screens themselves and slice 11 deletes the
    // forms; until then this is what keeps a Book (private ones especially,
    // which have no other route in) editable at all.
    body = (
      <main
        className={value?.readOnly === true ? "editor read-only" : "editor"}
      >
        <BookEditor
          doc={book}
          view={view}
          setView={setView}
          onChange={(next) => value?.changeBook(next)}
          hideCoverArt={mode === "private"}
          domainEntries={domain?.entries ?? []}
          domain={parseDomain(domain)}
          domainCode={parseDomain(domain)?.code ?? ""}
          sourceRef={firstResourceId(book)}
          {...(session.onAddEntry !== null
            ? { onAddEntry: session.onAddEntry }
            : {})}
          // Images only: a figure's stem validates against `imageStemSet`,
          // so offering an audio stem in the `+ image` picker would author a
          // guaranteed `dangling imageRef` (spec 0021-2 §2d).
          assets={(value?.assets ?? []).filter((a) => a.kind === "image")}
          {...(value?.uploadAsset !== undefined
            ? { onUploadAsset: value.uploadAsset }
            : {})}
        />
      </main>
    );
  } else if (panel === "lexicon" && domain !== null) {
    body = (
      <main
        className={
          value?.canEditLexicon === true ? "editor" : "editor read-only"
        }
      >
        {value?.canEditLexicon !== true && (
          <p className="status">
            these words come from somewhere else — you can use them, but not
            change them
          </p>
        )}
        <DomainEditor
          doc={domain}
          view={view}
          setView={setView}
          onChange={(next) => {
            if (value?.canEditLexicon === true) {
              value.changeDomain(next);
            }
          }}
        />
      </main>
    );
  }

  return (
    <EditSessionProvider value={value}>
      {body}
      <EditMenu
        mode={mode}
        panel={panel}
        onPanel={(next) => {
          setReviewing(null);
          setView({ v: "root" });
          setPanel(next);
        }}
        onUp={
          panel !== null && view.v !== "root"
            ? () => setView(upView(view))
            : null
        }
        onExit={onExit}
        save={value?.save ?? "saved"}
        readOnly={value?.readOnly ?? false}
        loading={value === null}
        publishState={session.publishState}
        onPublish={() => void session.runPublish(note)}
        note={note}
        onNote={setNote}
        syncState={session.syncState}
        onSync={session.sync}
        onDiscardDraft={session.discardDraft}
        proposalCount={session.proposals?.length ?? 0}
        problemCount={value?.problems.length ?? 0}
        hasLexicon={domain !== null}
      />
    </EditSessionProvider>
  );
}

/** `DomainDocument.domain` is `unknown` at rest, so a fresh or half-edited
 * one that fails `domainSchema` just leaves the note editor's lexicon sheet
 * off this render — the same best-effort degrade the three shells use. */
function parseDomain(domain: DomainDocument | null) {
  if (domain === null) {
    return undefined;
  }
  const parsed = domainSchema.safeParse(domain.domain);
  return parsed.success ? parsed.data : undefined;
}
