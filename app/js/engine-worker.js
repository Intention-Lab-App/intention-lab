import * as db from "./core/database.js";
import { Capture } from "./core/capture.js";
import { Simulator } from "./core/simulation.js";
import {
  POLICY,
  VERSION,
  STATS,
  ENGINE_API,
  DIFFICULTIES,
  XOR_MASK,
  XOR_TEMPLATE,
  goalFor,
  randomSeed,
  schedule,
  validateSetup,
  hash,
  terminal,
} from "./core/protocol.js";
import { SCORE_VERSION } from "./core/score.js";
import { PRESENTATION_VERSION } from "./core/preferences.js";
const NEUTRAL = { level: 0, zLive: null, zGoal: null, deltaSmooth: null };

const ports = new Map();
let chain = Promise.resolve(),
  capture = null,
  source = "Hardware",
  device = null,
  sim = null,
  simSettings = null,
  simTime = 0,
  simOffset = 0,
  simSeq = 0n,
  simTimer = null;
let socket,
  streamReady = false,
  streamError = null,
  lastStreamMessage = performance.now(),
  bridgeToken = "",
  bridgeStatus = null,
  lastStatusReceived = performance.now(),
  lastCommit = 0,
  lastTick = performance.now(),
  lastUtc = Date.now(),
  pendingBytes = 0,
  reconnectTimer,
  failed = false,
  starting = false;
const active = () => capture && !terminal(capture.s),
  now = () =>
    source === "Simulation"
      ? simTime
      : (bridgeStatus?.monotonic || 0) +
        (performance.now() - lastStatusReceived) / 1000;
const serialize = (fn) => {
  const result = chain.then(fn);
  chain = result.catch((e) => {
    console.error(e);
  });
  return result;
};
async function transport(path, body) {
  const r = await fetch("/bridge/" + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Bridge request failed");
  return data;
}
function snapshot() {
  const s = capture?.s,
    t = s ? now() - s.originMonotonic : 0,
    p = s?.phases.find((p) => t >= p.start && t < p.end),
    running = active(),
    deadline = p?.end ?? (t < 2 ? 2 : t < 7 ? 7 : (s?.phases[1]?.start ?? t));
  // Both directions show live feedback. Reference captures and the countdown
  // and transition periods show the resting instrument.
  const measuring =
      running && (p?.kind === "Up" || p?.kind === "Down") && s.state === "Phase" + p.ordinal,
    showOutcome = measuring && capture.lastPhase === p.ordinal;
  return {
    engineApiVersion: ENGINE_API,
    sequence:
      source === "Simulation"
        ? simSeq.toString()
        : capture?.lastSeq || bridgeStatus?.lastSequence || "0",
    sessionId: s?.id ?? null,
    state: s?.state || "Ready",
    source,
    connected:
      source === "Simulation"
        ? !!sim
        : !!bridgeStatus?.connected && streamReady,
    deviceId: device?.id,
    deviceLabel: device?.label || "No device",
    port: device?.port,
    bitsPerSecond:
      source === "Simulation"
        ? simSettings?.bytesPerSecond * 8
        : bridgeStatus?.bitsPerSecond || 0,
    error: streamError || s?.failureReason || bridgeStatus?.error,
    config: s?.config,
    isReference: s?.isReference,
    upFirst: s?.upFirst,
    phase: running ? (p?.kind ?? null) : null,
    remainingSeconds: Math.max(0, deadline - t),
    elapsedSeconds: Math.max(0, t),
    plannedDeadline: s ? s.originMonotonic + deadline : null,
    acceptedBits: measuring ? p.bits : null,
    ones: measuring ? p.ones : null,
    feedbackInterrupted: s?.feedbackInterrupted || false,
    ...(showOutcome ? capture.display : NEUTRAL),
  };
}
function broadcast() {
  const value = snapshot();
  for (const [port] of ports) {
    try {
      port.postMessage({ event: "snapshot", value });
    } catch {
      ports.delete(port);
    }
  }
}
async function save(force = false, extra = {}) {
  if (!capture) return;
  if (!force && performance.now() - lastCommit < 250) return;
  const c = capture;
  const buckets = c.completedBuckets.splice(0),
    events = c.events.splice(0),
    raw = c.raw.splice(0);
  for (const r of raw) r.sha256 = await hash(r.bytes);
  const checkpoint = {
    id: "capture",
    sessionId: c.s.id,
    streamId: c.s.streamId,
    instanceId: c.s.instanceId,
    engine: c.checkpoint(),
    savedUtcMs: Date.now(),
    simState: sim
      ? {
          settings: simSettings,
          time: simTime,
          sequence: simSeq.toString(),
          random: [...sim.random.s],
        }
      : null,
  };
  try {
    const references =
      c.s.isReference && c.s.state === "Completed"
        ? [
            {
              id: c.s.id,
              sessionId: c.s.id,
              source: c.s.config.source,
              deviceId: c.s.config.deviceId,
              deviceType: c.s.config.deviceType,
              bits: c.s.phases[0].bits,
              ones: c.s.phases[0].ones,
              startedUtc: c.s.createdUtc,
              endedUtc: c.s.endedUtc,
              version: VERSION,
              diagnosticsJson: JSON.stringify({
                quality: c.s.qualityReasons,
                feedbackInterrupted: c.s.feedbackInterrupted,
              }),
              settings: c.s.config,
            },
          ]
        : [];
    await db.bump({
      ...extra,
      sessions: [c.s],
      buckets,
      events,
      raw,
      references,
      meta: [checkpoint],
    });
    lastCommit = performance.now();
    if (socket?.readyState === WebSocket.OPEN && c.lastSeq !== null)
      socket.send(JSON.stringify({ ack: c.lastSeq }));
    if (terminal(c.s)) {
      for (const [port] of ports)
        port.postMessage({ event: "completed", value: c.s.id });
    }
  } catch (e) {
    c.completedBuckets.unshift(...buckets);
    c.events.unshift(...events);
    c.raw.unshift(...raw);
    if (c.s.state === "Completed") c.s.state = "Finalizing";
    c.fault(
      "IndexedDB persistence failed: " + e.message,
      now() - c.s.originMonotonic,
    );
    failed = true;
    // Stop the physical stream as well. A restart cannot recover a known disk
    // failure as if it were merely an interrupted browser connection.
    clearInterval(simTimer);
    sim = null;
    if (source === "Hardware") {
      try {
        bridgeStatus = await transport("disconnect", {});
      } catch {}
    }
    try {
      await db.bump({
        sessions: [c.s],
        buckets: c.completedBuckets,
        events: c.events,
        raw: c.raw,
        meta: [
          { ...checkpoint, engine: c.checkpoint(), fatal: c.s.failureReason },
        ],
      });
      c.completedBuckets.length = c.events.length = c.raw.length = 0;
    } catch {
      try {
        const committed = await db.get("meta", "capture");
        await db.write({
          meta: [
            {
              ...committed,
              id: "capture",
              sessionId: c.s.id,
              fatal: c.s.failureReason,
            },
          ],
        });
      } catch {
        /* Disk unavailable: keep the explicit fault visible in memory. */
      }
    }
    broadcast();
    throw e;
  }
}
async function fault(reason) {
  if (active()) {
    capture.fault(reason, now() - capture.s.originMonotonic);
    await save(true);
  }
  broadcast();
}
function openStream(cursor = null, stream = null) {
  clearTimeout(reconnectTimer);
  streamReady = false;
  streamError = null;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  socket = new WebSocket(
    location.origin.replace("http:", "ws:") + "/bridge/stream",
  );
  const openingSocket = socket;
  let accept, reject;
  const ready = new Promise((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const deadline = setTimeout(() => {
    streamError = "Device stream authentication timed out";
    reject(Error(streamError));
    openingSocket.close();
  }, POLICY.bridgeOutageSeconds * 1000);
  socket.binaryType = "arraybuffer";
  socket.onopen = () =>
    socket.send(
      JSON.stringify({ token: bridgeToken, streamId: stream, after: cursor }),
    );
  socket.onmessage = (e) => {
    if (source !== "Hardware") return;
    if (typeof e.data === "string") {
      let status;
      try {
        status = JSON.parse(e.data);
      } catch {
        reject(Error("Invalid device stream status"));
        openingSocket.close();
        return;
      }
      // Resolve the transport handshake outside the capture actor's queue:
      // connect is awaiting it inside that queue. Measurement changes stay queued.
      clearTimeout(deadline);
      streamReady = !!status.connected;
      lastStreamMessage = performance.now();
      if (streamReady) accept();
      else
        reject(Error(status.error || "Device disconnected during connection"));
      serialize(async () => {
        bridgeStatus = status;
        device = status.device;
        lastStatusReceived = performance.now();
        if (
          active() &&
          (status.instanceId !== capture.s.instanceId ||
            status.streamId !== capture.s.streamId)
        )
          await fault(
            "Bridge or byte stream restarted; this attempt cannot resume",
          );
        if (active() && !status.connected)
          await fault(
            "Device disconnected: " + (status.error || "connection closed"),
          );
        broadcast();
      });
      return;
    }
    lastStreamMessage = performance.now();
    pendingBytes += e.data.byteLength;
    if (pendingBytes > POLICY.consumerQueueBytes) {
      serialize(() => fault("JavaScript acquisition queue overflow"));
      socket.close();
      return;
    }
    serialize(async () => {
      try {
        const data = new DataView(e.data);
        let offset = 0;
        while (offset < data.byteLength) {
          if (
            data.byteLength - offset < 56 ||
            data.getUint32(offset, true) !== 0x31474e52
          )
            throw Error("Invalid binary transport frame");
          const len = data.getUint32(offset + 4, true);
          if (offset + 56 + len > data.byteLength)
            throw Error("Truncated binary transport frame");
          const c = {
            sequence: data.getBigUint64(offset + 8, true).toString(),
            start: data.getFloat64(offset + 16, true),
            end: data.getFloat64(offset + 24, true),
            utcMs: data.getFloat64(offset + 32, true),
            flags: data.getUint32(offset + 40, true),
            flushed: data.getBigUint64(offset + 48, true).toString(),
            bytes: new Uint8Array(e.data, offset + 56, len),
          };
          if (active()) {
            const before = capture.s.state;
            capture.ingest(c);
            await save(terminal(capture.s) || before !== capture.s.state);
          }
          offset += 56 + len;
        }
      } catch (e) {
        await fault(e.message);
      } finally {
        pendingBytes -= e.data.byteLength;
      }
    });
  };
  socket.onclose = (e) => {
    clearTimeout(deadline);
    streamReady = false;
    const reason = e.reason || "Device stream closed";
    reject(Error(reason));
    if (source !== "Hardware") return;
    streamError = reason;
    if (e.code === 1008) {
      serialize(() => fault(e.reason || "Recovery buffer unavailable"));
      return;
    }
    if (active())
      serialize(async () => {
        capture.interrupt(
          "WebSocket connection interrupted",
          now() - capture.s.originMonotonic,
        );
        await save(true);
      });
    reconnectTimer = setTimeout(() => serialize(reconnect), 500);
  };
  socket.onerror = () => {};
  return ready;
}
async function reconnect() {
  try {
    const hello = await transport("bootstrap");
    bridgeToken = hello.token;
    bridgeStatus = hello.status;
    if (source === "Simulation") return;
    device = bridgeStatus.device;
    lastStatusReceived = performance.now();
    if (
      active() &&
      (capture.s.instanceId !== bridgeStatus.instanceId ||
        capture.s.streamId !== bridgeStatus.streamId)
    ) {
      await fault(
        "Bridge restarted or device stream changed; no attempt resumption",
      );
      return;
    }
    if (active() && !bridgeStatus.connected) {
      await fault("Device is disconnected; attempt incomplete");
      return;
    }
    if (bridgeStatus.connected)
      await openStream(
        active() ? capture.lastSeq : null,
        active() ? capture.s.streamId : null,
      );
  } catch {
    if (active() && performance.now() - lastStatusReceived > 5000)
      await fault("Bridge unavailable for more than 5 seconds");
    reconnectTimer = setTimeout(() => serialize(reconnect), 1000);
  }
}
async function initialize() {
  await db.openDb();
  const cp = await db.get("meta", "capture");
  if (cp) {
    const s = await db.get("sessions", cp.sessionId);
    if (s) {
      capture = new Capture(s, cp.engine);
      if (cp.fatal && !terminal(s)) {
        capture.fault(cp.fatal, s.endMonotonicOffset || 0);
        await save(true);
      }
      source = terminal(s) ? "Hardware" : s.config.source;
      if (!terminal(s)) {
        // Reconcile phase totals against committed buckets plus the in-progress bucket.
        const buckets = await db.all("buckets", s.id);
        if (cp.engine.bucket) buckets.push(cp.engine.bucket);
        let mismatch = false;
        for (const p of s.phases) {
          for (const field of ["bytes", "bits", "ones", "rawOnes"]) {
            const total = buckets
              .filter((b) => b.phaseOrdinal === p.ordinal)
              .reduce((n, b) => n + BigInt(b[field]), 0n)
              .toString();
            if (total !== p[field]) mismatch = true;
            p[field] = total;
          }
        }
        if (mismatch) {
          capture.fault(
            "Recovery reconciliation found inconsistent cached counts",
            0,
          );
          await save(true);
        }
        capture.interrupt(
          "Browser worker restarted; replaying committed transport cursor",
          0,
        );
        if (source === "Simulation" && !terminal(s)) {
          const gap = (Date.now() - cp.savedUtcMs) / 1000;
          if (!cp.simState || gap < 0 || gap > POLICY.maximumGapSeconds) {
            capture.fault(
              "Simulation worker outage exceeded recovery threshold",
              0,
            );
            await save(true);
          } else {
            simSettings = cp.simState.settings;
            sim = new Simulator(simSettings);
            sim.random.s = cp.simState.random;
            simTime = cp.simState.time;
            simSeq = BigInt(cp.simState.sequence);
            simOffset = simTime + gap - performance.now() / 1000;
            device = s.config.deviceIdentity;
            simTimer = setInterval(() => serialize(simTick), 25);
          }
        }
      }
    }
  }
  await reconnect();
  broadcast();
}
async function connect(body) {
  if (active()) throw Error("A measured attempt is running.");
  if (
    body.source === "Hardware" &&
    source === "Hardware" &&
    streamReady &&
    bridgeStatus?.connected &&
    device?.id === body.deviceId
  )
    return snapshot();
  if (body.source === "Simulation") {
    // Validate before changing the source. A separate browser profile may be
    // reading hardware through this same bridge; it does not belong to us.
    const nextSimulator = new Simulator(body.simulation);
    const ownsHardwareStream = source === "Hardware" && streamReady;
    clearInterval(simTimer);
    source = "Simulation";
    streamError = null;
    socket?.close();
    clearTimeout(reconnectTimer);
    if (ownsHardwareStream) await transport("disconnect", {}).catch(() => {});
    simSettings = body.simulation;
    sim = nextSimulator;
    device = {
      id: "simulation-xoshiro-v1",
      label: "Simulation · xoshiro128**-v1",
      port: null,
      deviceType: "Software simulation",
      providerId: "simulation.xoshiro-v1",
    };
    simOffset = 0;
    simTime = performance.now() / 1000;
    simSeq = 0n;
    simTimer = setInterval(() => serialize(simTick), 25);
  } else {
    clearInterval(simTimer);
    sim = null;
    source = "Hardware";
    bridgeStatus = await transport("connect", {
      deviceId: body.deviceId,
      confirmUnidentified: body.confirmUnidentified,
    });
    device = bridgeStatus.device;
    lastStatusReceived = performance.now();
    await openStream();
  }
  const remembered = await db.get("devices", device.id);
  if (remembered) {
    device = {
      ...device,
      userLabel: remembered.userLabel,
      userDeviceType: remembered.userDeviceType,
    };
  }
  await db.write({ devices: [device] });
  broadcast();
  return snapshot();
}
async function simTick() {
  if (!sim) return;
  const previous = simTime;
  simTime = performance.now() / 1000 + simOffset;
  const s = active() ? capture.s : null,
    t = s ? simTime - s.originMonotonic : 0,
    p = s?.phases.find((p) => t >= p.start && t < p.end);
  try {
    const bytes = sim.bytes(
      Math.round(simSettings.bytesPerSecond * Math.min(2, simTime - previous)),
      p?.kind,
      t,
      s?.config.xorMask ? XOR_MASK : 0,
    );
    if (s) {
      const before = s.state;
      capture.ingest({
        sequence: (++simSeq).toString(),
        start: previous,
        end: simTime,
        bytes,
        flags: 0,
      });
      await save(terminal(s) || before !== s.state);
    }
  } catch (e) {
    await fault(e.message);
    clearInterval(simTimer);
    sim = null;
  }
}
async function start(body, isReference, key) {
  if (!key) throw Error("Command idempotency key required");
  const existing = (await db.all("sessions")).find((s) => s.commandKey === key);
  if (existing) return existing;
  if (active() || starting)
    throw Error("Only one measured attempt can run at a time");
  if (!snapshot().connected) throw Error("Connect a source first");
  if (failed)
    throw Error(
      "Resolve the storage failure and reload before another attempt",
    );
  validateSetup(body);
  starting = true;
  try {
    const xorMask = body.xorMask === false ? null : XOR_TEMPLATE;
    const reference = body.referenceId
      ? await db.get("references", body.referenceId)
      : null;
    if (
      body.referenceId &&
      (!reference ||
        reference.source !== source ||
        reference.deviceId !== device.id)
    )
      throw Error("Reference must match the connected device and data source");
    if (reference && (reference.settings?.xorMask ?? null) !== xorMask)
      throw Error(
        `The chosen reference was captured with the XOR mask ${xorMask ? "off" : "on"}. Capture a new reference or use 50/50.`,
      );
    // A challenge fixes one game, level, length, source, mask and reference
    // for all its sessions, and takes each session in turn until it is full.
    const challenge =
      body.challengeId && !isReference
        ? await db.get("challenges", body.challengeId)
        : null;
    if (body.challengeId && !isReference && !challenge)
      throw Error("Challenge not found");
    if (challenge) {
      if (challenge.status !== "Active")
        throw Error("This challenge has ended");
      if (challenge.sessionIds.length >= challenge.sessions)
        throw Error("Every session of this challenge has been played");
      if (challenge.source !== source)
        throw Error(
          challenge.source === "Hardware"
            ? "This challenge is played on the device. Connect it to continue."
            : "This challenge is played on the simulation. Connect it to continue.",
        );
      if (
        challenge.profileId !== (body.profileId || "default") ||
        challenge.game !== body.game ||
        challenge.difficultyId !== body.difficultyId ||
        challenge.durationMinutes !== body.durationMinutes ||
        challenge.xorMask !== !!xorMask ||
        challenge.referenceId !== (body.referenceId || null)
      )
        throw Error("This session does not match its challenge");
    }
    if (source === "Hardware") {
      bridgeStatus = await transport("status");
      lastStatusReceived = performance.now();
    }
    // The goal depends on how many bits a direction will hold, so it is set
    // from the device's measured speed.
    const bitsPerSecond =
      source === "Simulation" ? simSettings.bytesPerSecond * 8 : bridgeStatus?.bitsPerSecond;
    if (!(bitsPerSecond > 0))
      throw Error("The device's speed is still being measured. Start again in a few seconds.");
    const remembered = await db.get("devices", device.id);
    if (remembered)
      device = {
        ...device,
        userLabel: remembered.userLabel,
        userDeviceType: remembered.userDeviceType,
      };
    const origin = now(),
      utc = Date.now(),
      level = DIFFICULTIES.find((d) => d.id === body.difficultyId),
      durationMinutes = isReference ? 5 : body.durationMinutes,
      config = {
        game: body.game,
        profileId: body.profileId || "default",
        durationMinutes,
        directions: xorMask
          ? "Up targets 1 bits after the alternating XOR mask; Down targets 0 bits"
          : "Up targets 1 bits; Down targets 0 bits; no XOR mask",
        xorMask,
        bitsPerSecond,
        difficulty: goalFor(level, bitsPerSecond, durationMinutes),
        smoothingHalfLife: 3,
        acquisition: POLICY,
        deviceId: device.id,
        deviceType:
          device.userDeviceType ||
          device.deviceType ||
          (device.familyHint
            ? "ubld.it TrueRNG V1/V2/V3 family"
            : "Unidentified serial device"),
        deviceTypeBasis: device.userDeviceType
          ? "User entered"
          : "Provider reported",
        providerId: device.providerId || "serial-byte-source-v1",
        deviceLabel: device.userLabel || device.label,
        deviceIdentity: device,
        source,
        simulation: source === "Simulation" ? simSettings : null,
        reference,
        recordRaw: !!body.recordRaw,
        challengeId: challenge?.id ?? null,
        timezone: body.timezone,
        protocolVersion: VERSION,
        statisticsVersion: STATS,
        scoreVersion: SCORE_VERSION,
        feedbackPolicy:
          "Live signed feedback in both directions against the frozen reference centre",
        difficultyVersion: 2,
        presentation: {
          version: PRESENTATION_VERSION,
          showDifficultyMarker:
            body.presentation?.showDifficultyMarker !== false,
          reducedMotion: body.presentation?.reducedMotion === true,
          // The app's own sound setting; the computer's volume is not visible.
          sound: body.presentation?.sound === true,
          headphones: body.presentation?.headphones === true,
        },
      };
    const s = {
      id: crypto.randomUUID(),
      commandKey: key,
      createdUtc: new Date(utc).toISOString(),
      originUtcMs: utc,
      originUtc: new Date(utc).toISOString(),
      originMonotonic: origin,
      streamId: bridgeStatus?.streamId,
      instanceId: bridgeStatus?.instanceId,
      config,
      configHash: await hash(JSON.stringify(config)),
      state: "Preparing",
      upFirst: randomSeed() % 2 === 0,
      isReference,
      phases: [],
      qualityReasons: [],
      feedbackInterrupted: false,
      failureReason: null,
      notes: body.notes || "",
      tags: body.tags || [],
      boundaryExcludedBytes: "0",
      flushedBytes: "0",
      captureGaps: "0",
      uiInterruptions: "0",
      rawBytes: "0",
      annotatedExcluded: false,
    };
    s.phases = schedule(body.durationMinutes, s.upFirst, isReference);
    capture = new Capture(s);
    capture.feedbackGraceUntil = performance.now() + 3000;
    capture.event(
      "Randomized attempt recorded",
      isReference
        ? "Independent reference capture"
        : s.upFirst
          ? "Up → Down"
          : "Down → Up",
      0,
    );
    if (challenge) challenge.sessionIds.push(s.id);
    await save(true, {
      notes: [
        {
          id: crypto.randomUUID(),
          sessionId: s.id,
          utc: s.createdUtc,
          text: s.notes,
          tags: s.tags,
          beforeResults: true,
        },
      ],
      ...(challenge ? { challenges: [challenge] } : {}),
    });
    if (source === "Hardware") await transport("flush", {});
    else {
      sim = new Simulator(simSettings);
    }
    broadcast();
    return s;
  } finally {
    starting = false;
  }
}
async function command(name, body = {}, key) {
  switch (name) {
    case "state":
      return snapshot();
    case "ports":
      return { devices: await transport("devices") };
    case "connect":
      return connect(body);
    case "disconnect":
      if (active()) throw Error("Stop the attempt first");
      clearInterval(simTimer);
      sim = null;
      source = "Hardware";
      bridgeStatus = await transport("disconnect", {});
      socket?.close();
      broadcast();
      return snapshot();
    case "start":
      return navigator.locks.request("intention-records", () =>
        start(body, false, key),
      );
    case "reference":
      return navigator.locks.request("intention-records", () =>
        start(body, true, key),
      );
    case "abort":
      if (body.sessionId && body.sessionId !== capture?.s.id) {
        const old = await db.get("sessions", body.sessionId);
        if (old && terminal(old)) return old;
        throw Error("The specified attempt is not the active attempt");
      }
      if (active()) {
        capture.abort(now() - capture.s.originMonotonic);
        await save(true);
        broadcast();
      }
      return snapshot();
    case "shutdown":
      if (active()) throw Error("Stop the running session first.");
      return transport("shutdown", {});
    default:
      throw Error("Unknown acquisition command");
  }
}
onconnect = (e) => {
  const port = e.ports[0];
  ports.set(port, { seen: performance.now(), visible: false, focused: false });
  port.start();
  port.onmessage = async (event) => {
    const { id, command: name, body, key } = event.data;
    if (name === "heartbeat") {
      const old = ports.get(port);
      ports.set(port, { seen: performance.now(), ...body });
      if (
        active() &&
        old &&
        (old.visible !== body.visible || old.focused !== body.focused)
      ) {
        capture.event(
          "UI focus/visibility",
          JSON.stringify(body),
          now() - capture.s.originMonotonic,
        );
        if (!body.visible || !body.focused)
          capture.interrupt(
            "Session view hidden or unfocused",
            now() - capture.s.originMonotonic,
          );
      }
      if (
        active() &&
        old?.clientId === body.clientId &&
        typeof old.reducedMotion === "boolean" &&
        old.reducedMotion !== body.reducedMotion
      ) {
        const t = now() - capture.s.originMonotonic;
        capture.event(
          "Display motion preference changed",
          JSON.stringify({
            from: old.reducedMotion,
            to: body.reducedMotion,
            clientId: body.clientId,
          }),
          t,
        );
        capture.interrupt(
          "Display motion preference changed during capture",
          t,
        );
      }
      return;
    }
    if (name === "detach") {
      ports.delete(port);
      return;
    }
    try {
      await ready;
      const value = await serialize(() => command(name, body, key));
      port.postMessage({ id, value });
    } catch (error) {
      port.postMessage({ id, error: error.message });
    }
  };
};
// The bridge quits a few minutes after it last heard from a page. This worker
// lives exactly as long as some Intention Lab page is open, so it says so.
setInterval(() => fetch("/bridge/status").then((r) => r.text()).catch(() => {}), 30000);
const ready = initialize().catch((e) => {
  for (const [p] of ports) p.postMessage({ event: "error", value: e.message });
});
setInterval(
  () =>
    serialize(async () => {
      const current = performance.now(),
        utc = Date.now();
      if (active()) {
        const t = now() - capture.s.originMonotonic;
        if (
          source === "Hardware" &&
          current - lastStreamMessage > POLICY.bridgeOutageSeconds * 1000
        )
          await fault("Device stream unavailable for more than 5 seconds");
        if (
          Math.abs(utc - lastUtc - (current - lastTick)) > 2000 ||
          (source === "Simulation" && current - lastTick > 2000)
        )
          await fault("System sleep or worker scheduling interruption");
        const visible = [...ports.values()].some(
          (p) => current - p.seen < 3000 && p.visible && p.focused,
        );
        if (
          !visible &&
          !capture.uiGap &&
          current >= (capture.feedbackGraceUntil || 0)
        ) {
          capture.uiGap = true;
          capture.interrupt("No visible, focused session view", t);
        }
        if (visible) capture.uiGap = false;
        await save();
      }
      lastTick = current;
      lastUtc = utc;
      broadcast();
    }),
  250,
);
