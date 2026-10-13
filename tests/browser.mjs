// End-to-end with simulated bytes: one real-duration Up/Down session through the
// interface, then recovery, persistence, replay, export/import and Insights.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872",
  checks = [],
  errors = [],
  out = new URL("../test-results/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const check = (name, value) => {
  assert.ok(value, name);
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
const waitState = async (predicate, seconds = 160) => {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const state = await api("/state");
    if (predicate(state)) return state;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Timed out waiting for capture state");
};
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  check("reduced motion is honoured in this run", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
  // A simulation whose intention shift is negative: Down gets more ones.
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator('[data-nav="settings"]').click();
  await page.locator("#settings-device").click();
  await page.locator('#source-choice label:has(input[value="Simulation"])').click();
  await page.locator("#sim-scenario").selectOption("IntentionShift");
  await page.locator("#sim-shift").fill("-0.004");
  await page.locator("#connect").click();
  await page.locator("#device-word", { hasText: "Simulation" }).waitFor();
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator('[data-nav="play"]').click();
  await page.locator('.instrument-card[data-game="Bar"]').click();
  await page.locator('#levels label:has(input[value="4"])').click();
  await page.locator("#begin").click();
  await page.locator("#stage").waitFor({ state: "visible" });
  const first = await api("/state");
  check("the chosen game and level are frozen", first.config.difficulty.id === 4 && first.config.game === "Bar");
  check("the protocol and score versions are frozen", first.config.protocolVersion === "updown-v2" && first.config.scoreVersion === "score-v2");
  const d = first.config.difficulty;
  check(
    "the XOR mask, the measured speed and the goal from that speed are frozen",
    first.config.xorMask === "0x55" &&
      first.config.bitsPerSecond === 50000 * 8 &&
      d.oneIn === 1000 &&
      Math.abs(d.deltaGoal - d.z * Math.sqrt(0.5 / (first.config.bitsPerSecond * 60 * first.config.durationMinutes))) < 1e-12,
  );
  check("the order was drawn before measuring", typeof first.upFirst === "boolean");
  check("the sound setting, on by default, is frozen with the session", first.config.presentation.sound === true);
  let rejected = false;
  try {
    await api("/sessions/start", { game: "Bulb", durationMinutes: 1, difficultyId: 2, timezone: "UTC" }, crypto.randomUUID());
  } catch {
    rejected = true;
  }
  check("a competing start is refused", rejected);
  const second = await context.newPage();
  await second.goto(base);
  await second.locator("#stage").waitFor({ state: "visible" });
  check("a second tab joins the same session", (await second.evaluate(async () => (await import("/js/api.js")).request("/state"))).sessionId === first.sessionId);
  await second.close();
  await page.bringToFront();
  await page.reload();
  await page.locator("#stage").waitFor({ state: "visible" });
  check("a refresh returns to the same session", (await api("/state")).sessionId === first.sessionId);
  await page.evaluate(() => (location.hash = "history"));
  await page.waitForTimeout(1300);
  check("leaving the stage flags interrupted feedback", (await api("/state")).feedbackInterrupted);
  check("the return banner appears off the stage", await page.locator("#return-to-session").isVisible());
  await page.locator("#return-to-session").click();
  const firstKind = first.upFirst ? "Up" : "Down",
    secondKind = first.upFirst ? "Down" : "Up";
  const p1 = await waitState((s) => s.phase === firstKind && s.zLive !== null);
  check("the first direction shows live feedback", p1.zLive !== null && p1.acceptedBits !== null);
  const pause = await waitState((s) => s.state === "Transition");
  check("the pause shows the instrument at rest", pause.zLive === null && pause.level === 0);
  const p2 = await waitState((s) => s.phase === secondKind && s.zLive !== null);
  check("the second direction also shows live feedback", p2.zLive !== null);
  check("no result appears before the end", await page.locator("#result").isHidden());
  await waitState((s) => ["Completed", "Faulted"].includes(s.state));
  const result = await api("/sessions/" + first.sessionId);
  if (result.session.state !== "Completed") console.log(JSON.stringify(result.session, null, 2));
  check("both directions were captured", result.session.state === "Completed");
  check("the negative effect is kept", result.session.result.effectPpm < 0 && result.session.result.downRate > result.session.result.upRate);
  check("a negative effect scores zero", result.session.score.value === 0);
  await page.locator("#result .result-hero").waitFor();
  check(
    "the result says so plainly before any numbers",
    (await page.locator("#result .verdict").innerText()) === "This one went the opposite way." &&
      (await page.locator("#result .analysis").isHidden()),
  );
  check(
    "the result explains itself in plain words",
    (await page.locator("#result .explain .explain-row").count()) === 3 &&
      /opposite of what you asked for/.test(await page.locator("#result .explain").innerText()),
  );
  await page.locator('#result [data-act="details"]').click();
  check("Details show the negative effect in the cool colour", await page.locator("#result .effect-value.negative").isVisible());
  check("250 ms buckets were persisted", result.buckets.length >= 470);
  check(
    "counts agree with the bucket sums",
    result.session.phases.every(
      (p) => BigInt(p.bits) === result.buckets.filter((b) => b.phaseOrdinal === p.ordinal).reduce((n, b) => n + BigInt(b.bits), 0n),
    ),
  );
  check(
    "buckets keep the signed display level for replay",
    result.buckets.some((b) => b.level < 0) && result.buckets.every((b) => b.level >= -1 && b.level <= 1),
  );
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  check("the session survives reopening", (await api("/sessions/" + first.sessionId)).session.result.effectPpm === result.session.result.effectPpm);
  check("device history excludes simulations", (await api("/sessions?source=Hardware")).total === 0);
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator('[data-nav="history"]').click();
  await page.locator('#history-filters select[name="source"]').selectOption("Simulation");
  await page.locator("#history-filters button[type=submit]").click();
  await page.locator(".history-row").first().click();
  await page.locator(".replay-play").waitFor();
  await page.locator(".replay-play").click();
  await page.waitForTimeout(400);
  check("the replay is labelled and running", (await page.locator(".replay-section h2").innerText()) === "Replay" && (await page.locator(".replay-play").innerText()) === "Pause");
  check(
    "the replay names each direction in the game's words and offers fast speeds",
    ["Push it up", "Push it down", "Countdown", "Pause between directions"].includes(await page.locator(".replay-phase").innerText()) &&
      (await page.locator(".replay-speed option").allInnerTexts()).join(" ") === "1× 4× 16× 32× 64×",
  );
  await page.locator(".replay-play").click();
  await page.locator('a.back[href="#history"]').click();
  check("a replay never adds a session", (await api("/sessions?source=Simulation")).total === 1);
  await api("/sessions/" + first.sessionId + "/notes", { text: '=HYPERLINK("test")', tags: ["review"], excluded: false });
  const exported = await page.evaluate(async () => {
    const t = await import("/js/core/transfer.js");
    const data = await t.exportData({ full: true }, "UTC");
    const preview = await t.prepareImport(JSON.stringify(data));
    const csv = await t.csvExport({ filter: { source: "Simulation" } });
    return { data, duplicates: preview.duplicates, conflicts: preview.conflicts, csv };
  });
  check("a backup validates and skips duplicates", exported.duplicates > 0 && exported.conflicts.length === 0);
  check("CSV defuses formula injection", exported.csv.includes("'=HYPERLINK"));
  check("the backup carries the stored score", exported.data.records.sessions[0].score.version === "score-v2");
  const fresh = await browser.newContext(),
    freshPage = await fresh.newPage();
  await freshPage.goto(base);
  await freshPage.locator("[data-app-ready]").waitFor();
  const imported = await freshPage.evaluate(async (data) => {
    const t = await import("/js/core/transfer.js");
    return t.commitImport(await t.prepareImport(JSON.stringify(data)));
  }, exported.data);
  check("a backup imports into an empty browser", imported.added === 1);
  const tampered = await freshPage.evaluate(async (data) => {
    const t = await import("/js/core/transfer.js"),
      p = await import("/js/core/protocol.js");
    data.records.sessions[0].score.value = 99;
    const { sha256, ...payload } = data;
    data.sha256 = await p.hash(JSON.stringify(payload));
    try {
      await t.prepareImport(JSON.stringify(data));
      return false;
    } catch (e) {
      return /score/i.test(e.message);
    }
  }, exported.data);
  check("an import with a score that disagrees with its counts is refused", tampered);
  await fresh.close();
  await page.locator('[data-nav="progress"]').click();
  await page.locator('#analytics-filters select[name="source"]').waitFor();
  await page.locator('#analytics-filters select[name="source"]').selectOption("Simulation");
  await page.locator("#analytics-filters details").first().evaluate((e) => (e.open = true));
  await page.locator('#analytics-filters [name="includeInterrupted"]').check();
  await page.locator("#analytics-filters button[type=submit]").click();
  await page.locator("[role=tab]").first().waitFor();
  for (const tab of ["Overview", "Trends", "Comparisons", "Data quality"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.waitForTimeout(200);
    check("Insights: " + tab, (await page.locator("#insight-panel").innerText()).length > 100);
  }
  const report = await api("/analytics?source=Simulation&includeInterrupted=true");
  check("one session cannot give an across-session p below .5", report.summary.test.p >= 0.5);
  check("twelve game cells and sixty level cells", report.matrix.length === 12 && report.difficultyBreakdown.length === 60);
  const progress = await api("/progress?source=Simulation");
  check("an interrupted session still counts toward the overall score", progress.started === 1 && progress.sessions === 1);
  await page.locator('[data-nav="settings"]').click();
  await page.locator("#backup").waitFor();
  check("backup and import are in Settings", (await page.locator("#import-file").count()) === 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-nav="play"]').click();
  check("the phone layout has no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  check("no browser JavaScript errors", errors.length === 0);
  await writeFile(new URL("browser.json", out), JSON.stringify({ checks, errors }, null, 2));
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
