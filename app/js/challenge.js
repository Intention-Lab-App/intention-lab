// Challenge: a number of sessions of one game, at one level and length, chosen
// before the first and judged together after the last. Its sessions are
// ordinary sessions that also record the challenge they belong to.
import { request, post, query, analyze } from "./api.js";
import { state, action, message, running } from "./state.js";
import { esc, scoreStyle, plural, date, infoButton, stopReason, empty } from "./format.js";
import { chance } from "./core/score.js";
import { GAMES, DIFFICULTIES, DURATIONS, CHALLENGE_SIZES } from "./core/protocol.js";
import { preferences } from "./core/preferences.js";
import { icon, gameIcon } from "./icons.js";
import { choiceFor, lastChoice } from "./profiles.js";
import { deviceInfo, connectDevice, openDevices } from "./device.js";
import { playChallenge } from "./play.js";
const $ = (id) => document.getElementById(id);
let list = [],
  form = null,
  starting = false;
// The current profile's challenges, newest first. One whose last session has
// ended gets its verdict here, if the background pass has not given it yet.
export async function loadChallenges() {
  list = await request("/challenges");
  if (!running(state.snapshot) && list.some((c) => c.status === "Active" && c.sessionIds.length >= c.sessions)) {
    await analyze("finalize", {});
    list = await request("/challenges");
  }
  return list;
}
export const activeChallenge = () => list.find((c) => c.status === "Active") ?? null;
export const challengeLabel = (c) =>
  `${c.sessions} sessions of ${c.game}, ${DIFFICULTIES[c.difficultyId - 1].label}, ${c.durationMinutes} min each way`;
// The verdict, in the same words as the overall score on Progress.
function verdictLine(v) {
  if (v?.value == null) return "None of its sessions measured anything, so there is nothing to judge.";
  if (v.ratio <= 0) return "Over this challenge, the results did not lean your way.";
  if (!v.value) return "Over this challenge, your sessions did not agree on a direction.";
  if (v.value < 25) return "Over this challenge, a slight lean your way.";
  if (v.value < 50) return "Over this challenge, a modest lean your way.";
  if (v.value < 75) return "Over this challenge, a clear lean your way.";
  return "Over this challenge, a strong and consistent lean your way.";
}
const statusLine = (c) =>
  c.status === "Complete"
    ? verdictLine(c.verdict)
    : c.status === "Given up"
      ? `Given up after ${c.sessionIds.length} of ${c.sessions}.`
      : `${c.sessionIds.length} of ${c.sessions} played.`;
async function sessionsOf(c) {
  const page = await request(
    "/sessions?" + query({ challenge: c.id, source: c.source, mask: c.xorMask ? "on" : "off", pageSize: 100, timezone: state.timezone }),
  );
  return page.items.sort((a, b) => a.createdUtc.localeCompare(b.createdUtc));
}

export async function renderChallenge(id = "") {
  const host = $("challenge-content");
  await loadChallenges();
  const c = id ? list.find((x) => x.id === decodeURIComponent(id)) : activeChallenge();
  if (id && !c) {
    host.innerHTML = empty("Challenge not found", "It may belong to another profile.", "flag") + '<a class="secondary" href="#challenge">All challenges</a>';
    return;
  }
  const past = list.filter((x) => x !== c && x.status !== "Active");
  host.innerHTML = (c ? challengeHtml(c, await sessionsOf(c), !!id) : startHtml()) + pastHtml(past);
  if (c) bindChallenge(c);
  else bindStart();
}

// Start --------------------------------------------------------------
function startHtml() {
  if (!form) {
    const game = lastChoice()?.game ?? "Bulb",
      { level, minutes } = choiceFor(game);
    form = { game, level, minutes, sessions: 10 };
  }
  const choices = (name, items, value) =>
    `<div class="choices">${items
      .map(([v, label, small]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(value) ? "checked" : ""}/><span>${label}${small ? `<small>${esc(small)}</small>` : ""}</span></label>`)
      .join("")}</div>`;
  return `<section class="challenge-start">
<p class="prose">Decide now how many sessions you will play, of one game at one level and length. Play them whenever you like, one after another. At the end they are judged together, in one verdict.${infoButton("challenge", "How a challenge works")}</p>
<form id="challenge-form" class="challenge-form" novalidate>
<fieldset class="field"><legend>Game</legend>${choices("challenge-game", GAMES.map((g) => [g, `${icon(gameIcon(g))}${g}`]), form.game)}</fieldset>
<fieldset class="field"><legend>Difficulty${infoButton("levels", "How levels and goals work")}</legend>${choices("challenge-level", DIFFICULTIES.map((d) => [d.id, esc(d.label), `1 in ${d.oneIn.toLocaleString("en-US")}`]), form.level)}</fieldset>
<fieldset class="field"><legend>Time for each direction</legend>${choices("challenge-minutes", DURATIONS.map((m) => [m, String(m), "min"]), form.minutes)}</fieldset>
<fieldset class="field"><legend>Sessions</legend>${choices("challenge-sessions", CHALLENGE_SIZES.map((n) => [n, String(n)]), form.sessions)}</fieldset>
<p id="challenge-commitment" class="commitment">${esc(commitment())}</p>
<div class="begin"><button class="primary large" type="submit">Begin</button><p class="hint">The first session starts at once.</p></div>
</form></section>`;
}
function commitment() {
  const d = DIFFICULTIES[form.level - 1],
    total = form.sessions * form.minutes * 2;
  return `You commit to ${form.sessions} sessions of ${form.game} at ${d.label}, ${plural(form.minutes, "minute")} each way, about ${total < 60 ? plural(total, "minute") : plural(Math.round(total / 6) / 10, "hour")} of play in all. These stay the same to the end. Every session you start counts, even one you stop early.`;
}
function bindStart() {
  const f = $("challenge-form");
  f.onchange = () => {
    const v = (name) => f.querySelector(`[name=challenge-${name}]:checked`).value,
      game = v("game");
    // Another game starts from that game's own last level and length.
    if (game !== form.game) {
      const { level, minutes } = choiceFor(game);
      form = { ...form, game, level, minutes };
      f.querySelector(`[name=challenge-level][value="${form.level}"]`).checked = true;
      f.querySelector(`[name=challenge-minutes][value="${form.minutes}"]`).checked = true;
    } else form = { ...form, level: Number(v("level")), minutes: Number(v("minutes")) };
    form.sessions = Number(v("sessions"));
    $("challenge-commitment").textContent = commitment();
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    if (starting || running(state.snapshot)) return;
    starting = true;
    action(async () => {
      try {
        if (!state.snapshot?.connected) {
          const found = deviceInfo().detected;
          if (!found) return openDevices();
          await connectDevice(found.id);
        }
        const prefs = preferences((await request("/settings")).sessionPreferences),
          c = await post(
            "/challenges",
            {
              game: form.game,
              difficultyId: form.level,
              durationMinutes: form.minutes,
              sessions: form.sessions,
              xorMask: prefs.xorMask,
              referenceId: prefs.referenceId,
            },
            crypto.randomUUID(),
          );
        list = [c, ...list];
        form = null;
        await playChallenge(c);
      } finally {
        starting = false;
      }
    });
  };
}

// One challenge ----------------------------------------------------------
function stripHtml(c, sessions) {
  const cells = Array.from({ length: c.sessions }, (_, i) => {
    const s = sessions[i];
    if (!s) return `<li class="strip-cell${i === sessions.length && c.status === "Active" ? " next" : ""}"></li>`;
    const scored = s.state === "Completed" && s.score;
    return `<li class="strip-cell played${scored ? "" : " ended"}" style="${scored ? scoreStyle(s.score.value) : ""}" title="${esc(`Session ${i + 1}: ${scored ? "score " + s.score.value : s.state === "Completed" ? "no score" : stopReason(s) || "playing"}`)}"></li>`;
  }).join("");
  return `<ol class="strip" aria-label="${esc(`${sessions.length} of ${c.sessions} sessions played`)}">${cells}</ol>`;
}
function rowHtml(s, i) {
  const scored = s.state === "Completed" && s.score,
    sub = s.state === "Completed" ? (s.clean ? "Completed" : "Completed, quality check needed") : stopReason(s) || "Playing now";
  return `<li><a class="history-row" href="#history/${encodeURIComponent(s.id)}">
<span class="row-score${scored ? "" : " none"}" style="${scored ? scoreStyle(s.score.value) : ""}" aria-label="${scored ? "Score " + s.score.value : "No score"}">${scored ? s.score.value : "–"}</span>
<span><span class="row-title">Session ${i + 1}</span><span class="row-sub" style="display:block">${esc(sub)}</span></span>
<span class="row-date">${esc(date(s.createdUtc, state.timezone))}</span></a></li>`;
}
function challengeHtml(c, sessions, linked) {
  const v = c.verdict,
    played = c.sessionIds.length,
    tags =
      (c.source === "Simulation" ? ' <span class="tag sim">Simulation</span>' : "") +
      (c.xorMask ? "" : ' <span class="tag warn">XOR off</span>');
  let head;
  if (c.status === "Complete")
    head = `<div class="progress-hero${v?.value == null ? " waiting" : ""}">
${v?.value == null ? "" : `<p class="score" style="${scoreStyle(v.value)}" aria-label="Challenge score ${Number(v.value)}">${Number(v.value)}</p>`}
<div><p class="score-label">Challenge complete${infoButton("challenge", "How a challenge works")}${tags}</p><p class="verdict">${esc(verdictLine(v))}</p>${v?.value == null ? "" : `<p class="chance">${esc(chance(v.p, v.value).text)} Based on all ${plural(v.started, "session")}${v.endedEarly ? `, ${Number(v.endedEarly)} of them ended early` : ""}.</p>`}</div></div>`;
  else if (c.status === "Given up")
    head = `<div class="challenge-head"><p class="score-label">Challenge given up${infoButton("challenge", "How a challenge works")}${tags}</p><p class="verdict">Given up after ${played} of ${c.sessions} sessions.</p><p class="chance">A challenge left unfinished has no verdict. Its sessions stay in your history and count on Progress like any other.</p></div>`;
  else
    head = `<div class="challenge-head"><p class="score-label">Challenge in progress${infoButton("challenge", "How a challenge works")}${tags}</p><p class="verdict">${played} of ${c.sessions}</p></div>`;
  return `${linked ? '<a class="back" href="#challenge">All challenges</a>' : ""}
<section class="challenge" data-status="${esc(c.status)}">
<h2 class="challenge-title">${icon(gameIcon(c.game))}${esc(challengeLabel(c))}</h2>
<p class="fine">Started ${esc(date(c.createdUtc, state.timezone))}${c.endedUtc ? `, ended ${esc(date(c.endedUtc, state.timezone))}` : ""}.</p>
${head}
${stripHtml(c, sessions)}
${
  c.status === "Active"
    ? `<div class="begin challenge-next"><button id="challenge-play" class="primary large" type="button" ${played >= c.sessions ? "disabled" : ""}>Play session ${Math.min(played + 1, c.sessions)}</button><p class="hint">Every session you start counts, even one you stop early.</p></div>`
    : ""
}
${sessions.length ? `<h3>Sessions</h3><ol class="history-list">${sessions.map(rowHtml).join("")}</ol>` : ""}
${
  c.status === "Active"
    ? `<p class="give-up"><button id="give-up" class="link" type="button">Give up this challenge</button><span id="give-up-confirm" hidden>Give up? It is kept, marked as given up, with no verdict. <button id="give-up-yes" class="secondary small" type="button">Give up</button> <button id="give-up-no" class="quiet small" type="button">Keep going</button></span></p>`
    : !activeChallenge()
      ? '<p class="challenge-new"><a class="secondary" href="#challenge">Start a new challenge</a></p>'
      : ""
}
</section>`;
}
function bindChallenge(c) {
  const play = $("challenge-play");
  if (play) play.onclick = () => action(() => playChallenge(c));
  const give = $("give-up");
  if (!give) return;
  give.onclick = () => {
    give.hidden = true;
    $("give-up-confirm").hidden = false;
    $("give-up-no").focus();
  };
  $("give-up-no").onclick = () => {
    $("give-up-confirm").hidden = true;
    give.hidden = false;
    give.focus();
  };
  $("give-up-yes").onclick = () =>
    action(async () => {
      await post(`/challenges/${encodeURIComponent(c.id)}/give-up`);
      message("Challenge given up. It is kept with its sessions.");
      const target = "#challenge/" + encodeURIComponent(c.id);
      if (location.hash === target) await renderChallenge(encodeURIComponent(c.id));
      else location.hash = target;
    });
}

// Past challenges ----------------------------------------------------------
function pastHtml(past) {
  if (!past.length) return "";
  return `<section class="challenge-past"><h2>Past challenges</h2><ol class="history-list">${past
    .map((c) => {
      const v = c.status === "Complete" ? c.verdict?.value : null;
      return `<li><a class="history-row" href="#challenge/${encodeURIComponent(c.id)}">
<span class="row-score${v == null ? " none" : ""}" style="${v == null ? "" : scoreStyle(v)}" aria-label="${v == null ? "No verdict" : "Score " + Number(v)}">${v == null ? "–" : Number(v)}</span>
<span><span class="row-title">${icon(gameIcon(c.game))}${esc(challengeLabel(c))}${c.source === "Simulation" ? ' <span class="tag sim">Simulation</span>' : ""}</span><span class="row-sub" style="display:block">${esc(statusLine(c))}</span></span>
<span class="row-date">${esc(date(c.createdUtc, state.timezone))}</span></a></li>`;
    })
    .join("")}</ol></section>`;
}
