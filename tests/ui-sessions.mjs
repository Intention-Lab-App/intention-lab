// Real-duration sessions of every game through the Play interface, using
// simulated bytes with an intention shift. Never opens a COM port.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872";
const out = new URL("../test-results/ui/", import.meta.url),
  checks = [],
  errors = [],
  records = [];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const a = await import("/js/api.js");
      return body === undefined ? a.request(path) : a.post(path, body);
    },
    { path, body },
  );
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
const shot = (name) =>
  page.screenshot({ path: new URL(name + ".png", out).pathname.replace(/^\/([A-Z]:)/, "$1") });
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  await api("/connect", {
    source: "Simulation",
    simulation: {
      scenario: "IntentionShift",
      seed: 2026,
      bytesPerSecond: 50400,
      commonBias: 0,
      intentionShift: 0.0004,
      driftPerMinute: 0,
      failureAfterSeconds: 999,
    },
  });
  await page.locator("#device-word", { hasText: "Simulation" }).waitFor();
  const WORDS = {
    Bulb: { Up: "Make it brighter", Down: "Make it dimmer" },
    Bar: { Up: "Push it up", Down: "Push it down" },
    Box: { Up: "Fill it with ones", Down: "Fill it with zeros" },
  };
  for (const game of ["Bulb", "Bar", "Box"]) {
    await page.locator(`.instrument-card[data-game=${game}]`).click();
    await page.locator(`#levels label:has(input[value="${game === "Bulb" ? 2 : 3}"])`).click();
    await page.locator("#begin").click();
    await page.locator("#stage").waitFor({ state: "visible" });
    check(game + " stage hides the header", await page.locator(".topbar").isHidden());
    const begun = await api("/state"),
      seen = new Map();
    const until = Date.now() + 160000;
    let ended = false;
    while (Date.now() < until) {
      const s = await api("/state");
      if ((s.phase === "Up" || s.phase === "Down") && s.remainingSeconds < 50 && !seen.has(s.phase)) {
        seen.set(s.phase, s);
        check(
          `${game} ${s.phase} shows live feedback from real accumulated data`,
          BigInt(s.acceptedBits) > 0n && s.zLive !== null && Number.isFinite(s.level),
        );
        check(
          `${game} ${s.phase} instruction names the direction`,
          (await page.locator("#instruction").innerText()) ===
            WORDS[game][s.phase],
        );
        check(`${game} ${s.phase} shows one clock`, (await page.locator(".clock").count()) === 1);
        if (game === "Box")
          check(
            `Box ${s.phase} stays sealed and its Ask knob points to ${s.phase === "Up" ? "1" : "0"}`,
            (await page.locator('#stage-visual [data-part="seal-whole"]').isVisible()) &&
              (await page.locator('#stage-visual [data-part="under-face"]').isHidden()) &&
              (await page.locator('#stage-visual [data-part="dial-ask"] .pointer').getAttribute("transform")) ===
                `rotate(${s.phase === "Up" ? -48 : 48})`,
          );
        if (game === "Bar")
          check(
            `${game} ${s.phase} goal marker points in the current direction`,
            s.zGoal === null || Math.sign(s.zGoal) === (s.phase === "Up" ? 1 : -1),
          );
        await shot(`${game.toLowerCase()}-${s.phase.toLowerCase()}`);
      }
      if (s.state === "Transition" && !seen.has("Transition")) {
        seen.set("Transition", s);
        check(game + " pause rests the instrument", s.zLive === null && s.level === 0);
        await shot(`${game.toLowerCase()}-pause`);
      }
      if (["Completed", "Faulted", "Aborted"].includes(s.state)) {
        check(game + " completes both directions", s.state === "Completed");
        ended = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    check(game + " reached its endpoint", ended);
    if (game === "Box") {
      await page.locator("#stage-continue").waitFor({ state: "visible" });
      const opened = await api("/sessions/" + begun.sessionId),
        asked = (await page.locator('#stage-visual [data-part="words"] text').allTextContents()).join(",");
      check(
        "Box opens on its record before the score: a trace for each part, under what each asked",
        (await page.locator('#stage-visual [data-part="under-face"]').isVisible()) &&
          (await page.locator('#stage-visual [data-part="trace"] polyline').count()) === 2 &&
          asked === opened.session.phases.map((p) => (p.kind === "Up" ? "ASKED ONES" : "ASKED ZEROS")).join(",") &&
          (await page.locator("#result").isHidden()),
      );
      await shot("box-open");
      await page.locator("#stage-continue").click();
    }
    await page.locator("#result .result-hero").waitFor();
    const d = await api("/sessions/" + begun.sessionId);
    records.push(d.session);
    check(
      game + " keeps the randomized order",
      d.session.phases.map((p) => p.kind).join(",") === (d.session.upFirst ? "Up,Down" : "Down,Up"),
    );
    check(
      game + " counts reconcile with persisted buckets",
      d.session.phases.every(
        (p) =>
          BigInt(p.bits) ===
          d.buckets.filter((b) => b.phaseOrdinal === p.ordinal).reduce((n, b) => n + BigInt(b.bits), 0n),
      ),
    );
    check(
      game + " freezes the interface version and stays simulation",
      d.session.config.presentation.version === "tungsten-ui-v5" && d.session.config.source === "Simulation",
    );
    check(
      game + " stores a versioned score with the session",
      d.session.score?.version === "score-v2" && Number.isInteger(d.session.score.value),
    );
    check(
      game + " shows the stored score",
      (await page.locator("#result .score").innerText()) === String(d.session.score.value),
    );
    check(
      game + " explains the result in plain words",
      (await page.locator("#result .explain .explain-row").count()) === 3 &&
        (await page.locator("#result .explain").innerText()).includes(`${d.session.config.difficulty.label} asks for`),
    );
    await shot(game.toLowerCase() + "-result");
    await page.locator('#result [data-act="details"]').click();
    check(
      game + " Details agree with the stored effect",
      (await page.locator("#result .effect-value").innerText()).replace("−", "-").replace(/,/g, "") ===
        (d.session.result.effectPpm > 0 ? "+" : "") + d.session.result.effectPpm.toFixed(1).replace(/\.0$/, ""),
    );
    check(game + " Details show a replay", await page.locator("#result .replay-section").isVisible());
    check(
      game + " replay uses the game's own words",
      Object.values(WORDS[game]).includes(
        await page.locator("#result .replay-phase").innerText(),
      ),
    );
    await page.locator('[data-nav="play"]').click();
  }
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  check("every session survives reopening", (await api("/sessions?source=Simulation")).total === 3);
  check("device history stays empty", (await api("/sessions?source=Hardware")).total === 0);
  check(
    "the intention shift produced positive effects in every game",
    records.every((s) => s.result.effectPpm > 0),
  );
  check("no runtime errors", errors.length === 0);
  await writeFile(
    new URL("sessions.json", out),
    JSON.stringify(
      {
        checks,
        errors,
        sessions: records.map((s) => ({
          id: s.id,
          game: s.config.game,
          order: s.upFirst ? "UpFirst" : "DownFirst",
          bits: s.phases.map((p) => p.bits),
          effectPpm: s.result.effectPpm,
          score: s.score,
          clean: s.clean,
          qualityReasons: s.qualityReasons,
        })),
      },
      null,
      2,
    ),
  );
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
