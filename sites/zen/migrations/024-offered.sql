-- 2026-09-13: a therapist controls their own list: a service can be switched off for them (offered = 0), and priced by them
ALTER TABLE therapist_prices ADD COLUMN offered INTEGER DEFAULT 1;
