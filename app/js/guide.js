// The guide: how a session works, step by step, in plain words and pictures.
// Lab mode shows the same steps, each with its equations and details added
// underneath. It opens from the header's "i" button, or from an "i" next to a
// number, which jumps to the matching topic.
import { state, onLayer } from "./state.js";
import { DIFFICULTIES, VERSION, STATS } from "./core/protocol.js";
import { SCORE_VERSION, scoreValue, weightFor } from "./core/score.js";
import { normalQuantile } from "./core/statistics.js";
import { PRESENTATION_VERSION } from "./core/preferences.js";
import { modeControl } from "./format.js";
import { icon } from "./icons.js";
import * as fig from "./figures.js";

// MathML Core, rendered by the browser.
const mi = (x) => `<mi>${x}</mi>`,
  mn = (x) => `<mn>${x}</mn>`,
  mo = (x) => `<mo>${x}</mo>`,
  mt = (x) => `<mtext>${x}</mtext>`,
  row = (...x) => `<mrow>${x.join("")}</mrow>`,
  sub = (a, b) => `<msub>${a}${b}</msub>`,
  sup = (a, b) => `<msup>${a}${b}</msup>`,
  frac = (a, b) => `<mfrac>${a}${b}</mfrac>`,
  sqrt = (...x) => `<msqrt>${x.join("")}</msqrt>`,
  paren = (...x) => row(mo("("), ...x, mo(")")),
  math = (...x) => `<math display="block">${x.join("")}</math>`,
  gap = `<mspace width="1.4em"/>`,
  sp = `<mspace width="0.3em"/>`,
  up = (x) => sub(mi(x), mt("Up")),
  down = (x) => sub(mi(x), mt("Down")),
  pool = sub(mi("p"), mt("pool"));

// What reaching the goal is worth: the same on any device and at any length,
// because the goal is the level's Z for the session's own bits.
const atGoal = (game) => DIFFICULTIES.map((d) => scoreValue(1, d.z, weightFor(game)));
// Sessions needed to reach an alpha with 80% power, for an average Z per session.
const n80 = (alpha, delta) => Math.ceil(((normalQuantile(1 - alpha) + normalQuantile(0.8)) / delta) ** 2);

// Levels named in the plain text, with their odds from the protocol.
const [EASY, BALANCED] = DIFFICULTIES,
  EXPERT = DIFFICULTIES.at(-1),
  oneIn = (d) => d.oneIn.toLocaleString("en-US");

const TOPICS = [
  {
    id: "session",
    icon: "timer",
    title: "A session",
    body: () =>
      `<p>Each session has two parts of the same length. Every game asks for more 1s in one part and more 0s in the other: brighter or dimmer on the Bulb, up or down on the Bar, ones or zeros on the Box.</p>${fig.timeline()}`,
    detail: `<p>Timing follows the bridge's clock: 2 seconds of preparation, the 5-second countdown, the first direction, the 15-second pause, then the second. The order comes from the computer's own random source, never from your device, so it cannot depend on what the device is about to send. It is recorded with the session.</p><p>A read counts only if it starts at or after a direction's start and arrives before its end. Reads that straddle a boundary are left out, whatever their values. Counts are kept in 250 ms buckets, with the display values used for the replay.</p>`,
  },
  {
    id: "measure",
    icon: "bits",
    title: "What is measured",
    body: () =>
      `<p>Your device sends a fast stream of random bits, 0s and 1s. In each part we count how many of them are 1s. Your result is the difference: how many more 1s came in the part that asked for 1s than in the part that asked for 0s. By chance alone, the two parts come out about even.</p><p>Before counting, every other bit is flipped by a fixed pattern called an XOR mask. If your device leans a little towards 1s or 0s, the mask cancels the lean, so it cannot push your result either way.</p>${fig.xor()}`,
    detail:
      math(mi("x"), mo("="), mi("b"), mo("⊕"), mi("m"), gap, mi("m"), mo("="), mn("0101…"), sp, paren(mn("0x55"), sp, mt("in every byte"))) +
      math(up("q"), mo("="), frac(up("K"), up("N")), gap, down("q"), mo("="), frac(down("K"), down("N"))) +
      math(mi("d"), mo("="), up("q"), mo("−"), down("q"), gap, mt("effect"), mo("="), sup(mn("10"), mn("6")), mo("·"), mi("d")) +
      `<p>b is a bit as the device sent it and x the bit that is counted. K is the number of counted 1s and N the number of bits in each direction. Up is the part aiming for more 1s (brighter, up, or ones) and Down the part aiming for fewer; Lab tables use these names for every game. The effect is in extra 1s per million bits.</p><p>Bias is handled three ways. The mask cancels a lean that is the same at every bit position, because half the bits count a physical 1 as a 1 and half as a 0; it also keeps the live display centred. Up minus Down cancels a steady lean again, and the random order cancels slow drift on average. The device's own ones rate, before the mask, is kept with every session and shown under Data quality.</p><p>Lab Settings can turn the mask off, to study the device itself. Such sessions are recorded as unmasked and kept apart, with their own history and overall score.</p><p>Receipt times are the computer's, not the device's. Bits lost before the reader cannot be ruled out, so any gap over 2 seconds ends the attempt.</p>`,
  },
  {
    id: "instruments",
    icon: "bulb",
    title: "The bulb, the bar and the box",
    body: () =>
      `<p>The bulb shows the last few seconds. More 1s heat the filament until it glows bright; more 0s cool it towards dark. With nothing going on, it rests at a dim orange. With sound on, it hums like a lamp on a dimmer.</p>${fig.instruments("Bulb")}<p>The bar is a needle meter for the whole part so far. Its black needle swings up with more 1s and down with more 0s. The red needle is your goal: as the part goes on, it moves out on the side you are aiming for. Push the black needle past it. With sound on, the bar sings higher as its needle rises, and from half way through a part a small bell rings when the black needle reaches the red one.</p>${fig.instruments("Bar")}<p>The box shows nothing while you play. Its Ask knob points to 1 or 0 for the part that is running, while a recorder inside writes everything down. When a session is complete, the box opens on that record: a violet line for each part, above the middle while 1s lead and below it while 0s lead. With sound on, it plays a steady drone that gives nothing away.</p>${fig.instruments("Box")}<p>The pictures and sounds never change what is counted.</p>`,
    detail:
      math(mi("w"), mo("="), sup(mn("2"), row(mo("−"), mi("a"), mo("/"), mn("3"), sp, mt("s"))), gap, mi("δ"), mo("="), frac(row(mo("∑"), mi("w"), mi("k")), row(mo("∑"), mi("w"), mi("n"))), mo("−"), frac(mn("1"), mn("2"))) +
      math(sub(mi("z"), mi("s")), mo("="), frac(mi("δ"), sub(mi("σ"), mi("s"))), gap, sub(mi("σ"), mi("s")), mo("="), frac(sqrt(mn("¼"), mo("∑"), sup(mi("w"), mn("2")), mi("n")), row(mo("∑"), mi("w"), mi("n")))) +
      math(mt("bulb level"), mo("="), mi("tanh"), mo("&#x2061;"), paren(row(mi("artanh"), mo("&#x2061;"), mn("0.8")), mo("·"), frac(sub(mi("z"), mi("s")), sub(mi("z"), mt("display"))))) +
      math(sub(mi("Z"), mt("live")), mo("="), frac(row(mi("K"), mo("−"), frac(mi("N"), mn("2"))), sqrt(frac(mi("N"), mn("4")))), gap, sub(mi("Z"), mt("red")), mo("="), frac(row(mt("goal"), mo("/"), mn("2")), sqrt(frac(mn("1"), row(mn("4"), mi("N")))))) +
      math(sub(mi("f"), mt("bar")), mo("="), mn("432"), sp, mt("Hz"), mo("·"), sup(mn("2"), row(mi("Z"), mo("/"), mn("4"))), gap, sub(mi("f"), mt("box")), mo("="), mn("110"), sp, mt("Hz"), sp, mt("and"), sp, mn("120"), sp, mt("Hz")) +
      `<p>The bulb shows a running ones rate of the current part. Every 250 ms bucket of n bits with k 1s counts in it, with a weight w that halves every 3 seconds of its age a: the last 3 seconds carry half of what the bulb shows, the last 6 three quarters, the last 9 seven eighths. There is no fixed window; older bits fade rather than drop out. The rate starts afresh at each part, so the bulb rests between parts. Measuring it in its own standard errors, z s, makes the bulb behave the same on a slow or a fast device. The bulb level runs from −1, dark, through 0, the resting dim orange, to +1, full glow; it reaches ±0.8 when z s reaches z display, which is ${DIFFICULTIES.map((d) => d.displayZ).join(", ")} from Easy to Expert, so harder levels react less. A measured reference chosen in Settings replaces ½ for all three games.</p><p>The bar's black needle is Z live for the current direction, on a scale from −4 to +4; past either end it rests on a stop pin. It swings on a damped spring, so it overshoots a little and settles. The red needle is half the session goal over the current direction's standard error, so it moves out as the bits add up and ends near the level's Z divided by √2: two directions that each end on it give the session exactly its goal. Early in a part chance alone puts the black needle past the red one more than a third of the time, so until half way a crossing makes no sound.</p><p>The box shows nothing from the data while you play. Its record is the same Z live, kept every 250 ms and drawn for each part on the lid's chart.</p><p>The sound is made in the browser, with no recordings. The bulb's level becomes a filament temperature, the power that holds it (∝ T<sup>3.8</sup>) and the firing angle of a phase-cut dimmer. A lamp hums at twice the mains frequency (100 or 120 Hz, from your time zone), and the dimmer's sudden switch-on each half cycle adds the buzz. The bar's voice follows the needle as drawn: 432 Hz at zero, 864 at +4 and 216 at −4. Its contact sounds again only once the needle has fallen 0.25 back from the red one. The box's drone is two tones, 110 Hz and 120 Hz, which beat a steady 10 times a second, in the alpha range, at one volume from start to end; with headphones ticked in setup, each ear gets one tone. It never hears the device. Each session records whether its sound was on (the app's own setting, not your computer's volume), and Insights can compare the two.</p>`,
  },
  {
    id: "levels",
    icon: "levels",
    title: "Levels and goals",
    body: () =>
      `<p>Random bits never come out exactly even, so every result carries some luck. Each level sets a goal that chance alone reaches only so often: 1 session in ${oneIn(EASY)} on ${EASY.label}, down to 1 in ${oneIn(EXPERT)} on ${EXPERT.label}. Pick a level to see where its goal sits.</p>${fig.chance()}<p>The goal is set from your device's speed and the length you chose, so each level is equally hard on any device and at any length. A harder level also makes the bulb react less and sets the bar's red needle further out. The level never changes what is measured.</p>`,
    detail:
      math(pool, mo("="), frac(row(up("K"), mo("+"), down("K")), row(up("N"), mo("+"), down("N")))) +
      math(mi("Z"), mo("="), frac(mi("d"), sqrt(pool, paren(mn("1"), mo("−"), pool), paren(frac(mn("1"), up("N")), mo("+"), frac(mn("1"), down("N")))))) +
      math(mt("chance"), mo("="), mn("1"), mo("−"), mi("Φ"), paren(mi("Z"))) +
      `<p>The pooled ones rate of both directions sets the noise, and Φ is the standard normal distribution. This assumes independent bits and steady rates within each direction.</p>` +
      math(mt("goal"), mo("="), sub(mi("z"), mi("L")), sqrt(frac(mn("0.5"), mi("N"))), gap, mi("N"), mo("="), mt("bits per second"), mo("×"), mt("seconds per direction")) +
      math(sub(mi("z"), mi("L")), mo("="), sup(mi("Φ"), row(mo("−"), mn("1"))), paren(mn("1"), mo("−"), frac(mn("1"), mt("odds"))), gap, mi("r"), mo("="), frac(mi("d"), mt("goal")), mo("≈"), frac(mi("Z"), sub(mi("z"), mi("L")))) +
      `<p>z L is ${DIFFICULTIES.map((d) => d.z.toFixed(2)).join(", ")} from Easy to Expert. The speed is the device's measured rate when the session starts (for the simulation, its set rate), and the goal is frozen with the session. √(0.5/N) is the standard error of Up minus Down at 50/50, so reaching the goal means Z ≈ z L. r = 1 means the goal was reached exactly; r = 2, twice the goal. Goals set in chance terms suit devices of any speed better than a fixed number per million.</p>`,
  },
  {
    id: "score",
    icon: "gauge",
    title: "The score",
    body: () => {
      const bulb = atGoal("Bulb");
      return `<p>Each finished session gets a score from 0 to 100. It combines how close you came to your goal with how rare that is by chance. The Bulb weighs closeness more, the Bar rarity, and the Box the two about evenly. No difference, or a difference the wrong way, scores 0.</p>${fig.score()}<p>A harder level asks for more, so the same result scores lower there, but reaching its goal scores higher, because that is rarer: on the Bulb about ${bulb[0]} on Easy, ${bulb[1]} on Balanced and ${bulb[2]} on Strict, on any device and at any length.</p><p>Under every score, the Luck line says how often chance alone does as well: 1 time in 2 is common, 1 in 20 uncommon, 1 in 1,000 rare.</p>`;
    },
    detail:
      math(mi("S"), mo("="), mn("100"), mo("·"), sup(mi("M"), mi("w")), mo("·"), sup(mi("E"), row(mn("1"), mo("−"), mi("w")))) +
      math(mi("M"), mo("="), mn("1"), mo("−"), sup(mi("e"), row(mo("−"), mn("2.7"), mi("r"))), gap, mi("E"), mo("="), mn("1"), mo("−"), sup(mi("e"), row(mo("−"), sup(paren(frac(mi("Z"), mn("1.7"))), mn("2.5"))))) +
      math(mi("w"), mo("="), mn("0.6"), sp, mt("for the Bulb,"), gap, mi("w"), mo("="), mn("0.3"), sp, mt("for the Bar,"), gap, mi("w"), mo("="), mn("0.45"), sp, mt("for the Box")) +
      `<p>M grows with closeness to the goal and E with rarity. Both are 0 for no difference or the wrong direction, so the score is 0 then; any positive result scores at least 1. Each score is stored with its session, as version ${SCORE_VERSION}, and never recomputed.</p><p>The Luck line shows 1 ÷ chance, rounded: “about 1 time in 20” means chance ≈ 0.05. It is how often luck alone does as well, not the chance that intention is at work.</p>`,
  },
  {
    id: "overall",
    icon: "trend",
    title: "Overall score",
    body: () =>
      `<p>Progress combines every session you started into one overall score. It asks the same two questions of all of them together: how close to the goals, and how rare is that?</p>${fig.pooled()}<p>It is not an average of your scores, so lucky sessions cannot pile up: with no real effect, playing more does not make it climb, while a steady lean keeps adding to it. It appears after three sessions. Each profile has its own.</p>`,
    detail:
      math(mi("T"), mo("="), paren(up("K"), mo("−"), mi("c"), up("N")), mo("−"), paren(down("K"), mo("−"), mi("c"), down("N"))) +
      math(mi("r"), mo("="), frac(row(mo("∑"), mn("2"), mi("T"), mo("/"), mt("goal")), row(mo("∑"), paren(up("N"), mo("+"), down("N")))), gap, mi("Z"), mo("="), sup(mi("Φ"), row(mo("−"), mn("1"))), paren(mn("1"), mo("−"), sub(mi("p"), mt("swap")))) +
      math(sub(mi("S"), mt("overall")), mo("="), mi("S"), paren(mi("r"), mo(","), mi("Z")), gap, mi("w"), mo("="), mn("0.45"), sp, mt("for all games together")) +
      `<p>T is a session's excess of 1s while aiming up over aiming down, in bits, or min(T, 0) for a session that ended early. c is the ones rate of all your bits, and the sums run over every session you started, so longer sessions and easier levels weigh more. p swap is the share of ways to swap the Up and Down labels within sessions, flipping the sign of each 2T/goal, that give at least the observed total: all of them up to 20 sessions, so with n sessions it cannot go below 1 in 2ⁿ, and 99,999 random ones above. Each game's own overall score uses that game's w.</p>`,
  },
  {
    id: "counts",
    icon: "checks",
    title: "Which sessions count",
    body: () =>
      `<p>Every session counts once its first part begins, even if you stop it or the device drops out.</p>${fig.counts()}<p>Dropping the sessions that go badly would make chance look like an effect, so stopping early can never help. Only finished sessions get a score of their own; those that ended early stay in History, marked.</p>`,
    detail: `<p>This is an intention-to-treat analysis. Each session counts as a sum of excess 1s, T, rather than a rate, so a short, lucky stretch cannot look large. A session that ended early counts as min(T, 0): dropping its shortfall would reward stopping when behind, and keeping its lead would reward stopping when ahead.</p><p>In simulations of 12 sessions under pure chance, players who stop when the first direction goes the wrong way would get a false result 34% of the time if only completed sessions counted; with this rule, 3.9%. No stopping strategy tried went above the 5% of a player who never stops.</p><p>The first Insights figures follow the same rule. The charts and comparisons look at completed sessions, with equal weights, a t interval and, from ten sessions, a whole-session bootstrap; they leave out any you excluded and, by default, any whose screen went out of view. They are exploratory: filters and repeated looks are not a fixed-endpoint test, and the bands are pointwise. A challenge, below, is the fixed-endpoint test: its sessions and settings are set in advance and judged once, by this same rule.</p><p>A gap over 2 seconds, a disconnected device, a storage failure or sleep ends an attempt. Block variance and adjacent-bit correlation describe the stream; they do not certify that it is random.</p>`,
  },
  {
    id: "challenge",
    icon: "flag",
    title: "Challenge",
    body: () =>
      `<p>A challenge is a promise made before you start. Choose a game, a level, a length and how many sessions to play: 5, 10 or 20. Then play them, whenever you like. The choices stay the same to the end, and every session you start counts, even one you stop early.</p><p>After the last session, the challenge gives one verdict on all of them together, worked out like the overall score. Everything was decided before the first session, so nothing can be picked out afterwards to make it look better. That makes a verdict the fairest answer the app gives.</p><p>You can give a challenge up. It is kept, marked as given up, with no verdict. Its sessions stay in History and count on Progress like any other.</p>`,
    detail:
      math(mi("p"), mo("≥"), frac(mn("1"), sup(mn("2"), mi("n")))) +
      `<p>The verdict is the overall score of the challenge's own sessions, with w for its game: every session it started, one that ended early counting as min(T, 0). Its seed follows those sessions, so a verdict never changes once given. The swap test is exact up to 20 sessions, so with n sessions chance cannot go below 1 in 2ⁿ: 1 in 32 for 5, 1 in 1,024 for 10, about 1 in a million for 20. A verdict at 1 in 1,000 takes at least 10 sessions.</p><p>The data source, the XOR mask and the display centre are fixed when the challenge starts, together with the game, level and length; a session that does not match is refused. One challenge runs at a time for each profile. Each session records its challenge, and Insights can filter and group by it. A challenge is a commitment kept on this computer, not an externally time-stamped preregistration.</p>`,
  },
  {
    id: "evidence",
    icon: "lens",
    title: "What would show a real effect",
    body: () =>
      `<p>A good session is a beginning. Chance alone reaches the ${BALANCED.label} goal 1 session in ${oneIn(BALANCED)}, so a real effect has to show up again and again, under rules set in advance.</p>${fig.steps()}<p>That takes many sessions. Progress adds them all up, and a Challenge sets the plan in advance and judges it at the end.</p>`,
    detail:
      math(mi("n"), mo("="), sup(paren(frac(row(sub(mi("z"), row(mn("1"), mo("−"), mi("α"))), mo("+"), sub(mi("z"), mn("0.8"))), mi("δ"))), mn("2"))) +
      `<p>What would count as evidence here:</p><ul class="evidence-list"><li>A fixed plan: the number of sessions, the game, the level and the length set before the first session, with every session started counted. A Challenge does this.</li><li>A strong result at the planned end: Z of at least 3.09, chance below 1 in 1,000, which takes at least 10 sessions. Filters and repeated looks find 1 in 20 often.</li><li>A replication: a second challenge agreeing in direction and size, ideally on another device.</li><li>The same direction in every game, with the XOR mask on, and no matching lean in the device's own ones rate under Data quality. Every started session counts, so stopping sessions early cannot produce it.</li></ul><p>How many sessions that takes: n above, where δ is the average Z a real effect would add to each session. If δ were 0.2, reaching 1 in 20 with 80% power would take about ${n80(0.05, 0.2)} sessions, and 1 in 1,000 about ${n80(0.001, 0.2)}.</p>`,
  },
];

let dialog, body, cleanup;
function render() {
  const lab = state.lab;
  cleanup?.();
  body.innerHTML =
    `<section class="guide-modes" aria-label="Simple and Lab"><p>Intention Lab has two modes. Switch between them at the top of the screen, at any time.</p><dl class="mode-list"><div><dt>${icon("feather")}Simple</dt><dd>The game, your scores and plain explanations.</dd></div><div><dt>${icon("flask")}Lab</dt><dd>The same app with the numbers behind it: measurements, equations, filters, exports and simulation.</dd></div></dl><div class="guide-mode-switch">${modeControl(lab)}<p class="fine">${lab ? "Each step below adds its equations and details under the plain explanation." : "In Lab, each step below also shows its equations and details."} Switching changes what you see, never what is measured.</p></div></section>` +
    TOPICS.map(
      (t) =>
        `<section class="guide-topic" id="guide-${t.id}" tabindex="-1" aria-labelledby="guide-h-${t.id}"><h3 id="guide-h-${t.id}">${icon(t.icon)}${t.title}</h3>${t.body()}${lab && t.detail ? `<div class="detail">${t.detail}</div>` : ""}</section>`,
    ).join("") +
    (lab
      ? `<p class="fine guide-versions">${state.bootstrap?.version ? `Intention Lab ${state.bootstrap.version}. ` : ""}Protocol ${VERSION}, statistics ${STATS}, score ${SCORE_VERSION}, interface ${PRESENTATION_VERSION}.</p>`
      : "");
  cleanup = fig.mount(body, lab);
}
export function openGuide(id = "session") {
  render();
  if (!dialog.open) dialog.showModal();
  const topic = id === "modes" ? body.firstElementChild : document.getElementById("guide-" + id) || body.firstElementChild;
  if (id === "session" || id === "modes") dialog.scrollTop = 0;
  else topic.scrollIntoView({ block: "start" });
  topic.focus({ preventScroll: true });
}
export function initGuide() {
  dialog = document.getElementById("guide");
  body = document.getElementById("guide-body");
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  // The live pictures stop when the guide closes.
  dialog.addEventListener("close", () => {
    cleanup?.();
    cleanup = null;
  });
  // A click on the dimmed backdrop lands on the dialog itself.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-guide]");
    if (!button) return;
    e.preventDefault();
    openGuide(button.dataset.guide);
  });
  onLayer(() => {
    if (!dialog.open) return;
    const top = dialog.scrollTop;
    render();
    dialog.scrollTop = top;
  });
}
