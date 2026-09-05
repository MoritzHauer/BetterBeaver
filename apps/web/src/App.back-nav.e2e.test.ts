import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

/**
 * Hardware back, in a real browser.
 *
 * `App.back-nav.test.tsx` asserts the same walk under jsdom, and it passed
 * for attempts 1-5 while the app was black on the phone. jsdom cannot see
 * this bug class: it has one window it never leaves, so "back took the
 * document away" — the actual reported symptom — is unrepresentable there.
 * A real Chromium can leave the page, so here that is the assertion.
 *
 * ponytail: desktop Chromium only, and the boundary was measured, not
 * assumed. Mutating `history-nav.ts` back to the attempt-1-5 shape
 * (`pushState` instead of assigning `location.hash`) leaves this file
 * GREEN — so it does not guard the fix that actually matters. Two reasons,
 * both structural: Playwright's `goBack()` is CDP
 * `Page.navigateToHistoryEntry`, a programmatic traversal the
 * back-trapping intervention explicitly exempts; and `Alt+ArrowLeft`, the
 * user-initiated press that would be subject to it, is inert in headless
 * Chromium because there is no browser UI to receive it.
 *
 * What this file does buy, in a real browser on every `pnpm check`: the app
 * boots and paints, navigation writes the URL, back restores the screen from
 * it, deep links resolve, and the document is still the app's afterwards.
 *
 * It does NOT cover attempt 4 either, and that was measured too: stripping
 * `openContentDb`'s `onblocked` handler and its timeout leaves this file
 * green, because a fresh Chromium profile has no second connection to block
 * on. That case is held by `content/idb.blocked.test.ts`, which stubs the
 * hanging open — the right place for it. What this file cannot buy is the
 * device verdict. That still needs `chrome://inspect` over `adb forward` + CDP,
 * exactly as the ToDo entry says. Do not read a green run here as the
 * phone being fixed.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

let server: ViteDevServer;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  server = await createServer({
    root,
    // Vitest sets NODE_ENV=test, which would otherwise pick the test config.
    mode: "development",
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 5199, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) {
    throw new Error("vite dev server reported no local URL");
  }
  baseUrl = url;

  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** The hash the browser is actually showing, without the `#`. */
const path = (): string => new URL(page.url()).hash.replace(/^#/, "");

describe("hardware back in a real browser", () => {
  it("boots to the cover without hanging", async () => {
    await page.goto(baseUrl);

    // Attempt 4 was a boot that awaited a blocked IndexedDB open forever and
    // rendered nothing. Anything on screen at all falsifies that.
    await page.getByText("Get Started").waitFor({ timeout: 15_000 });
    expect(path()).toBe("/");
  });

  it("walks back up the screens instead of taking the document away", async () => {
    await page.goto(baseUrl);
    await page.getByText("Get Started").click();
    await page.getByText("BetterBeaver").first().waitFor();
    expect(path()).toBe("/books");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    expect(path()).toBe("/settings");

    // `goBack()` resolves to null for a same-document (fragment)
    // navigation whether or not it worked, so the state is the assertion:
    // the screen came back and the document is still the app's.
    await page.goBack();
    await page.getByText("BetterBeaver").first().waitFor();
    expect(path()).toBe("/books");
    expect(page.url().startsWith(baseUrl)).toBe(true);

    await page.goBack();
    await page.getByText("Get Started").waitFor();
    expect(path()).toBe("/");
    expect(page.url().startsWith(baseUrl)).toBe(true);
  });

  it("restores the screen a deep link names", async () => {
    // Free with fragment routes, and the thing that proves the URL is the
    // state rather than a label painted on after the fact.
    await page.goto(`${baseUrl}#/settings`);
    await page.getByRole("heading", { name: "Settings" }).waitFor();
  });
});
