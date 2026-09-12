-- 2026-09-12: where a therapist works (Cairo is big): neighbourhood shown at checkout, address in the confirmation, optional maps link.
ALTER TABLE therapists ADD COLUMN area TEXT;
ALTER TABLE therapists ADD COLUMN address TEXT;
ALTER TABLE therapists ADD COLUMN maps_url TEXT;
