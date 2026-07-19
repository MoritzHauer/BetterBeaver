/** Static privacy note (plan 0012 §10): author accounts are the only personal data anywhere. */
export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  return (
    <main>
      <header className="screen-header">
        <button className="plain" onClick={onBack}>
          ←
        </button>
        <h1>Privacy</h1>
      </header>
      <section className="card">
        <p>
          <strong>Learning without an account:</strong> everything you study —
          progress, streaks, word lists, your own entries — stays on this
          device. Nothing is sent anywhere; the app only downloads content
          updates, and only when you tap "Update now". Use Export in Vocabulary
          for backups.
        </p>
        <p>
          <strong>Author accounts:</strong> if you sign in to edit content, we
          store your email address and link it to the content versions and
          proposals you author. That's all. To delete your account and anonymize
          your authorship records, email{" "}
          <a href="mailto:moritzhauer@freenet.de">moritzhauer@freenet.de</a>.
        </p>
        <p>
          Author data is stored with Supabase (EU region). No analytics, no
          telemetry, no third-party trackers — in either mode.
        </p>
      </section>
    </main>
  );
}
