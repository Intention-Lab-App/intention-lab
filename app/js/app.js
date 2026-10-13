import { bootstrap, live, post } from "./api.js";
import { state, update, running, action, setLab, onLayer, message, playMask } from "./state.js";
import { initPlay, refreshImmersive, goHome, currentView } from "./play.js";
import { initDevice } from "./device.js";
import { renderHistory, cancelHistory } from "./history.js";
import { renderProgress, cancelProgress } from "./progress.js";
import { renderChallenge } from "./challenge.js";
import { renderSettings } from "./settings.js";
import { initGuide } from "./guide.js";
import { fillIcons } from "./icons.js";
const PAGES = ["play", "challenge", "history", "progress", "settings"];
document.documentElement.dataset.lab = state.lab ? "on" : "off";

async function navigate() {
  cancelHistory();
  cancelProgress();
  const [page, ...rest] = (location.hash.slice(1) || "play").split("/");
  const next = PAGES.includes(page) ? page : "play";
  // Coming back to Play from elsewhere shows the instruments, not an old result.
  if (next === "play" && state.page !== "play" && currentView() === "result") goHome();
  state.page = next;
  for (const p of PAGES) document.getElementById(p).hidden = p !== next;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === next) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  refreshImmersive();
  document.getElementById("return-to-session").hidden = !running(state.snapshot) || next === "play";
  window.scrollTo({ top: 0, behavior: "instant" });
  if (next === "history") await renderHistory(rest.join("/"));
  if (next === "progress") await renderProgress();
  if (next === "challenge") await renderChallenge(rest.join("/"));
  if (next === "settings") renderSettings();
  if (running(state.snapshot)) heartbeat();
}
function heartbeat() {
  post("/ui/heartbeat", {
    clientId: state.clientId,
    visible: !document.hidden && state.page === "play" && !document.querySelector("dialog[open]"),
    focused: document.hasFocus(),
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }).catch(() => {});
}
// Icons first, so the header does not shift once the app is ready.
fillIcons();
action(async () => {
  state.bootstrap = await bootstrap();
  state.timezone = state.bootstrap.settings.timezone;
  state.filter.timezone = state.timezone;
  state.filter.mask = playMask();
  state.snapshot = state.bootstrap.snapshot;
  // Every Simple/Lab switch, in the header, Settings and the guide, stays in step.
  const syncMode = () =>
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mode === "lab") === state.lab)));
  syncMode();
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || (b.dataset.mode === "lab") === state.lab) return;
    setLab(b.dataset.mode === "lab");
    if (!b.closest("#guide"))
      message(
        state.lab
          ? "Lab mode: every screen now adds its measurements, equations and research tools."
          : "Simple mode: the game, your scores and plain explanations.",
      );
  });
  onLayer(() => {
    syncMode();
    if (["challenge", "history", "progress", "settings"].includes(state.page)) action(navigate);
  });
  initDevice();
  initGuide();
  initPlay();
  await navigate();
  live((s) => update(s));
  setInterval(heartbeat, 1000);
  window.addEventListener("hashchange", () => action(navigate));
  document.addEventListener("visibilitychange", heartbeat);
  window.addEventListener("focus", heartbeat);
  window.addEventListener("blur", heartbeat);
  // Selecting Play while already on it returns to the instrument choice.
  document.querySelector('[data-nav="play"]').addEventListener("click", (e) => {
    if (state.page === "play" && !running(state.snapshot)) {
      e.preventDefault();
      goHome();
    }
  });
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-open-session]");
    if (target) location.hash = "history/" + encodeURIComponent(target.dataset.openSession);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("g[data-open-session]")) {
      e.preventDefault();
      location.hash = "history/" + encodeURIComponent(e.target.dataset.openSession);
    }
  });
  document.body.dataset.appReady = "true";
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(console.warn);
