import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { playCorrect, playFanfare, playWrong, SOUND_KEY } from "./sounds";
import { SpeakerButton } from "./tts";

/**
 * The mute fix is an ordering guarantee: the page's audio session must read
 * "ambient" by the time any sound starts, or iOS has already picked its
 * category. jsdom has no audio at all, so each audio constructor records the
 * session type it saw — the assertion is on that, not on anything audible.
 */
let session: { type: string } | undefined;
let typesSeen: (string | undefined)[];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  constructor() {
    typesSeen.push(session?.type);
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: () => undefined },
      connect: (node: unknown) => node,
      start: () => typesSeen.push(session?.type),
      stop: () => undefined,
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: (node: unknown) => node,
    };
  }
}

class FakeAudio {
  constructor(public src: string) {}
  play() {
    typesSeen.push(session?.type);
    return Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
  typesSeen = [];
  session = { type: "auto" };
  Object.defineProperty(navigator, "audioSession", {
    configurable: true,
    get: () => session,
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "audioSession");
});

describe("audio session", () => {
  it("is ambient before any feedback tone starts", () => {
    playCorrect();
    playWrong();
    playFanfare();
    expect(typesSeen.length).toBeGreaterThan(0);
    expect(typesSeen.every((type) => type === "ambient")).toBe(true);
  });

  it("is ambient before the speaker button plays its asset", () => {
    render(<SpeakerButton text="дом" assetUrl="dom.mp3" />);
    fireEvent.click(screen.getByRole("button", { name: "Play дом" }));
    expect(typesSeen).toEqual(["ambient"]);
  });

  it("leaves the Settings toggle in charge: off plays nothing", () => {
    localStorage.setItem(SOUND_KEY, "off");
    playCorrect();
    expect(typesSeen).toEqual([]);
  });

  it("still plays where the browser has no audioSession", () => {
    session = undefined;
    playWrong();
    expect(typesSeen.length).toBeGreaterThan(0);
  });
});
