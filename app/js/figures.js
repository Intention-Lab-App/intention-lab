// Pictures for the guide: the real instruments in their states, the session's
// shape, the XOR mask at work, the chance curve behind the levels, the score and
// how sessions combine. Most are drawn from the app's own code and numbers, so
// they stay true as the app changes.
import { DIFFICULTIES } from "./core/protocol.js";
import { scoreValue, weightFor } from "./core/score.js";
import { createBulb } from "./bulb.js";
import { createBar } from "./bar.js";
import { createBox } from "./box.js";
import { icon } from "./icons.js";

const f1 = (v) => v.toFixed(1),
  density = (z) => Math.exp(-0.5 * z * z),
  odds = (d) => `1 in ${d.oneIn.toLocaleString("en-US")}`;

// The session: countdown, one direction, pause, the other.
export const timeline = () => `<figure class="fig">
<div class="tl" aria-hidden="true">
<span class="tl-seg tl-wait"><b>5 s</b><small>countdown</small></span>
<span class="tl-seg tl-up"><b>Brighter, up, or ones</b><small>1, 5, 10 or 20 min</small></span>
<span class="tl-seg tl-wait"><b>15 s</b><small>pause</small></span>
<span class="tl-seg tl-down"><b>Dimmer, down, or zeros</b><small>the same length</small></span>
</div>
<figcaption>${icon("shuffle")}The order of the two parts is drawn at random as you start.</figcaption>
</figure>`;

// The XOR mask on eight bits from a device that leans towards 1s.
export function xor() {
  const sent = [1, 1, 1, 0, 1, 1, 0, 1],
    mask = [0, 1, 0, 1, 0, 1, 0, 1],
    counted = sent.map((b, i) => b ^ mask[i]),
    row = (bits, cls = "", flips = null) =>
      `<span class="bits ${cls}">${bits.map((b, i) => `<i class="bit${b ? " on" : ""}${flips?.[i] ? " flip" : ""}">${b}</i>`).join("")}</span>`;
  return `<figure class="fig">
<div class="xor" role="img" aria-label="Eight bits from a device that leans towards 1s: six of them are 1s. After the alternating mask, four are 1s.">
<span class="xor-label">From the device</span>${row(sent)}<span class="xor-count">6 of 8 are 1s</span>
<span class="xor-label">Mask</span>${row(mask, "mask")}<span class="xor-count"></span>
<span class="xor-label">Counted</span>${row(counted, "", mask)}<span class="xor-count">4 of 8: even</span>
</div>
<figcaption>Where the mask has a 1, the bit is flipped. A device's lean towards 1s turns into an even count.</figcaption>
</figure>`;
}

// One game's real instrument in its states, mounted live by mount(). The meter
// is shown at rest, four fifths of the way through a part and at its end, with
// a Balanced session's red goal needle where it stands at that point. The box
// is shown sealed, and open on a record made up for the picture.
const goalAt = (progress) => ((DIFFICULTIES[1].z / Math.SQRT2) * Math.sqrt(progress)).toFixed(2);
const STATES = {
  Bulb: `<div class="states">
<div class="state"><div class="state-view lamp-fig lit" data-fig-bulb="-0.85"></div><span>More 0s: cooling</span></div>
<div class="state"><div class="state-view lamp-fig lit" data-fig-bulb="0"></div><span>At rest</span></div>
<div class="state"><div class="state-view lamp-fig lit" data-fig-bulb="0.95"></div><span>More 1s: bright</span></div>
</div>`,
  Bar: `<div class="states">
<div class="state"><div class="state-view bar-fig lit" data-fig-bar=""></div><span>At rest</span></div>
<div class="state"><div class="state-view bar-fig lit" data-fig-bar="1.12" data-goal="${goalAt(0.8)}" data-progress="0.8"></div><span>On track</span></div>
<div class="state"><div class="state-view bar-fig lit" data-fig-bar="2.3" data-goal="${goalAt(1)}" data-progress="1"></div><span>Past the red needle</span></div>
</div>`,
  Box: `<div class="states two">
<div class="state"><div class="state-view box-fig lit" data-fig-box="sealed"></div><span>Sealed while you play</span></div>
<div class="state"><div class="state-view box-fig lit" data-fig-box="open"></div><span>Open when complete</span></div>
</div>`,
};
export const instruments = (game) => `<figure class="fig">${STATES[game]}</figure>`;
// A made-up record for the open box in the guide: two parts of a minute, a
// little your way, from a fixed seed so it is the same every time.
function sampleRecord() {
  let s = 20261011;
  const r = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    },
    walk = (lean) => {
      let sum = 0;
      return Array.from({ length: 240 }, (_, k) => {
        sum += Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()) + lean;
        return [(k + 1) / 240, sum / Math.sqrt(k + 1)];
      });
    };
  return { parts: [{ kind: "Down", points: walk(-0.06) }, { kind: "Up", points: walk(0.09) }] };
}

// The chance curve. Pick a level to see the share of chance results past its goal.
const X0 = 24,
  X1 = 536,
  Z0 = -3.2,
  Z1 = 4.3,
  BASE = 172,
  PEAK = 148,
  zx = (z) => X0 + ((z - Z0) / (Z1 - Z0)) * (X1 - X0),
  zy = (z) => BASE - PEAK * density(z);
function curvePath(from = Z0, to = Z1, closed = false) {
  let d = "";
  for (let z = from; z <= to + 1e-9; z += 0.04) d += `${d ? "L" : "M"}${f1(zx(z))} ${f1(zy(z))}`;
  return closed ? `M${f1(zx(from))} ${BASE}` + d.replace(/^M/, "L") + `L${f1(zx(to))} ${BASE}Z` : d;
}
// The tail past z, lit along its edge so even a sliver shows.
const tail = (z, cls = "") =>
  `<path class="ch-tail ${cls}" d="${curvePath(z, Z1, true)}"/><path class="ch-edge ${cls}" d="${curvePath(z, Z1)}"/>`;
// A dashed mark at z rising above the curve, its odds on top. Near the far end
// the label hangs to the left so it stays inside the picture.
function mark(z, text, rise = 26, end = zx(z) > 440) {
  const x = zx(z),
    top = zy(z) - rise;
  return `<line class="ch-mark" x1="${f1(x)}" x2="${f1(x)}" y1="${f1(top)}" y2="${BASE}"/><text class="ch-odds" x="${f1(end ? x + 4 : x - 4)}" y="${f1(top - 8)}" text-anchor="${end ? "end" : "start"}">${text}</text>`;
}
export function chance() {
  const d = DIFFICULTIES[1];
  return `<figure class="fig fig-chance" data-chance>
<svg viewBox="0 0 560 214" role="img" aria-label="A bell curve of results by chance alone. The shaded tail past the goal is how often chance reaches it.">
<path class="ch-curve-fill" d="${curvePath(Z0, Z1, true)}"/>
<path class="ch-curve" d="${curvePath()}"/>
<g class="ch-goal">${tail(d.z)}${mark(d.z, odds(d))}</g>
<line class="ch-base" x1="${X0}" x2="${X1}" y1="${BASE}" y2="${BASE}"/>
<line class="ch-zero" x1="${f1(zx(0))}" x2="${f1(zx(0))}" y1="${BASE}" y2="${BASE + 6}"/>
<text class="ch-axis" x="${X0}" y="${BASE + 26}">the wrong way</text>
<text class="ch-axis" x="${f1(zx(0))}" y="${BASE + 26}" text-anchor="middle">even</text>
<text class="ch-axis" x="${X1}" y="${BASE + 26}" text-anchor="end">your way</text>
</svg>
<div class="goal-list" role="group" aria-label="Levels">${DIFFICULTIES.map(
    (l) =>
      `<button type="button" data-level="${l.id}" aria-pressed="${l.id === d.id}"><span>${l.label}</span><b>${odds(l)}</b></button>`,
  ).join("")}</div>
<figcaption>Results from chance alone pile up near even. The shaded tail is how often chance alone reaches the goal: the harder the level, the thinner the tail.</figcaption>
</figure>`;
}
function chooseLevel(fig, id) {
  const d = DIFFICULTIES.find((l) => l.id === Number(id));
  if (!d) return;
  fig.querySelector(".ch-goal").innerHTML = tail(d.z) + mark(d.z, odds(d));
  for (const b of fig.querySelectorAll("[data-level]")) b.setAttribute("aria-pressed", String(b.dataset.level === String(id)));
}

// The score against how far a session got towards a Balanced goal, each game.
// What each scores at the goal is listed above the curves, in the dots' order.
export function score() {
  const L = DIFFICULTIES[1],
    W = 560,
    H = 230,
    left = 44,
    right = 500,
    top = 18,
    bottom = 182,
    rx = (r) => left + (r / 2) * (right - left),
    sy = (s) => bottom - (s / 100) * (bottom - top),
    line = (game) => {
      let d = "";
      for (let r = 0; r <= 2.0001; r += 0.02) d += `${d ? "L" : "M"}${f1(rx(r))} ${f1(sy(scoreValue(r, r * L.z, weightFor(game))))}`;
      return d;
    },
    at = (game) => scoreValue(1, L.z, weightFor(game)),
    games = ["Bulb", "Box", "Bar"].sort((a, b) => at(b) - at(a));
  return `<figure class="fig">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score against how far a session got towards a Balanced goal. Reaching the goal scores ${at("Bulb")} on the Bulb, ${at("Box")} on the Box and ${at("Bar")} on the Bar.">
${[0, 50, 100].map((s) => `<line class="sc-grid" x1="${left}" x2="${right}" y1="${f1(sy(s))}" y2="${f1(sy(s))}"/><text class="ch-axis" x="${left - 10}" y="${f1(sy(s) + 4)}" text-anchor="end">${s}</text>`).join("")}
<line class="sc-goal" x1="${f1(rx(1))}" x2="${f1(rx(1))}" y1="${top}" y2="${bottom}"/>
<path class="sc-line bar" d="${line("Bar")}"/>
<path class="sc-line box" d="${line("Box")}"/>
<path class="sc-line bulb" d="${line("Bulb")}"/>
${games.map((g) => `<circle class="sc-dot ${g.toLowerCase()}" cx="${f1(rx(1))}" cy="${f1(sy(at(g)))}" r="5"/>`).join("")}
${games.map((g, i) => `<text class="sc-key ${g.toLowerCase()}" x="${f1(rx(1) - 12)}" y="${f1(top + 4 + i * 16)}" text-anchor="end">${g} ${at(g)}</text>`).join("")}
<text class="ch-axis" x="${left}" y="${bottom + 24}">none</text>
<text class="ch-axis" x="${f1(rx(1))}" y="${bottom + 24}" text-anchor="middle">the goal</text>
<text class="ch-axis" x="${right}" y="${bottom + 24}" text-anchor="end">twice the goal</text>
</svg>
<figcaption>How a Balanced session scores as it gets closer to its goal, and past it.</figcaption>
</figure>`;
}

// Pooling: many small, mixed session results become one overall estimate.
export function pooled() {
  const heights = [14, -22, 30, -8, 18, -34, 6, 24, -16, 10, -26, 20, -4, 12, -12],
    mid = 92;
  return `<figure class="fig">
<svg viewBox="0 0 560 190" role="img" aria-label="Many sessions, some up and some down, combine into one overall result close to zero.">
<line class="ch-base" x1="20" x2="540" y1="${mid}" y2="${mid}"/>
${heights.map((h, i) => `<line class="pool-bar${h > 0 ? " up" : ""}" x1="${30 + i * 20}" x2="${30 + i * 20}" y1="${mid}" y2="${mid - h * 1.6}"/>`).join("")}
<path class="pool-join" d="M330 ${mid - 40}C400 ${mid - 30} 420 ${mid - 6} 470 ${mid - 4}M330 ${mid + 40}C400 ${mid + 30} 420 ${mid + 2} 470 ${mid - 2}"/>
<line class="pool-range" x1="486" x2="486" y1="${mid - 18}" y2="${mid + 10}"/>
<circle class="pool-dot" cx="486" cy="${mid - 4}" r="7"/>
<text class="ch-axis" x="30" y="174">each session</text>
<text class="ch-axis" x="486" y="174" text-anchor="middle">together</text>
</svg>
<figcaption>Lucky and unlucky sessions cancel out. Only a lean that keeps coming back moves the overall score.</figcaption>
</figure>`;
}

// Which sessions count, and how.
export const counts = () => `<figure class="fig">
<div class="counts">
<span class="count-name">Finished</span><span class="count-bar"><i class="win"></i></span><span class="count-note">counts as it is, either way</span>
<span class="count-name">Stopped while behind</span><span class="count-bar"><i class="loss"></i></span><span class="count-note">the shortfall counts</span>
<span class="count-name">Stopped while ahead</span><span class="count-bar"><i class="dropped"></i></span><span class="count-note">the lead is dropped</span>
</div>
</figure>`;

// What a convincing result would take.
export const steps = () => `<figure class="fig"><ol class="steps">
<li>${icon("flag")}<b>Plan</b><span>Fix the number of sessions and the game before the first one.</span></li>
<li>${icon("play")}<b>Play them all</b><span>Every session you start counts.</span></li>
<li>${icon("target")}<b>A strong result</b><span>Chance does as well less than 1 time in 1,000.</span></li>
<li>${icon("repeat")}<b>Do it again</b><span>A second challenge agrees.</span></li>
</ol></figure>`;

// Bring the live pictures in a rendered guide to life. Returns a cleanup.
export function mount(root, lab) {
  const live = [];
  for (const el of root.querySelectorAll("[data-fig-bulb]")) {
    const bulb = createBulb(el, { light: el, glassBottom: 0.9, height: 0.66, width: 0.78, label: el.nextElementSibling?.textContent || "The bulb" });
    bulb.snap(Number(el.dataset.figBulb));
    live.push(bulb);
  }
  for (const el of root.querySelectorAll("[data-fig-bar]")) {
    const bar = createBar(el, { light: el, lab, label: el.nextElementSibling?.textContent || "The bar" }),
      z = el.dataset.figBar === "" ? null : Number(el.dataset.figBar);
    bar.set(z, el.dataset.goal ? Number(el.dataset.goal) : null, {
      showGoal: true,
      rest: z == null,
      progress: el.dataset.progress ? Number(el.dataset.progress) : null,
    });
    bar.snap(z);
    live.push(bar);
  }
  for (const el of root.querySelectorAll("[data-fig-box]")) {
    const open = el.dataset.figBox === "open",
      box = createBox(el, { light: el, level: 2, motes: 70, label: open ? "The box open at the end, its record on the lid" : "The box sealed while you play" });
    if (open) {
      box.ask("Up", { quiet: true });
      box.show(sampleRecord(), 3);
    }
    live.push(box);
  }
  for (const fig of root.querySelectorAll("[data-chance]")) {
    const pick = (e) => {
      const b = e.target.closest("[data-level]");
      if (b) chooseLevel(fig, b.dataset.level);
    };
    fig.addEventListener("click", pick);
    fig.addEventListener("pointerover", pick);
    fig.addEventListener("focusin", pick);
  }
  return () => live.forEach((x) => x.destroy());
}
