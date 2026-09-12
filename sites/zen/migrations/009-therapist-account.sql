-- 2026-09-12: a therapist profile can be linked to the admin account the person signs in with.
ALTER TABLE therapists ADD COLUMN admin_id TEXT;
