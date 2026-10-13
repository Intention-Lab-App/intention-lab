// Lab Insights: linked exploration across sessions. Every number uses the full
// selected data; charts reduce points only when drawing.
import { request, query } from "./api.js";
import { state, action } from "./state.js";
import { esc, number, count, signed, rate, pvalue, interval, table, empty, date, plural, infoButton } from "./format.js";
import { filterHtml, bindFilters, fillFilterChoices, savedViews } from "./filters.js";
import { effectChart, pairedDots, distribution, sessionPoints, diagnosticChart } from "./charts.js";
import { GAMES } from "./core/protocol.js";
let controller,
  report,
  tab = "Overview";
export function cancelAnalytics() {
  controller?.abort();
}
export async function renderAnalytics() {
  controller?.abort();
  controller = new AbortController();
  const host = document.getElementById("analytics-content");
  host.innerHTML = `<h2 class="with-info">Insights${infoButton("counts", "How Insights are calculated")}</h2><p class="prose">The first figures count every session you started; one that ended early counts only against the result, so no way of stopping sessions can favour them. The charts and comparisons look at completed sessions. Everything below follows the same filters.</p>${filterHtml("analytics-filters")}<div id="analysis-main" aria-live="polite"><p class="hint">Calculating from every selected session.</p></div>`;
  bindFilters(document.getElementById("analytics-filters"), () => action(rerenderProgress));
  action(() => fillFilterChoices(document.getElementById("analytics-filters"), request));
  report = await request("/analytics?" + query({ ...state.filter, timezone: state.timezone }), {
    signal: controller.signal,
  });
  renderTab();
}
async function rerenderProgress() {
  const { renderProgress } = await import("./progress.js");
  await renderProgress();
}
function selectedPairs() {
  const ids = new Set(report.sessionIds);
  return report.sessions.filter((s) => ids.has(s.id));
}
function renderTab() {
  const r = report,
    host = document.getElementById("analysis-main");
  if (!host) return;
  host.innerHTML = `<p class="fine">${plural(r.includedPairs, "complete session")} included. ${plural(r.incomplete, "incomplete attempt")}, ${plural(r.excluded, "completed session")} excluded for quality, ${plural(r.selected, "attempt")} selected. ${esc(r.summary.weighting)}. All views are exploratory: repeated checks and chosen filters are not a fixed-endpoint test.</p>
<div class="tabs" role="tablist" aria-label="Insights">${["Overview", "Trends", "Comparisons", "Data quality"].map((t, i) => `<button role="tab" id="insight-tab-${i}" aria-controls="insight-panel" aria-selected="${tab === t}" tabindex="${tab === t ? 0 : -1}" data-tab="${t}" type="button">${t}</button>`).join("")}</div>
<div id="insight-panel" role="tabpanel" aria-labelledby="insight-tab-${["Overview", "Trends", "Comparisons", "Data quality"].indexOf(tab)}"></div>`;
  const tabs = [...host.querySelectorAll("[role=tab]")];
  tabs.forEach((b, i) => {
    b.onclick = () => {
      tab = b.dataset.tab;
      renderTab();
      document.querySelector(`[data-tab="${tab}"]`)?.focus();
    };
    b.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].click();
    };
  });
  const panel = document.getElementById("insight-panel");
  if (tab === "Overview") overview(panel);
  if (tab === "Trends") trends(panel);
  if (tab === "Comparisons") comparisons(panel);
  if (tab === "Data quality") quality(panel);
}
function overview(host) {
  const r = report,
    s = r.summary,
    m = s.effect,
    all = r.itt;
  if (!all) {
    host.innerHTML = empty("No measured sessions in this selection", "Change the filters, or play a session.");
    return;
  }
  host.innerHTML = `<div class="cards">
<div class="stat-card"><div class="label">Every started session: mean Up minus Down, per million</div><div class="value ${all.effectPpm < 0 ? "negative" : "positive"}">${signed(all.effectPpm)}</div><small>${esc(interval(all.lowPpm, all.highPpm))}. ${plural(all.sessions, "session")}, ${all.sessions - all.finished} ended early and counted only against.</small></div>
<div class="stat-card"><div class="label">Every started session: across-session test</div><div class="value">p ${esc(pvalue(all.test?.p))}</div><small>${esc(all.test?.method || "Unavailable")}${all.test ? `, ${number(all.test.replications, 0)} assignments` : ""}, on sums of excess ones</small></div>
<div class="stat-card"><div class="label">Every started session: ones rates</div><div class="value" style="font-size:24px">Up ${rate(all.upRate)}<br>Down ${rate(all.downRate)}</div><small>Pooled over all ${count(all.bits)} bits</small></div>
<div class="stat-card"><div class="label">Completed sessions only: mean, per million</div><div class="value ${m.meanPpm < 0 ? "negative" : "positive"}">${signed(m.meanPpm)}</div><small>${esc(interval(m.lowPpm, m.highPpm))}. ${plural(s.pairs, "session")}, equal weights. Leaving out sessions that ended early can favour the result if the poor ones were stopped.</small></div>
<div class="stat-card"><div class="label">Completed sessions only: test</div><div class="value">p ${esc(pvalue(s.test?.p))}</div><small>${esc(s.test?.method || "Unavailable")}${s.test ? `, ${number(s.test.replications, 0)} assignments` : ""}</small></div>
<div class="stat-card"><div class="label">Accepted bits</div><div class="value" style="font-size:26px">${count(r.acceptedBits)}</div><small>${number(r.measuredSeconds / 60, 1)} minutes measured, ${r.selected - r.incomplete} of ${r.selected} attempts complete</small></div>
</div>
<p class="prose">Secondary exposure-weighted estimate ${signed(s.exposureWeightedPpm)} per million, with weights NUp·NDown/(NUp+NDown). ${s.bootstrap ? `Whole-session bootstrap interval ${esc(interval(s.bootstrap.lowPpm, s.bootstrap.highPpm))}, ${s.bootstrap.replications} resamples, seed ${s.bootstrap.seed}.` : "A whole-session bootstrap interval appears from ten varying sessions."}</p>`;
  const points = r.cumulative.map((p) => ({
    id: p.sessionId,
    x: p.index,
    y: p.effect.meanPpm,
    lo: p.effect.lowPpm,
    hi: p.effect.highPpm,
    annotation: p.annotation,
    tip: `Through session ${p.index}: ${signed(p.effect.meanPpm)} per million. ${p.effect.status}`,
  }));
  host.insertAdjacentHTML(
    "beforeend",
    `<section class="panel"><h2>Cumulative mean effect</h2><p class="prose">Mean Up minus Down after each session, with pointwise 95% intervals. The band is not anytime-valid. Gold ticks mark changes of device, reference, level or display settings.</p>${effectChart(points, { band: true })}<details class="disclosure"><summary>Data table</summary>${table(
      ["Through session", "Date", "Mean per million", "Pointwise low", "Pointwise high", "Change"],
      r.cumulative.map((p) => [p.index, esc(date(p.utc, state.timezone)), signed(p.effect.meanPpm), signed(p.effect.lowPpm), signed(p.effect.highPpm), esc(p.annotation)]),
      "Equal session weight at every step.",
    )}</details></section>`,
  );
}
function effectTable(pairs) {
  return table(
    ["Session", "Game", "Level", "Minutes each way", "Effect per million", "95% bit-model interval", "Goal per million", "Effect / goal", "Score"],
    pairs.map((s) => [
      `<a href="#history/${encodeURIComponent(s.id)}">${esc(date(s.createdUtc, state.timezone))}</a>`,
      esc(s.config.game),
      esc(s.config.difficulty.label),
      s.config.durationMinutes,
      signed(s.result.effectPpm),
      esc(interval(s.result.ciLowPpm, s.result.ciHighPpm, "")),
      `+${Math.round(s.config.difficulty.goalPpm)}`,
      signed(s.targetRatio, 2),
      s.score?.value ?? "—",
    ]),
    "Signed effects and goals. Reaching a goal is a game milestone, not a significance decision.",
  );
}
function trends(host) {
  const pairs = selectedPairs();
  if (!pairs.length) {
    host.innerHTML = empty("No complete sessions in this selection", "Change the filters, or play a session.");
    return;
  }
  host.innerHTML = `<section class="panel"><h2>Each session in order</h2><p class="prose">Whiskers are per-session bit-model intervals, separate from the across-session interval. Select a point to open its session.</p><div class="toolbar"><label class="check"><input id="trend-target" type="checkbox" checked> Show each goal</label><label class="check"><input id="trend-moving" type="checkbox"> Five-session moving mean, descriptive</label></div><div id="trend-chart"></div><details class="disclosure"><summary>Data table</summary>${effectTable(pairs)}</details></section><section class="panel"><h2>Distribution of effects</h2>${distribution(pairs)}</section><p class="prose" style="margin-top:12px">Trends are exploratory. Changes in game, level and duration, and self-selection, limit any claim of improvement.</p>`;
  const draw = () =>
    (document.getElementById("trend-chart").innerHTML = effectChart(sessionPoints(pairs, state.timezone), {
      targets: document.getElementById("trend-target").checked,
      moving: document.getElementById("trend-moving").checked,
    }));
  document.getElementById("trend-target").onchange = draw;
  document.getElementById("trend-moving").onchange = draw;
  draw();
}
function comparisons(host) {
  const pairs = selectedPairs(),
    scale = Math.max(1, ...report.matrix.map((c) => Math.abs(c.effect.meanPpm || 0)));
  const cell = (c) => {
    const v = c.effect.meanPpm,
      a = c.pairs < 2 ? 0 : 0.08 + (0.32 * Math.abs(v)) / scale,
      bg = c.pairs < 2 ? "transparent" : v >= 0 ? `rgba(255,180,100,${a.toFixed(3)})` : `rgba(147,171,198,${a.toFixed(3)})`;
    return `<button class="cell" type="button" data-cell="${c.game}-${c.duration}" style="background:${bg}"><span>${plural(c.pairs, "session")}${c.pairs < 2 ? ", too few" : ""}</span><strong>${c.pairs ? signed(v) : "–"}</strong><span>${esc(interval(c.effect.lowPpm, c.effect.highPpm, ""))}</span></button>`;
  };
  host.innerHTML = `<section class="panel"><h2>Three games, four durations</h2><p class="prose">Mean Up minus Down per million with across-session intervals. Warm cells lean up, cool cells lean down, on one scale centred on zero. Cells with fewer than two sessions are left blank. Select a cell to filter everything.</p><div class="matrix"><span></span>${[1, 5, 10, 20].map((d) => `<span class="heading">${d} min each way</span>`).join("")}${GAMES.map((g) => `<span class="heading row-heading">${g}</span>${report.matrix.filter((c) => c.game === g).map(cell).join("")}`).join("")}</div><details class="disclosure"><summary>By level as well (${GAMES.length * 20} cells)</summary>${table(
    ["Game", "Minutes each way", "Level", "Sessions", "Mean per million", "95% interval"],
    report.difficultyBreakdown.map((c) => [c.game, c.duration, c.difficulty, c.pairs, c.pairs ? signed(c.effect.meanPpm) : "–", esc(interval(c.effect.lowPpm, c.effect.highPpm, ""))]),
    "Levels are chosen by the player, so groups differ in composition.",
  )}</details></section>`;
  if (pairs.length)
    host.insertAdjacentHTML(
      "beforeend",
      `<section class="panel"><h2>Effect against goal</h2><p class="prose">Each session's effect with its interval; gold marks show the goal of the level played.</p>${effectChart(sessionPoints(pairs, state.timezone), { targets: true })}</section>
<section class="panel"><h2>The two directions in each session</h2><p class="prose">Each line joins one session's Down rate (cool) to its Up rate (warm).</p>${pairedDots(pairs)}<details class="disclosure"><summary>Data table</summary>${table(
        ["Session", "Down rate", "Up rate", "Effect per million"],
        pairs.map((s) => [
          `<a href="#history/${encodeURIComponent(s.id)}">${esc(s.id.slice(0, 8))}</a>`,
          rate(s.result.downRate),
          rate(s.result.upRate),
          signed(s.result.effectPpm),
        ]),
      )}</details></section>`,
    );
  host.insertAdjacentHTML(
    "beforeend",
    `<section class="panel"><h2>Devices</h2><p class="prose">Model and connection were frozen with each session. Device use, levels and dates can differ, so these comparisons are exploratory.</p>${table(
      ["Grouping", "Device", "Sessions", "Mean per million", "95% interval"],
      report.groups
        .filter((g) => g.dimension === "Device type" || g.dimension === "Device")
        .map((g) => [esc(g.dimension), esc(g.key), g.pairs, signed(g.effect.meanPpm), esc(interval(g.effect.lowPpm, g.effect.highPpm, ""))]),
    )}</section>
<section class="panel"><h2>Explore a grouping</h2><p class="prose">Groups by date, order, tag or setting. Selecting a group filters the whole page. Groups can overlap and are not a causal ranking.</p><label style="max-width:280px;margin-top:16px">Group by<select id="group-dimension">${["Day", "Week", "Month", "Order", "Tag", "Device type", "Device", "Reference", "Challenge", "Bar needle", "Motion", "Sound", "Saved views"].map((d) => `<option>${d}</option>`).join("")}</select></label><div id="group-table"></div></section>`,
  );
  host.querySelectorAll("[data-cell]").forEach(
    (b) =>
      (b.onclick = () => {
        const [game, duration] = b.dataset.cell.split("-");
        state.filter = { ...state.filter, game, duration: Number(duration) };
        action(renderAnalytics);
      }),
  );
  const groupDraw = () => {
    const dim = document.getElementById("group-dimension").value;
    if (dim === "Saved views") return savedViewGroups();
    const groups = report.groups.filter((g) => g.dimension === dim);
    document.getElementById("group-table").innerHTML = groups.length
      ? table(
          ["Group", "Sessions", "Mean per million", "95% interval"],
          groups.map((g) => [
            `<button class="link" type="button" data-group="${esc(g.key)}">${esc(g.label || g.key || (dim === "Tag" ? "Untagged" : ""))}</button>`,
            g.pairs,
            signed(g.effect.meanPpm),
            esc(interval(g.effect.lowPpm, g.effect.highPpm, "")),
          ]),
        )
      : '<p class="hint" style="margin-top:12px">No groups in this selection.</p>';
    document.querySelectorAll("[data-group]").forEach(
      (b) =>
        (b.onclick = () => {
          const key = b.dataset.group,
            f = state.filter;
          if (dim === "Reference") f.reference = key;
          else if (dim === "Challenge") f.challenge = key;
          else if (dim === "Bar needle") f.marker = key;
          else if (dim === "Motion") f.motion = key;
          else if (dim === "Sound") f.sound = key;
          else if (dim === "Device type") f.deviceType = key;
          else if (dim === "Device") f.device = key;
          else if (dim === "Order") f.order = key;
          else if (dim === "Tag") {
            if (key) {
              f.tag = key;
              delete f.untagged;
            } else {
              delete f.tag;
              f.untagged = true;
            }
          } else {
            f.from = dim === "Month" ? key + "-01" : key;
            const end = new Date(f.from + "T12:00:00Z");
            if (dim === "Week") end.setUTCDate(end.getUTCDate() + 6);
            if (dim === "Month") {
              end.setUTCMonth(end.getUTCMonth() + 1);
              end.setUTCDate(0);
            }
            f.to = end.toISOString().slice(0, 10);
          }
          action(renderAnalytics);
        }),
    );
  };
  document.getElementById("group-dimension").onchange = groupDraw;
  groupDraw();
}
function quality(host) {
  const q = report.quality;
  host.innerHTML = `<section class="panel"><h2>Capture integrity</h2><label style="max-width:360px">Measure over time<select id="quality-metric"><option value="bitsPerSecond">Accepted bits per second</option><option value="meanBlockVariance">Mean variance of 1,024-bit block counts</option><option value="meanLagOneCorrelation">Mean adjacent-bit correlation</option><option value="maximumReadGap">Longest receipt gap, seconds</option></select></label><div id="quality-chart"></div><p class="prose">Technical failures are separate from unusual statistical values. A strongly biased or surprising session is never removed automatically.</p><p class="prose">Block variance uses complete 1,024-bit blocks within 250 ms buckets; correlation uses adjacent bits within each bucket. These diagnostics are descriptive. They do not certify entropy or independence.</p>${
    report.deviceLean
      ? `<p class="prose">The device's own ones rate across these sessions, before any XOR mask: ${rate(report.deviceLean.rate)}, Z ${signed(report.deviceLean.z, 2)} from ${count(report.deviceLean.bits)} bits. A lean here does not reach the results: ${report.filter.mask === "off" ? "these sessions have no mask, but" : "the mask removes it from the counts, and"} Up minus Down cancels a steady lean.</p>`
      : ""
  }${
    q.length
      ? table(
          ["Session", "Phase", "Accepted bits", "Device ones rate", "Seconds", "Bits per second", "Longest gap s", "Boundary bytes", "Flushed bytes", "Gaps", "Interruptions", "Block variance", "Lag-1 correlation", "Blocks", "Reasons"],
          q.map((x) => [
            `<a href="#history/${encodeURIComponent(x.sessionId)}">${esc(x.sessionId.slice(0, 8))}</a>`,
            esc(x.phase),
            count(x.bits),
            x.deviceOnesRate == null ? "—" : rate(x.deviceOnesRate),
            number(x.measuredSeconds, 2),
            number(x.bitsPerSecond, 0),
            number(x.maximumReadGap, 3),
            count(x.boundaryExcludedBytes),
            count(x.flushedBytes),
            count(x.captureGaps),
            count(x.uiInterruptions),
            number(x.meanBlockVariance, 2),
            signed(x.meanLagOneCorrelation, 5),
            count(x.diagnosticBlocks),
            esc(x.reasons.join("; ")),
          ]),
          "One row per phase. Session-level counters repeat on each phase row; do not add them up.",
        )
      : empty("No capture records", "They appear after an attempt ends.")
  }<p class="prose">Receipt times are when the computer received the bytes, not when the device made them. Without hardware sequence numbers, loss before the reader cannot be ruled out; detected gaps and overflows are reported separately.</p></section><section class="panel"><h2>Reference captures</h2><div id="reference-quality"><p class="hint">Loading.</p></div></section>`;
  const drawQuality = () => {
    const select = document.getElementById("quality-metric");
    document.getElementById("quality-chart").innerHTML = diagnosticChart(q, select.value, select.selectedOptions[0].textContent);
  };
  document.getElementById("quality-metric").onchange = drawQuality;
  drawQuality();
  action(async () => {
    const r = await request("/references?" + query({ ...state.filter, timezone: state.timezone }), { signal: controller.signal });
    const target = document.getElementById("reference-quality");
    if (!target) return;
    target.innerHTML = r.captures.length || r.attempts.length
      ? table(
          ["Reference", "Date", "Source", "Device", "Bits", "Ones"],
          r.captures.map((x) => [`<a href="#history/${encodeURIComponent(x.sessionId)}">${esc(x.id.slice(0, 8))}</a>`, esc(date(x.startedUtc, state.timezone)), esc(x.source), esc(x.deviceId), count(x.bits), count(x.ones)]),
          "Five-minute captures with no intention. They are not sessions and are never scored.",
        ) +
        table(
          ["Attempt", "Date", "State", "Accepted bits", "Notes"],
          r.attempts.map((a) => [`<a href="#history/${encodeURIComponent(a.id)}">${esc(a.id.slice(0, 8))}</a>`, esc(date(a.createdUtc, state.timezone)), esc(a.state), count(a.phases[0]?.bits), esc(a.failureReason || a.qualityReasons?.join("; "))]),
          "Every reference attempt, including incomplete ones.",
        )
      : '<p class="hint">No reference captures. Start one from Settings in Lab mode.</p>';
  });
}
function savedViewGroups() {
  const host = document.getElementById("group-table"),
    views = savedViews().slice(0, 20);
  if (!views.length) {
    host.innerHTML = '<p class="hint" style="margin-top:12px">No saved views yet. Name and save one from the filters above.</p>';
    return;
  }
  host.innerHTML = `<div class="setting-body" style="margin-top:12px">${views.map((v, i) => `<label class="check"><input type="checkbox" data-selected-view="${i}" checked> ${esc(v.name)}</label>`).join("")}<div><button id="compare-saved-views" class="secondary small" type="button">Compare</button></div><div id="saved-view-results"></div></div>`;
  document.getElementById("compare-saved-views").onclick = () =>
    action(async () => {
      const chosen = [...host.querySelectorAll("[data-selected-view]:checked")].map((e) => views[Number(e.dataset.selectedView)]);
      const rows = await request("/analytics/views", {
        method: "POST",
        body: { filter: { ...state.filter, timezone: state.timezone }, views: chosen },
        signal: controller.signal,
      });
      const results = document.getElementById("saved-view-results");
      if (!results) return;
      results.innerHTML = table(
        ["View", "Sessions", "Mean per million", "95% interval", "Note"],
        rows.map((g, i) => [`<button class="link" type="button" data-saved-group="${i}" ${g.pairs ? "" : "disabled"}>${esc(g.name)}</button>`, g.pairs, signed(g.effect.meanPpm), esc(interval(g.effect.lowPpm, g.effect.highPpm, "")), esc(g.status)]),
        "Views are combined with the current filters and can overlap.",
      );
      results.querySelectorAll("[data-saved-group]").forEach(
        (b) =>
          (b.onclick = () => {
            const g = rows[Number(b.dataset.savedGroup)],
              base = { ...state.filter };
            state.filter = { ...g.filter, source: base.source, mask: base.mask, includeInterrupted: base.includeInterrupted, timezone: state.timezone, view: JSON.stringify(base) };
            action(renderAnalytics);
          }),
      );
    });
}
