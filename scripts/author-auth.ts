// Which identity the content scripts act as (tier 1 of the authoring-access
// design, 2026-08-24). Three modes, in precedence order:
//
//   author   BB_AUTHOR_TOKEN + SUPABASE_ANON_KEY — a signed-in account that
//            is NOT a maintainer. It can read the `catalog` view and insert
//            its own `proposals` rows; RLS blocks everything else, so this
//            is the mode to hand an agent or a second author. Tokens come
//            from `author-token.ts` and last an hour.
//   service  SUPABASE_SERVICE_ROLE_KEY — bypasses RLS entirely. The owner's
//            local mode, for publishing and for unlisted Books.
//   anon     SUPABASE_ANON_KEY alone — the `catalog` view, read-only. Enough
//            to pull a listed Book, not enough to propose.
//
// Author mode takes precedence over the service key on purpose: minting a
// token is a deliberate act, and a shell that happens to carry both should
// act as the weaker identity, not the stronger one.
//
// Runs under plain `node` type stripping — no package imports here.

export type AuthMode = "author" | "service" | "anon";

export interface Backend {
  url: string;
  mode: AuthMode;
  /** PostgREST/auth headers for this identity. */
  headers(extra?: Record<string, string>): Record<string, string>;
  /**
   * The signed-in account's user id — needed for `proposals.author`, which
   * has no default and is checked against `auth.uid()` by RLS. Author mode
   * only; throws in the other two.
   */
  userId(): Promise<string>;
}

/** A 401 from PostgREST is indistinguishable from a policy denial, so an
 * expired token has to be named explicitly or it reads as "no permission". */
const EXPIRED =
  "BB_AUTHOR_TOKEN is not valid (they expire after an hour) — mint a fresh one with scripts/author-token.ts";

export function resolveBackend(): Backend {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("set SUPABASE_URL");
  }
  const token = process.env.BB_AUTHOR_TOKEN;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (token) {
    if (!anon) {
      // PostgREST authenticates the JWT but still requires the project's
      // publishable key in `apikey`; without it the request is rejected
      // before any policy runs.
      throw new Error("BB_AUTHOR_TOKEN needs SUPABASE_ANON_KEY alongside it");
    }
    let cached: string | null = null;
    return {
      url,
      mode: "author",
      headers: (extra = {}) => ({
        apikey: anon,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...extra,
      }),
      userId: async () => {
        if (cached !== null) {
          return cached;
        }
        const response = await fetch(`${url}/auth/v1/user`, {
          headers: { apikey: anon, Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(EXPIRED);
        }
        const user = (await response.json()) as { id?: string; email?: string };
        if (typeof user.id !== "string") {
          throw new Error(EXPIRED);
        }
        console.log(`acting as ${user.email ?? user.id} (proposal-only)`);
        cached = user.id;
        return cached;
      },
    };
  }

  const key = service ?? anon;
  if (!key) {
    throw new Error(
      "set BB_AUTHOR_TOKEN (+ SUPABASE_ANON_KEY), SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY",
    );
  }
  const mode: AuthMode = service ? "service" : "anon";
  return {
    url,
    mode,
    headers: (extra = {}) => ({
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extra,
    }),
    userId: () =>
      Promise.reject(
        new Error(`${mode} mode has no user id — set BB_AUTHOR_TOKEN`),
      ),
  };
}

/**
 * Where a document's published face is readable from, per mode. The
 * `documents` table is maintainer-only (`documents_select`), so anything but
 * the service key reads the `catalog` view — which is listed + published
 * rows only, and exposes exactly the columns both scripts need.
 */
export function publishedFrom(backend: Backend): "documents" | "catalog" {
  return backend.mode === "service" ? "documents" : "catalog";
}

/** `resolveBackend`, but a misconfigured shell exits with the message
 * instead of a stack trace — these are usage errors, not crashes. */
export function resolveBackendOrExit(): Backend {
  try {
    return resolveBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
