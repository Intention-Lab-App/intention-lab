// Lab charts as inline SVG, styled from CSS so they share the dark palette.
// Statistics are computed on full-resolution data; only drawing is reduced.
import { esc, signed, number, table, date, order } from "./format.js";
const width = 900,
  height = 320,
  left = 78,
  right = 24,
  top = 40,
  bottom = 46;
const wrap = (content, label) =>
  `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">${content}</svg></div>`;
const reduced = (points) => {
  if (points.length <= 400) return points;
  const out = [points[0]],
    size = Math.ceil(points.length / 180);
  for (let i = 0; i < points.length; i += size) {
    const block = points.slice(i, i + size);
    out.push(
      block.reduce((a, b) => (a.y < b.y ? a : b)),
      block.reduce((a, b) => (a.y > b.y ? a : b)),
    );
  }
  out.push(points.at(-1));
  return [...new Set(out)].sort((a, b) => a.x - b.x);
};
export function diagnosticChart(rows, metric, label) {
  const points = rows
    .map((r, i) => ({ x: i + 1, y: r[metric], r }))
    .filter((p) => p.y != null && Number.isFinite(p.y));
  if (!points.length) return '<p class="hint">Not enough data for this measure yet.</p>';
  let lo = Math.min(0, ...points.map((p) => p.y)),
    hi = Math.max(...points.map((p) => p.y));
  const padding = Math.max((hi - lo) * 0.1, metric === "meanLagOneCorrelation" ? 0.001 : 1);
  lo -= padding;
  hi += padding;
  // Only the correlation can be negative; the other measures start at zero.
  if (metric !== "meanLagOneCorrelation") lo = Math.max(0, lo);
  const x = (v) => left + ((v - 1) / Math.max(1, rows.length - 1)) * (width - left - right),
    y = (v) => top + ((hi - v) / (hi - lo)) * (height - top - bottom);
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end" class="chart-tick">${number(v, metric === "meanLagOneCorrelation" ? 4 : 0)}</text>`;
  }
  for (const kind of [...new Set(points.map((p) => p.r.phase))]) {
    const visible = reduced(points.filter((p) => p.r.phase === kind)),
      cls = kind === "Down" ? "chart-pair-down" : "chart-pair-up";
    svg += `<polyline points="${visible.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}" fill="none" class="chart-ci"/>`;
    for (const p of visible)
      svg += `<g tabindex="0" role="link" data-open-session="${esc(p.r.sessionId)}" aria-label="${esc(kind + " " + label + " " + number(p.y, 5))}"><circle cx="${x(p.x)}" cy="${y(p.y)}" r="3.5" class="${cls}"/><title>${esc(p.r.sessionId.slice(0, 8))}, ${kind}: ${number(p.y, 5)}</title></g>`;
  }
  svg += `<text x="${left}" y="${height - 10}" class="chart-tick">Phases in recorded order. Warm: Up, cool: Down.</text>`;
  return wrap(svg, label + " across phases in recorded order");
}
export function effectChart(points, { label = "Effect per million", targets = false, band = false, moving = false } = {}) {
  if (!points.length) return "";
  const values = points
    .flatMap((p) => [p.y, p.lo, p.hi, targets ? p.goal : null])
    .filter((v) => v != null && Number.isFinite(v));
  const bound = Math.max(10, ...values.map(Math.abs)) * 1.12;
  const y = (v) => top + ((height - top - bottom) * (bound - v)) / (2 * bound);
  const maxX = Math.max(1, ...points.map((p) => p.x)),
    x = (v) => left + ((width - left - right) * (v - 1)) / Math.max(1, maxX - 1);
  const display = reduced(points);
  let svg = "";
  for (let i = -2; i <= 2; i++) {
    const val = (bound * i) / 2;
    svg += `<line x1="${left}" x2="${width - right}" y1="${y(val)}" y2="${y(val)}" class="${i === 0 ? "chart-zero" : "chart-grid"}"/><text x="${left - 12}" y="${y(val) + 4}" text-anchor="end" class="chart-tick">${signed(val, 0)}</text>`;
  }
  svg += `<text x="${left}" y="${height - 8}" class="chart-tick">Session order (${points.length} sessions, ${display.length} drawn)</text><text x="${left}" y="14" class="chart-label">Per million</text>`;
  if (band) {
    const valid = display.filter((p) => p.lo != null && p.hi != null);
    if (valid.length)
      svg += `<polygon points="${valid
        .map((p) => `${x(p.x)},${y(p.hi)}`)
        .concat([...valid].reverse().map((p) => `${x(p.x)},${y(p.lo)}`))
        .join(" ")}" class="chart-band"/>`;
    svg += `<polyline points="${display.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}" class="chart-line"/>`;
  }
  for (const p of display) {
    if (!band && p.lo != null && p.hi != null)
      svg += `<line x1="${x(p.x)}" x2="${x(p.x)}" y1="${y(p.lo)}" y2="${y(p.hi)}" class="chart-ci"/>`;
    if (targets && p.goal != null)
      svg += `<path d="M${x(p.x) - 6} ${y(p.goal)}h12" class="chart-target"><title>Goal: +${p.goal} per million</title></path>`;
    svg += `<g tabindex="0" role="link" aria-label="${esc(p.tip)}" data-open-session="${esc(p.id)}"><circle cx="${x(p.x)}" cy="${y(p.y)}" r="${band ? 3 : 4}" class="chart-dot${p.y < 0 ? " negative" : ""}"/><title>${esc(p.tip)}</title></g>`;
    if (p.annotation)
      svg += `<path d="M${x(p.x)} ${height - bottom + 4}v8" class="chart-target" style="stroke-width:1.5"><title>${esc(p.annotation)}</title></path>`;
  }
  if (moving) {
    const trend = points.map((p, i) => ({
      ...p,
      y: points.slice(Math.max(0, i - 4), i + 1).reduce((a, b) => a + b.y, 0) / Math.min(5, i + 1),
    }));
    svg += `<polyline points="${reduced(trend)
      .map((p) => `${x(p.x)},${y(p.y)}`)
      .join(" ")}" class="chart-trend"/>`;
  }
  return wrap(svg, label);
}
export function sessionPoints(sessions, timezone) {
  return sessions.map((s, i) => ({
    id: s.id,
    x: i + 1,
    y: s.result.effectPpm,
    lo: s.result.ciLowPpm,
    hi: s.result.ciHighPpm,
    goal: s.config.difficulty.goalPpm,
    tip: `${date(s.createdUtc, timezone)}, ${s.config.game}, ${s.config.difficulty.label}, ${s.config.durationMinutes} min each way, ${order(s)}. Effect ${signed(s.result.effectPpm)} per million, goal +${Math.round(s.config.difficulty.goalPpm)}.${s.clean ? "" : " Quality check: " + s.qualityReasons.join("; ")}${s.notes ? " Note: " + s.notes : ""}`,
  }));
}
export function pairedDots(sessions) {
  if (!sessions.length) return "";
  const a = (s) => s.result.upRate,
    b = (s) => s.result.downRate,
    vals = sessions.flatMap((s) => [a(s), b(s)]);
  let min = Math.min(...vals),
    max = Math.max(...vals);
  const pad = Math.max(0.0001, (max - min) * 0.15);
  min -= pad;
  max += pad;
  const x = (v) => left + ((v - min) / (max - min)) * (width - left - right);
  const display = reduced(sessions.map((s, i) => ({ x: i + 1, y: s.result.effectPpm, s })));
  let svg = "";
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    svg += `<line x1="${x(value)}" x2="${x(value)}" y1="${top}" y2="${height - bottom}" class="chart-grid"/><text x="${x(value)}" y="${height - bottom + 24}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" class="chart-tick">${number(value * 100, 4)}%</text>`;
  }
  display.forEach((p, i) => {
    const yy = top + ((i + 0.5) * (height - top - bottom)) / display.length,
      s = p.s;
    svg += `<g tabindex="0" role="link" data-open-session="${esc(s.id)}" aria-label="Open session ${esc(s.id.slice(0, 8))}"><line x1="${x(b(s))}" x2="${x(a(s))}" y1="${yy}" y2="${yy}" class="chart-pair"/><circle cx="${x(b(s))}" cy="${yy}" r="3" class="chart-pair-down"/><circle cx="${x(a(s))}" cy="${yy}" r="3" class="chart-pair-up"/><title>Down ${number(b(s) * 100, 5)}%, Up ${number(a(s) * 100, 5)}%, ${signed(s.result.effectPpm)} per million</title></g>`;
  });
  return wrap(svg, "Paired rates: Down cool, Up warm, joined within each session");
}
export function distribution(sessions) {
  if (!sessions.length) return "";
  const values = sessions.map((s) => s.result.effectPpm);
  let min = Math.min(...values),
    max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lo: min + ((max - min) * i) / 10,
    hi: min + ((max - min) * (i + 1)) / 10,
    n: 0,
  }));
  values.forEach((v) => bins[Math.min(9, Math.floor(((v - min) / (max - min)) * 10))].n++);
  const largest = Math.max(...bins.map((b) => b.n));
  let svg = "";
  bins.forEach((b, i) => {
    const w = (width - left - right) / 10,
      x = left + i * w,
      h = ((height - top - bottom) * b.n) / largest;
    svg += `<rect x="${x + 2}" y="${height - bottom - h}" width="${w - 4}" height="${h}" class="chart-bar"><title>${signed(b.lo)} to ${signed(b.hi)} per million: ${b.n} sessions</title></rect><text x="${x + w / 2}" y="${height - bottom - h - 6}" text-anchor="middle" class="chart-tick">${b.n}</text>`;
  });
  svg += `<text x="${left}" y="${height - 14}" class="chart-tick">${signed(min)} per million</text><text x="${width - right}" y="${height - 14}" text-anchor="end" class="chart-tick">${signed(max)} per million</text>`;
  return (
    wrap(svg, "Distribution of session effects") +
    `<details class="disclosure"><summary>Data table</summary>${table(
      ["From, per million", "To, per million", "Sessions"],
      bins.map((b) => [signed(b.lo), signed(b.hi), b.n]),
      "The last bin includes its upper end.",
    )}</details>`
  );
}
