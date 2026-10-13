// The Bar: a needle meter, an ivory dial behind glass in a bakelite case. The
// black needle pivots at the left and swings up for more 1s and down for more
// 0s over an arc scale from +4 to −4 in quarters, with a mirror band inside it
// as on precision meters. It has weight: it overshoots a little, settles, and
// rests against a stop pin past either end of the scale. The red needle under
// it is the goal: during a part it moves out to where this direction's reading
// needs to be for the session to reach its goal, and between parts it rests at
// zero. The aim is to push the black needle past the red.
//
// With a voice attached (from startSound("Bar")), the meter sings its needle as
// drawn, closes its contact when the black needle reaches the red one in the
// direction asked from half way through a part, and ticks at the stop pins.
let instances = 0;
const PX = 62,
  PY = 280,
  R = 186,
  SPAN = 62,
  MAX = 4,
  STOP = SPAN + 5,
  W = 320,
  H = 560;
// A reading's angle on the dial: up is positive, 15.5° to a unit of Z.
export const needleAngle = (z) => (z * SPAN) / MAX;
// The needle's spring: its natural frequency (radians a second) and damping.
export const SPRING = Object.freeze({ w: 11, zeta: 0.55 });
const at = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return [PX + r * Math.cos(a), PY - r * Math.sin(a)];
  },
  minus = (s) => s.replace("-", "−"),
  f2 = (n) => n.toFixed(2);

// The meter's drawing, its ids prefixed so several meters can share a page.
function markup(p) {
  const arc = (r, a0, a1) => {
    const [x0, y0] = at(a0, r),
      [x1, y1] = at(a1, r);
    return `M${f2(x0)} ${f2(y0)} A${r} ${r} 0 0 1 ${f2(x1)} ${f2(y1)}`;
  };
  // The printed scale: mirror band, arcs, quarters, numbers, stop pins, legends.
  let scale = `<path d="${arc(R - 44, SPAN, -SPAN)}" fill="none" stroke="url(#${p}mirror)" stroke-width="6"/>`;
  scale += `<path d="${arc(R, SPAN, -SPAN)}" fill="none" stroke="#1d150c" stroke-width="1.3"/>`;
  scale += `<path d="${arc(R - 14, SPAN, -SPAN)}" fill="none" stroke="#1d150c" stroke-width="0.6" stroke-opacity="0.6"/>`;
  for (let k = -16; k <= 16; k++) {
    const z = k / 4,
      major = k % 4 === 0,
      half = k % 2 === 0,
      [x0, y0] = at(needleAngle(z), R - (major ? 14 : half ? 10 : 6)),
      [x1, y1] = at(needleAngle(z), R);
    scale += `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" stroke="#1d150c" stroke-width="${major ? 1.6 : half ? 1.1 : 0.7}"/>`;
    if (major) {
      const [tx, ty] = at(needleAngle(z), R - 27);
      scale += `<text x="${f2(tx)}" y="${f2(ty + 5)}" text-anchor="middle" font-family="Fraunces, serif" font-size="14" font-weight="520" fill="#1d150c">${z > 0 ? "+" + z : minus(String(z))}</text>`;
    }
  }
  for (const deg of [STOP, -STOP]) {
    const [x, y] = at(deg, R - 8);
    scale += `<circle cx="${f2(x)}" cy="${f2(y)}" r="2.6" fill="url(#${p}hubCap)" stroke="#3a2810" stroke-width="0.5"/>`;
  }
  const legend = (x, y, size, spacing, opacity, text) =>
    `<text x="${x}" y="${y}" font-family="Archivo, sans-serif" font-stretch="80%" font-weight="600" font-size="${size}" letter-spacing="${spacing}" fill="#1d150c" fill-opacity="${opacity}">${text}</text>`;
  scale += legend(160, 86, 8, 1.6, 0.7, "MORE 1s");
  scale += legend(160, 484, 8, 1.6, 0.7, "MORE 0s");
  // The unit, Z, is printed only in Lab mode, like every Z in the app.
  scale += `<text data-part="unit" x="104" y="262" font-family="Fraunces, serif" font-style="italic" font-size="20" fill="#1d150c" fill-opacity="0.75">Z</text>`;
  scale += legend(76, 318, 7, 1.8, 0.55, "INTENTION LAB");
  const screw = (x, y, turn) => `<use href="#${p}screwHead" transform="translate(${x} ${y}) rotate(${turn})"/>`;
  return `<svg class="meter-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
<defs>
<linearGradient id="${p}bakelite" x1="0" x2="1"><stop offset="0" stop-color="#0d0a08"/><stop offset=".16" stop-color="#211a15"/><stop offset=".5" stop-color="#171210"/><stop offset=".86" stop-color="#1e1813"/><stop offset="1" stop-color="#0b0807"/></linearGradient>
<radialGradient id="${p}dial" cx=".32" cy=".3" r="1"><stop offset="0" stop-color="#f6eedb"/><stop offset=".55" stop-color="#e6d9bb"/><stop offset="1" stop-color="#c6b48f"/></radialGradient>
<linearGradient id="${p}nickel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1efe9"/><stop offset=".4" stop-color="#a7a49c"/><stop offset=".75" stop-color="#5f5c56"/><stop offset="1" stop-color="#2c2a27"/></linearGradient>
<radialGradient id="${p}screw" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#f4f2ec"/><stop offset=".6" stop-color="#8f8c85"/><stop offset="1" stop-color="#3a3834"/></radialGradient>
<radialGradient id="${p}hub" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#5b5550"/><stop offset=".6" stop-color="#1a1715"/><stop offset="1" stop-color="#050404"/></radialGradient>
<radialGradient id="${p}hubCap" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#f6e2aa"/><stop offset=".6" stop-color="#a77f3d"/><stop offset="1" stop-color="#4a3413"/></radialGradient>
<linearGradient id="${p}mirror" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c5a55"/><stop offset=".3" stop-color="#e4e2dc"/><stop offset=".5" stop-color="#8d8b86"/><stop offset=".75" stop-color="#eeece6"/><stop offset="1" stop-color="#5a5955"/></linearGradient>
<linearGradient id="${p}glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".3" stop-color="#fff" stop-opacity=".03"/><stop offset=".34" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
<linearGradient id="${p}dialShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a14" stop-opacity=".35"/><stop offset=".12" stop-color="#3a2a14" stop-opacity="0"/><stop offset=".88" stop-color="#3a2a14" stop-opacity="0"/><stop offset="1" stop-color="#3a2a14" stop-opacity=".4"/></linearGradient>
<filter id="${p}paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 .36  0 0 0 0 .3  0 0 0 0 .2  0 0 0 .1 0"/></filter>
<filter id="${p}needleShadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>
<clipPath id="${p}clipDial"><rect x="40" y="40" width="240" height="480" rx="8"/></clipPath>
<g id="${p}screwHead"><circle r="6" fill="url(#${p}screw)"/><line x1="-4.2" x2="4.2" stroke="#26241f" stroke-width="1.5"/></g>
</defs>
<rect x="10" y="10" width="300" height="540" rx="20" fill="url(#${p}bakelite)"/>
<rect x="10.5" y="10.5" width="299" height="539" rx="19.5" fill="none" stroke="rgba(255,236,210,.09)"/>
${screw(30, 30, 28)}${screw(290, 30, -40)}${screw(30, 530, 62)}${screw(290, 530, 12)}
<rect x="34" y="34" width="252" height="492" rx="12" fill="#050403"/>
<g clip-path="url(#${p}clipDial)">
<rect x="40" y="40" width="240" height="480" fill="url(#${p}dial)"/>
<rect x="40" y="40" width="240" height="480" filter="url(#${p}paper)"/>
<g>${scale}</g>
<g data-part="red-shadow" opacity=".3" filter="url(#${p}needleShadow)"><path d="M-14 0L0 -2.4 L176 -0.5 L178 0 L176 0.5 L0 2.4z" fill="#000"/></g>
<g data-part="red"><path d="M-14 0L0 -2.2 L176 -0.45 L179 0 L176 0.45 L0 2.2z" fill="#b02a1b"/><path d="M0 -1.3 L170 -0.25" stroke="#ffd2c4" stroke-opacity=".35" stroke-width=".6"/></g>
<g data-part="needle-shadow" opacity=".38" filter="url(#${p}needleShadow)"><path d="M-14 0L0 -2.6 L180 -0.5 L182 0 L180 0.5 L0 2.6z" fill="#000"/></g>
<g data-part="needle"><rect x="-20" y="-4.5" width="11" height="9" rx="2" fill="#1a1512"/><path d="M-14 0L0 -2.3 L180 -0.4 L183 0 L180 0.4 L0 2.3z" fill="#16110c"/><path d="M0 -1.4 L174 -0.25" stroke="#fff" stroke-opacity=".18" stroke-width=".6"/></g>
<circle cx="${PX}" cy="${PY}" r="12" fill="url(#${p}hub)"/>
<circle cx="${PX}" cy="${PY}" r="5" fill="url(#${p}hubCap)"/>
<rect x="40" y="40" width="240" height="480" fill="url(#${p}dialShade)"/>
</g>
<rect x="37" y="37" width="246" height="486" rx="10" fill="none" stroke="url(#${p}nickel)" stroke-width="5"/>
<rect x="39.5" y="39.5" width="241" height="481" rx="8.5" fill="none" stroke="#000" stroke-opacity=".55"/>
<rect x="40" y="40" width="240" height="480" rx="8" fill="url(#${p}glass)" pointer-events="none"/>
<path d="M52 60 Q60 44 92 44" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

export function createBar(host, options = {}) {
  const p = "meter" + ++instances + "-",
    o = { light: host, lab: false, voice: null, ...options };
  host.classList.add("meter");
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", options.label || "Bar meter");
  host.insertAdjacentHTML("afterbegin", markup(p));
  const svg = host.querySelector(".meter-svg"),
    part = (name) => svg.querySelector(`[data-part="${name}"]`),
    needle = part("needle"),
    needleShadow = part("needle-shadow"),
    red = part("red"),
    redShadow = part("red-shadow"),
    unit = part("unit");
  unit.setAttribute("display", o.lab ? "inline" : "none");
  // target: the reading's Z (zero at rest). goalTo: where the red needle is
  // going. kind: the direction of the running part, from the goal's sign.
  let target = 0,
    resting = true,
    goalTo = 0,
    showGoal = true,
    progress = null,
    kind = null,
    deg = 0,
    speed = 0,
    goalAt = 0,
    armed = true,
    armedFor = null,
    lastPin = 0,
    frame = 0,
    last = 0,
    destroyed = false;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    aim = () => Math.max(-STOP, Math.min(STOP, needleAngle(target)));

  function paint() {
    const turn = f2(-deg),
      redTurn = f2(-needleAngle(goalAt));
    needle.setAttribute("transform", `translate(${PX} ${PY}) rotate(${turn})`);
    needleShadow.setAttribute("transform", `translate(${PX + 2.5} ${PY + 4}) rotate(${turn})`);
    red.setAttribute("transform", `translate(${PX} ${PY}) rotate(${redTurn})`);
    redShadow.setAttribute("transform", `translate(${PX + 2} ${PY + 3}) rotate(${redTurn})`);
    red.setAttribute("display", showGoal ? "inline" : "none");
    redShadow.setAttribute("display", showGoal ? "inline" : "none");
    // The dial lamp lights the room around the meter, a little more in a part.
    if (o.light) {
      o.light.style.setProperty("--lamp", "255 196 130");
      o.light.style.setProperty("--lamp-glow", resting ? "0.18" : "0.26");
      const r = svg.getBoundingClientRect(),
        hr = o.light.getBoundingClientRect();
      if (r.height && hr.height) {
        const k = Math.min(r.width / W, r.height / H),
          y = r.top + (r.height - H * k) / 2 + PY * k;
        o.light.style.setProperty("--lamp-y", (((y - hr.top) / hr.height) * 100).toFixed(2) + "%");
      }
    }
  }
  // The needle as drawn sings; reaching the red needle the way the part asks
  // closes the contact from half way through it, and the contact rearms once
  // the needle has fallen 0.25 back. Before half way chance alone puts the
  // needle past the red one more than a third of the time, so a crossing is not heard.
  function listen() {
    const shown = (deg * MAX) / SPAN;
    o.voice?.follow(shown, !resting);
    if (kind !== armedFor) {
      armedFor = kind;
      armed = true;
    }
    if (!kind || !showGoal) return;
    const sign = kind === "Up" ? 1 : -1,
      reading = sign * shown,
      mark = sign * goalAt;
    if (reading >= mark && armed) {
      armed = false;
      if ((progress ?? 1) >= 0.5) o.voice?.contact();
    } else if (reading < mark - 0.25) armed = true;
  }
  // The needle has weight: a damped spring, stopped by the pins. Small steps
  // keep it steady at any frame rate.
  function step(dt) {
    const to = aim(),
      { w, zeta } = SPRING;
    for (let i = 0, n = Math.ceil(dt / 0.004); i < n; i++) {
      const h = dt / n;
      speed += (w * w * (to - deg) - 2 * zeta * w * speed) * h;
      deg += speed * h;
      if (Math.abs(deg) > STOP) {
        deg = Math.sign(deg) * STOP;
        // A tick against the pin, if it arrived with any speed.
        if (Math.abs(speed) > 20 && performance.now() - lastPin > 200) {
          lastPin = performance.now();
          o.voice?.pin();
        }
        speed *= -0.25;
      }
    }
    goalAt += (goalTo - goalAt) * (1 - Math.exp(-dt / 0.22));
  }
  const settled = () => Math.abs(deg - aim()) < 0.02 && Math.abs(speed) < 0.05 && Math.abs(goalAt - goalTo) < 0.001;
  function rest() {
    deg = aim();
    speed = 0;
    goalAt = goalTo;
  }
  function animate(time) {
    frame = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 1 / 60;
    last = time;
    step(dt);
    const done = settled();
    if (done) rest();
    paint();
    listen();
    if (done) last = 0;
    else frame = requestAnimationFrame(animate);
  }
  function wake() {
    if (destroyed) return;
    if (reduced()) {
      cancelAnimationFrame(frame);
      frame = 0;
      rest();
      paint();
      listen();
    } else if (!frame) frame = requestAnimationFrame(animate);
  }
  paint();
  return {
    // z: the signed reading, null at rest; zGoal: the signed goal (positive
    // while asking for 1s); progress: the elapsed share of the part, null when
    // unknown.
    set(z, zGoal = null, { showGoal: show = true, rest: still = false, label, progress: f = null } = {}) {
      resting = still || z == null || !Number.isFinite(z);
      target = resting ? 0 : z;
      const g = !resting && zGoal != null && Number.isFinite(zGoal) ? zGoal : null;
      kind = resting ? null : g ? (g > 0 ? "Up" : "Down") : kind;
      goalTo = g ?? 0;
      showGoal = !!show;
      progress = Number.isFinite(f) ? f : null;
      if (label) host.setAttribute("aria-label", label);
      wake();
    },
    // Straight to a reading, without the swing.
    snap(z = 0) {
      target = z ?? 0;
      rest();
      paint();
    },
    setLab(lab) {
      o.lab = lab;
      unit.setAttribute("display", lab ? "inline" : "none");
    },
    // The meter's voice from startSound("Bar"), or null for silence.
    setVoice(voice) {
      o.voice = voice;
      wake();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      svg.remove();
    },
  };
}
