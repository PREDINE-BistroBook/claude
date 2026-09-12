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
  source         TEXT DEFAULT 'web',       -- web | manual (entered by an admin: cash, walk-in)
  stripe_session TEXT,
  payment_intent TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  paid_at        TEXT,
  done_at        TEXT
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
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO settings VALUES ('loyalty_every', '10');   -- every Nth completed session is free
INSERT OR IGNORE INTO settings VALUES ('referral_pct', '40');    -- both people get this % off one session
