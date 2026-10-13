import { GAMES, DURATIONS, DIFFICULTIES } from "./protocol.js";
// Presentation and session preferences are local defaults. The effective values
// are copied into the immutable session configuration before any measurement.
export const PRESENTATION_VERSION = "tungsten-ui-v5";
// showDifficultyMarker: the Bar's red goal needle. It is always shown, and
// still recorded with each session, so Insights can tell sessions apart should
// it ever be hidden.
// xorMask: count bits after the standard alternating XOR mask. Turning it off is
// a Lab choice; such sessions are kept apart from masked ones. sound: the
// instruments' sound, frozen into each session as presentation.sound.
// headphones: the Box's two drone tones go one to each ear, a binaural beat.
export const DEFAULT_PREFERENCES = Object.freeze({
  referenceId: null,
  recordRaw: false,
  showDifficultyMarker: true,
  xorMask: true,
  sound: true,
  headphones: false,
});
// Profiles: people who share the app each keep their own history, scores and
// choices. There is always at least one, the Default, in use from the start.
// Each remembers the level and length last played on each game, and which game
// was played last. Sessions record the profile they were played under.
export const DEFAULT_PROFILE = "default";
const PROFILE_ID = /^[a-z0-9-]{1,40}$/;
export const profileName = (name) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
export function profilesOf(settings = {}) {
  const list = Array.isArray(settings?.profiles) && settings.profiles.length ? settings.profiles : [{ id: DEFAULT_PROFILE, name: "Default", choices: {} }];
  return { list, current: list.find((p) => p.id === settings?.profileId) || list[0] };
}
export function checkProfiles(list, profileId) {
  if (!Array.isArray(list) || !list.length || list.length > 50) throw Error("Invalid profiles");
  const ids = new Set();
  const clean = list.map((p) => {
    const name = profileName(p?.name),
      choices = {};
    if (!PROFILE_ID.test(p?.id ?? "") || ids.has(p.id) || !name) throw Error("Invalid profile");
    ids.add(p.id);
    for (const game of GAMES) {
      const c = p.choices?.[game];
      if (c == null) continue;
      if (!DIFFICULTIES.some((d) => d.id === c.level) || !DURATIONS.includes(c.minutes)) throw Error("Invalid profile choice");
      choices[game] = { level: c.level, minutes: c.minutes };
    }
    if (p.choices?.last != null) {
      if (!choices[p.choices.last]) throw Error("Invalid profile choice");
      choices.last = p.choices.last;
    }
    return { id: p.id, name, choices };
  });
  if (profileId != null && !ids.has(profileId)) throw Error("Unknown profile");
  return clean;
}
export function preferences(value = {}) {
  if (
    value.referenceId != null &&
    (typeof value.referenceId !== "string" || value.referenceId.length > 100)
  )
    throw Error("Invalid saved session preference");
  for (const key of ["recordRaw", "showDifficultyMarker", "xorMask", "sound", "headphones"])
    if (value[key] != null && typeof value[key] !== "boolean")
      throw Error("Invalid display preference");
  return Object.fromEntries(
    Object.entries(DEFAULT_PREFERENCES).map(([key, fallback]) => [
      key,
      value[key] ?? fallback,
    ]),
  );
}
