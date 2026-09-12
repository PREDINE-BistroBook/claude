-- 2026-09-12: owner / partner / employee. Owner = role 'all'. Partner runs one city; employee is one therapist. Platform has no level.
ALTER TABLE admins ADD COLUMN level TEXT;
UPDATE admins SET level = CASE WHEN role = 'all' THEN 'owner' WHEN role = 'platform' THEN NULL ELSE 'employee' END;
