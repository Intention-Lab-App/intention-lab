import * as db from "./core/database.js";
import {
  select,
  eligible,
  calendar,
  orderKey,
  markerKey,
  motionKey,
  soundKey,
} from "./core/selection.js";
import { overallScore, SCORE_VERSION, SCORE_PARAMETERS } from "./core/score.js";
import {
  aggregate,
  mean,
  intentionToTreat,
} from "./core/statistics.js";
import {
  STATS,
  GAMES,
  DURATIONS,
  terminal,
  randomSeed,
  hash,
  challengeName,
} from "./core/protocol.js";
// One grouping key per dimension; Tag is handled separately (a session can have several).
function groupKey(dimension, s, day, week) {
  const c = s.config;
  if (dimension === "Reference") return c.reference?.id || "theoretical";
  if (dimension === "Bar needle") return markerKey(s);
  if (dimension === "Challenge") return c.challengeId || "none";
  if (dimension === "Motion") return motionKey(s);
  if (dimension === "Sound") return soundKey(s);
  if (dimension === "Device type") return c.deviceType;
  if (dimension === "Device") return c.deviceId;
  if (dimension === "Day") return day;
  if (dimension === "Month") return day.slice(0, 7);
  if (dimension === "Week") return week.toISOString().slice(0, 10);
  return orderKey(s);
}
// A session counts across sessions once it has measured any bits, however it ended.
const measured = (s) => s.phases.some((p) => Number(p.bits) > 0);
const games = GAMES,
  durations = DURATIONS;
function cell(s, game, duration, difficulty = null) {
  const rows = s.filter(
    (s) =>
      s.config.game === game &&
      s.config.durationMinutes === duration &&
      (!difficulty || s.config.difficulty.id === difficulty),
  );
  return {
    game,
    duration,
    difficulty,
    pairs: rows.length,
    effect: mean(rows.map((s) => s.result.difference)),
  };
}
async function report(filter) {
  const selected = select(await db.all("sessions"), filter).filter(terminal);
  const revision = (await db.get("meta", "revision"))?.value || "empty",
    key = await hash(
      JSON.stringify({
        records: selected,
        filter,
        version: STATS,
        reportVersion: "itt-v2",
      }),
    ),
    cached = await db.get("analyses", key);
  if (cached) return cached.report;
  const pairs = selected.filter((s) => eligible(s, filter)),
    seed = randomSeed(),
    summary = aggregate(pairs, seed),
    matrix = [],
    difficultyBreakdown = [];
  for (const game of games)
    for (const duration of durations) {
      matrix.push(cell(pairs, game, duration));
      for (let d = 1; d <= 5; d++)
        difficultyBreakdown.push(cell(pairs, game, duration, d));
    }
  let lastSignature = null;
  const cumulative = pairs.map((s, i) => {
    const signature = `${s.config.deviceType}, ${s.config.deviceId}, reference ${s.config.reference?.id || "theoretical"}, level ${s.config.difficulty.id}, marker ${markerKey(s)}, motion ${motionKey(s)}, sound ${soundKey(s)}`,
      annotation = signature === lastSignature ? "" : signature;
    lastSignature = signature;
    return {
      sessionId: s.id,
      index: i + 1,
      utc: s.createdUtc,
      effect: mean(pairs.slice(0, i + 1).map((s) => s.result.difference)),
      annotation,
    };
  });
  const groups = [],
    challenges = new Map((await db.all("challenges")).map((c) => [c.id, c]));
  for (const dimension of [
    "Day",
    "Week",
    "Month",
    "Order",
    "Tag",
    "Device type",
    "Device",
    "Reference",
    "Challenge",
    "Bar needle",
    "Motion",
    "Sound",
  ]) {
    const map = new Map();
    for (const s of pairs) {
      const day = calendar(s.createdUtc, filter.timezone || "UTC"),
        date = new Date(day + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const keys =
        dimension === "Tag"
          ? s.tags.length
            ? s.tags
            : [""]
          : [groupKey(dimension, s, day, date)];
      for (const key of keys) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
      }
    }
    for (const [key, rows] of map)
      groups.push({
        dimension,
        key,
        label:
          dimension === "Challenge"
            ? key === "none"
              ? "Not in a challenge"
              : challenges.has(key)
                ? challengeName(challenges.get(key))
                : key
            : null,
        sessionIds: rows.map((s) => s.id),
        pairs: rows.length,
        effect: mean(rows.map((s) => s.result.difference)),
      });
  }
  const quality = [];
  for (const s of selected) {
    const buckets = await db.all("buckets", s.id);
    for (const p of s.phases) {
      const bs = buckets.filter((b) => b.phaseOrdinal === p.ordinal),
        avg = (k) => {
          const values = bs.map((b) => b[k]).filter((v) => v != null);
          return values.length
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null;
        },
        seconds = Math.max(
          0,
          Math.min(p.end, s.endMonotonicOffset ?? p.start) - p.start,
        );
      quality.push({
        sessionId: s.id,
        phase: p.kind,
        bits: p.bits,
        deviceOnesRate: Number(p.bits) ? Number(p.rawOnes) / Number(p.bits) : null,
        measuredSeconds: seconds,
        bitsPerSecond: seconds ? Number(p.bits) / seconds : 0,
        boundaryExcludedBytes: s.boundaryExcludedBytes,
        flushedBytes: s.flushedBytes,
        captureGaps: s.captureGaps,
        uiInterruptions: s.uiInterruptions,
        meanBlockVariance: avg("blockVariance"),
        meanLagOneCorrelation: avg("lagOneCorrelation"),
        diagnosticBlocks: bs
          .reduce((n, b) => n + BigInt(b.diagnosticBlocks || 0), 0n)
          .toString(),
        maximumReadGap: Math.max(0, ...bs.map((b) => b.maxReadGap)),
        reasons: s.qualityReasons,
      });
    }
  }
  // The device's own ones rate across every selected bit, before any mask: a
  // check on its lean, which the mask and the Up-minus-Down design cancel.
  const own = selected.reduce(
      (a, s) => {
        for (const p of s.phases) {
          a.bits += Number(p.bits);
          a.ones += Number(p.rawOnes);
        }
        return a;
      },
      { bits: 0, ones: 0 },
    ),
    deviceLean = own.bits
      ? { bits: own.bits, rate: own.ones / own.bits, z: (own.ones - own.bits / 2) / Math.sqrt(own.bits / 4) }
      : null;
  const value = {
    filter,
    analysisVersion: STATS,
    deviceLean,
    dataRevision: revision,
    selected: selected.length,
    includedPairs: pairs.length,
    incomplete: selected.filter((s) => s.state !== "Completed").length,
    excluded:
      selected.filter((s) => s.state === "Completed").length - pairs.length,
    acceptedBits: selected
      .reduce(
        (v, s) => v + s.phases.reduce((n, p) => n + BigInt(p.bits), 0n),
        0n,
      )
      .toString(),
    measuredSeconds: quality.reduce((v, q) => v + q.measuredSeconds, 0),
    summary,
    itt: intentionToTreat(selected.filter(measured), (seed + 104723) >>> 0),
    sessions: selected,
    cumulative,
    matrix,
    difficultyBreakdown,
    groups,
    quality,
    sessionIds: pairs.map((s) => s.id),
    seed,
    analyzedUtc: new Date().toISOString(),
  };
  await db.write({ analyses: [{ id: key, report: value }] });
  return value;
}
// The Progress page: overall and per-game scores computed from the
// aggregate (never by averaging session scores), totals and a score timeline.
async function progress(filter) {
  const f = filter,
    selected = select(await db.all("sessions"), f).filter(terminal),
    revision = (await db.get("meta", "revision"))?.value || "empty",
    key = await hash(
      JSON.stringify({
        ids: selected.map((s) => [s.id, s.state, s.clean]),
        revision,
        f,
        version: SCORE_VERSION,
        kind: "progress-v3",
      }),
    ),
    cached = await db.get("analyses", key);
  if (cached) return cached.report;
  // Every started session counts, however it ended. The seed follows those
  // sessions, so the same data always gives the same overall score, also above
  // 20 sessions where the swap test samples.
  const started = selected.filter(measured),
    seed = parseInt((await hash(started.map((s) => s.id).join(","))).slice(0, 8), 16),
    measuredSeconds = selected.reduce(
      (n, s) =>
        n +
        s.phases.reduce(
          (m, p) =>
            m +
            Math.max(
              0,
              Math.min(p.end, s.endMonotonicOffset ?? p.start) - p.start,
            ),
          0,
        ),
      0,
    );
  const value = {
    kind: "progress",
    scoreVersion: SCORE_VERSION,
    parameters: SCORE_PARAMETERS,
    source: f.source || "Hardware",
    mask: f.mask || "on",
    sessions: selected.filter((s) => s.state === "Completed").length,
    attempts: selected.length,
    started: started.length,
    endedEarly: started.filter((s) => s.state !== "Completed").length,
    measuredSeconds,
    overall: overallScore(started, seed, "All"),
    games: Object.fromEntries(
      games.map((g) => [
        g,
        overallScore(
          started.filter((s) => s.config.game === g),
          (seed + 7919) >>> 0,
          g,
        ),
      ]),
    ),
    timeline: started
      .filter((s) => s.state !== "Completed" || s.score)
      .map((s) => ({
        id: s.id,
        utc: s.createdUtc,
        game: s.config.game,
        level: s.config.difficulty.label,
        minutes: s.config.durationMinutes,
        score: s.score?.value ?? null,
        ended: s.state !== "Completed",
        clean: !!s.clean,
      })),
    seed,
    analyzedUtc: new Date().toISOString(),
  };
  await db.write({ analyses: [{ id: key, report: value }] });
  return value;
}
// A challenge ends when its last session ends. The verdict is the overall score
// of its sessions, every started session counting however it ended, with a
// seed that follows those sessions so the verdict never changes.
async function finalize() {
  const sessions = new Map((await db.all("sessions")).map((s) => [s.id, s]));
  for (const c of await db.all("challenges")) {
    if (c.status !== "Active" || c.sessionIds.length < c.sessions) continue;
    const played = c.sessionIds.map((id) => sessions.get(id));
    if (played.some((s) => !s || !terminal(s))) continue;
    const started = played.filter(measured),
      seed = parseInt((await hash(started.map((s) => s.id).join(","))).slice(0, 8), 16);
    c.status = "Complete";
    c.endedUtc = new Date().toISOString();
    c.verdict = {
      ...overallScore(started, seed, c.game),
      scoreVersion: SCORE_VERSION,
      started: started.length,
      endedEarly: started.filter((s) => s.state !== "Completed").length,
    };
    await db.bump({ challenges: [c] });
  }
}
onmessage = async (e) => {
  const { id, command, body } = e.data;
  try {
    let value;
    if (command === "report") value = await report(body);
    else if (command === "progress") value = await progress(body);
    else if (command === "finalize")
      value = await navigator.locks.request("intention-records", () =>
        finalize(),
      );
    else if (command === "views") {
      const base = await report(body.filter);
      value = body.views.map((v) => {
        const rows = select(base.sessions, {
          ...v.filter,
          source: body.filter.source,
          profile: body.filter.profile,
          timezone: body.filter.timezone,
        }).filter((s) => eligible(s, body.filter));
        return {
          name: v.name,
          filter: v.filter,
          pairs: rows.length,
          effect: mean(rows.map((s) => s.result.difference)),
          status: "Exploratory intersection; groups can overlap",
        };
      });
    } else throw Error("Unknown analysis command");
    postMessage({ id, value });
  } catch (e) {
    postMessage({ id, error: e.message });
  }
};
