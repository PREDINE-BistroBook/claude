-- 2026-09-13: Fawry for Egyptian payments — which provider took the money
ALTER TABLE bookings ADD COLUMN provider TEXT DEFAULT 'stripe';
ALTER TABLE gifts ADD COLUMN provider TEXT DEFAULT 'stripe';
ALTER TABLE client_packages ADD COLUMN provider TEXT DEFAULT 'stripe';
