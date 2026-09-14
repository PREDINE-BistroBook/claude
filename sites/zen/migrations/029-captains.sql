-- 2026-09-14 captains (Ash): a therapist who trains another gets a share of what the trainee makes through Zen; the platform keeps a slice of that share.
ALTER TABLE therapists ADD COLUMN captain_id TEXT;
ALTER TABLE therapists ADD COLUMN invite_code TEXT;
ALTER TABLE applications ADD COLUMN captain_id TEXT;
ALTER TABLE applications ADD COLUMN city_text TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS therapists_invite ON therapists(invite_code) WHERE invite_code IS NOT NULL;
