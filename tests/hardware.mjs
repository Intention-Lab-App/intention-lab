import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872",
  out = new URL("../test-results/", import.meta.url),
  checks = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext(),
  page = await context.newPage();
page.setDefaultTimeout(15000);
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
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  const ports = await api("/ports"),
    d = ports.devices.find((d) => d.familyHint && d.port);
  assert.ok(d, "Connect your TrueRNG to run this hardware test");
  await api("/connect", { source: "Hardware", deviceId: d.id });
  await new Promise((r) => setTimeout(r, 250));
  const s = await api(
    "/sessions/start",
    {
      game: "Bulb",
      durationMinutes: 1,
      difficultyId: 2,
      timezone: "UTC",
      notes: "Automated hardware bench capture; no human intention claim.",
      tags: ["hardware-bench"],
      recordRaw: true,
    },
    crypto.randomUUID(),
  );
  check(
    "hardware identity found without hardcoded COM port",
    s.config.deviceId === d.id,
  );
  await new Promise((r) => setTimeout(r, 11000));
  await page.reload();
  await page.locator("#stage").waitFor({ state: "visible" });
  check(
    "hardware refresh recovered same attempt",
    (await api("/state")).sessionId === s.id,
  );
  const timeout = Date.now() + 145000;
  let state;
  while (Date.now() < timeout) {
    state = await api("/state");
    if (["Completed", "Faulted"].includes(state.state)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const detail = await api("/sessions/" + s.id);
  if (detail.session.failureReason) console.log(detail.session.failureReason);
  check(
    "real device completes both one-minute directions",
    detail.session.state === "Completed",
  );
  check(
    "real device records Up and Down in the drawn order",
    detail.session.phases.map((p) => p.kind).join(",") ===
      (detail.session.upFirst ? "Up,Down" : "Down,Up"),
  );
  check(
    "real device session stores a versioned score that matches its counts",
    detail.session.score?.version === "score-v2" &&
      (await page.evaluate(async (s) => {
        const { sessionScore } = await import("/js/core/score.js");
        return sessionScore({ ...s, score: null }).value;
      }, detail.session)) === detail.session.score.value,
  );
  // The raw bytes are kept as sent: their own 1s give rawOnes, and the same bytes
  // after the session's XOR mask give the counted ones.
  const raw = await page.evaluate(async ({ id, masked }) => {
    const db = await import("/js/core/database.js"),
      { popcount } = await import("/js/core/capture.js"),
      { hash } = await import("/js/core/protocol.js");
    const records = await db.all("raw", id),
      phases = {},
      seen = new Set();
    let valid = true;
    for (const r of records) {
      const bytes = new Uint8Array(r.bytes);
      if ((await hash(bytes)) !== r.sha256) valid = false;
      phases[r.phaseOrdinal] ??= { bytes: 0, ones: 0, rawOnes: 0 };
      phases[r.phaseOrdinal].bytes += bytes.length;
      phases[r.phaseOrdinal].ones += popcount(bytes, masked);
      phases[r.phaseOrdinal].rawOnes += popcount(bytes);
      for (const b of bytes) seen.add(b);
    }
    return {
      phases,
      distinct: seen.size,
      checksumsValid: valid,
      records: records.length,
    };
  }, { id: s.id, masked: !!detail.session.config.xorMask });
  check("the session was counted after the XOR mask", detail.session.config.xorMask === "0x55");
  check("raw output checksums verify", raw.checksumsValid);
  check("all 256 byte values survived", raw.distinct === 256);
  for (const p of detail.session.phases) {
    check(
      p.kind + " raw counts reconcile",
      BigInt(raw.phases[p.ordinal].bytes) * 8n === BigInt(p.bits) &&
        BigInt(raw.phases[p.ordinal].ones) === BigInt(p.ones) &&
        BigInt(raw.phases[p.ordinal].rawOnes) === BigInt(p.rawOnes),
    );
  }
  check(
    "recovered feedback interruption remains flagged",
    detail.session.feedbackInterrupted,
  );
  const before = detail.session.result;
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  check(
    "hardware result preserved on reload",
    JSON.stringify((await api("/sessions/" + s.id)).session.result) ===
      JSON.stringify(before),
  );
  await api("/disconnect");
  await writeFile(
    new URL("hardware.json", out),
    JSON.stringify(
      {
        checks,
        device: d,
        session: detail.session,
        bucketCount: detail.buckets.length,
        raw,
      },
      null,
      2,
    ),
  );
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
