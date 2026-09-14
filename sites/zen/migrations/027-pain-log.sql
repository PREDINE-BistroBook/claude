-- 2026-09-14: where it hurts, over time (Ash: the intake map goes stale; keep a history, show progress, keep the profile current)
CREATE TABLE IF NOT EXISTS pain_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at TEXT DEFAULT (datetime('now')), areas TEXT NOT NULL, source TEXT NOT NULL, booking_id TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS pain_log_user ON pain_log(user_id, at);
