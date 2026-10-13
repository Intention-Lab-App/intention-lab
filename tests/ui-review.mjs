// Interface review: the Play and Lab layers, setup, keyboard use, preferences
// frozen at start, the immersive stage, stopping, responsive layouts and the
// refusal to run against a capture worker from another version. Simulation only.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872";
const checks = [],
  errors = [],
  out = new URL("../test-results/ui/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
let hardwareDisconnectRequests = 0;
page.on("request", (r) => {
  if (r.url().endsWith("/bridge/disconnect") && r.method() === "POST") hardwareDisconnectRequests++;
});
page.on("pageerror", (e) => errors.push(e.message));
const check = (name, v) => {
  assert.ok(v, name);
  checks.push(name);
  console.log("PASS", name);
};
const shot = async (name, fullPage = true) =>
  page.screenshot({ path: new URL(name + ".png", out).pathname.replace(/^\/([A-Z]:)/, "$1"), fullPage });
const api = (path, body) =>
  page.evaluate(
    async ({ path, body }) => {
      const a = await import("/js/api.js");
      return body ? a.post(path, body) : a.request(path);
    },
    { path, body },
  );
const visibleText = () => page.evaluate(() => document.body.innerText);
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const PLAY_JARGON = /\b(Z|p-value|per million|active|idle|interval|provisional|descriptive|model-based|exploratory|pooled|bootstrap)\b/i;
try {
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  check("the instruments are the first screen", await page.locator(".instruments").isVisible());
  check("three instruments to choose from", (await page.locator(".instrument-card").count()) === 3);
  check("Play starts without the Lab", (await page.locator("html").getAttribute("data-lab")) === "off");
  check(
    "the header switch names both modes and marks Simple",
    (await page.locator(".topbar .mode button").allInnerTexts()).join(",") === "Simple,Lab" &&
      (await page.locator('.topbar [data-mode="simple"]').getAttribute("aria-pressed")) === "true",
  );
  check("no product names on screen", !/truerng|ubld/i.test(await visibleText()));
  check("no research vocabulary on the home screen", !PLAY_JARGON.test(await visibleText()));
  // The instruments' sound, rendered offline: its shape, its level and its pace.
  const audio = await page.evaluate(async () => {
    const s = await import("/js/sound.js"),
      rate = 44100,
      measure = (x, from, to) => {
        let e = 0,
          p = 0,
          crossings = 0;
        for (let n = from; n < to; n++) {
          e += x[n] * x[n];
          p = Math.max(p, Math.abs(x[n]));
          if (n > from && x[n - 1] < 0 !== x[n] < 0) crossings++;
        }
        return {
          rms: 20 * Math.log10(Math.sqrt(e / (to - from)) || 1e-9),
          peak: 20 * Math.log10(p || 1e-9),
          crossingsPerSecond: (crossings * rate) / (to - from),
        };
      };
    const levels = [-1, 0, 0.8],
      ctx = new OfflineAudioContext(2, rate * 1.5 * levels.length, rate),
      out = s.createOutput(ctx),
      bulb = s.createBulbVoice(ctx, out, 100);
    out.volume.gain.value = 0.9;
    levels.forEach((l, i) => bulb.set(l, i * 1.5));
    const x = (await ctx.startRendering()).getChannelData(0),
      lamp = levels.map((l, i) => measure(x, Math.floor((i * 1.5 + 0.6) * rate), Math.floor((i + 1) * 1.5 * rate)));
    // The strongest frequency between lo and hi, by a scan of single DFT bins.
    const strongest = (x, from, to, lo, hi, step) => {
      let best = 0,
        at = lo;
      for (let f = lo; f <= hi; f += step) {
        let re = 0,
          im = 0;
        for (let n = from; n < to; n++) {
          const w = (2 * Math.PI * f * n) / rate;
          re += x[n] * Math.cos(w);
          im += x[n] * Math.sin(w);
        }
        if (re * re + im * im > best) [best, at] = [re * re + im * im, f];
      }
      return at;
    };
    // The Bar's voice at three steady readings: its pitch follows the needle.
    const meter = [];
    for (const z of [-4, 0, 4]) {
      const c = new OfflineAudioContext(2, rate * 2, rate),
        o = s.createOutput(c, c.destination, { shared: false }),
        voice = s.createMeterVoice(c, o, 100);
      o.volume.gain.value = 1;
      voice.follow(z, true, 0);
      const x = (await c.startRendering()).getChannelData(0);
      meter.push({ z, pitch: strongest(x, rate, rate + 8192, 150, 1000, 2), ...measure(x, rate, 2 * rate) });
    }
    // The Box's drone: its level, its beat early on (from the envelope), its two
    // tones parted between the ears only with headphones, and how far its level
    // moves from one second to the next: it must not swell, or it would seem to
    // answer.
    const drone = async (phones) => {
      const c = new OfflineAudioContext(2, rate * 21, rate),
        o = s.createOutput(c, c.destination, { shared: false }),
        voice = s.createBoxVoice(c, o, { phones, hum: 100 });
      o.volume.gain.value = 1;
      const buffer = await c.startRendering(),
        left = buffer.getChannelData(0),
        right = buffer.getChannelData(1);
      let apart = 0,
        total = 0;
      for (let n = 4 * rate; n < 6 * rate; n++) {
        apart += (left[n] - right[n]) ** 2;
        total += left[n] ** 2 + right[n] ** 2;
      }
      // The envelope in 10 ms steps, and its strongest pulse between 4 and 14 a second.
      const block = rate / 100,
        envelope = [];
      for (let n = 4 * rate; n + block <= 6 * rate; n += block) {
        let e = 0;
        for (let k = 0; k < block; k++) e += left[n + k] * left[n + k] + right[n + k] * right[n + k];
        envelope.push(Math.sqrt(e / block));
      }
      const mean = envelope.reduce((p, v) => p + v, 0) / envelope.length;
      let best = 0,
        beat = 0;
      for (let f = 4; f <= 14; f += 0.1) {
        let re = 0,
          im = 0;
        envelope.forEach((v, i) => {
          re += (v - mean) * Math.cos((2 * Math.PI * f * i) / 100);
          im += (v - mean) * Math.sin((2 * Math.PI * f * i) / 100);
        });
        if (re * re + im * im > best) [best, beat] = [re * re + im * im, f];
      }
      const seconds = Array.from({ length: 18 }, (_, i) => measure(left, (3 + i) * rate, (4 + i) * rate).rms),
        steadiness = Math.max(...seconds) - Math.min(...seconds);
      return { beat, steadiness, apart: apart / total, ...measure(left, 4 * rate, 6 * rate) };
    };
    const box = { speakers: await drone(false), phones: await drone(true) };
    return { lamp, meter, box };
  });
  check(
    "the dark bulb is silent, the dimmed bulb buzzes, the bright bulb hums low, and nothing clips",
    audio.lamp[0].rms < -45 &&
      audio.lamp[1].rms > -30 &&
      audio.lamp[1].crossingsPerSecond > 600 &&
      audio.lamp[2].crossingsPerSecond < 400 &&
      audio.lamp.every((l) => l.peak < -1),
  );
  check(
    "the bar sings 216 Hz at -4, 432 at zero and 864 at +4, audibly and without clipping",
    audio.meter.every((m) => Math.abs(m.pitch / (432 * 2 ** (m.z / 4)) - 1) < 0.02 && m.rms > -40 && m.peak < -1),
  );
  check(
    "the box drones at a steady level without clipping, beats near 10 a second at first, and parts its tones only in headphones",
    audio.box.speakers.rms > -45 &&
      audio.box.speakers.peak < -1 &&
      audio.box.speakers.steadiness < 1.5 &&
      Math.abs(audio.box.speakers.beat - 10) < 1.2 &&
      audio.box.speakers.apart < 0.01 &&
      audio.box.phones.apart > 0.05,
  );
  await shot("01-home-desktop", false);
  await page.locator('.instrument-card[data-game="Bulb"]').focus();
  await page.keyboard.press("Enter");
  check("keyboard choice opens setup", await page.locator("#setup").isVisible());
  check("setup is one screen", (await page.locator("#levels input").count()) === 5 && (await page.locator("#durations input").count()) === 4);
  check(
    "Easy and one minute are the defaults",
    (await page.locator('#levels input[value="1"]').isChecked()) && (await page.locator('#durations input[value="1"]').isChecked()),
  );
  for (let i = 1; i <= 5; i++) {
    await page.locator(`#levels label:has(input[value="${i}"])`).click();
    check("level " + i + " can be chosen", await page.locator(`#levels input[value="${i}"]`).isChecked());
  }
  await page.locator('#levels label:has(input[value="2"])').click();
  await page.locator('#durations label:has(input[value="5"])').click();
  check("time each way and total are shown", (await page.locator("#time-line").innerText()).startsWith("10 minutes of play"));
  check("no research vocabulary in setup", !PLAY_JARGON.test(await visibleText()));
  await page.locator("#preview").click();
  await page.waitForTimeout(1500);
  check(
    "the preview is labelled and changes nothing",
    (await page.locator("#preview-note").innerText()).includes("random data") &&
      (await page.locator("#preview").getAttribute("aria-pressed")) === "true" &&
      (await api("/sessions?source=Simulation")).total === 0 &&
      (await api("/sessions?source=Hardware")).total === 0,
  );
  await shot("02-setup-preview", false);
  await page.locator("#preview").click();
  check(
    "without a source, Begin asks to connect",
    (await api("/state")).connected || (await page.locator("#begin").innerText()) !== "Begin",
  );
  await shot("03-setup-desktop", false);

  // The guide: plain words in Play, the equations in the Lab.
  await page.locator("#setup legend .info").click();
  await page.locator("#guide[open]").waitFor();
  check("the difficulty i opens the guide at levels and goals", await page.evaluate(() => document.activeElement?.id === "guide-levels"));
  check(
    "the guide opens with the two modes",
    /Simple/.test(await page.locator("#guide .guide-modes").innerText()) &&
      /Lab/.test(await page.locator("#guide .guide-modes").innerText()) &&
      (await page.locator("#guide .guide-modes .mode").count()) === 1,
  );
  check("the guide names no product", !/truerng|ubld/i.test(await page.locator("#guide").innerText()));
  check(
    "the Play guide explains every step without equations",
    (await page.locator("#guide math").count()) === 0 && (await page.locator("#guide .guide-topic").count()) === 9,
  );
  check("the guide lists every level's goal", (await page.locator("#guide .goal-list button").count()) === 5);
  await page.locator('#guide .goal-list [data-level="5"]').click();
  check(
    "picking a level in the guide moves its goal on the chance curve",
    (await page.locator('#guide .goal-list [data-level="5"]').getAttribute("aria-pressed")) === "true" &&
      /1 in 10,000/.test(await page.locator("#guide .ch-goal").textContent()),
  );
  check(
    "the guide shows the real bulb, bar and box in their states",
    (await page.locator("#guide [data-fig-bulb] canvas").count()) === 3 &&
      (await page.locator("#guide [data-fig-bar] svg").count()) === 3 &&
      (await page.locator("#guide [data-fig-box] svg").count()) === 2,
  );
  check("every guide topic has its icon", (await page.locator("#guide .guide-topic h3 .icon").count()) === 9);
  check("the guide explains the challenge", /promise made before you start/.test(await page.locator("#guide-challenge").innerText()));
  check(
    "the guide says the bits pass an XOR mask and what a real effect would take",
    /XOR mask/.test(await page.locator("#guide-measure").innerText()) &&
      /challenge/i.test(await page.locator("#guide-evidence").innerText()),
  );
  await page.keyboard.press("Escape");
  check("Escape closes the guide", !(await page.locator("#guide").evaluate((d) => d.open)));

  // Lab layer: research controls appear only when asked for.
  await page.locator('[data-nav="settings"]').click();
  await page.locator("#settings-content .mode").waitFor();
  check("Settings in Play: device, backup, the Lab switch and the guide", await page.locator("#preferences-form").isHidden());
  check("Settings opens the guide", (await page.locator('#settings-content [data-guide="session"]').count()) === 1);
  check("Quit is offered in Simple mode", await page.locator("#quit").isVisible());
  await shot("04-settings-play");
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  check("the Lab switch shows research tools", (await page.locator("html").getAttribute("data-lab")) === "on");
  await page.locator(".topbar-end .guide-button").click();
  await page.locator("#guide[open]").waitFor();
  check(
    "the Lab guide is the same guide with equations and details under each step",
    (await page.locator("#guide math").count()) >= 10 &&
      (await page.locator("#guide .guide-topic").count()) === 9 &&
      (await page.locator("#guide .guide-topic .detail").count()) === 9 &&
      (await page.locator("#guide").innerText()).includes("updown-v2"),
  );
  await page.locator("#guide [data-close]").click();
  await page.locator("#preferences-form").waitFor();
  check("Quit is offered in Lab mode too", await page.locator("#quit").isVisible());
  await page.waitForTimeout(400);
  check(
    "the XOR mask is on by default and its warning shows only when it is turned off",
    (await page.locator("#xor-mask").isChecked()) && (await page.locator("#xor-warning").isHidden()),
  );
  await page.locator("#xor-mask").uncheck();
  check("turning the XOR mask off shows a clear warning", /kept apart/.test(await page.locator("#xor-warning").innerText()) && (await page.locator("#xor-warning").isVisible()));
  await page.locator("#xor-mask").check();
  await page.locator("#record-raw").check();
  await page.locator("#preferences-form button[type=submit]").click();
  await page.waitForTimeout(300);
  await page.locator("#timezone").fill("UTC");
  await page.locator("#timezone-form button").click();
  await page.waitForTimeout(200);
  await shot("05-settings-lab");
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  await page.locator("#preferences-form").waitFor();
  await page.waitForTimeout(400);
  check("the Lab choice is remembered in this browser", (await page.locator("html").getAttribute("data-lab")) === "on");
  check("saved options persist apart from the time zone", await page.locator("#record-raw").isChecked());

  // Simulation through the Lab device dialog.
  await page.locator("#settings-device").click();
  await page.locator("#device-dialog[open]").waitFor();
  await page.locator('#source-choice label:has(input[value="Simulation"])').click();
  await page.locator("#sim-rate").fill("1");
  await page.locator("#connect").click();
  await page.locator("#device-dialog .dialog-message.error").waitFor();
  check(
    "connection errors stay inside the open dialog",
    (await page.locator("#device-dialog .dialog-message.error").innerText()).includes("Invalid simulation"),
  );
  await page.locator("#sim-rate").fill("50000");
  await page.locator("#connect").click();
  await page.locator("#device-word", { hasText: "Simulation" }).waitFor();
  check("simulation does not disconnect hardware it does not own", hardwareDisconnectRequests === 0);
  await shot("06-device-dialog-lab", false);

  // Back to Play, start a Bar session, then stop it.
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator('[data-nav="play"]').click();
  await page.locator('.instrument-card[data-game="Bar"]').click();
  await page.locator('#levels label:has(input[value="2"])').click();
  await page.locator('#durations label:has(input[value="1"])').click();
  check(
    "sound is on by default, with a switch on the setup screen that says what it plays",
    (await page.locator("#sound").isChecked()) && /sings its reading like a theremin/.test(await page.locator("#sound-line").innerText()),
  );
  await page.locator("#sound").uncheck();
  await page.waitForTimeout(400);
  check("switching sound off is saved", !(await page.locator("#sound").isChecked()) && /Off/.test(await page.locator("#sound-line").innerText()));
  await page.locator("#begin").click();
  await page.locator("#stage").waitFor({ state: "visible" });
  const started = await api("/state");
  check(
    "options and display settings are frozen before measurement",
    started.config.presentation.showDifficultyMarker === true &&
      started.config.recordRaw === true &&
      started.config.presentation.reducedMotion === true &&
      started.config.presentation.sound === false &&
      started.config.presentation.version === "tungsten-ui-v5" &&
      started.config.protocolVersion === "updown-v2" &&
      typeof started.upFirst === "boolean",
  );
  check("the stage hides the header", await page.locator(".topbar").isHidden());
  check("the stage shows one clock and a two-part track", (await page.locator(".clock").count()) === 1 && (await page.locator("#track .seg").count()) === 2);
  check("the stage keeps research details out of Play", await page.locator("#live-details").isHidden());
  await page.waitForTimeout(8500);
  await shot("07-stage-bar", false);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(1300);
  await page.locator("#stop").click();
  check("stopping asks first, on the stage", await page.locator("#stop-confirm").isVisible());
  await page.locator("#stop-no").click();
  check("keep going continues the session", (await api("/state")).state !== "Aborted");
  await page.locator("#stop").click();
  await page.locator("#stop-yes").click();
  await page.locator("#result .result-hero").waitFor();
  check("a stopped session says so", (await page.locator("#result .verdict").innerText()) === "Stopped early.");
  const retained = await api("/sessions/" + started.sessionId);
  check(
    "a motion change during capture is audited",
    retained.events.some((e) => e.kind === "Display motion preference changed"),
  );
  check("the starting display configuration stays as recorded", retained.session.config.presentation.reducedMotion === true);
  check("the stopped attempt is kept without a score", retained.session.state === "Aborted" && retained.session.score === null);
  await shot("08-stopped", false);

  // History in Play, and in the Lab.
  await page.locator('[data-nav="history"]').click();
  await page.locator(".history-list, .empty").first().waitFor();
  check(
    "Play history follows the connected simulation and labels it",
    (await page.locator(".history-row").count()) === 1 &&
      (await page.locator(".page-head h1 .tag.sim").isVisible()),
  );
  check("the stopped attempt is listed without a score", (await page.locator(".row-score.none").count()) === 1);
  check("no filters in Play history", (await page.locator("#history-filters").count()) === 0);
  await shot("09-history-play");

  // Profiles: the Default renamed, a second added; each sees only its own
  // sessions and remembers its own level and length for each game.
  const historyLoaded = async () => {
    // Leave History first, so the list is rendered afresh for the profile in use.
    await page.locator('[data-nav="play"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-nav="history"]').click();
    await page.waitForFunction(() => {
      const list = document.getElementById("history-list");
      return list && !list.textContent.includes("Loading");
    });
    await page.waitForTimeout(300);
    return page.locator(".history-row").count();
  };
  const barLevel = async () => {
    await page.locator('[data-nav="play"]').click();
    await page.locator('.instrument-card[data-game="Bar"]').click();
    const value = await page.locator("#levels input:checked").getAttribute("value");
    await page.locator('[data-to="home"]').click();
    return value;
  };
  const inUse = (name) =>
    page.waitForFunction((n) => document.getElementById("profile")?.selectedOptions[0]?.textContent === n, name);
  const rename = async (name) => {
    await page.locator("#profile-name").fill(name);
    await page.locator("#profile-rename button").click();
    await inUse(name);
  };
  await page.locator('[data-nav="settings"]').click();
  await page.locator("#profile").waitFor();
  check("one profile, the Default, is in use from the start", (await page.locator("#profile option").allInnerTexts()).join(",") === "Default");
  await rename("Dana");
  await page.locator("#profile-add").click();
  await inUse("Profile 2");
  await rename("Sam");
  const samRows = await historyLoaded(),
    samLevel = await barLevel(),
    playingAs = await page.locator("#home-profile").innerText();
  await page.locator('[data-nav="settings"]').click();
  await page.locator("#profile").selectOption({ label: "Dana" });
  await inUse("Dana");
  const danaRows = await historyLoaded(),
    danaLevel = await barLevel();
  console.log("profile rows: Sam", samRows, "Dana", danaRows);
  check("each profile sees only its own sessions", samRows === 0 && danaRows === 1);
  check("each profile remembers its own level for each game", samLevel === "1" && danaLevel === "2");
  check("the home screen names the profile in use once there are two", playingAs.includes("Playing as Sam"));
  await historyLoaded();
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();
  await page.locator("#history-filters").waitFor();
  await page.locator('#history-filters select[name="source"]').selectOption("Simulation");
  await page.locator("#history-filters button[type=submit]").click();
  await page.locator(".history-row").first().waitFor();
  check("the Lab filters show the simulation attempt", (await page.locator(".history-row").count()) === 1);
  check("the order filter offers both directions", (await page.locator('#history-filters select[name="order"] option').count()) === 3);
  const csv = await page.evaluate(async () =>
    (await import("/js/core/transfer.js")).csvExport({ filter: { source: "Simulation" } }),
  );
  check(
    "CSV includes direction counts, score and interface settings",
    csv.includes('"up_bits"') && csv.includes('"score_version"') && csv.includes('"presentation_version"') && csv.includes('"tungsten-ui-v5"') && csv.includes('"sound"'),
  );
  await shot("10-history-lab");
  await page.locator('.topbar [data-mode]:not([aria-pressed="true"])').click();

  // Challenge: chosen on one screen, played session by session, given up and kept.
  check("the Challenge is in the menu in Simple mode", await page.locator('[data-nav="challenge"]').isVisible());
  await page.locator('[data-nav="challenge"]').click();
  await page.locator("#challenge-form").waitFor();
  for (const [name, value] of [["game", "Bulb"], ["level", "1"], ["minutes", "1"], ["sessions", "5"]])
    await page.locator(`#challenge-form label:has(input[name="challenge-${name}"][value="${value}"])`).click();
  check(
    "the commitment is stated before Begin",
    /You commit to 5 sessions of Bulb at Easy, 1 minute each way/.test(await page.locator("#challenge-commitment").innerText()),
  );
  await shot("12-challenge-start");
  await page.locator('#challenge-form button[type="submit"]').click();
  await page.locator("#stage").waitFor({ state: "visible" });
  const first = await api("/state");
  check(
    "Begin starts the first challenge session at once, on its settings",
    !!first.config.challengeId && first.config.game === "Bulb" && first.config.difficulty.id === 1 && first.config.durationMinutes === 1,
  );
  const stopNow = async () => {
    await page.locator("#stop").click();
    await page.locator("#stop-yes").click();
    await page.locator("#result .result-hero").waitFor();
  };
  await stopNow();
  const nextButton = page.locator('#result [data-act="primary"]');
  check(
    "the result offers the next challenge session",
    (await nextButton.innerText()) === "Play session 2 of 5" && (await page.locator("#result .tag", { hasText: "Challenge" }).count()) === 1,
  );
  await nextButton.click();
  await page.locator("#stage").waitFor({ state: "visible" });
  check("the next session joins the same challenge", (await api("/state")).config.challengeId === first.config.challengeId);
  await stopNow();
  await page.locator('[data-nav="play"]').click();
  await page.locator("#home-challenge").waitFor();
  check("the home screen shows the challenge", /Challenge: 2 of 5/.test(await page.locator("#home-challenge").innerText()));
  await page.locator("#home-challenge-button").click();
  await page.locator("#challenge-play").waitFor();
  check(
    "the challenge page shows its progress and the next session",
    (await page.locator(".strip-cell").count()) === 5 &&
      (await page.locator(".strip-cell.played").count()) === 2 &&
      (await page.locator("#challenge-play").innerText()) === "Play session 3" &&
      (await page.locator(".challenge .history-row").count()) === 2,
  );
  await shot("13-challenge-running");
  await page.locator('[data-nav="history"]').click();
  await page.locator(".history-row").first().waitFor();
  check("History tags challenge sessions", (await page.locator(".history-row .tag", { hasText: "Challenge" }).count()) === 2);
  await page.locator('[data-nav="challenge"]').click();
  await page.locator("#give-up").click();
  check("giving up asks first", await page.locator("#give-up-confirm").isVisible());
  await page.locator("#give-up-yes").click();
  await page.locator('.challenge[data-status="Given up"]').waitFor();
  check("a given-up challenge is kept and marked", /Given up after 2 of 5/.test(await page.locator(".challenge").innerText()));
  await page.locator('a.back[href="#challenge"]').click();
  await page.locator("#challenge-form").waitFor();
  check("past challenges are listed with the new-challenge form", (await page.locator(".challenge-past .history-row").count()) === 1);

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [nav, name] of [["play", "home"], ["challenge", "challenge"], ["history", "history"], ["progress", "progress"], ["settings", "settings"]]) {
      await page.locator(`[data-nav="${nav}"]`).click();
      await page.waitForTimeout(500);
      check(`${name} fits at ${width}px`, await noOverflow());
      await shot(`11-${name}-${width}`);
    }
    await page.locator('[data-nav="play"]').click();
    await page.locator('.instrument-card[data-game="Bulb"]').click();
    await page.waitForTimeout(400);
    check(`setup fits at ${width}px`, await noOverflow());
    await shot(`11-setup-${width}`);
    await page.locator(".back").first().click();
  }
  check("no JavaScript errors", errors.length === 0);

  // A capture worker from another version must not run this interface.
  const oldContext = await browser.newContext({ serviceWorkers: "block" });
  const oldPage = await oldContext.newPage();
  await oldPage.addInitScript(() => {
    window.SharedWorker = class {
      constructor() {
        this.port = {
          start() {},
          postMessage(message) {
            queueMicrotask(() =>
              this.onmessage?.({ data: { id: message.id, value: { engineApiVersion: 0, state: "Ready", connected: false } } }),
            );
          },
        };
      }
    };
  });
  await oldPage.goto(base);
  await oldPage.locator("#toast.error").waitFor();
  check(
    "a capture worker from another version is refused with instructions",
    (await oldPage.locator("#toast.error").innerText()).includes("close all Intention Lab tabs") &&
      !(await oldPage.evaluate(() => document.body.dataset.appReady)),
  );
  await oldContext.close();
  await writeFile(new URL("review.json", out), JSON.stringify({ checks, errors }, null, 2));
  console.log("TOTAL", checks.length);
} finally {
  await browser.close();
}
