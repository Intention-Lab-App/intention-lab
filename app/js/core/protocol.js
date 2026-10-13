// Every session measures two intention directions. Up asks for more 1 bits,
// Down asks for more 0 bits. Equal phases, random order.
// ENGINE_API changes whenever the capture engine accepts or answers anything
// differently, such as a new game. Every tab shares one engine, so a page from
// a newer version refuses one still running an older version and asks for
// every Intention Lab tab to be closed.
export const VERSION = "updown-v2",
  STATS = "updown-stats-v1",
  ENGINE_API = 6,
  DURATIONS = [1, 5, 10, 20];
// The games: the Bulb shows the last few seconds, the Bar the whole part so
// far, and the Box nothing until the session ends. All three measure the same.
export const GAMES = Object.freeze(["Bulb", "Bar", "Box"]);
// How many sessions a challenge can hold.
export const CHALLENGE_SIZES = Object.freeze([5, 10, 20]);
// A challenge's short name, such as "10 × Bulb, Easy, 1 min, from 2026-10-03".
export const challengeName = (c) =>
  `${c.sessions} × ${c.game}, ${DIFFICULTIES.find((d) => d.id === c.difficultyId)?.label}, ${c.durationMinutes} min, from ${c.createdUtc.slice(0, 10)}`;
// The standard alternating template (0101…), applied to every byte before
// counting. A device that leans towards 1s or 0s then cannot tilt the counts
// or the display. The device's own 1s are counted too, as a health check.
export const XOR_MASK = 0x55,
  XOR_TEMPLATE = "0x55";
// A level is defined by how often chance alone reaches its goal in a session,
// so it means the same on any device and at any length. z is that one-sided
// threshold for the Up-minus-Down result. displayZ sets the bulb: it reaches
// 80% brightness when the last few seconds sit displayZ standard errors from
// the centre (0.41 z keeps Balanced as lively as before at 400,000 bits/s).
export const DIFFICULTIES = Object.freeze(
  [
    ["Easy", 5, 0.8416212335729143],
    ["Balanced", 20, 1.6448536269514722],
    ["Strict", 100, 2.3263478740408408],
    ["Advanced", 1000, 3.090232306167813],
    ["Expert", 10000, 3.719016485455709],
  ].map(([label, oneIn, z], i) =>
    Object.freeze({ id: i + 1, label, oneIn, z, displayZ: Number((0.41 * z).toFixed(2)) }),
  ),
);
// The goal in ones-rate units for one session, frozen at its start: the level's
// z times the standard error of Up minus Down with the planned bits per
// direction, from the device's measured speed.
export function goalFor(level, bitsPerSecond, minutes) {
  const bitsPerPhase = bitsPerSecond * minutes * 60,
    deltaGoal = level.z * Math.sqrt(0.5 / bitsPerPhase);
  return { ...level, bitsPerSecond, bitsPerPhase, deltaGoal, goalPpm: deltaGoal * 1e6 };
}
export const POLICY = Object.freeze({
  bucketSeconds: 0.25,
  preparationSeconds: 2,
  countdownSeconds: 5,
  transitionSeconds: 15,
  maximumGapSeconds: 2,
  maximumClockDiscrepancySeconds: 2,
  feedbackGapSeconds: 3,
  bridgeOutageSeconds: 5,
  bridgeBufferSeconds: 120,
  bridgeBufferBytes: 67108864,
  serialReadTimeoutMs: 100,
  serialSettings: "115200,8N1,DTR,no handshake,binary",
  consumerQueueBytes: 32 * 1024 * 1024,
  persistenceSeconds: 0.25,
  boundaryRule:
    "Accept entire chunks only if read start >= phase start and receipt end < phase end; exclude all overlapping chunks independent of values. Input continuously drained; no queued reads reassigned.",
});
export const terminal = (s) =>
  ["Completed", "Aborted", "Faulted"].includes(s?.state);
export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
export const schedule = (minutes, upFirst, isReference = false) => {
  const start = POLICY.preparationSeconds + POLICY.countdownSeconds,
    n = isReference ? 300 : minutes * 60;
  return (
    isReference ? ["Reference"] : upFirst ? ["Up", "Down"] : ["Down", "Up"]
  ).map((kind, i) => ({
    kind,
    ordinal: i + 1,
    start: start + i * (n + POLICY.transitionSeconds),
    end: start + i * (n + POLICY.transitionSeconds) + n,
    bytes: "0",
    bits: "0",
    ones: "0",
    rawOnes: "0",
    status: "Pending",
    firstReceipt: null,
    lastReceipt: null,
  }));
};
export function stateAt(phases, t) {
  if (t < POLICY.preparationSeconds) return "Preparing";
  if (t < POLICY.preparationSeconds + POLICY.countdownSeconds)
    return "Countdown";
  for (const p of phases)
    if (t >= p.start && t < p.end) return "Phase" + p.ordinal;
  if (t >= phases.at(-1).end) return "Finalizing";
  return "Transition";
}
export async function hash(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function validateSetup(c) {
  if (
    !GAMES.includes(c.game) ||
    !DURATIONS.includes(c.durationMinutes) ||
    !DIFFICULTIES.some((d) => d.id === c.difficultyId)
  )
    throw Error("Invalid game, duration or difficulty.");
  if (c.xorMask != null && typeof c.xorMask !== "boolean")
    throw Error("Invalid XOR mask setting.");
  if (c.profileId != null && !/^[a-z0-9-]{1,40}$/.test(c.profileId))
    throw Error("Invalid profile.");
  new Intl.DateTimeFormat("en", { timeZone: c.timezone });
}
