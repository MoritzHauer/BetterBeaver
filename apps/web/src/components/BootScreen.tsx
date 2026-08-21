import { useEffect, useState } from "react";
import { recordNav } from "../nav-diary";

/** How long a boot may take before the wait gets a voice. Long enough that a
 * cold start on a slow phone never sees it; short enough that nobody sits in
 * front of a screen that is doing nothing wondering whether to kill the app. */
const STALL_MS = 8000;

/**
 * What the app shows between the first frame and the content source being
 * ready. Its real job is the second half: if the boot never finishes, this is
 * what the owner sees instead of a black rectangle.
 *
 * The stall notice does **not** cancel the boot — a slow device deserves to
 * finish, and a cancelled boot would need its own recovery story. It only
 * turns an indefinite wait into a stated one with a way out, and drops a
 * `boot-stalled` line in the diary so the next report says whether the app
 * got stuck here or somewhere after.
 */
export function BootScreen() {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      recordNav("boot-stalled", `after ${STALL_MS}ms`);
      setStalled(true);
    }, STALL_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="start-screen">
      <img
        className="start-mascot"
        src={`${import.meta.env.BASE_URL}art/mascot.png`}
        alt=""
      />
      <h1 className="start-title">BetterBeaver</h1>
      {stalled ? (
        <>
          <p className="start-tagline">
            This is taking longer than it should. Your Books and progress are
            safe — the app just cannot open its content store right now.
          </p>
          <button
            type="button"
            className="primary start-button"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </>
      ) : (
        <p className="start-tagline">Starting…</p>
      )}
    </div>
  );
}
