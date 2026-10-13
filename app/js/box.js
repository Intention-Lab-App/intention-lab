// The Box: a walnut case with an engraved ebonite panel, under a lamp. Two
// brass latches hold its lid, and a red wax seal over a ribbon sits on the join.
// Nothing on it answers while you play: it is sealed until the session ends.
// The Ask knob points to 1 or 0 for the part that is running and turns over in
// the pause between parts; the Level knob shows the session's level. At the end
// the latches flip down, the seal cracks along the join and the lid swings up
// on its hinge. Inside, layers of brass ones and zeros catch the light, and the
// recorder built into the lid shows what it wrote while the box was sealed: the
// running Z of each part in violet ink, with what each part asked for typed
// under it and the needle resting where the record ends.
//
// Dust drifts and glints in the lamp's light, rising slowly in its warmth. It
// runs on the page's own clock and random source, never on the device's bits.
let instances = 0;

// --- The view ---------------------------------------------------------------
// A camera well back and a little above, looking down at about 28°, its picture
// plane parallel to the front of the box: the front is drawn flat and the top
// recedes gently. x from the middle, y up from the floor, z back from the
// front, all in the drawing's units.
const ZC = 3000,
  YC = 1709,
  Y0 = 452 - YC,
  D = 100,
  HINGE = 182,
  OPEN = (104 * Math.PI) / 180,
  LATCH = (176 * Math.PI) / 180,
  W = 640,
  H = 492,
  LAMP = [320, 45];
const project = (x, y, z) => {
    const k = ZC / (z + ZC);
    return [320 + x * k, Y0 - (y - YC) * k];
  },
  // A point of the closed lid, turned on the hinge at the back of the top.
  turn = ([x, y, z], a) => {
    const dy = y - HINGE,
      dz = z - D,
      c = Math.cos(a),
      s = Math.sin(a);
    return [x, HINGE + dy * c - dz * s, D + dy * s + dz * c];
  },
  // Anything on the front of the closed box, back to the model.
  front = (sx, sy, z = 0) => [sx - 320, 452 - sy, z],
  points = (list) => list.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "),
  path = (list) => "M" + list.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(" L"),
  area = (list) => list.reduce((s, p, i) => s + p[0] * list[(i + 1) % list.length][1] - list[(i + 1) % list.length][0] * p[1], 0) / 2,
  // An affine map from a flat rectangle (w by h) to three projected corners.
  affine = (p0, p1, p3, w, h) =>
    `matrix(${((p1[0] - p0[0]) / w).toFixed(5)} ${((p1[1] - p0[1]) / w).toFixed(5)} ${((p3[0] - p0[0]) / h).toFixed(5)} ${((p3[1] - p0[1]) / h).toFixed(5)} ${p0[0].toFixed(3)} ${p0[1].toFixed(3)})`,
  quad = (x0, x1, z0, z1, y) => [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ];
// A small seeded generator (xorshift), for the pile and the dust.
function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// --- The lid's faces and the latches, in the model -----------------------------
const FT = (x) => [x, 208, 0],
  BT = (x) => [x, 208, D],
  FB = (x) => [x, HINGE, 0],
  BB = (x) => [x, HINGE, D],
  FACES = {
    top: [BT(-170), BT(170), FT(170), FT(-170)],
    band: [FT(-170), FT(170), FB(170), FB(-170)],
    under: [FB(-170), FB(170), BB(170), BB(-170)],
  },
  LATCHES = [208, 432],
  PIVOT = 452 - 284.2,
  flip = ([x, y, z], a) => {
    const dy = y - PIVOT,
      dz = z + 2,
      c = Math.cos(a),
      s = Math.sin(a);
    return [x, PIVOT + dy * c + dz * s, -2 - dy * s + dz * c];
  };

// --- The recorder in the lid ---------------------------------------------------
// Drawn flat on a 320 by 86 plate and laid onto the underside of the lid. Paper
// runs from the blank roll on the right, under the needle, to the written roll
// on the left, so time reads left to right and the needle rests where the record
// ends. The grid sits in the middle of the paper, its zero line level with the
// needle's pivot, and the typed words sit in the margin below it, where the
// trace never goes.
const REC = { x0: -160, z0: 7, w: 320, h: 86 },
  recAt = (u, v) => [REC.x0 + u, HINGE, REC.z0 + v],
  PAPER = { u0: 41, u1: 279, v0: 10, v1: 76 },
  ZERO_V = (PAPER.v0 + PAPER.v1) / 2,
  UNIT_V = 5.8,
  WORDS_V = ZERO_V + 4 * UNIT_V + 4.8,
  PEN = { u: 301, v: ZERO_V, arm: 42 },
  // Where each part is written on the finished record, before the needle.
  SPANS = [
    [PAPER.u0 + 6, 150],
    [158, null],
  ],
  traceV = (z) => ZERO_V - Math.max(-3.9, Math.min(3.9, z)) * UNIT_V,
  // The needle swings on its pivot, so its point draws an arc.
  tipU = (v) => PEN.u - Math.sqrt(PEN.arm ** 2 - (v - PEN.v) ** 2);

// The record of a finished session, from its 250 ms buckets: each part's
// running Z against the share of the part gone by.
export function boxRecord(session, buckets) {
  return {
    parts: [...session.phases]
      .filter((p) => p.kind === "Up" || p.kind === "Down")
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((p) => ({
        kind: p.kind,
        points: buckets
          .filter((b) => b.phaseOrdinal === p.ordinal && Number.isFinite(b.zLive))
          .sort((a, b) => a.end - b.end)
          .map((b) => [Math.max(0, Math.min(1, (b.end - p.start) / (p.end - p.start))), b.zLive]),
      })),
  };
}

// --- The pile and the grain, painted once for every box ---------------------------
// Brass numerals lying face up in layers, each with its edge and a soft shadow
// on what it rests on. Deeper layers get less of the lamp, the top one heaps a
// little in the middle, and the front wall hides the nearest pieces. Painted at
// four times the resolution.
const PILE = { x: 146, y: 212, w: 348, h: 62 };
let pile = null;
function paintPile() {
  return (pile ??= document.fonts
    .load("620 13px Fraunces")
    .catch(() => {})
    .then(() => {
      const S = 4,
        canvas = document.createElement("canvas");
      canvas.width = PILE.w * S;
      canvas.height = PILE.h * S;
      const g = canvas.getContext("2d"),
        base = () => g.setTransform(S, 0, 0, S, -PILE.x * S, -PILE.y * S),
        fill = (list, style) => {
          base();
          g.beginPath();
          list.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.closePath();
          g.fillStyle = style;
          g.fill();
        },
        P = (x, y, z) => project(x, y, z);
      // The velvet inside, above the pile: the back wall and the two sides.
      fill(quad(-170, 170, 0, D, HINGE).map((p) => P(...p)), "#0b0604");
      base();
      const wall = g.createLinearGradient(0, P(0, HINGE, D - 6)[1], 0, P(0, 160, D - 6)[1]);
      wall.addColorStop(0, "#3d151a");
      wall.addColorStop(1, "#120508");
      fill([P(-164, HINGE, D - 6), P(164, HINGE, D - 6), P(164, 160, D - 6), P(-164, 160, D - 6)], wall);
      fill([P(-164, HINGE, 6), P(-164, HINGE, D - 6), P(-164, 160, D - 6), P(-164, 160, 6)], "#1d070b");
      fill([P(164, HINGE, 6), P(164, HINGE, D - 6), P(164, 160, D - 6), P(164, 160, 6)], "#1d070b");
      const r = rng(42),
        LAYERS = [
          { y: 166.5, light: 0.26 },
          { y: 169.5, light: 0.36 },
          { y: 172.5, light: 0.52 },
          { y: 175.5, light: 0.72 },
          { y: 178, light: 1 },
        ];
      g.font = "620 13px Fraunces";
      g.textAlign = "center";
      g.textBaseline = "middle";
      LAYERS.forEach((layer, li) => {
        const pieces = [],
          top = li === LAYERS.length - 1;
        for (let z = D - 9; z >= 6; z -= 8.4)
          for (let x = -159; x <= 159; x += 10) {
            if (r() < (top ? 0.3 : 0.18)) continue;
            const jx = x + (r() - 0.5) * 7,
              jz = z + (r() - 0.5) * 5,
              heap = Math.max(0, 1 - (jx / 178) ** 2) * Math.max(0, 1 - ((jz - 48) / 62) ** 2);
            pieces.push({ x: jx, y: layer.y + heap * (top ? 2.6 : li * 0.5) + (r() - 0.5) * 0.8, z: jz, turn: ((r() - 0.5) * 56 * Math.PI) / 180, digit: r() < 0.5 ? "0" : "1", tone: 0.82 + r() * 0.32 });
          }
        // Back to front, so each piece lies over what is behind and below it.
        pieces.sort((p, q) => q.z - p.z);
        for (const p of pieces) {
          const [sx, sy] = P(p.x, p.y, p.z),
            k = ZC / (p.z + ZC),
            squash = ((YC - p.y) * ZC) / (p.z + ZC) ** 2,
            lamp = 0.42 + 0.58 * Math.max(0, 1 - ((p.x / 215) ** 2 + ((p.z - 42) / 125) ** 2)),
            nearWall = Math.min(1, Math.min(164 - Math.abs(p.x), D - 6 - p.z) / 26),
            light = layer.light * lamp * (0.5 + 0.5 * Math.max(0, nearWall)) * p.tone,
            put = (dy) => {
              base();
              g.translate(sx, sy + dy);
              g.scale(k, squash);
              g.rotate(p.turn);
            },
            rgb = (c) => `rgb(${c.map((v) => Math.round(Math.min(255, v * light))).join(",")})`;
          // The edge, with the shadow it throws on the pieces beneath.
          g.shadowColor = "rgba(0,0,0,0.65)";
          g.shadowBlur = 2.6 * S;
          g.shadowOffsetY = 1.4 * S;
          put(2.3 * k);
          g.fillStyle = rgb([84, 58, 26]);
          g.fillText(p.digit, 0, 0);
          g.shadowColor = "transparent";
          for (const dy of [1.6, 0.8]) {
            put(dy * k);
            g.fillStyle = rgb([104, 72, 32]);
            g.fillText(p.digit, 0, 0);
          }
          // The face, lit from above.
          put(0);
          g.fillStyle = rgb([246, 204, 132]);
          g.fillText(p.digit, 0, 0);
        }
      });
      return canvas.toDataURL();
    }));
}
// A faint grain: random greys at about 3% so it is never seen, only felt, as it
// breaks up the banding that dark gradients show on most screens.
let grain = null;
function grainTile() {
  if (grain) return grain;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 160;
  const g = tile.getContext("2d"),
    img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 7;
  }
  g.putImageData(img, 0, 0);
  return (grain = `url(${tile.toDataURL()})`);
}

// --- The drawing ------------------------------------------------------------------
// Its ids are prefixed so that several boxes can share a page.
function markup(p) {
  const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a === 1 ? "" : ` stop-opacity="${a}"`}/>`).join(""),
    linear = (id, [x1, y1, x2, y2], list) => `<linearGradient id="${p}${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`,
    radial = (id, attrs, list) => `<radialGradient id="${p}${id}" ${attrs}>${stops(list)}</radialGradient>`,
    // The lamp's pool on the floor falls off as the inverse square of the distance.
    pool = [0.24, 0.226, 0.1916, 0.1516, 0.1156, 0.0866, 0.0644, 0.0476, 0.0349, 0.0252, 0.0176, 0.0117, 0.0069, 0.0031, 0].map((a, i) => [(i / 14).toFixed(3), "#ffb464", a]),
    screw = (x, y) => `<use href="#${p}screwHead" x="${x}" y="${y}"/>`,
    panelScrew = (x, y) => `<use href="#${p}panelScrew" x="${x}" y="${y}"/>`,
    small = (x, y, text, opacity = 0.55, size = 6.2, spacing = 1.8) =>
      `<text x="${x}" y="${y}" text-anchor="middle" font-family="Archivo, sans-serif" font-stretch="80%" font-weight="600" font-size="${size}" letter-spacing="${spacing}" fill="#efe6d6" fill-opacity="${opacity}">${text}</text>`;
  return `<svg class="box-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<defs>
${radial("pool", 'cx=".5" cy=".5" r=".5"', pool)}
${linear("shade", [0, 0, 1, 0], [[0, "#0d1210"], [0.45, "#2a332d"], [1, "#0a0d0b"]])}
${linear("woodFront", [0, 0, 0, 1], [[0, "#55331c"], [0.5, "#3b2213"], [1, "#211208"]])}
${linear("woodBand", [0, 0, 0, 1], [[0, "#704828"], [1, "#3f2515"]])}
${linear("woodTop", [0, 0, 0, 1], [[0, "#3a2312"], [1, "#7a522f"]])}
${linear("woodUnder", [0, 0, 0, 1], [[0, "#3a2212"], [1, "#22140a"]])}
${linear("sides", [0, 0, 1, 0], [[0, "#000", 0.55], [0.2, "#000", 0], [0.8, "#000", 0], [1, "#000", 0.6]])}
${linear("brass", [0, 0, 0, 1], [[0, "#efd08e"], [0.35, "#b78c47"], [0.72, "#7a5826"], [1, "#3e2b12"]])}
${linear("brassLever", [0, 0, 1, 0], [[0, "#9a7436"], [0.35, "#f1d58f"], [0.6, "#c49a52"], [1, "#6e4f20"]])}
${linear("brassBack", [0, 0, 0, 1], [[0, "#8a6630"], [1, "#3a2810"]])}
${linear("nickel", [0, 0, 1, 1], [[0, "#f1efe9"], [0.4, "#a7a49c"], [0.75, "#5f5c56"], [1, "#2c2a27"]])}
${linear("pin", [0, 0, 0, 1], [[0, "#f1efe9"], [0.5, "#8f8c85"], [1, "#3a3834"]])}
${radial("nickelScrew", 'cx=".38" cy=".32" r=".75"', [[0, "#f4f2ec"], [0.6, "#8f8c85"], [1, "#3a3834"]])}
${linear("ebonite", [0, 0, 0, 1], [[0, "#1d1a17"], [0.5, "#121010"], [1, "#0a0908"]])}
${linear("engraved", [0, 0, 0, 1], [[0, "#f6efe2"], [1, "#cfc4b2"]])}
${radial("knob", 'cx=".4" cy=".32" r=".8"', [[0, "#4a4541"], [0.55, "#1b1917"], [1, "#060505"]])}
${radial("knobCap", 'cx=".42" cy=".35" r=".7"', [[0, "#5a544f"], [0.6, "#211e1c"], [1, "#0d0c0b"]])}
${radial("screw", "", [[0, "#ead09a"], [0.7, "#8a6630"], [1, "#3a2810"]])}
${radial("wax", 'cx=".36" cy=".3" r=".8"', [[0, "#dc5a3e"], [0.55, "#9e2c1d"], [1, "#54110a"]])}
${linear("velvet", [0, 1, 0, 0], [[0, "#4a1a1c"], [1, "#1c080a"]])}
${linear("liningLight", [0, 0, 0, 1], [[0, "#ffd2a0", 0.14], [1, "#ffd2a0", 0]])}
${radial("hub", 'cx=".38" cy=".32" r=".8"', [[0, "#5b5550"], [0.6, "#1a1715"], [1, "#050404"]])}
${linear("roll", [0, 0, 1, 0], [[0, "#7d6d52"], [0.38, "#f3e9d2"], [0.7, "#cdbc98"], [1, "#5f5240"]])}
${linear("chart", [0, 0, 0, 1], [[0, "#f4ead2"], [1, "#e6d8b8"]])}
${linear("insideShade", [0, 0, 0, 1], [[0, "#000", 0.75], [0.45, "#000", 0.18], [1, "#000", 0.05]])}
${linear("insideSides", [0, 0, 1, 0], [[0, "#000", 0.6], [0.14, "#000", 0], [0.86, "#000", 0], [1, "#000", 0.6]])}
${linear("beamCore", [0, 0, 1, 0], [[0, "#ffd9a8", 0], [0.5, "#ffe6c2", 0.34], [1, "#ffd9a8", 0]])}
${linear("beamFadeGrad", [0, 0, 0, 1], [[0, "#fff"], [0.6, "#fff", 0.55], [0.88, "#fff", 0.24], [1, "#fff", 0]])}
${radial("bulbGlow", "", [[0, "#fff3d8", 0.7], [0.4, "#ffd9a8", 0.25], [1, "#ffc98c", 0]])}
<filter id="${p}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0035 .14" numOctaves="4" seed="11"/><feColorMatrix values="0 0 0 0 .04  0 0 0 0 .02  0 0 0 0 .008  1.7 0 0 0 -.66"/></filter>
<filter id="${p}grainLight" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".005 .09" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 .62  0 0 0 0 .4  0 0 0 0 .22  1.3 0 0 0 -.72"/></filter>
<filter id="${p}soft1"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="${p}soft3" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="${p}soft6" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="${p}soft12" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="12"/></filter>
<mask id="${p}beamFade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#${p}beamFadeGrad)"/></mask>
<clipPath id="${p}clipBody"><rect x="150" y="270" width="340" height="182"/></clipPath>
<clipPath id="${p}clipOpening"><polygon data-part="openingClip"/></clipPath>
<clipPath id="${p}clipTop"><polygon data-part="topClip"/></clipPath>
<clipPath id="${p}clipBand"><polygon data-part="bandClip"/></clipPath>
<clipPath id="${p}clipPaper"><rect x="${PAPER.u0}" y="${PAPER.v0}" width="${PAPER.u1 - PAPER.u0}" height="${PAPER.v1 - PAPER.v0}"/></clipPath>
<clipPath id="${p}sealLow"><polygon points="302,270.6 306,268.8 309.5,271.4 313,269 316.5,271.3 320,268.7 323.5,271.1 327,269.1 330.5,271 334,269.4 338,270.4 338,310 302,310"/></clipPath>
<clipPath id="${p}sealHigh"><polygon points="302,270.6 306,268.8 309.5,271.4 313,269 316.5,271.3 320,268.7 323.5,271.1 327,269.1 330.5,271 334,269.4 338,270.4 338,240 302,240"/></clipPath>
<g id="${p}screwHead"><circle r="2.4" fill="url(#${p}screw)"/><line x1="-1.6" x2="1.6" stroke="#2a1c0a" stroke-width=".8"/></g>
<g id="${p}panelScrew"><circle r="2.6" fill="url(#${p}nickelScrew)"/><line x1="-1.8" x2="1.8" stroke="#2a2825" stroke-width=".8" transform="rotate(35)"/></g>
<g id="${p}ribbonArt"><path d="M314.5 247v52l3-4.5 3 4.5v-52z" fill="#7f1e13" transform="rotate(-6 317 271)"/><path d="M320.5 247v52l3-4.5 3 4.5v-52z" fill="#a83b26" transform="rotate(6 323 271)"/></g>
<g id="${p}sealArt">
<path transform="translate(320 271) scale(1.02) translate(-232 -280)" d="M232 265c5-1 9 2 11 5 4 1 5 6 3 9 2 4 0 8-4 9-1 4-6 6-10 4-4 2-9 0-10-4-4-1-6-6-4-9-2-4 1-8 5-9 1-3 5-6 9-5z" fill="#000" opacity=".38" filter="url(#${p}soft1)"/>
<path transform="translate(320 270) scale(1.02) translate(-232 -280)" d="M232 265c5-1 9 2 11 5 4 1 5 6 3 9 2 4 0 8-4 9-1 4-6 6-10 4-4 2-9 0-10-4-4-1-6-6-4-9-2-4 1-8 5-9 1-3 5-6 9-5z" fill="url(#${p}wax)"/>
<circle cx="320" cy="270.5" r="8.6" fill="none" stroke="#5a130b" stroke-opacity=".65" stroke-width="1.2"/>
<text x="320" y="274.2" text-anchor="middle" font-family="Fraunces, serif" font-size="9.5" font-weight="600" fill="#5a130b" fill-opacity=".78">IL</text>
<path d="M313.5 261c2-2 6-3 9-2" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.3" stroke-linecap="round"/>
</g>
</defs>
<ellipse cx="320" cy="478" rx="420" ry="46" fill="url(#${p}pool)"/>
<g mask="url(#${p}beamFade)">
<polygon points="282,44 358,44 650,492 -10,492" fill="url(#${p}beamCore)" opacity=".55" filter="url(#${p}soft12)"/>
<polygon points="294,44 346,44 505,492 135,492" fill="url(#${p}beamCore)" opacity=".8" filter="url(#${p}soft6)"/>
</g>
<g data-part="motes-back"></g>
<line x1="320" y1="-20" x2="320" y2="18" stroke="#1a1512" stroke-width="2"/>
<path d="M308 16h24l3 6c14 4 24 12 28 22q-43 9-86 0c4-10 14-18 28-22z" fill="url(#${p}shade)"/>
<path d="M277 44q43 9 86 0" fill="none" stroke="#56635a" stroke-width="1.2" stroke-opacity=".8"/>
<ellipse cx="320" cy="45" rx="42" ry="5.4" fill="#efe6d2" opacity=".92"/>
<ellipse cx="320" cy="45.4" rx="27" ry="3.8" fill="#fff6e2" filter="url(#${p}soft3)"/>
<ellipse cx="320" cy="48" rx="70" ry="13" fill="url(#${p}bulbGlow)"/>
<ellipse cx="320" cy="474" rx="214" ry="9" fill="#000" opacity=".8" filter="url(#${p}soft3)"/>
<g>
<polygon data-part="opening" fill="#0d0805"/>
<g clip-path="url(#${p}clipOpening)">
<image data-part="pile" x="${PILE.x}" y="${PILE.y}" width="${PILE.w}" height="${PILE.h}" preserveAspectRatio="none"/>
<polygon data-part="openingShade" fill="url(#${p}insideShade)" opacity=".45"/>
<polygon data-part="openingSides" fill="url(#${p}insideSides)"/>
</g>
<polygon data-part="rimBack" fill="#4a2e19"/>
<polygon data-part="rimFront" fill="#7f522f"/>
<polygon data-part="rimLeft" fill="#5e3b20"/>
<polygon data-part="rimRight" fill="#5e3b20"/>
</g>
<polygon data-part="plinth" fill="#1a0f08"/>
<g>
<rect x="150" y="270" width="340" height="182" fill="url(#${p}woodFront)"/>
<rect x="150" y="270" width="340" height="182" filter="url(#${p}grain)" clip-path="url(#${p}clipBody)"/>
<rect x="150" y="270" width="340" height="182" filter="url(#${p}grainLight)" opacity=".45" clip-path="url(#${p}clipBody)"/>
<rect x="150" y="270" width="340" height="182" fill="url(#${p}sides)"/>
<path d="M150 452h26v-7h-19v-20h-7z M490 452h-26v-7h19v-20h7z" fill="url(#${p}brass)"/>
<path d="M150 270h7v24h-7z M490 270h-7v24h7z" fill="url(#${p}brass)"/>
${screw(153.5, 438)}${screw(168, 448.5)}${screw(486.5, 438)}${screw(472, 448.5)}${screw(153.5, 284)}${screw(486.5, 284)}
<rect x="166" y="318" width="308" height="120" rx="4" fill="#0b0705" opacity=".7"/>
<rect x="168" y="320" width="304" height="116" rx="3" fill="url(#${p}ebonite)"/>
<rect x="168" y="320" width="304" height="116" rx="3" fill="none" stroke="url(#${p}nickel)" stroke-width="2.2"/>
<rect x="173" y="325" width="294" height="106" rx="2" fill="none" stroke="#fff" stroke-opacity=".06"/>
${panelScrew(177, 329)}${panelScrew(463, 329)}${panelScrew(177, 427)}${panelScrew(463, 427)}
<text x="320" y="351" text-anchor="middle" font-family="Fraunces, serif" font-size="19" font-weight="460" letter-spacing="3.6" fill="url(#${p}engraved)">SCHRÖDINGER BOX</text>
${small(320, 364, "INTENTION LAB · Nº 3", 0.45, 6.2, 2.2)}
<line x1="190" x2="450" y1="372" y2="372" stroke="#efe6d6" stroke-opacity=".16"/>
${small(236, 395, "CONTENTS", 0.55, 6.6, 1.8)}
<text x="236" y="409" text-anchor="middle" font-family="Fraunces, serif" font-size="10.5" letter-spacing="1.4" fill="#efe6d6" fill-opacity=".88">ONES &amp; ZEROS</text>
<line x1="300" x2="300" y1="382" y2="424" stroke="#efe6d6" stroke-opacity=".16"/>
<g data-part="dial-ask" transform="translate(352 402)"></g>
<g data-part="dial-level" transform="translate(424 402)"></g>
${small(352, 429, "ASK")}${small(424, 429, "LEVEL")}
<g data-part="latch-bases"></g>
<line data-part="seam" x1="150" y1="270" x2="490" y2="270" stroke="#120904" stroke-width="1.3"/>
<g data-part="seal-low" display="none"><use href="#${p}ribbonArt" clip-path="url(#${p}sealLow)"/><use href="#${p}sealArt" clip-path="url(#${p}sealLow)"/></g>
</g>
<g>
<g data-part="top-face">
<polygon data-part="top" fill="url(#${p}woodTop)"/>
<rect x="120" y="60" width="400" height="230" filter="url(#${p}grain)" opacity=".85" clip-path="url(#${p}clipTop)"/>
<g data-part="top-parts"></g>
<path data-part="top-edge" fill="none" stroke="#ffd9a8" stroke-opacity=".32"/>
</g>
<g data-part="under-face">
<polygon data-part="under" fill="url(#${p}woodUnder)"/>
<polygon data-part="velvet-in" fill="url(#${p}velvet)" stroke="#c49a54" stroke-opacity=".55" stroke-width="1.2"/>
<polygon data-part="velvet-light" fill="url(#${p}liningLight)"/>
<g data-part="recorder"></g>
</g>
<g data-part="band-face">
<polygon data-part="band" fill="url(#${p}woodBand)"/>
<rect x="120" y="60" width="400" height="230" filter="url(#${p}grain)" clip-path="url(#${p}clipBand)"/>
<polygon data-part="band-sides" fill="url(#${p}sides)"/>
<g data-part="band-affine"><g transform="translate(-150 -244)">
<path d="M150 244h26v7h-19v19h-7z M490 244h-26v7h19v19h7z" fill="url(#${p}brass)"/>
${screw(153.5, 261)}${screw(486.5, 261)}
<g data-part="catches"></g>
<g data-part="seal-high" display="none"><use href="#${p}ribbonArt" clip-path="url(#${p}sealHigh)"/><use href="#${p}sealArt" clip-path="url(#${p}sealHigh)"/></g>
</g></g>
</g>
</g>
<g data-part="seal-whole"><use href="#${p}ribbonArt"/><use href="#${p}sealArt"/></g>
<g data-part="levers"></g>
<g data-part="motes-front"></g>
<g data-part="motes-near" filter="url(#${p}soft1)"></g>
</svg>`;
}

// --- The box ------------------------------------------------------------------------
const NS = "http://www.w3.org/2000/svg",
  ASK = { Up: -48, Down: 48 },
  LEVELS = [-64, -32, 0, 32, 64],
  OPENING_SECONDS = 3.6,
  smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)),
  inOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// The opening in time: the latches flip one after the other, the seal cracks,
// then the lid swings up on its hinge and settles on its stop.
function poseAt(t) {
  const a = (t - 0.8) / 1.7,
    settle = a > 1 ? 0.05 * Math.exp(-5 * (a - 1)) * Math.sin(13 * (a - 1)) : 0;
  return {
    latch: [smooth(t / 0.3) * LATCH, smooth((t - 0.22) / 0.3) * LATCH],
    broken: t > 0.62,
    lid: OPEN * inOut(Math.min(a, 1)) + settle,
  };
}
const SEALED = { lid: 0, latch: [0, 0], broken: false },
  OPENED = { lid: OPEN, latch: [LATCH, LATCH], broken: true };

export function createBox(host, options = {}) {
  const p = "box" + ++instances + "-",
    o = { light: host, label: "A sealed box", level: 2, motes: 240, voice: null, ...options };
  host.classList.add("box");
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", o.label);
  host.insertAdjacentHTML("afterbegin", markup(p));
  const svg = host.querySelector(".box-svg"),
    // A narrower view of the same picture, for a small card: the box larger,
    // the lamp's light still reaching past the picture's sides.
    view = { x: o.crop ? (W - o.crop) / 2 : 0, w: o.crop || W },
    $ = (name) => svg.querySelector(`[data-part="${name}"]`),
    el = (name, attrs, parent) => {
      const e = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent?.append(e);
      return e;
    },
    reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.setAttribute("viewBox", `${view.x} 0 ${view.w} ${H}`);
  if (o.light) {
    o.light.classList.add("box-lit");
    o.light.style.setProperty("--grain", grainTile());
  }

  // The plinth, the opening and its rims.
  $("plinth").setAttribute("points", points([[-180, 0, -10], [180, 0, -10], [180, -14, -10], [-180, -14, -10]].map((q) => project(...q))));
  const opening = points(quad(-170, 170, 0, D, HINGE).map((q) => project(...q)));
  for (const name of ["opening", "openingClip", "openingShade", "openingSides"]) $(name).setAttribute("points", opening);
  $("rimFront").setAttribute("points", points(quad(-170, 170, 0, 6, HINGE).map((q) => project(...q))));
  $("rimBack").setAttribute("points", points(quad(-170, 170, D - 6, D, HINGE).map((q) => project(...q))));
  $("rimLeft").setAttribute("points", points(quad(-170, -164, 6, D - 6, HINGE).map((q) => project(...q))));
  $("rimRight").setAttribute("points", points(quad(164, 170, 6, D - 6, HINGE).map((q) => project(...q))));
  paintPile().then((url) => svg.isConnected && $("pile").setAttribute("href", url));

  // The knobs: a knurled bakelite knob over engraved positions; the pointer is
  // the white line on its cap.
  function knob(host, positions, labels) {
    let marks = "";
    positions.forEach((deg, i) => {
      const a = (deg * Math.PI) / 180,
        s = Math.sin(a),
        c = Math.cos(a);
      marks += `<line x1="${(15.5 * s).toFixed(2)}" y1="${(-15.5 * c).toFixed(2)}" x2="${(18.5 * s).toFixed(2)}" y2="${(-18.5 * c).toFixed(2)}" stroke="#efe6d6" stroke-opacity=".6" stroke-width="1"/>`;
      marks += `<text x="${(23.5 * s).toFixed(2)}" y="${(-23.5 * c + 2.6).toFixed(2)}" text-anchor="middle" font-family="Fraunces, serif" font-size="7.4" fill="#efe6d6" fill-opacity=".82">${labels[i]}</text>`;
    });
    host.innerHTML = `${marks}<circle r="13.2" fill="#000" opacity=".5" transform="translate(.8 1.4)"/><circle r="12.6" fill="url(#${p}knob)"/><circle r="12.1" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="1.8" stroke-dasharray="1.05 1.05"/><circle r="8.6" fill="url(#${p}knobCap)"/><g class="pointer"><line x1="0" y1="-2.5" x2="0" y2="-11.4" stroke="#f4ede1" stroke-width="1.7" stroke-linecap="round"/></g>`;
    return host.querySelector(".pointer");
  }
  const askPointer = knob($("dial-ask"), [ASK.Up, ASK.Down], ["1", "0"]),
    levelPointer = knob($("dial-level"), LEVELS, ["1", "2", "3", "4", "5"]);
  let askAt = ASK.Up,
    askTo = ASK.Up;
  askPointer.setAttribute("transform", `rotate(${askAt})`);
  const setLevel = (id) => levelPointer.setAttribute("transform", `rotate(${LEVELS[Math.max(1, Math.min(5, id)) - 1]})`);
  setLevel(o.level);

  // Latch bases on the body, catches on the lid.
  for (const cx of LATCHES) {
    $("latch-bases").insertAdjacentHTML(
      "beforeend",
      `<rect x="${cx - 11}" y="277" width="22" height="16" rx="2" fill="url(#${p}brass)" stroke="#2f1f08" stroke-width=".6"/><use href="#${p}screwHead" x="${cx - 6.5}" y="289"/><use href="#${p}screwHead" x="${cx + 6.5}" y="289"/><rect x="${cx - 10}" y="282" width="20" height="4.4" rx="2.2" fill="url(#${p}pin)"/>`,
    );
    $("catches").insertAdjacentHTML(
      "beforeend",
      `<path d="M${cx - 9} 249h18v10l-3 3h-12l-3-3z" fill="url(#${p}brass)" stroke="#2f1f08" stroke-width=".6"/><path d="M${cx - 6} 262h12l-1 1.5h-10z" fill="#1a0f05" opacity=".8"/><use href="#${p}screwHead" x="${cx}" y="254"/>`,
    );
  }

  // What is fixed to the top of the lid: brass corner caps and a bail handle
  // folded flat.
  const parts = [],
    part = (parent, tag, attrs, shape, kind = "poly") => parts.push({ node: el(tag, attrs, parent), shape, kind });
  for (const [sx, sz] of [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ]) {
    const x = sx * 170,
      z = sz * D;
    part($("top-parts"), "polygon", { fill: `url(#${p}brass)`, stroke: "#2f1f08", "stroke-width": 0.6 }, [
      [x, 208, z],
      [x - sx * 24, 208, z],
      [x, 208, z + (sz ? -18 : 18)],
    ]);
  }
  {
    const bail = Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI;
      return [-26 * Math.cos(t), 208, 50 - 20 * Math.sin(t)];
    });
    part($("top-parts"), "path", { fill: "none", stroke: "#120a04", "stroke-opacity": 0.45, "stroke-width": 4.2, transform: "translate(1.2 1.6)" }, bail, "line");
    part($("top-parts"), "path", { fill: "none", stroke: `url(#${p}brass)`, "stroke-width": 3.4, "stroke-linecap": "round" }, bail, "line");
    for (const x of [-26, 26]) part($("top-parts"), "polygon", { fill: `url(#${p}brass)`, stroke: "#2f1f08", "stroke-width": 0.6 }, quad(x - 6, x + 6, 46, 55, 208));
  }

  // The recorder: plate, paper, printed grid, sprocket holes, the two rolls,
  // the maker's line, then ink, typed words and the needle.
  {
    let art = `<rect x="12" y="2" width="296" height="82" rx="3" fill="#1b1511" stroke="#b78c47" stroke-opacity=".8" stroke-width="1.1"/>`;
    art += `<rect x="${PAPER.u0}" y="${PAPER.v0}" width="${PAPER.u1 - PAPER.u0}" height="${PAPER.v1 - PAPER.v0}" fill="url(#${p}chart)"/>`;
    for (let k = -4; k <= 4; k++) {
      const v = ZERO_V - k * UNIT_V;
      art += `<line x1="${PAPER.u0}" x2="${PAPER.u1}" y1="${v}" y2="${v}" stroke="#b5654e" stroke-opacity="${k === 0 ? 0.6 : 0.24}" stroke-width="${k === 0 ? 0.7 : 0.45}"/>`;
    }
    for (let u = PAPER.u0 + 9; u < PAPER.u1; u += 18) art += `<line x1="${u}" x2="${u}" y1="${ZERO_V - 4 * UNIT_V}" y2="${ZERO_V + 4 * UNIT_V}" stroke="#b5654e" stroke-opacity=".16" stroke-width=".45"/>`;
    for (let u = PAPER.u0 + 4; u < PAPER.u1; u += 8) art += `<circle cx="${u}" cy="${PAPER.v0 + 2}" r=".85" fill="#3a2c20"/><circle cx="${u}" cy="${PAPER.v1 - 2}" r=".85" fill="#3a2c20"/>`;
    for (const u0 of [32, 279])
      art += `<rect x="${u0}" y="${PAPER.v0 - 2.5}" width="9" height="${PAPER.v1 - PAPER.v0 + 5}" rx="2" fill="url(#${p}roll)"/><rect x="${u0 - 1.5}" y="${PAPER.v0 - 5}" width="12" height="4" rx="1.5" fill="url(#${p}brass)"/><rect x="${u0 - 1.5}" y="${PAPER.v1 + 1}" width="12" height="4" rx="1.5" fill="url(#${p}brass)"/>`;
    art += `<text x="160" y="81.6" text-anchor="middle" font-family="Archivo, sans-serif" font-stretch="80%" font-weight="600" font-size="4.6" letter-spacing="1.2" fill="#e8d9b8" fill-opacity=".75">SEALED RECORD · INTENTION LAB</text>`;
    art += `<circle cx="${PEN.u}" cy="${PEN.v}" r="6.4" fill="url(#${p}brass)" stroke="#2f1f08" stroke-width=".5"/>`;
    art += `<g clip-path="url(#${p}clipPaper)"><g data-part="trace" fill="none" stroke="#3b2a63" stroke-width="1.05" stroke-linejoin="round" stroke-linecap="round"></g><g data-part="words"></g></g><g data-part="pen"></g>`;
    $("recorder").innerHTML = art;
  }
  const trace = $("trace"),
    words = $("words"),
    pen = $("pen");
  // The needle at rest, on the zero line.
  function needleAt(v) {
    const u = tipU(v),
      angle = (Math.atan2(v - PEN.v, u - PEN.u) * 180) / Math.PI,
      L = Math.hypot(u - PEN.u, v - PEN.v),
      shape = (fill) => `<path d="M-9 0 L-3 -0.95 L${(L - 3).toFixed(2)} -0.22 L${L.toFixed(2)} 0 L${(L - 3).toFixed(2)} 0.22 L-3 0.95z" fill="${fill}"/>`;
    pen.innerHTML =
      `<g transform="translate(${(PEN.u + 0.7).toFixed(2)} ${(PEN.v + 1.3).toFixed(2)}) rotate(${angle.toFixed(2)})" opacity=".32">${shape("#000")}</g>` +
      `<g transform="translate(${PEN.u} ${PEN.v}) rotate(${angle.toFixed(2)})"><rect x="-12.5" y="-2.1" width="6" height="4.2" rx="1" fill="#16110c"/>${shape("#16110c")}<path d="M0 -0.55 L${(L - 5).toFixed(2)} -0.12" stroke="#fff" stroke-opacity=".22" stroke-width=".35"/></g>` +
      `<circle cx="${u.toFixed(2)}" cy="${v.toFixed(2)}" r=".55" fill="#3b2a63"/>` +
      `<circle cx="${PEN.u}" cy="${PEN.v}" r="4.2" fill="url(#${p}hub)"/><circle cx="${PEN.u}" cy="${PEN.v}" r="1.6" fill="url(#${p}screw)"/>`;
  }
  // Writes a record. cursor says how far it has been written, for a replay: 0
  // to 1 through the first part, 1 to 2 through the pause, 2 to 3 through the
  // second; the paper has moved on so that the latest ink is under the needle.
  // Without a cursor the record is complete.
  function write(record, cursor = 3) {
    const runs = record?.parts ?? [],
      last = (i) => runs[i]?.points?.at(-1)?.[1] ?? 0,
      end = tipU(traceV(last(1))),
      spans = [SPANS[0], [SPANS[1][0], end]],
      at = ([u0, u1], f) => u0 + f * (u1 - u0),
      c = Math.max(0, Math.min(3, cursor)),
      // The ink under the needle now, and where it sits on the finished record.
      nowZ = c < 2 ? (runs[0]?.points?.filter(([f]) => f <= Math.min(1, c)).at(-1)?.[1] ?? 0) : (runs[1]?.points?.filter(([f]) => f <= c - 2).at(-1)?.[1] ?? 0),
      nowU = c <= 1 ? at(spans[0], c) : c <= 2 ? at([spans[0][1], spans[1][0]], c - 1) : at(spans[1], c - 2),
      shift = c >= 3 ? 0 : tipU(traceV(nowZ)) - nowU;
    let ink = "",
      typed = "";
    runs.forEach((run, i) => {
      const upTo = i === 0 ? Math.min(1, c) : c - 2;
      if (upTo < 0 || !run.points?.length) return;
      // At most a few hundred points a part: plenty for the width of the paper.
      const shown = run.points.filter(([f]) => f <= upTo),
        stride = Math.max(1, Math.ceil(shown.length / 400)),
        kept = shown.filter((_, k) => k % stride === 0 || k === shown.length - 1);
      if (kept.length > 1) ink += `<polyline points="${kept.map(([f, z]) => `${(at(spans[i], f) + shift).toFixed(1)},${traceV(z).toFixed(1)}`).join(" ")}"/>`;
      typed += `<text x="${((spans[i][0] + spans[i][1]) / 2 + shift).toFixed(1)}" y="${WORDS_V.toFixed(1)}" text-anchor="middle" font-family="Courier New, Courier, monospace" font-weight="700" font-size="4.6" letter-spacing=".6" fill="#3b2a63" fill-opacity=".85">${run.kind === "Up" ? "ASKED ONES" : "ASKED ZEROS"}</text>`;
    });
    trace.innerHTML = ink;
    words.innerHTML = typed;
    needleAt(traceV(c >= 3 ? last(1) : nowZ));
  }
  needleAt(ZERO_V);

  // The latch levers, turning down on their pins.
  const levers = LATCHES.map((cx) => {
    const g = el("g", {}, $("levers"));
    return {
      plate: el("polygon", { stroke: "#2f1f08", "stroke-width": 0.6 }, g),
      bail: el("path", { fill: "none", stroke: "#c9c5bc", "stroke-width": 1.5, "stroke-linecap": "round" }, g),
      shine: el("path", { fill: "none", stroke: "#fff3d0", "stroke-opacity": 0.45, "stroke-width": 0.8 }, g),
      shape: [front(cx - 7, 286, -2), front(cx + 7, 286, -2), front(cx + 6, 262, -2), front(cx + 3.5, 258.5, -2), front(cx - 3.5, 258.5, -2), front(cx - 6, 262, -2)],
      wire: [front(cx - 5, 262, -2.4), front(cx - 5, 255.5, -2.4), front(cx, 253.5, -2.4), front(cx + 5, 255.5, -2.4), front(cx + 5, 262, -2.4)],
      edge: [front(cx - 6, 284, -2.2), front(cx - 5.4, 263, -2.2)],
    };
  });

  // Draws a pose: the lid's angle, the latches' angles, the seal whole or broken.
  function draw({ lid, latch, broken }) {
    const at = (q) => project(...turn(q, lid));
    for (const [name, list] of Object.entries(FACES)) {
      const shot = list.map(at),
        shown = area(shot) > 0;
      $(name + "-face").style.display = shown ? "" : "none";
      if (!shown) continue;
      $(name).setAttribute("points", points(shot));
      if (name === "top") {
        $("topClip").setAttribute("points", points(shot));
        $("top-edge").setAttribute("d", path([shot[3], shot[2]]));
      } else if (name === "band") {
        $("bandClip").setAttribute("points", points(shot));
        $("band-sides").setAttribute("points", points(shot));
        $("band-affine").setAttribute("transform", affine(shot[0], shot[1], shot[3], 340, 26));
      } else {
        const velvet = points(quad(-162, 162, 6, D - 6, HINGE).map(at));
        $("velvet-in").setAttribute("points", velvet);
        $("velvet-light").setAttribute("points", velvet);
        $("recorder").setAttribute("transform", affine(at(recAt(0, 0)), at(recAt(REC.w, 0)), at(recAt(0, REC.h)), REC.w, REC.h));
      }
    }
    for (const q of parts) {
      const shot = q.shape.map(at);
      q.node.setAttribute(q.kind === "line" ? "d" : "points", q.kind === "line" ? path(shot) : points(shot));
    }
    $("seam").style.display = lid > 0.004 ? "none" : "";
    $("seal-whole").style.display = broken ? "none" : "";
    $("seal-low").setAttribute("display", broken ? "inline" : "none");
    $("seal-high").setAttribute("display", broken ? "inline" : "none");
    levers.forEach((l, i) => {
      const shot = l.shape.map((q) => project(...flip(q, latch[i]))),
        facing = area(shot) > 0;
      l.plate.setAttribute("points", points(shot));
      l.plate.setAttribute("fill", facing ? `url(#${p}brassLever)` : `url(#${p}brassBack)`);
      l.bail.setAttribute("d", path(l.wire.map((q) => project(...flip(q, latch[i])))));
      l.shine.setAttribute("d", facing ? path(l.edge.map((q) => project(...flip(q, latch[i])))) : "");
    });
  }
  draw(SEALED);

  // Dust in the light: specks at many depths. The near ones are larger, softer
  // and quicker; all drift and rise slowly in the lamp's warm air, and each
  // glints as it turns.
  const motes = [],
    r = rng(17),
    coneHalf = (y) => 40 + ((y - 44) / 446) * 285,
    beamAt = (x, y) => Math.max(0, 1 - Math.abs(x - 320) / coneHalf(y)) ** 1.3 * (1 - (0.45 * (y - 44)) / 446);
  for (let i = 0; i < o.motes; i++) {
    const depth = r(),
      near = depth > 0.84,
      size = near ? 1.7 + r() * 2.4 : 0.35 + depth * 1.15 + r() * 0.35,
      c = el("circle", { r: size.toFixed(2), fill: "#ffe8cc" }, $(near ? "motes-near" : i % 3 ? "motes-back" : "motes-front"));
    motes.push({ c, near, speed: 0.4 + depth * 1.3, x: 320 + (r() - 0.5) * 560, y: 46 + r() * 440, ph: r() * 6.3, f: 0.4 + r() * 1.2, drift: 0.5 + r(), seed: r() * 100 });
  }
  function dust(dt, t) {
    for (const m of motes) {
      const glow = beamAt(m.x, m.y),
        rise = 2.2 + 4 * glow;
      m.x += (Math.sin(t * 0.21 * m.drift + m.seed) * 3.2 + Math.sin(t * 0.63 + m.seed * 1.7) * 1.4) * m.speed * dt;
      m.y += (Math.sin(t * 0.33 + m.seed * 2.3) * 2.2 - rise) * m.speed * dt;
      if (m.y < 44) {
        m.y = 488;
        m.x = 320 + (Math.random() - 0.5) * 560;
      }
      if (m.x < -10 || m.x > 650) m.x = 320 + (Math.random() - 0.5) * 400;
      // Lit mostly inside the beam, a little outside it; a flake catching the light as it turns.
      const glint = 0.3 + 0.7 * Math.sin(t * m.f + m.ph) ** 2,
        a = Math.min(1, (glow + 0.05) * glint * (m.near ? 0.5 : 0.95));
      m.c.setAttribute("cx", m.x.toFixed(1));
      m.c.setAttribute("cy", m.y.toFixed(1));
      m.c.setAttribute("opacity", a.toFixed(3));
    }
  }
  dust(0, 0);

  // Where the lamp is, for the light it casts on the room around the box.
  function place() {
    if (!o.light) return;
    const box = svg.getBoundingClientRect(),
      room = o.light.getBoundingClientRect();
    if (!box.width || !room.width) return;
    const k = Math.min(box.width / view.w, box.height / H),
      x = box.left + (box.width - view.w * k) / 2 + (LAMP[0] - view.x) * k,
      y = box.top + (box.height - H * k) / 2 + LAMP[1] * k;
    o.light.style.setProperty("--box-lamp-x", (((x - room.left) / room.width) * 100).toFixed(2) + "%");
    o.light.style.setProperty("--box-lamp-y", (((y - room.top) / room.height) * 100).toFixed(2) + "%");
  }

  // The clock: dust, the Ask knob's detent and the opening. It rests while the
  // box is out of view.
  let frame = 0,
    timer = 0,
    last = 0,
    opened = null,
    finish = null,
    destroyed = false;
  function tick(time) {
    frame = 0;
    if (destroyed) return;
    if (document.hidden || !host.getClientRects().length) {
      last = 0;
      timer = setTimeout(() => (frame = requestAnimationFrame(tick)), 400);
      return;
    }
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 1 / 60,
      t = time / 1000;
    last = time;
    place();
    if (!reduced()) dust(dt, t);
    if (Math.abs(askTo - askAt) > 0.05) {
      askAt = reduced() ? askTo : askAt + (askTo - askAt) * Math.min(1, dt * 14);
      askPointer.setAttribute("transform", `rotate(${askAt.toFixed(2)})`);
    }
    if (opened !== null) {
      const since = t - opened;
      draw(since >= OPENING_SECONDS + 0.6 ? OPENED : poseAt(since));
      if (since >= OPENING_SECONDS + 0.6) {
        opened = null;
        finish?.();
        finish = null;
      }
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);

  return {
    // Turns the Ask knob to 1 for ones (Up) or 0 for zeros (Down), with its click.
    ask(kind, { quiet = false } = {}) {
      const to = ASK[kind];
      if (to === undefined || to === askTo) return;
      askTo = to;
      if (reduced()) {
        askAt = to;
        askPointer.setAttribute("transform", `rotate(${to})`);
      }
      if (!quiet) o.voice?.knob();
    },
    level: setLevel,
    // Closes the lid and seals it again, with the record still inside.
    seal() {
      opened = null;
      finish?.();
      finish = null;
      draw(SEALED);
      host.setAttribute("aria-label", o.label);
    },
    // Writes the record and opens the box. Resolves once the lid has settled.
    open(record, { instant = reduced() } = {}) {
      write(record);
      finish?.();
      host.setAttribute("aria-label", "The box, open: the record its recorder wrote while it was sealed");
      if (instant) {
        opened = null;
        finish = null;
        draw(OPENED);
        return Promise.resolve();
      }
      draw(SEALED);
      opened = performance.now() / 1000;
      o.voice?.opening();
      return new Promise((resolve) => (finish = resolve));
    },
    // The box standing open on a record written up to cursor, for a replay.
    show(record, cursor) {
      opened = null;
      draw(OPENED);
      write(record, cursor);
    },
    setVoice(voice) {
      o.voice = voice;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      finish?.();
      svg.remove();
      if (o.light) {
        o.light.classList.remove("box-lit");
        for (const name of ["--grain", "--box-lamp-x", "--box-lamp-y"]) o.light.style.removeProperty(name);
      }
    },
  };
}
