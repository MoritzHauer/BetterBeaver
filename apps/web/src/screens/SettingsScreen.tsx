import { useEffect, useRef, useState } from "react";
import {
  currentUser,
  getSupabase,
  listMyDocuments,
  loadDocument,
  signOut,
} from "../backend/supabase";
import type { User } from "@supabase/supabase-js";
import type { BookDocument, DomainDocument } from "@betterbeaver/schema";
import { readPrivateBook } from "../content/private-store";
import { parsePrivateBookImport } from "../content/private-transfer";
import { eraseAllData, exportBackup, importBackup } from "../progress/backup";
import { SOUND_KEY } from "../sounds";
import { AUTO_UPDATE_KEY } from "../autoUpdate";
import { OFFLINE_KEY, isOffline } from "../offline";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { getDisplayName, setDisplayName } from "../identity";
import { APP_COMMIT, APP_VERSION, REPO_URL } from "../version";
import {
  getLearning,
  setLearning,
  type LearningSettings,
  type SkipLength,
} from "../learning";
import { REVIEW_PACES, type ReviewPace } from "@betterbeaver/srs";

const THEME_OPTIONS: { pref: ThemePref; label: string }[] = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

/** Named presets, never typed intervals (plan 0022 §8): a learner looking at
 * `5, 15, 30, 90` has no basis on which to change one number — what they know
 * is "too much" or "too little", which is what these three express. */
const PACE_OPTIONS: { pace: ReviewPace; label: string }[] = [
  { pace: "thorough", label: "Thorough" },
  { pace: "balanced", label: "Balanced" },
  { pace: "light", label: "Light" },
];

const SKIP_OPTIONS: { skip: SkipLength; label: string }[] = [
  { skip: "week", label: "1 week" },
  { skip: "month", label: "1 month" },
  { skip: "year", label: "1 year" },
];

export function SettingsScreen({
  onBack,
  onAbout,
  onSignIn,
  onImportBook,
  importPrivateBook,
  refreshContent,
}: {
  onBack: () => void;
  onAbout: () => void;
  onSignIn: () => void;
  /** Re-downloads every member Book's documents and assets, then reloads
   * (`content/source.ts`). Rejects with a human-readable message; the cached
   * documents are untouched unless a validated download replaces them. */
  refreshContent: () => Promise<void>;
  /** Hands the parsed documents to the app, which stores each one under the
   * key its own editor reads — a maintained document becomes a draft, an
   * unmaintained one becomes a proposal — and opens the first. The mode
   * lives there because only `App` knows what this account maintains. */
  onImportBook: (entries: { id: string; doc: unknown }[]) => Promise<void>;
  /** Validates + commits an imported private Book (spec 0017-5 §3 rules
   * 3+5) — the cross-Book validation and replace-existing dry run need live
   * membership state, which lives in `content/source.ts`. */
  importPrivateBook: (
    bookId: string,
    book: BookDocument,
    domain: DomainDocument,
    assets: Record<string, Blob>,
  ) => Promise<void>;
}) {
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const [displayName, setDisplayNameState] = useState(getDisplayName);
  const [soundOn, setSoundOn] = useState(
    () => localStorage.getItem(SOUND_KEY) !== "off",
  );
  const [autoUpdateOn, setAutoUpdateOn] = useState(
    () => localStorage.getItem(AUTO_UPDATE_KEY) === "on",
  );
  const [offlineOn, setOfflineOn] = useState(isOffline);
  const [learning, setLearningState] = useState<LearningSettings>(getLearning);
  const [user, setUser] = useState<User | null | "loading">(
    getSupabase() === null ? null : "loading",
  );
  const [bookImportError, setBookImportError] = useState<string | null>(null);
  const [domainImportError, setDomainImportError] = useState<string | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [privateImportError, setPrivateImportError] = useState<string | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshDone, setRefreshDone] = useState(false);
  const progressFileRef = useRef<HTMLInputElement>(null);
  const bookFileRef = useRef<HTMLInputElement>(null);
  const domainFileRef = useRef<HTMLInputElement>(null);
  const privateBookFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (getSupabase() === null) {
      return;
    }
    void currentUser().then(setUser);
  }, []);

  function selectTheme(pref: ThemePref): void {
    setThemePref(pref);
    setThemePrefState(pref);
  }

  function toggleSound(on: boolean): void {
    if (on) {
      localStorage.removeItem(SOUND_KEY);
    } else {
      localStorage.setItem(SOUND_KEY, "off");
    }
    setSoundOn(on);
  }

  function toggleAutoUpdate(on: boolean): void {
    if (on) {
      localStorage.setItem(AUTO_UPDATE_KEY, "on");
    } else {
      localStorage.removeItem(AUTO_UPDATE_KEY);
    }
    setAutoUpdateOn(on);
  }

  function toggleOffline(on: boolean): void {
    if (on) {
      localStorage.setItem(OFFLINE_KEY, "on");
    } else {
      localStorage.removeItem(OFFLINE_KEY);
    }
    setOfflineOn(on);
  }

  function updateLearning(patch: Partial<LearningSettings>): void {
    setLearning(patch);
    // Re-read rather than merging locally, so the screen shows what actually
    // stuck if the write was swallowed.
    setLearningState(getLearning());
  }

  async function handleImportProgress(file: File): Promise<void> {
    if (!window.confirm("Importing replaces all current progress. Continue?")) {
      return;
    }
    const skipped = await importBackup(file);
    if (skipped > 0) {
      // Alert rather than an inline error: the reload below wipes this screen.
      window.alert(
        `${skipped} Book(s) in this backup need a newer app and were not restored. Everything else was.`,
      );
    }
    location.reload();
  }

  /** Shared by the Books and Domains export sections — same document shape,
   * filtered to one `kind` and named after it. JSON entry shape is
   * unchanged either way (`{ id, kind, doc }`); only the filter and the
   * filename are section-specific. */
  async function exportDocsOfKind(
    kind: "topic" | "domain",
    filenamePrefix: string,
  ): Promise<void> {
    const docs = await listMyDocuments();
    const full = await Promise.all(
      docs.filter((d) => d.kind === kind).map((d) => loadDocument(d.id)),
    );
    const out = full.map((d) => ({
      id: d.id,
      kind: d.kind,
      doc: d.published ?? d.draft,
    }));
    const blob = new Blob([JSON.stringify(out, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betterbeaver-${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleExportBooks = () => exportDocsOfKind("topic", "books");
  const handleExportDomains = () => exportDocsOfKind("domain", "domains");

  /** Shared by the Books and Domains import sections — same file shape,
   * checked against one expected `kind`. */
  async function importFileOfKind(
    file: File,
    kind: "topic" | "domain",
    setError: (error: string | null) => void,
  ): Promise<void> {
    setError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const all = Array.isArray(parsed) ? parsed : [parsed];
      // Old exports mixed both kinds in one file — filter, don't reject.
      const entries = (all as { kind?: unknown }[]).filter(
        (e) => e?.kind === kind,
      );
      if (entries.length === 0) {
        throw new Error(
          `not a BetterBeaver ${kind === "topic" ? "book" : "domain"} export file`,
        );
      }
      const checked = (entries as unknown[]).map((entry) => {
        // Light structural check only — full schema validation happens at
        // publish/propose time in the editor, not here.
        const e = entry as { id?: unknown; doc?: unknown };
        if (
          typeof e?.id !== "string" ||
          typeof e?.doc !== "object" ||
          e.doc === null
        ) {
          throw new Error(
            `not a BetterBeaver ${kind === "topic" ? "book" : "domain"} export file`,
          );
        }
        return { id: e.id, doc: e.doc };
      });
      await onImportBook(checked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  }

  const handleImportBook = (file: File) =>
    importFileOfKind(file, "topic", setBookImportError);
  const handleImportDomain = (file: File) =>
    importFileOfKind(file, "domain", setDomainImportError);

  /** Import a private Book export (spec 0017-5 §3): parses + shape-checks
   * the file (rules 1-2), confirms a replace on a matching id already on
   * this device (rule 4), then hands off to `importPrivateBook` for the
   * cross-Book validation and commit (rules 3+5). */
  async function handleImportPrivateBook(file: File): Promise<void> {
    setPrivateImportError(null);
    try {
      const parsed = await parsePrivateBookImport(file);
      if (!parsed.ok) {
        setPrivateImportError(parsed.error);
        return;
      }
      const existing = await readPrivateBook(parsed.bookId);
      if (
        existing !== undefined &&
        !window.confirm(
          "A Book with this id already exists on this device. Importing replaces it. Continue?",
        )
      ) {
        return;
      }
      await importPrivateBook(
        parsed.bookId,
        parsed.book,
        parsed.domain,
        parsed.assets,
      );
    } catch (err) {
      setPrivateImportError(
        err instanceof Error ? err.message : "Import failed",
      );
    }
  }

  async function handleErase(): Promise<void> {
    if (
      !window.confirm(
        "This erases all your progress, settings, and drafts on this device, including any Books you created here — those can't be downloaded again. Export first if you want a backup. Continue?",
      )
    ) {
      return;
    }
    await eraseAllData();
    location.reload();
  }

  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/arrow_W.png`}
            alt="Back"
          />
        </button>
        <h1>Settings</h1>
      </header>

      <section className="card">
        <h2>Appearance</h2>
        <div className="grade-buttons">
          {THEME_OPTIONS.map(({ pref, label }) => (
            <button
              key={pref}
              className={themePref === pref ? "primary" : "plain"}
              onClick={() => selectTheme(pref)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Learning</h2>
        <label className="field">
          Review pace
          <select
            value={learning.pace}
            onChange={(event) =>
              updateLearning({ pace: event.target.value as ReviewPace })
            }
          >
            {PACE_OPTIONS.map(({ pace, label }) => (
              <option key={pace} value={pace}>
                {label} — {REVIEW_PACES[pace].slice(1).join(", ")} days
              </option>
            ))}
          </select>
        </label>
        <p className="status">
          How fast a word you keep getting right moves out of your way. Every
          word has a level: getting it right moves it one level up, at most one
          level a day once it is being asked to produce the word, and the level
          says both how hard the next question is and how long until you see it
          again. Getting it wrong steps back two levels, never back to the
          start. Cards you already have keep their current due dates.
        </p>
        <label className="field">
          Skip for
          <select
            value={learning.skip}
            onChange={(event) =>
              updateLearning({ skip: event.target.value as SkipLength })
            }
          >
            {SKIP_OPTIONS.map(({ skip, label }) => (
              <option key={skip} value={skip}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="status">
          How long Skip hides a card in Daily Review. Long-press Skip to pick a
          different length for one card.
        </p>
      </section>

      <section className="card">
        <h2>Sound</h2>
        <label>
          <input
            type="checkbox"
            checked={soundOn}
            onChange={(event) => toggleSound(event.target.checked)}
          />{" "}
          Sound effects
        </label>
        <p className="status">
          Chirps on right/wrong answers (word pronunciation always plays).
        </p>
      </section>

      <section className="card">
        <h2>Offline mode</h2>
        <label>
          <input
            type="checkbox"
            checked={offlineOn}
            onChange={(event) => toggleOffline(event.target.checked)}
          />{" "}
          Never go online
        </label>
        <p className="status">
          No content updates and no connection to the database. Your downloaded
          Books, vocabulary and progress all keep working; the Library, content
          editing, feedback and chat are hidden while this is on.
        </p>
      </section>

      {getSupabase() !== null ? (
        <section className="card">
          <h2>Feedback name</h2>
          <p className="status">
            Shown next to your votes, reports, and chat messages — no account
            needed.
          </p>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayNameState(event.target.value)}
            onBlur={() => {
              setDisplayName(displayName);
              setDisplayNameState(getDisplayName());
            }}
          />
        </section>
      ) : null}

      {getSupabase() !== null ? (
        <section className="card">
          <h2>Account</h2>
          {user === "loading" ? (
            <p className="status">Loading…</p>
          ) : user === null ? (
            <button className="plain" onClick={onSignIn}>
              Sign in to create content
            </button>
          ) : (
            <>
              <p>Signed in as {user.email}</p>
              <button
                className="plain"
                onClick={() => {
                  void signOut().then(() => setUser(null));
                }}
              >
                Sign out
              </button>
            </>
          )}
        </section>
      ) : null}

      <section className="card">
        <h2>Content</h2>
        {/* Both controls need the network: a refresh is a re-download, and
            offline there is nothing to download from. */}
        <button
          className="plain"
          disabled={offlineOn || refreshing}
          onClick={() => {
            setRefreshError(null);
            setRefreshDone(false);
            setRefreshing(true);
            // Resolving without a reload means every member Book was already
            // at the version the backend serves (or is local-only): nothing
            // was committed, so nothing navigates and the status line is the
            // only sign the button did anything.
            refreshContent().then(
              () => {
                setRefreshing(false);
                setRefreshDone(true);
              },
              (error: unknown) => {
                setRefreshing(false);
                setRefreshError(
                  error instanceof Error ? error.message : String(error),
                );
              },
            );
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh content"}
        </button>
        <p className="status">
          Re-downloads your Books' lessons from the server, and repairs a Book
          that stopped loading. Your progress is not affected.
        </p>
        {refreshError !== null && <p className="error-text">{refreshError}</p>}
        {refreshDone && <p className="status">Your Books are up to date.</p>}
        <label>
          <input
            type="checkbox"
            checked={autoUpdateOn}
            disabled={offlineOn}
            onChange={(event) => toggleAutoUpdate(event.target.checked)}
          />{" "}
          Auto-update content
        </label>
        <p className="status">
          Apply a found content update right away instead of showing the update
          banner. Applies when the app starts and when you come back to My
          Books.
        </p>
        {offlineOn ? (
          <p className="setting-hint">Unavailable while offline mode is on.</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Data</h2>
        <div className="grade-buttons">
          <button
            className="plain"
            onClick={() => {
              setExportError(null);
              // Reading the private Books' assets can fail (FileReader). A
              // silent no-download is the worst outcome for the one action
              // whose job is "don't lose my data".
              exportBackup().catch(() =>
                setExportError(
                  "Export failed — your Books' files could not be read.",
                ),
              );
            }}
          >
            Export my progress
          </button>
          <button
            className="plain"
            onClick={() => progressFileRef.current?.click()}
          >
            Import progress…
          </button>
          <input
            ref={progressFileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) {
                void handleImportProgress(file);
              }
            }}
          />
        </div>
        <p className="status">
          The export includes any Books you created on this device. Importing
          restores your progress and adds those Books back; it never deletes a
          Book you created since.
        </p>
        {exportError !== null ? (
          <p className="error-text">{exportError}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Your Books</h2>
        <div className="grade-buttons">
          <button
            className="plain"
            onClick={() => privateBookFileRef.current?.click()}
          >
            Import a Book…
          </button>
          <input
            ref={privateBookFileRef}
            type="file"
            accept=".bbbook"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) {
                void handleImportPrivateBook(file);
              }
            }}
          />
        </div>
        <p className="status">
          Loads a Book someone exported from another device. No account needed.
          A Book already on this device with the same id gets replaced.
        </p>
        {privateImportError !== null ? (
          <p className="error-text">{privateImportError}</p>
        ) : null}
      </section>

      {getSupabase() !== null && user !== "loading" && user !== null ? (
        <section className="card">
          <h2>Books</h2>
          <div className="grade-buttons">
            <button className="plain" onClick={() => void handleExportBooks()}>
              Export my books
            </button>
            <button
              className="plain"
              onClick={() => bookFileRef.current?.click()}
            >
              Import book…
            </button>
            <input
              ref={bookFileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) {
                  void handleImportBook(file);
                }
              }}
            />
          </div>
          <p className="status">
            Import loads a book into your draft; open it to review and publish.
            You can only publish books you maintain.
          </p>
          {bookImportError !== null ? (
            <p className="error-text">{bookImportError}</p>
          ) : null}
        </section>
      ) : null}

      {getSupabase() !== null && user !== "loading" && user !== null ? (
        <section className="card">
          <h2>Domains</h2>
          <div className="grade-buttons">
            <button
              className="plain"
              onClick={() => void handleExportDomains()}
            >
              Export my domains
            </button>
            <button
              className="plain"
              onClick={() => domainFileRef.current?.click()}
            >
              Import domain…
            </button>
            <input
              ref={domainFileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) {
                  void handleImportDomain(file);
                }
              }}
            />
          </div>
          <p className="status">
            Import loads a domain into your draft; open it to review and
            publish. You can only publish domains you maintain.
          </p>
          {domainImportError !== null ? (
            <p className="error-text">{domainImportError}</p>
          ) : null}
        </section>
      ) : null}

      {/* Above Danger on purpose: it is the last thing anyone should reach
          by scrolling, and "which version am I on" is the first thing a bug
          report needs. */}
      <section className="card">
        <h2>About</h2>
        <button className="plain" onClick={onAbout}>
          About BetterBeaver
        </button>
        <p className="status">
          Version {APP_VERSION}
          {APP_COMMIT === "" ? null : ` · build ${APP_COMMIT}`} —{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            source on GitHub
          </a>
          .
        </p>
      </section>

      <section className="card">
        <h2>Danger</h2>
        <button className="plain danger" onClick={() => void handleErase()}>
          Erase all my data
        </button>
      </section>
    </main>
  );
}
