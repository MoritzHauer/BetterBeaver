import { Profiler } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initContentSource } from "./content/source";

/**
 * Guards against the App-wide re-render cascade on Topics -> Topic
 * navigation: that tap chains three state updates — App.tsx's topicEpoch
 * bump (sync, shows "Loading…"), the merged content+domain load effect
 * (plan 0013 goal 1: loadTopic and loadDomain/symmetricLinks now resolve
 * via one Promise.all and commit `content`/`domainContent`/
 * `domainTopicsContent` together in a single commit instead of two), and
 * TopicScreen's own post-mount effect (dueUnits + getStreak, unrelated to
 * App.tsx's loads) — each committing the whole App tree.
 * The commit count here is a jsdom proxy for the real-browser count (also
 * 3) — don't tighten the ceiling below what a fresh measurement on this
 * exact path shows, or a real regression will pass silently. Note the
 * ceiling stayed at 3 rather than dropping to 2 after the App.tsx merge:
 * TopicScreen's own effect is the third commit and is out of scope for
 * that merge (see plan 0013 goal 1's follow-up note).
 *
 * This does NOT guard the 60-220ms main-thread long task measured on the
 * production build under throttled CPU for this same navigation: profiling
 * showed React's own render/commit work across all three commits totals
 * ~6ms, and the effects' engine work (symmetricLinks etc.) is sub-1ms on
 * the bundled content — so that cost lives in DOM mount/layout/paint of the
 * freshly-built screen subtree (App.tsx has no stable route shell; every
 * navigation unmounts the old screen and mounts a new one), not in commit
 * count or engine compute. No regression test covers that yet.
 */
describe("App navigation render cost", () => {
  it("commits the App tree a bounded number of times for Topics -> Topic", async () => {
    const contentInit = await initContentSource();
    let commits = 0;
    const { container } = render(
      <Profiler
        id="app"
        onRender={() => {
          commits++;
        }}
      >
        <App contentInit={contentInit} />
      </Profiler>,
    );

    await screen.findByText("Get Started");
    screen.getByText("Get Started").click();

    // A real topic card, not a header icon button (Stats/Settings render
    // first in the DOM but don't exercise the content-loading cascade).
    const topicButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        ".card-list .card button",
      );
      expect(button).not.toBeNull();
      return button!;
    });

    commits = 0;
    topicButton.click();

    // TopicScreen only renders once both loadTopic and loadDomain resolve
    // (App.tsx gates on `content` and `domainContent`), so this back button
    // appearing marks the full cascade having committed.
    await screen.findByRole("button", { name: /Topics/ });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(commits).toBeLessThanOrEqual(3);
  });
});
