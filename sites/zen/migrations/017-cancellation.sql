-- 2026-09-13: booking rules and cancellation fees
ALTER TABLE bookings ADD COLUMN cancel_fee INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_by TEXT;
ALTER TABLE bookings ADD COLUMN refund_amount INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN refund_status TEXT;
ALTER TABLE bookings ADD COLUMN agreed_at TEXT;
INSERT OR IGNORE INTO settings VALUES ('cancel_hours', '24');
INSERT OR IGNORE INTO settings VALUES ('late_pct', '100');
INSERT OR IGNORE INTO settings VALUES ('noshow_pct', '100');
