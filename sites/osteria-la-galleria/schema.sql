-- Osteria La Galleria — D1 schema. Applied on every deploy (idempotent):
--   npx wrangler d1 execute osteria-la-galleria --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS reservations (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL,              -- lets the guest open / cancel their own reservation from the email link
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  date         TEXT NOT NULL,              -- YYYY-MM-DD, Europe/Rome
  time         TEXT NOT NULL,              -- HH:MM
  party        INTEGER NOT NULL,           -- covers
  note         TEXT,                       -- allergies, high chair, birthday…
  lang         TEXT DEFAULT 'it',
  status       TEXT DEFAULT 'requested',   -- requested | confirmed | seated | done | cancelled | no_show
  source       TEXT DEFAULT 'web',         -- web | manual (phone / walk-in, entered in the admin)
  table_no     TEXT,                       -- set by the staff
  admin_note   TEXT,                       -- staff-only
  created_at   TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS reservations_date ON reservations(date, time);
CREATE INDEX IF NOT EXISTS reservations_status ON reservations(status);

-- A pre-order is a list of dishes paid online, attached to a reservation. Prices are taken server-side from menu.js.
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  items          TEXT NOT NULL,            -- JSON: [{ slug, name, qty, unit, line }] (minor units)
  amount         INTEGER NOT NULL,         -- total, minor units (eur)
  currency       TEXT DEFAULT 'eur',
  platform_fee   INTEGER DEFAULT 0,        -- 2% kept by Amico Mio through Stripe Connect
  status         TEXT DEFAULT 'pending',   -- pending | paid | cancelled | served
  note           TEXT,
  stripe_session TEXT,
  payment_intent TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  paid_at        TEXT
);
CREATE INDEX IF NOT EXISTS orders_reservation ON orders(reservation_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS admins (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE,
  username   TEXT UNIQUE,
  name       TEXT,
  role       TEXT DEFAULT 'staff',         -- owner | staff | platform (Amico Mio: numbers only)
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  notify     INTEGER DEFAULT 1,            -- email me about new reservations and paid pre-orders
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Opening hours, covers per slot, closed days, whether pre-ordering is on. One JSON row.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
