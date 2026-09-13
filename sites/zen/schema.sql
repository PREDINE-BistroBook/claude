-- Zen Recovery — D1 schema. Apply with:  npx wrangler d1 execute zen-recovery --file=schema.sql  (add --remote for production)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  phone         TEXT,
  city          TEXT,                      -- home city: cairo | dahab | florence
  photo         TEXT,                      -- small data: URL (client resizes to 256px), max ~120 KB
  notes         TEXT,                      -- health notes the client wants every therapist to know
  birthday      TEXT,
  referral_code TEXT UNIQUE,
  referred_by   TEXT,                      -- users.id of the person who invited them
  country       TEXT,                      -- EG | IT | other
  city_text     TEXT,                      -- where they live, as typed
  nearest_city  TEXT,                      -- recommended centre: cairo | dahab | florence
  intake        TEXT,                      -- JSON: goals, pain areas, activity, experience, health flags, preferences
  lang          TEXT,                      -- en | it | ar
  google_sub    TEXT,                      -- Google account id when they signed in with Google
  apple_sub     TEXT,
  approved      INTEGER DEFAULT 0,         -- a therapist approved a client with health flags for online booking
  birthday_reward_year INTEGER,            -- last year the birthday credit was issued
  preferred_therapist TEXT,
  partner_code  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,             -- unix seconds
  used       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,                     -- NULL for guests until they register with the same email
  email          TEXT,
  name           TEXT,
  phone          TEXT,
  city           TEXT NOT NULL,            -- cairo | dahab | florence
  service_id     TEXT,
  service_name   TEXT,
  date           TEXT,                     -- YYYY-MM-DD
  slot           TEXT,                     -- morning | afternoon | evening | HH:MM once confirmed
  note           TEXT,
  list_amount    INTEGER,                  -- catalog price, minor units
  amount         INTEGER,                  -- what was actually charged after discounts
  currency       TEXT,                     -- eur | egp
  discount_kind  TEXT,                     -- loyalty | referral | manual | NULL
  credit_id      TEXT,
  platform_fee   INTEGER DEFAULT 0,        -- 2% collected by the platform through Stripe
  status         TEXT DEFAULT 'pending',   -- pending | paid | confirmed | done | cancelled | no_show
  rating         INTEGER,                  -- 1-5, left by the client after a done session
  feedback       TEXT,                     -- client's words for the therapist
  therapist_note TEXT,                     -- what we did / homework, visible to the client
  therapist_id   TEXT,
  package_id     TEXT,                     -- client_packages.id when paid from a package
  gift_code      TEXT,
  partner_code   TEXT,
  lang           TEXT,                     -- language the client booked in (2026-09-13), for the emails
  reminded_at    TEXT,
  followup_at    TEXT,
  source         TEXT DEFAULT 'web',       -- web | manual (entered by an admin: cash, walk-in)
  stripe_session TEXT,
  payment_intent TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  paid_at        TEXT,
  done_at        TEXT,
  cancel_fee     INTEGER DEFAULT 0,        -- 2026-09-13: fee kept on a late cancellation / no-show (minor units)
  cancelled_at   TEXT,
  cancelled_by   TEXT,                     -- client | admin
  refund_amount  INTEGER DEFAULT 0,
  refund_status  TEXT,                     -- done | manual | none
  agreed_at      TEXT,                     -- when the client ticked the booking rules
  provider       TEXT DEFAULT 'stripe',    -- stripe | fawry (2026-09-13): who took the money; stripe_session holds the provider's reference either way
  areas          TEXT,                     -- JSON list of body areas the client tapped (2026-09-13)
  featured       INTEGER DEFAULT 0         -- the owner shows this rating + words on the home page
);
CREATE INDEX IF NOT EXISTS bookings_city_date ON bookings(city, date);
CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS bookings_email ON bookings(email);

CREATE TABLE IF NOT EXISTS credits (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- loyalty (free session) | referral (percentage off)
  pct        INTEGER NOT NULL,             -- 100 = free
  status     TEXT DEFAULT 'available',     -- available | reserved | used | expired
  reason     TEXT,                         -- e.g. "10th session" / "invited Sara" / "invited by Omar"
  booking_id TEXT,
  expires_at TEXT,                         -- birthday reward: 5 days after the birthday; NULL = no expiry
  created_at TEXT DEFAULT (datetime('now')),
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS credits_user ON credits(user_id, status);

CREATE TABLE IF NOT EXISTS admins (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT,
  role       TEXT NOT NULL,                -- all | cairo | dahab | florence
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  photo      TEXT,                          -- small data: URL, like users.photo
  phone      TEXT,
  notify     INTEGER DEFAULT 1,             -- email me about new bookings in my city (owner: all cities)
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  username   TEXT,                          -- optional second sign-in (2026-09-12); unique when set
  level      TEXT                           -- owner | partner | employee (2026-09-12); owner = role 'all'; platform has none
);
CREATE UNIQUE INDEX IF NOT EXISTS admins_username ON admins(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO settings VALUES ('loyalty_every', '10');   -- every Nth completed session is free
INSERT OR IGNORE INTO settings VALUES ('referral_pct', '40');    -- both people get this % off one session

CREATE TABLE IF NOT EXISTS checkins (            -- "how do you feel today" between sessions
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  pain       INTEGER,                      -- 0-10
  energy     INTEGER,                      -- 1-5
  sleep      INTEGER,                      -- 1-5
  note       TEXT,
  booking_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS checkins_user ON checkins(user_id, date);
CREATE TABLE IF NOT EXISTS therapists (id TEXT PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, bio TEXT, photo TEXT, languages TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), admin_id TEXT, area TEXT, address TEXT, maps_url TEXT, title TEXT, story TEXT, certs TEXT, instagram TEXT, i18n TEXT, lat REAL, lng REAL, radius_km REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS availability (id TEXT PRIMARY KEY, city TEXT NOT NULL, therapist_id TEXT, weekday INTEGER NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, slot_minutes INTEGER DEFAULT 60);
CREATE TABLE IF NOT EXISTS blocked (id TEXT PRIMARY KEY, city TEXT NOT NULL, therapist_id TEXT, date TEXT NOT NULL, start TEXT, end TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, sessions INTEGER NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, months_valid INTEGER DEFAULT 6, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS client_packages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, package_id TEXT NOT NULL, name TEXT, city TEXT, sessions INTEGER, remaining INTEGER, amount INTEGER, currency TEXT, platform_fee INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', stripe_session TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT, provider TEXT DEFAULT 'stripe');
CREATE TABLE IF NOT EXISTS gifts (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, city TEXT NOT NULL, service_id TEXT, service_name TEXT, amount INTEGER, currency TEXT, platform_fee INTEGER DEFAULT 0, buyer_name TEXT, buyer_email TEXT, recipient_name TEXT, recipient_email TEXT, message TEXT, status TEXT DEFAULT 'pending', stripe_session TEXT, booking_id TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT, redeemed_at TEXT, lang TEXT, provider TEXT DEFAULT 'stripe');
CREATE TABLE IF NOT EXISTS partners (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT, pct INTEGER NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), kind TEXT DEFAULT 'partner', contact TEXT, created_by TEXT); -- kind: partner | hostel | gym | corporate (2026-09-13)
CREATE TABLE IF NOT EXISTS waitlist (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, city TEXT NOT NULL, date TEXT NOT NULL, slot_pref TEXT, created_at TEXT DEFAULT (datetime('now')), notified_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user_id TEXT, booking_id TEXT, kind TEXT NOT NULL, channel TEXT NOT NULL, status TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, booking_id TEXT, kind TEXT, r2_key TEXT NOT NULL, content_type TEXT, note TEXT, consent INTEGER DEFAULT 0, uploaded_by TEXT, created_at TEXT DEFAULT (datetime('now')), data TEXT);
CREATE INDEX IF NOT EXISTS bookings_city_date_slot ON bookings(city, date, slot);
INSERT OR IGNORE INTO settings VALUES ('birthday_pct', '50');
INSERT OR IGNORE INTO settings VALUES ('package_pct', '15');
INSERT OR IGNORE INTO settings VALUES ('cancel_hours', '24');   -- free cancellation / free move up to this many hours before
INSERT OR IGNORE INTO settings VALUES ('late_pct', '100');      -- % of the price kept inside the window
INSERT OR IGNORE INTO settings VALUES ('noshow_pct', '100');
INSERT OR IGNORE INTO settings VALUES ('review_cairo', '');
INSERT OR IGNORE INTO settings VALUES ('review_dahab', '');
INSERT OR IGNORE INTO settings VALUES ('review_florence', '');
-- Services and prices, editable from the admin (seeded from the original catalog; src/catalog.js is the fallback)
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, city TEXT NOT NULL, name TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 60, amount INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, photo TEXT, i18n TEXT);
CREATE TABLE IF NOT EXISTS therapist_prices (therapist_id TEXT NOT NULL, service_id TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (therapist_id, service_id));
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-man', 'cairo', 'Manual therapy', 60, 100000, 'egp', 'Deep tissue and sports massage, hands only.', 0);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-dry', 'cairo', 'Dry cupping', 45, 90000, 'egp', 'Cups placed and left still. The classic session.', 1);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-slide', 'cairo', 'Sliding cupping', 60, 120000, 'egp', 'Oiled skin, gliding cups. Massage with the lift built in.', 2);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-fire', 'cairo', 'Fire cupping', 45, 100000, 'egp', 'Glass cups, a flash of flame, deeper warmth.', 3);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-hij', 'cairo', 'Hijama', 60, 110000, 'egp', 'Wet cupping with sterile single-use equipment.', 4);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('cai-face', 'cairo', 'Facial cupping', 30, 70000, 'egp', 'Light, gliding, no marks.', 5);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('dah-man', 'dahab', 'Manual therapy', 60, 100000, 'egp', 'Deep tissue and sports massage, hands only.', 0);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('dah-dry', 'dahab', 'Dry cupping', 45, 90000, 'egp', 'Cups placed and left still. The classic session.', 1);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('dah-slide', 'dahab', 'Sliding cupping', 60, 120000, 'egp', 'Oiled skin, gliding cups. Good after a day of diving or climbing.', 2);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('dah-fire', 'dahab', 'Fire cupping', 45, 100000, 'egp', 'Glass cups, a flash of flame, deeper warmth.', 3);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('dah-face', 'dahab', 'Facial cupping', 30, 70000, 'egp', 'Light, gliding, no marks.', 4);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('flo-man', 'florence', 'Manual therapy', 60, 6000, 'eur', 'Deep tissue and sports massage, hands only.', 0);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('flo-dry', 'florence', 'Dry cupping', 45, 5500, 'eur', 'Cups placed and left still. The classic session.', 1);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('flo-slide', 'florence', 'Sliding cupping', 60, 7000, 'eur', 'Oiled skin, gliding cups. Massage with the lift built in.', 2);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('flo-fire', 'florence', 'Fire cupping', 45, 6500, 'eur', 'Glass cups, a flash of flame, deeper warmth.', 3);
INSERT OR IGNORE INTO services (id, city, name, minutes, amount, currency, description, sort) VALUES ('flo-face', 'florence', 'Facial cupping', 30, 4500, 'eur', 'Light, gliding, no marks.', 4);
CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, city TEXT NOT NULL, area TEXT, address TEXT, maps_url TEXT, title TEXT, bio TEXT, story TEXT, certs TEXT, instagram TEXT, languages TEXT, photo TEXT, lat REAL, lng REAL, radius_km REAL DEFAULT 0, lang TEXT, status TEXT DEFAULT 'new', note TEXT, therapist_id TEXT, created_at TEXT DEFAULT (datetime('now')), decided_at TEXT);
CREATE INDEX IF NOT EXISTS applications_status ON applications(status, created_at);
