import { LegalLinks } from "../components/LegalLinks";

/** Welcome cover (plan 0009): mascot, title, tagline, one button. Carries the
 * legal links too — it is the first screen of every session, so it is where
 * "ständig verfügbar" starts. */
export function StartScreen({
  onStart,
  onImpressum,
  onPrivacy,
}: {
  onStart: () => void;
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
      <LegalLinks onImpressum={onImpressum} onPrivacy={onPrivacy} />
    </div>
  );
}
