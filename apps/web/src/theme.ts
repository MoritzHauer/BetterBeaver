/**
 * Theme preference (Settings › Appearance). Stored raw under `bb.theme` as
 * "light" | "dark"; "system" is the absence of the key (so it exports/imports
 * cleanly and defaults correctly). The preference resolves to a concrete
 * light/dark and is stamped on `<html>` as `data-theme`, which styles.css
 * keys off. An inline script in index.html applies it before first paint (no
 * theme flash); this module owns runtime changes and the live OS-follow.
 */
export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "bb.theme";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return darkQuery.matches ? "dark" : "light";
  }
  return pref;
}

function apply(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolve(pref);
}

export function setThemePref(pref: ThemePref): void {
  if (pref === "system") {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, pref);
  }
  apply(pref);
}

// Keep "system" in step with the OS while the app is open (the inline boot
// script only runs once, at load).
darkQuery.addEventListener("change", () => {
  if (getThemePref() === "system") {
    apply("system");
  }
});
