import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

/**
 * The next card opens at its top, in a real browser.
 *
 * The bug: at phone height a card is taller than the screen, the learner
 * scrolls down to answer it, and the next card used to open at that same
 * scroll offset — mid-question. jsdom has no layout and never scrolls, so
 * only a real Chromium can show it. Reverting `SessionScreen`'s scroll reset
 * turns this red (measured). The unit Check runs on `SessionScreen` too, so
 * this guards it as well; the exam's own reset is pinned in
 * `ExamScreen.test.tsx`, since the bundled seed has no exam to drive.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));

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
  // Phone-sized, and short enough that a demo MCQ card overflows it.
  page = await browser.newPage({
    viewport: { width: 360, height: 560 },
    isMobile: true,
    hasTouch: true,
  });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const scrollY = (): Promise<number> => page.evaluate(() => window.scrollY);

describe("advancing a session", () => {
  it("opens each next card scrolled to its top", async () => {
    await page.goto(
      `${baseUrl}#/books/demo/lessons/dx-lesson-intro/units/dx-unit-beaver-basics/tasks/dx-task-recognize-basics`,
    );
    await page.locator("ul.card-list button").first().waitFor();

    for (let card = 1; card <= 2; card++) {
      // Without overflow the assertion below would pass vacuously.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(overflow).toBeGreaterThan(100);

      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      expect(await scrollY()).toBeGreaterThan(100);

      await page.locator("ul.card-list button").first().click();
      await page
        .locator(".action-bar.correct, .action-bar.incorrect")
        .waitFor();
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .locator(`[role=progressbar][aria-valuenow="${card}"]`)
        .waitFor();
      await page.locator("ul.card-list button").first().waitFor();

      expect(await scrollY()).toBe(0);
    }
  });
});
