import { APP_COMMIT, APP_VERSION, REPO_URL } from "../version";

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
    </main>
  );
}
