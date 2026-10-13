import { scoreLight, css } from "./tungsten.js";
import { chance } from "./core/score.js";
import { icon } from "./icons.js";
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const MINUS = "−";
export function number(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return "Unavailable";
  return Number(n)
    .toLocaleString("en-US", { maximumFractionDigits: digits })
    .replace("-", MINUS);
}
export function count(n) {
  if (n == null) return "Unavailable";
  try {
    return BigInt(n).toLocaleString("en-US");
  } catch {
    return "Unavailable";
  }
}
export const signed = (n, digits = 1) =>
  n == null || !Number.isFinite(Number(n))
    ? "Unavailable"
    : (n > 0 ? "+" : "") + number(n, digits);
export const rate = (n, digits = 4) =>
  n == null ? "Unavailable" : number(n * 100, digits) + "%";
export function pvalue(p, text) {
  if (text) return text.replace("-", MINUS);
  if (p == null) return "Unavailable";
  return p < 0.0001 ? p.toExponential(2).replace("-", MINUS) : p.toFixed(4);
}
export function interval(lo, hi, unit = " per million") {
  return lo == null || hi == null
    ? "Interval unavailable"
    : `${signed(lo)} to ${signed(hi)}${unit}`;
}
export function date(utc, timezone, style = "medium") {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: style,
    timeStyle: "short",
    timeZone: timezone || undefined,
  }).format(new Date(utc));
}
export function timer(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function minutesText(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
// A device in the app's own words: the name you gave it, or a plain description
// when it is a recognised random number generator. No product names.
export function deviceName(d, port) {
  const base =
    d?.userLabel ||
    (d?.familyHint
      ? "Random number generator"
      : String(d?.label || "Device").replace(/\s*\(COM\d+\)\s*$/i, ""));
  return port ? `${base} on ${port}` : base;
}
export const plural = (n, word, many = word + "s") =>
  `${Number(n).toLocaleString("en-US")} ${n === 1 ? word : many}`;
// Each game speaks its own language for the two directions. Up always means
// aiming for more 1s: the bulb brighter, the bar up, the box filled with ones.
const WORDS = {
  Bulb: {
    Up: "Make it brighter",
    Down: "Make it dimmer",
    UpName: "Brighter",
    DownName: "Dimmer",
    UpDoing: "made it brighter",
    DownDoing: "made it dimmer",
    UpAim: "aiming brighter",
    DownAim: "aiming dimmer",
  },
  Bar: {
    Up: "Push it up",
    Down: "Push it down",
    UpName: "Up",
    DownName: "Down",
    UpDoing: "pushed it up",
    DownDoing: "pushed it down",
    UpAim: "aiming up",
    DownAim: "aiming down",
  },
  Box: {
    Up: "Fill it with ones",
    Down: "Fill it with zeros",
    UpName: "Ones",
    DownName: "Zeros",
    UpDoing: "asked for ones",
    DownDoing: "asked for zeros",
    UpAim: "asking for ones",
    DownAim: "asking for zeros",
  },
};
const words = (game) => WORDS[game] || WORDS.Bulb;
export const instruction = (game, kind) => words(game)[kind] ?? kind;
export const direction = (game, kind) => words(game)[kind + "Name"] ?? kind;
export const aiming = (game, kind) => words(game)[kind + "Aim"] ?? kind;
export const order = (s) => {
  const [first, second] = s.upFirst ? ["Up", "Down"] : ["Down", "Up"];
  return `${direction(s.config.game, first)} first, then ${direction(s.config.game, second).toLowerCase()}`;
};
// Simple or Lab, as a two-part switch. Every copy of it stays in step.
export const modeControl = (lab) =>
  `<div class="mode" role="group" aria-label="Mode"><button type="button" data-mode="simple" aria-pressed="${!lab}">${icon("feather")}Simple</button><button type="button" data-mode="lab" aria-pressed="${!!lab}">${icon("flask")}Lab</button></div>`;
const INFO = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="6.2" r="1.15" fill="currentColor"/><path d="M10 9v5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
// A small "i" that opens the guide at one topic.
export const infoButton = (topic, label) =>
  `<button class="info" type="button" data-guide="${esc(topic)}" aria-label="${esc(label)}" title="${esc(label)}">${INFO}</button>`;
export function sessionLine(s, { withDate = false, timezone } = {}) {
  const c = s.config,
    parts = [c.game, c.difficulty.label, `${c.durationMinutes} min each way`];
  if (withDate) parts.push(date(s.createdUtc, timezone));
  return parts.join(", ");
}
// The score shares the lamp's colour physics.
export function scoreStyle(value) {
  if (value == null) return "";
  const l = scoreLight(value);
  if (!value) return "--score-color: var(--ink-3); --score-glow: 0";
  const color = css(l.rgb.map((v) => 40 + (v - 40) * Math.min(1, 0.35 + l.brightness * 0.7)));
  return `--score-color: ${color}; --score-glow: ${Math.min(1.3, l.glow).toFixed(3)}; --score-halo: ${css(l.rgb, 0.55)}`;
}
export function verdict(session) {
  const v = session.score?.value,
    d = session.result?.difference;
  if (v == null) return "No score for this session.";
  if (d < 0) return "This one went the opposite way.";
  if (!v) return "No difference between up and down.";
  if (v < 25) return "A slight move your way.";
  if (v < 50) return "A modest move your way.";
  if (v < 75) return "A clear move your way.";
  if (v < 90) return "A strong move your way.";
  return "An exceptional move your way.";
}
// A scored session in everyday words, for the end of a game.
export function explanation(s) {
  const r = s.result,
    level = s.config.difficulty,
    ratio = r.difference / level.deltaGoal,
    size = Math.abs(r.effectPpm),
    amount = size < 1 ? "less than 1" : Math.round(size).toLocaleString("en-US"),
    w = words(s.config.game),
    up = w.UpDoing,
    down = w.DownDoing,
    source = `${s.config.source === "Simulation" ? "The simulation" : "Your device"} sends random 0s and 1s.`,
    odds = chance(s.score.p, s.score.value);
  const happened =
    r.effectPpm > 0
      ? `${source} While you ${up}, slightly more of them were 1s than while you ${down}: ${amount} more in every million.`
      : r.effectPpm < 0
        ? `${source} While you ${up}, slightly fewer of them were 1s than while you ${down}: ${amount} fewer in every million. That is the opposite of what you asked for.`
        : `${source} Both directions came out exactly even.`;
  const reach =
    ratio <= 0
      ? "This session went the other way."
      : ratio < 0.995
        ? `You got ${Math.max(1, Math.round(ratio * 100))}% of the way.`
        : ratio < 1.05
          ? "You reached it."
          : `You passed it, at ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)} times the goal.`;
  const luck = !s.score.value
    ? "Random bits always wobble a little, in either direction."
    : odds.oneIn < 20
      ? "That is common, so one session like this can easily be luck."
      : odds.oneIn < 1000
        ? "That is uncommon, but one session can still be luck. What counts is whether it keeps happening."
        : "That is rare. See whether it keeps happening in your next sessions.";
  return {
    happened,
    goal: `${level.label} asks for a result that chance alone reaches only 1 time in ${level.oneIn.toLocaleString("en-US")}. For this session that meant ${Math.max(1, Math.round(level.goalPpm)).toLocaleString("en-US")} more in every million. ${reach}`,
    fill: Math.max(0, Math.min(1, ratio)),
    chance: odds.text,
    luck,
  };
}
export function overallVerdict(o) {
  if (!o) return "Play a few sessions to see an overall score.";
  if (o.sessions < 3 && !o.value)
    return "Too few sessions to tell yet. The overall score grows only when sessions agree.";
  if (o.ratio <= 0) return "Across your sessions, the results have not leaned your way.";
  if (!o.value) return "Your sessions do not yet agree on a direction.";
  if (o.value < 25) return "Across your sessions, a slight lean your way.";
  if (o.value < 50) return "Across your sessions, a modest lean your way.";
  if (o.value < 75) return "Across your sessions, a clear lean your way.";
  return "Across your sessions, a strong and consistent lean your way.";
}
export function stopReason(s) {
  if (s.state === "Aborted") return "Stopped early.";
  if (s.state === "Faulted") {
    const r = s.failureReason || "";
    if (/disconnect/i.test(r)) return "The device was disconnected.";

    if (/IndexedDB|storage/i.test(r)) return "The session could not be saved.";
    if (/gap|unavailable|sleep|stream|bridge/i.test(r))
      return "The device stream was interrupted.";
    return "The session was interrupted.";
  }
  return "";
}
export function table(headers, rows, caption = "") {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(caption || "Data table")}"><table>${caption ? `<caption>${esc(caption)}</caption>` : ""}<thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v ?? "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export const empty = (title, body, glyph = "lens") =>
  `<div class="empty">${icon(glyph)}<h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
