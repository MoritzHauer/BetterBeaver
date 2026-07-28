import { useEffect, useRef, useState } from "react";
import {
  type BookDocument,
  CONTENT_SCHEMA_VERSION,
  type DomainDocument,
  documentId,
} from "@betterbeaver/schema";
import { validateForPublish } from "../../backend/publishCheck";
import {
  type CatalogEntry,
  loadCatalogEntry,
  submitProposal,
} from "../../backend/supabase";
import { BookEditor } from "./BookEditor";
import { DomainEditor } from "./DomainEditor";
import {
  type AnyDoc,
  type EditTarget,
  type StoredProposal,
  type View,
  initialView,
  proposalKey,
  rawPrivateDomainId,
  upView,
} from "./types";

export function ProposeEditScreen({
  docId,
  target,
  onBack,
}: {
  docId: string;
  target?: EditTarget;
  onBack: () => void;
}) {
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [working, setWorking] = useState<AnyDoc | null>(null);
  const [view, setView] = useState<View>(() => initialView(target));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localChoice, setLocalChoice] = useState<
    | { s: "none" }
    | { s: "offer-resume"; local: AnyDoc }
    | { s: "offer-stale"; localBaseVersion: number }
  >({ s: "none" });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  // Named to avoid shadowing the engine's `setNote` (note-editing op), which
  // `BookEditor` still calls unshadowed.
  const [proposalNote, setProposalNote] = useState("");
  const [proposeState, setProposeState] = useState<
    | { s: "idle" }
    | { s: "checking" }
    | { s: "confirm-errors"; errors: string[] }
    | { s: "submitting" }
    | { s: "done" }
    | { s: "error"; message: string }
  >({ s: "idle" });
  // The book's domain lexicon entries (spec 0018 §3), same as
  // MaintainEditScreen — best-effort, from the published catalog
  // since a non-maintainer has no draft to read.
  const [domainEntries, setDomainEntries] = useState<unknown[]>([]);
  const dirtyRef = useRef(false);
  const workingRef = useRef<AnyDoc | null>(null);
  workingRef.current = working;

  // Same debounce + unmount-flush pattern as the maintainer path's
  // localStorage autosave, just against a different key and value shape
  // (baseVersion travels with the doc so a stale local copy can be told
  // apart from a resumable one on the next load).
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && workingRef.current !== null && entry !== null) {
        localStorage.setItem(
          proposalKey(docId),
          JSON.stringify({
            baseVersion: entry.published_version,
            doc: workingRef.current,
          } satisfies StoredProposal),
        );
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [docId, entry]);

  useEffect(() => {
    loadCatalogEntry(docId).then(
      (loaded) => {
        if (loaded === null) {
          setLoadError("this document isn't published/listed");
          return;
        }
        setEntry(loaded);
        const raw = localStorage.getItem(proposalKey(docId));
        if (raw !== null) {
          try {
            const stored = JSON.parse(raw) as StoredProposal;
            if (stored.baseVersion === loaded.published_version) {
              setLocalChoice({ s: "offer-resume", local: stored.doc });
            } else {
              setLocalChoice({
                s: "offer-stale",
                localBaseVersion: stored.baseVersion,
              });
            }
            return;
          } catch {
            localStorage.removeItem(proposalKey(docId));
          }
        }
        setWorking(loaded.published);
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, [docId]);

  // Same reasoning as MaintainEditScreen's identical effect: `domainId` is
  // stable once `entry` loads, so this only fires once, not on every edit.
  const domainId =
    entry?.kind === "topic" && working !== null
      ? rawPrivateDomainId(working as BookDocument)
      : "";
  useEffect(() => {
    if (domainId === "") {
      setDomainEntries([]);
      return;
    }
    let cancelled = false;
    loadCatalogEntry(documentId("domain", domainId)).then(
      (loaded) => {
        if (!cancelled) {
          setDomainEntries(
            loaded !== null
              ? ((loaded.published as DomainDocument).entries ?? [])
              : [],
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

  // Draft autosave to localStorage, debounced (same 400ms pattern as the
  // maintainer path).
  useEffect(() => {
    if (!dirtyRef.current || working === null || entry === null) {
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          proposalKey(docId),
          JSON.stringify({
            baseVersion: entry.published_version,
            doc: working,
          } satisfies StoredProposal),
        );
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [working, docId, entry]);

  function resumeLocal(local: AnyDoc) {
    setWorking(local);
    setLocalChoice({ s: "none" });
  }

  function startOver() {
    localStorage.removeItem(proposalKey(docId));
    if (entry !== null) {
      setWorking(entry.published);
    }
    setLocalChoice({ s: "none" });
  }

  if (loadError !== null) {
    return (
      <main>
        <p className="error-text">{loadError}</p>
        <button onClick={onBack}>Back</button>
      </main>
    );
  }
  if (entry === null) {
    return <main>Loading…</main>;
  }
  const readOnly = entry.schema_version > CONTENT_SCHEMA_VERSION;

  if (localChoice.s !== "none") {
    return (
      <main>
        <header className="screen-header">
          <button className="plain" onClick={onBack}>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
              alt=""
            />
          </button>
          <h1>{docId}</h1>
        </header>
        {localChoice.s === "offer-resume" ? (
          <div className="card">
            <p>You have a saved suggestion for the current version.</p>
            <button
              className="primary"
              onClick={() => resumeLocal(localChoice.local)}
            >
              Resume your suggestion
            </button>
            <button className="plain danger" onClick={startOver}>
              Start over
            </button>
          </div>
        ) : (
          <div className="card">
            <p>
              Your saved suggestion was based on version{" "}
              {localChoice.localBaseVersion}; the current version is{" "}
              {entry.published_version}.
            </p>
            <button className="plain danger" onClick={startOver}>
              Start over
            </button>
          </div>
        )}
      </main>
    );
  }
  if (working === null) {
    return <main>Loading…</main>;
  }

  const change = (next: AnyDoc) => {
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    setProposeState({ s: "idle" });
    setWorking(next);
  };

  async function handleSubmit() {
    if (working === null || entry === null) {
      return;
    }
    if (proposeState.s !== "confirm-errors") {
      setProposeState({ s: "checking" });
      const errors = await validateForPublish(docId, entry.kind, working);
      if (errors.length > 0) {
        setProposeState({ s: "confirm-errors", errors });
        return;
      }
    }
    setProposeState({ s: "submitting" });
    try {
      await submitProposal(
        docId,
        entry.published_version,
        working,
        proposalNote,
      );
      localStorage.removeItem(proposalKey(docId));
      dirtyRef.current = false;
      setProposeState({ s: "done" });
    } catch (e) {
      setProposeState({
        s: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const body =
    entry.kind === "topic" ? (
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
        Suggesting edits to version {entry.published_version}
        {readOnly
          ? " · read-only: this document needs a newer app"
          : saveState === "saving"
            ? " · saving…"
            : saveState === "error"
              ? " · local save failed — storage may be full"
              : " · saved on this device"}
      </p>
      {body}
      <div className="editor-publish card">
        {proposeState.s === "confirm-errors" && (
          <ul className="error-text">
            {proposeState.errors.slice(0, 20).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {proposeState.errors.length > 20 && (
              <li>…and {proposeState.errors.length - 20} more</li>
            )}
          </ul>
        )}
        {proposeState.s === "error" && (
          <p className="error-text">{proposeState.message}</p>
        )}
        {proposeState.s === "done" && (
          <p className="status">
            Proposal submitted — the maintainer will review it.
          </p>
        )}
        <label className="field">
          Note (optional)
          <textarea
            rows={3}
            value={proposalNote}
            onChange={(e) => setProposalNote(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={
            readOnly ||
            proposeState.s === "checking" ||
            proposeState.s === "submitting"
          }
          onClick={() => void handleSubmit()}
        >
          {proposeState.s === "checking"
            ? "Validating…"
            : proposeState.s === "submitting"
              ? "Submitting…"
              : proposeState.s === "confirm-errors"
                ? `Submit with ${proposeState.errors.length} validation issue${proposeState.errors.length === 1 ? "" : "s"}`
                : "Submit proposal"}
        </button>
      </div>
    </main>
  );
}
