import { Random, signSwap, intentionToTreat } from "../app/js/core/statistics.js";
import { Simulator } from "../app/js/core/simulation.js";
import { popcount } from "../app/js/core/capture.js";
import { DIFFICULTIES, XOR_MASK, goalFor } from "../app/js/core/protocol.js";
import { writeFile, mkdir } from "node:fs/promises";
// Fixed endpoints, entire phase samples retained; independent streams for labels, bits, resampling.
const labels = new Random(13051),
  seeds = new Random(42180),
  experiments = 1000,
  pairs = 8,
  bytes = 3000,
  rows = [];
const wilson = (hits, n) => {
  const p = hits / n,
    z = 1.95996398454005,
    den = 1 + (z * z) / n,
    center = (p + (z * z) / (2 * n)) / den,
    half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n ** 2))) / den;
  return [center - half, center + half];
};
// Up/Down labels are randomized per pair. Each scenario is counted as the bytes
// were sent and, as the app does, after the XOR mask. "Push on the device" is
// the same shift made on the bytes themselves, in step with the directions: an
// artifact, such as something near the device that changes with the instruction.
// "Shift that follows the aim" acts on the counted bits, as an effect would.
const scenarios = [
  ["Unbiased", "Unbiased", false],
  ["Common bias in both phases", "CommonBias", false],
  ["Gradual drift with randomized order", "Drift", false],
  ["Push on the device, in step with the directions", "IntentionShift", false],
  ["Shift of ±.002 that follows the aim", "IntentionShift", true],
];
for (const [name, scenario, followsAim] of scenarios)
  for (const masked of [false, true]) {
    let rejected = 0,
      sum = 0;
    for (let e = 0; e < experiments; e++) {
      const d = [];
      for (let j = 0; j < pairs; j++) {
        const first = labels.next() % 2 === 0,
          s = new Simulator({
            scenario,
            seed: seeds.next(),
            bytesPerSecond: 24000,
            commonBias: 0.01,
            intentionShift: 0.002,
            driftPerMinute: 0.001,
            failureAfterSeconds: 999,
          }),
          make = (kind, t) => s.bytes(bytes, kind, t, followsAim && masked ? XOR_MASK : 0),
          a = popcount(make(first ? "Up" : "Down", 0), masked) / (bytes * 8),
          b = popcount(make(first ? "Down" : "Up", 60), masked) / (bytes * 8);
        d.push(first ? a - b : b - a);
      }
      if (signSwap(d, 93417).p <= 0.05) rejected++;
      sum += d.reduce((a, b) => a + b, 0) / pairs;
    }
    rows.push({
      scenario: name,
      counting: masked ? "XOR mask" : "As sent",
      experiments,
      pairs,
      bytesPerPhase: bytes,
      rejections: rejected,
      proportion: rejected / experiments,
      monteCarloWilson95: wilson(rejected, experiments),
      meanEffectPpm: (sum / experiments) * 1e6,
    });
  }

// Players who stop sessions, under chance. Twelve one-minute-each-way sessions
// per experiment at 403,200 bits per second, counted in 250 ms buckets. Each
// experiment is analysed two ways at alpha .05: completed sessions only (equal
// weights, label swaps on effect/goal) and every started session (the app's
// analysis: sums of excess ones, label swaps on goal-scaled sums).
const players = [],
  rand = new Random(60111),
  gauss = () => {
    const u = (rand.next() + 1) / 4294967297,
      v = (rand.next() + 1) / 4294967297;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },
  perBucket = 100800,
  buckets = 240,
  sessions = 12,
  runs = 1000,
  level = goalFor(DIFFICULTIES[1], 403200, 1);
const strategies = {
  // Never stops: the control.
  "Never stops": () => false,
  // Gives up after the first direction if it went the wrong way.
  "Stops when the first direction went the wrong way": (t) =>
    t.phase === 0 && t.bucket === buckets - 1 && t.yourWay < 0,
  // Gives up whenever the session looks clearly behind, after the first 10 seconds.
  "Stops whenever it is behind": (t) => t.bucket >= 40 && t.yourWay < -1,
  // Tries to lock in a lead: stops as soon as the session looks ahead.
  "Stops as soon as it is ahead": (t) => t.bucket >= 40 && t.yourWay > 1,
  // Both at once: stops when clearly ahead or clearly behind.
  "Stops when clearly ahead or behind": (t) => t.bucket >= 40 && Math.abs(t.yourWay) > 1.5,
};
for (const [strategy, stop] of Object.entries(strategies)) {
  let completedOnly = 0,
    everyStarted = 0,
    ended = 0;
  for (let e = 0; e < runs; e++) {
    const list = [];
    for (let j = 0; j < sessions; j++) {
      const upFirst = labels.next() % 2 === 0,
        counts = { Up: [0, 0], Down: [0, 0] };
      let stopped = false;
      for (let phase = 0; phase < 2 && !stopped; phase++) {
        const kind = (phase === 0) === upFirst ? "Up" : "Down";
        for (let bucket = 0; bucket < buckets; bucket++) {
          counts[kind][0] += perBucket;
          counts[kind][1] += Math.round(perBucket / 2 + Math.sqrt(perBucket / 4) * gauss());
          // How the session looks to the player: the running Z of the direction
          // asked for, then of Up minus Down once both directions have data.
          const [nu, ku] = counts.Up,
            [nd, kd] = counts.Down,
            yourWay =
              nu && nd
                ? (ku / nu - kd / nd) / Math.sqrt(0.25 * (1 / nu + 1 / nd))
                : (kind === "Up" ? 1 : -1) * ((counts[kind][1] - counts[kind][0] / 2) / Math.sqrt(counts[kind][0] / 4));
          if (stop({ phase, bucket, yourWay })) {
            stopped = true;
            break;
          }
        }
      }
      list.push({
        state: stopped ? "Aborted" : "Completed",
        config: { game: "Bulb", difficulty: level },
        phases: ["Up", "Down"].map((kind) => ({ kind, bits: String(counts[kind][0]), ones: String(counts[kind][1]) })),
      });
    }
    const finished = list.filter((s) => s.state === "Completed"),
      ratios = finished.map((s) => (s.phases[0].ones / s.phases[0].bits - s.phases[1].ones / s.phases[1].bits) / level.deltaGoal);
    if (ratios.length && signSwap(ratios, 93417).p <= 0.05) completedOnly++;
    const all = intentionToTreat(list, 93417, 999, "ratio");
    if (all && all.test.p <= 0.05) everyStarted++;
    ended += list.length - finished.length;
  }
  players.push({
    strategy,
    experiments: runs,
    sessionsPerExperiment: sessions,
    endedEarlyShare: ended / (runs * sessions),
    completedOnlyRejections: completedOnly,
    completedOnlyProportion: completedOnly / runs,
    completedOnlyWilson95: wilson(completedOnly, runs),
    everyStartedRejections: everyStarted,
    everyStartedProportion: everyStarted / runs,
    everyStartedWilson95: wilson(everyStarted, runs),
  });
}

await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../test-results/null-experiments.json", import.meta.url),
  JSON.stringify(
    {
      method:
        "Up minus Down; fixed endpoints; independent label, measurement, resampling PRNGs; exact sign swaps; test scenarios only, no hardware assumptions validated",
      rows,
      players,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ rows, players }, null, 2));
