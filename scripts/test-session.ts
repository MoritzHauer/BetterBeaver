// Signs a throwaway author account in without an inbox, so the authoring
// half of the app can be exercised end to end (by hand or by an agent)
// against the real backend.
//
// Sign-in is magic-link only (design.md), and the link normally arrives by
// email. `admin/generate_link` returns the same link instead of sending it,
// so this is the genuine flow — the app's own `detectSessionInUrl` picks the
// session out of the fragment. No dev-only sign-in path exists in the app,
// and none should be added for this.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/test-session.ts [redirect-url]
//
// Prints a one-shot link (open it in a browser and you land signed in) and
// the raw access token (for curling the RPCs as an authenticated author).
// The redirect defaults to the dev server; any origin used here must be in
// the project's Auth → URL Configuration redirect list, or the link silently
// bounces to the site URL instead.
//
// The account is created on first run and owns nothing: give it maintainer
// rights by having it create its own Book in the app, never by granting it
// rows on a real document. To clean up:
//
//   curl -X DELETE "$SUPABASE_URL/auth/v1/admin/users/<user id>" \
//     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//
// (Documents the account created are NOT deleted with it.)
const URL_BASE = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.BB_TEST_EMAIL ?? "claude-test@example.com";

/** The link, plus the token the redirect would hand the app. */
export async function mintTestSession(
  redirectTo = "http://localhost:5173/",
): Promise<{ email: string; actionLink: string; accessToken: string }> {
  if (!URL_BASE || !SERVICE_KEY) {
    throw new Error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  const admin = async (path: string, body: unknown) => {
    const response = await fetch(`${URL_BASE}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, body: (await response.json()) as unknown };
  };

  // Already registered comes back 422; every other failure is real.
  const created = await admin("admin/users", {
    email: EMAIL,
    email_confirm: true,
  });
  if (!created.ok && !JSON.stringify(created.body).includes("already been")) {
    throw new Error(`creating ${EMAIL}: ${JSON.stringify(created.body)}`);
  }

  // `redirect_to` belongs at the top level — nested under `options` it is
  // ignored, and the link comes back pointing at the production site.
  const generateLink = async () => {
    const link = await admin("admin/generate_link", {
      type: "magiclink",
      email: EMAIL,
      redirect_to: redirectTo,
    });
    if (!link.ok) {
      throw new Error(`generate_link: ${JSON.stringify(link.body)}`);
    }
    return (link.body as { action_link: string }).action_link;
  };

  // Following a link consumes it, so this redirect IS a sign-in: the
  // fragment it lands on is what the app would have parsed. Hence two links
  // — one spent here for the token, one left unspent for the browser.
  const landed = await fetch(await generateLink(), { redirect: "manual" });
  const location = landed.headers.get("location") ?? "";
  const accessToken =
    new URLSearchParams(location.split("#")[1] ?? "").get("access_token") ?? "";
  if (accessToken === "") {
    throw new Error(`no session in redirect: ${location}`);
  }
  return { email: EMAIL, actionLink: await generateLink(), accessToken };
}

if (import.meta.filename === process.argv[1]) {
  const session = await mintTestSession(process.argv[2]);
  console.log(`account:      ${session.email}`);
  console.log(`sign-in link: ${session.actionLink}`);
  console.log(`access token: ${session.accessToken}`);
}
