import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.INTENTIONLAB_TEST_URL || "http://127.0.0.1:29872",
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  context = await browser.newContext(),
  page = await context.newPage();
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
  const d = (await api("/ports")).devices.find((d) => d.familyHint && d.port);
  assert.ok(d);
  await api("/connect", { source: "Hardware", deviceId: d.id });
  const s = await api(
    "/references/start",
    {
      game: "Bulb",
      durationMinutes: 5,
      difficultyId: 2,
      timezone: "UTC",
      notes: "Automated five-minute reference bench capture",
    },
    crypto.randomUUID(),
  );
  console.log("START five-minute hardware reference", d.port, d.deviceType);
  const until = Date.now() + 320000;
  while (Date.now() < until) {
    const current = await api("/state");
    if (["Completed", "Faulted"].includes(current.state)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const detail = await api("/sessions/" + s.id),
    references = await api("/references");
  assert.equal(detail.session.state, "Completed", detail.session.failureReason);
  assert.equal(
    detail.session.phases[0].end - detail.session.phases[0].start,
    300,
  );
  const r = references.captures.find((r) => r.id === s.id);
  assert.ok(r);
  assert.equal(r.bits, detail.session.phases[0].bits);
  assert.equal(detail.buckets.length, 1200);
  await page.reload();
  await page.locator("[data-app-ready]").waitFor();
  assert.ok((await api("/references")).captures.find((x) => x.id === r.id));
  const attempt = await api(
    "/sessions/start",
    {
      game: "Bar",
      durationMinutes: 1,
      difficultyId: 5,
      timezone: "UTC",
      referenceId: r.id,
    },
    crypto.randomUUID(),
  );
  assert.equal(attempt.config.reference.id, r.id);
  assert.equal(attempt.config.reference.ones, r.ones);
  await api("/sessions/" + attempt.id + "/abort", {});
  await api("/disconnect");
  await mkdir(new URL("../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../test-results/reference.json", import.meta.url),
    JSON.stringify(
      { checks: 7, reference: r, buckets: detail.buckets.length },
      null,
      2,
    ),
  );
  console.log("PASS 7 real reference checks", r.bits, "bits");
} finally {
  await browser.close();
}
