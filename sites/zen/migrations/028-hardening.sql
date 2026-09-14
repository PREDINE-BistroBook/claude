-- 2026-09-14 hardening batch: tries (login / magic-link / error-report throttling), browser errors reported by the site,
-- and one booking per therapist per exact slot as a safety net under the availability check.
CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at);
CREATE TABLE IF NOT EXISTS client_errors (id TEXT PRIMARY KEY, at TEXT DEFAULT (datetime('now')), page TEXT, msg TEXT, ua TEXT, n INTEGER DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_slot ON bookings(city, date, slot, therapist_id) WHERE status IN ('pending','paid','confirmed','review') AND therapist_id IS NOT NULL AND slot LIKE '__:__';
