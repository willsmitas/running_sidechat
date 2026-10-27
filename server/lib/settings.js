import { DEFAULT_SETTINGS } from '../db.js';

const cache = new WeakMap();

export function getSettings(db) {
  let s = cache.get(db);
  if (!s) {
    s = { ...DEFAULT_SETTINGS };
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      if (row.key in DEFAULT_SETTINGS) s[row.key] = JSON.parse(row.value);
    }
    cache.set(db, s);
  }
  return s;
}

export function updateSettings(db, patch) {
  const current = getSettings(db);
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const def = DEFAULT_SETTINGS[k];
    let val = v;
    if (typeof def === 'number') val = Number(v);
    else if (typeof def === 'boolean') val = Boolean(v);
    else if (Array.isArray(def)) val = (Array.isArray(v) ? v : String(v).split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 500);
    else val = String(v ?? '').slice(0, 1000);
    if (typeof def === 'number' && !Number.isFinite(val)) continue;
    next[k] = val;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(val));
  }
  cache.set(db, next);
  return next;
}
