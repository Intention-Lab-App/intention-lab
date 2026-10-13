// History. Play: a clean list of sessions with their scores. Lab: the same list
// under filters, plus the full measurement table and exports. Opening a session
// shows its result with the complete analysis.
import { request, query } from "./api.js";
import { state, action, playSource, playMask } from "./state.js";
import {
  esc,
  signed,
  rate,
  pvalue,
  interval,
  date,
  number,
  order,
  table,
  empty,
  scoreStyle,
  stopReason,
  plural,
  deviceName,
} from "./format.js";
import { filterHtml, bindFilters, fillFilterChoices } from "./filters.js";
import { mountResult, disposeResult } from "./result.js";
import { icon, gameIcon } from "./icons.js";
let page = 1,
  controller;
const pageSize = 20;
export function cancelHistory() {
  controller?.abort();
  disposeResult();
}
const host = () => document.getElementById("history-content");

function rowHtml(s) {
  const c = s.config,
    scored = s.score && s.state === "Completed",
    sub =
      s.state === "Completed"
        ? `${c.durationMinutes} min each way${s.clean ? "" : ", quality check needed"}`
        : `${c.durationMinutes} min each way. ${stopReason(s)}`;
  return `<li><a class="history-row" href="#history/${encodeURIComponent(s.id)}">
<span class="row-score${scored ? "" : " none"}" style="${scored ? scoreStyle(s.score.value) : ""}" aria-label="${scored ? "Score " + s.score.value : "No score"}">${scored ? s.score.value : "–"}</span>
<span><span class="row-title">${icon(gameIcon(c.game))}${esc(c.game)}, ${esc(c.difficulty.label)}${c.source === "Simulation" && state.lab ? ' <span class="tag sim">Simulation</span>' : ""}${c.challengeId ? ' <span class="tag">Challenge</span>' : ""}</span><span class="row-sub" style="display:block">${esc(sub)}</span></span>
<span class="row-date">${esc(date(s.createdUtc, state.timezone))}</span></a></li>`;
}

function measurementTable(items) {
  return table(
    [
      "Date",
      "Game",
      "Level",
      "Minutes each way",
      "Order",
      "State",
      "Up ones rate",
      "Down ones rate",
      "Effect per million",
      "95% interval",
      "Goal",
      "Effect / goal",
      "Score",
      "Z / one-sided p",
      "Device",
    ],
    items.map((s) => {
      const r = s.result;
      return [
        `<a href="#history/${encodeURIComponent(s.id)}">${esc(date(s.createdUtc, state.timezone))}</a>`,
        esc(s.config.game),
        esc(s.config.difficulty.label),
        s.config.durationMinutes,
        esc(order(s)),
        esc(s.state + (s.feedbackInterrupted ? ", feedback interrupted" : "") + (s.annotatedExcluded ? ", excluded" : "")),
        rate(r?.upRate),
        rate(r?.downRate),
        `<span class="${r?.effectPpm < 0 ? "negative" : "positive"}">${signed(r?.effectPpm)}</span>`,
        esc(interval(r?.ciLowPpm, r?.ciHighPpm, "")),
        `+${Math.round(s.config.difficulty.goalPpm)}`,
        signed(s.targetRatio, 2),
        s.score ? `${s.score.value} <span class="fine">${esc(s.score.version)}</span>` : "—",
        r ? `${signed(r.z, 3)} / ${esc(pvalue(r.pOneSided, r.pText))}` : "—",
        esc(deviceName(s.config.deviceIdentity || { label: s.config.deviceLabel })),
      ];
    }),
    "Effect is the ones rate during Up minus the ones rate during Down. Intervals and p-values are per-session bit models.",
  );
}

async function renderList() {
  controller?.abort();
  controller = new AbortController();
  const lab = state.lab,
    filter = lab ? { ...state.filter } : { source: playSource(), mask: playMask() },
    simTag =
      (!lab && filter.source === "Simulation" ? ' <span class="tag sim">Simulation</span>' : "") +
      (filter.mask === "off" ? ' <span class="tag warn">XOR off</span>' : "");
  host().innerHTML = `<div class="page-head"><h1>History${simTag}</h1></div>${lab ? filterHtml("history-filters") : ""}<div id="history-list" aria-live="polite"><p class="hint">Loading.</p></div>`;
  if (lab) {
    bindFilters(document.getElementById("history-filters"), () => {
      page = 1;
      action(renderList);
    });
    action(() => fillFilterChoices(document.getElementById("history-filters"), request));
  }
  const data = await request(
    "/sessions?" + query({ ...filter, timezone: state.timezone, page, pageSize }),
    { signal: controller.signal },
  );
  const list = document.getElementById("history-list");
  if (!list) return;
  if (!data.items.length) {
    list.innerHTML =
      page > 1
        ? empty("No more sessions", "Go back a page.", "history")
        : lab
          ? empty("Nothing matches these filters", "Change or reset the filters. Simulation and device sessions are kept apart.")
          : `<div class="empty">${icon("history")}<h2>No sessions yet</h2><p>Play a session and it appears here with its score.</p><a class="primary" href="#play">Play</a></div>`;
    return;
  }
  list.innerHTML = `${lab ? `<p class="fine" style="margin-bottom:10px">${plural(data.total, "attempt")} in this selection, including stopped and interrupted ones.</p>` : ""}<ul class="history-list">${data.items.map(rowHtml).join("")}</ul>
<div class="pager"><button id="previous-page" class="quiet small" type="button" ${page <= 1 ? "disabled" : ""}>Newer</button><span>Page ${page} of ${Math.max(1, Math.ceil(data.total / pageSize))}</span><button id="next-page" class="quiet small" type="button" ${page * pageSize >= data.total ? "disabled" : ""}>Older</button></div>
${lab ? `<details class="panel" style="margin-top:24px"><summary>Measurement table</summary>${measurementTable(data.items)}</details>` : ""}`;
  document.getElementById("previous-page").onclick = () => {
    page--;
    action(renderList);
  };
  document.getElementById("next-page").onclick = () => {
    page++;
    action(renderList);
  };
}

async function renderSession(id) {
  controller?.abort();
  controller = new AbortController();
  host().innerHTML = `<div class="page-head"><a class="back" href="#history">History</a></div><div id="session-view"><p class="hint">Loading.</p></div>`;
  const detail = await request("/sessions/" + encodeURIComponent(id), { signal: controller.signal });
  const view = document.getElementById("session-view");
  if (!view) return;
  mountResult(view, detail, { withDate: true, openDetails: state.lab });
}

export async function renderHistory(route = "", reset = false) {
  if (reset) page = 1;
  disposeResult();
  if (route) return renderSession(decodeURIComponent(route));
  return renderList();
}
