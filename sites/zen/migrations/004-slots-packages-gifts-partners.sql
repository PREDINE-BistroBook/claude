-- 2026-09-12 (night): live slots, therapists, packages, gifts, partner codes, waitlist, message log, photos (R2),
-- Apple sign-in, health-flag approval, birthday reward. Applied to production via the D1 console.
CREATE TABLE IF NOT EXISTS therapists (id TEXT PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, bio TEXT, photo TEXT, languages TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS availability (id TEXT PRIMARY KEY, city TEXT NOT NULL, therapist_id TEXT, weekday INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, slot_minutes INTEGER DEFAULT 60);
CREATE TABLE IF NOT EXISTS blocked (id TEXT PRIMARY KEY, city TEXT NOT NULL, therapist_id TEXT, date TEXT NOT NULL, start TEXT, end TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, sessions INTEGER NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, months_valid INTEGER DEFAULT 6, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS client_packages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, package_id TEXT NOT NULL, name TEXT, city TEXT, sessions INTEGER, remaining INTEGER, amount INTEGER, currency TEXT, platform_fee INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', stripe_session TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT);
CREATE TABLE IF NOT EXISTS gifts (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, city TEXT NOT NULL, service_id TEXT, service_name TEXT, amount INTEGER, currency TEXT, platform_fee INTEGER DEFAULT 0, buyer_name TEXT, buyer_email TEXT, recipient_name TEXT, recipient_email TEXT, message TEXT, status TEXT DEFAULT 'pending', stripe_session TEXT, booking_id TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT, redeemed_at TEXT);
CREATE TABLE IF NOT EXISTS partners (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT, pct INTEGER NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, city TEXT NOT NULL, date TEXT NOT NULL, slot_pref TEXT, created_at TEXT DEFAULT (datetime('now')), notified_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user_id TEXT, booking_id TEXT, kind TEXT NOT NULL, channel TEXT NOT NULL, status TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, booking_id TEXT, kind TEXT, r2_key TEXT NOT NULL, content_type TEXT, note TEXT, consent INTEGER DEFAULT 0, uploaded_by TEXT, created_at TEXT DEFAULT (datetime('now')));
ALTER TABLE users ADD COLUMN apple_sub TEXT;
ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN birthday_reward_year INTEGER;
ALTER TABLE users ADD COLUMN preferred_therapist TEXT;
ALTER TABLE users ADD COLUMN partner_code TEXT;
ALTER TABLE bookings ADD COLUMN therapist_id TEXT;
ALTER TABLE bookings ADD COLUMN package_id TEXT;
ALTER TABLE bookings ADD COLUMN gift_code TEXT;
ALTER TABLE bookings ADD COLUMN partner_code TEXT;
ALTER TABLE bookings ADD COLUMN reminded_at TEXT;
ALTER TABLE bookings ADD COLUMN followup_at TEXT;
CREATE INDEX IF NOT EXISTS bookings_city_date_slot ON bookings(city, date, slot);
INSERT OR IGNORE INTO settings VALUES ('birthday_pct', '20');
INSERT OR IGNORE INTO settings VALUES ('package_pct', '15');
