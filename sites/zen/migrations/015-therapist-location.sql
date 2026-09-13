-- 2026-09-13: therapists become providers with a pinned place (lat/lng) and how far they travel to clients (km, 0 = at their place only)
ALTER TABLE therapists ADD COLUMN lat REAL;
ALTER TABLE therapists ADD COLUMN lng REAL;
ALTER TABLE therapists ADD COLUMN radius_km REAL DEFAULT 0;
