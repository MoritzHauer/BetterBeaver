import { useState } from "react";
import { APP_COMMIT, APP_VERSION, REPO_URL } from "../version";
import {
  clearNavDiary,
  formatNavDiary,
  isStandalone,
  readNavDiary,
} from "../nav-diary";

/**
 * About / info page: what the app is, which build you are looking at, and
 * where the source lives.
 *
 * The version matters more here than on a server-rendered site: an installed
 * PWA runs whatever its service worker last cached, so "which build is this"
 * is not answerable from the URL. Version plus commit is what makes a bug
 * report actionable — hence both, and hence the plain text rather than a
 * badge nobody can copy out of a screenshot.
 */
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const [diary, setDiary] = useState(readNavDiary);
  const diaryText = formatNavDiary(diary);
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
        <h1>About</h1>
      </header>

      <section className="card about-card">
        <img
          className="about-mascot"
          src={`${import.meta.env.BASE_URL}art/mascot.png`}
          alt=""
        />
        <h2>BetterBeaver</h2>
        <p className="about-version">
          Version {APP_VERSION}
          {APP_COMMIT === "" ? null : ` · build ${APP_COMMIT}`}
        </p>
        <p className="status">
          Still in beta — 0.x means things move and occasionally break.
        </p>
      </section>

      <section className="card">
        <p>
          Spaced-repetition learning that keeps small, well-timed reviews coming
          — offline-first, on whatever you are learning. Your progress stays on
          this device.
        </p>
        <p>
          <a href="https://betterbeaver.de" target="_blank" rel="noreferrer">
            betterbeaver.de
          </a>
        </p>
        <p>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code on GitHub
          </a>
        </p>
        <p className="status">
          Open source under the MIT licence. Bug reports and ideas are welcome
          in the repository&rsquo;s issues.
        </p>
      </section>

      <section className="card">
        <h2>Contact</h2>
        <p>
          <a href="mailto:info@betterbeaver.de">info@betterbeaver.de</a>
        </p>
        <p className="status">
          Legal details are on the Impressum page; what the app stores and sends
          is on the Datenschutz page.
        </p>
      </section>

      {/* Diagnostics (2026-08-21): the hardware-back bug has survived two
          fixes that a desktop browser said were correct, and a black screen
          leaves nothing to inspect. This is the device's own account of what
          happened, kept on the device — it is never sent anywhere. */}
      <section className="card">
        <h2>Diagnostics</h2>
        <p className="status">
          The last few navigation events on this device, newest at the bottom.
          Nothing here leaves your phone; it is only useful if you are reporting
          a bug.
        </p>
        <p className="status">
          Display mode: {isStandalone() ? "installed app" : "browser"}
        </p>
        {diary.length === 0 ? (
          <p className="status">Nothing recorded yet.</p>
        ) : (
          <pre className="diagnostics-log">{diaryText}</pre>
        )}
        <div className="grade-buttons">
          <button
            className="plain"
            onClick={() => {
              // Clipboard access can be refused or absent; the text is on
              // screen and selectable either way, so a failure is silent
              // rather than an error the reader can do nothing about.
              void navigator.clipboard?.writeText(diaryText).catch(() => {});
            }}
          >
            Copy
          </button>
          <button
            className="plain"
            onClick={() => {
              clearNavDiary();
              setDiary([]);
            }}
          >
            Clear
          </button>
        </div>
      </section>
    </main>
  );
}
