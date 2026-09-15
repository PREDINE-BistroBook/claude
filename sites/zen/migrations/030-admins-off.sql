-- 2026-09-15 (Ash): retire the Egyptian team's sign-ins without deleting them; Shika becomes the owner.
ALTER TABLE admins ADD COLUMN disabled INTEGER DEFAULT 0;
