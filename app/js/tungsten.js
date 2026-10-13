// Black-body colour and brightness of a tungsten filament, for display only.
// Planck's law weighted by the CIE 1931 2-degree colour matching functions
// (multi-lobe Gaussian fit, Wyman, Sloan & Shirley 2013), converted to sRGB.
const lobe = (x, mu, s1, s2) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};
const cmf = (l) => [
  1.056 * lobe(l, 599.8, 37.9, 31.0) +
    0.362 * lobe(l, 442.0, 16.0, 26.7) -
    0.065 * lobe(l, 501.1, 20.4, 26.2),
  0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
  1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
];
const encode = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
function planck(T) {
  let X = 0,
    Y = 0,
    Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const m = l * 1e-9,
      B = 1 / (m ** 5 * (Math.exp(1.4387769e-2 / (m * T)) - 1)),
      [x, y, z] = cmf(l);
    X += B * x;
    Y += B * y;
    Z += B * z;
  }
  const lin = [
    Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z),
  ];
  const max = Math.max(...lin);
  return { rgb: lin.map((c) => 255 * encode(c / max)), Y };
}
export const T_COLD = 650,
  T_IDLE = 1650,
  T_FULL = 2850,
  T_MAX = 3150;
const STEP = 25,
  FIRST = 500,
  LAST = 3600,
  REFERENCE = planck(T_FULL).Y,
  TABLE = [];
for (let T = FIRST; T <= LAST; T += STEP) {
  const p = planck(T);
  TABLE.push({ rgb: p.rgb, L: p.Y / REFERENCE });
}
// Colour at full chroma (0..255 sRGB) and luminance relative to full operation.
export function blackbody(T) {
  const x = Math.min(LAST, Math.max(FIRST, T)),
    i = Math.min(TABLE.length - 2, Math.floor((x - FIRST) / STEP)),
    f = (x - FIRST - i * STEP) / STEP,
    a = TABLE[i],
    b = TABLE[i + 1];
  return {
    rgb: a.rgb.map((v, k) => v + (b.rgb[k] - v) * f),
    // Luminance is close to exponential in 1/T; interpolate in log space.
    L: Math.exp(Math.log(a.L) + (Math.log(b.L) - Math.log(a.L)) * f),
  };
}
// Signed display level (-1..1) to filament temperature. 0 idles dim orange,
// +0.8 (the difficulty goal) is full operating brightness, -1 is dark.
export function levelToTemperature(level) {
  const v = Math.max(-1, Math.min(1, Number(level) || 0));
  if (v >= 0.8) return T_FULL + (T_MAX - T_FULL) * ((v - 0.8) / 0.2);
  if (v >= 0) return T_IDLE + (T_FULL - T_IDLE) * (v / 0.8);
  return T_IDLE - (T_IDLE - T_COLD) * Math.pow(-v, 0.85);
}
// Perceived brightness of the wire itself, as the eye adapted to a dark room
// sees it: invisible below the Draper point, dull red, then orange at rest,
// then white-hot. The light it throws (glowStrength) follows luminance and so
// rises far faster than the colour shifts, as in a real lamp.
export function wireBrightness(T) {
  if (T <= 760) return 0;
  if (T < T_IDLE) return 0.62 * Math.pow((T - 760) / (T_IDLE - 760), 1.3);
  if (T < T_FULL) return 0.62 + 0.38 * ((T - T_IDLE) / (T_FULL - T_IDLE));
  return 1 + 0.12 * Math.min(1, (T - T_FULL) / (T_MAX - T_FULL));
}
export const glowStrength = (L) => Math.min(1.7, Math.pow(L, 0.55));
// Scores share the lamp's physics: 0 is a cold wire, 100 a fully lit filament.
export function scoreLight(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const T = s === 0 ? T_COLD : 1250 + (T_FULL + 150 - 1250) * Math.pow(s / 100, 0.8),
    { rgb, L } = blackbody(T),
    b = wireBrightness(T),
    g = glowStrength(L);
  return { T, rgb, brightness: b, glow: g };
}
export const css = (rgb, a = 1) =>
  `rgb(${rgb.map((v) => Math.round(v)).join(" ")} / ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
