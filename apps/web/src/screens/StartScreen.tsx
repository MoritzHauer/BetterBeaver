import { FooterLinks } from "../components/FooterLinks";

/** Welcome cover (plan 0009): mascot, title, tagline, one button. Carries the
 * footer links too — it is the first screen of every session, so it is where
 * "ständig verfügbar" starts. */
export function StartScreen({
  onStart,
  onAbout,
  onImpressum,
  onPrivacy,
}: {
  onStart: () => void;
  onAbout: () => void;
  onImpressum: () => void;
  onPrivacy: () => void;
}) {
  return (
    <div className="start-screen">
      <img
        className="start-mascot"
        src={`${import.meta.env.BASE_URL}art/mascot.png`}
        alt=""
      />
      <h1 className="start-title">BetterBeaver</h1>
      <p className="start-tagline">Building language, one word at a time.</p>
      <button type="button" className="primary start-button" onClick={onStart}>
        Get Started
      </button>
      <FooterLinks
        onAbout={onAbout}
        onImpressum={onImpressum}
        onPrivacy={onPrivacy}
      />
    </div>
  );
}
