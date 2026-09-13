-- 2026-09-13: where it hurts (body map on the booking form) + client reviews the owner shows on the home page
ALTER TABLE bookings ADD COLUMN areas TEXT;
ALTER TABLE bookings ADD COLUMN featured INTEGER DEFAULT 0;
