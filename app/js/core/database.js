export const DB_NAME = "IntentionLab",
  DB_VERSION = 4;
export const STORES = [
  "sessions",
  "buckets",
  "events",
  "notes",
  "devices",
  "references",
  "challenges",
  "raw",
  "meta",
  "analyses",
];
let opening;
export function openDb() {
  return (opening ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      const db = r.result;
      // No migrations: a database with an older schema is cleared, together
      // with the browser-stored conveniences (saved views, last choice, layer).
      if (e.oldVersion)
        try {
          localStorage.clear();
        } catch {
          /* Not available in workers; the page opens the database first. */
        }
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      for (const name of STORES) {
        const s = db.createObjectStore(name, { keyPath: "id" });
        if (["buckets", "events", "notes", "raw"].includes(name))
          s.createIndex("sessionId", "sessionId");
        if (name === "sessions") {
          s.createIndex("createdUtc", "createdUtc");
          s.createIndex("source", "config.source");
        }
      }
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        opening = null;
      };
      resolve(r.result);
    };
    r.onblocked = () =>
      reject(Error("Close other Intention Lab tabs to upgrade the database."));
  }));
}
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () =>
      reject(tx.error || Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error || Error("IndexedDB transaction aborted"));
  });
const value = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export async function get(store, id) {
  const db = await openDb();
  return value(db.transaction(store).objectStore(store).get(id));
}
export async function all(store, sessionId) {
  const db = await openDb(),
    s = db.transaction(store).objectStore(store);
  return value(sessionId ? s.index("sessionId").getAll(sessionId) : s.getAll());
}
export async function write(records, remove = {}) {
  const db = await openDb(),
    names = [...new Set([...Object.keys(records), ...Object.keys(remove)])],
    tx = db.transaction(names, "readwrite", { durability: "strict" }),
    wait = done(tx);
  for (const [name, items] of Object.entries(records))
    for (const item of items) tx.objectStore(name).put(item);
  for (const [name, ids] of Object.entries(remove))
    for (const id of ids) tx.objectStore(name).delete(id);
  await wait;
}
export async function bump(records) {
  const revision = { id: "revision", value: crypto.randomUUID() };
  await write({ ...records, meta: [...(records.meta || []), revision] });
  return revision.value;
}
export async function snapshot() {
  const db = await openDb(),
    tx = db.transaction(STORES, "readonly"),
    wait = done(tx),
    result = {};
  await Promise.all(
    STORES.map(async (name) => {
      result[name] = await value(tx.objectStore(name).getAll());
    }),
  );
  await wait;
  return result;
}
