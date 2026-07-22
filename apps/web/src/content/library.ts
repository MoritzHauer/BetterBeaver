import { contentIdOf } from "@betterbeaver/schema";
import { fetchRest } from "./source";

/** One Library browse card (plan 0015 decision 2/7a) — live metadata, not the downloaded content. */
export interface LibraryBook {
  id: string;
  title: string;
  description: string;
  icon?: string;
  domainId: string;
  upvotes: number;
  downvotes: number;
}

interface CatalogTopicRow {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  domainId: string;
}

interface VoteCountsRow {
  doc_id: string;
  upvotes: number;
  downvotes: number;
}

const CATALOG_SELECT =
  "id,title:published->topic->>title,description:published->topic->>description,icon:published->topic->>icon,domainId:published->topic->>domainId";

/**
 * Two parallel requests (plan 0015 decision 2): the catalog for card
 * metadata, and `vote_counts` (migration `20260721000000_vote_counts.sql`)
 * for the rating. `vote_counts` isn't applied on every backend yet — a
 * failure there degrades to cards without ratings rather than failing the
 * whole browse; a catalog failure still rejects (surfaced by the screen's
 * inline error + retry).
 */
export async function fetchLibrary(): Promise<LibraryBook[]> {
  const [catalogRows, voteRows] = await Promise.all([
    fetchRest("catalog", CATALOG_SELECT, "&kind=eq.topic") as Promise<
      CatalogTopicRow[]
    >,
    (
      fetchRest("vote_counts", "doc_id,upvotes,downvotes") as Promise<
        VoteCountsRow[]
      >
    ).catch(() => [] as VoteCountsRow[]),
  ]);

  const votesByBookId = new Map(
    voteRows.map((row) => [
      contentIdOf(row.doc_id),
      { upvotes: row.upvotes, downvotes: row.downvotes },
    ]),
  );

  return catalogRows.map((row) => {
    const id = contentIdOf(row.id);
    const votes = votesByBookId.get(id) ?? { upvotes: 0, downvotes: 0 };
    return {
      id,
      title: row.title,
      description: row.description,
      icon: row.icon ?? undefined,
      domainId: row.domainId,
      upvotes: votes.upvotes,
      downvotes: votes.downvotes,
    };
  });
}
