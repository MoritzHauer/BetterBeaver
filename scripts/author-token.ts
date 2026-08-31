// Mints a one-hour access token for the proposal-only authoring account
// (tier 1, 2026-08-24) — the owner runs this, with the service key, and
// hands the printed token to whoever is authoring: a second person, another
// machine, or an agent session.
//
// The service key never leaves this machine, and the token that does leave
// it can only do what RLS lets that account do: read the `catalog` view and
// insert its own `proposals` rows. It cannot publish, cannot list, cannot
// see an unlisted document, and it expires by itself.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/author-token.ts
//
// The account is created on first run (`BB_AUTHOR_EMAIL`, default
// `claude-author@betterbeaver.de`). Do NOT add it to `public.maintainers` —
// that is tier 2, and it turns "can suggest" into "can publish".
import { mintTestSession } from "./test-session.ts";

const email = process.env.BB_AUTHOR_EMAIL ?? "claude-author@betterbeaver.de";

/** `exp` out of the JWT payload, as a local time string; "unknown" if the
 * token is not a readable JWT (never a reason to fail — the token is the
 * server's to judge). */
function expiresAt(token: string): string {
  try {
    const payload = token.split(".")[1] ?? "";
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    ) as { exp?: number };
    return claims.exp === undefined
      ? "unknown"
      : new Date(claims.exp * 1000).toLocaleString();
  } catch {
    return "unknown";
  }
}

const session = await mintTestSession("http://localhost:5173/", email);

console.log(`account:  ${session.email}`);
console.log(`expires:  ${expiresAt(session.accessToken)}`);
console.log("\npaste into the authoring shell (never commit either token):\n");
console.log(`export SUPABASE_URL=${process.env.SUPABASE_URL}`);
console.log(
  `export SUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY ?? "<anon key>"}`,
);
console.log(`export BB_AUTHOR_TOKEN=${session.accessToken}`);
console.log(
  `\nor, to stop re-minting every hour, the durable half — one exchange only,\nafter which the rotated token lives in .bb-author.local:\n`,
);
console.log(`export BB_AUTHOR_REFRESH_TOKEN=${session.refreshToken}`);
