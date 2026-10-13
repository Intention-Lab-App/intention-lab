// Lab filters. One form drives every list, table and chart on the page.
import { state, action, message, recall, remember, playMask } from "./state.js";
import { esc } from "./format.js";
import { GAMES, challengeName } from "./core/protocol.js";
import { download } from "./api.js";
const options = (items, value) =>
  items
    .map(
      ([v, label]) =>
        `<option value="${esc(v)}" ${String(v) === String(value ?? "") ? "selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
export function savedViews() {
  try {
    return JSON.parse(recall("intention-views", "[]")) || [];
  } catch {
    return [];
  }
}
export function filterHtml(prefix = "filter") {
  const f = state.filter;
  const chips = Object.entries(f)
    .filter(([k, v]) => !["timezone", "source", "mask"].includes(k) && v !== "" && v != null && v !== false)
    .map(([k, v]) => `<span class="chip">${esc(k)}: ${k === "view" ? "saved view" : esc(v)}</span>`)
    .join("");
  return `<form id="${prefix}" class="filters">
${f.view ? `<p class="fine">A saved view is combined with these filters. <button type="button" data-clear-link class="link">Remove it</button></p>` : ""}
<div class="filters-main">
<label>Data<select name="source">${options([["Hardware", "Device"], ["Simulation", "Simulation"]], f.source)}</select></label>
<label>XOR mask<select name="mask">${options([["on", "On"], ["off", "Off"]], f.mask || "on")}</select></label>
<label>Game<select name="game">${options([["", "All games"], ...GAMES.map((g) => [g, g])], f.game)}</select></label>
<label>Difficulty<select name="difficulty">${options([["", "All levels"], [1, "Easy"], [2, "Balanced"], [3, "Strict"], [4, "Advanced"], [5, "Expert"]], f.difficulty)}</select></label>
<label>Minutes each way<select name="duration">${options([["", "All"], [1, "1"], [5, "5"], [10, "10"], [20, "20"]], f.duration)}</select></label>
<label>Status<select name="status">${options([["", "All attempts"], ["Completed", "Completed"], ["Incomplete", "Incomplete"], ["Aborted", "Stopped"], ["Faulted", "Interrupted"]], f.status)}</select></label>
</div>
<details><summary>More filters</summary><div class="field-grid">

<label>From<input name="from" type="date" value="${esc(f.from)}"></label>
<label>Through<input name="to" type="date" value="${esc(f.to)}"></label>
<label>Order<select name="order">${options([["", "Both orders"], ["UpFirst", "Up first"], ["DownFirst", "Down first"]], f.order)}</select></label>
<label>Tag<input name="tag" value="${esc(f.tag)}" placeholder="Exact tag"></label>
<label>Device type<select name="deviceType"><option value="">All device types</option>${f.deviceType ? `<option selected>${esc(f.deviceType)}</option>` : ""}</select></label>
<label>Device<select name="device"><option value="">All devices</option>${f.device ? `<option selected>${esc(f.device)}</option>` : ""}</select></label>
<label>Reference<select name="reference"><option value="">All references</option><option value="theoretical" ${f.reference === "theoretical" ? "selected" : ""}>Theoretical 50/50</option>${f.reference && f.reference !== "theoretical" ? `<option selected>${esc(f.reference)}</option>` : ""}</select></label>
<label>Challenge<select name="challenge"><option value="">All sessions</option><option value="any" ${f.challenge === "any" ? "selected" : ""}>In a challenge</option><option value="none" ${f.challenge === "none" ? "selected" : ""}>Not in a challenge</option>${f.challenge && !["any", "none"].includes(f.challenge) ? `<option selected>${esc(f.challenge)}</option>` : ""}</select></label>
<label>Bar red needle<select name="marker">${options([["", "Any"], ["shown", "Shown"], ["hidden", "Hidden"]], f.marker)}</select></label>
<label>Display motion<select name="motion">${options([["", "Any"], ["reduced", "Reduced"], ["standard", "Standard"]], f.motion)}</select></label>
<label>Sound<select name="sound">${options([["", "Any"], ["on", "On"], ["off", "Off"]], f.sound)}</select></label>
</div>
<div class="setting-body" style="margin-top:12px">
<label class="check"><input name="untagged" type="checkbox" ${f.untagged ? "checked" : ""}> Untagged sessions only</label>
<label class="check"><input name="includeInterrupted" type="checkbox" ${f.includeInterrupted ? "checked" : ""}> Include completed sessions whose feedback was interrupted. Annotated exclusions stay excluded.</label>
</div></details>
<div class="filter-actions"><button type="submit" class="secondary small">Apply</button><button type="button" data-reset class="quiet small">Reset</button>
<button type="button" data-export="csv" class="quiet small">Export CSV</button><button type="button" data-export="json" class="quiet small">Export JSON</button>
<select data-view aria-label="Saved views"><option value="">Saved views</option>${savedViews()
    .map((v, i) => `<option value="${i}">${esc(v.name)}</option>`)
    .join("")}</select>
<input data-view-name aria-label="Name for a saved view" placeholder="Name this view" style="width:auto;min-height:36px;padding:4px 10px;font-size:14px"><button type="button" data-save-view class="quiet small">Save view</button></div>
${chips ? `<div class="chips">${chips}</div>` : ""}
</form>`;
}
export function bindFilters(form, onChange) {
  const clear = form.querySelector("[data-clear-link]");
  if (clear)
    clear.onclick = () => {
      delete state.filter.view;
      onChange();
    };
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = {};
    for (const [k, v] of new FormData(form)) {
      if (v !== "")
        f[k] = ["difficulty", "duration"].includes(k)
          ? Number(v)
          : ["includeInterrupted", "untagged"].includes(k)
            ? true
            : v;
    }
    if (state.filter.view) f.view = state.filter.view;
    state.filter = { ...f, timezone: state.timezone };
    onChange();
  };
  form.querySelector("[data-reset]").onclick = () => {
    state.filter = { source: "Hardware", mask: playMask(), timezone: state.timezone };
    onChange();
  };
  form.querySelectorAll("[data-export]").forEach(
    (b) =>
      (b.onclick = () =>
        action(() =>
          download({
            format: b.dataset.export,
            filter: { ...state.filter, timezone: state.timezone },
          }),
        )),
  );
  form.querySelector("[data-save-view]").onclick = () => {
    const name = form.querySelector("[data-view-name]").value.trim();
    if (!name) {
      message("Type a name for the view first.", true);
      return;
    }
    const list = savedViews();
    list.push({ name: name.slice(0, 80), filter: state.filter });
    remember("intention-views", JSON.stringify(list));
    message("View saved in this browser. Your sessions are not changed.");
    onChange();
  };
  form.querySelector("[data-view]").onchange = (e) => {
    if (e.target.value === "") return;
    state.filter = {
      ...savedViews()[Number(e.target.value)].filter,
      timezone: state.timezone,
    };
    onChange();
  };
}
export async function fillFilterChoices(form, request) {
  const results = await Promise.allSettled([
    request("/devices"),
    request("/references"),
    request("/challenges"),
    request("/device-types"),
  ]);
  const add = (name, rows, label) => {
    const select = form.querySelector(`[name=${name}]`);
    if (!select) return;
    const current = state.filter[name] || "";
    const initial =
      select.options[0].outerHTML +
      (name === "reference" ? '<option value="theoretical">Theoretical 50/50</option>' : "") +
      (name === "challenge" ? '<option value="any">In a challenge</option><option value="none">Not in a challenge</option>' : "");
    select.innerHTML =
      initial + rows.map((r) => `<option value="${esc(r.id)}">${esc(label(r))}</option>`).join("");
    select.value = current;
  };
  if (results[0].status === "fulfilled")
    add("device", results[0].value, (d) => `${d.userLabel || d.label}, ${d.id.slice(-8)}`);
  if (results[1].status === "fulfilled")
    add("reference", results[1].value.captures, (r) => `${r.source}, ${r.startedUtc.slice(0, 10)}, ${r.id.slice(0, 8)}`);
  if (results[2].status === "fulfilled") add("challenge", results[2].value, challengeName);
  if (results[3].status === "fulfilled") add("deviceType", results[3].value, (r) => r.id);
}
