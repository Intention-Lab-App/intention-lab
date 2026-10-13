import http from "node:http";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872",
  checks = [];
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext(),
  page = await context.newPage();
page.setDefaultTimeout(10000);
const check = (name, v) => {
  assert.ok(v, name);
  checks.push(name);
  console.log("PASS", name);
};
const api = (path, body, key) =>
  page.evaluate(
    async ({ path, body, key }) => {
      const a = await import("/js/api.js");
      return body === undefined ? a.request(path) : a.post(path, body, key);
    },
    { path, body, key },
  );
const setup = {
  game: "Bulb",
  durationMinutes: 1,
  difficultyId: 2,
  timezone: "UTC",
};
const simulation = {
  scenario: "Unbiased",
  seed: 44,
  bytesPerSecond: 24000,
  commonBias: 0.001,
  intentionShift: 0.00018,
  driftPerMinute: 0.0002,
  failureAfterSeconds: 10,
};
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  await api("/connect", { source: "Simulation", simulation });
  await api("/devices/simulation-xoshiro-v1/label", {
    label: "Bench A",
    deviceType: "Model A (test declaration)",
  });
  const challenge = { game: "Bulb", difficultyId: 2, durationMinutes: 1, sessions: 5, xorMask: true, referenceId: null },
    plan = await api("/challenges", challenge, crypto.randomUUID());
  check("a challenge starts active and empty", plan.status === "Active" && plan.sessionIds.length === 0 && plan.source === "Simulation");
  const refusedSecond = await api("/challenges", challenge, crypto.randomUUID()).then(() => false, () => true);
  check("one active challenge at a time", refusedSecond);
  const key = crypto.randomUUID(),
    s = await api("/sessions/start", { ...setup, challengeId: plan.id }, key),
    again = await api("/sessions/start", { ...setup, challengeId: plan.id }, key);
  check("start idempotency", s.id === again.id);
  check("a challenge session records its challenge", s.config.challengeId === plan.id);
  check(
    "device type frozen with provenance",
    s.config.deviceType === "Model A (test declaration)" &&
      s.config.deviceTypeBasis === "User entered",
  );
  await api("/devices/simulation-xoshiro-v1/label", {
    label: "Bench B",
    deviceType: "Model B (test declaration)",
  });
  check(
    "changing device type does not modify running configuration",
    (await api("/state")).config.deviceType === s.config.deviceType,
  );
  const refusedGiveUp = await api("/challenges/" + plan.id + "/give-up", {}).then(() => false, () => true);
  check("a challenge cannot be given up during its session", refusedGiveUp);
  await api("/sessions/" + s.id + "/abort", {});
  const taken = (await api("/challenges")).find((c) => c.id === plan.id);
  check("a stopped session keeps its slot", taken.sessionIds.length === 1 && taken.sessionIds[0] === s.id);
  const mismatch = await api("/sessions/start", { ...setup, game: "Bar", challengeId: plan.id }, crypto.randomUUID()).then(() => false, () => true);
  check("a challenge refuses another game", mismatch);
  const given = await api("/challenges/" + plan.id + "/give-up", {});
  check("a given-up challenge is kept and marked", given.status === "Given up" && given.endedUtc && (await api("/challenges")).some((c) => c.id === plan.id));
  const afterGiveUp = await api("/sessions/start", { ...setup, challengeId: plan.id }, crypto.randomUUID()).then(() => false, () => true);
  check("no session in a given-up challenge", afterGiveUp);
  const initial = await api(
    "/sessions?source=Simulation&deviceType=" +
      encodeURIComponent(s.config.deviceType),
  );
  check("device type history filter", initial.total === 1);
  const next = await api("/sessions/start", setup, crypto.randomUUID());
  check(
    "new session records new device type",
    next.config.deviceType === "Model B (test declaration)",
  );
  await api("/sessions/" + next.id + "/abort", {});
  // A challenge ends with its last session, every one counting however it ended.
  const full = await api("/challenges", { ...challenge, difficultyId: 1 }, crypto.randomUUID());
  for (let i = 0; i < 5; i++) {
    const x = await api("/sessions/start", { ...setup, difficultyId: 1, challengeId: full.id }, crypto.randomUUID());
    await api("/sessions/" + x.id + "/abort", {});
  }
  const overfull = await api("/sessions/start", { ...setup, difficultyId: 1, challengeId: full.id }, crypto.randomUUID()).then(() => false, () => true);
  check("a full challenge takes no more sessions", overfull);
  await page.evaluate(async () => (await import("/js/api.js")).analyze("finalize", {}));
  const done = (await api("/challenges")).find((c) => c.id === full.id);
  check("a challenge is complete after its last session", done.status === "Complete" && done.verdict && done.sessionIds.length === 5);
  const tagged = await api("/sessions?source=Simulation&challenge=" + full.id);
  check("the challenge filter selects its sessions", tagged.total === 5);
  const outside = await api("/sessions?source=Simulation&challenge=none");
  check("sessions outside a challenge are kept apart", outside.items.every((x) => !x.config.challengeId) && outside.total === 1);
  const data = await page.evaluate(async () => {
    const t = await import("/js/core/transfer.js");
    return t.exportData({ full: true }, "UTC");
  });
  check(
    "exports preserve device type",
    data.records.sessions.every((s) => s.config.deviceType),
  );
  check("backups keep challenges", data.records.challenges.length === 2);
  const forged = await page.evaluate(async (data) => {
    const t = await import("/js/core/transfer.js"),
      p = await import("/js/core/protocol.js");
    data = structuredClone(data);
    data.records.challenges.find((c) => c.verdict).verdict.value = "<img src=x>";
    const { sha256, ...payload } = data;
    data.sha256 = await p.hash(JSON.stringify(payload));
    return t.prepareImport(JSON.stringify(data)).then(() => false, () => true);
  }, data);
  check("an imported challenge verdict must be numbers", forged);
  const tamper = await page.evaluate(async (data) => {
    const t = await import("/js/core/transfer.js");
    data.records.sessions[0].notes += "changed";
    try {
      await t.prepareImport(JSON.stringify(data));
      return false;
    } catch {
      return true;
    }
  }, data);
  check("tampered backup rejected", tamper);
  const conflict = await page.evaluate(async (data) => {
    const t = await import("/js/core/transfer.js"),
      p = await import("/js/core/protocol.js");
    data.records.sessions[0].notes += "new revision";
    const { sha256, ...payload } = data;
    data.sha256 = await p.hash(JSON.stringify(payload));
    return (await t.prepareImport(JSON.stringify(data))).conflicts.length;
  }, data);
  check("conflicting record IDs are not overwritten", conflict > 0);
  await page.evaluate(async () => {
    const db = await import("/js/core/database.js"),
      p = await import("/js/core/protocol.js"),
      { PRESENTATION_VERSION } = await import("/js/core/preferences.js"),
      { Capture } = await import("/js/core/capture.js");
    for (let index = 0; index < 24; index++) {
      const level = p.DIFFICULTIES[index % 5],
        config = {
          ...{
            game: p.GAMES[index % 3],
            durationMinutes: 1,
            source: "Simulation",
            deviceId: "test-device-" + (index % 2),
            deviceType: "Simulated model " + (index % 2),
            deviceTypeBasis: "Test fixture",
            deviceLabel: "Virtual fixture",
            xorMask: p.XOR_TEMPLATE,
            bitsPerSecond: 403200,
            difficulty: p.goalFor(level, 403200, 1),
            smoothingHalfLife: 3,
            protocolVersion: p.VERSION,
            statisticsVersion: p.STATS,
            acquisition: p.POLICY,
            reference: null,
            recordRaw: false,
            presentation: {
              version: PRESENTATION_VERSION,
              showDifficultyMarker: index % 2 === 0,
              reducedMotion: index % 3 === 0,
            },
          },
        };
      const s = {
          id: crypto.randomUUID(),
          state: "Preparing",
          createdUtc: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
          originMonotonic: 0,
          originUtcMs: Date.UTC(2026, 0, index + 1),
          upFirst: index % 2 === 0,
          isReference: false,
          config,
          configHash: await p.hash(JSON.stringify(config)),
          phases: p.schedule(1, index % 2 === 0),
          qualityReasons: [],
          feedbackInterrupted: false,
          uiInterruptions: "0",
          boundaryExcludedBytes: "0",
          captureGaps: "0",
          flushedBytes: "0",
          notes: "Virtual-byte fixture, not a physical capture",
          tags: ["fixture"],
        },
        c = new Capture(s);
      let seq = 0;
      for (let t = 0.125; t <= 142.125; t += 0.125) {
        const phase = s.phases.find((p) => t >= p.start && t < p.end);
        c.ingest({
          sequence: String(++seq),
          start: t - 0.02,
          end: t,
          flags: 0,
          // The counted pattern, sent through the XOR mask the session uses.
          bytes: Uint8Array.of(
            85,
            phase?.kind === "Up" ? (index % 3 === 0 ? 1 : 127) : 85,
          ).map((b) => b ^ p.XOR_MASK),
        });
      }
      await db.bump({
        sessions: [s],
        buckets: c.completedBuckets,
        events: c.events,
      });
    }
  });
  const report = await api(
    "/analytics?source=Simulation&tag=fixture&timezone=UTC",
  );
  check(
    "Monte Carlo and bootstrap stored for 24 pairs",
    report.summary.test.replications === 99999 &&
      report.summary.bootstrap.replications === 9999,
  );
  check(
    "device model breakdown has both types",
    report.groups.filter((g) => g.dimension === "Device type").length === 2,
  );
  check(
    "display-setting analysis groups marker and motion settings",
    report.groups.filter((g) => g.dimension === "Bar needle").length === 2 &&
      report.groups.filter((g) => g.dimension === "Motion").length === 2,
  );
  check(
    "challenge grouping names sessions outside any challenge",
    report.groups.some((g) => g.dimension === "Challenge" && g.key === "none" && g.label === "Not in a challenge"),
  );
  const marker = await api(
    "/analytics?source=Simulation&tag=fixture&marker=hidden",
  );
  check(
    "marker filters every selected pair and matrix",
    marker.includedPairs === 12 &&
      marker.sessions.every(
        (s) => s.config.presentation.showDifficultyMarker === false,
      ) &&
      marker.matrix.reduce((n, c) => n + c.pairs, 0) === 12,
  );
  const filtered = await api(
    "/analytics?source=Simulation&tag=fixture&deviceType=" +
      encodeURIComponent("Simulated model 0"),
  );
  check(
    "all analytics use device type filter",
    filtered.includedPairs === 12 &&
      filtered.sessions.every(
        (s) => s.config.deviceType === "Simulated model 0",
      ),
  );
  const same = await api(
    "/analytics?source=Simulation&tag=fixture&timezone=UTC",
  );
  check(
    "analysis cache preserves seed and result",
    same.seed === report.seed && same.summary.test.p === report.summary.test.p,
  );
  const cachedExport = await page.evaluate(async () => {
    const t = await import("/js/core/transfer.js");
    return t.exportData({ full: true }, "UTC");
  });
  check(
    "backup includes stored analysis seeds",
    cachedExport.records.analyses.some((a) => a.report.seed === report.seed),
  );
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator("[data-nav=progress]").click();
  await page
    .locator("#analytics-filters [name=source]")
    .selectOption("Simulation");
  await page.locator("#analytics-filters [type=submit]").click();
  // Wait for the re-filtered page: the simulated overall score, then its report.
  await page.locator(".progress-hero .score").waitFor();
  await page.locator("#analysis-main .tabs").waitFor();
  await page.getByRole("tab", { name: "Comparisons", exact: true }).click();
  await page.getByRole("heading", { name: "Devices", exact: true }).waitFor();
  check(
    "device comparison visible",
    (await page.locator("#analysis-main .matrix .cell").count()) === 12 &&
      (await page.getByRole("heading", { name: "Devices", exact: true }).isVisible()),
  );
  for (const name of ["Overview", "Trends", "Comparisons", "Data quality"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    if (name === "Overview")
      check(
        "the overall score is shown above the Insights",
        (await page.locator(".progress-hero .score").count()) === 1 &&
          (await page.locator("#analysis-main .cards").count()) === 1,
      );
  }
  await page.locator("[data-nav=history]").click();
  await page.locator(".history-list").waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  check(
    "offline cached app opens existing history",
    (await api("/sessions?source=Simulation")).total === 31,
  );
  await context.setOffline(false);
  const b = await fetch(base + "/bridge/bootstrap").then((r) => r.json());
  check(
    "modifying request without token rejected",
    (await fetch(base + "/bridge/disconnect", { method: "POST" })).status ===
      403,
  );
  check(
    "cross-origin request rejected",
    (
      await fetch(base + "/bridge/bootstrap", {
        headers: { Origin: "https://example.com" },
      })
    ).status === 403,
  );
  check(
    "unexpected Host rejected",
    (await new Promise((resolve) =>
      http.get(
        base + "/bridge/bootstrap",
        { headers: { Host: "example.com" } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      ),
    )) === 403,
  );
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/review.json", import.meta.url),
    JSON.stringify({ checks }, null, 2),
  );
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
