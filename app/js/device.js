// Device status in the header, one-click connect for a recognised random number
// generator, and the device dialog (with the simulation source in Lab mode).
import { request, post } from "./api.js";
import { state, subscribe, running, action, message, update, onLayer } from "./state.js";
import { esc, number, deviceName } from "./format.js";
import { DEFAULT_SIMULATION } from "./core/simulation.js";
const $ = (id) => document.getElementById(id);
let devices = [],
  scanned = false,
  scanning = false,
  bridgeDown = false,
  pollTimer,
  connecting = false;
const changeListeners = new Set();
export const onDeviceChange = (fn) => changeListeners.add(fn);
const notify = () => changeListeners.forEach((f) => f());
// The single recognised random number generator that one click connects, if any.
export function detected() {
  const found = devices.filter((d) => d.familyHint && d.port);
  return found.length === 1 ? found[0] : null;
}
export const deviceInfo = () => ({ devices, scanned, bridgeDown, detected: detected() });
// The connected device in the app's own words.
export const connectedName = (s) =>
  deviceName(devices.find((d) => d.id === s.deviceId) || { label: s.deviceLabel }, s.port);
export async function scan() {
  if (scanning) return devices;
  scanning = true;
  try {
    devices = (await request("/ports")).devices;
    bridgeDown = false;
  } catch (e) {
    bridgeDown = true;
    throw e;
  } finally {
    scanned = true;
    scanning = false;
    render(state.snapshot);
    notify();
  }
  return devices;
}
function source() {
  return document.querySelector("#source-choice input:checked")?.value || "Hardware";
}
function simulationSettings() {
  return {
    scenario: $("sim-scenario").value,
    seed: Number($("sim-seed").value),
    bytesPerSecond: Number($("sim-rate").value),
    commonBias: Number($("sim-bias").value),
    intentionShift: Number($("sim-shift").value),
    driftPerMinute: Number($("sim-drift").value),
    failureAfterSeconds: Number($("sim-failure").value),
  };
}
export async function connectDevice(deviceId, confirmUnidentified = false) {
  connecting = true;
  render(state.snapshot);
  try {
    update(await post("/connect", { source: "Hardware", deviceId, confirmUnidentified }));
    message("Connected. You are ready to play.");
  } finally {
    connecting = false;
    render(state.snapshot);
    notify();
  }
}
export async function connectSimulation(settings = simulationSettings()) {
  update(await post("/connect", { source: "Simulation", simulation: settings }));
  message("Simulation connected. Its sessions are kept apart from your device's.");
  notify();
}
export function openDevices() {
  const d = $("device-dialog");
  if (!d.open) d.showModal();
  action(scan);
}
function headerStatus(s) {
  if (s?.connected)
    return s.source === "Simulation"
      ? { dot: "sim", word: "Simulation", title: "Simulation connected" }
      : { dot: "on", word: "Connected", title: connectedName(s) };
  if (connecting) return { dot: "found", word: "Connecting", title: "Connecting" };
  if (bridgeDown) return { dot: "", word: "Offline", title: "The device bridge is not running" };
  if (detected()) return { dot: "found", word: "Connect", title: "Connect your random number generator", found: true };
  if (!scanned) return { dot: "", word: "Looking", title: "Looking for devices" };
  return { dot: "", word: "No device", title: "No random number generator found" };
}
function render(s) {
  const h = headerStatus(s),
    button = $("device-status");
  $("device-dot").className = "dot " + h.dot;
  $("device-word").textContent = h.word;
  button.title = h.title;
  button.classList.toggle("found", !!h.found);
  button.setAttribute("aria-label", "Device: " + h.title);
  const busy = !!running(s);
  // Dialog
  const sim = source() === "Simulation";
  $("sim-panel").hidden = !sim;
  $("hardware-panel").hidden = sim;
  for (const input of document.querySelectorAll("#source-choice input, #sim-panel input, #sim-panel select"))
    input.disabled = busy;
  const connected = !!s?.connected,
    hardwareConnected = connected && s.source === "Hardware";
  $("device-state").innerHTML = `<span class="dot ${connected ? (s.source === "Simulation" ? "sim" : "on") : ""}"></span><span>${
    connected
      ? s.source === "Simulation"
        ? "Simulation connected"
        : esc(`Connected to ${connectedName(s)}`)
      : "Not connected"
  }</span>`;
  $("device-hint").textContent = hardwareConnected
    ? `${number(s.bitsPerSecond, 0)} bits per second.`
    : bridgeDown
      ? "The device bridge is not running. Start DeviceBridge again."
      : devices.length
        ? "Choose your device, then connect."
        : "Plug in your random number generator. It appears here when your computer finds it.";
  const list = $("device-list"),
    key = JSON.stringify([devices, busy, s?.deviceId, connected]);
  // Rebuild only when the device list changes, so a choice keeps its focus.
  if (list.dataset.key !== key) {
    const previous = document.querySelector("#device-list input:checked")?.value,
      has = (id) => devices.some((d) => d.id === id),
      defaultId = has(previous)
        ? previous
        : hardwareConnected && has(s.deviceId)
          ? s.deviceId
          : (devices.find((d) => d.familyHint && d.port) || devices[0])?.id;
    list.innerHTML = devices
      .map(
        (d) =>
          `<li><label class="device-option"><input type="radio" name="device" value="${esc(d.id)}" ${d.id === defaultId ? "checked" : ""} ${busy ? "disabled" : ""}/><span>${esc(deviceName(d))}<small>${esc(d.port || "No port")}${d.familyHint ? ", recognised" : ", not recognised"}${d.driverProblem ? ". " + esc(d.driverProblem) : ""}</small></span></label></li>`,
      )
      .join("");
    list.dataset.key = key;
  }
  const chosen = devices.find((d) => d.id === document.querySelector("#device-list input:checked")?.value);
  $("confirm-row").hidden = sim || !chosen || chosen.familyHint;
  $("connect").textContent = sim ? "Connect simulation" : "Connect";
  $("connect").disabled =
    busy || connecting || (!sim && (!chosen || (hardwareConnected && s.deviceId === chosen.id)));
  $("disconnect").hidden = !connected;
  $("disconnect").disabled = busy;
  $("refresh").disabled = busy;
}
function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    const s = state.snapshot;
    if (!s?.connected && !running(s) && !document.hidden) await scan().catch(() => {});
    poll();
  }, 4000);
}
export function initDevice() {
  subscribe(render);
  onLayer((lab) => {
    if (!lab) document.querySelector('#source-choice input[value="Hardware"]').checked = true;
    render(state.snapshot);
  });
  const sim = state.snapshot?.source === "Simulation" && state.snapshot?.connected;
  document.querySelector(`#source-choice input[value="${sim ? "Simulation" : "Hardware"}"]`).checked = true;
  for (const [key, id] of [
    ["scenario", "sim-scenario"],
    ["seed", "sim-seed"],
    ["bytesPerSecond", "sim-rate"],
    ["commonBias", "sim-bias"],
    ["intentionShift", "sim-shift"],
    ["driftPerMinute", "sim-drift"],
    ["failureAfterSeconds", "sim-failure"],
  ])
    $(id).value = DEFAULT_SIMULATION[key];
  $("device-status").onclick = () => {
    const s = state.snapshot,
      one = detected();
    if (!s?.connected && one && !running(s) && !connecting) action(() => connectDevice(one.id));
    else openDevices();
  };
  $("device-dialog").querySelector("[data-close]").onclick = () => $("device-dialog").close();
  $("device-form").onchange = () => render(state.snapshot);
  $("refresh").onclick = () => action(scan);
  $("connect").onclick = () =>
    action(async () => {
      if (source() === "Simulation") await connectSimulation();
      else {
        const id = document.querySelector("#device-list input:checked")?.value;
        if (!id) throw Error("Choose a device first.");
        await connectDevice(id, $("confirm-port").checked);
      }
      $("device-dialog").close();
    });
  $("disconnect").onclick = () =>
    action(async () => {
      update(await post("/disconnect"));
      notify();
      await scan();
    });
  render(state.snapshot);
  action(scan);
  poll();
}
