// Line icons in the app's own hand: a 20-unit grid, 1.4 strokes, round ends,
// drawn in the current text colour. Inline SVG, so they work offline.
const P = {
  // The Bulb game: a lamp. Only ever the game, never a mode.
  bulb: `<path d="M7.3 13.4c-1.7-1.1-2.8-3-2.8-5.1a5.5 5.5 0 1 1 11 0c0 2.1-1.1 4-2.8 5.1"/><path d="M7.4 13.4h5.2M7.9 15.5h4.2M8.8 17.6h2.4"/><path d="M8.1 10.2c.6-1.3 1.1-1.3 1.9 0s1.3 1.3 1.9 0"/>`,
  // Simple mode: a feather, light and plain.
  feather: `<path d="M16 4c-4.6 0-8.4 2.9-9.4 7.4L6 15l3.6-.6C14 13.4 16.8 9.6 16 4z"/><path d="M12.6 7.4L3.6 16.4"/><path d="M8.6 11.4h4.6"/>`,
  // The numbers behind it: a flask. The Lab mode.
  flask: `<path d="M7.9 2.8h4.2M8.7 2.8v4.6l-4.1 7.4a1.7 1.7 0 0 0 1.5 2.5h7.8a1.7 1.7 0 0 0 1.5-2.5l-4.1-7.4V2.8"/><path d="M6.1 12.3h7.8"/><circle cx="9.2" cy="14.6" r=".7" fill="currentColor" stroke="none"/><circle cx="11.7" cy="13.9" r=".5" fill="currentColor" stroke="none"/>`,
  // The Bar: a needle meter, its needle pivoting at the left of its scale.
  meter: `<rect x="3.4" y="2.8" width="13.2" height="14.4" rx="2"/><path d="M10.6 5.2a6 6 0 0 1 0 9.6"/><path d="M6.4 10l6.2-3"/><circle cx="6.4" cy="10" r="1.1" fill="currentColor" stroke="none"/>`,
  // The Box: a sealed box, its seal on the join of lid and body.
  box: `<path d="M3.2 8.6h13.6v7.6a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1z"/><path d="M3.8 8.6l1.1-4h10.2l1.1 4"/><circle cx="10" cy="8.6" r="1.7"/>`,
  // A profile: a head and shoulders.
  person: `<circle cx="10" cy="7" r="3.2"/><path d="M4.2 16.8c.8-3.2 3.1-4.9 5.8-4.9s5 1.7 5.8 4.9"/>`,
  history: `<path d="M4.2 10a5.8 5.8 0 1 0 1.7-4.1"/><path d="M3.9 3.6v2.6h2.6"/><path d="M10 6.9V10l2.2 1.5"/>`,
  trend: `<path d="M3.5 16.5h13"/><path d="M4.6 13.3l3.4-3.5 2.9 2.4 4.4-5.4"/><path d="M12.6 6.8h2.9v2.9"/>`,
  sliders: `<path d="M3.8 6h2.1M9.3 6h6.9M3.8 10h7.6M14.8 10h1.4M3.8 14h4.1M11.3 14h4.9"/><circle cx="7.6" cy="6" r="1.7"/><circle cx="13.1" cy="10" r="1.7"/><circle cx="9.6" cy="14" r="1.7"/>`,
  plug: `<path d="M7.2 2.8v3.4M12.8 2.8v3.4"/><path d="M5.6 6.2h8.8v3.4a4.4 4.4 0 0 1-8.8 0z"/><path d="M10 14v3.2"/>`,
  archive: `<rect x="3.6" y="4" width="12.8" height="3.4" rx=".8"/><path d="M4.8 7.4v8a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2v-8"/><path d="M8.3 10.6h3.4"/>`,
  download: `<path d="M10 3.4v8.8M6.6 8.9l3.4 3.4 3.4-3.4"/><path d="M4 14.6v1.2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.2"/>`,
  upload: `<path d="M10 12.4V3.6M6.6 7l3.4-3.4L13.4 7"/><path d="M4 14.6v1.2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.2"/>`,
  target: `<circle cx="10" cy="10" r="6.8"/><circle cx="10" cy="10" r="3.8"/><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none"/>`,
  dice: `<rect x="3.4" y="3.4" width="13.2" height="13.2" rx="3"/><circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="13" r="1.1" fill="currentColor" stroke="none"/>`,
  // A stream of bits.
  bits: `<path d="M2.8 10h2.6l1.6-4.4 3 8.8 2-6.2 1.4 1.8h3.8"/>`,
  calendar: `<rect x="3.4" y="4.4" width="13.2" height="12.2" rx="1.8"/><path d="M3.4 8h13.2M7 2.9v3M13 2.9v3"/><path d="M7.5 12.2l1.7 1.7 3.3-3.4"/>`,
  database: `<ellipse cx="10" cy="5.2" rx="5.6" ry="2.2"/><path d="M4.4 5.2v9.6c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2V5.2"/><path d="M4.4 10c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2"/>`,
  book: `<path d="M10 5.3C8.4 4.1 6.2 3.7 4 4v11.3c2.2-.3 4.4.1 6 1.3 1.6-1.2 3.8-1.6 6-1.3V4c-2.2-.3-4.4.1-6 1.3z"/><path d="M10 5.3v11.3"/>`,
  power: `<path d="M10 3v6.4"/><path d="M6.3 5.7a6 6 0 1 0 7.4 0"/>`,
  sound: `<path d="M4 8.1h2.6L9.9 5v10l-3.3-3.1H4z"/><path d="M12.8 7.5a3.5 3.5 0 0 1 0 5M14.9 5.5a6.3 6.3 0 0 1 0 9"/>`,
  mute: `<path d="M4 8.1h2.6L9.9 5v10l-3.3-3.1H4z"/><path d="M13 7.8l4 4.4M17 7.8l-4 4.4"/>`,
  shuffle: `<path d="M3.4 6.4h2.8c3.8 0 3.8 7.2 7.8 7.2h2.4"/><path d="M14.4 11.4l2.1 2.2-2.1 2.2"/><path d="M3.4 13.6h2.8c1.3 0 2.1-.8 2.7-1.9M11.3 8.3c.6-1.1 1.4-1.9 2.7-1.9h2.4"/><path d="M14.4 4.2l2.1 2.2-2.1 2.2"/>`,
  repeat: `<path d="M4 9.2V8.4a3 3 0 0 1 3-3h8.4"/><path d="M13.3 3.2l2.1 2.2-2.1 2.2"/><path d="M16 10.8v.8a3 3 0 0 1-3 3H4.6"/><path d="M6.7 16.8l-2.1-2.2 2.1-2.2"/>`,
  timer: `<circle cx="10" cy="11.4" r="5.8"/><path d="M8.4 2.8h3.2M10 2.8v2.8M10 11.4V8.5M14.4 6.6l1.2-1.2"/>`,
  levels: `<path d="M4.4 16.4v-2.6M8 16.4v-5.4M11.6 16.4V8.2M15.2 16.4V5.4"/>`,
  gauge: `<path d="M3.4 14.2a6.6 6.6 0 0 1 13.2 0"/><path d="M10 14.2l3.3-4.4"/><circle cx="10" cy="14.2" r="1" fill="currentColor" stroke="none"/>`,
  checks: `<path d="M3.8 6.4l1.5 1.5 2.7-2.8M10.4 6.6h5.8M3.8 12.6l1.5 1.5 2.7-2.8M10.4 12.8h5.8"/>`,
  lens: `<circle cx="8.6" cy="8.6" r="5"/><path d="M12.3 12.3l4.3 4.3"/>`,
  play: `<path d="M6.6 4.6v10.8L15.4 10z"/>`,
  flag: `<path d="M5.2 17.4V3.2"/><path d="M5.2 3.8h10l-2.3 3.6 2.3 3.6h-10"/>`,
  // The mode switch.
  toggle: `<rect x="2.6" y="5.8" width="14.8" height="8.4" rx="4.2"/><circle cx="13.2" cy="10" r="2.3" fill="currentColor" stroke="none"/>`,
};
// One icon as inline markup. Decorative unless given a label.
export function icon(name, label = "") {
  return `<svg class="icon icon-${name}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[name] || ""}</svg>`;
}
// The icon each game is shown with.
export const gameIcon = (game) => ({ Bulb: "bulb", Bar: "meter", Box: "box" })[game] || "bulb";
// Every icon in place of [data-icon] placeholders in static markup.
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.firstElementChild?.classList.contains("icon")) continue;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
  }
}
