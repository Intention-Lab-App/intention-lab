// Score calibration under chance (no effect).
// 1. Exact: each level's goal is its Z for the session's planned bits, so
//    effect/goal = Z / z(level) and the score is a monotone function of Z alone.
//    Under the null Z is standard normal, so score quantiles and P(goal reached
//    by chance) follow directly, the same at every device speed and length.
// 2. Pipeline: unbiased simulated bytes through the real Capture engine with a
//    virtual clock and the XOR mask, at a fast and a slow device speed, stored
//    results and stored scores, to check the exact table.
// Usage: node tests/score-calibration.mjs [pipelineSessionsPerSpeed]
import { writeFile, mkdir } from "node:fs/promises";
import { Capture } from "../app/js/core/capture.js";
import { Simulator } from "../app/js/core/simulation.js";
import { schedule, DIFFICULTIES, GAMES, VERSION, STATS, POLICY, XOR_MASK, XOR_TEMPLATE, goalFor } from "../app/js/core/protocol.js";
import { normalTail, normalQuantile, Random } from "../app/js/core/statistics.js";
import { rawScore, scoreValue, weightFor, sessionScore, SCORE_VERSION, SCORE_PARAMETERS } from "../app/js/core/score.js";

const runs = Number(process.argv[2] ?? 400),
  speeds = [403200, 16000],
  games = GAMES,
  quantiles = [0.75, 0.9, 0.95, 0.99];

// Exact table -------------------------------------------------------------
const exact = DIFFICULTIES.map((level) => {
  const row = { level: level.label, oneIn: level.oneIn, z: level.z, goalByChance: normalTail(level.z) };
  for (const game of games) {
    const w = weightFor(game),
      at = (z) => scoreValue(z / level.z, z, w);
    row[game] = {
      median: 0,
      ...Object.fromEntries(quantiles.map((q) => ["p" + Math.round(q * 100), at(normalQuantile(q))])),
      // P(score >= s) = P(Z >= z_s); find z_s by bisection on the monotone map.
      atLeast50: tail(level.z, w, 50),
      atLeast80: tail(level.z, w, 80),
    };
  }
  return row;
});
function tail(zLevel, w, s) {
  let lo = 0,
    hi = 40;
  if (rawScore(hi / zLevel, hi, w) < s) return 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (rawScore(mid / zLevel, mid, w) >= s - 0.5) hi = mid;
    else lo = mid;
  }
  return normalTail(hi);
}

// Pipeline check ------------------------------------------------------------
function session(minutes, upFirst, game, bitsPerSecond) {
  return {
    id: crypto.randomUUID(),
    state: "Preparing",
    createdUtc: new Date().toISOString(),
    originMonotonic: 0,
    originUtcMs: Date.now(),
    upFirst,
    isReference: false,
    config: {
      game,
      durationMinutes: minutes,
      source: "Simulation",
      xorMask: XOR_TEMPLATE,
      bitsPerSecond,
      difficulty: goalFor(DIFFICULTIES[1], bitsPerSecond, minutes),
      protocolVersion: VERSION,
      statisticsVersion: STATS,
      acquisition: POLICY,
      reference: null,
    },
    phases: schedule(minutes, upFirst),
    qualityReasons: [],
    feedbackInterrupted: false,
    uiInterruptions: "0",
    boundaryExcludedBytes: "0",
    captureGaps: "0",
    flushedBytes: "0",
    notes: "",
    tags: [],
  };
}
const labels = new Random(20261010),
  seeds = new Random(777),
  pipeline = [];
for (const bitsPerSecond of speeds) {
  if (!runs) break;
  const minutes = 1,
    bytesPerSecond = bitsPerSecond / 8,
    step = 0.125,
    perChunk = Math.round(bytesPerSecond * step),
    collected = [],
    started = Date.now();
  for (let k = 0; k < runs; k++) {
    const s = session(minutes, labels.next() % 2 === 0, GAMES[k % GAMES.length], bitsPerSecond),
      c = new Capture(s),
      sim = new Simulator({
        scenario: "Unbiased",
        seed: seeds.next() >>> 1,
        bytesPerSecond,
        commonBias: 0,
        intentionShift: 0,
        driftPerMinute: 0,
        failureAfterSeconds: 1e9,
      }),
      end = s.phases.at(-1).end;
    let seq = 0;
    for (let t = step; t <= end + step; t += step) {
      const inPhase = s.phases.some((p) => t - step >= p.start && t < p.end);
      c.ingest({
        sequence: String(++seq),
        start: t - step + 1e-6,
        end: t,
        bytes: inPhase ? sim.bytes(perChunk, null, t, XOR_MASK) : new Uint8Array(perChunk),
        flags: 0,
      });
      c.completedBuckets.length = 0;
      c.events.length = 0;
    }
    if (s.state !== "Completed") throw Error("Pipeline session did not complete: " + s.failureReason);
    const goals = DIFFICULTIES.map((level) => goalFor(level, bitsPerSecond, minutes));
    collected.push({
      game: s.config.game,
      z: s.result.z,
      difference: s.result.difference,
      stored: s.score.value,
      scores: Object.fromEntries(
        goals.map((goal) => [goal.label, sessionScore({ ...s, score: null, config: { ...s.config, difficulty: goal } }).value]),
      ),
      reached: Object.fromEntries(goals.map((goal) => [goal.label, s.result.difference >= goal.deltaGoal])),
    });
  }
  const summary = [];
  for (const game of games) {
    const rows = collected.filter((r) => r.game === game);
    for (const level of DIFFICULTIES) {
      const values = rows.map((r) => r.scores[level.label]).sort((a, b) => a - b),
        q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
      summary.push({
        game,
        level: level.label,
        sessions: values.length,
        zeroShare: values.filter((v) => v === 0).length / values.length,
        p75: q(0.75),
        p90: q(0.9),
        goalByChance: rows.filter((r) => r.reached[level.label]).length / rows.length,
      });
    }
  }
  const zs = collected.map((r) => r.z),
    meanZ = zs.reduce((a, b) => a + b, 0) / zs.length,
    sdZ = Math.sqrt(zs.reduce((a, b) => a + (b - meanZ) ** 2, 0) / (zs.length - 1));
  pipeline.push({ bitsPerSecond, minutes, sessions: runs, seconds: (Date.now() - started) / 1000, meanZ, sdZ, summary });
  console.error(`pipeline ${bitsPerSecond} bits/s: ${runs} sessions in ${((Date.now() - started) / 1000).toFixed(0)} s, Z mean ${meanZ.toFixed(3)} sd ${sdZ.toFixed(3)}`);
}

const result = {
  method:
    "Exact: Z ~ N(0,1) under no effect and effect/goal = Z / z(level), so score quantiles follow from the monotone score map at any device speed and length. Pipeline: unbiased simulated bytes through Capture with the XOR mask and a virtual clock at two device speeds; stored scores re-evaluated at every level from the same counts.",
  scoreVersion: SCORE_VERSION,
  parameters: SCORE_PARAMETERS,
  exact,
  pipeline,
};
await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });
await writeFile(new URL("../test-results/score-calibration.json", import.meta.url), JSON.stringify(result, null, 2));

// The calibration as a Markdown table
const pct = (x) => (x < 0.0005 ? "<0.1%" : (100 * x).toFixed(x < 0.01 ? 1 : 0) + "%");
let md = `| Level | Goal reached by chance | Bulb 75th / 90th / 99th | Bulb P(score>=80) | Bar 75th / 90th / 99th | Bar P(score>=80) |\n|---|---:|---|---:|---|---:|\n`;
for (const r of exact)
  md += `| ${r.level} | 1 in ${r.oneIn.toLocaleString("en-US")} | ${r.Bulb.p75} / ${r.Bulb.p90} / ${r.Bulb.p99} | ${pct(r.Bulb.atLeast80)} | ${r.Bar.p75} / ${r.Bar.p90} / ${r.Bar.p99} | ${pct(r.Bar.atLeast80)} |\n`;
console.log(md);
for (const p of pipeline) {
  console.log(`\nPipeline, ${p.bitsPerSecond.toLocaleString("en-US")} bits per second, ${p.minutes} min each way, ${p.sessions} unbiased sessions (Z mean ${p.meanZ.toFixed(3)}, SD ${p.sdZ.toFixed(3)}):`);
  console.log(`| Game | Level | Score 0 | 75th | 90th | Goal reached |\n|---|---|---:|---:|---:|---:|`);
  for (const s of p.summary)
    console.log(`| ${s.game} | ${s.level} | ${pct(s.zeroShare)} | ${s.p75} | ${s.p90} | ${pct(s.goalByChance)} |`);
}
