import { chromium } from "playwright";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Fault injection is confined to this disposable copy of the application.
// Production code has no test-only switches or altered timing thresholds.
const scratch = await mkdtemp(join(tmpdir(), "IntentionLab-storage-check-"));
const app = join(scratch, "app"),
  port = 29874,
  base = `http://127.0.0.1:${port}`;
const checks = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, helper;
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
try {
  await cp(fileURLToPath(new URL("../app", import.meta.url)), app, {
    recursive: true,
  });
  const path = join(app, "js/core/database.js"),
    original = await readFile(path, "utf8");
  const modified = original.replace(
    "export async function bump(records) {",
    'export async function bump(records) { if(records.sessions?.some(s=>s.config.simulation?.scenario === "Unbiased" && s.state === "Phase1")) throw new DOMException("Injected disk write failure", "QuotaExceededError");',
  );
  assert.notEqual(
    modified,
    original,
    "storage fault injection was applied to isolated fixture",
  );
  await writeFile(path, modified);
  helper = spawn(
    fileURLToPath(
      new URL("../dist/IntentionLab/DeviceBridge.exe", import.meta.url),
    ),
    ["--no-browser"],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        INTENTIONLAB_PORT: String(port),
        INTENTIONLAB_APP_DIR: app,
      },
    },
  );
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (helper.exitCode !== null) throw Error("Isolated test bridge exited");
    try {
      const r = await fetch(base + "/bridge/bootstrap");
      ready = r.ok;
    } catch {}
    if (ready) break;
    await pause(100);
  }
  assert.ok(ready, "isolated bridge is ready");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  async function run(scenario) {
    const context = await browser.newContext({ serviceWorkers: "block" }),
      page = await context.newPage();
    await page.goto(base);
    await page.locator("[data-app-ready]").waitFor();
    const call = (path, body, key) =>
      page.evaluate(
        async ({ path, body, key }) => {
          const a = await import("/js/api.js");
          return body === undefined ? a.request(path) : a.post(path, body, key);
        },
        { path, body, key },
      );
    await call("/connect", {
      source: "Simulation",
      simulation: {
        scenario,
        seed: 123,
        bytesPerSecond: 24000,
        commonBias: 0.001,
        intentionShift: 0,
        driftPerMinute: 0,
        failureAfterSeconds: 8,
      },
    });
    return { context, page, call };
  }
  const setup = {
    game: "Bulb",
    durationMinutes: 1,
    difficultyId: 2,
    timezone: "UTC",
  };
  async function awaitFault(call, seconds = 15) {
    let state;
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      state = await call("/state");
      if (state.state === "Faulted") break;
      await pause(100);
    }
    return state;
  }
  for (const scenario of ["Interrupted", "Disconnection"]) {
    const { context, call } = await run(scenario);
    const s = await call("/sessions/start", setup, crypto.randomUUID());
    await awaitFault(call);
    const detail = await call("/sessions/" + s.id);
    check(
      scenario + " faults without a result",
      detail.session.state === "Faulted" && detail.session.result === null,
    );
    check(
      scenario + " preserves incomplete accepted counts",
      detail.session.phases.some((p) => BigInt(p.bits) > 0),
    );
    await context.close();
  }
  const { context, page, call } = await run("Unbiased");
  const first = await call("/sessions/start", setup, crypto.randomUUID());
  await call("/sessions/" + first.id + "/abort", {});
  const second = await call("/sessions/start", setup, crypto.randomUUID());
  await call("/sessions/" + first.id + "/abort", {});
  const current = await call("/state");
  check(
    "late duplicate abort leaves new attempt running",
    current.sessionId === second.id && current.state !== "Aborted",
  );
  await call("/sessions/" + second.id + "/abort", {});
  const s = await call("/sessions/start", setup, crypto.randomUUID());
  const state = await awaitFault(call);
  check(
    "injected IndexedDB write failure faults the live attempt",
    state.state === "Faulted" && state.error.includes("IndexedDB"),
  );
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  const after = await call("/sessions/" + s.id);
  check(
    "storage failure persists as faulted after reload",
    after.session.state === "Faulted" && after.session.result === null,
  );
  const bytes = after.buckets.reduce((n, b) => n + BigInt(b.bytes), 0n);
  check(
    "faulted storage checkpoint reconciles accepted counts",
    bytes === after.session.phases.reduce((n, p) => n + BigInt(p.bytes), 0n),
  );
  // Settings, Quit, in Simple mode: the page says so and the bridge ends.
  await page.goto(base + "/#settings");
  await page.locator("[data-app-ready]").waitFor();
  await page.locator("#quit").click();
  await page.locator("#quit-screen").waitFor();
  check(
    "Quit leaves only the closing note on the page",
    (await page.locator("#quit-screen h1").textContent()) === "Intention Lab has quit" &&
      !(await page.locator("header.topbar").isVisible()) &&
      !(await page.locator("main").isVisible()),
  );
  for (let i = 0; i < 50 && helper.exitCode === null; i++) await pause(100);
  check("Quit stops the bridge process", helper.exitCode === 0);
  await context.close();
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/failures.json", import.meta.url),
    JSON.stringify({ checks }, null, 2),
  );
  console.log("TOTAL", checks.length);
} finally {
  await browser?.close();
  if (helper && helper.exitCode === null) {
    helper.kill();
    await pause(500);
  }
  const rel = relative(resolve(tmpdir()), resolve(scratch));
  if (!rel.startsWith("..") && rel.startsWith("IntentionLab-storage-check-"))
    await rm(scratch, { recursive: true, force: true });
}
