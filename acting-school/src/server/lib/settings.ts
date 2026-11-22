import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/schemas/settings';
import type { DB } from '../db/client';
import { settings } from '../db/schema';

export function getSettings(db: DB): AppSettings {
  const rows = db.select().from(settings).all();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.key in DEFAULT_SETTINGS) out[row.key] = row.value;
  return out as unknown as AppSettings;
}

export function saveSettings(db: DB, patch: Partial<AppSettings>): AppSettings {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    }
  });
  return getSettings(db);
}
