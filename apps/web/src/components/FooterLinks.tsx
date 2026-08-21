/** About + Impressum + Datenschutz row. § 5 DDG wants the latter two "leicht
 * erkennbar, unmittelbar erreichbar und ständig verfügbar", so this sits on
 * the cover (the first screen a visitor sees) and on the home screen — every
 * other screen is one Back away from home. About rides along rather than
 * getting a row of its own: it is the same kind of link (page-level info, not
 * an action on your Books), and a second footer nav would only compete with
 * this one. German labels for the legal two on purpose: German users look for
 * those words, English UI or not. */
export function FooterLinks({
  onAbout,
  onImpressum,
  onPrivacy,
}: {
  onAbout: () => void;
  onImpressum: () => void;
  onPrivacy: () => void;
}) {
  return (
    <nav className="footer-links">
      <button type="button" className="plain link-button" onClick={onAbout}>
        About
      </button>
      <button type="button" className="plain link-button" onClick={onImpressum}>
        Impressum
      </button>
      <button type="button" className="plain link-button" onClick={onPrivacy}>
        Datenschutz
      </button>
    </nav>
  );
}
