import { request, post, download, prepareImport, importData } from "./api.js";
import { state, action, message, running, playMask } from "./state.js";
import { esc, count, date, plural, deviceName, modeControl } from "./format.js";
import { icon } from "./icons.js";
import { preferences } from "./core/preferences.js";
import { openDevices, connectedName } from "./device.js";
import { refreshPreferences, beginReference } from "./play.js";
import { profiles, currentProfile, useProfile, renameProfile, addProfile, reloadProfiles } from "./profiles.js";
const $ = (id) => document.getElementById(id);
const ICONS = {
  Profile: "person",
  Device: "plug",
  Backup: "archive",
  Mode: "toggle",
  "Session options": "sliders",
  "Reference capture": "target",
  "Data and storage": "database",
  "How it works": "book",
  Quit: "power",
};
const section = (title, lede, body, lab = false) =>
  `<section class="setting${lab ? " lab-only" : ""}"><div><h2>${icon(ICONS[title])}${esc(title)}</h2>${lede ? `<p>${lede}</p>` : ""}</div><div class="setting-body">${body}</div></section>`;

export function renderSettings() {
  const s = state.snapshot,
    busy = !!running(s);
  const connectedText = s?.connected
    ? s.source === "Simulation"
      ? "Simulation connected."
      : esc(`Connected to ${connectedName(s)}.`)
    : "No device connected.";
  const { list, current } = profiles();
  $("settings-content").innerHTML = [
    section(
      "Profile",
      "Each profile keeps its own history, scores and choice of level and length for each game. Switch when someone else plays.",
      `<label>Profile in use<select id="profile" ${busy ? "disabled" : ""}>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === current.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><form id="profile-rename" class="row"><label>Name<input id="profile-name" maxlength="40" required value="${esc(current.name)}"></label><button class="secondary small" type="submit">Rename</button></form><div class="row"><button id="profile-add" class="quiet small" type="button" ${busy ? "disabled" : ""}>Add a profile</button></div>`,
    ),
    section(
      "Device",
      "Intention Lab reads random bits from a hardware random number generator over USB.",
      `<p class="device-state"><span class="dot ${s?.connected ? (s.source === "Simulation" ? "sim" : "on") : ""}"></span><span>${connectedText}</span></p><div class="row"><button id="settings-device" class="secondary" type="button">${s?.connected ? "Change device" : "Connect a device"}</button></div><div id="device-names"></div>`,
    ),
    section(
      "Backup",
      "Your history is stored in this browser on this computer. Export a backup to keep a copy or to move to another computer.",
      `<div class="row"><button id="backup" class="primary" type="button">${icon("download")}Export backup</button><label class="secondary file-button">${icon("upload")}Import backup<input id="import-file" type="file" accept=".json,application/json"></label></div><div id="import-preview"></div><p class="fine">Importing checks every record and never overwrites a session you already have.</p>`,
    ),
    section(
      "Mode",
      "Simple shows the game, your scores and plain explanations. Lab is the same app with the numbers behind it: every measurement, the equations, filters, exports, simulation and reference captures.",
      `<div>${modeControl(state.lab)}</div><p class="fine">Switching changes what you see, never what is measured.</p>`,
    ),
    section(
      "Session options",
      "Applied to sessions you start from now on. Each session keeps the options it started with.",
      `<form id="preferences-form" class="setting-body"><fieldset id="preferences-fields" ${busy ? "disabled" : ""} class="setting-body"><label>Display centre<select id="reference"><option value="">Theoretical 50/50</option></select></label><label class="check"><input id="record-raw" type="checkbox"> Keep every accepted byte (uses more storage)</label><label class="check"><input id="xor-mask" type="checkbox"> Count bits after the XOR mask (standard)</label><p id="xor-warning" class="setting-warning" role="note" hidden>With the mask off, bits are counted exactly as the device sends them. Any lean of the device towards 1s or 0s then shows in the display, and anything that pushes the device one way during a direction is no longer cancelled within it, so it could look like an effect. Sessions without the mask are kept apart: they have their own history and overall score and never mix with masked sessions. Use it only to study the device itself.</p><div><button class="secondary small" type="submit">Save options</button></div></fieldset></form>`,
      true,
    ),
    section(
      "Reference capture",
      "Five minutes with no intention, from the connected source. It can be used as the display centre instead of 50/50. It is not a stability certificate.",
      `<div class="row"><button id="capture-reference" class="secondary" type="button" ${busy || !s?.connected ? "disabled" : ""}>Capture a reference, 5 minutes</button>${s?.connected ? "" : '<span class="fine">Connect a device first.</span>'}</div><div id="reference-list"></div>`,
      true,
    ),
    section(
      "Data and storage",
      "",
      `<pre>${esc(state.bootstrap.dataDirectory)}</pre><form id="timezone-form" class="row"><label>Time zone for dates<input id="timezone" value="${esc(state.timezone)}" placeholder="Europe/London" required></label><button class="secondary small" type="submit">Save</button></form><div class="row"><button id="persist-storage" class="quiet small" type="button">Ask the browser to keep this data</button></div><p id="storage-result" class="fine">Clearing site data in the browser deletes the history. Keep backups.</p>`,
      true,
    ),
    section(
      "How it works",
      "How a session is measured and scored, step by step. In Lab mode, each step also shows its equations and details.",
      `<div class="row"><button class="secondary" type="button" data-guide="session">${icon("book")}Open the guide</button></div>`,
    ),
    section(
      "Quit",
      "Intention Lab runs in the background while one of its tabs is open, and quits by itself about three minutes after the last one closes. Quit now to release the device straight away.",
      `<div class="row"><button id="quit" class="secondary" type="button">${icon("power")}Quit Intention Lab</button></div>${state.bootstrap.version ? `<p class="fine">Version ${esc(state.bootstrap.version.split("+")[0])}</p>` : ""}`,
    ),
  ].join("");
  $("profile").onchange = (e) =>
    action(async () => {
      await useProfile(e.target.value);
      renderSettings();
      message(`Playing as ${currentProfile().name}.`);
    });
  $("profile-rename").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      await renameProfile(currentProfile().id, $("profile-name").value);
      renderSettings();
      message("Profile renamed.");
    });
  };
  $("profile-add").onclick = () =>
    action(async () => {
      await addProfile();
      renderSettings();
      $("profile-name").select();
      message(`Added ${currentProfile().name}, now in use. Give it a name.`);
    });
  $("settings-device").onclick = openDevices;
  $("backup").onclick = () => action(() => download({ full: true, format: "json" }));
  $("import-file").onchange = (e) =>
    action(async () => {
      const file = e.target.files[0];
      if (!file) return;
      const plan = await prepareImport(await file.text()),
        host = $("import-preview");
      host.innerHTML = `<p class="hint">${plural(plan.sessions, "session")} in the file: ${plan.add.sessions.length} new, ${plural(plan.duplicates, "identical record")} already here${plan.conflicts.length ? `, ${plural(plan.conflicts.length, "conflict")}` : ""}.</p>${
        plan.conflicts.length
          ? `<pre>${esc(plan.conflicts.join("\n"))}</pre><p class="hint">Nothing was imported, because existing records are never overwritten.</p>`
          : '<button id="confirm-import" class="primary small" type="button">Import</button>'
      }`;
      const button = $("confirm-import");
      if (button)
        button.onclick = () =>
          action(async () => {
            button.disabled = true;
            const result = await importData(plan);
            await reloadProfiles();
            host.innerHTML = `<p class="hint">Imported ${plural(result.added, "session")}. Nothing you had was changed.</p>`;
          });
    });
  $("quit").onclick = () =>
    action(async () => {
      await post("/shutdown");
      document.title = "Intention Lab has quit";
      document.body.classList.add("quit");
      $("quit-screen").hidden = false;
    });
  action(renderDeviceNames);
  if (!state.lab) return;
  bindLab(busy);
}

async function renderDeviceNames() {
  const devices = await request("/devices"),
    host = $("device-names");
  if (!host || !devices.length) return;
  host.innerHTML = `<details class="disclosure"><summary>Device names</summary><div class="setting-body">${devices
    .map(
      (d) =>
        `<form class="row device-label-form" data-device="${esc(d.id)}"><label>${esc(deviceName({ familyHint: d.familyHint, label: d.label }, d.port))}<input name="label" maxlength="100" value="${esc(d.userLabel)}" placeholder="Your name for it"></label><label class="lab-only">Model, if known<input name="deviceType" maxlength="120" value="${esc(d.userDeviceType)}" placeholder="As detected"></label><button class="secondary small" type="submit">Save</button></form>`,
    )
    .join("")}<p class="fine">Names are saved with future sessions. Past sessions keep the names they had.</p></div></details>`;
  host.querySelectorAll("form").forEach(
    (form) =>
      (form.onsubmit = (e) => {
        e.preventDefault();
        action(async () => {
          await post("/devices/" + encodeURIComponent(form.dataset.device) + "/label", {
            label: form.elements.label.value,
            deviceType: form.elements.deviceType.value,
          });
          message("Name saved.");
        });
      }),
  );
}

async function bindLab(busy) {
  const saved = await request("/settings"),
    prefs = preferences(saved.sessionPreferences);
  const source = state.snapshot?.source || "Hardware",
    refs = await request(`/references?source=${source}&mask=${prefs.xorMask ? "on" : "off"}`),
    device = state.snapshot?.deviceId,
    matching = refs.captures.filter((r) => r.source === source && (!device || r.deviceId === device));
  const reference = $("reference");
  if (!reference) return;
  reference.innerHTML =
    '<option value="">Theoretical 50/50</option>' +
    matching.map((r) => `<option value="${esc(r.id)}">Measured ${esc(r.startedUtc.slice(0, 10))}, ${count(r.bits)} bits</option>`).join("");
  if (prefs.referenceId && !matching.some((r) => r.id === prefs.referenceId))
    reference.add(new Option("Saved reference, connect its device to use it", prefs.referenceId));
  reference.value = prefs.referenceId || "";
  $("reference-list").innerHTML = refs.captures.length
    ? `<p class="fine">${plural(refs.captures.length, "reference")} saved. The latest: ${esc(date(refs.captures.at(-1).startedUtc, state.timezone))}.</p>`
    : "";
  $("record-raw").checked = prefs.recordRaw;
  const xor = $("xor-mask"),
    warn = () => ($("xor-warning").hidden = xor.checked);
  xor.checked = prefs.xorMask;
  xor.onchange = warn;
  warn();
  $("preferences-form").onsubmit = (e) => {
    e.preventDefault();
    if (running(state.snapshot)) return;
    action(async () => {
      await post("/settings", {
        sessionPreferences: preferences({
          ...prefs,
          referenceId: reference.value || null,
          recordRaw: $("record-raw").checked,
          xorMask: xor.checked,
        }),
      });
      await refreshPreferences();
      // History, Progress and the reference list follow the mask setting.
      if (state.filter.mask !== playMask()) {
        state.filter = { source: state.filter.source || "Hardware", mask: playMask(), timezone: state.timezone };
        renderSettings();
      }
      message(
        xor.checked
          ? "Options saved for the sessions you start from now on."
          : "Saved. Sessions you start from now on are counted without the XOR mask and kept apart from masked ones.",
      );
    });
  };
  $("capture-reference").onclick = () => action(beginReference);
  $("timezone-form").onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const settings = await post("/settings", { timezone: $("timezone").value });
      state.timezone = settings.timezone;
      state.filter.timezone = state.timezone;
      message("Time zone saved.");
    });
  };
  $("persist-storage").onclick = () =>
    action(async () => {
      const granted = await navigator.storage.persist();
      $("storage-result").textContent = granted
        ? "The browser agreed to keep this data. Deleting site data by hand still removes it, so keep backups."
        : "The browser did not agree. Keep exporting backups.";
    });
}

