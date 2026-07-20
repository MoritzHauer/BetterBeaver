import { useEffect, useRef, useState } from "react";
import {
  currentUser,
  getSupabase,
  listMyDocuments,
  loadDocument,
  signOut,
} from "../backend/supabase";
import type { User } from "@supabase/supabase-js";
import { clearCachedDocuments } from "../content/cache";
import { eraseAllData, exportBackup, importBackup } from "../progress/backup";
import { SOUND_KEY } from "../sounds";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { getDisplayName, setDisplayName } from "../identity";

const THEME_OPTIONS: { pref: ThemePref; label: string }[] = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

export function SettingsScreen({
  onBack,
  onSignIn,
  onImportClass,
}: {
  onBack: () => void;
  onSignIn: () => void;
  onImportClass: (docId: string) => void;
}) {
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const [displayName, setDisplayNameState] = useState(getDisplayName);
  const [soundOn, setSoundOn] = useState(
    () => localStorage.getItem(SOUND_KEY) !== "off",
  );
  const [user, setUser] = useState<User | null | "loading">(
    getSupabase() === null ? null : "loading",
  );
  const [classImportError, setClassImportError] = useState<string | null>(null);
  const progressFileRef = useRef<HTMLInputElement>(null);
  const classFileRef = useRef<HTMLInputElement>(null);

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

  async function handleImportProgress(file: File): Promise<void> {
    if (!window.confirm("Importing replaces all current progress. Continue?")) {
      return;
    }
    await importBackup(file);
    location.reload();
  }

  async function handleExportClasses(): Promise<void> {
    const docs = await listMyDocuments();
    const full = await Promise.all(docs.map((d) => loadDocument(d.id)));
    const classes = full.map((d) => ({
      id: d.id,
      kind: d.kind,
      doc: d.published ?? d.draft,
    }));
    const blob = new Blob([JSON.stringify(classes, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betterbeaver-classes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportClass(file: File): Promise<void> {
    setClassImportError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries as unknown[]) {
        // Light structural check only — full schema validation happens at
        // publish time in the editor, not here.
        const e = entry as {
          id?: unknown;
          kind?: unknown;
          doc?: unknown;
        };
        if (
          typeof e?.id !== "string" ||
          (e.kind !== "topic" && e.kind !== "domain") ||
          typeof e?.doc !== "object" ||
          e.doc === null
        ) {
          throw new Error("not a BetterBeaver class export file");
        }
        localStorage.setItem(`bb.author.draft.${e.id}`, JSON.stringify(e.doc));
      }
      onImportClass((entries[0] as { id: string }).id);
    } catch (err) {
      setClassImportError(err instanceof Error ? err.message : "Import failed");
    }
  }

  async function handleErase(): Promise<void> {
    if (
      !window.confirm(
        "This erases all your progress, settings, and drafts on this device. Export first if you want a backup. Continue?",
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
          ←
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
        <button
          className="plain"
          onClick={() => {
            void clearCachedDocuments().then(() => location.reload());
          }}
        >
          Refresh content
        </button>
        <p className="status">
          Clears cached lessons and re-downloads. Your progress is not affected.
        </p>
      </section>

      <section className="card">
        <h2>Data</h2>
        <div className="grade-buttons">
          <button className="plain" onClick={exportBackup}>
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
      </section>

      {getSupabase() !== null && user !== "loading" && user !== null ? (
        <section className="card">
          <h2>Classes</h2>
          <div className="grade-buttons">
            <button
              className="plain"
              onClick={() => void handleExportClasses()}
            >
              Export my classes
            </button>
            <button
              className="plain"
              onClick={() => classFileRef.current?.click()}
            >
              Import class…
            </button>
            <input
              ref={classFileRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) {
                  void handleImportClass(file);
                }
              }}
            />
          </div>
          <p className="status">
            Import loads a class into your draft; open it to review and publish.
            You can only publish classes you maintain.
          </p>
          {classImportError !== null ? (
            <p className="error-text">{classImportError}</p>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <h2>Danger</h2>
        <button className="plain danger" onClick={() => void handleErase()}>
          Erase all my data
        </button>
      </section>
    </main>
  );
}
