/** Impressum + Datenschutz row. § 5 DDG wants both "leicht erkennbar,
 * unmittelbar erreichbar und ständig verfügbar", so this sits on the cover
 * (the first screen a visitor sees) and on the home screen — every other
 * screen is one Back away from home. German labels on purpose: German users
 * look for these two words, English UI or not. */
export function LegalLinks({
  onImpressum,
  onPrivacy,
}: {
  onImpressum: () => void;
  onPrivacy: () => void;
}) {
  return (
    <nav className="legal-links">
      <button type="button" className="plain link-button" onClick={onImpressum}>
        Impressum
      </button>
      <button type="button" className="plain link-button" onClick={onPrivacy}>
        Datenschutz
      </button>
    </nav>
  );
}
