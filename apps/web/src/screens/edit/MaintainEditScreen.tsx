import { useEffect, useRef, useState } from "react";
import {
  type BookDocument,
  CONTENT_SCHEMA_VERSION,
  type DomainDocument,
  documentId,
} from "@betterbeaver/schema";
import { validateForPublish } from "../../backend/publishCheck";
import {
  type AuthorDoc,
  type Proposal,
  listOpenProposals,
  loadDocument,
  publishDocument,
  saveDraft,
} from "../../backend/supabase";
import { FeedbackPanel } from "../../components/FeedbackPanel";
import { BookEditor } from "./BookEditor";
import { DomainEditor } from "./DomainEditor";
import { ProposalReview } from "./ProposalReview";
import {
  type AnyDoc,
  type EditTarget,
  type View,
  draftKey,
  initialView,
  rawPrivateDomainId,
  upView,
} from "./types";

export function MaintainEditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const [record, setRecord] = useState<AuthorDoc | null>(null);
  const [working, setWorking] = useState<AnyDoc | null>(null);
  const [view, setView] = useState<View>(() => initialView(target));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [publishState, setPublishState] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "publishing" }
    | { s: "errors"; errors: string[] }
    | { s: "done" }
  >({ s: "idle" });
  const [syncState, setSyncState] = useState<
    "synced" | "unsynced" | "syncing" | "error"
  >("synced");
  // Open proposals against this document (plan 0012 §5 point 6).
  const [openProposals, setOpenProposals] = useState<Proposal[] | null>(null);
  // The book's domain lexicon entries (spec 0018 §3): BookEditor's itemIds
  // pickers merge book items with these. Best-effort — a fetch failure just
  // leaves the Vocabulary side of the picker empty, it never blocks editing.
  const [domainEntries, setDomainEntries] = useState<unknown[]>([]);
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  workingRef.current = working;

  const refreshProposals = () => {
    listOpenProposals(docId).then(setOpenProposals, () => setOpenProposals([]));
  };
  useEffect(refreshProposals, [docId]);

  // `domainId` is metadata the book form never edits (BookEditor's own
  // EntityForm specs don't include it), so it's stable after the initial
  // load — recomputed each render (cheap) but only fires the fetch below
  // when its *value* changes, not on every keystroke elsewhere in `working`.
  const domainId =
    record?.kind === "topic" && working !== null
      ? rawPrivateDomainId(working as BookDocument)
      : "";
  useEffect(() => {
    if (domainId === "") {
      setDomainEntries([]);
      return;
    }
    let cancelled = false;
    loadDocument(documentId("domain", domainId)).then(
      (d) => {
        if (!cancelled) {
          setDomainEntries(
            ((d.draft ?? d.published) as DomainDocument | null)?.entries ?? [],
          );
        }
      },
      () => {
        if (!cancelled) {
          setDomainEntries([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [domainId]);

  // Local-first (plan 0012 §7 amended): every edit lands in localStorage;
  // the backend sees it only through the explicit Sync/Publish actions on
  // the root (book) view. A pending debounced write must survive leaving
  // the editor or closing the tab, so flush it on both.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && workingRef.current !== null) {
        localStorage.setItem(
          draftKey(docId),
          JSON.stringify(workingRef.current),
        );
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [docId]);

  useEffect(() => {
    loadDocument(docId).then(
      (doc) => {
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
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [docId]);

  // Draft autosave to localStorage, debounced.
  useEffect(() => {
    if (!dirtyRef.current || working === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(docId), JSON.stringify(working));
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [working, docId]);

  async function handleSync() {
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

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (record === null) {
    return <main>Loading…</main>;
  }
  const readOnly = record.schema_version > CONTENT_SCHEMA_VERSION;
  if (working === null) {
    return (
      <main>
        <p className="error-text">
          This document has no draft or published content to edit.
        </p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }

  const change = (next: AnyDoc) => {
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    setPublishState({ s: "idle" });
    setSyncState("unsynced");
    setWorking(next);
  };

  async function handlePublish() {
    if (working === null || record === null) {
      return;
    }
    setPublishState({ s: "checking" });
    const errors = await validateForPublish(docId, record.kind, working);
    if (errors.length > 0) {
      setPublishState({ s: "errors", errors });
      return;
    }
    setPublishState({ s: "publishing" });
    try {
      await publishDocument(
        docId,
        record.published_version,
        working,
        CONTENT_SCHEMA_VERSION,
      );
      const reloaded = await loadDocument(docId);
      setRecord(reloaded);
      setWorking(reloaded.draft ?? reloaded.published);
      dirtyRef.current = false;
      // Publishing pushed the local work to the server — the local copy is
      // no longer ahead of it.
      localStorage.removeItem(draftKey(docId));
      setSyncState("synced");
      setPublishState({ s: "done" });
    } catch (e) {
      setPublishState({
        s: "errors",
        errors: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  async function handleDiscardDraft() {
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

  // Accepting a proposal writes `documents.draft` on the server (plan 0012
  // §5 point 9, via ./ProposalReview). The maintainer's own
  // `bb.author.draft.<docId>` localStorage entry otherwise always wins over
  // the server draft on load (see the load effect above) and would shadow
  // the just-accepted proposal — clear it and pull the fresh server state in,
  // exactly like the post-publish tail below.
  async function handleProposalAccepted() {
    const reloaded = await loadDocument(docId);
    setRecord(reloaded);
    setWorking(reloaded.draft ?? reloaded.published);
    dirtyRef.current = false;
    localStorage.removeItem(draftKey(docId));
    setSyncState("synced");
    refreshProposals();
    setView({ v: "root" });
  }

  function handleProposalRejected() {
    refreshProposals();
    setView({ v: "root" });
  }

  const reviewingProposal =
    view.v === "proposal"
      ? (openProposals?.find((p) => p.id === view.id) ?? null)
      : undefined;

  const body =
    record.kind === "topic" ? (
      <BookEditor
        doc={working as BookDocument}
        view={view}
        setView={setView}
        onChange={change}
        domainEntries={domainEntries}
      />
    ) : (
      <DomainEditor
        doc={working as DomainDocument}
        view={view}
        setView={setView}
        onChange={change}
      />
    );

  return (
    <main className={readOnly ? "editor read-only" : "editor"}>
      <header className="screen-header">
        <button className="plain" onClick={onBack} title="Back to learning">
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back to learning"
          />
        </button>
        {view.v !== "root" && (
          <button
            className="plain"
            onClick={() => setView(upView(view))}
            title="Up one level"
          >
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
        Version {record.published_version}
        {record.listed ? "" : " · not listed"} ·{" "}
        {readOnly
          ? "read-only: this document needs a newer app"
          : saveState === "saving"
            ? "saving…"
            : saveState === "error"
              ? "local save failed — storage may be full"
              : "saved on this device"}
      </p>
      {view.v === "root" && !readOnly && (
        <p className="status">
          {syncState === "synced"
            ? "in sync with the server"
            : syncState === "syncing"
              ? "syncing…"
              : syncState === "error"
                ? "sync failed — check your connection"
                : "local changes not on the server yet"}{" "}
          {syncState !== "synced" && (
            <button
              className="plain"
              disabled={syncState === "syncing"}
              onClick={() => void handleSync()}
            >
              Sync to server
            </button>
          )}
        </p>
      )}
      {view.v === "root" && <FeedbackPanel docId={docId} />}
      {view.v === "root" &&
        openProposals !== null &&
        openProposals.length > 0 && (
          <section className="card">
            <h2>
              {openProposals.length} open proposal
              {openProposals.length === 1 ? "" : "s"}
            </h2>
            <ul className="card-list">
              {openProposals.map((proposal) => (
                <li key={proposal.id} className="card">
                  <p>{proposal.note ?? "(no note)"}</p>
                  <button
                    className="plain"
                    onClick={() => setView({ v: "proposal", id: proposal.id })}
                  >
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      {reviewingProposal !== undefined ? (
        reviewingProposal === null ? (
          <p className="error-text">
            unknown proposal: {view.v === "proposal" ? view.id : ""}
          </p>
        ) : (
          <ProposalReview
            docId={docId}
            kind={record.kind}
            publishedVersion={record.published_version}
            hasDraft={record.draft !== null}
            proposal={reviewingProposal}
            onBack={() => setView({ v: "root" })}
            onAccepted={() => void handleProposalAccepted()}
            onRejected={handleProposalRejected}
          />
        )
      ) : (
        <>
          {body}
          <div className="editor-publish card">
            {publishState.s === "errors" && (
              <ul className="error-text">
                {publishState.errors.slice(0, 20).map((error) => (
                  <li key={error}>{error}</li>
                ))}
                {publishState.errors.length > 20 && (
                  <li>…and {publishState.errors.length - 20} more</li>
                )}
              </ul>
            )}
            {publishState.s === "done" && (
              <p className="status">Published — learners will be offered it.</p>
            )}
            <button
              className="primary"
              disabled={
                readOnly ||
                publishState.s === "checking" ||
                publishState.s === "publishing"
              }
              onClick={() => void handlePublish()}
            >
              {publishState.s === "checking"
                ? "Validating…"
                : publishState.s === "publishing"
                  ? "Publishing…"
                  : "Validate & publish"}
            </button>
            {record.published !== null && !readOnly && (
              <button
                className="plain danger"
                onClick={() => void handleDiscardDraft()}
              >
                Discard draft
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
