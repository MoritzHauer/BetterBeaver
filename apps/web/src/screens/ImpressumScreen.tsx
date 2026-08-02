/** Impressum (§ 5 DDG). */
export function ImpressumScreen({ onBack }: { onBack: () => void }) {
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
        <h1>Impressum</h1>
      </header>
      <section className="card">
        <p>Information pursuant to § 5 DDG</p>
        <p>
          Moritz Hauer
          <br />
          Rudolfstr. 7
          <br />
          76131 Karlsruhe
          <br />
          Germany
        </p>
        <p>
          <strong>Contact</strong>
          <br />
          E-mail: <a href="mailto:info@betterbeaver.de">info@betterbeaver.de</a>
        </p>
        <p>
          Responsible for the content under § 18 Abs. 2 MStV: as given above.
        </p>
      </section>
    </main>
  );
}
