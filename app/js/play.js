// The Play flow: choose an instrument, set it up, play both directions on a
// full-screen stage, then see the score. Measurement lives in the engine; this
// module only renders snapshots and sends commands.
import { request, post } from "./api.js";
import {
  state,
  subscribe,
  running,
  action,
  update,
  onLayer,
} from "./state.js";
import { timer, esc, count, signed, rate, instruction, direction } from "./format.js";
import { preferences } from "./core/preferences.js";
import { DIFFICULTIES, DURATIONS, goalFor } from "./core/protocol.js";
import { unlockSound, startSound } from "./sound.js";
import { createBulb } from "./bulb.js";
import { createBar } from "./bar.js";
import { createBox, boxRecord } from "./box.js";
import { mountResult, disposeResult } from "./result.js";
import { profiles, currentProfile, choiceFor, lastChoice, rememberChoice, onProfileChange } from "./profiles.js";
import { deviceInfo, onDeviceChange, connectDevice, openDevices } from "./device.js";
import { loadChallenges, activeChallenge } from "./challenge.js";
const $ = (id) => document.getElementById(id);
const LEDE = {
  Bulb: "It asks you to make the filament brighter, then dimmer, or the other way round. Each gets the same time, and the order is random.",
  Bar: "It asks you to push the needle up, then down, or the other way round. Each gets the same time, and the order is random.",
  Box: "It asks you to fill it with ones, then with zeros, or the other way round. It shows you nothing while you play: it stays sealed until the end, then opens on what its recorder wrote. Each part gets the same time, and the order is random.",
};
const SOUND_LINES = {
  Bulb: "The lamp hums like a real bulb on a dimmer: a soft hum when bright, a buzz part way, silence when dark.",
  Bar: "The meter sings its reading like a theremin, higher as the needle rises and lower as it falls. From half way through a part, reaching the red needle the way you are asked closes its contact: a relay and a small bell.",
  Box: "A warm, steady drone with a soft pulse, the same all through every session, so it tells you nothing. Its knob clicks between the parts, and at the end the box creaks open.",
};
const LEVEL_LINES = [
  "Chance alone reaches the goal about 1 session in 5. A good place to start: the display reacts the most.",
  "Chance alone reaches the goal 1 session in 20. The display reacts a little less.",
  "Chance alone reaches the goal 1 session in 100. The display reacts less.",
  "Chance alone reaches the goal 1 session in 1,000. Small changes barely show.",
  "Chance alone reaches the goal 1 session in 10,000. Only strong changes show.",
];
// How much the Bulb reacts changes with the level; the Bar and the Box look the
// same at every level, so they get only the chance, and Easy its welcome.
const levelLine = (g, l) =>
  g === "Bulb"
    ? LEVEL_LINES[l - 1]
    : l === 1
      ? "Chance alone reaches the goal about 1 session in 5. A good place to start."
      : LEVEL_LINES[l - 1].replace(/\.\s.*$/, ".");
const PREVIEW_NOTES = {
  Bulb: "Shows how the display moves with random data. Nothing is saved.",
  Bar: "Shows how the display moves with random data. Nothing is saved.",
  Box: "Opens the box on a record of random data. Nothing is saved.",
};
let view = "home",
  game = "Bulb",
  // The first choice is Easy, a minute each way; after that, the last one played.
  level = 1,
  minutes = 1,
  prefs = preferences(),
  home = {},
  setupView,
  stageView,
  stageSound = null,
  previewSound = null,
  stageGame,
  previewing = false,
  previewTimer,
  previewToken = 0,
  pending = false,
  syncedSession = null,
  lastFinished = null,
  announced = null,
  resultPending = false,
  revealing = false,
  stopTimer;

export const currentView = () => view;
// The stage hides the header only while the Play page is the one in view.
export function refreshImmersive() {
  document.body.classList.toggle("immersive", view === "stage" && state.page === "play");
}
export function show(next) {
  view = next;
  for (const v of ["home", "setup", "stage", "result"]) $(v).hidden = v !== next;
  refreshImmersive();
  if (next !== "setup") stopPreview();
  if (next !== "result") disposeResult();
  if (next === "home") renderHome();
}
export function goHome() {
  if (running(state.snapshot) || pending || revealing) return;
  show("home");
}
const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Each game's instrument, in a host. The Bar and the Box take their sound from
// a voice; the Bulb's sound follows its level from here.
function instrument(g, host, light, where) {
  if (g === "Bulb") {
    const sizes = {
      home: { glassBottom: 0.7, height: 0.56, fadeCord: true },
      setup: { glassBottom: 0.9, height: 0.66, fadeCord: true },
      stage: { glassBottom: 0.6, height: 0.5, width: 0.7 },
    }[where];
    return createBulb(host, { light, ...sizes, label: { home: "A bulb at rest", setup: "Bulb at rest", stage: "The bulb" }[where] });
  }
  if (g === "Bar") return createBar(host, { light, lab: state.lab, label: { home: "A needle meter at rest", setup: "Bar at rest", stage: "The bar" }[where] });
  return createBox(host, {
    light,
    level,
    motes: where === "home" ? 140 : 240,
    crop: where === "home" ? 470 : null,
    label: { home: "A sealed box", setup: "The box, sealed", stage: "The box, sealed until the end" }[where],
  });
}

// Home ---------------------------------------------------------------
// The home screen reads the challenge list once, when it is first shown. Never
// while a session runs: a read the page opens while it is busy drawing would
// hold up the engine's saves.
let challengesLoaded = false;
function renderHome() {
  if (!challengesLoaded && !running(state.snapshot)) {
    challengesLoaded = true;
    action(async () => {
      await loadChallenges();
      if (view === "home") renderHome();
    });
  }
  const s = state.snapshot,
    info = deviceInfo(),
    last = lastChoice();
  $("again").hidden = !last;
  const many = profiles().list.length > 1;
  $("home-profile").hidden = !many;
  if (many) $("home-profile").innerHTML = `Playing as <strong>${esc(currentProfile().name)}</strong>. <a href="#settings">Change</a>`;
  const c = activeChallenge();
  $("home-challenge").hidden = !c;
  if (c) $("home-challenge-text").innerHTML = `Challenge: <strong>${c.sessionIds.length} of ${c.sessions}</strong> ${esc(`· ${c.game}, ${DIFFICULTIES[c.difficultyId - 1].label}, ${c.durationMinutes} min each way`)}`;
  if (last)
    $("again-text").innerHTML = `Last time: <strong>${esc(`${last.game}, ${DIFFICULTIES[last.level - 1].label}, ${last.minutes} min each way`)}</strong>`;
  const note = $("home-device");
  if (s?.connected) {
    const notes = [
      s.source === "Simulation" && "Simulation connected. Its sessions are saved apart from your device's.",
      !prefs.xorMask && "The XOR mask is off (Lab setting). New sessions are kept apart from sessions with the mask.",
    ].filter(Boolean);
    note.hidden = !notes.length;
    note.textContent = notes.join(" ");
  } else {
    note.hidden = !info.scanned;
    note.innerHTML = info.bridgeDown
      ? "The device bridge is not running. Start DeviceBridge again to play."
      : info.detected
        ? `Your random number generator is plugged in. <button class="primary small" type="button" id="home-connect">Connect</button>`
        : `Plug in your random number generator to play. <button class="link" type="button" id="home-devices">Device options</button>`;
    $("home-connect")?.addEventListener("click", () => action(() => connectDevice(info.detected.id)));
    $("home-devices")?.addEventListener("click", openDevices);
  }
}

// Setup --------------------------------------------------------------
function buildChoices() {
  $("levels").innerHTML = DIFFICULTIES.map(
    (d) =>
      `<label><input type="radio" name="level" value="${d.id}" ${d.id === level ? "checked" : ""}/><span>${esc(d.label)}<small>1 in ${d.oneIn.toLocaleString("en-US")}</small></span></label>`,
  ).join("");
  $("durations").innerHTML = DURATIONS.map(
    (m) => `<label><input type="radio" name="minutes" value="${m}" ${m === minutes ? "checked" : ""}/><span>${m}<small>min</small></span></label>`,
  ).join("");
}
function readChoices() {
  level = Number(document.querySelector("[name=level]:checked")?.value || level);
  minutes = Number(document.querySelector("[name=minutes]:checked")?.value || minutes);
}
function renderSetup() {
  const s = state.snapshot,
    d = DIFFICULTIES[level - 1];
  $("setup-title").textContent = game;
  $("setup-lede").textContent = LEDE[game];
  $("preview-note").textContent = PREVIEW_NOTES[game];
  // In Lab, the goal this level sets for this device and length.
  const rate = s?.connected ? s.bitsPerSecond : 0,
    goal = rate > 0 ? goalFor(d, rate, minutes) : null;
  $("level-line").textContent =
    levelLine(game, level) +
    (state.lab
      ? ` Goal: Z ${d.z.toFixed(2)}, Up minus Down${goal ? `, about +${goal.goalPpm.toFixed(0)} per million at ${Math.round(rate).toLocaleString("en-US")} bits per second for ${minutes} min each way` : ""}.`
      : "");
  $("time-line").textContent = `${minutes * 2} minutes of play, with a short countdown before and a pause between the parts.`;
  $("sound").checked = prefs.sound;
  $("sound-line").textContent = prefs.sound ? SOUND_LINES[game] : "Off. Each session records whether its sound was on.";
  // The Box's drone has two tones; with headphones each ear gets one.
  $("phones-row").hidden = game !== "Box" || !prefs.sound;
  $("phones").checked = prefs.headphones;
  if (game === "Box") setupView?.level(level);
  const connected = !!s?.connected,
    info = deviceInfo(),
    custom = [
      prefs.referenceId && "a measured reference",
      prefs.recordRaw && "raw byte recording",
      !prefs.xorMask && "the XOR mask off",
    ].filter(Boolean);
  const begin = $("begin");
  begin.disabled = pending || !!running(s) || (!connected && info.bridgeDown);
  begin.textContent = connected ? "Begin" : info.detected ? "Connect and begin" : "Connect a device";
  $("begin-hint").textContent = connected
    ? !prefs.xorMask
      ? "The XOR mask is off (Lab setting). This session is kept apart from sessions with the mask."
      : s.source === "Simulation"
      ? "Simulation connected. This session is saved apart from your device's."
      : custom.length && state.lab
        ? `Lab options in use: ${custom.join(", ")}.`
        : "The countdown starts as soon as you begin."
    : info.detected
      ? "Your random number generator is plugged in."
      : "Plug in your random number generator to play.";
}
function setupInstrument() {
  setupView?.destroy();
  $("setup-visual").innerHTML = "";
  setupView = instrument(game, $("setup-visual"), $("setup-frame"), "setup");
  if (game === "Bulb") setupView.snap(0);
  else if (game === "Bar") setupView.set(null);
}
export function openSetup(g = game, opts = {}) {
  if (running(state.snapshot) || pending || revealing) return;
  game = g;
  ({ level, minutes } = choiceFor(g));
  if (opts.level) level = opts.level;
  if (opts.minutes) minutes = opts.minutes;
  buildChoices();
  show("setup");
  setupInstrument();
  renderSetup();
  if (opts.focus !== false) {
    $("setup-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}
function stopPreview() {
  previewing = false;
  previewToken++;
  clearTimeout(previewTimer);
  previewSound?.stop();
  previewSound = null;
  const b = $("preview");
  b.textContent = "Try it";
  b.setAttribute("aria-pressed", "false");
  if (!setupView) return;
  if (game === "Bulb") setupView.set(0);
  else if (game === "Bar") {
    setupView.setVoice(null);
    setupView.set(null);
  } else {
    setupView.setVoice(null);
    setupView.seal();
  }
}
// Frames of unbiased software bits at the connected (or a typical device's)
// rate, through the same smoothing and live statistic as a session.
const previewRate = () =>
  state.snapshot?.connected && state.snapshot.source === "Hardware" ? Math.round(state.snapshot.bitsPerSecond / 8) : 50400;
const previewFrames = (frames) =>
  request(`/preview?difficulty=${level}&bytesPerSecond=${previewRate()}&minutes=${minutes}&frames=${frames}`);
async function preview() {
  if (previewing) return stopPreview();
  previewing = true;
  if (prefs.sound) {
    unlockSound();
    previewSound = startSound(game, { phones: prefs.headphones });
  }
  const token = ++previewToken,
    b = $("preview");
  b.textContent = "Stop";
  b.setAttribute("aria-pressed", "true");
  // The Box: a whole session of random bits, two parts of a minute, then the reveal.
  if (game === "Box") {
    setupView.setVoice(previewSound?.voice ?? null);
    const kinds = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? ["Up", "Down"] : ["Down", "Up"],
      parts = await Promise.all(kinds.map(() => previewFrames(240)));
    if (token !== previewToken) return;
    setupView.ask(kinds[1], { quiet: true });
    await setupView.open({ parts: kinds.map((kind, i) => ({ kind, points: parts[i].map((f, k) => [(k + 1) / parts[i].length, f.zLive]) })) });
    return;
  }
  if (game === "Bar") setupView.setVoice(previewSound?.voice ?? null);
  let frames = [],
    i = 0;
  const tick = async () => {
    if (token !== previewToken) return;
    if (i >= frames.length) {
      frames = await previewFrames(120);
      i = 0;
      if (token !== previewToken) return;
    }
    // Each batch is a fresh part from zero bits, one frame a quarter second.
    const f = frames[i++],
      progress = Math.min(1, (i * 0.25) / (minutes * 60));
    if (game === "Bulb") {
      setupView.set(f.level);
      previewSound?.voice.set(f.level);
    } else setupView.set(f.zLive, f.zGoal, { showGoal: prefs.showDifficultyMarker, progress });
    previewTimer = setTimeout(() => action(tick), 250);
  };
  await action(tick);
}

// Begin --------------------------------------------------------------
async function readPreferences() {
  const saved = await request("/settings");
  prefs = preferences(saved.sessionPreferences);
  state.bootstrap.settings = saved;
  return prefs;
}
export async function begin({ reference = false, again = false, challenge = null } = {}) {
  if (pending || running(state.snapshot) || revealing) return;
  // Sound may start only from the person's own click, so prepare it now.
  if (prefs.sound && !reference) unlockSound();
  if (!state.snapshot?.connected) {
    const found = deviceInfo().detected;
    if (found) await connectDevice(found.id);
    else return openDevices();
  }
  pending = true;
  stopPreview();
  renderSetup();
  try {
    await readPreferences();
    const body = {
      game,
      profileId: currentProfile().id,
      durationMinutes: minutes,
      difficultyId: level,
      // A challenge keeps the mask and reference it was started with.
      referenceId: challenge ? challenge.referenceId : prefs.referenceId,
      challengeId: challenge?.id ?? null,
      recordRaw: prefs.recordRaw,
      xorMask: challenge ? challenge.xorMask : prefs.xorMask,
      timezone: state.timezone,
      notes: again || challenge ? "" : $("note").value,
      tags: again || challenge
        ? []
        : $("tags")
            .value.split(",")
            .map((t) => t.trim())
            .filter(Boolean),
      clientId: state.clientId,
      presentation: {
        showDifficultyMarker: prefs.showDifficultyMarker,
        reducedMotion: reduced(),
        sound: prefs.sound && !reference,
        headphones: prefs.headphones,
      },
    };
    await post(reference ? "/references/start" : "/sessions/start", body, crypto.randomUUID());
    if (!reference && !challenge) await rememberChoice(game, level, minutes);
    $("note").value = "";
    $("tags").value = "";
    document.getElementById("device-dialog").close();
    if (location.hash !== "#play") location.hash = "play";
    update(await request("/state"));
  } finally {
    pending = false;
    if (state.snapshot) render(state.snapshot);
  }
}
export function playAgain() {
  const last = lastChoice();
  if (last) {
    game = last.game;
    level = last.level;
    minutes = last.minutes;
    buildChoices();
  }
  if (state.snapshot?.connected) return action(() => begin({ again: true }));
  openSetup(game);
}
// The next session of a challenge, on its own game, level and length.
export function playChallenge(c) {
  if (running(state.snapshot) || pending || revealing) return;
  game = c.game;
  level = c.difficultyId;
  minutes = c.durationMinutes;
  buildChoices();
  return begin({ challenge: c });
}
// After a challenge session: the next one, or the verdict after the last.
async function challengeStep(id) {
  const c = (await loadChallenges()).find((x) => x.id === id);
  if (!c) return { label: "Play again", onClick: () => playAgain() };
  if (c.status === "Active" && c.sessionIds.length < c.sessions)
    return { label: `Play session ${c.sessionIds.length + 1} of ${c.sessions}`, onClick: () => action(() => playChallenge(c)) };
  return {
    label: c.status === "Complete" ? "Challenge complete. See the verdict" : "See the challenge",
    onClick: () => (location.hash = "challenge/" + encodeURIComponent(c.id)),
  };
}

// Stage --------------------------------------------------------------
function clearStage() {
  stageView?.destroy();
  stageView = null;
  stageSound?.stop();
  stageSound = null;
  syncedSession = null;
}
function syncStage(s) {
  if (syncedSession === s.sessionId && stageGame === s.config.game) return;
  clearStage();
  syncedSession = s.sessionId;
  stageGame = s.config.game;
  game = s.config.game;
  level = s.config.difficulty.id;
  minutes = s.config.durationMinutes;
  const host = $("stage-visual");
  host.innerHTML = "";
  $("stage").dataset.game = stageGame;
  show("stage");
  stageView = instrument(stageGame, host, $("stage"), "stage");
  if (stageGame === "Bulb") stageView.snap(0);
  $("stop-confirm").hidden = true;
  $("stop").hidden = false;
  $("stage-continue").hidden = true;
  // The Box is sealed until the end, so even the Lab's live numbers stay hidden.
  $("live-details").hidden = stageGame === "Box";
  $("clock").hidden = false;
  $("track").hidden = false;
}
function phaseWords(s) {
  const kinds = s.isReference ? ["Reference"] : s.upFirst ? ["Up", "Down"] : ["Down", "Up"],
    say = (k) => (k === "Reference" ? "Rest your attention" : instruction(s.config.game, k));
  if (s.isReference) {
    if (s.phase === "Reference") return { text: "Reference capture. No intention needed.", kinds };
    if (s.state === "Finalizing") return { text: "Saving", kinds };
    return { text: "Reference capture starting", kinds };
  }
  if (s.phase) return { text: say(s.phase), kinds };
  if (s.state === "Transition") return { text: `Pause. Next, ${lower(say(kinds[1]))}`, kinds };
  if (s.state === "Finalizing") return { text: "Saving", kinds };
  return { text: `Get ready to ${lower(say(kinds[0]))}`, kinds };
}
function renderStage(s) {
  syncStage(s);
  const { text, kinds } = phaseWords(s),
    measuring = s.phase === "Up" || s.phase === "Down";
  $("instruction").textContent = text;
  $("clock").textContent = timer(s.remainingSeconds);
  $("stage-source").hidden = s.source !== "Simulation";
  const seconds = (s.isReference ? 5 : s.config.durationMinutes) * 60,
    ordinal = s.state === "Phase1" ? 1 : s.state === "Phase2" ? 2 : 0,
    afterFirst = ["Transition", "Phase2", "Finalizing", "Completed"].includes(s.state),
    // How far the running direction has got, for the bar and its sound.
    progress = measuring ? Math.min(1, Math.max(1e-3, 1 - s.remainingSeconds / seconds)) : null;
  $("track").innerHTML = kinds
    .map((k, i) => {
      const done =
        i === 0
          ? afterFirst
            ? 1
            : ordinal === 1
              ? 1 - s.remainingSeconds / seconds
              : 0
          : s.state === "Finalizing"
            ? 1
            : ordinal === 2
              ? 1 - s.remainingSeconds / seconds
              : 0;
      const cls = ordinal === i + 1 ? "current" : done >= 1 ? "done" : "";
      return `<span class="seg ${cls}"><i style="--done:${Math.max(0, Math.min(1, done)).toFixed(4)}"></i><b>${k === "Reference" ? "Reference" : direction(s.config.game, k)}</b></span>`;
    })
    .join("");
  $("track").style.gridTemplateColumns = `repeat(${kinds.length}, 1fr)`;
  const key = `${s.sessionId}/${s.state}`;
  if (announced !== key) {
    announced = key;
    $("announcer").textContent = text;
  }
  // Sound follows the frozen setting of this session, and only while it is in view.
  if (s.config.presentation?.sound && !stageSound) {
    stageSound = startSound(stageGame, { phones: s.config.presentation.headphones === true });
    if (stageGame !== "Bulb") stageView.setVoice(stageSound?.voice ?? null);
  }
  stageSound?.audible(state.page === "play" && view === "stage");
  if (stageGame === "Bulb") {
    stageView.set(measuring ? s.level : 0, measuring ? `The bulb. ${text}.` : "The bulb at rest");
    stageSound?.voice.set(measuring ? s.level : 0);
  } else if (stageGame === "Bar")
    stageView.set(measuring ? s.zLive : null, measuring ? s.zGoal : null, {
      showGoal: s.config.presentation?.showDifficultyMarker !== false,
      rest: !measuring,
      progress,
    });
  // The Box shows nothing of the data. Its Ask knob follows the plan: the first
  // part's ask from the countdown, turned over in the pause.
  else if (!s.isReference) stageView.ask(afterFirst ? kinds[1] : kinds[0]);
  $("live-numbers").textContent = measuring
    ? `${count(s.acceptedBits)} bits, ones ${rate(Number(s.ones) / Number(s.acceptedBits || 1), 4)}, smoothed ${signed(s.deltaSmooth == null ? null : s.deltaSmooth * 1e6)} per million, Z ${signed(s.zLive, 2)}${s.feedbackInterrupted ? ". Feedback interrupted." : ""}`
    : "Live numbers appear while a direction is running.";
}
// The Box opens on its record before the score, and waits for the person.
async function reveal(detail) {
  revealing = true;
  try {
    $("stop").hidden = true;
    $("stop-confirm").hidden = true;
    $("instruction").textContent = "Opening the box";
    $("announcer").textContent = "Opening the box";
    $("clock").textContent = timer(0);
    await stageView.open(boxRecord(detail.session, detail.buckets || []));
    if (!stageView) return;
    $("instruction").textContent = "The box is open";
    $("announcer").textContent = "The box is open. On the lid is the record it wrote while it was sealed.";
    $("clock").hidden = true;
    $("track").hidden = true;
    const go = $("stage-continue");
    go.hidden = false;
    if (state.page === "play") go.focus({ preventScroll: true });
    await new Promise((resolve) => (go.onclick = resolve));
    go.hidden = true;
  } finally {
    revealing = false;
  }
}

// Snapshot rendering ---------------------------------------------------
export function render(s) {
  if (!s) return;
  const active = !!running(s);
  $("return-to-session").hidden = !active || state.page === "play";
  if (active) {
    renderStage(s);
    return;
  }
  if (view === "setup") renderSetup();
  if (view === "home") renderHome();
  if (
    s.sessionId &&
    lastFinished !== s.sessionId &&
    ["Completed", "Faulted", "Aborted"].includes(s.state)
  ) {
    lastFinished = s.sessionId;
    resultPending = true;
    const id = s.sessionId;
    action(async () => {
      try {
        const detail = await request("/sessions/" + encodeURIComponent(id));
        if (running(state.snapshot) || state.snapshot?.sessionId !== id) return;
        if (stageGame === "Box" && stageView && view === "stage" && detail.session.state === "Completed" && !detail.session.isReference) await reveal(detail);
        const step = detail.session.config.challengeId ? await challengeStep(detail.session.config.challengeId) : null;
        if (running(state.snapshot) || state.snapshot?.sessionId !== id) return;
        clearStage();
        show("result");
        mountResult($("result"), detail, {
          ceremony: true,
          primary: detail.session.isReference
            ? { label: "Back to settings", onClick: () => (location.hash = "settings") }
            : (step ?? { label: "Play again", onClick: () => playAgain() }),
        });
        if (state.page === "play") $("result").querySelector("[data-act]")?.focus({ preventScroll: true });
      } finally {
        resultPending = false;
        if (view === "stage" && !running(state.snapshot)) show("home");
      }
    });
  } else if (view === "stage" && !resultPending) {
    clearStage();
    show("home");
  }
}

export function initPlay() {
  prefs = preferences(state.bootstrap.settings.sessionPreferences);
  const last = lastChoice();
  if (last) ({ game, level, minutes } = last);
  // Reopen on the home screen unless an attempt is running.
  if (!running(state.bootstrap.snapshot)) lastFinished = state.bootstrap.snapshot?.sessionId;
  for (const card of document.querySelectorAll(".instrument-card")) {
    const g = card.dataset.game,
      view = (home[g] = instrument(g, card.querySelector(".instrument-view"), card, "home"));
    if (g === "Bulb") view.snap(0);
    else if (g === "Bar") view.set(null);
    // A card warms as it is pointed at: the lamp glows, the needle wakes.
    const warm = () => (g === "Bulb" ? view.set(0.16) : g === "Bar" ? view.set(0) : null);
    const cool = () => (g === "Bulb" ? view.set(0) : g === "Bar" ? view.set(null) : null);
    card.addEventListener("pointerenter", warm);
    card.addEventListener("pointerleave", cool);
    card.addEventListener("focus", warm);
    card.addEventListener("blur", cool);
    card.addEventListener("click", () => openSetup(g));
  }
  $("again-button").onclick = () => playAgain();
  $("home-challenge-button").onclick = () => (location.hash = "challenge");
  buildChoices();
  $("setup-form").onchange = (e) => {
    if (e.target.id === "sound" || e.target.id === "phones") return;
    readChoices();
    renderSetup();
    if (previewing) {
      stopPreview();
      action(preview);
    }
  };
  $("setup-form").onsubmit = (e) => {
    e.preventDefault();
    action(() => begin());
  };
  document.querySelector('[data-to="home"]').onclick = () => goHome();
  $("preview").onclick = () => action(preview);
  // The sound switches take effect at once, are saved in the background and
  // are frozen into each session at its start.
  const saveSound = (next) => {
    prefs = preferences({ ...prefs, ...next });
    renderSetup();
    if (previewing) {
      stopPreview();
      action(preview);
    }
    action(async () => {
      state.bootstrap.settings = await post("/settings", { sessionPreferences: prefs });
    });
  };
  $("sound").onchange = () => saveSound({ sound: $("sound").checked });
  $("phones").onchange = () => saveSound({ headphones: $("phones").checked });
  $("stop").onclick = () => {
    $("stop").hidden = true;
    $("stop-confirm").hidden = false;
    $("stop-no").focus();
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      $("stop-confirm").hidden = true;
      $("stop").hidden = false;
    }, 6000);
  };
  $("stop-no").onclick = () => {
    clearTimeout(stopTimer);
    $("stop-confirm").hidden = true;
    $("stop").hidden = false;
    $("stop").focus();
  };
  $("stop-yes").onclick = () =>
    action(async () => {
      clearTimeout(stopTimer);
      await post(`/sessions/${state.snapshot.sessionId}/abort`);
    });
  subscribe(render);
  // Another profile: its own last game, and its own choices next time.
  onProfileChange(() => {
    const last = lastChoice();
    ({ game, level, minutes } = last ?? { game, ...choiceFor(game) });
    buildChoices();
    challengesLoaded = false;
    if (view === "home") renderHome();
  });
  onDeviceChange(() => render(state.snapshot));
  onLayer(() => {
    if (view === "setup") {
      setupInstrument();
      renderSetup();
    }
    stageView?.setLab?.(state.lab);
    home.Bar?.setLab?.(state.lab);
  });
  show(running(state.bootstrap.snapshot) ? "stage" : "home");
  if (state.bootstrap.snapshot) render(state.bootstrap.snapshot);
}
export const refreshPreferences = () => readPreferences().then(() => view === "setup" && renderSetup());
export const beginReference = () => begin({ reference: true });
