// Profiles in the page: which one is in use, switching, renaming and adding,
// and the level and length each one last played on each game. They are saved
// with the app's settings in this browser; every list of sessions, score and
// export follows the profile in use.
import { request, post } from "./api.js";
import { state } from "./state.js";
import { profilesOf, profileName } from "./core/preferences.js";
const listeners = new Set();
export const onProfileChange = (fn) => listeners.add(fn);
export const profiles = () => profilesOf(state.bootstrap?.settings);
export const currentProfile = () => profiles().current;
// Every open tab follows the same profile. The saved settings travel with the
// message, so a tab showing a running session never has to read them.
const channel = "BroadcastChannel" in self ? new BroadcastChannel("intention-profiles") : null;
const changed = (settings) => {
  state.bootstrap.settings = settings;
  listeners.forEach((fn) => fn(currentProfile()));
};
if (channel) channel.onmessage = (e) => state.bootstrap && changed(e.data);
async function save(list, profileId) {
  changed(await post("/settings", { profiles: list, profileId }));
  channel?.postMessage(state.bootstrap.settings);
}
// After an import, which can add profiles, every tab reads the settings again.
export async function reloadProfiles() {
  changed(await request("/settings"));
  channel?.postMessage(state.bootstrap.settings);
}
export const useProfile = (id) => save(profiles().list, id);
export function renameProfile(id, name) {
  const clean = profileName(name);
  if (!clean) throw Error("Give the profile a name.");
  return save(
    profiles().list.map((p) => (p.id === id ? { ...p, name: clean } : p)),
    currentProfile().id,
  );
}
// A new profile, in use at once, named "Profile 2", "Profile 3" and so on.
export function addProfile() {
  const { list } = profiles(),
    names = new Set(list.map((p) => p.name));
  let n = list.length + 1;
  while (names.has("Profile " + n)) n++;
  const id = crypto.randomUUID().slice(0, 8);
  return save([...list, { id, name: "Profile " + n, choices: {} }], id);
}
// What this profile chose for a game, or Easy for a minute each way.
export const choiceFor = (game) => currentProfile().choices?.[game] ?? { level: 1, minutes: 1 };
// The game this profile played last, with its level and length.
export function lastChoice() {
  const c = currentProfile().choices,
    game = c?.last;
  return game && c[game] ? { game, ...c[game] } : null;
}
export function rememberChoice(game, level, minutes) {
  const current = currentProfile();
  return save(
    profiles().list.map((p) => (p.id === current.id ? { ...p, choices: { ...p.choices, [game]: { level, minutes }, last: game } } : p)),
    current.id,
  );
}
