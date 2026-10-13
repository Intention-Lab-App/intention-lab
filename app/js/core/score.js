// Score version 2: one number from 0 to 100 per completed Up/Down session.
// Inputs are the session's Up-minus-Down effect relative to the level's goal
// (magnitude) and its one-sided Z (evidence). The goal is set from the session's
// planned bits, so effect/goal is close to Z divided by the level's threshold and
// a score means the same on any device and at any length. Zero for a zero or
// negative effect. Stored with each session and never recomputed.
import { normalQuantile, intentionToTreat } from "./statistics.js";
export const SCORE_VERSION = "score-v2";
export const SCORE_PARAMETERS = Object.freeze({
  version: SCORE_VERSION,
  magnitudeRate: 2.7,
  evidenceScale: 1.7,
  evidenceShape: 2.5,
  magnitudeWeight: Object.freeze({ Bulb: 0.6, Bar: 0.3, Box: 0.45, All: 0.45 }),
  formula:
    "score = 100 * M^w * E^(1-w); M = 1 - exp(-2.7 * effect/goal); E = 1 - exp(-(Z/1.7)^2.5); w = 0.6 Bulb, 0.3 Bar, 0.45 Box and all games together; 0 when effect or Z <= 0",
});
const P = SCORE_PARAMETERS;
export const magnitudeComponent = (ratio) =>
  Number.isFinite(ratio) && ratio > 0 ? 1 - Math.exp(-P.magnitudeRate * ratio) : 0;
export const evidenceComponent = (z) =>
  Number.isFinite(z) && z > 0
    ? 1 - Math.exp(-Math.pow(z / P.evidenceScale, P.evidenceShape))
    : 0;
export const weightFor = (game) =>
  P.magnitudeWeight[game] ?? P.magnitudeWeight.All;
export function rawScore(ratio, z, weight) {
  const m = magnitudeComponent(ratio),
    e = evidenceComponent(z);
  if (!m || !e) return 0;
  return 100 * Math.pow(m, weight) * Math.pow(e, 1 - weight);
}
// Any positive effect shows at least 1 so that 0 always means "none or negative".
export function scoreValue(ratio, z, weight) {
  if (!(ratio > 0) || !(z > 0)) return 0;
  return Math.min(100, Math.max(1, Math.round(rawScore(ratio, z, weight))));
}
export function sessionScore(session) {
  const r = session.result,
    goal = session.config?.difficulty?.deltaGoal;
  if (!r || !r.modelValid || !Number.isFinite(r.z) || !(goal > 0)) return null;
  const ratio = r.difference / goal,
    weight = weightFor(session.config.game);
  return {
    version: SCORE_VERSION,
    value: scoreValue(ratio, r.z, weight),
    raw: Number(rawScore(ratio, r.z, weight).toFixed(6)),
    game: session.config.game,
    ratio,
    z: r.z,
    p: r.pOneSided,
    magnitude: magnitudeComponent(ratio),
    evidence: evidenceComponent(r.z),
    weight,
  };
}
// Across sessions: every started session counts, with the bits it collected.
// Magnitude is the bit-weighted effect relative to each session's goal; evidence
// is the within-session label-swap test on the goal-scaled sums. Never an
// average of session scores, so noise cannot accumulate into a rising score,
// and stopping a session early cannot raise it.
export function overallScore(sessions, seed, game = "All", replications = 99999) {
  const all = intentionToTreat(sessions, seed, replications, "ratio");
  if (!all) return null;
  const p = all.test.p,
    z = p > 0 && p < 1 ? normalQuantile(1 - p) : p <= 0 ? Infinity : -Infinity,
    weight = weightFor(game);
  return {
    version: SCORE_VERSION,
    game,
    sessions: all.sessions,
    finished: all.finished,
    value: scoreValue(all.ratio, z, weight),
    raw: Number(rawScore(all.ratio, z, weight).toFixed(6)),
    ratio: all.ratio,
    z: Number.isFinite(z) ? z : null,
    p,
    weight,
    method: all.test.method + " on goal-scaled sums of excess ones, every started session",
    replications: all.test.replications,
    seed,
  };
}
// Plain-language chance line. For a fixed session the score rises with the
// effect, so P(score at least this high | chance) equals the one-sided p.
export function chance(p, value) {
  if (!(value > 0) || p == null || !(p < 0.5))
    return { oneIn: null, text: "Chance alone does this well most of the time." };
  if (p < 1e-4)
    return { oneIn: 10000, text: "Chance alone does this well less than 1 time in 10,000." };
  const n = 1 / p,
    nice =
      n < 20
        ? Math.round(n)
        : n < 100
          ? Math.round(n / 5) * 5
          : Number(n.toPrecision(2));
  return {
    oneIn: nice,
    text: `Chance alone does this well about 1 time in ${nice.toLocaleString("en-US")}.`,
  };
}
