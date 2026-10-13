import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

// An isolated native helper on its own port. Requires the attached TrueRNG.
const base = "http://127.0.0.1:29875",
  checks = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
let helper, browser, owner;
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS", name);
};
async function launch() {
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
        INTENTIONLAB_PORT: "29875",
        INTENTIONLAB_APP_DIR: fileURLToPath(
          new URL("../dist/IntentionLab/app", import.meta.url),
        ),
      },
    },
  );
  for (let i = 0; i < 50; i++) {
    if (helper.exitCode !== null) throw Error("Test bridge exited");
    try {
      const r = await fetch(base + "/bridge/bootstrap");
      if (r.ok) return await r.json();
    } catch {}
    await pause(100);
  }
  throw Error("Test bridge did not start");
}
try {
  const hello = await launch(),
    devices = await fetch(base + "/bridge/devices").then((r) => r.json()),
    device = devices.find((d) => d.familyHint && d.port);
  assert.ok(device, "Attached TrueRNG required");
  const connected = await fetch(base + "/bridge/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": hello.token,
    },
    body: JSON.stringify({ deviceId: device.id }),
  }).then((r) => r.json());
  assert.ok(connected.connected);
  owner = new WebSocket(base.replace("http:", "ws:") + "/bridge/stream");
  await new Promise((resolve, reject) => {
    owner.onopen = () => owner.send(JSON.stringify({ token: hello.token }));
    owner.onmessage = (e) => {
      if (typeof e.data === "string") resolve();
    };
    owner.onerror = reject;
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(base);
  await page.locator("[data-app-ready]").waitFor();
  const api = (path, body, key) =>
    page.evaluate(
      async ({ path, body, key }) => {
        const a = await import("/js/api.js");
        return body === undefined ? a.request(path) : a.post(path, body, key);
      },
      { path, body, key },
    );
  check(
    "another subscriber cannot appear ready",
    (await api("/state")).connected === false,
  );
  let rejected = false;
  try {
    await api(
      "/sessions/start",
      {
        game: "Bulb",
        durationMinutes: 1,
        difficultyId: 2,
        timezone: "UTC",
      },
      crypto.randomUUID(),
    );
  } catch {
    rejected = true;
  }
  check(
    "unowned stream cannot create a measured attempt",
    rejected && (await api("/sessions")).total === 0,
  );
  check(
    "competing consumer leaves original stream intact",
    owner.readyState === WebSocket.OPEN &&
      (await fetch(base + "/bridge/status").then((r) => r.json())).connected,
  );
  owner.close();
  await pause(350);
  const ready = await api("/connect", {
    source: "Hardware",
    deviceId: device.id,
  });
  check(
    "connect resolves only after authenticated stream is ready",
    ready.connected === true,
  );
  const before = (await fetch(base + "/bridge/status").then((r) => r.json()))
    .streamId;
  await api("/connect", { source: "Hardware", deviceId: device.id });
  check(
    "repeated connect preserves the existing stream",
    (await fetch(base + "/bridge/status").then((r) => r.json())).streamId ===
      before,
  );
  const s = await api(
    "/sessions/start",
    {
      game: "Bar",
      durationMinutes: 1,
      difficultyId: 2,
      timezone: "UTC",
    },
    crypto.randomUUID(),
  );
  await pause(9500);
  helper.kill();
  await pause(7000);
  const state = await api("/state");
  check(
    "abrupt native bridge death faults the attempt",
    state.state === "Faulted",
  );
  const faulted = await api("/sessions/" + s.id);
  check(
    "bridge death preserves accepted counts without a paired result",
    faulted.session.result === null &&
      faulted.session.phases.some((p) => BigInt(p.bits) > 0),
  );
  const next = await launch();
  check(
    "restart produces a distinct bridge identity",
    next.status.instanceId !== hello.status.instanceId,
  );
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  const after = await api("/sessions/" + s.id);
  check(
    "reopened app retains fault and never resumes old attempt",
    after.session.state === "Faulted" &&
      JSON.stringify(after.session.phases) ===
        JSON.stringify(faulted.session.phases),
  );
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/ownership.json", import.meta.url),
    JSON.stringify({ checks }, null, 2),
  );
  console.log("TOTAL", checks.length);
} finally {
  owner?.close();
  await browser?.close();
  if (helper && helper.exitCode === null) helper.kill();
}
