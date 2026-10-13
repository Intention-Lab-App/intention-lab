import * as db from "./database.js";
import { select } from "./selection.js";
import {
  hash,
  STATS,
  VERSION,
  XOR_TEMPLATE,
  GAMES,
  DIFFICULTIES,
  DURATIONS,
  CHALLENGE_SIZES,
  terminal,
} from "./protocol.js";
import { sessionResult } from "./capture.js";
import { sessionScore, SCORE_VERSION } from "./score.js";
import { profilesOf, checkProfiles, profileName } from "./preferences.js";
// The profiles a set of sessions belongs to, with their names, so a backup
// restored elsewhere shows every session under the profile that played it.
const profileOf = (s) => s.config.profileId || "default";
async function profilesFor(sessions) {
  const { list } = profilesOf((await db.get("meta", "settings"))?.value),
    used = new Set(sessions.map(profileOf));
  return list.filter((p) => used.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
}
const isDate = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const number = (v) => v == null || Number.isFinite(v);
// A stored challenge verdict: numbers only, or none.
const validVerdict = (v) =>
  v == null ||
  (typeof v === "object" &&
    ["value", "p", "ratio", "z", "started", "endedEarly", "sessions"].every((k) => number(v[k])) &&
    (v.value == null || (Number.isInteger(v.value) && v.value >= 0 && v.value <= 100)));
const dataStores = [
  "sessions",
  "buckets",
  "events",
  "notes",
  "devices",
  "references",
  "challenges",
  "raw",
  "analyses",
];
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function from64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;
}
export const csvCell = (value, userText = false) => {
  let s = String(value ?? "");
  if (userText && /^[\s]*[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export async function exportData(options = {}, timezone = "UTC") {
  const all = await db.snapshot(),
    sessions = options.full
      ? all.sessions
      : options.sessionId
        ? all.sessions.filter((s) => s.id === options.sessionId)
        : select(all.sessions, options.filter || {});
  if (sessions.some((s) => !terminal(s)))
    throw Error("Finish or stop running attempts before exporting their data");
  const ids = new Set(sessions.map((s) => s.id)),
    records = { sessions };
  for (const name of ["buckets", "events", "notes", "raw"])
    records[name] = all[name].filter((r) => ids.has(r.sessionId));
  records.devices = all.devices.filter(
    (d) => options.full || sessions.some((s) => s.config.deviceId === d.id),
  );
  records.references = all.references.filter(
    (r) =>
      options.full ||
      sessions.some((s) => s.config.reference?.id === r.id) ||
      ids.has(r.sessionId),
  );
  records.challenges = all.challenges.filter(
    (c) => options.full || sessions.some((s) => s.config.challengeId === c.id),
  );
  records.analyses = all.analyses.filter((a) =>
    a.report?.sessionIds?.every((id) => ids.has(id)),
  );
  records.raw = records.raw.map((r) => ({
    ...r,
    bytes: base64(r.bytes),
    encoding: "base64",
  }));
  const payload = {
    format: "IntentionLab",
    schema: 1,
    appVersion: options.appVersion || null,
    createdUtc: new Date().toISOString(),
    timezone: timezone || options.filter?.timezone || "UTC",
    analysisVersion: STATS,
    units: {
      effect: "ones rate during Up minus ones rate during Down, per million bits",
      ones: "1 bits counted after the session's XOR mask (config.xorMask; null means none); rawOnes are the device's own 1 bits",
      percentagePoints: "100 × proportion difference",
      score: "0 to 100, versioned; see score.version",
      time: "seconds; host receipt, not generation",
    },
    filters: options.full ? null : options.filter || null,
    profiles: await profilesFor(sessions),
    dataSources: [...new Set(sessions.map((s) => s.config.source))],
    records,
  };
  return { ...payload, sha256: await hash(JSON.stringify(payload)) };
}
export async function csvExport(options) {
  const all = await db.all("sessions"),
    sessions = options.sessionId
      ? all.filter((s) => s.id === options.sessionId)
      : select(all, options.filter || {});
  if (sessions.some((s) => !terminal(s)))
    throw Error("Finish the attempt before export");
  const metadata = [
    "# IntentionLab CSV",
    `# analysis=${STATS}`,
    `# timezone=${options.filter?.timezone || "UTC"}`,
    `# filters=${JSON.stringify(options.filter || {})}`,
    `# sources=${[...new Set(sessions.map((s) => s.config.source))].join(",")}`,
  ]
    .map((v) => csvCell(v, true))
    .join("\r\n");
  let rows, headers;
  if (options.buckets) {
    headers = [
      "session_id",
      "phase",
      "sequence",
      "start_seconds",
      "end_seconds",
      "bytes",
      "bits",
      "ones",
      "raw_ones",
      "display_level",
      "reference_z",
    ];
    rows = [];
    for (const s of sessions)
      for (const b of await db.all("buckets", s.id))
        rows.push([
          s.id,
          b.phaseOrdinal,
          b.sequence,
          b.start,
          b.end,
          b.bytes,
          b.bits,
          b.ones,
          b.rawOnes,
          b.level,
          b.zLive,
        ]);
  } else {
    headers = [
      "session_id",
      "utc",
      "source",
      "device_type",
      "device_type_basis",
      "device_id",
      "device_label",
      "provider_id",
      "profile",
      "game",
      "difficulty",
      "minutes_per_phase",
      "order",
      "state",
      "xor_mask",
      "bits_per_second_at_start",
      "up_bits",
      "down_bits",
      "up_raw_ones",
      "down_raw_ones",
      "up_ones_rate",
      "down_ones_rate",
      "effect_per_million",
      "ci_low_ppm",
      "ci_high_ppm",
      "percentage_points",
      "model_z",
      "one_sided_p",
      "difficulty_chance_one_in",
      "difficulty_target_z",
      "difficulty_target_ppm",
      "actual_target_ratio",
      "descriptive_target_met",
      "score",
      "score_version",
      "quality",
      "notes",
      "tags",
      "reference_id",
      "reference_bits",
      "reference_ones",
      "display_z",
      "smoothing_half_life_seconds",
      "raw_recording",
      "challenge_id",
      "timezone",
      "protocol_version",
      "statistics_version",
      "presentation_version",
      "bar_difficulty_marker",
      "reduced_motion",
      "sound",
      "config_sha256",
    ];
    rows = sessions.map((s) => {
      const r = s.result,
        bits = (kind) => s.phases.find((p) => p.kind === kind)?.bits,
        rawOnes = (kind) => s.phases.find((p) => p.kind === kind)?.rawOnes;
      return [
        s.id,
        s.createdUtc,
        s.config.source,
        s.config.deviceType,
        s.config.deviceTypeBasis,
        s.config.deviceId,
        s.config.deviceLabel,
        s.config.providerId,
        s.config.profileId || "default",
        s.config.game,
        s.config.difficulty.label,
        s.config.durationMinutes,
        s.upFirst ? "UpFirst" : "DownFirst",
        s.state,
        s.config.xorMask || "none",
        s.config.bitsPerSecond,
        bits("Up"),
        bits("Down"),
        rawOnes("Up"),
        rawOnes("Down"),
        r?.upRate,
        r?.downRate,
        r?.effectPpm,
        r?.ciLowPpm,
        r?.ciHighPpm,
        r?.percentagePoints,
        r?.z,
        r?.pText,
        s.config.difficulty.oneIn,
        s.config.difficulty.z,
        s.config.difficulty.goalPpm,
        s.targetRatio,
        s.targetMet,
        s.score?.value ?? "",
        s.score?.version ?? "",
        s.qualityReasons.join("; "),
        s.notes,
        s.tags.join(", "),
        s.config.reference?.id || "theoretical",
        s.config.reference?.bits,
        s.config.reference?.ones,
        s.config.difficulty.displayZ,
        s.config.smoothingHalfLife,
        s.config.recordRaw,
        s.config.challengeId,
        s.config.timezone,
        s.config.protocolVersion,
        s.config.statisticsVersion,
        s.config.presentation.version,
        s.config.presentation.showDifficultyMarker,
        s.config.presentation.reducedMotion,
        s.config.presentation.sound === true,
        s.configHash,
      ];
    });
  }
  return (
    "\uFEFF" +
    metadata +
    "\r\n" +
    headers.map((x) => csvCell(x)).join(",") +
    "\r\n" +
    rows
      .map((row) =>
        row
          .map((v) =>
            csvCell(v, typeof v === "string" && !/^-?\d+(\.\d+)?$/.test(v)),
          )
          .join(","),
      )
      .join("\r\n")
  );
}
const checkCount = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d+$/.test(v) ||
    BigInt(v) > 9223372036854775807n
  )
    throw Error("Invalid exact 64-bit count");
  return BigInt(v);
};
export async function prepareImport(text) {
  if (text.length > 512 * 1024 * 1024) throw Error("Import exceeds 512 MiB");
  const data = JSON.parse(text),
    { sha256, ...payload } = data;
  if (data.format !== "IntentionLab" || data.schema !== 1)
    throw Error("Unsupported export format or schema");
  if ((await hash(JSON.stringify(payload))) !== sha256)
    throw Error("Export checksum mismatch; file changed or incomplete");
  if (!data.records || typeof data.records !== "object")
    throw Error("Missing record collections");
  for (const name of dataStores)
    if (!Array.isArray(data.records?.[name]))
      throw Error("Missing record collection: " + name);
  const records = data.records;
  for (const name of dataStores) {
    const ids = new Set();
    for (const r of records[name]) {
      if (
        typeof r.id !== "string" ||
        !r.id ||
        r.id.length > 200 ||
        ids.has(r.id)
      )
        throw Error("Invalid or duplicate record ID");
      ids.add(r.id);
    }
  }
  for (const s of records.sessions) {
    if (!terminal(s)) throw Error("Import cannot resume an unfinished session");
    if (s.config?.protocolVersion !== VERSION)
      throw Error("Unsupported session protocol in this file");
    if (
      !["Hardware", "Simulation"].includes(s.config.source) ||
      !GAMES.includes(s.config.game) ||
      ![XOR_TEMPLATE, null].includes(s.config.xorMask) ||
      !(s.config.bitsPerSecond > 0) ||
      !(s.config.difficulty?.deltaGoal > 0) ||
      !Array.isArray(s.phases) ||
      !Array.isArray(s.tags)
    )
      throw Error("Invalid session configuration");
    if ((await hash(JSON.stringify(s.config))) !== s.configHash)
      throw Error("Frozen configuration checksum mismatch");
    for (const p of s.phases) {
      if (
        checkCount(p.bits) !== checkCount(p.bytes) * 8n ||
        checkCount(p.ones) > BigInt(p.bits) ||
        checkCount(p.rawOnes) > BigInt(p.bits) ||
        (!s.config.xorMask && p.rawOnes !== p.ones)
      )
        throw Error("Invalid phase counts");
    }
    if (!s.isReference && s.state === "Completed") {
      const kinds = s.phases.map((p) => p.kind).sort().join(",");
      if (kinds !== "Down,Up") throw Error("Missing paired phase");
      const expected = sessionResult(s);
      if (
        !expected ||
        !s.result ||
        Math.abs(expected.difference - s.result.difference) > 1e-14
      )
        throw Error("Result does not agree with imported counts");
      for (const field of [
        "upRate",
        "downRate",
        "effectPpm",
        "percentagePoints",
        "z",
        "pOneSided",
        "ciLowPpm",
        "ciHighPpm",
      ]) {
        const a = expected[field],
          b = s.result[field];
        if (
          a === null
            ? b !== null
            : !Number.isFinite(b) ||
              Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))
        )
          throw Error("Imported statistical result mismatch: " + field);
      }
      const check = sessionScore({ ...s, score: null });
      if (
        (check?.value ?? null) !== (s.score?.value ?? null) ||
        (s.score && s.score.version !== SCORE_VERSION)
      )
        throw Error("Imported score does not agree with its counts");
    } else if (s.score != null) throw Error("Only completed sessions have scores");
  }
  const ids = new Set(records.sessions.map((s) => s.id));
  for (const r of records.references) {
    if (
      r.version !== VERSION ||
      !["Hardware", "Simulation"].includes(r.source) ||
      checkCount(r.bits) === 0n ||
      checkCount(r.ones) > BigInt(r.bits)
    )
      throw Error("Invalid reference counts or source");
    const s = records.sessions.find((s) => s.id === r.sessionId);
    if (
      s &&
      (!s.isReference ||
        s.state !== "Completed" ||
        s.phases[0].bits !== r.bits ||
        s.phases[0].ones !== r.ones)
    )
      throw Error("Reference does not agree with captured counts");
  }
  for (const c of records.challenges) {
    if (
      !["Active", "Complete", "Given up"].includes(c.status) ||
      !/^[a-z0-9-]{1,40}$/.test(c.profileId ?? "") ||
      !GAMES.includes(c.game) ||
      !DIFFICULTIES.some((d) => d.id === c.difficultyId) ||
      !DURATIONS.includes(c.durationMinutes) ||
      !CHALLENGE_SIZES.includes(c.sessions) ||
      !["Hardware", "Simulation"].includes(c.source) ||
      typeof c.xorMask !== "boolean" ||
      !Array.isArray(c.sessionIds) ||
      new Set(c.sessionIds).size !== c.sessionIds.length ||
      c.sessionIds.length > c.sessions ||
      !isDate(c.createdUtc) ||
      (c.endedUtc != null && !isDate(c.endedUtc)) ||
      !validVerdict(c.verdict)
    )
      throw Error("Invalid challenge");
    for (const id of c.sessionIds) {
      const s = records.sessions.find((s) => s.id === id);
      if (s && s.config.challengeId !== c.id)
        throw Error("Challenge session mismatch");
    }
  }
  for (const name of ["buckets", "events", "notes", "raw"])
    for (const r of records[name])
      if (!ids.has(r.sessionId)) throw Error("Orphan " + name + " record");
  for (const b of records.buckets)
    if (
      checkCount(b.bits) !== checkCount(b.bytes) * 8n ||
      checkCount(b.ones) > BigInt(b.bits) ||
      checkCount(b.rawOnes) > BigInt(b.bits)
    )
      throw Error("Invalid bucket counts");
  for (const s of records.sessions)
    for (const p of s.phases) {
      const buckets = records.buckets.filter(
        (b) => b.sessionId === s.id && b.phaseOrdinal === p.ordinal,
      );
      for (const key of ["bits", "bytes", "ones", "rawOnes"])
        if (buckets.reduce((n, b) => n + BigInt(b[key]), 0n) !== BigInt(p[key]))
          throw Error("Phase totals do not match exported buckets");
    }
  for (const r of records.raw) {
    if (r.encoding !== "base64") throw Error("Unsupported raw encoding");
    r.bytes = from64(r.bytes);
    delete r.encoding;
    if (r.bytes.byteLength !== r.length || (await hash(r.bytes)) !== r.sha256)
      throw Error("Raw output checksum/length mismatch");
  }
  const plan = {
    records,
    add: {},
    duplicates: 0,
    conflicts: [],
    sessions: records.sessions.length,
    checksum: sha256,
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
  };
  for (const name of dataStores) {
    const existing = new Map((await db.all(name)).map((r) => [r.id, r]));
    plan.add[name] = [];
    for (const r of records[name]) {
      const old = existing.get(r.id);
      if (!old) plan.add[name].push(r);
      else if (JSON.stringify(old) === JSON.stringify(r)) plan.duplicates++;
      // An earlier copy of a challenge that has since gone on is not a conflict.
      else if (name === "challenges" && old.createdUtc === r.createdUtc && r.sessionIds.every((id, i) => old.sessionIds[i] === id))
        plan.duplicates++;
      else plan.conflicts.push(`${name}: ${r.id}`);
    }
  }
  return plan;
}
export async function commitImport(plan) {
  if (plan.conflicts.length)
    throw Error(
      "Import contains conflicting IDs. Existing records will not be overwritten.",
    );
  for (const [name, rows] of Object.entries(plan.add))
    for (const r of rows)
      if (await db.get(name, r.id))
        throw Error("Data changed after preview. Preview the import again.");
  const records = structuredClone(plan.add),
    available = new Set([
      ...(await db.all("sessions")).map((s) => s.id),
      ...records.sessions.map((s) => s.id),
    ]);
  // One challenge runs at a time for each profile. An imported one that would
  // be a second, or that is missing some of its sessions, is kept as given up.
  const running = new Set((await db.all("challenges")).filter((c) => c.status === "Active").map((c) => c.profileId));
  for (const c of records.challenges)
    if (c.status === "Active") {
      if (running.has(c.profileId) || c.sessionIds.some((id) => !available.has(id))) {
        c.status = "Given up";
        c.endedUtc = new Date().toISOString();
      } else running.add(c.profileId);
    }
  await db.bump(records);
  const meta = (await db.get("meta", "settings"))?.value || {},
    { list, current } = profilesOf(meta),
    known = new Set(list.map((p) => p.id)),
    added = [];
  for (const id of new Set(records.sessions.map(profileOf)))
    if (!known.has(id)) {
      const named = plan.profiles?.find((p) => p?.id === id);
      added.push({ id, name: profileName(named?.name) || "Imported profile", choices: {} });
      known.add(id);
    }
  if (added.length) {
    const value = { ...meta, profiles: checkProfiles([...list, ...added], current.id), profileId: current.id };
    await db.write({ meta: [{ id: "settings", value }] });
  }
  return { added: records.sessions.length, duplicates: plan.duplicates, profiles: added.length };
}
