import { useId } from "react";

/** Flat brand icons in the mascot palette (plan 0009; colors sampled from
 * `docs/plans/assets/0009-mascot-canonical.png`). The two log bars are live
 * progress components, not static art — a raster image can't render a
 * varying fill. */

const BARK = "#8b5a2b";
const BARK_DARK = "#6b4226";
const WOOD = "#e8c89a";
const RING = "#c68b4e";
const COVER = "#894018";
const COVER_GRAIN = "#5f2c10";
const PAGE = "#fbdfad";
const KNOB = "#e6b072";
const FUR = "#fd8a30";
const FUR_DARK = "#753817";
const NOSE = "#633216";
const CHEEK = "#feac82";
const TOOTH = "#fefbe4";

/** Open log-book, drawn like the one the mascot holds. Scales via `size`. */
export function LogBookIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2 8.8 L12 11.8 L22 8.8 L22 16.2 L12 19.2 L2 16.2 Z"
        fill={COVER}
        stroke={COVER}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M4.8 11 v3 M7.8 11.9 v3 M19.2 11 v3 M16.2 11.9 v3"
        stroke={COVER_GRAIN}
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M2.3 9 C3.2 5.4 9.6 4.6 12 9.2 C14.4 4.6 20.8 5.4 21.7 9 L12 12.2 Z"
        fill={PAGE}
      />
      <ellipse cx="12" cy="12.6" rx="1.3" ry="1.7" fill={KNOB} />
    </svg>
  );
}

/* Both bars share this geometry: 240x24 viewBox, log body 20px tall. */
const BAR_W = 240;

function Grain() {
  return (
    <g stroke={BARK_DARK} strokeWidth="2" strokeLinecap="round" opacity="0.55">
      <path d="M28 8 H52 M76 16 H104 M126 7 H148 M172 15 H198 M212 9 H224" />
    </g>
  );
}

/** Log that grows left to right with `progress` (0..1). */
export function LogGrowBar({ progress }: { progress: number }) {
  const clip = useId();
  const p = Math.max(0, Math.min(1, progress));
  const w = p * BAR_W;
  return (
    <svg
      viewBox={`0 0 ${BAR_W} 24`}
      width="100%"
      height="24"
      role="progressbar"
      aria-valuenow={Math.round(p * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <rect
        x="0"
        y="4"
        width={BAR_W}
        height="16"
        rx="8"
        fill={BARK}
        opacity="0.22"
      />
      <clipPath id={clip}>
        <rect x="0" y="0" width={w} height="24" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="2" width={BAR_W} height="20" rx="10" fill={BARK} />
        <Grain />
      </g>
      {p > 0.04 && p < 1 && (
        // Cut face of the log at the growing end.
        <g>
          <ellipse cx={w} cy="12" rx="5" ry="10" fill={WOOD} />
          <ellipse
            cx={w}
            cy="12"
            rx="2.5"
            ry="5"
            fill="none"
            stroke={RING}
            strokeWidth="1.5"
          />
        </g>
      )}
    </svg>
  );
}

/** Log that gets eaten left to right: `progress` (0..1) is the eaten share.
 * A mini beaver chews at the bite edge. */
export function LogEatenBar({ progress }: { progress: number }) {
  const mask = useId();
  const p = Math.max(0, Math.min(1, progress));
  const x = p * BAR_W;
  // The beaver tracks the bite edge but stays fully on-canvas at 0 and 1.
  const bx = Math.max(13, Math.min(228, x));
  return (
    <svg
      viewBox={`0 0 ${BAR_W} 24`}
      width="100%"
      height="24"
      role="progressbar"
      aria-valuenow={Math.round(p * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <rect
        x="0"
        y="4"
        width={BAR_W}
        height="16"
        rx="8"
        fill={BARK}
        opacity="0.22"
      />
      <mask id={mask}>
        <rect x={x} y="0" width={BAR_W - x} height="24" rx="10" fill="#fff" />
        {/* Bite scallops on the eaten edge. */}
        <circle cx={x} cy="4" r="4.5" fill="#000" />
        <circle cx={x + 2} cy="13" r="5" fill="#000" />
        <circle cx={x} cy="21" r="4" fill="#000" />
      </mask>
      <g mask={`url(#${mask})`}>
        <rect x="0" y="2" width={BAR_W} height="20" rx="10" fill={BARK} />
        <Grain />
        <ellipse
          cx={BAR_W - 1}
          cy="12"
          rx="4"
          ry="9"
          fill={WOOD}
          opacity="0.9"
        />
      </g>
      {/* Mini beaver, facing right, chewing at the bite edge (coords are
       * authored around an edge at x=84 and shifted as a group). */}
      <g transform={`translate(${bx - 84} 0)`}>
        <ellipse
          cx="69"
          cy="16"
          rx="5"
          ry="2.6"
          fill={COVER_GRAIN}
          transform="rotate(-25 69 16)"
        />
        <circle cx="75.5" cy="4" r="3.2" fill={FUR_DARK} />
        <circle cx="75.5" cy="4" r="1.3" fill={CHEEK} />
        <circle cx="81" cy="12" r="10" fill={FUR} />
        <circle cx="85" cy="8.5" r="1.5" fill="#2b1a10" />
        <circle cx="77" cy="14" r="2.2" fill={CHEEK} />
        <ellipse cx="88" cy="11.5" rx="2.4" ry="1.8" fill={NOSE} />
        <rect x="86" y="13.2" width="3.4" height="4.4" rx="1" fill={TOOTH} />
        <line
          x1="87.7"
          y1="13.4"
          x2="87.7"
          y2="17.2"
          stroke="#e0d0b0"
          strokeWidth="0.7"
        />
      </g>
    </svg>
  );
}
