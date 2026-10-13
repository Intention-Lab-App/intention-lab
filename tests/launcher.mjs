import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const exe = fileURLToPath(
  new URL("../dist/IntentionLab/DeviceBridge.exe", import.meta.url),
);
const children = [],
  checks = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
  console.log("PASS", name);
};
let unrelated;
function launch(port, extra = {}) {
  const env = { ...process.env, INTENTIONLAB_PORT: String(port) };
  delete env.INTENTIONLAB_APP_DIR;
  const child = spawn(exe, ["--no-browser"], {
    cwd: tmpdir(),
    windowsHide: true,
    env: { ...env, ...extra },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.errors = "";
  child.stderr.on("data", (v) => (child.errors += v));
  children.push(child);
  return child;
}
async function until(action, message, seconds = 10) {
  const stop = Date.now() + seconds * 1000;
  while (Date.now() < stop) {
    const result = await action();
    if (result) return result;
    await pause(50);
  }
  throw Error(message);
}
async function hello(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/bridge/bootstrap`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function shutdown(port, token) {
  try {
    await fetch(`http://127.0.0.1:${port}/bridge/shutdown`, {
      method: "POST",
      headers: { "X-Bridge-Token": token },
    });
  } catch {}
}
try {
  const binary = await readFile(exe),
    pe = binary.readUInt32LE(0x3c),
    optional = pe + 24;
  check(
    "published executable uses Windows GUI subsystem",
    binary.readUInt16LE(optional + 68) === 2,
  );
  check(
    "published executable remains native AOT",
    binary.readUInt32LE(optional + 112 + 14 * 8) === 0,
  );
  const first = launch(29876),
    ready = await until(
      () => hello(29876),
      "Native executable did not become ready",
    );
  check(
    "native executable starts the bridge directly",
    ready.application === "IntentionLab.DeviceBridge" &&
      first.exitCode === null,
  );
  const html = await fetch("http://127.0.0.1:29876/").then((r) => r.text());
  check(
    "app folder resolves beside exe from a different working directory",
    html.includes("Intention Lab") && html.includes("js/app.js"),
  );
  const duplicate = launch(29876);
  await until(() => duplicate.exitCode !== null, "Second launch did not exit");
  check(
    "second launch reuses the existing bridge",
    duplicate.exitCode === 0 &&
      (await hello(29876)).status.instanceId === ready.status.instanceId,
  );
  await shutdown(29876, ready.token);
  await until(() => first.exitCode !== null, "Bridge did not stop");
  check("normal shutdown releases the bridge", first.exitCode === 0);
  // Open pages ping the bridge; it quits once none has for the idle limit.
  const idle = launch(29876, { INTENTIONLAB_IDLE_SECONDS: "2" });
  await until(() => hello(29876), "Idle-test bridge did not become ready");
  for (const end = Date.now() + 4000; Date.now() < end; await pause(500))
    await fetch("http://127.0.0.1:29876/bridge/status");
  check("bridge keeps running while a page pings it", idle.exitCode === null);
  const lastPing = Date.now();
  await until(() => idle.exitCode !== null, "Idle bridge did not quit");
  check(
    "bridge quits on its own after the idle limit",
    idle.exitCode === 0 && Date.now() - lastPing >= 1500,
  );
  const race = [launch(29877), launch(29877)];
  const winner = await until(
    () => hello(29877),
    "Concurrent launch did not become ready",
  );
  await until(
    () => race.some((c) => c.exitCode !== null),
    "Concurrent duplicate did not exit",
  );
  check(
    "simultaneous launches create only one running bridge",
    race.filter((c) => c.exitCode === null).length === 1 &&
      race.find((c) => c.exitCode !== null).exitCode === 0,
  );
  await shutdown(29877, winner.token);
  await until(
    () => race.every((c) => c.exitCode !== null),
    "Concurrent winner did not stop",
  );
  unrelated = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        protocol: 1,
        application: "Other application",
        status: { instanceId: crypto.randomUUID() },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    unrelated.once("error", reject);
    unrelated.listen(29878, "127.0.0.1", resolve);
  });
  const conflict = launch(29878);
  await until(() => conflict.exitCode !== null, "Port conflict did not fail");
  check(
    "unrelated local service is not mistaken for this application",
    conflict.exitCode === 1,
  );
  check(
    "port conflict produces a readable error",
    conflict.errors.includes("cannot use port 29878"),
  );
  const missing = launch(29879, {
    INTENTIONLAB_APP_DIR: exe + ".missing-folder",
  });
  await until(
    () => missing.exitCode !== null,
    "Missing app folder did not fail",
  );
  check(
    "missing app folder produces an actionable error",
    missing.exitCode === 1 && missing.errors.includes("App folder not found"),
  );
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/launcher.json", import.meta.url),
    JSON.stringify(
      {
        checks,
        artifact: {
          bytes: binary.length,
          sha256: createHash("sha256").update(binary).digest("hex"),
        },
      browserOpening:
        "Automated checks use --no-browser; this suite does not inspect the desktop browser window.",
      },
      null,
      2,
    ),
  );
  console.log("TOTAL", checks.length);
} finally {
  if (unrelated) await new Promise((resolve) => unrelated.close(resolve));
  await Promise.all(children.map(child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    return new Promise(resolve => { child.once('exit',resolve); child.kill(); });
  }));
}
