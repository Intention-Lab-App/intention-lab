// Result presentation checks in a disposable profile; never opens a COM port.
// Renders real result components from fixture sessions built with the real
// statistics and score functions.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872";
const out = new URL("../test-results/ui/", import.meta.url);
await mkdir(out, { recursive: true });
const checks = [],
  errors = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const shot = (name, fullPage = true) =>
  page.screenshot({
    path: new URL(name + ".png", out).pathname.replace(/^\/([A-Z]:)/, "$1"),
    fullPage,
  });
// up/down: ones counts out of 24,197,536 / 24,198,544 bits.
const render = (options = {}) =>
  page.evaluate(async (options) => {
    const { mountResult } = await import("/js/result.js");
    const { pair } = await import("/js/core/statistics.js");
    const { sessionScore } = await import("/js/core/score.js");
    const { DIFFICULTIES, schedule, VERSION, XOR_TEMPLATE, goalFor } = await import("/js/core/protocol.js");
    const upBits = "24197536",
      downBits = "24198544";
    const result = options.degenerate
      ? pair(1000, 1000, 1000, 1000)
      : pair(upBits, options.up ?? "12096096", downBits, options.down ?? "12101476");
    const phases = schedule(1, true).map((p, i) => ({
      ...p,
      bits: i ? downBits : upBits,
      ones: i ? options.down ?? "12101476" : options.up ?? "12096096",
      rawOnes: i ? options.down ?? "12101476" : options.up ?? "12096096",
      bytes: String(Number(i ? downBits : upBits) / 8),
      status: "Completed",
    }));
    const session = {
      id: "result-fixture-" + Math.random().toString(16).slice(2),
      state: options.state || "Completed",
      createdUtc: new Date().toISOString(),
      result: options.state ? null : result,
      upFirst: true,
      isReference: false,
      config: {
        game: options.game || "Bulb",
        source: options.source || "Hardware",
        xorMask: XOR_TEMPLATE,
        bitsPerSecond: Number(upBits) / 60,
        difficulty: goalFor(DIFFICULTIES[options.level ?? 1], Number(upBits) / 60, 1),
        durationMinutes: 1,
        protocolVersion: VERSION,
        deviceLabel: "USB Serial Device (COM4)",
        deviceIdentity: { label: "USB Serial Device (COM4)", port: "COM4", familyHint: true },
        presentation: { showDifficultyMarker: true },
      },
      phases,
      clean: !options.flagged,
      qualityReasons: options.flagged ? ["Feedback interrupted"] : [],
      failureReason: options.state === "Faulted" ? "Device disconnected: port closed" : options.state === "Aborted" ? "Stopped by user; incomplete attempt retained" : null,
      boundaryExcludedBytes: "0",
      flushedBytes: "0",
      captureGaps: "0",
      uiInterruptions: "0",
      notes: "",
      tags: [],
    };
    session.targetRatio = session.result ? session.result.difference / session.config.difficulty.deltaGoal : null;
    session.score = session.result ? sessionScore(session) : null;
    document.querySelector("#home").hidden = true;
    const host = document.querySelector("#result");
    host.hidden = false;
    mountResult(host, { session, buckets: [], events: [], notes: [] }, {
      ceremony: false,
      openDetails: false,
      primary: { label: "Play again", onClick: () => {} },
    });
    return { score: session.score, effectPpm: result?.effectPpm ?? null };
  }, options);

try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  const result = page.locator("#result");
  const details = result.locator('[data-act="details"]');
  // Negative: Up had fewer ones than Down.
  const negative = await render();
  check("a negative effect scores exactly zero", negative.score.value === 0 && negative.effectPpm < 0);
  check(
    "the negative outcome is stated plainly",
    (await result.locator(".verdict").innerText()) === "This one went the opposite way." &&
      (await result.locator(".chance").innerText()) === "Chance alone does this well most of the time.",
  );
  check(
    "no technical vocabulary before Details",
    !/million|95%|Z |p-value|one-sided|interval|active|idle|Model-based/i.test(
      await result.locator(".result-hero").innerText(),
    ) && (await result.locator(".analysis").isHidden()),
  );
  check(
    "the plain explanation has no research vocabulary",
    (await result.locator(".explain .explain-row").count()) === 3 &&
      !/per million|95%|Z |p-value|one-sided|interval|Model-based|significan/i.test(await result.locator(".explain").innerText()),
  );
  check(
    "the explanation says what moved and names the goal",
    /fewer in every million/.test(await result.locator(".explain").innerText()) &&
      (await result.locator(".explain").innerText()).includes("Balanced asks for a result that chance alone reaches only 1 time in 20"),
  );
  await result.locator(".score-label .info").click();
  await page.locator("#guide[open]").waitFor();
  check("the score's i opens the guide at the score", await page.evaluate(() => document.activeElement?.id === "guide-score"));
  await page.keyboard.press("Escape");
  await shot("result-negative");
  await details.focus();
  await page.keyboard.press("Enter");
  check("Details opens with the keyboard", await result.locator(".analysis").isVisible());
  const text = await result.locator(".analysis").innerText();
  check(
    "Details keeps the signed effect, interval, rates, counts and evidence",
    /−201\.5/.test(await result.locator(".effect-value").innerText()) &&
      /95% interval/.test(text) &&
      /24,197,536 bits/.test(text) &&
      /One-sided p/.test(text) &&
      /(Brighter|Dimmer|Up|Down) first/.test(text),
  );
  check(
    "the negative effect uses the cool colour",
    await result.locator(".effect-value.negative").isVisible(),
  );
  check("model assumptions are stated once", text.split("approximately independent bits").length === 2);
  await shot("result-negative-details");
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    "expanded analysis fits a phone",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await shot("result-negative-phone");
  await page.setViewportSize({ width: 1366, height: 900 });

  // Positive with strong evidence at Balanced.
  const positive = await render({ up: "12104500", game: "Bar" });
  check("a positive effect scores above zero", positive.score.value > 0);
  check(
    "the chance line gives odds for a positive score",
    /^Chance alone does this well (about 1 time in [\d,]+|less than 1 time in 10,000)\.$/.test(
      await result.locator(".chance").innerText(),
    ),
  );
  check(
    "the score is shown large with the score label",
    (await result.locator(".score").innerText()) === String(positive.score.value) &&
      (await result.locator(".score-label").innerText()) === "Score",
  );
  check("no claim of significance in the plain result", !/significan/i.test(await result.innerText()));
  await shot("result-positive", false);

  await render({ source: "Simulation", up: "12104500" });
  check(
    "simulation is labelled even with Details closed",
    await result.locator(".result-hero .tag.sim").isVisible(),
  );
  await render({ flagged: true });
  check(
    "a quality problem is visible in the plain result",
    await result.getByText("Quality check needed", { exact: true }).isVisible(),
  );
  await details.click();
  check(
    "the precise quality reason is in Details",
    (await result.locator(".analysis").innerText()).includes("Feedback interrupted"),
  );
  await render({ degenerate: true });
  check(
    "unavailable inference is not shown as a score of zero",
    (await result.locator(".verdict").innerText()) === "No score for this session." &&
      (await result.locator(".score").count()) === 0,
  );
  await render({ state: "Aborted" });
  check(
    "a stopped attempt says so and has no score",
    (await result.locator(".verdict").innerText()) === "Stopped early." &&
      (await result.locator(".score").count()) === 0,
  );
  await render({ state: "Faulted" });
  check(
    "an interrupted attempt names the cause",
    (await result.locator(".verdict").innerText()) === "The device was disconnected.",
  );
  await shot("result-interrupted", false);
  check("no runtime errors", errors.length === 0);
  await writeFile(new URL("results.json", out), JSON.stringify({ checks, errors }, null, 2));
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
