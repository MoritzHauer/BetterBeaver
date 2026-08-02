/**
 * Datenschutzerklärung — the Art. 13 GDPR information duty, not a summary.
 * Every claim here is checked against the code: `content/source.ts` (catalog
 * fetch on launch), `backend/storage.ts` (assets), `backend/feedback.ts` +
 * `identity.ts` (device id, display name, public chat), `backend/supabase.ts`
 * (magic-link author accounts), `offline.ts` (what offline mode does and does
 * not cover). Change any of those and this page has to change with them.
 *
 * Controller identity lives in the Impressum and is not duplicated here.
 */
export function PrivacyScreen({ onBack }: { onBack: () => void }) {
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
        <h1>Datenschutz</h1>
      </header>
      <section className="card">
        <h2>Who is responsible</h2>
        <p>
          The controller for this app is the person named in the Impressum.
          Contact:{" "}
          <a href="mailto:info@betterbeaver.de">info@betterbeaver.de</a>.
        </p>

        <h2>What stays on your device</h2>
        <p>
          Everything you study — progress, streaks, word lists, your own Books
          and drafts, settings — is stored only on this device, in your
          browser's local storage. It is never sent to us, and we could not read
          it if we wanted to. Use Export in Vocabulary for backups: clearing
          your browser's data for this site deletes it with no copy anywhere
          else.
        </p>

        <h2>Hosting</h2>
        <p>
          The app is served by GitHub Pages (GitHub, Inc., USA). Opening any
          page sends your IP address and the usual request data (time, page,
          browser) to GitHub, which logs it to deliver and secure the site. We
          have no access to those logs. Legal basis: Art. 6(1)(f) GDPR — our
          legitimate interest in making the app available. This involves a
          transfer to the USA; see{" "}
          <a
            href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement"
            target="_blank"
            rel="noreferrer"
          >
            GitHub's privacy statement
          </a>
          .
        </p>

        <h2>Content updates</h2>
        <p>
          When the app starts, and again when you tap "Update now", it asks our
          backend whether newer content exists and downloads the content and
          media you accept. Your IP address reaches that server for these
          requests. The backend is Supabase (Supabase, Inc., EU region), acting
          for us as a processor under Art. 28 GDPR. Legal basis: Art. 6(1)(f)
          GDPR — delivering the content you asked for. Offline mode in Settings
          stops every content and database request in the app; your browser may
          still refresh the app itself from GitHub.
        </p>

        <h2>Feedback, reports and chat</h2>
        <p>
          These are optional and only happen when you use them. Voting on
          content, reporting content, or posting in a Book's chat sends to the
          backend: a random id generated on this device, your display name
          (auto-generated as "AnonymBeaver…", changeable in Settings), and what
          you wrote. There is no account behind any of it.
        </p>
        <p>
          <strong>
            Chat messages and the display name attached to them are public
          </strong>{" "}
          — everyone using that Book can read them. Do not put anything in
          either that you do not want published. Votes and reports are visible
          only to the maintainers of that Book. Legal basis: Art. 6(1)(f) GDPR —
          our legitimate interest in improving the content, acted on only when
          you submit something.
        </p>
        <p>
          Because the device id has no account behind it, we cannot tell which
          entries are yours. Clearing your browser's data for this site gives
          this device a new id, but anything already posted stays. To get a chat
          message removed, report it — the Book's maintainer can delete it — or
          email us with the text and roughly when you posted it.
        </p>

        <h2>Author accounts</h2>
        <p>
          If you sign in to edit content, we store your email address (with
          Supabase Auth, EU region) and link it to the content versions and
          proposals you author. It is used to send you sign-in links and to
          attribute content. Legal basis: Art. 6(1)(b) GDPR — providing the
          authoring service you signed up for. We keep it until you ask us to
          stop: email{" "}
          <a href="mailto:info@betterbeaver.de">info@betterbeaver.de</a> and we
          delete the account and anonymize your authorship records.
        </p>

        <h2>No tracking, and no cookie banner</h2>
        <p>
          No analytics, no telemetry, no advertising, no third-party trackers,
          in any mode. The app stores data on your device only to work offline
          and to keep you signed in if you are an author — strictly necessary
          for a service you explicitly requested (§ 25 Abs. 2 TDDDG), which is
          why there is nothing here to consent to.
        </p>

        <h2>Your rights</h2>
        <p>
          You have the right to access (Art. 15), rectification (Art. 16),
          erasure (Art. 17), restriction (Art. 18), data portability (Art. 20)
          and to object to processing based on legitimate interests (Art. 21).
          Email <a href="mailto:info@betterbeaver.de">info@betterbeaver.de</a>.
          You may also complain to a data protection supervisory authority —
          normally the one for the German Bundesland you live in (Art. 77).
        </p>
      </section>
    </main>
  );
}
