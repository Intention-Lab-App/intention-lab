// One session's result: the score ceremony, then the complete analysis on
// demand. The same view serves the end of a game and a session opened from
// History. Lab mode adds the full record: configuration, events, buckets,
// notes and exports.
import { request, post, download } from "./api.js";
import { state, action, message } from "./state.js";
import {
  esc,
  number,
  count,
  signed,
  rate,
  pvalue,
  interval,
  date,
  timer,
  order,
  sessionLine,
  deviceName,
  scoreStyle,
  verdict,
  stopReason,
  table,
  instruction,
  explanation,
  infoButton,
  direction,
  aiming,
} from "./format.js";
import { terminal } from "./core/protocol.js";
import { createBulb } from "./bulb.js";
import { createBar } from "./bar.js";
import { createBox, boxRecord } from "./box.js";
import { icon } from "./icons.js";
let cleanup = [];
export function disposeResult() {
  cleanup.forEach((f) => f());
  cleanup = [];
}
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function heroHtml(s, { withDate, actions }) {
  const sim = s.config.source === "Simulation",
    tags = [
      sim ? '<span class="tag sim">Simulation</span>' : "",
      s.config.challengeId ? '<span class="tag">Challenge</span>' : "",
      s.config.xorMask ? "" : '<span class="tag warn">XOR off</span>',
      s.state === "Completed" && !s.clean && !s.isReference
        ? '<span class="tag warn">Quality check needed</span>'
        : "",
    ].join(" "),
    meta = esc(sessionLine(s, { withDate, timezone: state.timezone }));
  let body,
    explain = "";
  if (s.isReference)
    body = `<h1 class="verdict">Reference capture ${s.state === "Completed" ? "saved" : "incomplete"}.</h1><p class="lead">Five minutes of data with no intention, available in Lab mode as a display centre for future sessions.</p>`;
  else if (s.state !== "Completed")
    body = `<h1 class="verdict">${esc(stopReason(s))}</h1><p class="lead">${
      s.phases.some((p) => Number(p.bits) > 0)
        ? "It has no score of its own. It still counts toward your overall score if it was going against you, and not if it was going your way, so stopping early never helps."
        : "It ended before measuring began, so nothing was recorded."
    }</p>`;
  else if (!s.score)
    body = `<h1 class="verdict">No score for this session.</h1><p class="lead">There was not enough valid data to compare the two directions.</p>`;
  else {
    body = `<h1 class="sr-only">Session result</h1><p class="score-label" id="score-label-${esc(s.id)}">Score${infoButton("score", "How the score works")}</p><p class="score" data-score="${s.score.value}" style="${scoreStyle(s.score.value)}">${s.score.value}</p><p class="verdict">${esc(verdict(s))}</p>`;
    explain = explainHtml(s);
  }
  return `<div class="result-main"><div class="result-hero">${tags.trim() ? `<p class="row">${tags}</p>` : ""}${body}<p class="meta">${meta}</p></div>${explain}<div class="result-actions">${actions}</div></div>`;
}

// The same result in everyday words, shown with every score.
function explainHtml(s) {
  const e = explanation(s);
  return `<dl class="explain" aria-label="What this means">
<div class="explain-row"><dt>${icon("bits")}What happened</dt><dd>${esc(e.happened)}</dd></div>
<div class="explain-row"><dt>${icon("target")}Your goal</dt><dd>${esc(e.goal)}<span class="goal-meter${e.fill >= 1 ? " reached" : ""}" style="--fill:${e.fill.toFixed(3)}" aria-hidden="true"><i></i></span></dd></div>
<div class="explain-row"><dt>${icon("dice")}Luck</dt><dd><span class="chance">${esc(e.chance)}</span> ${esc(e.luck)}</dd></div>
</dl>`;
}

function analysisHtml(s) {
  const r = s.result,
    up = s.phases.find((p) => p.kind === "Up"),
    down = s.phases.find((p) => p.kind === "Down"),
    goal = s.config.difficulty,
    game = s.config.game,
    figures = [];
  const fig = (label, value, small = "") =>
    figures.push(`<div class="figure"><dt>${esc(label)}</dt><dd>${value}${small ? `<small>${small}</small>` : ""}</dd></div>`);
  if (!s.isReference) {
    fig(`${direction(game, "Up")}: ones rate`, rate(r?.upRate), up?.bits == null ? "" : `${count(up.bits)} bits`);
    fig(`${direction(game, "Down")}: ones rate`, rate(r?.downRate), down?.bits == null ? "" : `${count(down.bits)} bits`);
    fig("Evidence", r?.z == null ? "Unavailable" : `Z ${signed(r.z, 2)}`, r ? `One-sided p ${esc(pvalue(r.pOneSided, r.pText))}` : "");
    fig(
      "Goal",
      `+${number(goal.goalPpm, 0)} per million`,
      `${esc(goal.label)}: chance alone reaches it 1 time in ${goal.oneIn.toLocaleString("en-US")} (Z ${goal.z.toFixed(2)}), set from ${number(goal.bitsPerSecond, 0)} bits per second.${s.targetRatio == null ? "" : ` Effect divided by goal: ${signed(s.targetRatio, 2)}.`}`,
    );
    if (s.score)
      fig(
        "Score",
        String(s.score.value),
        `Version ${esc(s.score.version)}, from effect/goal ${signed(s.score.ratio, 2)} and Z ${signed(s.score.z, 2)}.`,
      );
    fig("Order", esc(order(s)), "Chosen at random before the session started.");
  } else {
    const p = s.phases[0];
    fig("Ones rate", p?.bits && BigInt(p.bits) > 0n ? rate(Number(p.ones) / Number(p.bits)) : "Unavailable", p?.bits ? `${count(p.bits)} bits` : "");
  }
  // How bits were counted, with the device's own ones rate as a check on its lean.
  if (state.lab || !s.config.xorMask) {
    const own = s.phases
      .filter((p) => Number(p.bits) > 0)
      .map((p) => `${s.isReference ? "" : direction(game, p.kind) + " "}${rate(Number(p.rawOnes) / Number(p.bits))}`)
      .join(", ");
    fig(
      "Counting",
      s.config.xorMask ? "After the XOR mask" : "No XOR mask",
      own ? `The device's own ones rate: ${esc(own)}.` : "",
    );
  }
  fig("Time", `${s.config.durationMinutes} min ${s.isReference ? "" : "each way"}`, esc(date(s.createdUtc, state.timezone)));
  fig(
    "Source",
    esc(s.config.source === "Simulation" ? "Simulation" : deviceName(s.config.deviceIdentity || { label: s.config.deviceLabel })),
    esc(s.config.source === "Simulation" ? s.config.simulation?.scenario || "" : state.lab ? s.config.deviceType || "" : ""),
  );
  fig(
    "Capture",
    s.state === "Completed" ? (s.clean ? "Complete" : "Needs a quality check") : esc(s.state),
    esc(s.failureReason || (s.qualityReasons || []).join("; ") || s.exclusionAnnotation || ""),
  );
  const effect =
    r && !s.isReference
      ? `<div class="analysis-head"><h2>Measured difference</h2><p class="prose">Ones rate while ${esc(aiming(game, "Up"))} minus ones rate while ${esc(aiming(game, "Down"))}, in extra ones per million bits.</p></div>
<div class="effect-line"><span class="effect-value ${r.effectPpm < 0 ? "negative" : "positive"}">${signed(r.effectPpm)}</span><span class="effect-unit">per million</span></div>
<p class="prose">95% interval ${esc(interval(r.ciLowPpm, r.ciHighPpm))}. Model-based.</p>`
      : "";
  const assumptions = r
    ? `<p class="prose">${esc(r.modelStatus)}.</p><p class="prose">During each direction ${game === "Box" ? "the box's record" : "the display"} compared live data with a fixed centre (theoretical 50/50 unless a measured reference was chosen). This result compares the two complete directions with each other, so the centre does not affect it.${s.score ? " The score is a game summary; the measured difference and its uncertainty are the result." : ""}</p>`
    : "";
  return `${effect}<dl class="figures">${figures.join("")}</dl>${assumptions}<div class="replay-slot"></div><div class="record-slot lab-only"></div>`;
}

function replayHtml(s) {
  const box = s.config.game === "Box";
  return `<section class="replay-section"><h2>Replay</h2><p class="prose" style="margin:4px 0 16px">${box ? "The box's record, written again as it was during the session. Watching it does not create a new session." : "The recorded display from this session. Watching it does not create a new session."}</p><div class="replay${box ? " wide" : ""}"><div class="replay-view lit"></div><div class="replay-controls"><p class="replay-phase"></p><p class="replay-clock fine"></p><input class="replay-seek" type="range" min="0" step="0.05" value="0" aria-label="Replay position" /><div class="row"><button class="secondary small replay-play" type="button">Play</button><label class="sr-only" for="replay-speed">Speed</label><select class="replay-speed" id="replay-speed"><option value="1">1×</option><option value="4">4×</option><option value="16">16×</option><option value="32">32×</option><option value="64">64×</option></select></div></div></div></section>`;
}

function initReplay(root, s, buckets) {
  const host = root.querySelector(".replay-view"),
    game = s.config.game,
    isBulb = game === "Bulb",
    view = isBulb
      ? createBulb(host, { glassBottom: 0.95, height: 0.84, label: "Replay of the bulb" })
      : game === "Bar"
        ? createBar(host, { lab: state.lab, label: "Replay of the bar" })
        : createBox(host, { level: s.config.difficulty.id, motes: 140, label: "Replay of the box's record" }),
    // The Box's record, and how far through the session a moment is: 0 to 1
    // in the first part, 1 to 2 in the pause, 2 to 3 in the second.
    record = game === "Box" ? boxRecord(s, buckets) : null,
    [first, second] = [...s.phases].sort((a, b) => a.ordinal - b.ordinal),
    cursor = (t) =>
      t < first.end
        ? Math.max(0, (t - first.start) / (first.end - first.start))
        : !second
          ? 1
          : t < second.start
            ? 1 + (t - first.end) / (second.start - first.end)
            : Math.min(3, 2 + (t - second.start) / (second.end - second.start));
  const ordered = buckets.filter((b) => b.phaseOrdinal > 0).sort((a, b) => a.end - b.end),
    end = Math.max(...s.phases.map((p) => p.end), ...ordered.map((b) => b.end)),
    seek = root.querySelector(".replay-seek"),
    play = root.querySelector(".replay-play"),
    speed = root.querySelector(".replay-speed");
  seek.max = end;
  let position = 0,
    playing = false,
    frame = 0,
    last = 0;
  function paint() {
    const phase = s.phases.find((p) => position >= p.start && position < p.end),
      shows = !!phase,
      b = phase && ordered.findLast((b) => b.end <= position && b.phaseOrdinal === phase.ordinal);
    root.querySelector(".replay-phase").textContent = phase
      ? instruction(s.config.game, phase.kind)
      : position < s.phases[0].start
        ? "Countdown"
        : "Pause between directions";
    root.querySelector(".replay-clock").textContent = `${timer(position)} of ${timer(end)}`;
    if (isBulb) view.set(shows && b ? b.level : 0);
    else if (game === "Bar")
      view.set(shows && b ? b.zLive : null, shows && b ? b.zGoal : null, {
        showGoal: s.config.presentation.showDifficultyMarker,
        rest: !shows,
        progress: shows ? (position - phase.start) / (phase.end - phase.start) : null,
      });
    else {
      view.ask(position < first.end || !second ? first.kind : second.kind, { quiet: true });
      view.show(record, cursor(position));
    }
    seek.value = position;
  }
  function animate(t) {
    if (!playing) return;
    if (last) position = Math.min(end, position + ((t - last) / 1000) * Number(speed.value));
    last = t;
    paint();
    if (position >= end) {
      playing = false;
      play.textContent = "Play";
      last = 0;
    } else frame = requestAnimationFrame(animate);
  }
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    if (playing) {
      if (position >= end) position = 0;
      last = 0;
      frame = requestAnimationFrame(animate);
    } else cancelAnimationFrame(frame);
  };
  seek.oninput = () => {
    position = Number(seek.value);
    paint();
  };
  // Start at the middle of the first direction so the replay shows something.
  position = Math.min(end, s.phases[0].start + 1);
  if (isBulb) view.snap(0);
  paint();
  cleanup.push(() => {
    playing = false;
    cancelAnimationFrame(frame);
    view.destroy();
  });
}

function recordHtml(s, d) {
  const isTerminal = terminal(s);
  return `<details class="record"><summary>Session record</summary>
<div class="setting-body" style="padding-bottom:20px">
<div class="row"><button class="secondary small" data-export="json" type="button">Export JSON with buckets</button><button class="quiet small" data-export="csv" type="button">Session CSV</button><button class="quiet small" data-export="buckets" type="button">Bucket CSV</button></div>
<h3>Phase timeline</h3>
${table(
  ["Phase", "Planned start", "Planned end", "Accepted bits", "Ones", "Status"],
  s.phases.map((p) => [
    esc(p.kind),
    number(p.start, 3) + " s",
    number(p.end, 3) + " s",
    p.bits == null ? "Withheld" : count(p.bits),
    p.ones == null ? "Withheld" : count(p.ones),
    esc(p.status),
  ]),
  "Offsets from the preparation origin on the bridge clock. UTC times are for history only.",
)}
<p class="fine">Boundary-excluded bytes ${count(s.boundaryExcludedBytes)}. Queued bytes flushed before the start ${count(s.flushedBytes)}. Capture gaps ${count(s.captureGaps)}. Interface interruptions ${count(s.uiInterruptions)}.</p>
<h3>Notes and exclusion</h3>
<form class="record-notes setting-body"><label>Notes<textarea name="text" maxlength="4000" rows="3">${esc(s.notes)}</textarea></label><label>Tags, separated by commas<input name="tags" value="${esc((s.tags || []).join(", "))}" /></label><label class="check"><input name="excluded" type="checkbox" ${s.annotatedExcluded ? "checked" : ""}/> Exclude from the default analysis, keeping the full record</label><label>Reason for exclusion<input name="reason" maxlength="1000" value="${esc(s.exclusionAnnotation)}" /></label><div><button class="secondary small" ${isTerminal ? "" : "disabled"}>Save note revision</button></div></form>
${table(
  ["Entered", "When", "Text", "Tags"],
  (d.notes || []).map((n) => [esc(date(n.utc, state.timezone)), n.beforeResults ? "Before the result" : "After the result", esc(n.text), esc((n.tags || []).join(", "))]),
  "Every revision is kept.",
)}
<h3>Frozen configuration</h3>
<pre>${esc(JSON.stringify(s.config, null, 2))}</pre>
<p class="fine">Configuration SHA-256 ${esc(s.configHash)}</p>
<details class="disclosure"><summary>Events (${(d.events || []).length})</summary>${table(
  ["UTC", "Offset s", "Event", "Detail"],
  (d.events || []).map((e) => [esc(date(e.utc, state.timezone)), number(e.offset, 3), esc(e.kind), esc(e.detail)]),
  "State changes, faults, focus changes and annotations.",
)}</details>
<details class="disclosure"><summary>Buckets (${(d.buckets || []).length})</summary>${table(
  ["Sequence", "Phase", "Start s", "End s", "Bytes", "Bits", "Ones", "Display level", "Z", "Block variance", "Lag-1 correlation"],
  (d.buckets || []).slice(0, 2400).map((b) => [
    count(b.sequence),
    b.phaseOrdinal,
    number(b.start, 3),
    number(b.end, 3),
    count(b.bytes),
    count(b.bits),
    count(b.ones),
    number(b.level, 4),
    signed(b.zLive, 3),
    number(b.blockVariance, 2),
    signed(b.lagOneCorrelation, 5),
  ]),
  "250 ms receipt buckets, first 2,400 shown. Exports contain all of them. Diagnostics are descriptive, not entropy certification.",
)}</details>
</div></details>`;
}

// Renders a session into host. detail is the /sessions/:id response.
export function mountResult(host, detail, { ceremony = false, withDate = false, primary = null, openDetails = state.lab } = {}) {
  disposeResult();
  const s = detail.session,
    detailsId = "analysis-" + s.id;
  const actions = `${primary ? `<button class="primary" type="button" data-act="primary">${esc(primary.label)}</button>` : ""}<button class="secondary" type="button" data-act="details" aria-expanded="${openDetails}" aria-controls="${esc(detailsId)}">Details</button>`;
  host.innerHTML = heroHtml(s, { withDate, actions }) + `<div class="analysis" id="${esc(detailsId)}" ${openDetails ? "" : "hidden"}>${analysisHtml(s)}</div>`;
  const analysis = host.querySelector(".analysis"),
    toggle = host.querySelector('[data-act="details"]');
  if (primary) host.querySelector('[data-act="primary"]').onclick = primary.onClick;
  let replayReady = false;
  const ensureReplay = () => {
    if (replayReady || !terminal(s) || !detail.buckets?.length || s.isReference) return;
    replayReady = true;
    const slot = analysis.querySelector(".replay-slot");
    slot.innerHTML = replayHtml(s);
    initReplay(slot, s, detail.buckets);
  };
  toggle.onclick = () => {
    const open = analysis.hidden;
    analysis.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      ensureReplay();
      analysis.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    }
  };
  if (openDetails) ensureReplay();
  const record = analysis.querySelector(".record-slot");
  record.innerHTML = recordHtml(s, detail);
  record.querySelectorAll("[data-export]").forEach(
    (b) =>
      (b.onclick = () =>
        action(() =>
          download({
            format: b.dataset.export === "buckets" ? "csv" : b.dataset.export,
            buckets: b.dataset.export === "buckets",
            sessionId: s.id,
            filter: { ...state.filter, timezone: state.timezone },
          }),
        )),
  );
  record.querySelector(".record-notes").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    action(async () => {
      await post(`/sessions/${encodeURIComponent(s.id)}/notes`, {
        text: f.get("text"),
        tags: String(f.get("tags") || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        excluded: f.has("excluded"),
        exclusionReason: f.get("reason") || null,
      });
      message("Note saved. Earlier revisions are kept.");
      mountResult(host, await request("/sessions/" + encodeURIComponent(s.id)), { withDate, primary, openDetails: true });
    });
  };
  const score = host.querySelector(".score[data-score]");
  if (score && ceremony && !reduced()) countUp(score, Number(score.dataset.score));
}

function countUp(el, value) {
  const start = performance.now(),
    duration = 900 + value * 9;
  let frame;
  const step = (t) => {
    const k = Math.min(1, (t - start) / duration),
      eased = 1 - Math.pow(1 - k, 3),
      v = Math.round(value * eased);
    el.textContent = v;
    el.setAttribute("style", scoreStyle(v));
    if (k < 1) frame = requestAnimationFrame(step);
  };
  el.textContent = "0";
  frame = requestAnimationFrame(step);
  cleanup.push(() => {
    cancelAnimationFrame(frame);
    el.textContent = value;
    el.setAttribute("style", scoreStyle(value));
  });
}
