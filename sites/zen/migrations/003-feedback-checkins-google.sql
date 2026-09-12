-- 2026-09-12 (evening): session rating + therapist note, weekly check-ins, language, Google sign-in. Applied to production via the D1 console.
ALTER TABLE bookings ADD COLUMN rating INTEGER;
ALTER TABLE bookings ADD COLUMN feedback TEXT;
ALTER TABLE bookings ADD COLUMN therapist_note TEXT;
ALTER TABLE users ADD COLUMN lang TEXT;
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, pain INTEGER, energy INTEGER, sleep INTEGER, note TEXT, booking_id TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS checkins_user ON checkins(user_id, date);
