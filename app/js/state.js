const listeners = new Set(),
  layerListeners = new Set();
const stored = (key, fallback = null) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
export const remember = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Browser storage is a convenience only. */
  }
};
export const recall = stored;
export const state = {
  snapshot: null,
  bootstrap: null,
  page: "play",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  filter: { source: "Hardware" },
  lab: stored("intention-lab-layer") === "on",
  clientId: (() => {
    try {
      const id = sessionStorage.getItem("intention-client") || crypto.randomUUID();
      sessionStorage.setItem("intention-client", id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  })(),
};
export function update(snapshot) {
  state.snapshot = snapshot;
  for (const f of listeners) f(snapshot);
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
// Simple or Lab mode changes what is shown, never what is measured.
export function setLab(on) {
  state.lab = !!on;
  remember("intention-lab-layer", on ? "on" : "off");
  document.documentElement.dataset.lab = on ? "on" : "off";
  if (!on) state.filter = { source: "Hardware", mask: playMask(), timezone: state.timezone };
  for (const f of layerListeners) f(state.lab);
}
export const onLayer = (fn) => layerListeners.add(fn);
// The data universe shown in Simple mode: the simulation's sessions while a
// simulation is connected, otherwise the device's. The Lab chooses explicitly.
export const playSource = () =>
  state.snapshot?.connected && state.snapshot.source === "Simulation" ? "Simulation" : "Hardware";
// Likewise sessions without the XOR mask, while the Lab setting has it off.
export const playMask = () =>
  state.bootstrap?.settings?.sessionPreferences?.xorMask === false ? "off" : "on";
export const running = (s) =>
  s && !["Ready", "Completed", "Aborted", "Faulted"].includes(s.state);
let messageTimer;
export function message(text, error = false) {
  const dialog = document.querySelector("dialog[open]");
  let box = document.getElementById("toast");
  if (dialog) {
    box.hidden = true;
    box = dialog.querySelector(".dialog-message");
    if (!box) {
      box = document.createElement("p");
      box.className = "dialog-message";
      (dialog.querySelector(".sheet") || dialog).append(box);
    }
    dialog.addEventListener("close", () => (box.hidden = true), { once: true });
  }
  box.textContent = text;
  box.classList.toggle("error", error);
  box.setAttribute("role", error ? "alert" : "status");
  box.hidden = false;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (box.hidden = true), error ? 12000 : 6000);
}
export async function action(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.name !== "AbortError") message(e.message, true);
  }
}
