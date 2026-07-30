import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  currentUser,
  getSupabase,
  listCatalogSummaries,
  listMyDocuments,
  listMyProposals,
  signInWithEmail,
  signOut,
  withdrawProposal,
  type AuthorDocSummary,
  type CatalogSummary,
  type Proposal,
} from "../backend/supabase";

/**
 * Author entry point (plan 0012 step 2, extended by §5): creating a private
 * Book, magic-link sign-in, the list of documents the account maintains,
 * every other published document as a "suggest edits" entry point, and the
 * account's own proposals. Reachable from the home footer whether or not the
 * backend is configured — creating a private Book (plan 0017 §3) needs no
 * account, so only the signed-in half hides when there is no backend.
 */
export function AuthorScreen({
  onCreateBook,
  onOpenDocument,
  onPrivacy,
  onBack,
}: {
  /** Starts the private-Book naming flow, which lives on the home screen. */
  onCreateBook: () => void;
  onOpenDocument: (docId: string, mode?: "maintain" | "propose") => void;
  onPrivacy: () => void;
  onBack: () => void;
}) {
  // Null when unconfigured OR when offline mode is on, so this also retracts
  // the sign-in form the moment the learner goes offline.
  const backendReady = getSupabase() !== null;
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [docs, setDocs] = useState<AuthorDocSummary[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogSummary[] | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentUser().then(setUser);
  }, []);
  useEffect(() => {
    if (user === "loading" || user === null) {
      return;
    }
    const onError = (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e));
    listMyDocuments().then(setDocs, onError);
    listCatalogSummaries().then(setCatalog, onError);
    listMyProposals().then(setProposals, onError);
  }, [user]);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleWithdraw(proposal: Proposal) {
    await withdrawProposal(proposal.id);
    setProposals(await listMyProposals());
  }

  const maintainedIds = new Set((docs ?? []).map((doc) => doc.id));
  const suggestable = (catalog ?? []).filter(
    (row) => !maintainedIds.has(row.id),
  );

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt=""
          />{" "}
          Home
        </button>
        <h1>Authoring</h1>
      </header>

      {error !== null && <p className="error-text">{error}</p>}

      <ul className="card-list">
        <li className="card primary">
          <button onClick={onCreateBook}>
            <strong>
              <img
                className="card-art"
                src={`${import.meta.env.BASE_URL}art/icons/beaver_desk.png`}
                alt=""
              />{" "}
              Create a Book
            </strong>
            <p className="status">
              Write your own — stays on this device, no account needed
            </p>
          </button>
        </li>
      </ul>

      {!backendReady && (
        <p className="card">
          Signing in to maintain or suggest edits on published content needs a
          connection — turn offline mode off to reach it.
        </p>
      )}

      {backendReady && user === "loading" && <p>Loading…</p>}

      {backendReady && user === null && !sent && (
        <form onSubmit={(e) => void handleSignIn(e)} className="card">
          <p>
            Sign in to edit content. Learners don't need an account — this is
            for authors only. See the{" "}
            <button
              type="button"
              className="plain link-button"
              onClick={onPrivacy}
            >
              privacy note
            </button>
            .
          </p>
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <button className="primary" type="submit">
            Send sign-in link
          </button>
        </form>
      )}

      {user === null && sent && (
        <p className="card">
          Check your email — the sign-in link brings you back here.
        </p>
      )}

      {user !== "loading" && user !== null && (
        <>
          <p className="status">
            Signed in as {user.email}{" "}
            <button
              className="plain"
              onClick={() => {
                void signOut().then(() => {
                  setUser(null);
                  setDocs(null);
                  setCatalog(null);
                  setProposals(null);
                  setSent(false);
                });
              }}
            >
              Sign out
            </button>
          </p>
          {docs === null && <p>Loading your documents…</p>}
          {docs !== null && docs.length === 0 && (
            <p className="card">
              No documents yet. Maintainership is assigned by the admin for now
              — ask to be added, or wait for in-app book creation (coming
              later).
            </p>
          )}
          {docs !== null && docs.length > 0 && (
            <ul className="card-list">
              {docs.map((doc) => (
                <li key={doc.id} className="card">
                  <button onClick={() => onOpenDocument(doc.id)}>
                    <strong>{doc.id}</strong>
                    <span className="status">
                      {doc.kind === "topic" ? "Book" : "Domain lexicon"} ·
                      version {doc.published_version}
                      {doc.listed ? "" : " · not listed yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2>All published content — suggest edits</h2>
          {catalog === null && <p>Loading…</p>}
          {catalog !== null && suggestable.length === 0 && (
            <p className="card">Nothing else to suggest edits on yet.</p>
          )}
          {catalog !== null && suggestable.length > 0 && (
            <ul className="card-list">
              {suggestable.map((row) => (
                <li key={row.id} className="card">
                  <button onClick={() => onOpenDocument(row.id, "propose")}>
                    <strong>{row.id}</strong>
                    <span className="status">
                      {row.kind === "topic" ? "Book" : "Domain lexicon"} ·
                      version {row.published_version}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2>My proposals</h2>
          {proposals === null && <p>Loading…</p>}
          {proposals !== null && proposals.length === 0 && (
            <p className="card">You haven't proposed any edits yet.</p>
          )}
          {proposals !== null && proposals.length > 0 && (
            <ul className="card-list">
              {proposals.map((proposal) => (
                <li key={proposal.id} className="card">
                  <strong>{proposal.doc_id}</strong>
                  <span className="status">
                    {proposal.status}
                    {proposal.note !== null &&
                      proposal.note !== "" &&
                      ` · ${proposal.note}`}
                  </span>
                  {proposal.decision_note !== null && (
                    <p className="status">
                      Maintainer: {proposal.decision_note}
                    </p>
                  )}
                  {proposal.status === "open" && (
                    <button
                      className="plain danger"
                      onClick={() => void handleWithdraw(proposal)}
                    >
                      Withdraw
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
