/** Per-device anonymous identity for content feedback (plan 0014). Learners
 * never have an account (design.md), so votes/reports/chat are attributed
 * to a device id + a display name generated on first use — both plain
 * `localStorage` values, never a Supabase Auth identity. */

const DEVICE_ID_KEY = "bb.feedback.deviceId";
const DISPLAY_NAME_KEY = "bb.feedback.displayName";

function randomName(): string {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `AnonymBeaver${suffix}`;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id === null) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  let name = localStorage.getItem(DISPLAY_NAME_KEY);
  if (name === null) {
    name = randomName();
    localStorage.setItem(DISPLAY_NAME_KEY, name);
  }
  return name;
}

export function setDisplayName(name: string): void {
  const trimmed = name.trim();
  if (trimmed === "") {
    return;
  }
  localStorage.setItem(DISPLAY_NAME_KEY, trimmed);
}
