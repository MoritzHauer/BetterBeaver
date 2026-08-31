// Which identity the content scripts act as (tier 1 of the authoring-access
// design, 2026-08-24). Three modes, in precedence order:
//
//   author   BB_AUTHOR_TOKEN + SUPABASE_ANON_KEY — a signed-in account that
//            is NOT a maintainer. It can read the `catalog` view and insert
//            its own `proposals` rows; RLS blocks everything else, so this
//            is the mode to hand an agent or a second author. Access tokens
//            die with the project's JWT lifetime (an hour by default), so
//            the durable form of this identity is the account's REFRESH
//            token: with `BB_AUTHOR_REFRESH_TOKEN` set, or a token store on
//            disk, a fresh access token is fetched per run and nothing has
//            to be pasted hourly. See `refreshAccessToken` for the rotation
//            rule — the store file, not the env var, holds the live token.
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

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export type AuthMode = "author" | "service" | "anon";

/**
 * Where the rotating refresh token lives between runs. `*.local` is
 * git-ignored and carries no extension prettier or eslint recognise, so the
 * file can sit in the repo root without reaching any gate.
 */
const TOKEN_STORE =
  process.env.BB_AUTHOR_TOKEN_FILE ??
  new URL("../.bb-author.local", import.meta.url).pathname;

function storedRefreshToken(): string | null {
  if (!existsSync(TOKEN_STORE)) {
    return null;
  }
  try {
    const stored = JSON.parse(readFileSync(TOKEN_STORE, "utf-8")) as {
      refresh_token?: unknown;
    };
    return typeof stored.refresh_token === "string"
      ? stored.refresh_token
      : null;
  } catch {
    // A corrupt store is not fatal: fall through to the env var and let the
    // next successful exchange overwrite the file.
    return null;
  }
}

function storeRefreshToken(token: string): void {
  writeFileSync(TOKEN_STORE, `${JSON.stringify({ refresh_token: token })}\n`);
  try {
    chmodSync(TOKEN_STORE, 0o600);
  } catch {
    // Best effort — a filesystem without POSIX modes is no reason to fail.
  }
}

/**
 * Trades the account's refresh token for a fresh access token.
 *
 * Supabase returns a NEW refresh token on every exchange, and whether the
 * old one stays usable depends on the project's reuse-detection setting — so
 * the exchange is treated as rotating unconditionally and the result is
 * written to the store immediately. That is why the store file, not
 * `BB_AUTHOR_REFRESH_TOKEN`, holds the live copy: a value exported once into
 * a shell (or into a cloud environment's variables) is spent after the first
 * run, and re-using the spent value is what makes a refresh loop look
 * randomly broken.
 */
async function refreshAccessToken(
  url: string,
  anon: string,
  refreshToken: string,
): Promise<string> {
  // A blocked domain and a wrong URL both surface as a bare "fetch failed",
  // which reads as a credential problem when it is a network one — and this
  // is the first request any run makes, so it is where that lands.
  const response = await fetch(
    `${url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  ).catch((cause: unknown) => {
    throw new Error(
      `could not reach ${url} to refresh the author session — check SUPABASE_URL, and whether this environment's network policy allows that host`,
      { cause },
    );
  });
  if (!response.ok) {
    throw new Error(
      `refreshing the author session failed (${response.status}) — the refresh token is spent, revoked, or from another project; mint a new one with scripts/author-token.ts`,
    );
  }
  const session = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (typeof session.access_token !== "string") {
    throw new Error("the refresh exchange returned no access token");
  }
  if (typeof session.refresh_token === "string") {
    storeRefreshToken(session.refresh_token);
  }
  return session.access_token;
}

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

/**
 * Fills `BB_AUTHOR_TOKEN` from a refresh token when no access token is set,
 * so the durable credential on disk is what a run actually needs.
 *
 * The store is tried before `BB_AUTHOR_REFRESH_TOKEN` because it holds the
 * rotated (live) copy; the env var is a bootstrap, and is retried only if
 * the stored token is rejected — which is exactly the "I re-pasted the
 * original after the store went stale" recovery.
 */
async function ensureAuthorToken(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (process.env.BB_AUTHOR_TOKEN || !url || !anon) {
    return;
  }
  const stored = storedRefreshToken();
  const exported = process.env.BB_AUTHOR_REFRESH_TOKEN;
  const candidates = [stored, exported === stored ? null : exported].filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
  for (const [index, refreshToken] of candidates.entries()) {
    try {
      process.env.BB_AUTHOR_TOKEN = await refreshAccessToken(
        url,
        anon,
        refreshToken,
      );
      return;
    } catch (error) {
      if (index === candidates.length - 1) {
        throw error;
      }
    }
  }
}

/** `resolveBackend`, preceded by the refresh exchange, and with a
 * misconfigured shell exiting on the message instead of a stack trace —
 * these are usage errors, not crashes. */
export async function resolveBackendOrExit(): Promise<Backend> {
  try {
    await ensureAuthorToken();
    return resolveBackend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
