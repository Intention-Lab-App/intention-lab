// Progress: "am I getting anywhere", answered from the aggregate. The overall
// score uses the mean effect relative to goal and the across-session swap test,
// never an average of session scores. The Lab adds the full Insights below.
import { request, query } from "./api.js";
import { state, playSource, playMask } from "./state.js";
import {
  esc,
  scoreStyle,
  overallVerdict,
  minutesText,
  plural,
  date,
  infoButton,
} from "./format.js";
import { chance } from "./core/score.js";
import { renderAnalytics, cancelAnalytics } from "./analytics.js";
import { icon, gameIcon } from "./icons.js";
import { GAMES } from "./core/protocol.js";
let controller;
export function cancelProgress() {
  controller?.abort();
  cancelAnalytics();
}
// Drawn at the width it will be shown, so labels stay legible on a phone.
function timeline(points, available = 900) {
  const W = Math.max(320, Math.min(1100, Math.round(available))),
    H = W < 600 ? 200 : 240,
    L = 44,
    R = 12,
    T = 14,
    B = 30,
    n = points.length,
    x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1)),
    y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  let svg = "";
  for (const v of [0, 25, 50, 75, 100])
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? "chart-axis" : "chart-grid"}"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" class="chart-tick">${v}</text>`;
  points.forEach((p, i) => {
    // A session that ended early has no score of its own; its bits still count.
    if (p.ended) {
      const cx = x(i),
        cy = y(0),
        k = n > 120 ? 3 : 4.5;
      svg += `<g tabindex="0" role="link" data-open-session="${esc(p.id)}" aria-label="${esc(`${p.game}, ${p.level}, ended early, ${date(p.utc, state.timezone)}`)}"><path d="M${cx - k} ${cy - k}l${2 * k} ${2 * k}m0 ${-2 * k}l${-2 * k} ${2 * k}" class="chart-ended"/><title>${esc(`${p.game}, ${p.level}, ${p.minutes} min each way: ended early. It counts in the overall score only if it was going against you.`)}</title></g>`;
      return;
    }
    const style = scoreStyle(p.score).match(/--score-color: ([^;]+)/)?.[1] || "var(--ink-3)";
    svg += `<g tabindex="0" role="link" data-open-session="${esc(p.id)}" aria-label="${esc(`${p.game}, ${p.level}, score ${p.score}, ${date(p.utc, state.timezone)}`)}"><circle cx="${x(i)}" cy="${y(p.score)}" r="${n > 120 ? 3 : 5}" ${p.clean ? `fill="${style}"` : `class="chart-dot flagged"`}/><title>${esc(`${p.game}, ${p.level}, ${p.minutes} min each way: ${p.score}${p.clean ? "" : " (quality check needed)"}`)}</title></g>`;
  });
  svg += `<text x="${L}" y="${H - 6}" class="chart-tick">First session</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="chart-tick">Latest</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Session scores in order">${svg}</svg>`;
}
export async function renderProgress() {
  controller?.abort();
  controller = new AbortController();
  const host = document.getElementById("progress-content"),
    lab = state.lab,
    source = lab ? state.filter.source || "Hardware" : playSource(),
    mask = lab ? state.filter.mask || "on" : playMask();
  host.innerHTML = '<p class="hint">Calculating.</p>';
  const p = await request("/progress?" + query({ source, mask, timezone: state.timezone }), {
    signal: controller.signal,
  });
  const o = p.overall,
    sim =
      (source === "Simulation" ? ' <span class="tag sim">Simulation</span>' : "") +
      (mask === "off" ? ' <span class="tag warn">XOR off</span>' : "");
  if (!p.sessions && !p.attempts) {
    host.innerHTML = `<div class="empty">${icon("trend")}<h2>No sessions yet${sim}</h2><p>Play a few sessions. Your overall score appears here once there is something to compare.</p><a class="primary" href="#play">Play</a></div>`;
  } else {
    // Below three sessions the label-swap test cannot show agreement, so an
    // overall score would be structurally near zero. Say so instead.
    const MIN = 3,
      ready = (x) => x && x.sessions >= MIN,
      value = ready(o) ? o.value : null,
      game = (g) => {
        const x = p.games[g];
        return `<div class="stat"><dt>${icon(gameIcon(g))}${g}</dt><dd style="${ready(x) ? scoreStyle(x.value) : ""}">${ready(x) ? x.value : "–"}<small>${x ? (ready(x) ? plural(x.sessions, "session") : `${plural(x.sessions, "session")}, needs ${MIN}`) : "Not played yet"}</small></dd></div>`;
      };
    host.innerHTML = `<div class="progress-hero${value == null ? " waiting" : ""}">
${value == null ? "" : `<p class="score" style="${scoreStyle(value)}" aria-label="Overall score ${value}">${value}</p>`}
<div><p class="score-label">Overall score${infoButton("overall", "How the overall score works")}${sim}</p><p class="verdict">${esc(value == null ? `Play ${plural(MIN - (o?.sessions || 0), "more session")} for an overall score.` : overallVerdict(o))}</p><p class="chance">${value == null ? "It needs a few sessions, because it measures whether they agree." : `${esc(chance(o.p, o.value).text)} Based on ${plural(p.started, "session")} you started${p.endedEarly ? `, ${p.endedEarly} of them ended early` : ""}.`}</p></div>
</div>
<dl class="stats">${GAMES.map(game).join("")}<div class="stat wide row-start"><dt>${icon("checks")}Sessions</dt><dd>${p.sessions}<small>${p.attempts - p.sessions ? plural(p.attempts - p.sessions, "stopped attempt") : "None stopped"}</small></dd></div><div class="stat wide"><dt>${icon("timer")}Time measured</dt><dd>${esc(minutesText(p.measuredSeconds))}<small>Both directions</small></dd></div></dl>
${p.timeline.length ? `<section class="timeline"><h2>Every session</h2>${timeline(p.timeline, host.clientWidth)}<p class="fine">Each dot is one session's score; hollow dots needed a quality check. Crosses are sessions that ended early.</p></section>` : ""}
<p class="fine footnote">The overall score is not an average. It combines how far your sessions moved on average, relative to each goal, with how unlikely that average is by chance. With no real effect, playing more does not make it climb. Every session you start counts. One that ends early counts only if it was going against you, so stopping early can never raise the score.</p>`;
  }
  if (lab) await renderAnalytics();
}
