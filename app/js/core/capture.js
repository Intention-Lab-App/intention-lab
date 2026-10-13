import { POLICY, XOR_MASK, stateAt, terminal } from "./protocol.js";
import { pair, live, Smoother } from "./statistics.js";
import { sessionScore } from "./score.js";
const NEUTRAL = Object.freeze({
  level: 0,
  zLive: null,
  zGoal: null,
  deltaSmooth: null,
});
const POP = Uint8Array.from({ length: 256 }, (_, i) => {
  let k = 0;
  for (let b = i; b; b = Math.floor(b / 2)) k += b % 2;
  return k;
});
const MASKED = POP.map((_, i) => POP[i ^ XOR_MASK]);
// Ones in the bytes as sent, or after the alternating XOR mask.
export const popcount = (bytes, masked = false) => {
  const table = masked ? MASKED : POP;
  let s = 0;
  for (const b of bytes) s += table[b];
  return s;
};
const add = (o, k, n) => (o[k] = (BigInt(o[k] || 0) + BigInt(n)).toString());
export class Diagnostics {
  constructor(saved) {
    Object.assign(
      this,
      {
        blockBits: 0,
        blockOnes: 0,
        blocks: 0,
        sum: 0,
        squares: 0,
        pairs: 0,
        x: 0,
        y: 0,
        xy: 0,
        previous: null,
      },
      saved,
    );
  }
  add(bytes) {
    for (const b of bytes)
      for (let j = 0; j < 8; j++) {
        const bit = (b >> j) & 1;
        if (this.previous !== null) {
          this.pairs++;
          this.x += this.previous;
          this.y += bit;
          this.xy += this.previous * bit;
        }
        this.previous = bit;
        this.blockBits++;
        this.blockOnes += bit;
        if (this.blockBits === 1024) {
          this.blocks++;
          this.sum += this.blockOnes;
          this.squares += this.blockOnes * this.blockOnes;
          this.blockBits = this.blockOnes = 0;
        }
      }
  }
  values() {
    const n = this.pairs,
      den = Math.sqrt(
        (n * this.x - this.x * this.x) * (n * this.y - this.y * this.y),
      );
    return {
      blockVariance:
        this.blocks > 1
          ? (this.squares - (this.sum * this.sum) / this.blocks) /
            (this.blocks - 1)
          : null,
      lagOneCorrelation: den ? (n * this.xy - this.x * this.y) / den : null,
      diagnosticBlocks: this.blocks.toString(),
    };
  }
}
// Deterministic domain engine: receives timestamped bytes. It never reads clocks or renders UI.
export class Capture {
  constructor(session, checkpoint = {}) {
    this.s = session;
    this.policy = session.config.acquisition || POLICY;
    this.lastSeq = checkpoint.lastSeq ?? null;
    this.lastPhase = checkpoint.lastPhase ?? null;
    this.lastData = checkpoint.lastData ?? session.originMonotonic;
    this.lastReceipt = checkpoint.lastReceipt ?? null;
    this.bucket = checkpoint.bucket ?? null;
    this.smooth = new Smoother(checkpoint.smooth);
    this.diag = new Diagnostics(checkpoint.diag);
    this.display = checkpoint.display ?? { ...NEUTRAL };
    this.completedBuckets = [];
    this.events = [];
    this.raw = [];
  }
  checkpoint() {
    return {
      lastPhase: this.lastPhase,
      lastSeq: this.lastSeq,
      lastData: this.lastData,
      lastReceipt: this.lastReceipt,
      bucket: this.bucket,
      smooth: { ...this.smooth },
      diag: { ...this.diag },
      display: this.display,
    };
  }
  event(kind, detail, t) {
    this.events.push({
      id: crypto.randomUUID(),
      sessionId: this.s.id,
      utc: new Date(this.s.originUtcMs + t * 1000).toISOString(),
      offset: t,
      kind,
      detail,
    });
  }
  state(state, t) {
    if (this.s.state !== state) {
      this.s.state = state;
      this.event("State", state, t);
    }
  }
  fault(reason, t) {
    if (terminal(this.s)) return;
    this.flush();
    this.s.failureReason = reason;
    this.s.qualityReasons.push(reason);
    this.s.endMonotonicOffset = t;
    this.s.endedUtc = new Date(this.s.originUtcMs + t * 1000).toISOString();
    for (const p of this.s.phases)
      if (p.status !== "Completed") p.status = "Incomplete";
    this.state("Faulted", t);
    this.decorate();
  }
  interrupt(reason, t) {
    if (terminal(this.s)) return;
    if (!this.s.feedbackInterrupted) {
      this.s.feedbackInterrupted = true;
      this.s.qualityReasons.push("Feedback interrupted");
    }
    add(this.s, "uiInterruptions", 1);
    this.event("Feedback interruption", reason, t);
  }
  abort(t) {
    if (terminal(this.s)) return;
    this.flush();
    this.s.endMonotonicOffset = t;
    this.s.endedUtc = new Date(this.s.originUtcMs + t * 1000).toISOString();
    this.s.failureReason = "Stopped by user; incomplete attempt retained";
    for (const p of this.s.phases)
      if (p.status !== "Completed") p.status = "Incomplete";
    this.state("Aborted", t);
    this.decorate();
  }
  ingest(c) {
    const s = this.s;
    if (terminal(s)) return;
    if (this.lastSeq !== null && BigInt(c.sequence) <= BigInt(this.lastSeq))
      return;
    if (
      !Number.isFinite(c.start) ||
      !Number.isFinite(c.end) ||
      c.end < c.start ||
      (this.lastReceipt !== null && c.end < this.lastReceipt)
    ) {
      this.fault(
        "Invalid or non-monotonic receipt timestamps",
        Math.max(
          0,
          (this.lastReceipt || s.originMonotonic) - s.originMonotonic,
        ),
      );
      return;
    }
    this.lastReceipt = c.end;
    const t = c.end - s.originMonotonic;
    if (
      this.lastSeq !== null &&
      BigInt(c.sequence) !== BigInt(this.lastSeq) + 1n
    ) {
      this.fault("Transport sequence gap: bytes unavailable", t);
      return;
    }
    this.lastSeq = c.sequence;
    if (c.flags === 1) {
      add(s, "flushedBytes", c.flushed || 0);
      this.event("Reader flush", `${c.flushed || 0} queued bytes observed`, t);
      return;
    }
    const gap = c.end - this.lastData;
    if (c.bytes.length) this.lastData = c.end;
    if (t >= s.phases[0].start && gap > this.policy.maximumGapSeconds) {
      add(s, "captureGaps", 1);
      this.fault("Acquisition gap exceeded frozen 2-second threshold", t);
      return;
    }
    const begin = c.start - s.originMonotonic,
      p = s.phases.find((p) => begin >= p.start && t < p.end);
    if (!p && s.phases.some((p) => t >= p.start && begin < p.end)) {
      add(s, "boundaryExcludedBytes", c.bytes.length);
      this.event(
        "Boundary exclusion",
        c.bytes.length + " bytes excluded by whole-read rule",
        t,
      );
    }
    this.advance(t);
    if (terminal(s) || !p) return;
    if (!c.bytes.length) return;
    const index = Math.floor((t - p.start) / this.policy.bucketSeconds),
      key = `${p.ordinal}:${index}`;
    if (this.bucket?.key !== key) {
      this.flush();
      if (this.lastPhase !== p.ordinal) {
        this.smooth = new Smoother();
        this.lastPhase = p.ordinal;
      }
      this.bucket = {
        key,
        id: `${s.id}:${key}`,
        sessionId: s.id,
        phaseOrdinal: p.ordinal,
        sequence: `${p.ordinal * 100000 + index}`,
        start: p.start + index * 0.25,
        end: Math.min(p.end, p.start + (index + 1) * 0.25),
        bytes: "0",
        bits: "0",
        ones: "0",
        rawOnes: "0",
        excludedBytes: "0",
        firstReadStart: begin,
        lastReceipt: t,
        maxReadGap: gap,
        rawOffset: s.rawBytes || "0",
      };
      this.diag = new Diagnostics();
    }
    // ones are counted after the XOR mask when the session uses it; rawOnes are
    // the device's own 1s, kept as a check on its lean.
    const b = this.bucket,
      rawOnes = popcount(c.bytes),
      ones = s.config.xorMask ? popcount(c.bytes, true) : rawOnes,
      bits = c.bytes.length * 8;
    for (const o of [p, b]) {
      add(o, "bytes", c.bytes.length);
      add(o, "bits", bits);
      add(o, "ones", ones);
      add(o, "rawOnes", rawOnes);
    }
    p.firstReceipt ??= t;
    p.lastReceipt = t;
    p.status = "Measuring";
    b.lastReceipt = t;
    b.maxReadGap = Math.max(b.maxReadGap, gap);
    this.diag.add(c.bytes);
    if (s.config.recordRaw) {
      this.raw.push({
        id: `${s.id}:${c.sequence}`,
        sessionId: s.id,
        sequence: c.sequence,
        phaseOrdinal: p.ordinal,
        bucketId: b.id,
        offset: s.rawBytes || "0",
        length: c.bytes.length,
        start: begin,
        end: t,
        bytes: c.bytes.slice().buffer,
      });
      add(s, "rawBytes", c.bytes.length);
    }
  }
  // Live display values are signed ones-rate deviations from the frozen
  // reference centre: the same mapping in both directions. The goal marker
  // points in the direction of the current phase.
  flush() {
    const b = this.bucket;
    if (!b) return;
    const s = this.s,
      p = s.phases.find((p) => p.ordinal === b.phaseOrdinal),
      ref = s.config.reference,
      q0 = ref ? Number(ref.ones) / Number(ref.bits) : 0.5;
    const smooth = this.smooth.update(
        b.ones,
        b.bits,
        b.end - b.start,
        q0,
        s.config.difficulty.displayZ,
      ),
      stat = live(p.bits, p.ones, ref, s.config.difficulty.deltaGoal),
      zGoal =
        stat.goal == null ? null : (p.kind === "Down" ? -1 : 1) * stat.goal;
    Object.assign(b, smooth, { zLive: stat.z, zGoal }, this.diag.values());
    this.display = { ...smooth, zLive: stat.z, zGoal };
    this.completedBuckets.push(b);
    this.bucket = null;
  }
  advance(t) {
    if (terminal(this.s)) return;
    const s = this.s;
    for (const p of s.phases)
      if (t >= p.end && p.status !== "Completed") {
        this.flush();
        if (BigInt(p.bits) === 0n) {
          this.fault("Measured phase contained no accepted bits", t);
          return;
        }
        p.status = "Completed";
        p.observedStateEnd = t;
      }
    const next = stateAt(s.phases, t);
    if (next !== s.state) {
      this.flush();
      this.smooth = new Smoother();
      this.display = { ...NEUTRAL };
      this.state(next, t);
      const p = s.phases.find((p) => t >= p.start && t < p.end);
      if (p) p.observedStateStart = t;
    }
    if (next === "Finalizing") {
      s.endMonotonicOffset = s.phases.at(-1).end;
      s.endedUtc = new Date(
        s.originUtcMs + s.endMonotonicOffset * 1000,
      ).toISOString();
      this.state("Completed", s.endMonotonicOffset);
      this.decorate();
    }
  }
  decorate() {
    const s = this.s;
    s.clean =
      s.state === "Completed" &&
      !s.feedbackInterrupted &&
      !s.annotatedExcluded &&
      !s.failureReason;
    s.result = null;
    if (s.state === "Completed" && !s.isReference) s.result = sessionResult(s);
    s.targetRatio = s.result
      ? s.result.difference / s.config.difficulty.deltaGoal
      : null;
    s.targetMet = s.result
      ? s.result.difference >= s.config.difficulty.deltaGoal
      : null;
    // The score is computed once, at completion, and kept with its version.
    if (s.result) s.score ??= sessionScore(s);
    else s.score = null;
  }
}
// Ones rate during Up minus ones rate during Down.
export function sessionResult(s) {
  const up = s.phases.find((p) => p.kind === "Up"),
    down = s.phases.find((p) => p.kind === "Down");
  return up && down ? pair(up.bits, up.ones, down.bits, down.ones) : null;
}
