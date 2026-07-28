import { useEffect, useState } from "react";
import { type BookDocument, type DomainDocument } from "@betterbeaver/schema";
import {
  type CollectionDiff,
  diffBookDocument,
  diffDomainDocument,
} from "@betterbeaver/engine";
import {
  type Proposal,
  decideProposal,
  loadVersion,
  saveDraft,
} from "../../backend/supabase";
import { type AnyDoc } from "./types";

/** A never-published document, for diffing a proposal whose `base_version`
 * is 0 or whose `versions` row is otherwise missing (plan 0012 §5 point 7). */
export function emptyDocFor(kind: "topic" | "domain"): AnyDoc {
  return kind === "topic"
    ? {
        topic: {},
        lessons: [],
        units: [],
        items: [],
        tasks: [],
        resources: [],
        notes: [],
      }
    : { domain: {}, entries: [], families: [] };
}

export function collectionDiffIsEmpty(diff: CollectionDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  );
}

export function CollectionDiffView({ diff }: { diff: CollectionDiff }) {
  return (
    <>
      {diff.added.length > 0 && <p>Added: {diff.added.join(", ")}</p>}
      {diff.removed.length > 0 && <p>Removed: {diff.removed.join(", ")}</p>}
      {diff.changed.map((entity) => (
        <div key={entity.id}>
          <strong>{entity.id}</strong>
          <ul>
            {entity.fields.map((field) => (
              <li key={field.path}>
                {field.path}: "{field.before}" → "{field.after}"
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The maintainer's review of one open proposal (plan 0012 §5 points 7–9):
 * diffs the proposal's full document against the `versions` row for its
 * `base_version`, flags staleness, and decides accept-into-draft or reject. */
export function ProposalReview({
  docId,
  kind,
  publishedVersion,
  hasDraft,
  proposal,
  onBack,
  onAccepted,
  onRejected,
}: {
  docId: string;
  kind: "topic" | "domain";
  publishedVersion: number;
  hasDraft: boolean;
  proposal: Proposal;
  onBack: () => void;
  onAccepted: () => void;
  onRejected: () => void;
}) {
  const [base, setBase] = useState<AnyDoc | "loading">("loading");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBase("loading");
    if (proposal.base_version === 0) {
      setBase(emptyDocFor(kind));
      return;
    }
    loadVersion(docId, proposal.base_version).then(
      (doc) => setBase(doc ?? emptyDocFor(kind)),
      () => setBase(emptyDocFor(kind)),
    );
  }, [docId, proposal.base_version, kind]);

  async function handleAccept() {
    if (
      hasDraft &&
      !window.confirm("This replaces your current draft. Continue?")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Order pinned (plan 0012 §5 point 9): draft first, then status — if
      // the status update fails the proposal just stays open, harmless.
      await saveDraft(docId, proposal.proposed_doc);
      await decideProposal(
        proposal.id,
        "accepted",
        decisionNote.trim() === "" ? null : decisionNote.trim(),
      );
      onAccepted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (decisionNote.trim() === "") {
      setError("A reason is required to reject a proposal.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideProposal(proposal.id, "rejected", decisionNote.trim());
      onRejected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (base === "loading") {
    return <p>Loading base version…</p>;
  }
  const diff =
    kind === "topic"
      ? diffBookDocument(
          base as BookDocument,
          proposal.proposed_doc as BookDocument,
        )
      : diffDomainDocument(
          base as DomainDocument,
          proposal.proposed_doc as DomainDocument,
        );

  return (
    <section>
      <h2>Proposal review</h2>
      {proposal.note !== null && proposal.note !== "" && (
        <p>Note: {proposal.note}</p>
      )}
      {proposal.base_version < publishedVersion && (
        <p className="error-text">
          based on version {proposal.base_version}; current is{" "}
          {publishedVersion} — review against current content before accepting.
        </p>
      )}
      {Object.entries(diff).map(([name, collectionDiff]) =>
        collectionDiffIsEmpty(collectionDiff) ? null : (
          <div key={name} className="card">
            <h3>{name}</h3>
            <CollectionDiffView diff={collectionDiff} />
          </div>
        ),
      )}
      {error !== null && <p className="error-text">{error}</p>}
      <label className="field">
        Decision note (required to reject)
        <textarea
          rows={3}
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void handleAccept()}
      >
        Accept into draft
      </button>
      <button
        className="plain danger"
        disabled={busy}
        onClick={() => void handleReject()}
      >
        Reject
      </button>
      <button className="plain" onClick={onBack}>
        Back
      </button>
    </section>
  );
}
