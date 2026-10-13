// Screenshots of every screen in both layers, at desktop and phone width, plus
// the instruments in their defining states. Uses a disposable profile filled
// with simulated sessions produced by the real capture engine; nothing touches
// the user's history or a COM port.
//
// With --readme (or INTENTIONLAB_README=1) it makes only the pictures in the
// README instead, framed like the ones in .github/images, into
// test-results/readme. Copying them into .github/images is left to a person.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872";
const readmeMode = process.argv.includes("--readme") || process.env.INTENTIONLAB_README === "1";
const out = new URL(readmeMode ? "../test-results/readme/" : "../test-results/ui/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
// A fixed time zone and locale, so the pictures do not depend on the machine.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "UTC", locale: "en-US" });
const page = await context.newPage();
const errors = [],
  shots = [];
page.on("pageerror", (e) => errors.push(e.message));
const file = (name) => new URL(name + ".png", out).pathname.replace(/^\/([A-Z]:)/, "$1");
const shot = async (name, fullPage = false) => {
  await page.screenshot({ path: file(name), fullPage });
  shots.push(name);
  console.log("shot", name);
};
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const a = await import("/js/api.js");
      return body === undefined ? a.request(path) : a.post(path, body);
    },
    { path, body },
  );
const go = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(900);
};
// Through the app's own module, so it also works while the stage hides the header.
const lab = async (on) => {
  await page.evaluate(async (on) => (await import("/js/state.js")).setLab(on), on);
  await page.waitForTimeout(400);
};
// A README picture: the element alone, on the page's night colour, with a
// margin and rounded transparent corners, as the pictures on the project page have.
// `scale` is "css" or "device"; `pad` and `radius` are in the picture's pixels.
const readme = async (p, name, target, { scale = "css", pad = 20, radius = 16, style } = {}) => {
  // In the middle of its scroller, clear of a sticky header.
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(300);
  // The page's glow at the top would show as an edge against the margin.
  const png = await target.screenshot({ scale, style: "body { background: var(--night) !important } " + (style || "") }),
    fill = await p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  const data = await p.evaluate(
    async ({ src, pad, radius, fill }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas"),
        g = c.getContext("2d");
      c.width = img.width + 2 * pad;
      c.height = img.height + 2 * pad;
      g.beginPath();
      g.roundRect(0, 0, c.width, c.height, radius);
      g.clip();
      g.fillStyle = fill;
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, pad, pad);
      return c.toDataURL("image/png").slice(22);
    },
    { src: "data:image/png;base64," + png.toString("base64"), pad, radius, fill },
  );
  await writeFile(new URL(name + ".png", out), Buffer.from(data, "base64"));
  shots.push(name);
  console.log("readme", name);
};
// The README's pictures. The screens come from the seeded sessions at 1x, as a
// desktop shows them; the guide's figures and the hero need no sessions, so
// they are drawn in a fresh context at twice the pixels.
async function readmePictures() {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const layer of ["play", "lab"]) {
    await lab(layer === "lab");
    await go("history");
    if (layer === "lab") {
      await page.locator('#history-filters select[name="source"]').selectOption("Simulation");
      await page.locator("#history-filters button[type=submit]").click();
      await page.waitForTimeout(800);
    }
    await page.locator(".history-row").first().click();
    await page.waitForTimeout(900);
    if (layer === "play") {
      await readme(page, "result", page.locator(".result-main:visible"), {
        style: ".result-main { max-width: 720px; margin: 0 auto; padding: 0 !important } .result-actions { display: none !important }",
      });
      await go("progress");
      await page.waitForTimeout(1500);
      await readme(page, "progress", page.locator("#progress-content"), {
        style: "#progress-content > .footnote, #progress-content .timeline > .fine { display: none !important }",
      });
    } else
      await readme(page, "lab", page.locator(".analysis:visible"), {
        style: ".analysis { border-top: 0 !important; padding-top: 0 !important; margin-top: 0 !important } .analysis > .figures ~ * { display: none !important }",
      });
  }
  await lab(false);

  const hiContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: "UTC", locale: "en-US" }),
    hi = await hiContext.newPage();
  hi.on("pageerror", (e) => errors.push(e.message));
  try {
    await hi.goto(base);
    await hi.locator("[data-app-ready]").waitFor();
    await hi.locator(".topbar-end .guide-button").click();
    await hi.locator("#guide[open]").waitFor();
    for (const [name, selector] of [
      ["guide-levels", "#guide-levels figure.fig-chance"],
      ["guide-box", "#guide-instruments figure.fig:has([data-fig-box])"],
    ]) {
      const fig = hi.locator(selector);
      await hi.waitForTimeout(600);
      await readme(hi, name, fig, { scale: "device", pad: 20, radius: 36 });
    }
    await hi.keyboard.press("Escape");

    // Three panels side by side, one game each, as on the stage, with a line of
    // text under each. Each panel says its game, its words and its state: the
    // bulb's level; the meter's reading, red needle and progress; whether the
    // box is open on a made-up record. Drawn in the page, shot as one picture.
    const panels = async (name, spec, height) => {
      await hi.setViewportSize({ width: 1500, height });
      await hi.evaluate(async (spec) => {
        document.getElementById("readme-panels")?.remove();
        const [{ createBulb }, { createBar }, { createBox }] = await Promise.all([import("/js/bulb.js"), import("/js/bar.js"), import("/js/box.js")]);
        const wrap = document.createElement("div");
        wrap.id = "readme-panels";
        wrap.style.cssText = "position:fixed;inset:0;z-index:99;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line)";
        document.body.append(wrap);
        // A made-up record for the open box, from a fixed seed: a little your way.
        let seed = 20261011;
        const r = () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296),
          walk = (lean) => {
            let sum = 0;
            return Array.from({ length: 240 }, (_, k) => [(k + 1) / 240, (sum += Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()) + lean) / Math.sqrt(k + 1)]);
          },
          record = { parts: [{ kind: "Down", points: walk(-0.06) }, { kind: "Up", points: walk(0.09) }] };
        for (const p of spec) {
          const host = document.createElement("div");
          host.className = "stage lit";
          host.dataset.game = p.game;
          host.style.cssText = "position:relative;inset:auto;z-index:auto";
          host.innerHTML = p.text
            ? `<div class="stage-visual" style="--meter-top:4%;--meter-height:74%"></div><div class="stage-text"><p class="instruction">${p.text}</p></div>`
            : `<div class="stage-visual" style="--meter-top:5%;--meter-height:90%"></div>`;
          wrap.append(host);
          const visual = host.firstElementChild;
          if (p.game === "Bulb") createBulb(visual, { light: host, glassBottom: 0.7, height: 0.58, width: 0.8 }).snap(p.level);
          else if (p.game === "Bar") {
            const bar = createBar(visual, { light: host });
            bar.set(p.z, p.goal, { progress: p.progress });
            bar.snap(p.z);
          } else {
            const box = createBox(visual, { light: host, level: 1 });
            box.ask("Up", { quiet: true });
            if (p.open) box.show(record, 3);
          }
        }
        await document.fonts.ready;
      }, spec);
      await hi.waitForTimeout(2500);
      await readme(hi, name, hi.locator("#readme-panels"), { pad: 0, radius: 16 });
    };
    const balanced = await hi.evaluate(async () => (await import("/js/core/protocol.js")).DIFFICULTIES[1].z);
    // The hero: the three games mid-session, one direction of each kind. The
    // meter is in a Balanced session's Down part, four fifths through: the red
    // needle at the goal's pace there (the guide's own rule), the black needle
    // past it. The box is sealed, asking for ones.
    await panels(
      "hero",
      [
        { game: "Bulb", text: "Make it brighter", level: 0.9 },
        { game: "Bar", text: "Push it down", z: -1.8, goal: -(balanced / Math.SQRT2) * Math.sqrt(0.8), progress: 0.8 },
        { game: "Box", text: "Fill it with ones", open: false },
      ],
      640,
    );
    // The instruments: each game at its telling moment, with no words, since
    // the paragraph above the picture says what each shows. The bulb bright,
    // the black needle past the red one at the end of an Up part, and the box
    // open on the record of both parts.
    await panels(
      "instruments",
      [
        { game: "Bulb", level: 0.95 },
        { game: "Bar", z: 1.9, goal: balanced / Math.SQRT2, progress: 1 },
        { game: "Box", open: true },
      ],
      520,
    );
  } finally {
    await hiContext.close();
  }
}
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  // Simulated sessions through the real engine, with a spread of outcomes.
  await page.evaluate(async (readmeMode) => {
    const db = await import("/js/core/database.js"),
      p = await import("/js/core/protocol.js"),
      { PRESENTATION_VERSION } = await import("/js/core/preferences.js"),
      { Capture } = await import("/js/core/capture.js"),
      { Simulator } = await import("/js/core/simulation.js");
    const plan = [
      ["Bulb", 2, 0.00012],
      ["Bar", 3, 0.00004],
      ["Bulb", 1, -0.00008],
      ["Bulb", 2, 0.00009],
      ["Bar", 2, 0.00016],
      ["Bulb", 3, 0.00002],
      ["Bar", 1, -0.00003],
      ["Bulb", 2, 0.00014],
      ["Bar", 2, 0.00007],
      ["Bulb", 4, 0.0001],
    ];
    // For the README's Progress: Box sessions, dated before the first, so the
    // newest session stays the same. Three, because a game's score needs three.
    if (readmeMode) plan.push(["Box", 2, 0.00011, -1], ["Box", 1, 0.00006, -2], ["Box", 3, 0.00013, -3]);
    const day = Date.UTC(2026, 8, 20, 18);
    for (const [index, [game, levelId, shift, slot = index]] of plan.entries()) {
      const level = p.DIFFICULTIES[levelId - 1],
        upFirst = index % 3 !== 1,
        config = {
          game,
          durationMinutes: 1,
          directions: "Up targets 1 bits after the alternating XOR mask; Down targets 0 bits",
          xorMask: p.XOR_TEMPLATE,
          bitsPerSecond: 403200,
          difficulty: p.goalFor(level, 403200, 1),
          smoothingHalfLife: 3,
          acquisition: p.POLICY,
          deviceId: "simulation-xoshiro-v1",
          deviceType: "Software simulation",
          deviceTypeBasis: "Provider reported",
          deviceLabel: "Simulation",
          source: "Simulation",
          simulation: { scenario: "IntentionShift", seed: 900 + index, bytesPerSecond: 50400, commonBias: 0, intentionShift: shift, driftPerMinute: 0, failureAfterSeconds: 1e9 },
          reference: null,
          recordRaw: false,
          challengeId: null,
          timezone: "UTC",
          protocolVersion: p.VERSION,
          statisticsVersion: p.STATS,
          scoreVersion: "score-v2",
          presentation: { version: PRESENTATION_VERSION, showDifficultyMarker: true, reducedMotion: false },
        };
      const s = {
          id: crypto.randomUUID(),
          state: "Preparing",
          createdUtc: new Date(day + slot * 86400000 * 1.7).toISOString(),
          originMonotonic: 0,
          originUtcMs: day + slot * 86400000 * 1.7,
          upFirst,
          isReference: false,
          config,
          configHash: await p.hash(JSON.stringify(config)),
          phases: p.schedule(1, upFirst),
          qualityReasons: [],
          feedbackInterrupted: false,
          uiInterruptions: "0",
          boundaryExcludedBytes: "0",
          captureGaps: "0",
          flushedBytes: "0",
          notes: index === 0 ? "Evening, calm" : "",
          tags: [],
        },
        c = new Capture(s),
        sim = new Simulator(config.simulation);
      let seq = 0;
      for (let t = 0.125; t <= s.phases.at(-1).end + 0.125; t += 0.125) {
        const phase = s.phases.find((q) => t - 0.125 >= q.start && t < q.end);
        c.ingest({ sequence: String(++seq), start: t - 0.125 + 1e-6, end: t, flags: 0, bytes: phase ? sim.bytes(6300, phase.kind, t, p.XOR_MASK) : new Uint8Array(6300) });
      }
      await db.bump({ sessions: [s], buckets: c.completedBuckets, events: c.events });
    }
  }, readmeMode);
  // The simulator lives in the capture worker, so connect after reloading.
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  await api("/connect", {
    source: "Simulation",
    simulation: { scenario: "IntentionShift", seed: 31, bytesPerSecond: 50400, commonBias: 0, intentionShift: 0.004, driftPerMinute: 0, failureAfterSeconds: 999 },
  });
  await page.locator("#device-word", { hasText: "Simulation" }).waitFor();

  if (readmeMode) await readmePictures();
  else {
    for (const [width, height, suffix] of [
      [1440, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width, height });
      for (const layer of ["play", "lab"]) {
        await lab(layer === "lab");
        const tag = `${layer}-${suffix}`;
        await go("play");
        await page.locator('[data-nav="play"]').click();
        await page.waitForTimeout(600);
        await shot(`home-${tag}`);
        await page.locator('.instrument-card[data-game="Bulb"]').click();
        await page.waitForTimeout(600);
        await shot(`setup-bulb-${tag}`, true);
        await page.locator(".back").first().click();
        await page.locator('.instrument-card[data-game="Bar"]').click();
        await page.waitForTimeout(600);
        await shot(`setup-bar-${tag}`, true);
        await page.locator(".back").first().click();
        await page.locator('.instrument-card[data-game="Box"]').click();
        await page.waitForTimeout(900);
        await shot(`setup-box-${tag}`, true);
        await page.locator(".back").first().click();
        await go("history");
        if (layer === "lab") {
          await page.locator('#history-filters select[name="source"]').selectOption("Simulation");
          await page.locator("#history-filters button[type=submit]").click();
          await page.waitForTimeout(800);
        }
        await shot(`history-${tag}`, true);
        await page.locator(".history-row").first().click();
        await page.waitForTimeout(900);
        await shot(`session-${tag}`, true);
        await go("progress");
        await page.waitForTimeout(1500);
        await shot(`progress-${tag}`, true);
        if (layer === "lab")
          for (const name of ["Trends", "Comparisons", "Data quality"]) {
            await page.getByRole("tab", { name, exact: true }).click();
            await page.waitForTimeout(500);
            await shot(`insights-${name.toLowerCase().replace(" ", "-")}-${suffix}`, true);
          }
        await go("settings");
        await shot(`settings-${tag}`, true);
        await page.locator(width > 640 ? ".topbar-end .guide-button" : ".nav .guide-button").click();
        await page.locator("#guide[open]").waitFor();
        await page.waitForTimeout(500);
        await shot(`guide-${tag}`);
        if (layer === "lab") {
          await page.evaluate(() => document.getElementById("guide-score").scrollIntoView());
          await page.waitForTimeout(200);
          await shot(`guide-score-${tag}`);
        }
        await page.keyboard.press("Escape");
        await page.locator("#settings-device").click();
        await page.locator("#device-dialog[open]").waitFor();
        await page.waitForTimeout(400);
        await shot(`device-${tag}`);
        await page.keyboard.press("Escape");
        await go("challenge");
        await shot(`challenge-${tag}`, true);
      }
    }

    // The instruments in their defining states, on a stage-sized canvas.
    await page.setViewportSize({ width: 1440, height: 900 });
    await lab(false);
    await go("play");
    const states = [
      ["bulb-rest", "Bulb", { level: 0 }],
      ["bulb-full-up", "Bulb", { level: 1 }],
      ["bulb-goal", "Bulb", { level: 0.8 }],
      ["bulb-full-down", "Bulb", { level: -1 }],
      ["bar-zero", "Bar", { z: 0, goal: 1.2 }],
      ["bar-past-goal", "Bar", { z: 1.645, goal: 1.2 }],
      ["bar-pegged", "Bar", { z: 5.4, goal: 2.4 }],
      ["bar-down", "Bar", { z: -2.3, goal: -1.8 }],
      ["box-sealed", "Box", { open: false }],
      ["box-open", "Box", { open: true }],
    ];
    for (const [name, game, value] of states) {
      await page.evaluate(
        async ({ game, value }) => {
          document.getElementById("instrument-fixture")?.remove();
          const host = document.createElement("div");
          host.id = "instrument-fixture";
          host.className = "stage lit";
          host.dataset.game = game;
          host.innerHTML = '<div class="stage-visual"></div>';
          document.body.append(host);
          const visual = host.firstElementChild;
          if (game === "Bulb") {
            const { createBulb } = await import("/js/bulb.js");
            createBulb(visual, { light: host, glassBottom: 0.72, height: 0.6, width: 0.7 }).snap(value.level);
          } else if (game === "Bar") {
            const { createBar } = await import("/js/bar.js");
            visual.style.setProperty("--meter-top", "6%");
            visual.style.setProperty("--meter-height", "88%");
            createBar(visual, { light: host }).set(value.z, value.goal);
          } else {
            const { createBox } = await import("/js/box.js");
            visual.style.setProperty("--meter-top", "4%");
            visual.style.setProperty("--meter-height", "90%");
            const box = createBox(visual, { light: host, level: 2 });
            // A made-up record from a fixed seed: a minute each way, a little your way.
            let seed = 20261011;
            const r = () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296),
              walk = (lean) => {
                let sum = 0;
                return Array.from({ length: 240 }, (_, k) => [(k + 1) / 240, (sum += Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()) + lean) / Math.sqrt(k + 1)]);
              };
            if (value.open) {
              box.ask("Up", { quiet: true });
              box.show({ parts: [{ kind: "Down", points: walk(-0.06) }, { kind: "Up", points: walk(0.09) }] }, 3);
            }
          }
        },
        { game, value },
      );
      await page.waitForTimeout(700);
      await shot("instrument-" + name);
    }
    await page.evaluate(() => document.getElementById("instrument-fixture")?.remove());

    // A real session on the stage, both directions, then stopped.
    for (const [width, height, suffix] of [
      [1440, 900, "desktop"],
      [390, 844, "phone"],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator('[data-nav="play"]').click();
      await page.locator('.instrument-card[data-game="Bulb"]').click();
      await page.locator("#begin").click();
      await page.waitForTimeout(2500);
      await shot(`stage-countdown-${suffix}`);
      const seen = new Set(),
        until = Date.now() + 120000;
      while (Date.now() < until && seen.size < 3) {
        const s = await api("/state");
        const key = s.phase || (s.state === "Transition" ? "Pause" : null);
        if (key && !seen.has(key) && (key === "Pause" ? s.remainingSeconds < 13 : s.remainingSeconds < 54)) {
          seen.add(key);
          // Let the page and the filament settle on the new state first.
          await page.waitForTimeout(1200);
          await shot(`stage-bulb-${key.toLowerCase()}-${suffix}`);
        }
        await page.waitForTimeout(300);
      }
      await page.locator("#stop").click();
      await page.locator("#stop-yes").click();
      await page.locator("#result .result-hero").waitFor();
      await shot(`result-stopped-${suffix}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-nav="play"]').click();
    await page.locator('.instrument-card[data-game="Bar"]').click();
    await page.locator("#begin").click();
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      const s = await api("/state");
      if (s.phase && s.remainingSeconds < 45) break;
      await page.waitForTimeout(300);
    }
    await shot("stage-bar-desktop");
    await lab(true);
    await page.locator("#live-details summary").click();
    await page.waitForTimeout(600);
    await shot("stage-bar-lab-desktop");
    await page.locator("#stop").click();
    await page.locator("#stop-yes").click();
    await page.locator("#result .result-hero").waitFor();
  }
  console.log("errors", errors.length ? errors : "none");
  await writeFile(new URL("screenshots.json", out), JSON.stringify({ shots, errors }, null, 2));
} finally {
  await browser.close();
}
