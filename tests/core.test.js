import test from "node:test";
import assert from "node:assert/strict";
import {
  pair,
  normalTail,
  normalQuantile,
  tQuantile,
  mean,
  signSwap,
  bootstrap,
  live,
  Smoother,
  Random,
  intentionToTreat,
} from "../app/js/core/statistics.js";
import { Capture, popcount } from "../app/js/core/capture.js";
import {
  schedule,
  DIFFICULTIES,
  VERSION,
  STATS,
  POLICY,
  XOR_TEMPLATE,
  GAMES,
  validateSetup,
  goalFor,
} from "../app/js/core/protocol.js";
import { Simulator } from "../app/js/core/simulation.js";
import { csvCell } from "../app/js/core/transfer.js";
import { select, eligible, calendar } from "../app/js/core/selection.js";
import { preferences, PRESENTATION_VERSION, profilesOf, checkProfiles } from "../app/js/core/preferences.js";
import { needleAngle, SPRING } from "../app/js/bar.js";
import { boxRecord } from "../app/js/box.js";
import { instruction, direction, aiming } from "../app/js/format.js";
import {
  SCORE_VERSION,
  rawScore,
  scoreValue,
  sessionScore,
  overallScore,
  chance,
  weightFor,
} from "../app/js/core/score.js";
test("advanced preferences default safely and reject invalid values", () => {
  assert.equal(preferences().showDifficultyMarker, true);
  assert.equal(
    preferences({ showDifficultyMarker: false }).showDifficultyMarker,
    false,
  );
  assert.equal(preferences().sound, true);
  assert.equal(preferences({ sound: false }).sound, false);
  assert.throws(() => preferences({ sound: "off" }));
  assert.throws(() => preferences({ recordRaw: "false" }));
  assert.throws(() => preferences({ referenceId: {} }));
});
test("there is always a Default profile, and saved profiles are checked", () => {
  const fresh = profilesOf({});
  assert.deepEqual(fresh.list.map((p) => [p.id, p.name]), [["default", "Default"]]);
  assert.equal(fresh.current.id, "default");
  const two = [
    { id: "default", name: "  Dana   R ", choices: { Box: { level: 1, minutes: 1 }, last: "Box" } },
    { id: "ab12cd34", name: "Sam", choices: {} },
  ];
  const clean = checkProfiles(two, "ab12cd34");
  assert.equal(clean[0].name, "Dana R");
  assert.deepEqual(clean[0].choices, { Box: { level: 1, minutes: 1 }, last: "Box" });
  assert.equal(profilesOf({ profiles: clean, profileId: "ab12cd34" }).current.name, "Sam");
  assert.equal(profilesOf({ profiles: clean, profileId: "gone" }).current.id, "default", "an unknown choice falls back to the first");
  assert.throws(() => checkProfiles([], "default"));
  assert.throws(() => checkProfiles(two, "nobody"));
  assert.throws(() => checkProfiles([two[1], { ...two[1] }], "ab12cd34"), "ids are unique");
  assert.throws(() => checkProfiles([{ id: "x", name: "   " }], "x"), "a profile has a name");
  assert.throws(() => checkProfiles([{ id: "x", name: "X", choices: { Bar: { level: 9, minutes: 1 } } }], "x"));
  assert.throws(() => checkProfiles([{ id: "x", name: "X", choices: { last: "Bulb" } }], "x"), "the last game has a choice");
});
test("each profile sees only its own sessions; sessions from before profiles are the Default's", () => {
  const older = session(),
    dana = session(),
    sam = session();
  for (const s of [older, dana, sam]) Object.assign(s.config, { source: "Hardware", xorMask: XOR_TEMPLATE });
  delete older.config.profileId;
  dana.config.profileId = "default";
  sam.config.profileId = "ab12cd34";
  assert.deepEqual(select([older, dana, sam], {}), [older, dana].sort((a, b) => a.createdUtc.localeCompare(b.createdUtc) || a.id.localeCompare(b.id)));
  assert.deepEqual(select([older, dana, sam], { profile: "ab12cd34" }), [sam]);
  // Reference captures describe the device, so every profile shares them.
  sam.isReference = true;
  assert.deepEqual(select([sam], { profile: "default" }, true), [sam]);
});
test("display-setting filters select by the frozen presentation", () => {
  const plain = session(),
    custom = session();
  plain.config.source = custom.config.source = "Hardware";
  plain.config.xorMask = custom.config.xorMask = XOR_TEMPLATE;
  custom.config.presentation = {
    ...custom.config.presentation,
    showDifficultyMarker: false,
    reducedMotion: true,
  };
  assert.deepEqual(select([plain, custom], { marker: "hidden" }), [custom]);
  assert.deepEqual(select([plain, custom], { marker: "shown" }), [plain]);
  assert.deepEqual(select([plain, custom], { motion: "standard" }), [plain]);
  assert.deepEqual(select([plain, custom], { motion: "reduced" }), [custom]);
  custom.config.presentation.sound = true;
  assert.deepEqual(select([plain, custom], { sound: "on" }), [custom]);
  assert.deepEqual(select([plain, custom], { sound: "off" }), [plain]);
});
const near = (a, b, t = 1e-10) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b} ± ${t}`);
// Sessions count the bytes as sent unless a test turns the XOR mask on, so
// byte fixtures keep their plain meaning.
const RATE = 403200;
export function session(minutes = 1, first = true, game = "Bulb") {
  return {
    id: crypto.randomUUID(),
    state: "Preparing",
    createdUtc: "2026-10-09T12:00:00Z",
    originMonotonic: 0,
    originUtcMs: 1791547200000,
    upFirst: first,
    isReference: false,
    config: {
      game,
      durationMinutes: minutes,
      source: "Simulation",
      xorMask: null,
      bitsPerSecond: RATE,
      difficulty: goalFor(DIFFICULTIES[1], RATE, minutes),
      protocolVersion: VERSION,
      statisticsVersion: STATS,
      presentation: {
        version: PRESENTATION_VERSION,
        showDifficultyMarker: true,
        reducedMotion: false,
      },
    },
    phases: schedule(minutes, first),
    qualityReasons: [],
    feedbackInterrupted: false,
    uiInterruptions: "0",
    boundaryExcludedBytes: "0",
    captureGaps: "0",
    flushedBytes: "0",
    notes: "",
    tags: [],
  };
}
test("specified byte fixture and all byte values", () => {
  assert.equal(popcount(Uint8Array.of(0, 255, 85, 170, 1)), 17);
  assert.equal(popcount(Uint8Array.from({ length: 256 }, (_, i) => i)), 1024);
});
test("independent numerical fixture", () => {
  const r = pair(1e6, 500200, 1e6, 500000);
  near(r.difference, 0.0002);
  near(r.effectPpm, 200);
  near(r.z, 0.282842718, 1e-9);
  near(r.pOneSided, 0.388648703, 1e-9);
});
test("ppm and percentage points", () => {
  const r = pair(1e6, 500180, 1e6, 500000);
  near(r.effectPpm, 180);
  near(r.percentagePoints, 0.018);
  near(r.upRate * 100, 50.018);
});
test("mirrored counts and swapped directions reverse signs", () => {
  const a = pair(1000, 520, 2000, 1000),
    b = pair(1000, 480, 2000, 1000),
    c = pair(2000, 1000, 1000, 520);
  near(a.difference, -b.difference);
  near(a.z, -b.z);
  near(a.z, -c.z);
  near(a.pOneSided + b.pOneSided, 1);
});
test("normal stable tails including extreme values", () => {
  near(normalTail(0), 0.5);
  near(normalTail(1.644853626951), 0.05);
  near(normalTail(3.090232306168), 0.001);
  near(normalTail(8), 6.22096057427178e-16, 1e-28);
  assert.ok(normalTail(37) > 0);
  assert.equal(pair(1e6, 900000, 1e6, 500000).pText, "< 5e-324");
});
test("normal and Student t inverse independent fixtures", () => {
  near(normalQuantile(0.95), 1.64485362695147);
  near(tQuantile(0.975, 1), 12.7062047364321, 1e-8);
  near(tQuantile(0.975, 9), 2.26215716274099, 1e-10);
  near(tQuantile(0.975, 99), 1.98421695150868, 1e-8);
});
test("finite reference includes both sample uncertainties", () => {
  const known = live("1000000", "500200", null, 0.00018),
    finite = live("1000000", "500200", { bits: "1000000", ones: "500000" }, 0.00018);
  assert.ok(finite.z < known.z);
  near(finite.z, pair(1e6, 500200, 1e6, 500000).z);
  near(finite.goal, 0.00018 / 2 / pair(1e6, 500200, 1e6, 500000).standardErrorNull);
});
test("degenerate and empty data never fabricated", () => {
  assert.equal(pair(0, 0, 5, 2), null);
  assert.equal(pair(10, 11, 10, 5), null);
  assert.equal(pair(10, 10, 10, 10).z, null);
  assert.equal(mean([]).meanPpm, null);
  assert.equal(mean([0.1]).lowPpm, null);
  assert.equal(mean([0.1, 0.1]).lowPpm, null);
});
test("single pair exact p cannot be below half", () => {
  assert.equal(signSwap([1000], 1).p, 0.5);
  assert.equal(signSwap([-1000], 1).p, 1);
  assert.equal(signSwap([0], 1).p, 1);
});
test("exact swap enumeration and ties", () => {
  assert.equal(signSwap([1, 2, 3], 2).p, 0.125);
  assert.equal(signSwap([1, -1], 2).p, 0.75);
  assert.equal(signSwap([0, 0, 0], 2).p, 1);
});
test("Monte Carlo correction and reproducibility", () => {
  const d = Array(21).fill(1),
    a = signSwap(d, 71, 999);
  assert.ok(a.p >= 0.001);
  assert.equal(a.replications, 999);
  assert.deepEqual(a, signSwap(d, 71, 999));
  assert.equal(a.resolution, 0.001);
});
test("whole pair bootstrap", () => {
  assert.equal(bootstrap([1, 2], 1), null);
  assert.deepEqual(
    bootstrap(
      Array.from({ length: 10 }, (_, i) => i),
      12,
      199,
    ),
    bootstrap(
      Array.from({ length: 10 }, (_, i) => i),
      12,
      199,
    ),
  );
});
test("levels are chance odds and their goals follow the device speed", () => {
  assert.equal(DIFFICULTIES.length, 5);
  assert.ok(Object.isFrozen(DIFFICULTIES) && DIFFICULTIES.every(Object.isFrozen));
  for (const d of DIFFICULTIES) {
    near(1 / normalTail(d.z), d.oneIn, 1e-6 * d.oneIn);
    // The goal is the level's Z for the planned bits, whatever the speed.
    for (const rate of [8000, RATE, 2e6])
      for (const minutes of [1, 20]) {
        const g = goalFor(d, rate, minutes);
        near(g.deltaGoal / Math.sqrt(0.5 / (rate * minutes * 60)), d.z);
        near(g.goalPpm, g.deltaGoal * 1e6);
      }
  }
  assert.ok(DIFFICULTIES.every((d, i) => !i || (d.z > DIFFICULTIES[i - 1].z && d.displayZ > DIFFICULTIES[i - 1].displayZ)));
});
test("the bulb measures the last seconds in their own standard errors, at any speed", () => {
  for (const d of DIFFICULTIES)
    for (const n of [1e4, 1e6, 1e8]) {
      // One bucket: the standard error of its ones rate is 0.5 / sqrt(n).
      const k = (z) => n / 2 + (z * Math.sqrt(n)) / 2;
      near(new Smoother().update(k(d.displayZ), n, 0, 0.5, d.displayZ).level, 0.8);
      near(new Smoother().update(k(-d.displayZ), n, 0, 0.5, d.displayZ).level, -0.8);
      near(new Smoother().update(n / 2, n, 0, 0.5, d.displayZ).level, 0);
    }
  assert.equal(new Smoother().update(0, 0, 0.25, 0.5, 0.67).level, 0);
  // Fading weights: after a pause the old buckets count less, never more.
  const s = new Smoother();
  s.update(600, 1000, 0.25, 0.5, 0.67);
  const later = s.update(500, 1000, 6, 0.5, 0.67);
  assert.ok(later.deltaSmooth > 0 && later.deltaSmooth < 0.05);
});
test("the XOR mask cancels a leaning device in the counts and keeps its own ones", () => {
  assert.equal(popcount(Uint8Array.of(0x55), true), 0);
  assert.equal(popcount(Uint8Array.of(0xaa), true), 8);
  assert.equal(popcount(Uint8Array.of(0x00, 0xff), true), 8);
  assert.equal(popcount(Uint8Array.from({ length: 256 }, (_, i) => i), true), 1024);
  for (const xorMask of [XOR_TEMPLATE, null]) {
    const s = session(1, true);
    s.config.xorMask = xorMask;
    const c = new Capture(s);
    let seq = 0;
    // A device stuck on 1s: every bit it sends is a 1.
    for (let t = 0.125; t <= s.phases.at(-1).end + 0.125; t += 0.125)
      c.ingest({ sequence: String(++seq), start: t - 0.02, end: t, bytes: new Uint8Array(64).fill(255), flags: 0 });
    for (const p of s.phases) {
      assert.equal(p.rawOnes, p.bits);
      assert.equal(p.ones, xorMask ? (BigInt(p.bits) / 2n).toString() : p.bits);
    }
    const buckets = c.completedBuckets;
    for (const key of ["ones", "rawOnes"])
      assert.equal(
        buckets.reduce((n, b) => n + BigInt(b[key]), 0n),
        s.phases.reduce((n, p) => n + BigInt(p[key]), 0n),
      );
  }
});
test("a simulated effect follows the aim through the mask; a device lean does not", () => {
  const counted = (scenario, kind, mask) => {
    const sim = new Simulator({ scenario, seed: 7, bytesPerSecond: 50000, commonBias: 0.01, intentionShift: 0.01, driftPerMinute: 0, failureAfterSeconds: 999 }),
      bytes = sim.bytes(200000, kind, 0, mask ? 0x55 : 0);
    return { counted: popcount(bytes, mask) / (bytes.length * 8), raw: popcount(bytes) / (bytes.length * 8) };
  };
  near(counted("IntentionShift", "Up", true).counted, 0.51, 0.002);
  near(counted("IntentionShift", "Down", true).counted, 0.49, 0.002);
  near(counted("IntentionShift", "Up", false).counted, 0.51, 0.002);
  const lean = counted("CommonBias", "Up", true);
  near(lean.raw, 0.51, 0.002);
  near(lean.counted, 0.5, 0.002);
});
test("a score means the same at any speed and length", () => {
  for (const level of DIFFICULTIES)
    for (const z of [0.5, 1.645, 3]) {
      const scores = [];
      for (const [rate, minutes] of [[8000, 1], [RATE, 1], [RATE, 20], [2e6, 10]]) {
        const s = session(minutes);
        s.config.bitsPerSecond = rate;
        s.config.difficulty = goalFor(level, rate, minutes);
        const n = rate * minutes * 60,
          k = Math.round((z * Math.sqrt(n / 2)) / 2);
        s.phases[0].bits = s.phases[1].bits = String(n);
        s.phases[0].ones = String(n / 2 + k);
        s.phases[1].ones = String(n / 2 - k);
        s.state = "Completed";
        new Capture(s).decorate();
        scores.push(s.score.value);
      }
      assert.ok(Math.max(...scores) - Math.min(...scores) <= 1, `${level.label} z ${z}: ${scores}`);
    }
});
for (const duration of [1, 5, 10, 20])
  for (const first of [true, false])
    test(`virtual clock ${duration} minutes ${first ? "up" : "down"} first`, () => {
      const s = session(duration, first),
        c = new Capture(s),
        end = s.phases.at(-1).end;
      let seq = 0;
      for (let t = 0.125; t <= end + 0.125; t += 0.125)
        c.ingest({
          sequence: String(++seq),
          start: t - 0.02,
          end: t,
          bytes: Uint8Array.of(85, 170),
          flags: 0,
        });
      assert.equal(s.state, "Completed");
      assert.equal(s.phases.length, 2);
      assert.equal(s.phases[0].kind, first ? "Up" : "Down");
      assert.equal(s.phases[1].kind, first ? "Down" : "Up");
      assert.equal(s.phases[0].end - s.phases[0].start, duration * 60);
      assert.equal(s.phases[0].bits, s.phases[1].bits);
      near(s.result.difference, 0);
      assert.equal(s.score.value, 0);
      assert.equal(s.score.version, SCORE_VERSION);
      const buckets = c.completedBuckets;
      for (const p of s.phases)
        assert.equal(
          buckets
            .filter((b) => b.phaseOrdinal === p.ordinal)
            .reduce((n, b) => n + BigInt(b.bits), 0n)
            .toString(),
          p.bits,
        );
    });
test("partial reads and duplicate replay are counted exactly once", () => {
  const s = session(),
    c = new Capture(s);
  c.lastData = 7;
  const chunk = {
    sequence: "20",
    start: 7.1,
    end: 7.11,
    bytes: Uint8Array.of(0, 255, 85),
    flags: 0,
  };
  c.ingest(chunk);
  c.ingest(chunk);
  assert.equal(s.phases[0].bits, "24");
  assert.equal(s.phases[0].ones, "12");
});
test("half open boundary excludes straddling whole reads", () => {
  const s = session(),
    c = new Capture(s);
  c.lastData = 6.9;
  c.ingest({
    sequence: "1",
    start: 6.99,
    end: 7.01,
    bytes: Uint8Array.of(255),
    flags: 0,
  });
  c.ingest({
    sequence: "2",
    start: 7.01,
    end: 7.02,
    bytes: Uint8Array.of(1),
    flags: 0,
  });
  assert.equal(s.boundaryExcludedBytes, "1");
  assert.equal(s.phases[0].ones, "1");
});
test("sequence loss and long receipt gap fault attempts", () => {
  const s = session(),
    c = new Capture(s);
  c.lastData = 7;
  c.ingest({
    sequence: "1",
    start: 7,
    end: 7.1,
    bytes: Uint8Array.of(255),
    flags: 0,
  });
  c.ingest({
    sequence: "3",
    start: 7.1,
    end: 7.2,
    bytes: Uint8Array.of(255),
    flags: 0,
  });
  assert.equal(s.state, "Faulted");
  const s2 = session(),
    c2 = new Capture(s2);
  c2.ingest({
    sequence: "1",
    start: 10,
    end: 10.1,
    bytes: Uint8Array.of(255),
    flags: 0,
  });
  assert.equal(s2.state, "Faulted");
});
test("checkpoint preserves exact counts and display accumulators", () => {
  const s = session(),
    c = new Capture(s);
  c.lastData = 7;
  c.ingest({
    sequence: "1",
    start: 7.05,
    end: 7.1,
    bytes: Uint8Array.of(1, 2, 3),
    flags: 0,
  });
  const recovered = new Capture(
    structuredClone(s),
    structuredClone(c.checkpoint()),
  );
  const next = {
    sequence: "2",
    start: 7.2,
    end: 7.3,
    bytes: Uint8Array.of(85, 170),
    flags: 0,
  };
  c.ingest(next);
  recovered.ingest(next);
  c.flush();
  recovered.flush();
  assert.deepEqual(c.s.phases, recovered.s.phases);
  assert.deepEqual(c.display, recovered.display);
});
test("exact integer counts above JS safe integer", () => {
  const s = session(),
    c = new Capture(s);
  s.phases[0].bits = "9007199254740992";
  s.phases[0].bytes = "1125899906842624";
  s.phases[0].ones = "4503599627370496";
  c.lastData = 7;
  c.ingest({
    sequence: "1",
    start: 7,
    end: 7.1,
    bytes: Uint8Array.of(1),
    flags: 0,
  });
  assert.equal(s.phases[0].bits, "9007199254741000");
  assert.equal(s.phases[0].ones, "4503599627370497");
});
test("early stop retains counts with no result", () => {
  const s = session(),
    c = new Capture(s);
  c.lastData = 7;
  c.ingest({
    sequence: "1",
    start: 7,
    end: 7.1,
    bytes: Uint8Array.of(255),
    flags: 0,
  });
  c.abort(8);
  assert.equal(s.state, "Aborted");
  assert.equal(s.phases[0].bits, "8");
  assert.equal(s.result, null);
});

test("invalid or backwards receipt times fault before counting", () => {
  for (const end of [NaN, Infinity, 7.05]) {
    const c = new Capture(session());
    c.lastData = 7;
    c.ingest({
      sequence: "1",
      start: 7,
      end: 7.1,
      bytes: Uint8Array.of(1),
      flags: 0,
    });
    c.ingest({
      sequence: "2",
      start: 7.01,
      end,
      bytes: Uint8Array.of(255),
      flags: 0,
    });
    assert.equal(c.s.state, "Faulted");
    assert.equal(c.s.phases[0].bits, "8");
    assert.match(c.s.failureReason, /receipt timestamps/);
  }
});
test("CSV injection and quoting", () => {
  assert.equal(csvCell('=HYPERLINK("x")', true), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell("a,b\nc", true), '"a,b\nc"');
  assert.equal(csvCell(-180), '"-180"');
});
test("source, XOR mask and timezone filters and negative outcomes", () => {
  const a = session(),
    b = session(),
    masked = session();
  a.config.xorMask = b.config.xorMask = XOR_TEMPLATE;
  b.config.source = "Hardware";
  masked.config.source = "Hardware";
  assert.deepEqual(select([a, b, masked], {}), [b]);
  assert.deepEqual(select([a, b, masked], { source: "Simulation" }), [a]);
  // Sessions with and without the mask never mix in one selection.
  assert.deepEqual(select([a, b, masked], { mask: "off" }), [masked]);
  assert.equal(
    calendar("2026-10-10T01:00:00Z", "America/Los_Angeles"),
    "2026-10-09",
  );
  a.state = "Completed";
  a.result = { difference: -0.001 };
  assert.ok(eligible(a));
  a.feedbackInterrupted = true;
  assert.ok(!eligible(a));
  assert.ok(eligible(a, { includeInterrupted: true }));
});
test("simulation known seed and intention shift in both directions", () => {
  const config = {
      scenario: "IntentionShift",
      seed: 19,
      bytesPerSecond: 24000,
      commonBias: 0.001,
      intentionShift: 0.01,
      driftPerMinute: 0.0002,
      failureAfterSeconds: 12,
    },
    up = new Simulator(config).bytes(100000, "Up", 0),
    down = new Simulator(config).bytes(100000, "Down", 0),
    none = new Simulator(config).bytes(100000, "Reference", 0);
  assert.ok(popcount(up) > popcount(none));
  assert.ok(popcount(down) < popcount(none));
  assert.deepEqual(new Simulator(config).bytes(100, "Up", 0), up.slice(0, 100));
});
test("common bias and time drift do not favor either randomized direction", () => {
  const r = new Random(5521);
  for (const scenario of ["CommonBias", "Drift"]) {
    const d = [];
    for (let j = 0; j < 80; j++) {
      const sim = new Simulator({
        scenario,
        seed: r.next(),
        bytesPerSecond: 24000,
        commonBias: 0.02,
        intentionShift: 0,
        driftPerMinute: 0.002,
        failureAfterSeconds: 99,
      });
      const first = j % 2 === 0,
        a = popcount(sim.bytes(10000, first ? "Up" : "Down", 0)) / 80000,
        b = popcount(sim.bytes(10000, first ? "Down" : "Up", 120)) / 80000;
      d.push(first ? a - b : b - a);
    }
    assert.ok(Math.abs(mean(d).meanPpm) < 1000);
  }
});

// ---- Up/Down protocol --------------------------------------------------
function complete(s, upByte, downByte) {
  const c = new Capture(s),
    end = s.phases.at(-1).end;
  let seq = 0;
  for (let t = 0.125; t <= end + 0.125; t += 0.125) {
    const p = s.phases.find((p) => t - 0.02 >= p.start && t < p.end);
    c.ingest({
      sequence: String(++seq),
      start: t - 0.02,
      end: t,
      bytes: Uint8Array.of(
        85,
        p?.kind === "Up" ? upByte : p?.kind === "Down" ? downByte : 85,
      ),
      flags: 0,
    });
  }
  return c;
}
test("Up minus Down compares ones rates and order does not change the sign", () => {
  for (const first of [true, false]) {
    const s = session(1, first);
    complete(s, 0xff, 0x00);
    assert.equal(s.state, "Completed");
    assert.ok(s.result.effectPpm > 0, "more ones during Up is positive");
    assert.ok(s.result.upRate > s.result.downRate);
    assert.ok(s.score.value > 0);
    const reversed = session(1, first);
    complete(reversed, 0x00, 0xff);
    assert.ok(reversed.result.effectPpm < 0, "more ones during Down is negative");
    assert.equal(reversed.score.value, 0, "negative effect scores zero");
  }
});
test("Up minus Down matches the two-proportion fixture and swaps sign", () => {
  const r = pair(1e6, 500200, 1e6, 500000),
    swapped = pair(1e6, 500000, 1e6, 500200);
  near(r.effectPpm, 200);
  near(r.z, 0.282842718, 1e-9);
  near(r.pOneSided, 0.388648703, 1e-9);
  near(r.upRate, 0.5002);
  near(r.downRate, 0.5);
  near(swapped.effectPpm, -200);
});
test("a common bias in both directions cancels in Up minus Down", () => {
  const s = session(1, true);
  complete(s, 0xf7, 0xf7);
  near(s.result.difference, 0);
  assert.equal(s.score.value, 0);
});
test("live feedback is signed and the goal marker follows the direction", () => {
  const s = session(1, true),
    c = new Capture(s);
  c.lastData = 7;
  let seq = 0;
  for (let t = 7.1; t < 9; t += 0.1)
    c.ingest({
      sequence: String(++seq),
      start: t - 0.02,
      end: t,
      bytes: Uint8Array.of(0, 0, 0, 1),
      flags: 0,
    });
  c.flush();
  assert.ok(c.display.level < -0.9, "fewer ones cools the display");
  assert.ok(c.display.zLive < 0);
  assert.ok(c.display.zGoal > 0, "Up phase goal marker points up");
  const d = session(1, false),
    cd = new Capture(d);
  cd.lastData = 7;
  seq = 0;
  for (let t = 7.1; t < 9; t += 0.1)
    cd.ingest({
      sequence: String(++seq),
      start: t - 0.02,
      end: t,
      bytes: Uint8Array.of(255, 255, 255, 254),
      flags: 0,
    });
  cd.flush();
  assert.ok(cd.display.level > 0.9, "more ones heats the display");
  assert.ok(cd.display.zGoal < 0, "Down phase goal marker points down");
});
test("schedule produces Up and Down phases in the recorded order", () => {
  assert.deepEqual(schedule(5, true).map((p) => p.kind), ["Up", "Down"]);
  assert.deepEqual(schedule(5, false).map((p) => p.kind), ["Down", "Up"]);
  assert.deepEqual(schedule(5, true, true).map((p) => p.kind), ["Reference"]);
  const p = schedule(10, false);
  assert.equal(p[1].start - p[0].end, POLICY.transitionSeconds);
});

// ---- The games ------------------------------------------------------------
test("three games, each valid and speaking its own words for the two directions", () => {
  assert.deepEqual([...GAMES], ["Bulb", "Bar", "Box"]);
  for (const game of GAMES) {
    assert.doesNotThrow(() => validateSetup({ game, durationMinutes: 1, difficultyId: 2, timezone: "UTC" }));
    for (const kind of ["Up", "Down"]) {
      assert.notEqual(instruction(game, kind), kind, game + " has an instruction for " + kind);
      assert.notEqual(aiming(game, kind), kind, game + " says what aiming " + kind + " is");
    }
  }
  assert.throws(() => validateSetup({ game: "Dial", durationMinutes: 1, difficultyId: 2, timezone: "UTC" }));
  assert.equal(instruction("Box", "Up"), "Fill it with ones");
  assert.equal(instruction("Box", "Down"), "Fill it with zeros");
  assert.deepEqual([direction("Box", "Up"), direction("Box", "Down")], ["Ones", "Zeros"]);
  assert.deepEqual([direction("Bar", "Up"), direction("Bulb", "Down")], ["Up", "Dimmer"]);
});

// ---- The bar -------------------------------------------------------------
test("the bar's needle turns 15.5 degrees a unit of Z, up for more 1s", () => {
  assert.equal(needleAngle(0), 0);
  assert.equal(needleAngle(4), 62);
  assert.equal(needleAngle(-4), -62);
  for (let z = -5; z < 5; z += 0.25) assert.ok(needleAngle(z + 0.25) > needleAngle(z));
  // Underdamped, so it overshoots a little and settles within about a second.
  assert.ok(SPRING.zeta > 0.4 && SPRING.zeta < 1);
  const overshoot = Math.exp((-Math.PI * SPRING.zeta) / Math.sqrt(1 - SPRING.zeta ** 2));
  assert.ok(overshoot > 0.05 && overshoot < 0.2, "overshoot " + overshoot);
  assert.ok(4 / (SPRING.zeta * SPRING.w) < 1, "settles within a second");
});
test("the bar sings 432 Hz at zero, an octave up at +4 and down at -4", async () => {
  // sound.js listens for the first click or key press as it loads.
  globalThis.document ??= { addEventListener() {} };
  const { meterPitch, BOX_BEAT } = await import("../app/js/sound.js");
  near(meterPitch(0), 432);
  near(meterPitch(4), 864);
  near(meterPitch(-4), 216);
  near(meterPitch(1), 432 * 2 ** 0.25);
  assert.equal(meterPitch(10), meterPitch(4.4), "the voice stops just past the stop pins");
  assert.equal(meterPitch(-10), meterPitch(-4.4));
  for (let z = -4.4; z < 4.4; z += 0.2) assert.ok(meterPitch(z + 0.2) > meterPitch(z));
  // The box's drone: two tones 10 hertz apart, a steady beat of 10 a second.
  assert.deepEqual({ ...BOX_BEAT }, { base: 110, beat: 10 });
});

// ---- The box -------------------------------------------------------------
test("the box's record is each part's running Z, in time, in the session's order", () => {
  const phases = [
      { kind: "Down", ordinal: 1, start: 7, end: 67 },
      { kind: "Up", ordinal: 2, start: 82, end: 142 },
    ],
    buckets = [
      { phaseOrdinal: 2, end: 112, zLive: 1.5 },
      { phaseOrdinal: 1, end: 37, zLive: -0.5 },
      { phaseOrdinal: 1, end: 7.25, zLive: 0.2 },
      { phaseOrdinal: 1, end: 67, zLive: -1 },
      { phaseOrdinal: 0, end: 5, zLive: null },
      { phaseOrdinal: 2, end: 142, zLive: 2 },
      { phaseOrdinal: 2, end: 90, zLive: null },
    ],
    record = boxRecord({ phases: [phases[1], phases[0]] }, buckets);
  assert.deepEqual(
    record.parts.map((p) => p.kind),
    ["Down", "Up"],
  );
  assert.deepEqual(record.parts[0].points, [
    [0.25 / 60, 0.2],
    [0.5, -0.5],
    [1, -1],
  ]);
  assert.deepEqual(record.parts[1].points, [
    [0.5, 1.5],
    [1, 2],
  ]);
});

// ---- Score -------------------------------------------------------------
test("score is zero at or below zero effect and positive effects show at least 1", () => {
  for (const game of GAMES) {
    const w = weightFor(game);
    assert.equal(scoreValue(0, 0, w), 0);
    assert.equal(scoreValue(-1, -2, w), 0);
    assert.equal(scoreValue(-0.01, 3, w), 0);
    assert.equal(scoreValue(1e-6, 1e-6, w), 1);
  }
});
test("score rises with magnitude and evidence and saturates below 100", () => {
  for (const game of GAMES) {
    const w = weightFor(game);
    let previous = 0;
    for (const r of [0.05, 0.1, 0.25, 0.5, 1, 2, 4]) {
      const s = rawScore(r, 2, w);
      assert.ok(s > previous, game + " increases with magnitude");
      previous = s;
    }
    previous = 0;
    for (const z of [0.2, 0.5, 1, 1.645, 2.5, 3.09, 5]) {
      const s = rawScore(1, z, w);
      assert.ok(s > previous, game + " increases with evidence");
      previous = s;
    }
    assert.ok(rawScore(50, 50, w) <= 100);
    assert.equal(scoreValue(50, 50, w), 100);
  }
});
test("score anchors from the brief hold", () => {
  const bulb = weightFor("Bulb"),
    bar = weightFor("Bar");
  assert.ok(Math.abs(rawScore(1, 1.645, bulb) - 80) < 3, "Bulb: goal reached at 1 in 20");
  assert.ok(rawScore(2, 3.09, bulb) >= 95, "Bulb: twice the goal with strong evidence");
  assert.ok(rawScore(0.35, 0.4307, bulb) < 25, "Bulb: small effect chance matches 1 in 3");
  assert.ok(Math.abs(rawScore(1, 1.645, bar) - 70) < 3, "Bar: first guide mark near the goal");
  assert.ok(rawScore(1, 3.09, bar) >= 90, "Bar: second guide mark");
  const far = rawScore(0.2, 3.09, bar);
  assert.ok(
    far < rawScore(1, 3.09, bar) - 5 && far > 0.6 * rawScore(1, 3.09, bar),
    "Bar: far below goal loses some points, not most",
  );
  assert.ok(rawScore(1, 1.645, bulb) > rawScore(1, 1.645, bar), "Bulb leans on magnitude");
  assert.ok(rawScore(0.2, 3.09, bar) > rawScore(0.2, 3.09, bulb), "Bar leans on evidence");
  // The Box sits between them, with the weight of all games together.
  const box = weightFor("Box");
  assert.equal(box, weightFor("All"));
  assert.ok(rawScore(1, 1.645, bulb) > rawScore(1, 1.645, box) && rawScore(1, 1.645, box) > rawScore(1, 1.645, bar));
});
test("harder levels need a bigger effect for the same score; evidence is unchanged", () => {
  const easy = DIFFICULTIES[0],
    expert = DIFFICULTIES[4],
    result = pair(24e6, 12e6 + 2400, 24e6, 12e6);
  const at = (level) =>
    sessionScore({ result, config: { game: "Bulb", difficulty: goalFor(level, 24e6 / 60, 1) } });
  assert.ok(at(easy).value > at(expert).value);
  assert.equal(at(easy).z, at(expert).z);
});
test("annotating a session keeps its stored score", () => {
  const s = session(1, true);
  complete(s, 0xff, 0x00);
  const stored = s.score;
  s.annotatedExcluded = true;
  new Capture(s).decorate();
  assert.equal(s.score, stored);
  assert.equal(s.clean, false);
});
test("chance line converts the one-sided p into plain odds", () => {
  assert.equal(chance(0.05, 70).text, "Chance alone does this well about 1 time in 20.");
  assert.equal(chance(1 / 12, 40).text, "Chance alone does this well about 1 time in 12.");
  assert.equal(chance(1 / 43, 50).oneIn, 45);
  assert.equal(
    chance(1 / 2345, 90).text,
    "Chance alone does this well about 1 time in 2,300.",
  );
  assert.equal(
    chance(1e-7, 99).text,
    "Chance alone does this well less than 1 time in 10,000.",
  );
  assert.equal(chance(0.7, 0).text, "Chance alone does this well most of the time.");
  assert.equal(chance(0.3, 0).oneIn, null);
});
// A completed session whose Up-minus-Down effect has the given Z.
function fakeSession(game, level, z, bits = 24e6) {
  const d = z * Math.sqrt(0.5 / bits);
  return {
    state: "Completed",
    config: { game, difficulty: goalFor(level, bits / 60, 1) },
    phases: [
      { kind: "Up", bits: String(bits), ones: String(Math.round(bits * (0.5 + d / 2))) },
      { kind: "Down", bits: String(bits), ones: String(Math.round(bits * (0.5 - d / 2))) },
    ],
  };
}
test("every started session counts, with the bits it collected", () => {
  const level = goalFor(DIFFICULTIES[1], 24e6 / 60, 1),
    full = fakeSession("Bulb", level, 2),
    stopped = {
      state: "Aborted",
      config: { game: "Bulb", difficulty: level },
      phases: [
        { kind: "Up", bits: "1000000", ones: "499000" },
        { kind: "Down", bits: "0", ones: "0" },
      ],
    },
    beforeMeasuring = {
      state: "Aborted",
      config: { game: "Bulb", difficulty: level },
      phases: [
        { kind: "Up", bits: "0", ones: "0" },
        { kind: "Down", bits: "0", ones: "0" },
      ],
    };
  const one = intentionToTreat([full], 1),
    both = intentionToTreat([full, stopped, beforeMeasuring], 1);
  near(one.effectPpm, 2 * Math.sqrt(0.5 / 24e6) * 1e6, 0.1);
  near(one.ratio, (2 * Math.sqrt(0.5 / 24e6)) / level.deltaGoal, 1e-3);
  assert.equal(both.sessions, 2, "a session stopped before measuring adds nothing");
  assert.equal(both.finished, 1);
  assert.ok(both.ratio < one.ratio, "a stopped session's poor first direction still counts");
  assert.equal(intentionToTreat([beforeMeasuring], 1), null);
  const lucky = {
    ...stopped,
    phases: [
      { kind: "Up", bits: "1000000", ones: "501000" },
      { kind: "Down", bits: "0", ones: "0" },
    ],
  };
  near(intentionToTreat([full, lucky], 1).ratio * (24e6 * 2 + 1e6), one.ratio * 24e6 * 2, 1e-6);
});
test("stopping sessions that look bad cannot favour the result under chance", () => {
  // Players stop whenever the first direction went the wrong way.
  const r = new Random(7771),
    n = 1000000,
    level = goalFor(DIFFICULTIES[1], n / 60, 1),
    normal = () => {
      const u = (r.next() + 1) / 4294967297,
        v = (r.next() + 1) / 4294967297;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    ones = () => String(Math.round(n / 2 + Math.sqrt(n / 4) * normal())),
    all = [];
  for (let i = 0; i < 3000; i++) {
    const upFirst = r.next() % 2 === 0,
      first = ones(),
      wrong = upFirst ? Number(first) < n / 2 : Number(first) > n / 2,
      second = wrong ? "0" : ones();
    all.push({
      state: wrong ? "Aborted" : "Completed",
      config: { game: "Bulb", difficulty: level },
      phases: [
        { kind: upFirst ? "Up" : "Down", bits: String(n), ones: first },
        { kind: upFirst ? "Down" : "Up", bits: wrong ? "0" : String(n), ones: second },
      ],
    });
  }
  const finished = intentionToTreat(
      all.filter((s) => s.state === "Completed"),
      5,
      999,
      "ratio",
    ),
    started = intentionToTreat(all, 5, 999, "ratio");
  assert.ok(finished.test.p <= 0.001, "completed sessions alone look strongly favourable");
  const se = (started.highPpm - started.lowPpm) / 3.92;
  assert.ok(Math.abs(started.effectPpm) < 3 * se, "every started session stays near zero: " + started.effectPpm);
});
test("overall score uses the aggregate, never an average of session scores", () => {
  const level = DIFFICULTIES[1];
  // One strong session and two moderately negative ones: an average of session
  // scores would be positive, but the mean effect is negative.
  const rows = [
    fakeSession("Bulb", level, 3),
    fakeSession("Bulb", level, -2),
    fakeSession("Bulb", level, -2),
  ];
  const overall = overallScore(rows, 1, "Bulb");
  assert.ok(overall.ratio < 0);
  assert.equal(overall.value, 0);
  assert.equal(
    overallScore([fakeSession("Bulb", level, 4)], 1, "Bulb").value,
    0,
    "one session gives no across-session evidence",
  );
  assert.equal(overallScore([], 1), null);
});
test("overall score stays near zero under chance and does not creep upward", () => {
  const r = new Random(90210),
    normal = () => {
      const u = (r.next() + 1) / 4294967297,
        v = (r.next() + 1) / 4294967297;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    level = DIFFICULTIES[0],
    quantile = (a, q) => a.sort((x, y) => x - y)[Math.floor(q * (a.length - 1))];
  const p90 = {};
  for (const n of [4, 12, 60]) {
    const values = [];
    for (let k = 0; k < 300; k++)
      values.push(
        overallScore(
          Array.from({ length: n }, () => fakeSession("Bulb", level, normal())),
          r.next(),
          "Bulb",
          999,
        ).value,
      );
    const zeros = values.filter((v) => v === 0).length / values.length;
    p90[n] = quantile(values, 0.9);
    assert.ok(zeros > 0.4 && zeros < 0.65, n + " sessions: zero share " + zeros);
    assert.ok(quantile(values, 0.5) <= 5, "median near zero with " + n + " sessions");
  }
  assert.ok(p90[60] <= p90[12] && p90[12] <= p90[4] + 5, JSON.stringify(p90));
});
