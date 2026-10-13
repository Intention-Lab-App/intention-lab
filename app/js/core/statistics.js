// Incomplete gamma/beta functions (series + continued fractions); no runtime dependencies.
export function logGamma(z) {
  const c = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5)
    return (
      Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  z--;
  let x = 0.9999999999998099;
  for (let i = 0; i < c.length; i++) x += c[i] / (z + i + 1);
  const t = z + c.length - 0.5;
  return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function gammaQ(a, x) {
  if (x === 0) return 1;
  const factor = Math.exp(a * Math.log(x) - x - logGamma(a));
  if (x < a + 1) {
    let sum = 1 / a,
      term = sum;
    for (let i = 1; i < 1000; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 2e-16) break;
    }
    return Math.max(0, 1 - sum * factor);
  }
  let b = x + 1 - a,
    c = 1e300,
    d = 1 / b,
    h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const v = d * c;
    h *= v;
    if (Math.abs(v - 1) < 3e-16) break;
  }
  return factor * h;
}
export function normalTail(z) {
  if (!Number.isFinite(z)) return null;
  const p = 0.5 * gammaQ(0.5, (z * z) / 2);
  return z < 0 ? 1 - p : p;
}
export function normalQuantile(p) {
  if (!(p > 0 && p < 1))
    throw Error("Probability must be between zero and one");
  let lo = -40,
    hi = 40;
  for (let n = 0; n < 100; n++) {
    const mid = (lo + hi) / 2;
    if (normalTail(mid) > 1 - p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function betaFraction(a, b, x) {
  let c = 1,
    d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    let aa = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    for (let j = 0; j < 2; j++) {
      d = 1 + aa * d;
      if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c;
      if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (j === 1 && Math.abs(delta - 1) < 3e-15) return h;
      aa = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
  }
  return h;
}
export function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const f = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (f * betaFraction(a, b, x)) / a
    : 1 - (f * betaFraction(b, a, 1 - x)) / b;
}
export function tQuantile(p, df) {
  if (df < 1 || p <= 0 || p >= 1) return null;
  const cdf = (t) =>
    t < 0
      ? 0.5 * betaI(df / (df + t * t), df / 2, 0.5)
      : 1 - 0.5 * betaI(df / (df + t * t), df / 2, 0.5);
  let lo = -1e6,
    hi = 1e6;
  for (let i = 0; i < 100; i++) {
    let m = (lo + hi) / 2;
    if (cdf(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// Up minus Down ones rates as a two-proportion comparison.
export function pair(upBits, upOnes, downBits, downOnes) {
  const nu = Number(upBits),
    ku = Number(upOnes),
    nd = Number(downBits),
    kd = Number(downOnes);
  if (!(nu > 0 && nd > 0 && ku >= 0 && kd >= 0 && ku <= nu && kd <= nd))
    return null;
  const up = ku / nu,
    down = kd / nd,
    d = up - down,
    pool = (ku + kd) / (nu + nd),
    se = Math.sqrt(pool * (1 - pool) * (1 / nu + 1 / nd)),
    seD = Math.sqrt((up * (1 - up)) / nu + (down * (1 - down)) / nd);
  const valid = se > 0 && up > 0 && up < 1 && down > 0 && down < 1,
    z = valid ? d / se : null,
    p = valid ? normalTail(z) : null;
  return {
    upRate: up,
    downRate: down,
    difference: d,
    effectPpm: d * 1e6,
    percentagePoints: d * 100,
    standardErrorNull: valid ? se : null,
    z,
    pOneSided: p === 0 ? null : p,
    pText:
      p === null
        ? "Unavailable"
        : p === 0
          ? "< 5e-324"
          : p < 0.0001
            ? p.toExponential(4)
            : p.toFixed(4),
    ciLowPpm: valid ? (d - 1.95996398454005 * seD) * 1e6 : null,
    ciHighPpm: valid ? (d + 1.95996398454005 * seD) * 1e6 : null,
    modelValid: valid,
    modelStatus: valid
      ? "Model-based: approximately independent bits, stable within-phase probabilities, valid capture. Two-sided 95% intervals and one-sided 5% tests use different thresholds"
      : "Degenerate counts; bit-model inference unavailable",
  };
}
// A phase's live Z against the display centre: 50/50, or a measured reference
// compared as a second sample. The goal marker is where this direction's Z
// stays on track for the session goal: each direction carrying half of it.
export function live(bits, ones, reference, goal) {
  const n = Number(bits),
    count = Number(ones);
  if (!n) return { z: null, goal: null };
  if (!reference)
    return {
      z: (count - 0.5 * n) / Math.sqrt(0.25 * n),
      goal: (goal / 2) * Math.sqrt(n / 0.25),
    };
  const p = pair(bits, ones, reference.bits, reference.ones);
  return {
    z: p?.z ?? null,
    goal: p?.standardErrorNull ? goal / 2 / p.standardErrorNull : null,
  };
}
export function mean(d) {
  if (!d.length)
    return {
      meanPpm: null,
      lowPpm: null,
      highPpm: null,
      standardDeviation: null,
      status: "No completed pairs",
    };
  const m = d.reduce((a, b) => a + b, 0) / d.length,
    sd =
      d.length > 1
        ? Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1))
        : null,
    h = sd ? (tQuantile(0.975, d.length - 1) * sd) / Math.sqrt(d.length) : null;
  return {
    meanPpm: m * 1e6,
    lowPpm: h === null ? null : (m - h) * 1e6,
    highPpm: h === null ? null : (m + h) * 1e6,
    standardDeviation: sd,
    status:
      d.length < 2
        ? "One pair: across-session interval unavailable"
        : !sd
          ? "Zero observed between-session variance; insufficient for generalization"
          : d.length < 10
            ? "Small sample: approximate paired-session interval is unstable"
            : "Approximate paired-session 95% t interval",
  };
}
// xoshiro128** v1, independent seeds for simulation and resampling. Never assigns phase order.
export class Random {
  constructor(seed) {
    let x = seed >>> 0;
    this.s = Array.from({ length: 4 }, () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    });
  }
  next() {
    const s = this.s,
      r = Math.imul(s[1], 5),
      out = Math.imul((r << 7) | (r >>> 25), 9) >>> 0,
      t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return out;
  }
  uniform() {
    return this.next() / 4294967296;
  }
  int(n) {
    const limit = Math.floor(4294967296 / n) * n;
    let v;
    do {
      v = this.next();
    } while (v >= limit);
    return v % n;
  }
}
export function signSwap(d, seed, B = 99999) {
  if (!d.length) return null;
  const observed = d.reduce((a, b) => a + b, 0),
    tol =
      100 *
      Number.EPSILON *
      Math.max(
        Number.MIN_VALUE,
        d.reduce((s, x) => s + Math.abs(x), 0),
      );
  let extreme = 0;
  const exact = d.length <= 20,
    count = exact ? 2 ** d.length : B,
    r = new Random(seed);
  for (let b = 0; b < count; b++) {
    let sum = 0;
    for (let j = 0; j < d.length; j++)
      sum += (exact ? Math.floor(b / 2 ** j) % 2 === 0 : r.next() % 2 === 0)
        ? d[j]
        : -d[j];
    if (sum >= observed - tol) extreme++;
  }
  return {
    p: exact ? extreme / count : (extreme + 1) / (count + 1),
    method: exact
      ? "Exact within-session phase-label swaps"
      : "Monte Carlo within-session phase-label swaps (+1 correction)",
    replications: count,
    seed,
    resolution: 1 / (exact ? count : count + 1),
    ties: "Greater than or equal; 100-epsilon scale-relative tolerance",
    random: "xoshiro128**-v1",
  };
}
export function bootstrap(d, seed, B = 9999) {
  if (d.length < 10 || d.every((x) => x === d[0])) return null;
  const r = new Random(seed),
    samples = Array.from({ length: B }, () => {
      let sum = 0;
      for (let j = 0; j < d.length; j++) sum += d[r.int(d.length)];
      return (sum / d.length) * 1e6;
    }).sort((a, b) => a - b),
    q = (p) => {
      const t = (B - 1) * p,
        i = Math.floor(t);
      return (
        samples[i] + (samples[Math.min(i + 1, B - 1)] - samples[i]) * (t - i)
      );
    };
  return {
    lowPpm: q(0.025),
    highPpm: q(0.975),
    seed,
    replications: B,
    method:
      "Percentile sensitivity interval; whole session pairs; xoshiro128**-v1",
  };
}
export function aggregate(sessions, seed) {
  const valid = sessions.filter((s) => s.result),
    d = valid.map((s) => s.result.difference);
  let w = 0,
    weighted = 0;
  for (const s of valid) {
    const nu = Number(s.phases.find((p) => p.kind === "Up").bits),
      nd = Number(s.phases.find((p) => p.kind === "Down").bits),
      v = (nu * nd) / (nu + nd);
    w += v;
    weighted += v * s.result.difference;
  }
  // Equal session weights, so the rate means agree with the mean paired effect.
  return {
    pairs: d.length,
    effect: mean(d),
    upRate: d.length
      ? valid.reduce((v, s) => v + s.result.upRate, 0) / d.length
      : null,
    downRate: d.length
      ? valid.reduce((v, s) => v + s.result.downRate, 0) / d.length
      : null,
    exposureWeightedPpm: w ? (weighted / w) * 1e6 : null,
    test: signSwap(d, seed),
    bootstrap: bootstrap(d, (seed + 104729) >>> 0),
    weighting: "Equal weight per completed session pair",
    status: "Exploratory; pointwise intervals are not anytime-valid",
  };
}
// One session's counts as recorded, whether it finished or not.
export function directionCounts(s) {
  const of = (kind) => s.phases.find((p) => p.kind === kind),
    up = of("Up"),
    down = of("Down");
  return {
    upBits: Number(up?.bits || 0),
    upOnes: Number(up?.ones || 0),
    downBits: Number(down?.bits || 0),
    downOnes: Number(down?.ones || 0),
  };
}
// Every started session counts, however it ended. Each contributes a sum of
// excess ones, not a rate, so stopping sessions that look bad cannot favour the
// result: their shortfall stays in. A session that ended early counts only
// against the result: its remainder is unknown, and keeping a lucky start would
// reward stopping while ahead. Under chance no stopping strategy can then raise
// the result. The centre is the ones rate of all included bits, so a device
// bias cancels. Only the requested label-swap test runs: "effect" tests the
// sums themselves, "ratio" tests them scaled by each session's goal.
export function intentionToTreat(sessions, seed, replications = 99999, testOn = "effect") {
  const rows = sessions
    .map((s) => ({ s, ...directionCounts(s) }))
    .filter((x) => x.upBits + x.downBits > 0);
  if (!rows.length) return null;
  let upBits = 0,
    upOnes = 0,
    downBits = 0,
    downOnes = 0;
  for (const x of rows) {
    upBits += x.upBits;
    upOnes += x.upOnes;
    downBits += x.downBits;
    downOnes += x.downOnes;
  }
  const bits = upBits + downBits,
    centre = (upOnes + downOnes) / bits,
    excess = rows.map((x) => {
      const t = x.upOnes - centre * x.upBits - (x.downOnes - centre * x.downBits);
      return x.s.state === "Completed" ? t : Math.min(0, t);
    }),
    effect = (2 * excess.reduce((a, b) => a + b, 0)) / bits,
    toGoal = rows.map((x, i) => (2 * excess[i]) / x.s.config.difficulty.deltaGoal),
    n = rows.length,
    // Cluster-robust spread: each session is one unit, weighted by its bits.
    spread =
      n > 1
        ? Math.sqrt(
            (n / (n - 1)) *
              rows.reduce(
                (a, x, i) => a + (excess[i] - (effect / 2) * (x.upBits + x.downBits)) ** 2,
                0,
              ),
          )
        : null,
    half = spread ? (tQuantile(0.975, n - 1) * 2 * spread) / bits : null;
  return {
    sessions: n,
    finished: rows.filter((x) => x.s.state === "Completed").length,
    bits,
    upRate: upBits ? upOnes / upBits : null,
    downRate: downBits ? downOnes / downBits : null,
    effectPpm: effect * 1e6,
    lowPpm: half == null ? null : (effect - half) * 1e6,
    highPpm: half == null ? null : (effect + half) * 1e6,
    ratio: toGoal.reduce((a, b) => a + b, 0) / bits,
    test: signSwap(testOn === "ratio" ? toGoal : excess, seed, replications),
    method: "Every started session, an early end counting only against; sums of excess ones; within-session label swaps",
  };
}
// Display smoothing only: a three-second exponential half-life on ones counts.
// The smoothed rate is measured in its own standard errors, so the bulb moves
// the same under chance on a slow or a fast device. level is signed in (-1, 1):
// +0.8 at displayZ above the centre, -0.8 the same distance below. It never
// feeds analytical counts.
export class Smoother {
  constructor(state) {
    Object.assign(this, { weightedOnes: 0, weightedBits: 0, weightedSquares: 0 }, state);
  }
  update(k, n, dt, q0, displayZ) {
    const l = Math.exp((-Math.LN2 * dt) / 3);
    this.weightedOnes = l * this.weightedOnes + Number(k);
    this.weightedBits = l * this.weightedBits + Number(n);
    this.weightedSquares = l * l * this.weightedSquares + Number(n);
    const delta = this.weightedBits ? this.weightedOnes / this.weightedBits - q0 : null,
      se = this.weightedBits ? Math.sqrt(q0 * (1 - q0) * this.weightedSquares) / this.weightedBits : 0,
      z = delta !== null && se > 0 ? delta / se : null;
    return {
      level: z === null ? 0 : Math.tanh((Math.atanh(0.8) * z) / displayZ),
      deltaSmooth: delta,
      zSmooth: z,
    };
  }
}
