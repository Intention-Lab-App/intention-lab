import * as db from "./core/database.js";
import {
  DIFFICULTIES,
  DURATIONS,
  GAMES,
  CHALLENGE_SIZES,
  XOR_TEMPLATE,
  VERSION,
  STATS,
  ENGINE_API,
  goalFor,
  terminal,
} from "./core/protocol.js";
import { select } from "./core/selection.js";
import { preferences, profilesOf, checkProfiles } from "./core/preferences.js";
import { Capture } from "./core/capture.js";
import { Simulator } from "./core/simulation.js";
import { Smoother, live as liveStatistic } from "./core/statistics.js";
import {
  exportData,
  csvExport,
  prepareImport,
  commitImport,
} from "./core/transfer.js";
let engine,
  seq = 0;
const calls = new Map(),
  listeners = new Set();
let latest;
function init() {
  if (engine) return;
  if (!("SharedWorker" in window))
    throw Error(
      "Use a browser with module SharedWorker support, such as current Microsoft Edge, Chrome or Firefox.",
    );
  engine = new SharedWorker(new URL("./engine-worker.js", import.meta.url), {
    type: "module",
    name: "IntentionLab",
  });
  engine.port.start();
  engine.port.onmessage = (e) => {
    const m = e.data;
    if (m.event === "snapshot") {
      latest = m.value;
      listeners.forEach((f) => f(m.value));
    } else if (m.event === "completed") {
      analyze("finalize", {}).catch(console.error);
    } else if (m.event === "error") {
      console.error(m.value);
    } else {
      const p = calls.get(m.id);
      if (p) {
        calls.delete(m.id);
        m.error ? p.reject(Error(m.error)) : p.resolve(m.value);
      }
    }
  };
}
function rpc(command, body = {}, key) {
  init();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    engine.port.postMessage({ id, command, body, key });
  });
}
export function analyze(command, body, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
        new URL("./analytics-worker.js", import.meta.url),
        { type: "module" },
      ),
      id = crypto.randomUUID();
    const stop = () => {
      worker.terminate();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      stop();
      return;
    }
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (e) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data.value);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(Error(e.message));
    };
    worker.postMessage({ id, command, body });
  });
}
// The package version, as reported by the bridge that serves this app.
let appVersion = null;
export async function bootstrap() {
  await db.openDb();
  init();
  appVersion = (await fetch("/bridge/bootstrap").then((r) => r.json()).catch(() => null))?.version ?? null;
  const settings = (await db.get("meta", "settings"))?.value || {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const snapshot = await rpc("state");
  if (snapshot.engineApiVersion !== ENGINE_API) {
    throw Error(
      "Intention Lab has been updated. Finish any running session, close all Intention Lab tabs, then reopen the app.",
    );
  }
  latest = snapshot;
  // Not while a session runs: the pass reads every session.
  if (!snapshot.sessionId || terminal(snapshot)) analyze("finalize", {}).catch(console.error);
  return {
    settings,
    difficulties: DIFFICULTIES,
    protocol: VERSION,
    statistics: STATS,
    version: appVersion,
    dataDirectory: "IndexedDB · " + location.origin,
    storage: "Browser profile (IndexedDB)",
    snapshot,
  };
}
export const query = (filter) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filter))
    if (v !== "" && v != null) q.set(k, String(v));
  return q.toString();
};
export function live(callback) {
  listeners.add(callback);
  if (latest) callback(latest);
  return { close: () => listeners.delete(callback) };
}
export const post = (path, body = {}, key) =>
  request(path, { method: "POST", body, key });
// The profile in use. Every selection of sessions that does not name one is the
// current profile's, so History, Progress, Insights and exports follow it.
const SCOPED = new Set(["/sessions", "/analytics", "/progress", "/challenges"]);
const currentProfile = async () => {
  const settings = (await db.get("meta", "settings"))?.value;
  return profilesOf(settings).current.id;
};
export async function request(path, options = {}) {
  const url = new URL(path, "http://app"),
    route = url.pathname,
    f = Object.fromEntries(url.searchParams),
    b = options.body || {};
  if (!f.profile && SCOPED.has(route)) f.profile = await currentProfile();
  if (route === "/analytics/views" && b.filter && !b.filter.profile) b.filter = { ...b.filter, profile: await currentProfile() };
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (route === "/ports") return rpc("ports");
  if (route === "/connect") return rpc("connect", b);
  if (route === "/disconnect") return rpc("disconnect");
  if (route === "/state") return rpc("state");
  if (route === "/shutdown") return rpc("shutdown");
  if (route === "/sessions/start") return rpc("start", b, options.key);
  if (route === "/references/start") return rpc("reference", b, options.key);
  if (route.endsWith("/abort"))
    return rpc("abort", { sessionId: route.split("/")[2] });
  if (route === "/ui/heartbeat") {
    init();
    engine.port.postMessage({ command: "heartbeat", body: b });
    return {};
  }
  if (route === "/device-types")
    return [
      ...new Set(
        (await db.all("sessions")).map((s) => s.config.deviceType),
      ),
    ]
      .sort()
      .map((id) => ({ id }));
  if (route === "/devices") return db.all("devices");
  if (route.startsWith("/devices/") && route.endsWith("/label")) {
    const d = await db.get("devices", decodeURIComponent(route.split("/")[2]));
    if (!d) throw Error("Device not found");
    d.userLabel = String(b.label || "").slice(0, 100);
    d.userDeviceType =
      String(b.deviceType || "")
        .trim()
        .slice(0, 120) || null;
    await db.bump({ devices: [d] });
    return d;
  }
  if (route === "/settings") {
    if (options.method !== "POST")
      return (
        (await db.get("meta", "settings"))?.value || {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      );
    return navigator.locks.request("intention-preferences", async () => {
      const prior = (await db.get("meta", "settings"))?.value || {};
      const value = {
        ...prior,
        timezone:
          b.timezone ??
          prior.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      new Intl.DateTimeFormat("en", { timeZone: value.timezone });
      if (b.sessionPreferences)
        value.sessionPreferences = preferences(b.sessionPreferences);
      if (b.profiles !== undefined || b.profileId !== undefined) {
        const list = b.profiles ?? profilesOf(prior).list,
          id = b.profileId ?? profilesOf(prior).current.id;
        value.profiles = checkProfiles(list, id);
        value.profileId = id;
      }
      await db.write({ meta: [{ id: "settings", value }] });
      return value;
    });
  }
  if (route === "/sessions") {
    const rows = select(await db.all("sessions"), f).reverse(),
      page = Math.max(1, Number(f.page) || 1),
      size = Math.min(100, Math.max(1, Number(f.pageSize) || 20));
    return {
      total: rows.length,
      items: rows.slice((page - 1) * size, page * size).map(hideLive),
    };
  }
  if (route.startsWith("/sessions/")) {
    const id = decodeURIComponent(route.split("/")[2]),
      s = await db.get("sessions", id);
    if (!s) throw Error("Session not found");
    if (route.endsWith("/notes")) {
      if (!terminal(s)) throw Error("Notes are frozen until the attempt ends");
      if (b.excluded && !String(b.exclusionReason || "").trim())
        throw Error("An exclusion needs a reason");
      const revision = {
        id: crypto.randomUUID(),
        sessionId: id,
        utc: new Date().toISOString(),
        beforeResults: false,
        text: String(b.text || "").slice(0, 4000),
        tags: b.tags.map(String).slice(0, 50),
        excluded: !!b.excluded,
        exclusionReason: b.exclusionReason,
      };
      s.notes = revision.text;
      s.tags = revision.tags;
      s.annotatedExcluded = revision.excluded;
      s.exclusionAnnotation = revision.exclusionReason;
      new Capture(s).decorate();
      await db.bump({
        sessions: [s],
        notes: [revision],
        events: [
          {
            id: crypto.randomUUID(),
            sessionId: id,
            utc: revision.utc,
            offset: s.endMonotonicOffset,
            kind: "Annotation revision",
            detail: JSON.stringify(revision),
          },
        ],
      });
      return s;
    }
    return {
      session: hideLive(s),
      buckets: terminal(s)
        ? (await db.all("buckets", id)).sort((a, b) => a.start - b.start)
        : [],
      events: await db.all("events", id),
      notes: await db.all("notes", id),
    };
  }
  if (route === "/references") {
    const attempts = select(
        await db.all("sessions"),
        Object.keys(f).length ? f : { source: latest?.source || "Hardware" },
        true,
      ),
      ids = new Set(attempts.map((s) => s.id));
    return {
      attempts: attempts.map(hideLive),
      captures: (await db.all("references")).filter(
        (r) => !Object.keys(f).length || ids.has(r.sessionId),
      ),
      scope:
        "Selected source, device, date and status filters apply.",
    };
  }
  // Challenges: a fixed number of sessions of one game, level and length,
  // judged together at the end. One runs at a time for each profile.
  if (route === "/challenges") {
    const mine = (await db.all("challenges"))
      .filter((c) => c.profileId === f.profile)
      .sort((x, y) => y.createdUtc.localeCompare(x.createdUtc));
    if (options.method !== "POST") return mine;
    return navigator.locks.request("intention-records", async () => {
      const old = (await db.all("challenges")).find((c) => c.commandKey === options.key);
      if (old) return old;
      if (
        !options.key ||
        !GAMES.includes(b.game) ||
        !DIFFICULTIES.some((d) => d.id === b.difficultyId) ||
        !DURATIONS.includes(b.durationMinutes) ||
        !CHALLENGE_SIZES.includes(b.sessions) ||
        typeof b.xorMask !== "boolean" ||
        (b.referenceId != null && typeof b.referenceId !== "string")
      )
        throw Error("Invalid challenge");
      if (!latest?.connected) throw Error("Connect a source first");
      if (b.referenceId != null) {
        const ref = await db.get("references", b.referenceId);
        if (!ref || ref.source !== latest.source || ref.deviceId !== latest.deviceId || (ref.settings?.xorMask ?? null) !== (b.xorMask ? XOR_TEMPLATE : null))
          throw Error("The display centre chosen in Settings does not suit this device or mask. Choose Theoretical 50/50 or a matching reference first.");
      }
      if ((await db.all("challenges")).some((c) => c.profileId === f.profile && c.status === "Active"))
        throw Error("Finish or give up the current challenge first");
      const c = {
        id: crypto.randomUUID(),
        commandKey: options.key,
        createdUtc: new Date().toISOString(),
        profileId: f.profile,
        game: b.game,
        difficultyId: b.difficultyId,
        durationMinutes: b.durationMinutes,
        sessions: b.sessions,
        source: latest.source,
        xorMask: b.xorMask,
        referenceId: b.referenceId ?? null,
        sessionIds: [],
        status: "Active",
        endedUtc: null,
        verdict: null,
      };
      await db.bump({ challenges: [c] });
      return c;
    });
  }
  if (route.startsWith("/challenges/") && route.endsWith("/give-up"))
    return navigator.locks.request("intention-records", async () => {
      const c = await db.get("challenges", decodeURIComponent(route.split("/")[2]));
      if (!c) throw Error("Challenge not found");
      if (c.status !== "Active") return c;
      if (c.sessionIds.includes(latest?.sessionId) && !terminal(latest))
        throw Error("Finish the running session first");
      c.status = "Given up";
      c.endedUtc = new Date().toISOString();
      await db.bump({ challenges: [c] });
      return c;
    });
  if (route === "/analytics") return analyze("report", f, options.signal);
  if (route === "/progress") return analyze("progress", f, options.signal);
  if (route === "/analytics/views") return analyze("views", b, options.signal);
  if (route === "/preview") {
    // Unbiased software bytes at the connected (or a typical device's) rate,
    // through the same smoothing and live statistic. Never recorded.
    const level =
        DIFFICULTIES.find((d) => d.id === Number(f.difficulty)) ||
        DIFFICULTIES[1],
      rate = Math.min(
        1000000,
        Math.max(1000, Math.round(Number(f.bytesPerSecond) || 50400)),
      ),
      goal = goalFor(
        level,
        rate * 8,
        DURATIONS.includes(Number(f.minutes)) ? Number(f.minutes) : 1,
      ),
      perBucket = Math.round(rate / 4),
      sim = new Simulator({
        scenario: "Unbiased",
        seed: crypto.getRandomValues(new Uint32Array(1))[0] >>> 1,
        bytesPerSecond: rate,
        commonBias: 0,
        intentionShift: 0,
        driftPerMinute: 0,
        failureAfterSeconds: 999,
      }),
      smooth = new Smoother();
    let bits = 0,
      k = 0;
    return Array.from({ length: Math.min(480, Number(f.frames) || 120) }, () => {
      const bytes = sim.bytes(perBucket, "Up", 0);
      let ones = 0;
      for (const b of bytes) ones += POPCOUNT[b];
      bits += perBucket * 8;
      k += ones;
      const stat = liveStatistic(bits, k, null, goal.deltaGoal);
      return {
        ...smooth.update(ones, perBucket * 8, 0.25, 0.5, level.displayZ),
        zLive: stat.z,
        zGoal: stat.goal,
      };
    });
  }
  throw Error("Unknown app operation: " + route);
}
const POPCOUNT = Uint8Array.from({ length: 256 }, (_, i) => {
  let k = 0;
  for (let b = i; b; b >>= 1) k += b & 1;
  return k;
});
function hideLive(s) {
  if (terminal(s)) return s;
  return {
    ...s,
    phases: s.phases.map((p) => ({
      ...p,
      bits: null,
      ones: null,
      bytes: null,
    })),
    result: null,
    score: null,
  };
}
export async function download(options = {}) {
  const settings = (await db.get("meta", "settings"))?.value || {};
  if (options.filter && !options.filter.profile) options = { ...options, filter: { ...options.filter, profile: profilesOf(settings).current.id } };
  if (options.format === "csv")
    saveFile(await csvExport(options), "intention-lab.csv", "text/csv");
  else
    saveFile(
      JSON.stringify(await exportData({ ...options, appVersion }, settings.timezone)),
      "intention-lab-" + (options.full ? "backup" : "export") + ".json",
      "application/json",
    );
}
export function saveFile(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export { prepareImport };
export async function importData(plan) {
  // Do not hold the storage lock while awaiting the capture actor: a concurrent
  // start may already be waiting for that same lock.
  return navigator.locks.request("intention-records", async () => {
    const checkpoint = await db.get("meta", "capture");
    const s = checkpoint
      ? await db.get("sessions", checkpoint.sessionId)
      : null;
    if (s && !terminal(s))
      throw Error("Finish or stop the capture before importing");
    return commitImport(plan);
  });
}
