import { terminal } from "./protocol.js";
export function calendar(utc, zone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utc));
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k).value)
    .join("-");
}
// Sessions counted with and without the XOR mask are separate data, like the
// device and the simulation: every selection takes one or the other.
export const maskKey = (s) => (s.config.xorMask ? "on" : "off"),
  orderKey = (s) => (s.upFirst ? "UpFirst" : "DownFirst"),
  markerKey = (s) =>
    s.config.presentation.showDifficultyMarker ? "shown" : "hidden",
  motionKey = (s) =>
    s.config.presentation.reducedMotion ? "reduced" : "standard",
  soundKey = (s) => (s.config.presentation.sound ? "on" : "off"),
  // Each profile's sessions are its own, like the device's and the simulation's.
  // Reference captures describe the device, so every profile shares them.
  profileKey = (s) => s.config.profileId || "default";
export function matches(s, f = {}, nested = false) {
  const c = s.config,
    day = calendar(s.createdUtc, f.timezone || "UTC");
  if (c.source !== (f.source || "Hardware")) return false;
  if (maskKey(s) !== (f.mask || "on")) return false;
  if (!s.isReference && profileKey(s) !== (f.profile || "default")) return false;
  if (f.game && c.game !== f.game) return false;
  if (f.difficulty && c.difficulty.id !== Number(f.difficulty)) return false;
  if (f.duration && c.durationMinutes !== Number(f.duration)) return false;
  if ((f.from && day < f.from) || (f.to && day > f.to)) return false;
  if (f.device && c.deviceId !== f.device) return false;
  if (f.deviceType && c.deviceType !== f.deviceType) return false;
  if (f.reference && (c.reference?.id || "theoretical") !== f.reference)
    return false;
  // challenge: "any" for sessions played in a challenge, "none" for the
  // others, or one challenge id.
  if (
    f.challenge &&
    (f.challenge === "any"
      ? !c.challengeId
      : f.challenge === "none"
        ? !!c.challengeId
        : c.challengeId !== f.challenge)
  )
    return false;
  if (f.marker && markerKey(s) !== f.marker) return false;
  if (f.motion && motionKey(s) !== f.motion) return false;
  if (f.sound && soundKey(s) !== f.sound) return false;
  if (f.tag && !s.tags.includes(f.tag)) return false;
  if (f.untagged && s.tags.length) return false;
  if (f.order && orderKey(s) !== f.order) return false;
  if (
    f.status &&
    (f.status === "Incomplete" ? s.state === "Completed" : s.state !== f.status)
  )
    return false;
  if (f.view && !nested && !matches(s, JSON.parse(f.view), true)) return false;
  return true;
}
export const select = (sessions, f = {}, references = false) =>
  sessions
    .filter((s) => !!s.isReference === references && matches(s, f))
    .sort(
      (a, b) =>
        a.createdUtc.localeCompare(b.createdUtc) || a.id.localeCompare(b.id),
    );
export const eligible = (s, f = {}) =>
  terminal(s) &&
  s.state === "Completed" &&
  s.result &&
  !s.failureReason &&
  !s.annotatedExcluded &&
  (!s.feedbackInterrupted ||
    f.includeInterrupted === true ||
    f.includeInterrupted === "true");
