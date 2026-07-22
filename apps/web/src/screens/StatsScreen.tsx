import { useEffect, useState } from "react";
import type { DomainSummary } from "@betterbeaver/engine";
import { gatherStats, type LearnerStats } from "../stats";
import {
  currentUser,
  getSupabase,
  listMyDocuments,
  type AuthorDocSummary,
} from "../backend/supabase";

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
    gatherStats(new Date()).then(setStats);
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

      <section className="card">
        <h2>Activity</h2>
        <ul>
          <li>
            <span aria-hidden="true">🎯</span> {stats.reps} answers given
          </li>
          <li>
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/checkmark.png`}
              alt=""
            />{" "}
            {stats.tasks} tasks completed
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

      <section className="card">
        <h2>Badges</h2>
        <ul>
          <li>
            {stats.streak >= 7 ? "✓" : "–"}{" "}
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/fire.png`}
              alt=""
            />{" "}
            Week streak
          </li>
          <li>{stats.reps >= 100 ? "✓" : "–"} 🎯 Century</li>
          <li>
            {stats.wordsSaved >= 10 ? "✓" : "–"}{" "}
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/book_front.png`}
              alt=""
            />{" "}
            Wordsmith
          </li>
          <li>
            {stats.tasks >= 10 ? "✓" : "–"}{" "}
            <img
              className="icon-glyph"
              src={`${import.meta.env.BASE_URL}art/icons/checkmark.png`}
              alt=""
            />{" "}
            Getting started
          </li>
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
