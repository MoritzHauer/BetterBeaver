import { useEffect, useState } from "react";
import type { DomainSummary } from "@betterbeaver/engine";
import {
  gatherStats,
  type LearnerStats,
  type MasteryBreakdown,
} from "../stats";
import {
  currentUser,
  getSupabase,
  listMyDocuments,
  type AuthorDocSummary,
} from "../backend/supabase";

/** The three bands the word ladder divides into, and what each one means in
 * the learner's terms rather than the scheduler's. */
const MASTERY_BANDS: {
  key: keyof MasteryBreakdown;
  label: string;
  why: string;
}[] = [
  { key: "learning", label: "learning", why: "still being shown to you" },
  { key: "known", label: "known", why: "you produce these from memory" },
  { key: "mature", label: "mature", why: "coming back in weeks, not days" },
];

function dueDayLabel(index: number): string {
  if (index === 0) {
    return "today";
  }
  if (index === 1) {
    return "tmrw";
  }
  const day = new Date();
  day.setDate(day.getDate() + index);
  return day.toLocaleDateString(undefined, { weekday: "short" });
}

/** One badge as a target you are walking toward, not a lit-or-unlit lamp.
 * Carries the count and the goal as text, so the state is never conveyed by
 * a glyph alone. */
function BadgeRow({
  label,
  icon,
  emoji,
  have,
  need,
  unit,
}: {
  label: string;
  icon?: string;
  emoji?: string;
  have: number;
  need: number;
  unit: string;
}) {
  const earned = have >= need;
  const pct = Math.min(100, Math.round((have / need) * 100));
  return (
    <li className={earned ? "badge-row is-earned" : "badge-row"}>
      <span className="badge-head">
        <span className="badge-mark" aria-hidden="true">
          {earned ? "\u2713" : ""}
        </span>
        {icon !== undefined && (
          <img
            className="icon-glyph"
            src={`${import.meta.env.BASE_URL}art/icons/${icon}.png`}
            alt=""
          />
        )}
        {emoji !== undefined && <span aria-hidden="true">{emoji}</span>}{" "}
        <strong>{label}</strong>
        <span className="status">
          {earned ? "earned" : `${Math.min(have, need)} / ${need} ${unit}`}
        </span>
      </span>
      <span
        className="badge-track"
        role="img"
        aria-label={
          earned ? `${label}: earned` : `${label}: ${have} of ${need} ${unit}`
        }
      >
        <span className="badge-fill" style={{ width: `${pct}%` }} />
      </span>
    </li>
  );
}

interface CreatorStats {
  booksMaintained: number;
  listed: number;
  versionsPublished: number;
  docs: AuthorDocSummary[];
}

export function StatsScreen({
  onBack,
  domains,
}: {
  onBack: () => void;
  domains: DomainSummary[]; // for mapping domainId -> title in the streak breakdown
}) {
  const [stats, setStats] = useState<LearnerStats | null>(null);
  const [creator, setCreator] = useState<CreatorStats | null>(null);

  useEffect(() => {
    // Cannot reject: every read `gatherStats` does is `readJson`- or
    // `storageKeys()`-backed, both of which degrade to absent/empty rather
    // than throwing (spec 0019 §1).
    void gatherStats(new Date()).then(setStats);
  }, []);

  // Separate effect/state: the creator card is a live backend read and must
  // never block the on-device stats above (which render immediately).
  useEffect(() => {
    if (getSupabase() === null) {
      return;
    }
    currentUser()
      .then((user) => {
        if (user === null) {
          return null;
        }
        return listMyDocuments();
      })
      .then((docs) => {
        if (docs === null || docs === undefined) {
          return;
        }
        setCreator({
          booksMaintained: docs.length,
          listed: docs.filter((d) => d.listed).length,
          versionsPublished: docs.reduce(
            (sum, d) => sum + d.published_version,
            0,
          ),
          docs,
        });
      })
      .catch(() => {
        // signed in but the read failed — omit the card silently
      });
  }, []);

  if (stats === null) {
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
          <h1>Stats</h1>
        </header>
        <p>Loading…</p>
      </main>
    );
  }

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
        <h1>Stats</h1>
      </header>

      <section className="card">
        <h2>Streak</h2>
        {stats.streak === 0 ? (
          <p>No active streak</p>
        ) : (
          <p>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
              alt=""
            />{" "}
            {stats.streak}-day streak
          </p>
        )}
        {stats.domainStreaks.length > 1 && (
          <ul>
            {stats.domainStreaks.map((ds) => (
              <li key={ds.domainId}>
                {domains.find((d) => d.id === ds.domainId)?.title ??
                  ds.domainId}{" "}
                <img
                  className="icon-glyph"
                  src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
                  alt=""
                />{" "}
                {ds.length}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Where you stand and what is coming — the two questions the lifetime
          totals below cannot answer. Derived from the SRS state already on
          the device, so it is populated on day one (ui-review 2026-09-13,
          finding st-vanity). */}
      {stats.itemsInReview > 0 && (
        <section className="card">
          <h2>Your words</h2>
          <div
            className="mastery-bar"
            role="img"
            aria-label={`${stats.mastery.learning} learning, ${stats.mastery.known} known, ${stats.mastery.mature} mature`}
          >
            {MASTERY_BANDS.map(({ key, label }) => {
              const count = stats.mastery[key];
              return count === 0 ? null : (
                <span
                  key={key}
                  className={`mastery-band is-${key}`}
                  style={{ flexGrow: count }}
                  title={`${count} ${label}`}
                />
              );
            })}
          </div>
          <ul className="mastery-key">
            {MASTERY_BANDS.map(({ key, label, why }) => (
              <li key={key}>
                <span className={`mastery-dot is-${key}`} aria-hidden="true" />
                <strong>{stats.mastery[key]}</strong> {label}
                <span className="status"> — {why}</span>
              </li>
            ))}
          </ul>
          <h3 className="setting-subhead">Coming up</h3>
          <ol className="due-forecast">
            {stats.dueNext7.map((count, index) => (
              <li key={index}>
                <span
                  className="due-bar"
                  style={{
                    height: `${count === 0 ? 2 : Math.round((count / Math.max(...stats.dueNext7)) * 40) + 2}px`,
                  }}
                />
                <span className="due-count">{count}</span>
                <span className="status">{dueDayLabel(index)}</span>
              </li>
            ))}
          </ol>
          <p className="setting-hint">
            Reviews falling due over the next week. Nothing due means nothing is
            slipping.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Activity</h2>
        <ul>
          <li>
            <span aria-hidden="true">🎯</span> {stats.reps} answers given
          </li>
          <li>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/repeat.png`}
              alt=""
            />{" "}
            {stats.itemsInReview} items in review
          </li>
          <li>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/book_front.png`}
              alt=""
            />{" "}
            {stats.wordsSaved} words saved
          </li>
        </ul>
      </section>

      {creator !== null && (
        <section className="card">
          <h2>Creator</h2>
          <p>Live — signed-in authors only</p>
          <ul>
            <li>{creator.booksMaintained} books maintained</li>
            <li>{creator.listed} listed</li>
            <li>
              <img
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/rocket.png`}
                alt=""
              />{" "}
              {creator.versionsPublished} versions published
            </li>
          </ul>
        </section>
      )}

      {/* Every badge shows its target and how far along you are. A bare "–"
          left a new learner with four unexplained dashes, and several screen
          readers skip a lone en-dash outright, so earned and unearned
          announced identically (ui-review 2026-09-13, finding st-empty). */}
      <section className="card">
        <h2>Badges</h2>
        <ul className="badge-list">
          <BadgeRow
            label="Week streak"
            icon="fire"
            have={stats.streak}
            need={7}
            unit="days"
          />
          <BadgeRow
            label="Century"
            emoji="🎯"
            have={stats.reps}
            need={100}
            unit="answers"
          />
          <BadgeRow
            label="Wordsmith"
            icon="book_front"
            have={stats.wordsSaved}
            need={10}
            unit="words saved"
          />
          {creator !== null && (
            <li>
              {creator.docs.some((d) => d.published_version >= 1) ? "✓" : "–"}{" "}
              <img
                className="icon-glyph"
                src={`${import.meta.env.BASE_URL}art/icons/beaver_pencil.png`}
                alt=""
              />{" "}
              First book published
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
