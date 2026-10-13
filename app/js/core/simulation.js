import { Random } from "./statistics.js";
// Test scenarios only. IntentionShift raises the ones rate during Up and lowers
// it by the same amount during Down; nothing else knows which phase is which.
// It acts on the counted bits, as an effect that follows the aim would: with the
// XOR mask on, its bytes are made in the counted form and masked back. The
// other scenarios are properties of the device and act on the bytes as sent.
export const SCENARIOS = [
  "Unbiased",
  "CommonBias",
  "IntentionShift",
  "Drift",
  "Correlated",
  "Interrupted",
  "Disconnection",
];
export const DEFAULT_SIMULATION = Object.freeze({
  scenario: "Unbiased",
  seed: 12345,
  bytesPerSecond: 50000,
  commonBias: 0.001,
  intentionShift: 0.00018,
  driftPerMinute: 0.0002,
  failureAfterSeconds: 12,
});
export function validateSimulation(s) {
  if (
    !SCENARIOS.includes(s.scenario) ||
    !Number.isInteger(s.seed) ||
    !Number.isFinite(s.bytesPerSecond) ||
    s.bytesPerSecond < 1000 ||
    s.bytesPerSecond > 1000000 ||
    ![
      s.commonBias,
      s.intentionShift,
      s.driftPerMinute,
      s.failureAfterSeconds,
    ].every(Number.isFinite)
  )
    throw Error("Invalid simulation configuration");
}
export class Simulator {
  constructor(settings) {
    validateSimulation(settings);
    this.settings = settings;
    this.random = new Random(settings.seed);
  }
  bytes(n, phase, seconds, mask = 0) {
    const s = this.settings,
      r = this.random;
    if (s.scenario === "Disconnection" && seconds >= s.failureAfterSeconds)
      throw Error("Simulated device disconnection");
    if (
      s.scenario === "Interrupted" &&
      seconds >= s.failureAfterSeconds &&
      seconds < s.failureAfterSeconds + 4
    )
      return new Uint8Array(0);
    let p = 0.5;
    if (s.scenario === "CommonBias") p += s.commonBias;
    if (s.scenario === "IntentionShift")
      p += phase === "Up" ? s.intentionShift : phase === "Down" ? -s.intentionShift : 0;
    if (s.scenario === "Drift") p += (s.driftPerMinute * seconds) / 60;
    p = Math.max(0.01, Math.min(0.99, p));
    const bytes = new Uint8Array(n);
    if (s.scenario === "Correlated") {
      for (let i = 0; i < n; i += 32)
        bytes.fill(r.uniform() < p ? 255 : 0, i, Math.min(n, i + 32));
      return bytes;
    }
    if (p === 0.5) {
      for (let i = 0; i < n; i += 4) {
        let word = r.next();
        for (let j = 0; j < 4 && i + j < n; j++) {
          bytes[i + j] = word % 256;
          word = Math.floor(word / 256);
        }
      }
    } else
      for (let i = 0; i < n; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) if (r.uniform() < p) b += 2 ** j;
        bytes[i] = s.scenario === "IntentionShift" ? b ^ mask : b;
      }
    return bytes;
  }
}
