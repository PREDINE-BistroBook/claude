-- 2026-09-13: profile texts translated by Workers AI (JSON {it:{...}, ar:{...}}); language a booking / gift was made in, for the emails.
ALTER TABLE therapists ADD COLUMN i18n TEXT;
ALTER TABLE bookings ADD COLUMN lang TEXT;
ALTER TABLE gifts ADD COLUMN lang TEXT;
